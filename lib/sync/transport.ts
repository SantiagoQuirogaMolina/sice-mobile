/**
 * Transport — orquesta el upload de evidencia + creación del Delivery
 * en el backend SICE.
 *
 * Patrón en 2 pasos para subir una entrega:
 *   1. POST /api/v1/evidence/upload (firma)  → URL devuelta
 *   2. POST /api/v1/evidence/upload (foto)   → URL devuelta
 *   3. POST /api/v1/deliveries con las URLs
 *
 * Los uploads de evidencia son idempotentes en backend (basado en SHA-256),
 * así que reintentos no crean duplicados.
 */

import { api, ApiError } from '../api/client';
import { apiErrorMessage } from '../api/error-message';
import { sha256OfDataUrl } from '../crypto/hash';
import type {
  PendingCitizen,
  PendingDelivery,
  PendingEventBeneficiary,
} from '../offline/db';

export type SyncResult =
  | { kind: 'ok'; serverId: string }
  | { kind: 'conflict'; serverId: string; reason: string }
  | { kind: 'error'; message: string; retryable: boolean };

interface UploadEvidenceResponse {
  url: string;
  sha256: string;
}

interface BackendDeliveryResponse {
  id: string;
  serverFolio: string;
}

interface BackendCitizenResponse {
  id: string;
}

interface BackendEventBeneficiaryResponse {
  id: string;
}

async function uploadEvidence(
  kind: 'signature' | 'photo' | 'audio' | 'selfie',
  dataUrl: string,
  sha256: string,
): Promise<{ url: string; sha256: string }> {
  // Idempotente: si el backend ya tiene este sha256, devuelve la URL existente.
  const res = await api.post<UploadEvidenceResponse>(
    '/api/v1/evidence/upload',
    { kind, sha256, dataUrl },
    { timeoutMs: 60000 }, // foto puede pesar ~300KB, dale tiempo
  );
  return { url: res.url, sha256: res.sha256 };
}

/**
 * Sube los archivos del formulario dinámico (campos foto/documento que el
 * operador capturó como Data URL dentro de customFormData) y los reemplaza por
 * la referencia { kind, url, sha256, filename, mime }. Espejo del
 * `uploadCustomFormFiles` de la web (lib/sync/real-transport.ts). Idempotente
 * por SHA-256. Texto/select/checkbox/GPS quedan intactos, así el POST a
 * /deliveries no lleva base64 gigante y los archivos van a EvidenceStorage.
 */
async function uploadCustomFormFiles(
  customFormData: Record<string, unknown> | null | undefined,
): Promise<Record<string, unknown> | null | undefined> {
  if (!customFormData) return customFormData;
  const out: Record<string, unknown> = { ...customFormData };
  for (const [key, val] of Object.entries(customFormData)) {
    const items = Array.isArray(val) ? val : [val];
    let touched = false;
    const processed: unknown[] = [];
    for (const item of items) {
      const piece = item as {
        kind?: string;
        dataUrl?: string;
        sha256?: string;
        filename?: string;
        mime?: string;
      };
      if (
        (piece?.kind === 'photo' || piece?.kind === 'file') &&
        typeof piece.dataUrl === 'string' &&
        piece.dataUrl.startsWith('data:') &&
        piece.sha256
      ) {
        touched = true;
        // 'photo' es cosmético en el storage; la extensión sale del mime.
        const res = await uploadEvidence('photo', piece.dataUrl, piece.sha256);
        processed.push({
          kind: piece.kind,
          url: res.url,
          sha256: res.sha256,
          filename: piece.filename ?? 'archivo',
          mime: piece.mime ?? 'application/octet-stream',
        });
      } else {
        processed.push(item);
      }
    }
    if (touched) out[key] = Array.isArray(val) ? processed : processed[0];
  }
  return out;
}

function classify(err: unknown): SyncResult {
  if (err instanceof ApiError) {
    // 409 — conflict por composedHash duplicado. Mensaje en español (sin
    // exponer el texto crudo del backend); queda guardado en lastError.
    if (err.status === 409) {
      return {
        kind: 'conflict',
        serverId: '',
        reason: apiErrorMessage(err, 'Conflicto detectado por el servidor.'),
      };
    }
    // 4xx (no 401/408/429) — error permanente, no reintentar.
    if (err.status >= 400 && err.status < 500 && err.status !== 408 && err.status !== 429) {
      return {
        kind: 'error',
        message: apiErrorMessage(err),
        retryable: false,
      };
    }
    // 5xx — server error, reintentar.
    return {
      kind: 'error',
      message: apiErrorMessage(err),
      retryable: true,
    };
  }
  // Network u otros — reintentar.
  return {
    kind: 'error',
    message: apiErrorMessage(err),
    retryable: true,
  };
}

/**
 * Sprint 9.4: sube un PendingCitizen al backend (POST /api/v1/citizens).
 *
 * El backend devuelve `{ id }` con el UUID server-side. El llamador debe
 * persistir ese serverId en la fila local con updatePendingCitizenStatus.
 *
 * Idempotencia: el backend valida unicidad por (tenantId, documentType,
 * documentNumber) y, si ya existe, devuelve el citizen existente. Por ende
 * reintentos no crean duplicados — pero si el operador escribió mal el
 * documento, el conflict 409 quedará blocked para inspección manual.
 */
