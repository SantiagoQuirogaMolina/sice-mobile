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

    -- Sprint 9.4: ciudadanos creados offline (excepciones).
    -- Cuando el operador registra una excepción sin red, creamos el
    -- ciudadano localmente con un local_id (UUID) y, al volver la red,
    -- se POSTea a /citizens. server_id queda con el UUID del backend.
    CREATE TABLE IF NOT EXISTS pending_citizens (
      local_id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      document_type TEXT NOT NULL,
      document_number TEXT NOT NULL,
      first_name TEXT NOT NULL,
      last_name TEXT NOT NULL,
      phone TEXT,
      email TEXT,
      tipo_zona TEXT,
      address TEXT,
      barrio TEXT,
      vereda TEXT,
      sector_rural TEXT,
      sync_status TEXT NOT NULL DEFAULT 'pending',
      retry_count INTEGER NOT NULL DEFAULT 0,
      last_error TEXT,
      next_attempt_at TEXT,
      last_attempt_at TEXT,
      server_id TEXT,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_pending_citizens_status
      ON pending_citizens(sync_status);

    -- EventBeneficiary creados offline. Apuntan al pending_citizen.local_id
    -- antes de que el citizen tenga server_id; tras sync se actualiza
    -- citizen_server_id y se POSTea /events/:id/beneficiaries.
    CREATE TABLE IF NOT EXISTS pending_event_beneficiaries (
      local_id TEXT PRIMARY KEY,
      event_id TEXT NOT NULL,
      citizen_local_id TEXT NOT NULL,
      citizen_server_id TEXT,
      sector_id TEXT,
      source TEXT NOT NULL DEFAULT 'exception',
      justification TEXT,
      sync_status TEXT NOT NULL DEFAULT 'pending',
      retry_count INTEGER NOT NULL DEFAULT 0,
      last_error TEXT,
      next_attempt_at TEXT,
      last_attempt_at TEXT,
      server_id TEXT,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_pending_eb_status
      ON pending_event_beneficiaries(sync_status);
    CREATE INDEX IF NOT EXISTS idx_pending_eb_event
      ON pending_event_beneficiaries(event_id);
    CREATE INDEX IF NOT EXISTS idx_pending_eb_citizen
      ON pending_event_beneficiaries(citizen_local_id);
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

    // 2. Borrar los que ya no están — PERO preservar los que son
    // pending_citizens locales (aún no sincronizados con backend).
    // Sin esta defensa, refrescar la lista borraba los registros que
    // el operador acababa de capturar offline (síntoma: 'al ingresar
    // me eliminó los registros del evento').
    const newCitizenIds = new Set(items.map((b) => b.citizenId));
    const pendingLocalIds = db
      .getAllSync<{ local_id: string }>(`SELECT local_id FROM pending_citizens`)
      .map((r) => r.local_id);
    const pendingSet = new Set(pendingLocalIds);
    for (const row of existing) {
      if (newCitizenIds.has(row.citizen_id)) continue;
      if (pendingSet.has(row.citizen_id)) continue; // todavía en cola, NO borrar
      db.runSync(
        `DELETE FROM cached_beneficiaries WHERE event_id = ? AND citizen_id = ?`,
        [eventId, row.citizen_id],
      );
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
    db.runSync(`DELETE FROM pending_event_beneficiaries WHERE event_id = ?`, [
      eventId,
    ]);
  });
}

/* ─────────────────────────── Sprint 9.4: Pending citizens ─────────────────────────── */

export interface PendingCitizen {
  localId: string;
  tenantId: string;
  documentType: DocumentType;
  documentNumber: string;
  firstName: string;
  lastName: string;
  phone: string | null;
  email: string | null;
  tipoZona: ZonaType | null;
  address: string | null;
  barrio: string | null;
  vereda: string | null;
  sectorRural: string | null;
  syncStatus: SyncStatus;
  retryCount: number;
  lastError: string | null;
  nextAttemptAt: string | null;
  lastAttemptAt: string | null;
  serverId: string | null;
  createdAt: string;
}

