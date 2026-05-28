/**
 * Biometría (huella / Face ID) para desbloquear la app.
 *
 * Diseño:
 *   - La biometría NO reemplaza el login: protege el acceso a la sesión YA
 *     guardada en SecureStore. El operador inicia sesión una vez (online) y
 *     luego desbloquea con huella en cada apertura (funciona offline — es
 *     local del dispositivo).
 *   - La preferencia (activado/desactivado) vive en SecureStore.
 *   - El "unlock" de la sesión actual es un flag en memoria del auth-store
 *     (se resetea al cerrar/matar la app → vuelve a pedir huella).
 */
import * as LocalAuthentication from 'expo-local-authentication';
import * as SecureStore from 'expo-secure-store';

const PREF_KEY = 'sice.biometricEnabled';

/** ¿El dispositivo tiene hardware biométrico Y huellas/rostro enrolados? */
export async function isBiometricSupported(): Promise<boolean> {
  try {
    const hasHw = await LocalAuthentication.hasHardwareAsync();
    if (!hasHw) return false;
    return await LocalAuthentication.isEnrolledAsync();
  } catch {
    return false;
  }
}

/** ¿El usuario activó el desbloqueo biométrico? (preferencia persistida) */
export async function isBiometricEnabled(): Promise<boolean> {
  try {
    return (await SecureStore.getItemAsync(PREF_KEY)) === 'true';
  } catch {
    return false;
  }
}

export async function setBiometricEnabled(enabled: boolean): Promise<void> {
  if (enabled) {
    await SecureStore.setItemAsync(PREF_KEY, 'true');
  } else {
    await SecureStore.deleteItemAsync(PREF_KEY);
  }
}

/**
 * Lanza el prompt biométrico. Devuelve true si autenticó. Permite el fallback
 * al PIN/patrón del dispositivo (disableDeviceFallback:false) para no dejar
 * fuera al operador si la huella falla.
 */
export async function authenticate(
  promptMessage = 'Desbloquea SICE',
): Promise<boolean> {
  try {
    const res = await LocalAuthentication.authenticateAsync({
      promptMessage,
      cancelLabel: 'Cancelar',
      disableDeviceFallback: false,
    });
    return res.success;
  } catch {
    return false;
  }
}
