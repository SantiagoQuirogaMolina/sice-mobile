import { ApiError } from './client';

/**
 * apiErrorMessage — traduce CUALQUIER error de API a un mensaje en español
 * apto para mostrar al operador, SIN filtrar nunca el mensaje crudo del backend
 * (códigos técnicos, "Internal Server Error", arrays de validación, nombres de
 * constraint, etc.). Regla: jamás se retorna `err.message`.
 */

const CODE_MESSAGES: Record<string, string> = {
  NETWORK_ERROR: 'Sin conexión con el servidor. Revisa tu red e inténtalo de nuevo.',
  // Captura / beneficiarios
  DUPLICATE_DELIVERY: 'Ya existe una entrega idéntica para este ciudadano.',
  BENEFICIARY_ALREADY_LINKED: 'Este ciudadano ya está vinculado al evento.',
  EVENT_NOT_CAPTURABLE: 'No se puede capturar en un evento con ese estado.',
  EXCEPTIONS_NOT_ALLOWED: 'Este evento no permite excepciones.',
  SECTOR_EXCEPTION_LIMIT_REACHED: 'Se alcanzó el tope de excepciones de este sector.',
  SECTOR_REQUIRED_FOR_OPERATOR: 'Debes asociar la excepción a tu sector.',
  NOT_ASSIGNED_TO_SECTOR: 'No estás asignado como operador a este sector. Pídele al coordinador que te asigne.',
  SIGNATURE_REQUIRED: 'Este evento exige la firma del beneficiario.',
  PHOTO_REQUIRED: 'Este evento exige una foto de evidencia.',
  GPS_REQUIRED: 'Este evento exige geolocalización (GPS).',
  CITIZEN_NOT_FOUND_OR_WRONG_TENANT: 'El ciudadano no existe o no pertenece a tu entidad.',
};

function byStatus(status: number): string | null {
  if (status === 0) return CODE_MESSAGES.NETWORK_ERROR;
  if (status === 400 || status === 422) return 'Revisa los datos e inténtalo de nuevo.';
  if (status === 401) return 'Tu sesión expiró. Vuelve a iniciar sesión.';
  if (status === 403) return 'No tienes permiso para esta acción.';
  if (status === 404) return 'No se encontró el recurso solicitado.';
  if (status === 409) return 'Hay un conflicto con el estado actual. Recarga e inténtalo de nuevo.';
  if (status === 429) return 'Demasiadas solicitudes. Espera un momento e inténtalo de nuevo.';
  if (status >= 500) return 'El servidor tuvo un problema. Inténtalo más tarde.';
  return null;
}

/** Mensaje en español seguro para mostrar al usuario (nunca el crudo del backend). */
export function apiErrorMessage(
  err: unknown,
  fallback = 'Algo salió mal. Inténtalo de nuevo.',
): string {
  if (err instanceof ApiError) {
    const mapped = CODE_MESSAGES[err.code];
    if (mapped) return mapped;
    const byCode = byStatus(err.status);
    if (byCode) return byCode;
    return fallback;
  }
  return fallback;
}