export function savePendingCitizen(c: PendingCitizen): void {
  const db = getDB();
  db.runSync(
    `INSERT OR REPLACE INTO pending_citizens
       (local_id, tenant_id, document_type, document_number, first_name,
        last_name, phone, email, tipo_zona, address, barrio, vereda,
        sector_rural, sync_status, retry_count, last_error, next_attempt_at,
        last_attempt_at, server_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      c.localId,
      c.tenantId,
      c.documentType,
      c.documentNumber,
      c.firstName,
      c.lastName,
      c.phone,
      c.email,
      c.tipoZona,
      c.address,
      c.barrio,
      c.vereda,
      c.sectorRural,
      c.syncStatus,
      c.retryCount,
      c.lastError,
      c.nextAttemptAt,
      c.lastAttemptAt,
      c.serverId,
      c.createdAt,
    ],
  );
}

export function getPendingCitizen(localId: string): PendingCitizen | null {
  const db = getDB();
  const row = db.getFirstSync<Record<string, unknown>>(
    `SELECT * FROM pending_citizens WHERE local_id = ?`,
    [localId],
  );
  return row ? rowToPendingCitizen(row) : null;
}

export function listPendingCitizensByStatus(
  status: SyncStatus,
): PendingCitizen[] {
  const db = getDB();
  const rows = db.getAllSync<Record<string, unknown>>(
    `SELECT * FROM pending_citizens WHERE sync_status = ? ORDER BY created_at ASC`,
    [status],
  );
  return rows.map(rowToPendingCitizen);
}

export function updatePendingCitizenStatus(
  localId: string,
  status: SyncStatus,
  patch?: {
    serverId?: string | null;
    lastError?: string | null;
    nextAttemptAt?: string | null;
    incrementRetry?: boolean;
  },
): void {
  const db = getDB();
  const fragments: string[] = [`sync_status = ?`];
  const args: (string | number | null)[] = [status];
  fragments.push(`last_attempt_at = ?`);
  args.push(new Date().toISOString());
  if (patch?.serverId !== undefined) {
    fragments.push(`server_id = ?`);
    args.push(patch.serverId);
  }
  if (patch?.lastError !== undefined) {
    fragments.push(`last_error = ?`);
    args.push(patch.lastError);
  }
  if (patch?.nextAttemptAt !== undefined) {
    fragments.push(`next_attempt_at = ?`);
    args.push(patch.nextAttemptAt);
  }
  if (patch?.incrementRetry) {
    fragments.push(`retry_count = retry_count + 1`);
  }
  args.push(localId);
  db.runSync(
    `UPDATE pending_citizens SET ${fragments.join(', ')} WHERE local_id = ?`,
    args,
  );
}

function rowToPendingCitizen(row: Record<string, unknown>): PendingCitizen {
  return {
    localId: row.local_id as string,
    tenantId: row.tenant_id as string,
    documentType: row.document_type as DocumentType,
    documentNumber: row.document_number as string,
    firstName: row.first_name as string,
    lastName: row.last_name as string,
    phone: (row.phone as string | null) ?? null,
    email: (row.email as string | null) ?? null,
    tipoZona: (row.tipo_zona as ZonaType | null) ?? null,
    address: (row.address as string | null) ?? null,
    barrio: (row.barrio as string | null) ?? null,
    vereda: (row.vereda as string | null) ?? null,
    sectorRural: (row.sector_rural as string | null) ?? null,
    syncStatus: row.sync_status as SyncStatus,
    retryCount: (row.retry_count as number) ?? 0,
    lastError: (row.last_error as string | null) ?? null,
    nextAttemptAt: (row.next_attempt_at as string | null) ?? null,
    lastAttemptAt: (row.last_attempt_at as string | null) ?? null,
    serverId: (row.server_id as string | null) ?? null,
    createdAt: row.created_at as string,
  };
}

/* ─────────────────────────── Sprint 9.4: Pending event beneficiaries ─────────────────────────── */

export interface PendingEventBeneficiary {
  localId: string;
  eventId: string;
  citizenLocalId: string; // FK a pending_citizens.local_id
  citizenServerId: string | null; // se llena tras sync del citizen
  sectorId: string | null;
  source: 'exception' | 'ad_hoc';
  justification: string | null;
  syncStatus: SyncStatus;
  retryCount: number;
  lastError: string | null;
  nextAttemptAt: string | null;
  lastAttemptAt: string | null;
  serverId: string | null;
  createdAt: string;
}

export function savePendingEventBeneficiary(eb: PendingEventBeneficiary): void {
  const db = getDB();
  db.runSync(
    `INSERT OR REPLACE INTO pending_event_beneficiaries
       (local_id, event_id, citizen_local_id, citizen_server_id, sector_id,
        source, justification, sync_status, retry_count, last_error,
        next_attempt_at, last_attempt_at, server_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      eb.localId,
      eb.eventId,
      eb.citizenLocalId,
      eb.citizenServerId,
      eb.sectorId,
      eb.source,
      eb.justification,
      eb.syncStatus,
      eb.retryCount,
      eb.lastError,
      eb.nextAttemptAt,
      eb.lastAttemptAt,
      eb.serverId,
      eb.createdAt,
    ],
  );
}

