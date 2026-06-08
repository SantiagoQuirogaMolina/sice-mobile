/**
 * Beneficiaries service mobile — offline-first.
 *
 * Patrón:
 *   - listForEvent: trata de fetchar del backend, persiste al SQLite.
 *     Si falla (sin red), lee del cache local.
 *   - El UI siempre lee del cache (rapidísimo, índices SQL). Cuando hay red,
 *     llamamos esto en background para refrescar.
 */

import { api, ApiError } from '../client';
import {
  listBeneficiariesByEvent,
  normalizeDocument,
  normalizeName,
  replaceBeneficiariesByEvent,
  type CachedBeneficiary,
  type DocumentType,
  type ZonaType,
} from '../../offline/db';

interface BackendBeneficiary {
  id: string;
  citizenId: string;
  citizen?: {
    firstName?: string;
    lastName?: string;
    documentType?: DocumentType;
    documentNumber?: string;
  } | null;
  sectorId: string | null;
  sector?: {
    id: string;
    name: string;
    zona: ZonaType;
  } | null;
  deliveryStatus: 'pending' | 'delivered' | 'rejected';
  source: string;
}

function mapBeneficiary(b: BackendBeneficiary, eventId: string): CachedBeneficiary {
  const fullName = b.citizen
    ? `${b.citizen.firstName ?? ''} ${b.citizen.lastName ?? ''}`.trim()
    : 'Beneficiario';
  const docNumber = b.citizen?.documentNumber ?? '';
  return {
    id: b.id,
    eventId,
    citizenId: b.citizenId,
    documentType: (b.citizen?.documentType ?? 'CC') as DocumentType,
    documentNumber: docNumber,
    documentNormalized: normalizeDocument(docNumber),
    fullName,
    nameNormalized: normalizeName(fullName),
    sectorId: b.sectorId,
    sectorName: b.sector?.name ?? null,
    zona: b.sector?.zona ?? null,
    deliveryStatus: b.deliveryStatus === 'delivered' ? 'delivered' : 'pending',
    hasLocalDelivery: false,
  };
}

export const beneficiariesService = {
  /**
   * Lista beneficiarios del evento desde el backend, los persiste al cache
   * local (SQLite) y devuelve la lista mapeada. Si la red falla, devuelve
   * lo que esté en cache.
   *
   * El backend filtra automáticamente por el operador (gestor): solo trae
   * los beneficiarios donde assignedGestorId = me OR sectorId está en mis
   * sectores asignados (vía gestorIds de Sprint 7+).
   */
  async listForEvent(
    eventId: string,
    onProgress?: (loaded: number) => void,
  ): Promise<CachedBeneficiary[]> {
    try {
      // Fetch-all paginado: el gestor debe descargar TODA su lista (miles) para
      // trabajar 100% offline, no solo la primera página. Paramos cuando una
      // página viene incompleta. Tope de seguridad: 50 páginas (100k).
      // `onProgress` reporta el acumulado tras cada página → la UI muestra una
      // barra de progreso y no se "siente trabada" con listas grandes.
      const PAGE = 2000;
      const all: BackendBeneficiary[] = [];
      for (let i = 0; i < 50; i++) {
        const page = await api.get<BackendBeneficiary[]>(
          `/api/v1/events/${eventId}/beneficiaries?limit=${PAGE}&offset=${i * PAGE}`,
        );
        all.push(...page);
        onProgress?.(all.length);
        if (page.length < PAGE) break;
      }
      const cached = all.map((b) => mapBeneficiary(b, eventId));
      // Replace en el cache (función es safe — no hace wipe si vacío)
      replaceBeneficiariesByEvent(eventId, cached);
      return listBeneficiariesByEvent(eventId);
    } catch (err) {
      if (err instanceof ApiError && err.code === 'NETWORK_ERROR') {
        // Offline: devolver lo del cache
        return listBeneficiariesByEvent(eventId);
      }
      throw err;
    }
  },

  /**
   * Solo lee del cache local. Útil cuando ya sabemos que estamos offline
   * o queremos render instantáneo.
   */
  fromCache(eventId: string): CachedBeneficiary[] {
    return listBeneficiariesByEvent(eventId);
  },
};
