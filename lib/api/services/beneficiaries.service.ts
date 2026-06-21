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
  pruneBeneficiariesByEvent,
  upsertBeneficiariesPage,
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
      // Descarga INCREMENTAL: persistimos cada página a SQLite apenas llega, en
      // vez de acumular las 20.000 en RAM y volcarlas al final (eso bloqueaba la
      // pantalla minutos en la primera entrada). La PRIMERA página es chica (200)
      // para que la lista aparezca en ~300ms; el resto va en bloques grandes
      // (1500) para minimizar round-trips. `onProgress` se llama TRAS persistir →
      // el caller re-lee SQLite y muestra/crece la lista sin esperar el total.
      const FIRST_PAGE = 200;
      const BULK_PAGE = 1500;
      const keepCitizenIds: string[] = [];
      let total = 0;
      let offset = 0;
      for (let i = 0; i < 500; i++) {
        const limit = i === 0 ? FIRST_PAGE : BULK_PAGE;
        const page = await api.get<BackendBeneficiary[]>(
          `/api/v1/events/${eventId}/beneficiaries?limit=${limit}&offset=${offset}`,
        );
        if (page.length > 0) {
          upsertBeneficiariesPage(eventId, page.map((b) => mapBeneficiary(b, eventId)));
          for (const b of page) keepCitizenIds.push(b.citizenId);
          total += page.length;
          offset += page.length;
          onProgress?.(total);
        }
        if (page.length < limit) break;
      }
      // Reconciliar UNA vez al final: borrar los que el backend ya no devuelve
      // (sin re-escribir las 20k). Solo si bajó algo (si red falló, no toca cache).
      if (keepCitizenIds.length > 0) {
        pruneBeneficiariesByEvent(eventId, keepCitizenIds);
      }
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
