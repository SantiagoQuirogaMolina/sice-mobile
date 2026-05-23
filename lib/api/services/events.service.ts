/**
 * Events service mobile — solo los eventos donde el operador está asignado.
 *
 * Reusa la misma API REST del backend que la web. La diferencia es que aquí
 * filtramos por el operador (gestor/asistente) automáticamente, ya que el
 * backend ya respeta el rol del JWT.
 */

import { api, ApiError } from '../client';
import {
  saveCachedEvent,
  getCachedEvent,
  type CachedEvent,
} from '../../offline/db';

export interface EventSummary {
  id: string;
  tenantId: string;
  name: string;
  type: 'A' | 'B';
  status: 'draft' | 'active' | 'paused' | 'completed' | 'archived';
  description: string | null;
  startDate: string;
  endDate: string;
  departamento: string;
  municipio: string;
  allowExceptions: boolean;
  allowQrSelfRegister: boolean;
  requireSignature: boolean;
  requirePhoto: boolean;
  requireGps: boolean;
  totalBeneficiaries: number;
  totalDelivered: number;
}

interface BackendEvent {
  id: string;
  tenantId: string;
  type: 'A' | 'B';
  status: EventSummary['status'];
  name: string;
  description: string | null;
  startDate: string;
  endDate: string;
  departamento: string;
  municipio: string;
  allowExceptions: boolean;
  allowQrSelfRegister: boolean;
  requireSignature?: boolean;
  requirePhoto?: boolean;
  requireGps?: boolean;
  totalBeneficiaries: number;
  totalDelivered: number;
}

function mapEvent(b: BackendEvent): EventSummary {
  return {
    id: b.id,
    tenantId: b.tenantId,
    name: b.name,
    type: b.type,
    status: b.status,
    description: b.description,
    startDate: b.startDate,
    endDate: b.endDate,
    departamento: b.departamento,
    municipio: b.municipio,
    allowExceptions: b.allowExceptions,
    allowQrSelfRegister: b.allowQrSelfRegister,
    // Default true si el backend no los envía (compat) → mismo default del schema.
    requireSignature: b.requireSignature ?? true,
    requirePhoto: b.requirePhoto ?? true,
    requireGps: b.requireGps ?? true,
    totalBeneficiaries: b.totalBeneficiaries,
    totalDelivered: b.totalDelivered,
  };
}

export interface SectorInfo {
  id: string;
  name: string;
  zona: 'urbana' | 'rural';
  beneficiaryCount: number;
  gestorIds: string[];
}

interface BackendSector {
  id: string;
  eventId: string;
  name: string;
  zona: 'urbana' | 'rural';
  beneficiaryCount: number;
  gestorIds?: string[];
  gestorId?: string | null;
}

export const eventsService = {
  /**
   * Lista los eventos donde el operador (gestor/asistente) está asignado.
   * El backend filtra automáticamente por caller.role en events.service.list.
   */
  async listForMe(): Promise<EventSummary[]> {
    const items = await api.get<BackendEvent[]>('/api/v1/events?limit=50');
    return items.map(mapEvent);
  },

  /**
   * Sprint 9.1: getById offline-first.
   *   - Try network. Si OK, persiste al cache local y devuelve.
   *   - Si network falla, lee del cache.
   */
  async getById(id: string): Promise<EventSummary | null> {
    try {
      const data = await api.get<BackendEvent>(`/api/v1/events/${id}`);
      const summary = mapEvent(data);
      // Persistir al cache local para que offline funcione
      saveCachedEvent(toCached(summary, null));
      return summary;
    } catch (err) {
      // Si no hay red, fallback al cache
      if (err instanceof ApiError && err.code === 'NETWORK_ERROR') {
        const cached = getCachedEvent(id);
        return cached ? fromCached(cached) : null;
      }
      return null;
    }
  },

  async listSectors(eventId: string): Promise<SectorInfo[]> {
    const items = await api.get<BackendSector[]>(
      `/api/v1/events/${eventId}/sectors`,
    );
    return items.map((s) => ({
      id: s.id,
      name: s.name,
      zona: s.zona,
      beneficiaryCount: s.beneficiaryCount ?? 0,
      gestorIds: s.gestorIds ?? (s.gestorId ? [s.gestorId] : []),
    }));
  },
};

function toCached(s: EventSummary, sectorsJson: string | null): CachedEvent {
  return {
    id: s.id,
    tenantId: s.tenantId,
    name: s.name,
    type: s.type,
    status: s.status,
    description: s.description,
    startDate: s.startDate,
    endDate: s.endDate,
    departamento: s.departamento,
    municipio: s.municipio,
    allowExceptions: s.allowExceptions,
    allowQrSelfRegister: s.allowQrSelfRegister,
    requireSignature: s.requireSignature,
    requirePhoto: s.requirePhoto,
    requireGps: s.requireGps,
    totalBeneficiaries: s.totalBeneficiaries,
    totalDelivered: s.totalDelivered,
    sectorsJson,
    lastSyncAt: new Date().toISOString(),
  };
}

function fromCached(c: CachedEvent): EventSummary {
  return {
    id: c.id,
    tenantId: c.tenantId,
    name: c.name,
    type: c.type,
    status: c.status,
    description: c.description,
    startDate: c.startDate,
    endDate: c.endDate,
    departamento: c.departamento ?? '',
    municipio: c.municipio ?? '',
    allowExceptions: c.allowExceptions,
    allowQrSelfRegister: c.allowQrSelfRegister,
    requireSignature: c.requireSignature,
    requirePhoto: c.requirePhoto,
    requireGps: c.requireGps,
    totalBeneficiaries: c.totalBeneficiaries,
    totalDelivered: c.totalDelivered,
  };
}
