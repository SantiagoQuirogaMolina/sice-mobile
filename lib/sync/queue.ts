/**
 * Sync queue — procesa pending_citizens, pending_event_beneficiaries y
 * pending_deliveries → backend, en ese orden.
 *
 * Orden importa: una delivery offline para un PendingCitizen no puede subir
 * hasta que el citizen tenga server_id. Un PendingEventBeneficiary no puede
 * subir hasta tener citizen_server_id. Cada paso se reintenta de forma
 * independiente con backoff.
 *
 * Diseño:
 *   - Re-entrada protegida (mutex `inFlight`) para evitar 2 procesos paralelos
 *     si el operador toca "Sincronizar" mientras ya está corriendo.
 *   - Batch de 10 (no de 50 como web): mobile tiene foto+firma grandes,
 *     batches grandes saturan red móvil flaky.
 *   - Backoff exponencial: 30s, 1m, 2m, 4m, 8m... cap 30min.
 *   - Errores 4xx no-retryables → blocked (operador decide).
 *   - 5xx y network → error con nextAttemptAt.
 *   - Conflict 409 → blocked con flag conflict.
 *
 * Subscripción:
 *   - subscribeQueueEvents(cb) para que la UI se entere del progreso.
 */

import {
  countDeliveriesByStatus,
  countPendingCitizensByStatus,
  countPendingEbsByStatus,
  countPendingSync,
  getPendingCitizen,
  getPendingEbByCitizen,
  isLocalCitizen,
  listDeliveriesByStatus,
  listPendingCitizensByStatus,
  listPendingEbsByStatus,
  markDeliveryBlocked,
  markDeliveryError,
  markDeliverySynced,
  setDeliverySyncStatus,
  updatePendingCitizenStatus,
  updatePendingEbStatus,
  type PendingDelivery,
} from '../offline/db';
import {
  uploadCitizen,
  uploadDelivery,
  uploadEventBeneficiary,
  type SyncResult,
} from './transport';
import {
  reportSyncIncident,
  type SyncIncidentKind,
} from '../api/services/sync-incidents.service';

export type QueueEvent =
  | { type: 'batch-start'; total: number }
  | { type: 'item-start'; id: string }
  | { type: 'item-done'; id: string; result: SyncResult }
  | {
      type: 'batch-end';
      processed: number;
      ok: number;
      failed: number;
      blocked: number;
    };

type Listener = (e: QueueEvent) => void;
const listeners = new Set<Listener>();

export function subscribeQueueEvents(cb: Listener): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

function emit(e: QueueEvent): void {
  for (const cb of listeners) {
    try {
      cb(e);
    } catch {
      /* nunca dejes que un listener tumbe la cola */
    }
  }
}

/* ─────────────────────────── Backoff ─────────────────────────── */

/** 5s · 10s · 20s · 40s · 80s … 30min (cap).
 *  Base corta (antes 30s): un error TRANSITORIO (timeout/5xx/red) se reintenta
 *  pronto y la cola termina en segundos, no en "oleadas" separadas por 30s que
 *  parecían un bloqueo. Los errores permanentes (4xx) no entran acá (van a blocked). */
function nextBackoffISO(retryCount: number): string {
  const seconds = Math.min(5 * 2 ** retryCount, 30 * 60);
  return new Date(Date.now() + seconds * 1000).toISOString();
}

/** Cede el hilo de JS al event loop. En RN el JS corre en UN solo hilo: sin
 *  estos respiros, el drain monopoliza el hilo y la UI se congela mientras
 *  sincroniza. Un `setTimeout(0)` deja que React pinte el progreso y atienda
 *  los toques entre uploads. */
const yieldToUI = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

/** ¿La fecha ISO de nextAttempt ya pasó? */
function isReady(at: string | null): boolean {
  if (!at) return true; // sin schedule → listo
  return new Date(at).getTime() <= Date.now();
}

/* ─────────────────────────── Mutex ─────────────────────────── */

let inFlight = false;
// Si llega un disparo (auto-sync al reconectar, AppState, botón) mientras YA hay
// un drain corriendo, no se descarta: se marca para re-lanzar al terminar. Antes
// el mutex tragaba el disparo → al reconectar no se sincronizaba si justo había
// uno en curso.
let pendingRetry = false;