export function getPendingEbByCitizen(
  eventId: string,
  citizenLocalId: string,
): PendingEventBeneficiary | null {
  const db = getDB();
  const row = db.getFirstSync<Record<string, unknown>>(
    `SELECT * FROM pending_event_beneficiaries
       WHERE event_id = ? AND citizen_local_id = ?`,
    [eventId, citizenLocalId],
  );
  return row ? rowToPendingEb(row) : null;
}

export function listPendingEbsByStatus(
  status: SyncStatus,
): PendingEventBeneficiary[] {
  const db = getDB();
  const rows = db.getAllSync<Record<string, unknown>>(
    `SELECT * FROM pending_event_beneficiaries
       WHERE sync_status = ? ORDER BY created_at ASC`,
    [status],
  );
  return rows.map(rowToPendingEb);
}

export function updatePendingEbStatus(
  localId: string,
  status: SyncStatus,
  patch?: {
    citizenServerId?: string | null;
    serverId?: string | null;
    lastError?: string | null;
    nextAttemptAt?: string | null;
    incrementRetry?: boolean;
  },
): void {
  const db = getDB();
  const fragments: string[] = [`sync_status = ?`];
  const args: (string | number | null)[] = [status];
  fragments.push(`last_attempt_at = ?`);
  args.push(new Date().toISOString());
  if (patch?.citizenServerId !== undefined) {
    fragments.push(`citizen_server_id = ?`);
    args.push(patch.citizenServerId);
  }
  if (patch?.serverId !== undefined) {
    fragments.push(`server_id = ?`);
    args.push(patch.serverId);
  }
  if (patch?.lastError !== undefined) {
    fragments.push(`last_error = ?`);
    args.push(patch.lastError);
  }
  if (patch?.nextAttemptAt !== undefined) {
    fragments.push(`next_attempt_at = ?`);
    args.push(patch.nextAttemptAt);
  }
  if (patch?.incrementRetry) {
    fragments.push(`retry_count = retry_count + 1`);
  }
  args.push(localId);
  db.runSync(
    `UPDATE pending_event_beneficiaries SET ${fragments.join(', ')}
       WHERE local_id = ?`,
    args,
  );
}

function rowToPendingEb(row: Record<string, unknown>): PendingEventBeneficiary {
  return {
    localId: row.local_id as string,
    eventId: row.event_id as string,
    citizenLocalId: row.citizen_local_id as string,
    citizenServerId: (row.citizen_server_id as string | null) ?? null,
    sectorId: (row.sector_id as string | null) ?? null,
    source: row.source as 'exception' | 'ad_hoc',
    justification: (row.justification as string | null) ?? null,
    syncStatus: row.sync_status as SyncStatus,
    retryCount: (row.retry_count as number) ?? 0,
    lastError: (row.last_error as string | null) ?? null,
    nextAttemptAt: (row.next_attempt_at as string | null) ?? null,
    lastAttemptAt: (row.last_attempt_at as string | null) ?? null,
    serverId: (row.server_id as string | null) ?? null,
    createdAt: row.created_at as string,
  };
}

