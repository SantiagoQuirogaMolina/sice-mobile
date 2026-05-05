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
import { sha256OfDataUrl } from '../crypto/hash';
import type { PendingDelivery } from '../offline/db';

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

function classify(err: unknown): SyncResult {
  if (err instanceof ApiError) {
    // 409 — conflict por composedHash duplicado
    if (err.status === 409) {
      return {
        kind: 'conflict',
        serverId: '',
        reason: err.message ?? 'Conflict reportado por backend',
      };
    }
    // 4xx (no 401/408/429) — error permanente, no reintentar
    if (err.status >= 400 && err.status < 500 && err.status !== 408 && err.status !== 429) {
      return {
        kind: 'error',
        message: `${err.code}: ${err.message}`,
        retryable: false,
      };
    }
    // 5xx — server error, reintentar
    return {
      kind: 'error',
      message: `${err.code}: ${err.message}`,
      retryable: true,
    };
  }
  // Network u otros — reintentar
  return {
    kind: 'error',
    message: err instanceof Error ? err.message : 'Error desconocido',
    retryable: true,
  };
}

export async function uploadDelivery(d: PendingDelivery): Promise<SyncResult> {
  try {
    // 1) Subir firma (si data URL — si ya es http URL, no re-sube)
    if (!d.signatureDataUrl) {
      return {
        kind: 'error',
        message: 'Firma incompleta (faltó dataUrl)',
        retryable: false,
      };
    }
    // Sprint 9.3.1: recomputamos siempre el SHA-256 a partir del dataUrl antes
    // de subir. Esto auto-cura deliveries de versiones previas donde el hash
    // se calculaba sobre la string base64 (no los bytes binarios). Costo:
    // ~30ms por hash en mobile, despreciable.
    const sigHash = d.signatureDataUrl.startsWith('data:')
      ? await sha256OfDataUrl(d.signatureDataUrl)
      : d.signatureSha256 ?? '';
    const sig = d.signatureDataUrl.startsWith('data:')
      ? await uploadEvidence('signature', d.signatureDataUrl, sigHash)
      : { url: d.signatureDataUrl, sha256: sigHash };

    // 2) Subir foto
    if (!d.photoDataUrl) {
      return {
        kind: 'error',
        message: 'Foto incompleta',
        retryable: false,
      };
    }
    const photoHash = d.photoDataUrl.startsWith('data:')
      ? await sha256OfDataUrl(d.photoDataUrl)
      : d.photoSha256 ?? '';
    const photo = d.photoDataUrl.startsWith('data:')
      ? await uploadEvidence('photo', d.photoDataUrl, photoHash)
      : { url: d.photoDataUrl, sha256: photoHash };

    // 3) Crear el Delivery
    const res = await api.post<BackendDeliveryResponse>(
      '/api/v1/deliveries',
      {
        id: d.id, // el id local es la idempotency key
        eventId: d.eventId,
        citizenId: d.citizenId,
        capturedAt: d.capturedAt,
        signatureUrl: sig.url,
        signatureSha256: sig.sha256,
        photoUrl: photo.url,
        photoSha256: photo.sha256,
        gps: {
          lat: d.gpsLat,
          lon: d.gpsLon,
          accuracy: d.gpsAccuracy,
          status: d.gpsStatus,
        },
        customFormData: d.customFormData,
      },
    );
    return { kind: 'ok', serverId: res.id };
  } catch (err) {
    return classify(err);
  }
}