// Reintento AUTOMÁTICO de la "segunda oleada": si un drain deja items en 'error'
// (transitorios con backoff), reprogramamos un reintento para vaciar la cola sin
// que el operador toque de nuevo (antes veía "2 sincronizadas" y silencio hasta
// volver a pulsar). Se autolimita: si insiste varias veces sin progreso, para y
// deja que el auto-sync por reconexión/AppState lo retome.
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let autoRetryCount = 0;
const AUTO_RETRY_DELAYS_MS = [6_000, 11_000, 21_000, 41_000, 81_000, 120_000];

function scheduleAutoRetry(retryableFailed: number, ok: number): void {
  if (ok > 0) autoRetryCount = 0; // hubo progreso → reiniciar la insistencia
  if (retryableFailed <= 0) return; // nada reintentable (todo subió o quedó blocked)
  if (autoRetryCount >= AUTO_RETRY_DELAYS_MS.length) return; // insistir de más no ayuda
  const delay = AUTO_RETRY_DELAYS_MS[autoRetryCount];
  autoRetryCount += 1;
  if (retryTimer) clearTimeout(retryTimer);
  retryTimer = setTimeout(() => {
    retryTimer = null;
    void processSyncQueue();
  }, delay);
}

/* ─────────────────────────── Public API ─────────────────────────── */

// Tamaño del lote por etapa y por PASE. Con el drain (varios pases por llamada)
// + la concurrencia de abajo, UNA sola pulsación de "Sincronizar" vacía TODA la
// cola (antes solo subía 10 por pulsación, uno por uno → inviable para miles).
const BATCH_SIZE = 25;
// Concurrencia: subir varias a la vez. Deliveries cargan evidencia (foto ~300KB)
// → concurrencia moderada para no saturar redes móviles flaky. Citizens/EBs son
// POSTs livianos → más alto.
const CONCURRENCY_DELIVERIES = 4;
const CONCURRENCY_LIGHT = 6;
// Tope de pases por drain (guarda anti-bucle; el corte real es "un pase sin
// progreso"). 100k holgado para cualquier cola real.
const MAX_DRAIN_PASSES = 100_000;
const STUCK_THRESHOLD_MS = 60_000;

/**
 * Ejecuta `fn` sobre `items` con un máximo de `limit` en vuelo a la vez.
 * Reemplaza el `for ... await` secuencial (1×1) que hacía el sync eterno.
 */
async function mapWithConcurrency<T>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<void>,
): Promise<void> {
  let idx = 0;
  const workers: Promise<void>[] = [];
  const n = Math.min(Math.max(1, limit), items.length);
  for (let w = 0; w < n; w++) {
    workers.push(
      (async () => {
        while (idx < items.length) {
          const i = idx++;
          await fn(items[i]);
          // Respiro tras cada item → la UI no se traba durante el drain y el
          // contador de progreso sube fluido (1, 2, 3…) en vez de saltar al final.
          await yieldToUI();
        }
      })(),
    );
  }
  await Promise.all(workers);
}

interface BatchTotals {
  processed: number;
  ok: number;
  failed: number;
  blocked: number;
  /** Errores REINTENTABLES (5xx/red/401/timeout) — los que justifican la
   *  "segunda oleada" automática. Distinto de `blocked` (4xx/conflict, no se
   *  reintentan) y de `failed` (que suma ambos). */
  retryable: number;
}

const emptyTotals = (): BatchTotals => ({
  processed: 0,
  ok: 0,
  failed: 0,
  blocked: 0,
  retryable: 0,
});

/**
 * Toma un batch y lo procesa en 3 etapas:
 *   1) PendingCitizens pendientes / con backoff vencido
 *   2) PendingEventBeneficiaries cuyo citizen ya tiene serverId
 *   3) PendingDeliveries (resolviendo citizenId local → serverId si aplica)
 *
 * No bloqueante: vuelve apenas el último item del batch terminó.
 */
