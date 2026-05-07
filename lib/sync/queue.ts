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

/** 30s · 60s · 2min · 4min · 8min · 16min · 30min (cap). */
function nextBackoffISO(retryCount: number): string {
  const seconds = Math.min(30 * 2 ** retryCount, 30 * 60);
  return new Date(Date.now() + seconds * 1000).toISOString();
}

/** ¿La fecha ISO de nextAttempt ya pasó? */
function isReady(at: string | null): boolean {
  if (!at) return true; // sin schedule → listo
  return new Date(at).getTime() <= Date.now();
}

/* ─────────────────────────── Mutex ─────────────────────────── */

let inFlight = false;

/* ─────────────────────────── Public API ─────────────────────────── */

const BATCH_SIZE = 10;
const STUCK_THRESHOLD_MS = 60_000;

interface BatchTotals {
  processed: number;
  ok: number;
  failed: number;
  blocked: number;
}

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
    return { processed: 0, ok: 0, failed: 0, blocked: 0 };
  }
  inFlight = true;

  // Sprint 9.10: SIEMPRE emitir un batch-start y un batch-end aun si no
  // hay nada pendiente o si algún stage lanza excepción. Antes la UI se
  // quedaba en spinner infinito porque batch-start era condicional dentro
  // de cada stage y batch-end solo si processed>0. Si processCitizens
  // lanzaba excepción después de su batch-start, batch-end nunca se
  // emitía y `syncing` quedaba true para siempre.
  let totalQueued = 0;
  try {
    totalQueued =
      listPendingCitizensByStatus('pending').length +
      listPendingCitizensByStatus('error').length +
      listPendingEbsByStatus('pending').length +
      listPendingEbsByStatus('error').length +
      listDeliveriesByStatus('pending').length +
      listDeliveriesByStatus('error').length;
  } catch {
    /* si la BD falla, total=0; igual emitimos los eventos */
  }
  emit({ type: 'batch-start', total: totalQueued });

  const totals: BatchTotals = { processed: 0, ok: 0, failed: 0, blocked: 0 };
  try {
    // 0) Recovery: items en 'syncing' por más de 60s → reset a pending
    const stuck = listDeliveriesByStatus('syncing');
    for (const item of stuck) {
      const ts = item.lastAttemptAt
        ? new Date(item.lastAttemptAt).getTime()
        : 0;
      if (Date.now() - ts > STUCK_THRESHOLD_MS) {
        setDeliverySyncStatus(item.id, 'pending', { nextAttemptAt: null });
      }
    }

    // 1) Sincronizar citizens pendientes ───────────────────────────────────
    await processCitizens(totals);
    // 2) Sincronizar event_beneficiaries que ya tienen citizen_server_id ───
    await processEbs(totals);
    // 3) Sincronizar deliveries ────────────────────────────────────────────
    await processDeliveries(totals);

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
  }
}

/* ─────────────────────────── Stage helpers ─────────────────────────── */

async function processCitizens(totals: BatchTotals): Promise<void> {
  const pending = listPendingCitizensByStatus('pending');
  const errors = listPendingCitizensByStatus('error').filter((c) =>
    isReady(c.nextAttemptAt),
  );
  const queue = [...pending, ...errors].slice(0, BATCH_SIZE);
  if (queue.length === 0) return;

  for (const c of queue) {
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
  }
}

async function processEbs(totals: BatchTotals): Promise<void> {
  // Solo los EBs cuyo citizen YA está sincronizado (tiene server_id).
  const pending = listPendingEbsByStatus('pending');
  const errors = listPendingEbsByStatus('error').filter((eb) =>
    isReady(eb.nextAttemptAt),
  );
  const candidates = [...pending, ...errors].slice(0, BATCH_SIZE);
  if (candidates.length === 0) return;

  for (const eb of candidates) {
    // Resolver citizen_server_id si todavía está vacío
    let citizenServerId = eb.citizenServerId;
    if (!citizenServerId) {
      const cit = getPendingCitizen(eb.citizenLocalId);
      if (!cit?.serverId) {
        // El citizen no terminó de sincronizar → diferimos este EB.
        // No incrementamos retry porque no es un fallo de la EB en sí.
        continue;
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
    emit({ type: 'item-done', id: eb.localId, result });
  }
}

async function processDeliveries(totals: BatchTotals): Promise<void> {
  // Tomar pending + error con backoff vencido
  const pending = listDeliveriesByStatus('pending');
  const errors = listDeliveriesByStatus('error').filter((d) =>
    isReady(d.nextAttemptAt),
  );
  const queue: PendingDelivery[] = [...pending, ...errors].slice(0, BATCH_SIZE);
  if (queue.length === 0) return;

  for (const item of queue) {
    // Si la delivery referencia un citizen local, debemos resolver el
    // serverId antes de subir. Si el citizen aún no se sincronizó, dejamos
    // la delivery pending (no la marcamos error; volverá a aparecer en el
    // próximo batch tras procesar citizens).
    let citizenServerId: string | undefined;
    if (isLocalCitizen(item.citizenId)) {
      const cit = getPendingCitizen(item.citizenId);
      if (!cit?.serverId) {
        continue; // diferida — no incrementar retry
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
    emit({ type: 'item-done', id: item.id, result });
  }
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
  }
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
