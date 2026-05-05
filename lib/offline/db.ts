/**
 * SICE Mobile — SQLite local storage.
 *
 * Replaces IndexedDB de la web con SQLite real. Beneficios sobre IndexedDB:
 *   - Verdaderamente transaccional (ACID)
 *   - Sobrevive reinicios de la app, swipe-to-close, OS kills
 *   - Queries con índices eficientes (búsqueda por documento <10ms)
 *   - No se evapora con la quota del browser
 *   - Sincrónica (no race conditions complejas)
 */

import * as SQLite from 'expo-sqlite';

// Singleton de la conexión
let dbInstance: SQLite.SQLiteDatabase | null = null;

const DB_NAME = 'sice-mobile.db';

/**
 * Abre la BD (idempotente). La crea si no existe + ejecuta migraciones.
 */
export function getDB(): SQLite.SQLiteDatabase {
  if (dbInstance) return dbInstance;
  dbInstance = SQLite.openDatabaseSync(DB_NAME);
  initSchema(dbInstance);
  return dbInstance;
}

/**
 * Schema completo. Idempotente — usa CREATE IF NOT EXISTS.
 *
 * Sprint 9.1 schema (esto crece con sprints siguientes):
 *   - cached_events:        snapshot de eventos descargados
 *   - cached_beneficiaries: lista de beneficiarios por evento (búsqueda local)
 *   - pending_deliveries:   cola de capturas para subir al backend
 *
 * Versionado: si en el futuro hay que cambiar el schema (Sprint 9.X),
 * agregamos ALTER TABLE en una rutina de migración separada.
 */