export async function processSyncQueue(): Promise<BatchTotals> {
  if (inFlight) {
    pendingRetry = true; // se re-lanza al terminar el drain en curso
    return emptyTotals();
  }
  inFlight = true;
  // Si había un reintento automático programado, esta corrida lo cubre.
  if (retryTimer) {
    clearTimeout(retryTimer);
    retryTimer = null;
  }

  // Sprint 9.10: SIEMPRE emitir un batch-start y un batch-end aun si no
  // hay nada pendiente o si algún stage lanza excepción. Antes la UI se
  // quedaba en spinner infinito porque batch-start era condicional dentro
  // de cada stage y batch-end solo si processed>0. Si processCitizens
  // lanzaba excepción después de su batch-start, batch-end nunca se
  // emitía y `syncing` quedaba true para siempre.
  let totalQueued = 0;
  try {
    // COUNT ligero (no materializar base64 de miles de filas solo para contar).
    totalQueued =
      countPendingCitizensByStatus('pending') +
      countPendingCitizensByStatus('error') +
      countPendingCitizensByStatus('blocked') +
      countPendingEbsByStatus('pending') +
      countPendingEbsByStatus('error') +
      countPendingEbsByStatus('blocked') +
      countDeliveriesByStatus('pending') +
      countDeliveriesByStatus('error') +
      countDeliveriesByStatus('blocked');
  } catch {
    /* si la BD falla, total=0; igual emitimos los eventos */
  }
  emit({ type: 'batch-start', total: totalQueued });

  const totals = emptyTotals();
  try {
    // 0) Recovery: items en 'syncing' por más de 60s → reset a pending.
    //    Pasa si la app muere a mitad de un upload (kill OS / swipe-close).
    //    #9: extendido a las 3 tablas. Antes SOLO deliveries: un citizen o
    //    EB que quedaba 'syncing' jamás se reintentaba (los stages solo toman
    //    pending/error/blocked) → quedaba huérfano para siempre y bloqueaba la
    //    cadena (la delivery offline espera el citizen_server_id).
    const stuck = listDeliveriesByStatus('syncing');
    for (const item of stuck) {
      const ts = item.lastAttemptAt
        ? new Date(item.lastAttemptAt).getTime()
        : 0;
      if (Date.now() - ts > STUCK_THRESHOLD_MS) {
        setDeliverySyncStatus(item.id, 'pending', { nextAttemptAt: null });
      }
    }
    const stuckCitizens = listPendingCitizensByStatus('syncing');
    for (const c of stuckCitizens) {
      const ts = c.lastAttemptAt ? new Date(c.lastAttemptAt).getTime() : 0;
      if (Date.now() - ts > STUCK_THRESHOLD_MS) {
        updatePendingCitizenStatus(c.localId, 'pending', { nextAttemptAt: null });
      }
    }
    const stuckEbs = listPendingEbsByStatus('syncing');
    for (const eb of stuckEbs) {
      const ts = eb.lastAttemptAt ? new Date(eb.lastAttemptAt).getTime() : 0;
      if (Date.now() - ts > STUCK_THRESHOLD_MS) {
        updatePendingEbStatus(eb.localId, 'pending', { nextAttemptAt: null });
      }
    }

    // DRAIN: repetir pases (citizens → EBs → deliveries) hasta vaciar la cola.
    // Antes se procesaba UN solo batch por llamada → el operador tenía que tocar
    // "Sincronizar" decenas/cientos de veces. Ahora una pulsación sube TODO lo
    // que se pueda. Corte: un pase sin progreso (ok===0) → solo quedan diferidas
    // (esperando su citizen), con backoff, o bloqueadas para resolución manual.
    // `blocked` solo se reintenta en el PRIMER pase (la pulsación del usuario),
    // no en cada pase, para no re-pegarle en bucle a lo que de verdad está trabado.
    for (let pass = 0; pass < MAX_DRAIN_PASSES; pass++) {
      const passTotals = emptyTotals();
      await processCitizens(passTotals, pass === 0);
      await processEbs(passTotals, pass === 0);
      await processDeliveries(passTotals);
      totals.processed += passTotals.processed;
      totals.ok += passTotals.ok;
      totals.failed += passTotals.failed;
      totals.blocked += passTotals.blocked;
      totals.retryable += passTotals.retryable;
      // Corte por PASE VACÍO (no por "sin éxito"): si este pase no procesó nada,
      // la cola está drenada para AHORA (lo que queda son items con backoff aún
      // vigente o diferidos). Antes cortaba con ok===0 aun cuando había items que
      // SÍ se intentaron-y-fallaron → declaraba "listo" antes de tiempo.
      if (passTotals.processed === 0) break;
      // Respiro entre pases (3 stages encadenados) para no micro-trabar la UI.
      await yieldToUI();
    }

    return totals;
  } catch (err) {
    // Cualquier excepción inesperada queda registrada en console pero NO
    // bloquea: emitimos batch-end de todas formas para liberar la UI.
    // eslint-disable-next-line no-console
    console.log('[sync] processSyncQueue error:', err);
    return totals;
  } finally {
    emit({
      type: 'batch-end',
      processed: totals.processed,
      ok: totals.ok,
      failed: totals.failed,
      blocked: totals.blocked,
    });
    inFlight = false;
    // Si hubo un disparo mientras corríamos, re-lanzamos UNA vez (no recursión
    // infinita: solo si llegó un trigger real durante el drain anterior).
    if (pendingRetry) {
      pendingRetry = false;
      void processSyncQueue();
    } else {
      // Sin re-disparo manual: si quedaron items en 'error' (transitorios), la
      // "segunda oleada" se reintenta SOLA en unos segundos.
      scheduleAutoRetry(totals.retryable, totals.ok);
    }
  }
}