/**
 * Helper para registrar una excepción offline en una sola transacción:
 *   1. Guarda pending_citizen
 *   2. Guarda pending_event_beneficiary
 *   3. Inserta cached_beneficiary para que aparezca en la lista del operador
 *      con citizenId = pending_citizen.localId
 *
 * Devuelve los local IDs para que el wizard navegue al delivery con
 * citizenId = citizenLocalId.
 */
export function registerExceptionOffline(input: {
  tenantId: string;
  eventId: string;
  documentType: DocumentType;
  documentNumber: string;
  firstName: string;
  lastName: string;
  phone?: string;
  email?: string;
  sectorId?: string | null;
  sectorName?: string | null;
  zona?: ZonaType | null;
  /** Justificación del registro:
   *  - 'exception' (Tipo A) → REQUIRED, mínimo 20 chars (validado en UI)
   *  - 'ad_hoc' (Tipo B / asistencia ad-hoc) → opcional/null
   */
  justification: string;
  /** Source del beneficiario.
   *  - 'exception': captura excepcional fuera de la lista pre-cargada (Tipo A).
   *  - 'ad_hoc': registro nuevo en evento Tipo B (sin lista previa).
   *  Default 'exception' por compatibilidad con código previo.
   */
  source?: 'exception' | 'ad_hoc';
}): { citizenLocalId: string; ebLocalId: string } {
  const db = getDB();
  const citizenLocalId = newOfflineId();
  const ebLocalId = newOfflineId();
  const now = new Date().toISOString();
  const docNorm = normalizeDocument(input.documentNumber);
  const fullName = `${input.firstName.trim()} ${input.lastName.trim()}`.trim();

  db.withTransactionSync(() => {
    // 1) pending_citizen
    const barrio =
      input.zona === 'urbana' ? input.sectorName ?? null : null;
    const vereda =
      input.zona === 'rural' ? input.sectorName ?? null : null;
    db.runSync(
      `INSERT INTO pending_citizens
         (local_id, tenant_id, document_type, document_number, first_name,
          last_name, phone, email, tipo_zona, address, barrio, vereda,
          sector_rural, sync_status, retry_count, last_error, next_attempt_at,
          last_attempt_at, server_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', 0, NULL, NULL,
               NULL, NULL, ?)`,
      [
        citizenLocalId,
        input.tenantId,
        input.documentType,
        input.documentNumber,
        input.firstName.trim(),
        input.lastName.trim(),
        input.phone?.trim() || null,
        input.email?.trim().toLowerCase() || null,
        input.zona ?? null,
        null,
        barrio,
        vereda,
        null,
        now,
      ],
    );

    // 2) pending_event_beneficiary
    const source = input.source ?? 'exception';
    db.runSync(
      `INSERT INTO pending_event_beneficiaries
         (local_id, event_id, citizen_local_id, citizen_server_id, sector_id,
          source, justification, sync_status, retry_count, last_error,
          next_attempt_at, last_attempt_at, server_id, created_at)
       VALUES (?, ?, ?, NULL, ?, ?, ?, 'pending', 0, NULL, NULL,
               NULL, NULL, ?)`,
      [
        ebLocalId,
        input.eventId,
        citizenLocalId,
        input.sectorId ?? null,
        source,
        source === 'ad_hoc' ? null : input.justification,
        now,
      ],
    );

    // 3) cached_beneficiary para que aparezca en la lista del operador
    db.runSync(
      `INSERT OR REPLACE INTO cached_beneficiaries
         (id, event_id, citizen_id, document_type, document_number,
          document_normalized, full_name, name_normalized, sector_id,
          sector_name, zona, delivery_status, has_local_delivery)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', 0)`,
      [
        ebLocalId,
        input.eventId,
        citizenLocalId,
        input.documentType,
        input.documentNumber,
        docNorm,
        fullName,
        normalizeName(fullName),
        input.sectorId ?? null,
        input.sectorName ?? null,
        input.zona ?? null,
      ],
    );
  });

  return { citizenLocalId, ebLocalId };
}

