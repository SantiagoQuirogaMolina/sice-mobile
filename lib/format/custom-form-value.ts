/**
 * Formatea un valor de customFormData a string legible (app). Espejo del helper
 * de backend/web: archivo/foto → nombre o conteo; GPS → "lat, lon"; fecha ISO
 * 'YYYY-MM-DD' → 'dd/mm/aaaa'; texto/número/select/checkbox → string. Nunca
 * devuelve "[object Object]". Se usa en la confirmación del wizard de captura.
 */
export function formatCustomFormValue(value: unknown): string {
  if (value == null) return '';
  if (Array.isArray(value)) {
    if (value.length === 0) return '';
    const kind = (value[0] as { kind?: string })?.kind;
    if (kind === 'photo') return `${value.length} foto(s)`;
    if (kind === 'file') return `${value.length} archivo(s)`;
    return value.map((v) => formatCustomFormValue(v)).filter(Boolean).join(', ');
  }
  if (typeof value === 'object') {
    const o = value as Record<string, unknown>;
    if (o.kind === 'gps' && typeof o.lat === 'number' && typeof o.lon === 'number') {
      return `${o.lat}, ${o.lon}`;
    }
    if (o.kind === 'photo' || o.kind === 'file') {
      if (typeof o.filename === 'string' && o.filename) return o.filename;
      return o.kind === 'photo' ? 'Foto adjunta' : 'Documento adjunto';
    }
    return '';
  }
  if (typeof value === 'string') {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    if (m) return `${m[3]}/${m[2]}/${m[1]}`;
  }
  return String(value);
}