/* ─────────────────────────── Stage helpers ─────────────────────────── */

async function processCitizens(totals: BatchTotals, includeBlocked: boolean): Promise<void> {
  const pending = listPendingCitizensByStatus('pending', BATCH_SIZE);
  const errors = listPendingCitizensByStatus('error', BATCH_SIZE).filter((c) =>
    isReady(c.nextAttemptAt),
  );
  // 'blocked' solo en el primer pase del drain (la pulsación del usuario): muchos
  // vienen de 409 (citizen ya existe) que el backend idempotente resuelve solo;
  // en pases siguientes no se reintentan para no pegarles en bucle.
  const blocked = includeBlocked ? listPendingCitizensByStatus('blocked', BATCH_SIZE) : [];
  const queue = [...pending, ...errors, ...blocked].slice(0, BATCH_SIZE);
  if (queue.length === 0) return;

  await mapWithConcurrency(queue, CONCURRENCY_LIGHT, async (c) => {
    updatePendingCitizenStatus(c.localId, 'syncing');
    emit({ type: 'item-start', id: c.localId });
    const result = await uploadCitizen(c);
    applyResult({
      result,
      retryCount: c.retryCount,
      onOk: (serverId) =>
        updatePendingCitizenStatus(c.localId, 'synced', {
          serverId,
          lastError: null,
          nextAttemptAt: null,
        }),
      onBlocked: (msg) =>
        updatePendingCitizenStatus(c.localId, 'blocked', {
          lastError: msg,
          nextAttemptAt: null,
        }),
      onError: (msg, next) =>
        updatePendingCitizenStatus(c.localId, 'error', {
          lastError: msg,
          nextAttemptAt: next,
          incrementRetry: true,
        }),
      totals,
    });
    emit({ type: 'item-done', id: c.localId, result });
  });
}

async function processEbs(totals: BatchTotals, includeBlocked: boolean): Promise<void> {
  // Solo los EBs cuyo citizen YA está sincronizado (tiene server_id).
  const pending = listPendingEbsByStatus('pending', BATCH_SIZE);
  const errors = listPendingEbsByStatus('error', BATCH_SIZE).filter((eb) =>
    isReady(eb.nextAttemptAt),
  );
  // 'blocked' solo en el primer pase del drain (mismo criterio que processCitizens).
  const blocked = includeBlocked ? listPendingEbsByStatus('blocked', BATCH_SIZE) : [];
  const candidates = [...pending, ...errors, ...blocked].slice(0, BATCH_SIZE);
  if (candidates.length === 0) return;

  await mapWithConcurrency(candidates, CONCURRENCY_LIGHT, async (eb) => {
    // Resolver citizen_server_id si todavía está vacío
    let citizenServerId = eb.citizenServerId;
    if (!citizenServerId) {
      const cit = getPendingCitizen(eb.citizenLocalId);
      if (!cit?.serverId) {
        // El citizen no terminó de sincronizar → diferimos este EB al próximo
        // pase. `return` (no `continue`) porque ahora corre dentro de un callback.
        return;
      }
      citizenServerId = cit.serverId;
    }

    updatePendingEbStatus(eb.localId, 'syncing', { citizenServerId });
    emit({ type: 'item-start', id: eb.localId });
    const result = await uploadEventBeneficiary({ ...eb, citizenServerId });
    applyResult({
      result,
      retryCount: eb.retryCount,
      onOk: (serverId) =>
        updatePendingEbStatus(eb.localId, 'synced', {
          serverId,
          lastError: null,
          nextAttemptAt: null,
        }),
      onBlocked: (msg) =>
        updatePendingEbStatus(eb.localId, 'blocked', {
          lastError: msg,
          nextAttemptAt: null,
        }),
      onError: (msg, next) =>
        updatePendingEbStatus(eb.localId, 'error', {
          lastError: msg,
          nextAttemptAt: next,
          incrementRetry: true,
        }),
      totals,
    });
    reportBlockedIncident({
      result,
      eventId: eb.eventId,
      sectorId: eb.sectorId,
      citizenLocalId: eb.citizenLocalId,
      deviceLocalId: `eb:${eb.localId}`,
    });
    emit({ type: 'item-done', id: eb.localId, result });
  });
}

