/**
 * Auth store mobile.
 *
 * Tokens viven en SecureStore (Keychain Android). El user object también
 * se cachea en SecureStore para que el splash sea instantáneo y la app
 * funcione si el primer abrir es offline (no hace falta /me para mostrar
 * el dashboard — los datos ya están en SQLite cache).
 *
 * Sprint 9.6: hydrate offline-tolerante.
 *   - Si hay user cacheado → set inmediato + isAuthenticated:true.
 *   - En background, intentamos /me; si OK actualiza el user con datos
 *     frescos. Si falla por red, conservamos el user cacheado (no
 *     desautenticamos por estar offline). Si falla con 401 después de un
 *     refresh fallido (client.ts ya borró los tokens), entonces sí
 *     deslogueamos y mandamos a login.
 */

import { create } from 'zustand';
import * as SecureStore from 'expo-secure-store';
import {
  authService,
  type PublicUser,
} from '../api/services/auth.service';
import { ApiError, clearTokens } from '../api/client';
import { isBiometricEnabled } from '../biometric';

const USER_KEY = 'sice.user';

/**
 * Roles que SÍ usan la app móvil (operadores de campo). Cualquier otro rol
 * (super_admin, coordinator, digitador, auditor, platform_admin) se gestiona
 * en la web — si intenta entrar aquí se rechaza en login y se limpia cualquier
 * sesión guardada al arrancar. Esto evita el crash/bucle al abrir la app con
 * una sesión de rol no-soportado.
 */
const FIELD_ROLES: ReadonlyArray<PublicUser['role']> = ['gestor', 'asistente'];
function isFieldRole(role: PublicUser['role'] | undefined | null): boolean {
  return !!role && FIELD_ROLES.includes(role);
}

async function saveUserToCache(user: PublicUser | null): Promise<void> {
  if (user) {
    await SecureStore.setItemAsync(USER_KEY, JSON.stringify(user));
  } else {
    await SecureStore.deleteItemAsync(USER_KEY);
  }
}

async function readUserFromCache(): Promise<PublicUser | null> {
  try {
    const raw = await SecureStore.getItemAsync(USER_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as PublicUser;
  } catch {
    return null;
  }
}

interface AuthState {
  user: PublicUser | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  /** True después del primer hidrate (intento de cargar user al iniciar) */
  hydrated: boolean;
  errorMessage: string | null;
  /** Preferencia persistida: ¿desbloqueo biométrico activado? */
  biometricEnabled: boolean;
  /** ¿Ya desbloqueó con huella en esta apertura de la app? (en memoria) */
  biometricUnlocked: boolean;

  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  /** Llama /auth/me con el token guardado para validar sesión y traer user */
  hydrate: () => Promise<void>;
  setBiometricUnlocked: (v: boolean) => void;
  refreshBiometricEnabled: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  isAuthenticated: false,
  isLoading: false,
  hydrated: false,
  errorMessage: null,
  biometricEnabled: false,
  biometricUnlocked: false,

  login: async (email, password) => {
    set({ isLoading: true, errorMessage: null });
    try {
      const result = await authService.login(email, password);
      if (result.flow !== 'completed') {
        // Por ahora la app móvil no soporta 2FA / first-login en este sprint.
        // Para gestores en campo es raro tener 2FA. Si llega, lo manejamos en
        // un sprint siguiente. Mostramos mensaje claro.
        set({
          isLoading: false,
          errorMessage:
            result.flow === '2fa_required'
              ? 'Tu cuenta tiene 2FA activo. Por ahora la app solo soporta login simple. Contacta al admin.'
              : 'Tu cuenta requiere cambio de contraseña. Hazlo desde la web primero.',
        });
        return;
      }
      // Solo roles de campo (gestor/asistente) usan esta app. Otros roles NO
      // tienen pantallas aquí → rechazar ANTES de cachear (authService.login ya
      // guardó tokens en SecureStore → hay que limpiarlos para no dejar sesión
      // a medias).
      if (!isFieldRole(result.user.role)) {
        await clearTokens();
        set({
          isLoading: false,
          errorMessage:
            'Esta app es solo para gestores de campo. Tu rol se gestiona desde el panel web.',
        });
        return;
      }
      await saveUserToCache(result.user);
      set({
        user: result.user,
        isAuthenticated: true,
        isLoading: false,
        errorMessage: null,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Error desconocido';
      set({
        isLoading: false,
        errorMessage: msg.includes('NETWORK_ERROR')
          ? 'Sin conexión al servidor. Verifica tu internet.'
          : msg.includes('INVALID_CREDENTIALS')
            ? 'Correo o contraseña incorrectos.'
            : msg,
      });
    }
  },

  logout: async () => {
    await authService.logout();
    await saveUserToCache(null);
    set({
      user: null,
      isAuthenticated: false,
      errorMessage: null,
      biometricUnlocked: false,
    });
  },

  hydrate: async () => {
    // Cargar preferencia de biometría (para el gate de desbloqueo en index).
    try {
      set({ biometricEnabled: await isBiometricEnabled() });
    } catch {
      /* noop */
    }
    // 1) Lee user cacheado y muestra UI inmediato (UX rápido al abrir).
    const cached = await readUserFromCache();
    // Boot guard: si quedó cacheada una sesión de rol NO-campo (alguien intentó
    // loguear como super_admin/coordinator antes de este fix), limpiar y mandar
    // a login — así la app se RECUPERA sola del bucle de crash al abrir.
    if (cached && !isFieldRole(cached.role)) {
      await clearTokens();
      await saveUserToCache(null);
      set({ user: null, isAuthenticated: false, hydrated: true });
      return;
    }
    if (cached) {
      set({
        user: cached,
        isAuthenticated: true,
        hydrated: true,
      });
    }

    // 2) En background, validamos contra /auth/me.
    //    - OK            → refrescamos el user en cache + state.
    //    - 401 (refresh ya falló dentro del client) → logout limpio.
    //    - NETWORK_ERROR → ignorar; mantenemos el cached (offline).
    try {
      const fresh = await authService.me();
      if (!isFieldRole(fresh.role)) {
        // Defensa en profundidad: el servidor confirma rol NO-campo → logout.
        await clearTokens();
        await saveUserToCache(null);
        set({ user: null, isAuthenticated: false, hydrated: true });
        return;
      }
      await saveUserToCache(fresh);
      set({
        user: fresh,
        isAuthenticated: true,
        hydrated: true,
      });
    } catch (err) {
      const isUnauthorized =
        err instanceof ApiError && err.status === 401;
      if (isUnauthorized) {
        // Tokens definitivamente inválidos → logout silencioso.
        await saveUserToCache(null);
        set({
          user: null,
          isAuthenticated: false,
          hydrated: true,
        });
      } else {
        // Network/timeout/otro → mantener el cached (si lo había) y
        // marcar hydrated para que la app deje de mostrar splash.
        set({
          hydrated: true,
          // Si NO había cached (primera vez sin red) marcamos no-auth para
          // ir a login.
          ...(cached
            ? {}
            : { user: null, isAuthenticated: false }),
        });
      }
    }
  },

  setBiometricUnlocked: (v) => set({ biometricUnlocked: v }),

  refreshBiometricEnabled: async () => {
    set({ biometricEnabled: await isBiometricEnabled() });
  },
}));