export async function uploadCitizen(c: PendingCitizen): Promise<SyncResult> {
  try {
    // Source 'ad_hoc_assistant' (CitizenSource enum del backend) marca que el
    // ciudadano fue creado por un operador de campo durante una excepción —
    // queda en auditoría como tal.
    const body: Record<string, unknown> = {
      documentType: c.documentType,
      documentNumber: c.documentNumber,
      firstName: c.firstName,
      lastName: c.lastName,
      source: 'ad_hoc_assistant',
    };
    if (c.phone) body.phone = c.phone;
    if (c.email) body.email = c.email;
    if (c.tipoZona) body.tipoZona = c.tipoZona;
    if (c.address) body.address = c.address;
    if (c.barrio) body.barrio = c.barrio;
    if (c.vereda) body.vereda = c.vereda;
    if (c.sectorRural) body.sectorRural = c.sectorRural;

    const res = await api.post<BackendCitizenResponse>('/api/v1/citizens', body);
    return { kind: 'ok', serverId: res.id };
  } catch (err) {
    return classify(err);
  }
}

/**
 * Sprint 9.4: sube un PendingEventBeneficiary al backend
 * (POST /api/v1/events/:eventId/beneficiaries).
 *
 * Pre: el citizen DEBE estar ya sincronizado — el queue se encarga de
 * llamar uploadCitizen primero y de propagar citizenServerId acá.
 *
 * Excepciones requieren `exceptionJustification` (>= 20 chars). Es
 * responsabilidad de la UI exigir la longitud al registrar.
 */
export async function uploadEventBeneficiary(
  eb: PendingEventBeneficiary,
): Promise<SyncResult> {
  if (!eb.citizenServerId) {
    return {
      kind: 'error',
      message: 'citizenServerId faltante; sincronizar citizen primero',
      retryable: true,
    };
  }
  try {
    const body: Record<string, unknown> = {
      citizenId: eb.citizenServerId,
      source: eb.source === 'exception' ? 'exception' : 'ad_hoc',
    };
    if (eb.sectorId) body.sectorId = eb.sectorId;
    if (eb.source === 'exception' && eb.justification) {
      body.exceptionJustification = eb.justification;
    }
    const res = await api.post<BackendEventBeneficiaryResponse>(
      `/api/v1/events/${eb.eventId}/beneficiaries`,
      body,
    );
    return { kind: 'ok', serverId: res.id };
  } catch (err) {
    return classify(err);
  }
}

export interface UploadDeliveryOverrides {
  /**
   * Sprint 9.4: si la delivery se creó offline para un PendingCitizen
   * (citizenId = localId), el queue la sustituye acá por el UUID server-side
   * antes del POST a /deliveries. Si está ausente se usa d.citizenId tal cual.
   */
  citizenServerId?: string;
}

export async function uploadDelivery(
  d: PendingDelivery,
  overrides: UploadDeliveryOverrides = {},
): Promise<SyncResult> {
  try {
    // #2: firma y foto son OPCIONALES según los flags del evento. Si el wizard
    // las omitió (requireSignature/requirePhoto = false) NO las exigimos acá.
    // El backend hace el enforcement real: si el evento SÍ las requiere y
    // faltan, responde 400 SIGNATURE/PHOTO_REQUIRED (no-retryable → blocked),
    // que es el comportamiento correcto. Antes este transport las exigía
    // siempre y habría dejado en 'blocked' toda captura de un evento que no
    // pide firma/foto.

    // 1) Subir firma si se capturó.
    // Sprint 9.3.1: recomputamos el SHA-256 desde el dataUrl antes de subir
    // (auto-cura hashes viejos calculados sobre la string base64, no los bytes).
    let sig: { url: string; sha256: string } | null = null;
    if (d.signatureDataUrl) {
      const sigHash = d.signatureDataUrl.startsWith('data:')
        ? await sha256OfDataUrl(d.signatureDataUrl)
        : d.signatureSha256 ?? '';
      sig = d.signatureDataUrl.startsWith('data:')
        ? await uploadEvidence('signature', d.signatureDataUrl, sigHash)
        : { url: d.signatureDataUrl, sha256: sigHash };
    }

    // 2) Subir foto si se capturó.
    let photo: { url: string; sha256: string } | null = null;
    if (d.photoDataUrl) {
      const photoHash = d.photoDataUrl.startsWith('data:')
        ? await sha256OfDataUrl(d.photoDataUrl)
        : d.photoSha256 ?? '';
      photo = d.photoDataUrl.startsWith('data:')
        ? await uploadEvidence('photo', d.photoDataUrl, photoHash)
        : { url: d.photoDataUrl, sha256: photoHash };
    }

    // 3) Subir los archivos del formulario dinámico (foto/documento) y dejar
    //    solo las referencias en customFormData (no base64). Texto/GPS/etc.
    //    quedan intactos.
    const cleanedForm = await uploadCustomFormFiles(d.customFormData);

    // 4) Crear el Delivery
    const citizenId = overrides.citizenServerId ?? d.citizenId;
    const res = await api.post<BackendDeliveryResponse>(
      '/api/v1/deliveries',
      {
        id: d.id, // el id local es la idempotency key
        eventId: d.eventId,
        citizenId,
        capturedAt: d.capturedAt,
        ...(sig ? { signatureUrl: sig.url, signatureSha256: sig.sha256 } : {}),
        ...(photo ? { photoUrl: photo.url, photoSha256: photo.sha256 } : {}),
        gps: {
          lat: d.gpsLat,
          lon: d.gpsLon,
          accuracy: d.gpsAccuracy,
          status: d.gpsStatus,
        },
        customFormData: cleanedForm,
      },
    );
    return { kind: 'ok', serverId: res.id };
  } catch (err) {
    return classify(err);
  }
}
