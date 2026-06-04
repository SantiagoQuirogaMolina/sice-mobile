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

/**
 * Campo del formulario dinámico del evento (Tipo B). Mismo shape que la web
 * (`FormField` del form-builder), pero sin las props de edición del builder.
 * El coordinador lo arma en la web y se guarda en `Event.customForm.fields`.
 * En mobile lo renderiza `DynamicFormStep` durante la captura.
 */
export interface GestorFormField {
  id: string;
  type:
    | 'text'
    | 'textarea'
    | 'number'
    | 'date'
    | 'select'
    | 'radio'
    | 'checkbox'
    | 'phone'
    | 'photo'
    | 'gps'
    | 'file';
  label: string;
  name: string;
  required: boolean;
  placeholder?: string;
  helper?: string;
  options?: string[];
  multiple?: boolean;
  accept?: string;
  validation?: string;
}

/** Tipos válidos del campo — el backend puede traer algo fuera de la unión
 *  (schema viejo), en cuyo caso coercionamos a 'text'. */
const FORM_FIELD_TYPES: readonly GestorFormField['type'][] = [
  'text',
  'textarea',
  'number',
  'date',
  'select',
  'radio',
  'checkbox',
  'phone',
  'photo',
  'gps',
  'file',
];

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
  captureDomicilio: boolean;
  totalBeneficiaries: number;
  totalDelivered: number;
  /** Campos del formulario dinámico (Tipo B). Vacío en Tipo A o sin form. */
  customFormFields: GestorFormField[];
}

interface BackendFormField {
  id: string;
  type: string;
  label: string;
  name: string;
  required: boolean;
  placeholder?: string;
  helper?: string;
  options?: string[];
  multiple?: boolean;
  accept?: string;
  validation?: string;
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
  captureDomicilio?: boolean;
  totalBeneficiaries: number;
  totalDelivered: number;
  customForm?: { fields: BackendFormField[] } | null;
}

/** Mapea los campos del backend a `GestorFormField`, coercionando cualquier
 *  `type` fuera de la unión a 'text' (igual que la web en gestor-events). */
function mapFormFields(
  customForm: { fields: BackendFormField[] } | null | undefined,
): GestorFormField[] {
  const fields = customForm?.fields ?? [];
  return fields.map((f) => ({
    id: f.id,
    type: (
      FORM_FIELD_TYPES.includes(f.type as GestorFormField['type'])
        ? f.type
        : 'text'
    ) as GestorFormField['type'],
    label: f.label,
    name: f.name,
    required: f.required,
    placeholder: f.placeholder,
    helper: f.helper,
    options: f.options,
    multiple: f.multiple,
    accept: f.accept,
    validation: f.validation,
  }));
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
    captureDomicilio: b.captureDomicilio ?? false,
    totalBeneficiaries: b.totalBeneficiaries,
    totalDelivered: b.totalDelivered,
    customFormFields: mapFormFields(b.customForm),
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
    captureDomicilio: s.captureDomicilio,
    totalBeneficiaries: s.totalBeneficiaries,
    totalDelivered: s.totalDelivered,
    sectorsJson,
    customFormFieldsJson:
      s.customFormFields.length > 0 ? JSON.stringify(s.customFormFields) : null,
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
    captureDomicilio: c.captureDomicilio,
    totalBeneficiaries: c.totalBeneficiaries,
    totalDelivered: c.totalDelivered,
    customFormFields: parseCustomFormFields(c.customFormFieldsJson),
  };
}

/** Parsea el JSON cacheado de campos del formulario; vacío si falta o corrupto. */
function parseCustomFormFields(json: string | null): GestorFormField[] {
  if (!json) return [];
  try {
    const parsed = JSON.parse(json) as GestorFormField[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