async function processDeliveries(totals: BatchTotals): Promise<void> {
  // Tomar pending + error con backoff vencido
  const pending = listDeliveriesByStatus('pending', BATCH_SIZE);
  const errors = listDeliveriesByStatus('error', BATCH_SIZE).filter((d) =>
    isReady(d.nextAttemptAt),
  );
  const queue: PendingDelivery[] = [...pending, ...errors].slice(0, BATCH_SIZE);
  if (queue.length === 0) return;

  await mapWithConcurrency(queue, CONCURRENCY_DELIVERIES, async (item) => {
    // Si la delivery referencia un citizen local, debemos resolver el
    // serverId antes de subir. Si el citizen aún no se sincronizó, dejamos
    // la delivery pending (no la marcamos error; volverá a aparecer en el
    // próximo batch tras procesar citizens).
    let citizenServerId: string | undefined;
    if (isLocalCitizen(item.citizenId)) {
      const cit = getPendingCitizen(item.citizenId);
      if (!cit?.serverId) {
        return; // diferida (callback) — se reintenta el próximo pase, sin retry++
      }
      citizenServerId = cit.serverId;
    }

    setDeliverySyncStatus(item.id, 'syncing', {
      lastAttemptAt: new Date().toISOString(),
    });
    emit({ type: 'item-start', id: item.id });

    const result = await uploadDelivery(item, { citizenServerId });

    applyResult({
      result,
      retryCount: item.retryCount,
      onOk: (serverId) => markDeliverySynced(item.id, serverId),
      onBlocked: (msg) => markDeliveryBlocked(item.id, msg),
      onError: (msg, next) => markDeliveryError(item.id, msg, next),
      totals,
    });
    reportBlockedIncident({
      result,
      eventId: item.eventId,
      citizenLocalId: isLocalCitizen(item.citizenId) ? item.citizenId : null,
      deviceLocalId: `delivery:${item.id}`,
    });
    emit({ type: 'item-done', id: item.id, result });
  });
}

interface ApplyResultArgs {
  result: SyncResult;
  retryCount: number;
  onOk: (serverId: string) => void;
  onBlocked: (msg: string) => void;
  onError: (msg: string, nextAttemptAt: string) => void;
  totals: BatchTotals;
}

function applyResult(args: ApplyResultArgs): void {
  const { result, retryCount, onOk, onBlocked, onError, totals } = args;
  totals.processed += 1;
  if (result.kind === 'ok') {
    onOk(result.serverId);
    totals.ok += 1;
  } else if (result.kind === 'conflict') {
    onBlocked(`Conflicto: ${result.reason}`);
    totals.blocked += 1;
  } else if (!result.retryable) {
    onBlocked(result.message);
    totals.blocked += 1;
    totals.failed += 1;
  } else {
    onError(result.message, nextBackoffISO(retryCount));
    totals.failed += 1;
    totals.retryable += 1;
  }
}

/* ─────────────────── Reporte de incidencias a backend ─────────────────── */

const INCIDENT_UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const VALIDATION_CODES = new Set([
  'SIGNATURE_REQUIRED',
  'PHOTO_REQUIRED',
  'GPS_REQUIRED',
  'SECTOR_REQUIRED',
  'SECTOR_REQUIRED_FOR_OPERATOR',
]);