/**
 * Sprint 9.6: descarta una excepción bloqueada/error que el operador no
 * va a poder resolver desde mobile (típico: backend rechazó por validación
 * que no podemos enmendar en cliente). Borra:
 *   - pending_citizen + pending_event_beneficiary
 *   - cached_beneficiary creado para esa excepción
 *   - pending_deliveries asociadas a ese citizen local (si las hay)
 *
 * No toca el backend. Si el citizen alcanzó a sincronizar, queda allá
 * como huérfano (sin EB) — el coordinador puede limpiarlo desde web.
 */
export function purgePendingException(citizenLocalId: string): void {
  const db = getDB();
  db.withTransactionSync(() => {
    // pending_event_beneficiaries asociado a este citizen local
    const ebs = db.getAllSync<{ local_id: string; event_id: string }>(
      `SELECT local_id, event_id FROM pending_event_beneficiaries
         WHERE citizen_local_id = ?`,
      [citizenLocalId],
    );
    for (const eb of ebs) {
      db.runSync(
        `DELETE FROM cached_beneficiaries WHERE id = ?`,
        [eb.local_id],
      );
    }
    db.runSync(
      `DELETE FROM pending_event_beneficiaries WHERE citizen_local_id = ?`,
      [citizenLocalId],
    );
    db.runSync(
      `DELETE FROM pending_deliveries WHERE citizen_id = ?`,
      [citizenLocalId],
    );
    db.runSync(`DELETE FROM pending_citizens WHERE local_id = ?`, [
      citizenLocalId,
    ]);
  });
}

/**
 * Lista todos los pending_citizens en estado bloqueado o error junto con
 * info derivada (lastError de la EB asociada, si aplica). Útil para
 * mostrar en UI los problemas de excepciones que requieren acción del
 * operador.
 */
export interface BlockedExceptionInfo {
  citizenLocalId: string;
  fullName: string;
  documentType: DocumentType;
  documentNumber: string;
  citizenStatus: SyncStatus;
  citizenError: string | null;
  ebStatus: SyncStatus | null;
  ebError: string | null;
  eventId: string | null;
}

export function listBlockedExceptions(): BlockedExceptionInfo[] {
  const db = getDB();
  const rows = db.getAllSync<Record<string, unknown>>(
    `SELECT
        pc.local_id              AS citizen_local_id,
        pc.first_name            AS first_name,
        pc.last_name             AS last_name,
        pc.document_type         AS document_type,
        pc.document_number       AS document_number,
        pc.sync_status           AS citizen_status,
        pc.last_error            AS citizen_error,
        eb.sync_status           AS eb_status,
        eb.last_error            AS eb_error,
        eb.event_id              AS event_id
      FROM pending_citizens pc
      LEFT JOIN pending_event_beneficiaries eb
        ON eb.citizen_local_id = pc.local_id
      WHERE pc.sync_status IN ('blocked', 'error')
         OR eb.sync_status IN ('blocked', 'error')
      ORDER BY pc.created_at DESC`,
  );
  return rows.map((row) => ({
    citizenLocalId: row.citizen_local_id as string,
    fullName: `${row.first_name as string} ${row.last_name as string}`.trim(),
    documentType: row.document_type as DocumentType,
    documentNumber: row.document_number as string,
    citizenStatus: row.citizen_status as SyncStatus,
    citizenError: (row.citizen_error as string | null) ?? null,
    ebStatus: (row.eb_status as SyncStatus | null) ?? null,
    ebError: (row.eb_error as string | null) ?? null,
    eventId: (row.event_id as string | null) ?? null,
  }));
}

/** ¿Este citizenId es de un PendingCitizen offline (aún no en backend)? */
export function isLocalCitizen(citizenId: string): boolean {
  const db = getDB();
  const row = db.getFirstSync<{ c: number }>(
    `SELECT COUNT(*) as c FROM pending_citizens WHERE local_id = ?`,
    [citizenId],
  );
  return (row?.c ?? 0) > 0;
}
