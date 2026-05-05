/**
 * SHA-256 helpers para evidencia probatoria.
 *
 * Usamos expo-crypto que tiene implementación nativa (no JS puro), rápido
 * incluso para fotos grandes.
 */

import * as Crypto from 'expo-crypto';

/**
 * Calcula SHA-256 hex de un Data URL (data:image/png;base64,...).
 * Hashea el cuerpo base64, NO el prefijo MIME.
 */
export async function sha256OfDataUrl(dataUrl: string): Promise<string> {
  const idx = dataUrl.indexOf(',');
  const base64 = idx >= 0 ? dataUrl.substring(idx + 1) : dataUrl;
  return Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    base64,
    { encoding: Crypto.CryptoEncoding.HEX },
  );
}

/**
 * Hash compuesto del delivery (citizen + event + capturedAt + sigHash + photoHash).
 * Replica la lógica del backend para que el cliente pueda mostrar el ID
 * en pantalla de éxito sin esperar al sync.
 */
export async function sha256OfDelivery(input: {
  citizenId: string;
  eventId: string;
  capturedAt: string;
  signatureSha256: string;
  photoSha256: string;
}): Promise<string> {
  const payload = `${input.citizenId}|${input.eventId}|${input.capturedAt}|${input.signatureSha256}|${input.photoSha256}`;
  return Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    payload,
    { encoding: Crypto.CryptoEncoding.HEX },
  );
}

/** Acorta un hash para mostrar en UI (ej. "afaa589a…65f0"). */
export function shortHash(hash: string, head = 8, tail = 4): string {
  if (!hash || hash.length < head + tail) return hash;
  return `${hash.slice(0, head)}…${hash.slice(-tail)}`;
}