function kindFromResult(result: SyncResult, code?: string): SyncIncidentKind {
  if (code === 'DUPLICATE_DELIVERY') return 'duplicate_delivery';
  if (code === 'CITIZEN_DUPLICATE') return 'duplicate_citizen';
  if (result.kind === 'conflict') return 'duplicate_delivery';
  if (code && VALIDATION_CODES.has(code)) return 'validation';
  return 'rejected';
}

/**
 * Reporta al backend una captura que quedó "blocked" (conflict o 4xx
 * no-retryable), para que el coordinador la vea. Best-effort: cualquier fallo
 * se traga (no rompe la cola). El backend es idempotente por deviceLocalId.
 * Solo reporta lo que tiene eventId (delivery/EB); el citizen suelto sin
 * evento no genera incidencia (su efecto se ve en la cadena que no progresa).
 */
function reportBlockedIncident(args: {
  result: SyncResult;
  eventId?: string;
  sectorId?: string | null;
  citizenLocalId?: string | null;
  deviceLocalId: string;
}): void {
  const { result } = args;
  const blocked =
    result.kind === 'conflict' ||
    (result.kind === 'error' && !result.retryable);
  if (!blocked || !args.eventId) return;

  const code = 'code' in result ? result.code : undefined;
  const reason = result.kind === 'conflict' ? result.reason : result.message;
  const kind = kindFromResult(result, code);

  let documentType: 'CC' | 'TI' | 'CE' | 'PA' | 'PPT' | undefined;
  let documentNumber: string | undefined;
  let citizenName: string | undefined;
  if (args.citizenLocalId) {
    const c = getPendingCitizen(args.citizenLocalId);
    if (c) {
      documentType = c.documentType;
      const doc = (c.documentNumber ?? '').replace(/[^A-Za-z0-9]/g, '');
      if (doc.length >= 4 && doc.length <= 20) documentNumber = doc;
      const name = `${c.firstName ?? ''} ${c.lastName ?? ''}`.trim();
      if (name) citizenName = name.slice(0, 200);
    }
  }

  void reportSyncIncident({
    eventId: args.eventId,
    sectorId:
      args.sectorId && INCIDENT_UUID_RE.test(args.sectorId)
        ? args.sectorId
        : undefined,
    documentType,
    documentNumber,
    citizenName,
    kind,
    code: code ? code.slice(0, 80) : undefined,
    reason: (reason || 'Captura rechazada por el servidor.').slice(0, 500),
    deviceLocalId: args.deviceLocalId,
    occurredAt: new Date().toISOString(),
  }).catch(() => {
    /* best-effort: la visibilidad del coordinador no debe romper el sync */
  });
}

/** Pending sync count incluye citizens, EBs y deliveries pendientes/error. */
export function getPendingCount(): number {
  // Para simplificar la UI, el contador del header solo refleja deliveries.
  // Una pantalla detallada de sync expone el desglose por tipo si es preciso.
  return countPendingSync();
}

export function isSyncInFlight(): boolean {
  return inFlight;
}

/**
 * Eventos auxiliares: ¿hay items pending/error en cualquier capa?
 *
 * Útil para mostrar un badge "Sincronización pendiente" en el dashboard
 * sin tener que sumar manualmente las 3 tablas en cada pantalla.
 */
export function hasAnyPending(): boolean {
  if (countPendingSync() > 0) return true;
  if (listPendingCitizensByStatus('pending').length > 0) return true;
  if (listPendingCitizensByStatus('error').length > 0) return true;
  if (listPendingEbsByStatus('pending').length > 0) return true;
  if (listPendingEbsByStatus('error').length > 0) return true;
  return false;
}

/**
 * Devuelve true si la EB referenciada por (eventId, citizenLocalId) ya está
 * synced. Útil para que el wizard sepa cuándo un PendingCitizen/EB están
 * listos en backend (puede haber casos donde el operador entra al wizard
 * mientras la EB sigue pending — la delivery quedará deferida pero entrará).
 */
export function isExceptionLinkSynced(
  eventId: string,
  citizenLocalId: string,
): boolean {
  const eb = getPendingEbByCitizen(eventId, citizenLocalId);
  return eb?.syncStatus === 'synced';
}
