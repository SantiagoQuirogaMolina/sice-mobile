/**
 * Tratamiento de la foto de evidencia antes de subirla.
 *
 * La cámara captura a resolución completa (12-48MP) → ~1.6MB+ por foto aun con
 * quality 0.6. Subir eso por red móvil se corta una y otra vez ("Sin conexión")
 * y vuelve el sync eterno. Acá redimensionamos el lado largo a 1600px y
 * recomprimimos a JPEG 0.65 → ~250-350KB (≈5× más liviano), lo que hace las
 * subidas fiables.
 *
 * EVIDENCIA PROBATORIA: esto es SEGURO. El SHA-256 se calcula AGUAS ABAJO sobre
 * el dataUrl que devuelve esta función (la imagen FINAL que se sube y almacena),
 * de modo que el hash sigue probando que esa imagen exacta no fue alterada. La
 * legibilidad del documento se conserva (1600px lee número y nombre sin problema).
 */

import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';

/** Lado largo máximo (px). 1600 = documento legible + archivo liviano. */
const MAX_LONG_EDGE = 1600;
/** Calidad JPEG tras redimensionar (0–1). 0.65 = buen balance legibilidad/peso. */
const JPEG_QUALITY = 0.65;

export async function compressEvidencePhoto(
  uri: string,
  width: number,
  height: number,
): Promise<{ dataUrl: string; sizeKB: number } | null> {
  const longEdge = Math.max(width || 0, height || 0);
  // - lado largo > tope → redimensionar capeando el lado largo (según orientación).
  // - dimensiones desconocidas (cámara OEM rara devuelve 0/undefined) → cap defensivo
  //   por ancho: una foto de cámara SIEMPRE es >1600px, así que solo reduce (no upscale)
  //   y garantiza el techo de tamaño en vez de subir el archivo pesado.
  // - lado largo ya ≤ tope → no redimensionar (solo recomprimir).
  const actions =
    longEdge > MAX_LONG_EDGE
      ? [{ resize: width >= height ? { width: MAX_LONG_EDGE } : { height: MAX_LONG_EDGE } }]
      : longEdge === 0
        ? [{ resize: { width: MAX_LONG_EDGE } }]
        : [];
  const out = await manipulateAsync(uri, actions, {
    compress: JPEG_QUALITY,
    format: SaveFormat.JPEG,
    base64: true,
  });
  if (!out.base64) return null;
  const sizeKB = Math.round((out.base64.length * 3) / 4 / 1024);
  return { dataUrl: `data:image/jpeg;base64,${out.base64}`, sizeKB };
}
