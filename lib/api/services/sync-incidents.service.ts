/**
 * Sync Incidents — el operador de campo reporta una captura que el backend
 * rechazó y quedó "blocked" en su dispositivo, para que el coordinador tenga
 * visibilidad (la evidencia que no pudo subir, con su motivo).
 *
 * Best-effort: el reporte NO debe romper la cola de sync. El backend es
 * idempotente por (tenant, deviceLocalId) — un re-reporte del mismo registro
 * no duplica.
 */
import { api } from '../client';

export type SyncIncidentKind =
  | 'duplicate_delivery'
  | 'duplicate_citizen'
  | 'validation'
  | 'rejected';

export interface ReportSyncIncidentInput {
  eventId: string;
  sectorId?: string;
  documentType?: string;
  documentNumber?: string;
  citizenName?: string;
  kind: SyncIncidentKind;
  code?: string;
  reason: string;
  deviceLocalId: string;
  occurredAt?: string;
}

export async function reportSyncIncident(
  input: ReportSyncIncidentInput,
): Promise<void> {
  await api.post('/api/v1/sync-incidents', input);
}
