/**
 * Sync queue — procesa pending_deliveries → backend.
 *
 * Diseño:
 *   - Re-entrada protegida (mutex `inFlight`) para evitar 2 procesos paralelos
 *     si el operador toca "Sincronizar" mientras ya está corriendo.
 *   - Batch de 10 (no de 50 como web): mobile tiene foto+firma grandes,
 *     batches grandes saturan red móvil flaky.
 *   - Backoff exponencial: 30s, 1m, 2m, 4m, 8m... cap 30min.
 *   - Errores 4xx no-retryables → markDeliveryBlocked (operador decide).
 *   - 5xx y network → markDeliveryError con nextAttemptAt.
 *   - Conflict 409 → markDeliveryBlocked con flag conflict.
 *
 * Subscripción:
 *   - subscribeQueueEvents(cb) para que la UI se entere del progreso.
 */

import {
  countPendingSync,
  listDeliveriesByStatus,
  markDeliveryBlocked,
  markDeliveryError,
  markDeliverySynced,
  setDeliverySyncStatus,
  type PendingDelivery,
} from '../offline/db';
import { uploadDelivery, type SyncResult } from './transport';

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

/**
 * Toma un batch de pending+error y los procesa. No bloqueante: vuelve apenas
 * el último item del batch terminó.
 */
export async function processSyncQueue(): Promise<{
  processed: number;
  ok: number;
  failed: number;
  blocked: number;
}> {
  if (inFlight) {
    return { processed: 0, ok: 0, failed: 0, blocked: 0 };
  }
  inFlight = true;

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

    // 1) Tomar pending + error con backoff vencido
    const pending = listDeliveriesByStatus('pending');
    const errors = listDeliveriesByStatus('error').filter((d) =>
      isReady(d.nextAttemptAt),
    );
    const queue: PendingDelivery[] = [...pending, ...errors].slice(0, BATCH_SIZE);

    if (queue.length === 0) {
      return { processed: 0, ok: 0, failed: 0, blocked: 0 };
    }

    emit({ type: 'batch-start', total: queue.length });

    let ok = 0;
    let failed = 0;
    let blocked = 0;

    for (const item of queue) {
      // Marca syncing antes de subir → UI lo refleja
      setDeliverySyncStatus(item.id, 'syncing', {
        lastAttemptAt: new Date().toISOString(),
      });
      emit({ type: 'item-start', id: item.id });

      const result = await uploadDelivery(item);

      if (result.kind === 'ok') {
        markDeliverySynced(item.id, result.serverId);
        ok += 1;
      } else if (result.kind === 'conflict') {
        // Conflicto: el backend dice que ya existe. Lo marcamos blocked
        // con la razón. El operador puede revisar desde la pantalla de sync.
        markDeliveryBlocked(item.id, `Conflicto: ${result.reason}`);
        blocked += 1;
      } else if (!result.retryable) {
        // 4xx con código semántico (event no capturable, citizen no existe, etc).
        // No reintentar automático.
        markDeliveryBlocked(item.id, result.message);
        blocked += 1;
        failed += 1;
      } else {
        // 5xx o network → backoff y reintentar después.
        const next = nextBackoffISO(item.retryCount);
        markDeliveryError(item.id, result.message, next);
        failed += 1;
      }

      emit({ type: 'item-done', id: item.id, result });
    }

    emit({
      type: 'batch-end',
      processed: queue.length,
      ok,
      failed,
      blocked,
    });
    return { processed: queue.length, ok, failed, blocked };
  } finally {
    inFlight = false;
  }
}

export function getPendingCount(): number {
  return countPendingSync();
}

export function isSyncInFlight(): boolean {
  return inFlight;
}