function initSchema(db: SQLite.SQLiteDatabase): void {
  db.execSync(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS cached_events (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      status TEXT NOT NULL,
      description TEXT,
      start_date TEXT NOT NULL,
      end_date TEXT NOT NULL,
      departamento TEXT,
      municipio TEXT,
      allow_exceptions INTEGER NOT NULL DEFAULT 0,
      allow_qr_self_register INTEGER NOT NULL DEFAULT 0,
      total_beneficiaries INTEGER NOT NULL DEFAULT 0,
      total_delivered INTEGER NOT NULL DEFAULT 0,
      sectors_json TEXT,
      last_sync_at TEXT
    );

    CREATE TABLE IF NOT EXISTS cached_beneficiaries (
      id TEXT PRIMARY KEY,
      event_id TEXT NOT NULL,
      citizen_id TEXT NOT NULL,
      document_type TEXT NOT NULL,
      document_number TEXT NOT NULL,
      document_normalized TEXT NOT NULL,
      full_name TEXT NOT NULL,
      name_normalized TEXT NOT NULL,
      sector_id TEXT,
      sector_name TEXT,
      zona TEXT,
      delivery_status TEXT NOT NULL DEFAULT 'pending',
      has_local_delivery INTEGER NOT NULL DEFAULT 0
    );

    CREATE INDEX IF NOT EXISTS idx_benef_event
      ON cached_beneficiaries(event_id);

    CREATE INDEX IF NOT EXISTS idx_benef_event_doc
      ON cached_beneficiaries(event_id, document_normalized);

    CREATE INDEX IF NOT EXISTS idx_benef_event_name
      ON cached_beneficiaries(event_id, name_normalized);

    CREATE TABLE IF NOT EXISTS pending_deliveries (
      id TEXT PRIMARY KEY,
      event_id TEXT NOT NULL,
      citizen_id TEXT NOT NULL,
      gestor_id TEXT NOT NULL,
      signature_data_url TEXT,
      signature_sha256 TEXT,
      photo_data_url TEXT,
      photo_sha256 TEXT,
      photo_size_kb INTEGER,
      gps_lat REAL,
      gps_lon REAL,
      gps_accuracy REAL,
      gps_status TEXT NOT NULL DEFAULT 'ok',
      custom_form_data TEXT,
      sync_status TEXT NOT NULL DEFAULT 'pending',
      retry_count INTEGER NOT NULL DEFAULT 0,
      next_attempt_at TEXT,
      last_attempt_at TEXT,
      last_error TEXT,
      captured_at TEXT NOT NULL,
      synced_at TEXT,
      server_id TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_pending_event
      ON pending_deliveries(event_id);

    CREATE INDEX IF NOT EXISTS idx_pending_status
      ON pending_deliveries(sync_status);

    CREATE INDEX IF NOT EXISTS idx_pending_citizen
      ON pending_deliveries(event_id, citizen_id);
  `);
}

/* ─────────────────────────── Tipos públicos ─────────────────────────── */

export type DocumentType = 'CC' | 'TI' | 'CE' | 'PA' | 'PPT';
export type ZonaType = 'urbana' | 'rural';
export type DeliveryStatus = 'pending' | 'delivered' | 'rejected';
export type SyncStatus =
  | 'pending'
  | 'syncing'
  | 'synced'
  | 'conflict'
  | 'error'
  | 'blocked';

export interface CachedEvent {
  id: string;
  tenantId: string;
  name: string;
  type: 'A' | 'B';
  status: 'draft' | 'active' | 'paused' | 'completed' | 'archived';
  description: string | null;
  startDate: string;
  endDate: string;
  departamento: string | null;
  municipio: string | null;
  allowExceptions: boolean;
  allowQrSelfRegister: boolean;
  totalBeneficiaries: number;
  totalDelivered: number;
  sectorsJson: string | null;
  lastSyncAt: string | null;
}

export interface CachedBeneficiary {
  id: string;
  eventId: string;
  citizenId: string;
  documentType: DocumentType;
  documentNumber: string;
  documentNormalized: string;
  fullName: string;
  nameNormalized: string;
  sectorId: string | null;
  sectorName: string | null;
  zona: ZonaType | null;
  deliveryStatus: DeliveryStatus;
  hasLocalDelivery: boolean;
}

export interface PendingDelivery {
  id: string;
  eventId: string;
  citizenId: string;
  gestorId: string;
  signatureDataUrl: string | null;
  signatureSha256: string | null;
  photoDataUrl: string | null;
  photoSha256: string | null;
  photoSizeKB: number | null;
  gpsLat: number | null;
  gpsLon: number | null;
  gpsAccuracy: number | null;
  gpsStatus: 'ok' | 'indeterminada';
  customFormData: Record<string, unknown> | null;
  syncStatus: SyncStatus;
  retryCount: number;
  nextAttemptAt: string | null;
  lastAttemptAt: string | null;
  lastError: string | null;
  capturedAt: string;
  syncedAt: string | null;
  serverId: string | null;
}

/* ─────────────────────────── Helpers internos ─────────────────────────── */

function bool(v: number | undefined | null): boolean {
  return v === 1;
}

export function normalizeDocument(raw: string): string {
  return raw.replace(/[\s.\-_]/g, '').toUpperCase();
}

export function normalizeName(raw: string): string {
  return raw
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim();
}

/* ─────────────────────────── Events API ─────────────────────────── */

export function saveCachedEvent(event: CachedEvent): void {
  const db = getDB();
  db.runSync(
    `INSERT OR REPLACE INTO cached_events
       (id, tenant_id, name, type, status, description, start_date, end_date,
        departamento, municipio, allow_exceptions, allow_qr_self_register,
        total_beneficiaries, total_delivered, sectors_json, last_sync_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      event.id,
      event.tenantId,
      event.name,
      event.type,
      event.status,
      event.description,
      event.startDate,
      event.endDate,
      event.departamento,
      event.municipio,
      event.allowExceptions ? 1 : 0,
      event.allowQrSelfRegister ? 1 : 0,
      event.totalBeneficiaries,
      event.totalDelivered,
      event.sectorsJson,
      event.lastSyncAt,
    ],
  );
}

export function getCachedEvent(id: string): CachedEvent | null {
  const db = getDB();
  const row = db.getFirstSync<Record<string, unknown>>(
    `SELECT * FROM cached_events WHERE id = ?`,
    [id],
  );
  if (!row) return null;
  return {
    id: row.id as string,
    tenantId: row.tenant_id as string,
    name: row.name as string,
    type: row.type as 'A' | 'B',
    status: row.status as CachedEvent['status'],
    description: (row.description as string | null) ?? null,
    startDate: row.start_date as string,
    endDate: row.end_date as string,
    departamento: (row.departamento as string | null) ?? null,
    municipio: (row.municipio as string | null) ?? null,
    allowExceptions: bool(row.allow_exceptions as number),
    allowQrSelfRegister: bool(row.allow_qr_self_register as number),
    totalBeneficiaries: row.total_beneficiaries as number,
    totalDelivered: row.total_delivered as number,
    sectorsJson: (row.sectors_json as string | null) ?? null,
    lastSyncAt: (row.last_sync_at as string | null) ?? null,
  };
}

export function listCachedEvents(): CachedEvent[] {
  const db = getDB();
  const rows = db.getAllSync<Record<string, unknown>>(
    `SELECT * FROM cached_events ORDER BY start_date DESC`,
  );
  return rows.map((row) => ({
    id: row.id as string,
    tenantId: row.tenant_id as string,
    name: row.name as string,
    type: row.type as 'A' | 'B',
    status: row.status as CachedEvent['status'],
    description: (row.description as string | null) ?? null,
    startDate: row.start_date as string,
    endDate: row.end_date as string,
    departamento: (row.departamento as string | null) ?? null,
    municipio: (row.municipio as string | null) ?? null,
    allowExceptions: bool(row.allow_exceptions as number),
    allowQrSelfRegister: bool(row.allow_qr_self_register as number),
    totalBeneficiaries: row.total_beneficiaries as number,
    totalDelivered: row.total_delivered as number,
    sectorsJson: (row.sectors_json as string | null) ?? null,
    lastSyncAt: (row.last_sync_at as string | null) ?? null,
  }));
}

/* ─────────────────────────── Beneficiaries API ─────────────────────────── */

/**
 * Replace de beneficiarios para un evento.
 *
 * Igual que en la web (Sprint 8.10): si items viene vacío, NO toca el cache
 * (asumimos network failure). Si trae datos, hace merge inteligente:
 *   - delete de los que ya no están en el set nuevo
 *   - upsert de los que sí están
 *   - preserva has_local_delivery del cache previo
 */
export function replaceBeneficiariesByEvent(
  eventId: string,
  items: CachedBeneficiary[],
): void {
  if (items.length === 0) return; // network failure → no tocar cache

  const db = getDB();
  db.withTransactionSync(() => {
    // 1. Recolectar has_local_delivery del cache viejo
    const existing = db.getAllSync<{ citizen_id: string; has_local_delivery: number }>(
      `SELECT citizen_id, has_local_delivery FROM cached_beneficiaries WHERE event_id = ?`,
      [eventId],
    );
    const localFlags = new Map<string, boolean>();
    for (const row of existing) {
      if (row.has_local_delivery) localFlags.set(row.citizen_id, true);
    }

    // 2. Borrar los que ya no están
    const newCitizenIds = new Set(items.map((b) => b.citizenId));
    for (const row of existing) {
      if (!newCitizenIds.has(row.citizen_id)) {
        db.runSync(
          `DELETE FROM cached_beneficiaries WHERE event_id = ? AND citizen_id = ?`,
          [eventId, row.citizen_id],
        );
      }
    }

    // 3. Upsert los del set nuevo
    for (const b of items) {
      const preserveLocal = localFlags.get(b.citizenId) || b.hasLocalDelivery;
      db.runSync(
        `INSERT OR REPLACE INTO cached_beneficiaries
           (id, event_id, citizen_id, document_type, document_number,
            document_normalized, full_name, name_normalized, sector_id,
            sector_name, zona, delivery_status, has_local_delivery)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          b.id,
          eventId,
          b.citizenId,
          b.documentType,
          b.documentNumber,
          b.documentNormalized,
          b.fullName,
          b.nameNormalized,
          b.sectorId,
          b.sectorName,
          b.zona,
          b.deliveryStatus,
          preserveLocal ? 1 : 0,
        ],
      );
    }
  });
}

export function listBeneficiariesByEvent(eventId: string): CachedBeneficiary[] {
  const db = getDB();
  const rows = db.getAllSync<Record<string, unknown>>(
    `SELECT * FROM cached_beneficiaries WHERE event_id = ? ORDER BY full_name ASC`,
    [eventId],
  );
  return rows.map(rowToBeneficiary);
}

/**
 * Búsqueda LIVE por documento o nombre.
 * Sublineal gracias al índice (event_id, document_normalized) y (event_id, name_normalized).
 * Para queries cortas (<3 chars) limitamos a 50 resultados.
 */
export function searchBeneficiaries(
  eventId: string,
  query: string,
  limit = 50,
): CachedBeneficiary[] {
  const db = getDB();
  const trimmed = query.trim();
  if (!trimmed) {
    return db
      .getAllSync<Record<string, unknown>>(
        `SELECT * FROM cached_beneficiaries WHERE event_id = ? ORDER BY full_name ASC LIMIT ?`,
        [eventId, limit],
      )
      .map(rowToBeneficiary);
  }

  const docNorm = normalizeDocument(trimmed);
  const nameNorm = normalizeName(trimmed);

  // Si parece documento (puro número) → buscar por documento
  // Si no → buscar por nombre con LIKE
  const looksLikeDoc = /^\d+$/.test(docNorm);
  const rows = looksLikeDoc
    ? db.getAllSync<Record<string, unknown>>(
        `SELECT * FROM cached_beneficiaries
           WHERE event_id = ? AND document_normalized LIKE ?
           ORDER BY document_normalized ASC LIMIT ?`,
        [eventId, `${docNorm}%`, limit],
      )
    : db.getAllSync<Record<string, unknown>>(
        `SELECT * FROM cached_beneficiaries
           WHERE event_id = ? AND name_normalized LIKE ?
           ORDER BY full_name ASC LIMIT ?`,
        [eventId, `%${nameNorm}%`, limit],
      );
  return rows.map(rowToBeneficiary);
}

export function findBeneficiaryByDoc(
  eventId: string,
  documentNumber: string,
): CachedBeneficiary | null {
  const db = getDB();
  const docNorm = normalizeDocument(documentNumber);
  const row = db.getFirstSync<Record<string, unknown>>(
    `SELECT * FROM cached_beneficiaries WHERE event_id = ? AND document_normalized = ?`,
    [eventId, docNorm],
  );
  return row ? rowToBeneficiary(row) : null;
}

export function findBeneficiaryByCitizen(
  eventId: string,
  citizenId: string,
): CachedBeneficiary | null {
  const db = getDB();
  const row = db.getFirstSync<Record<string, unknown>>(
    `SELECT * FROM cached_beneficiaries WHERE event_id = ? AND citizen_id = ?`,
    [eventId, citizenId],
  );
  return row ? rowToBeneficiary(row) : null;
}

export function markBeneficiaryDelivered(
  eventId: string,
  citizenId: string,
): void {
  const db = getDB();
  db.runSync(
    `UPDATE cached_beneficiaries
       SET delivery_status = 'delivered', has_local_delivery = 1
     WHERE event_id = ? AND citizen_id = ?`,
    [eventId, citizenId],
  );
}

function rowToBeneficiary(row: Record<string, unknown>): CachedBeneficiary {
  return {
    id: row.id as string,
    eventId: row.event_id as string,
    citizenId: row.citizen_id as string,
    documentType: row.document_type as DocumentType,
    documentNumber: row.document_number as string,
    documentNormalized: row.document_normalized as string,
    fullName: row.full_name as string,
    nameNormalized: row.name_normalized as string,
    sectorId: (row.sector_id as string | null) ?? null,
    sectorName: (row.sector_name as string | null) ?? null,
    zona: (row.zona as ZonaType | null) ?? null,
    deliveryStatus: row.delivery_status as DeliveryStatus,
    hasLocalDelivery: bool(row.has_local_delivery as number),
  };
}

/* ─────────────────────────── Counts / KPIs ─────────────────────────── */

export interface EventCounts {
  total: number;
  delivered: number;
  pending: number;
  hasLocalDelivery: number;
  pendingSync: number;
}

export function getEventCounts(eventId: string): EventCounts {
  const db = getDB();
  const benef = db.getFirstSync<{
    total: number;
    delivered: number;
    pending: number;
    has_local: number;
  }>(
    `SELECT
       COUNT(*) as total,
       SUM(CASE WHEN delivery_status = 'delivered' THEN 1 ELSE 0 END) as delivered,
       SUM(CASE WHEN delivery_status = 'pending' THEN 1 ELSE 0 END) as pending,
       SUM(has_local_delivery) as has_local
     FROM cached_beneficiaries
     WHERE event_id = ?`,
    [eventId],
  );

  const sync = db.getFirstSync<{ pending_sync: number }>(
    `SELECT
       SUM(CASE WHEN sync_status IN ('pending', 'error', 'blocked', 'syncing')
                THEN 1 ELSE 0 END) as pending_sync
     FROM pending_deliveries
     WHERE event_id = ?`,
    [eventId],
  );

  return {
    total: benef?.total ?? 0,
    delivered: benef?.delivered ?? 0,
    pending: benef?.pending ?? 0,
    hasLocalDelivery: benef?.has_local ?? 0,
    pendingSync: sync?.pending_sync ?? 0,
  };
}

/* ─────────────────────────── Pending deliveries (Sprint 9.2+) ─────────────────────────── */

/**
 * Inserta una captura nueva. También marca el beneficiario como delivered
 * en el cache para que la lista refleje el cambio inmediatamente.
 */
export function enqueueDelivery(d: PendingDelivery): void {
  const db = getDB();
  db.withTransactionSync(() => {
    db.runSync(
      `INSERT OR REPLACE INTO pending_deliveries
         (id, event_id, citizen_id, gestor_id, signature_data_url, signature_sha256,
          photo_data_url, photo_sha256, photo_size_kb, gps_lat, gps_lon,
          gps_accuracy, gps_status, custom_form_data, sync_status, retry_count,
          next_attempt_at, last_attempt_at, last_error, captured_at, synced_at,
          server_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        d.id,
        d.eventId,
        d.citizenId,
        d.gestorId,
        d.signatureDataUrl,
        d.signatureSha256,
        d.photoDataUrl,
        d.photoSha256,
        d.photoSizeKB,
        d.gpsLat,
        d.gpsLon,
        d.gpsAccuracy,
        d.gpsStatus,
        d.customFormData ? JSON.stringify(d.customFormData) : null,
        d.syncStatus,
        d.retryCount,
        d.nextAttemptAt,
        d.lastAttemptAt,
        d.lastError,
        d.capturedAt,
        d.syncedAt,
        d.serverId,
      ],
    );
    // Cascade: marcar beneficiary delivered en cache
    db.runSync(
      `UPDATE cached_beneficiaries
         SET delivery_status = 'delivered', has_local_delivery = 1
       WHERE event_id = ? AND citizen_id = ?`,
      [d.eventId, d.citizenId],
    );
  });
}

export function listDeliveriesByEvent(eventId: string): PendingDelivery[] {
  const db = getDB();
  const rows = db.getAllSync<Record<string, unknown>>(
    `SELECT * FROM pending_deliveries WHERE event_id = ? ORDER BY captured_at DESC`,
    [eventId],
  );
  return rows.map(rowToDelivery);
}

export function listDeliveriesByStatus(status: SyncStatus): PendingDelivery[] {
  const db = getDB();
  const rows = db.getAllSync<Record<string, unknown>>(
    `SELECT * FROM pending_deliveries WHERE sync_status = ? ORDER BY captured_at ASC`,
    [status],
  );
  return rows.map(rowToDelivery);
}

export function getPendingDelivery(id: string): PendingDelivery | null {
  const db = getDB();
  const row = db.getFirstSync<Record<string, unknown>>(
    `SELECT * FROM pending_deliveries WHERE id = ?`,
    [id],
  );
  return row ? rowToDelivery(row) : null;
}

export function setDeliverySyncStatus(
  id: string,
  status: SyncStatus,
  patch?: {
    lastAttemptAt?: string;
    nextAttemptAt?: string | null;
    lastError?: string | null;
    serverId?: string | null;
    syncedAt?: string | null;
    incrementRetry?: boolean;
  },
): void {
  const db = getDB();
  // Construimos SET dinámico para no pisar campos no provistos
  const fragments: string[] = [`sync_status = ?`];
  const args: (string | number | null)[] = [status];
  if (patch?.lastAttemptAt !== undefined) {
    fragments.push(`last_attempt_at = ?`);
    args.push(patch.lastAttemptAt);
  }
  if (patch?.nextAttemptAt !== undefined) {
    fragments.push(`next_attempt_at = ?`);
    args.push(patch.nextAttemptAt);
  }
  if (patch?.lastError !== undefined) {
    fragments.push(`last_error = ?`);
    args.push(patch.lastError);
  }
  if (patch?.serverId !== undefined) {
    fragments.push(`server_id = ?`);
    args.push(patch.serverId);
  }
  if (patch?.syncedAt !== undefined) {
    fragments.push(`synced_at = ?`);
    args.push(patch.syncedAt);
  }
  if (patch?.incrementRetry) {
    fragments.push(`retry_count = retry_count + 1`);
  }
  args.push(id);
  db.runSync(
    `UPDATE pending_deliveries SET ${fragments.join(', ')} WHERE id = ?`,
    args,
  );
}

export function markDeliverySynced(id: string, serverId: string): void {
  setDeliverySyncStatus(id, 'synced', {
    serverId,
    syncedAt: new Date().toISOString(),
    lastError: null,
    nextAttemptAt: null,
  });
}

export function markDeliveryError(
  id: string,
  message: string,
  nextAttemptAt: string | null,
): void {
  setDeliverySyncStatus(id, 'error', {
    lastError: message,
    nextAttemptAt,
    lastAttemptAt: new Date().toISOString(),
    incrementRetry: true,
  });
}

export function markDeliveryBlocked(id: string, message: string): void {
  setDeliverySyncStatus(id, 'blocked', {
    lastError: message,
    nextAttemptAt: null,
    lastAttemptAt: new Date().toISOString(),
    incrementRetry: true,
  });
}

export function unblockDelivery(id: string): void {
  setDeliverySyncStatus(id, 'pending', {
    lastError: null,
    nextAttemptAt: null,
  });
}

/** Cuántos deliveries tienen status="pending" o "error" listos para reintentar. */
export function countPendingSync(): number {
  const db = getDB();
  const row = db.getFirstSync<{ c: number }>(
    `SELECT COUNT(*) AS c FROM pending_deliveries
       WHERE sync_status IN ('pending', 'error')`,
  );
  return row?.c ?? 0;
}

function rowToDelivery(row: Record<string, unknown>): PendingDelivery {
  const customJson = row.custom_form_data as string | null;
  let customFormData: Record<string, unknown> | null = null;
  if (customJson) {
    try {
      customFormData = JSON.parse(customJson) as Record<string, unknown>;
    } catch {
      customFormData = null;
    }
  }
  return {
    id: row.id as string,
    eventId: row.event_id as string,
    citizenId: row.citizen_id as string,
    gestorId: row.gestor_id as string,
    signatureDataUrl: (row.signature_data_url as string | null) ?? null,
    signatureSha256: (row.signature_sha256 as string | null) ?? null,
    photoDataUrl: (row.photo_data_url as string | null) ?? null,
    photoSha256: (row.photo_sha256 as string | null) ?? null,
    photoSizeKB: (row.photo_size_kb as number | null) ?? null,
    gpsLat: (row.gps_lat as number | null) ?? null,
    gpsLon: (row.gps_lon as number | null) ?? null,
    gpsAccuracy: (row.gps_accuracy as number | null) ?? null,
    gpsStatus: row.gps_status as 'ok' | 'indeterminada',
    customFormData,
    syncStatus: row.sync_status as SyncStatus,
    retryCount: (row.retry_count as number) ?? 0,
    nextAttemptAt: (row.next_attempt_at as string | null) ?? null,
    lastAttemptAt: (row.last_attempt_at as string | null) ?? null,
    lastError: (row.last_error as string | null) ?? null,
    capturedAt: row.captured_at as string,
    syncedAt: (row.synced_at as string | null) ?? null,
    serverId: (row.server_id as string | null) ?? null,
  };
}

/* ─────────────────────────── Utilities ─────────────────────────── */

/** Genera un UUID v4. Lo usamos como id local de delivery (idempotency key). */
export function newOfflineId(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/** Borra todo el cache de un evento (al hacer "Borrar caché del evento"). */
export function purgeEvent(eventId: string): void {
  const db = getDB();
  db.withTransactionSync(() => {
    db.runSync(`DELETE FROM cached_events WHERE id = ?`, [eventId]);
    db.runSync(`DELETE FROM cached_beneficiaries WHERE event_id = ?`, [eventId]);
    db.runSync(`DELETE FROM pending_deliveries WHERE event_id = ?`, [eventId]);
  });
}
