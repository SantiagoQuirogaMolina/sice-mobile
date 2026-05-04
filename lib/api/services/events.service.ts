/**
 * Events service mobile — solo los eventos donde el operador está asignado.
 *
 * Reusa la misma API REST del backend que la web. La diferencia es que aquí
 * filtramos por el operador (gestor/asistente) automáticamente, ya que el
 * backend ya respeta el rol del JWT.
 */

import { api } from '../client';

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
    totalBeneficiaries: b.totalBeneficiaries,
    totalDelivered: b.totalDelivered,
  };
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

  async getById(id: string): Promise<EventSummary | null> {
    try {
      const data = await api.get<BackendEvent>(`/api/v1/events/${id}`);
      return mapEvent(data);
    } catch {
      return null;
    }
  },
};
