/**
 * SHA-256 helpers para evidencia probatoria.
 *
 * IMPORTANTE: el backend hashea los BYTES decodificados del base64 (no la
 * string base64 literal). El cliente debe hacer lo mismo o el backend
 * rechaza con SHA256_MISMATCH.
 *
 *   backend: Buffer.from(base64, 'base64') → SHA-256(buffer)
 *   mobile:  decodificar base64 → Uint8Array → SHA-256(uint8array)
 */

import * as Crypto from 'expo-crypto';

/**
 * Decodifica una string base64 a Uint8Array.
 * RN no tiene Buffer global por defecto, así que usamos atob (disponible
 * desde RN 0.74+) más conversión charCode → byte.
 */
function base64ToBytes(base64: string): Uint8Array {
  // RN tiene atob global en SDK 54. Si por alguna razón no, hay polyfill
  // en el bundle de Expo.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const decoder = (globalThis as any).atob as (s: string) => string;
  if (!decoder) {
    throw new Error('atob no disponible en este runtime');
  }
  const binary = decoder(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/** Convierte un ArrayBuffer/Uint8Array de hash a hex string. */
function bufferToHex(buf: ArrayBuffer | Uint8Array): string {
  const view = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let out = '';
  for (let i = 0; i < view.length; i++) {
    out += view[i].toString(16).padStart(2, '0');
  }
  return out;
}

/**
 * SHA-256 hex de los bytes BINARIOS de un Data URL.
 * Decodifica el base64 antes de hashear — match exacto con
 * Buffer.from(base64).digest('sha256') del backend.
 */
export async function sha256OfDataUrl(dataUrl: string): Promise<string> {
  const idx = dataUrl.indexOf(',');
  const base64 = idx >= 0 ? dataUrl.substring(idx + 1) : dataUrl;
  const bytes = base64ToBytes(base64);
  // En Android, expo-crypto.digest exige Uint8Array — pasarle un ArrayBuffer
  // tira "Cannot convert '[object ArrayBuffer]' to a Kotlin type".
  // El cast es seguro: Uint8Array<ArrayBuffer> es compatible con la firma
  // de expo-crypto en runtime.
  const hash = await Crypto.digest(
    Crypto.CryptoDigestAlgorithm.SHA256,
    bytes as unknown as ArrayBuffer,
  );
  return bufferToHex(hash);
}

/**
 * Hash compuesto del delivery — mismo formato que el backend en
 * deliveries.service.ts composeHash:
 *   sha256( citizenId | eventId | capturedAt | signatureSha256 | photoSha256 )
 *
 * El backend lo recalcula y rechaza si no coincide. Lo computamos en
 * cliente para mostrar el ID corto en pantalla de éxito sin esperar al sync.
 */
export async function sha256OfDelivery(input: {
  citizenId: string;
  eventId: string;
  capturedAt: string;
  signatureSha256: string;
  photoSha256: string;
}): Promise<string> {
  const payload = [
    input.citizenId,
    input.eventId,
    input.capturedAt,
    input.signatureSha256,
    input.photoSha256,
  ].join('|');
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
