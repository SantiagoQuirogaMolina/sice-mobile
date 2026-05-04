/**
 * Auth store mobile — zustand sin persist (los tokens viven en SecureStore;
 * el user lo rehidratamos llamando authService.me() al iniciar la app).
 */

import { create } from 'zustand';
import {
  authService,
  type PublicUser,
} from '../api/services/auth.service';

interface AuthState {
  user: PublicUser | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  /** True después del primer hidrate (intento de cargar user al iniciar) */
  hydrated: boolean;
  errorMessage: string | null;

  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  /** Llama /auth/me con el token guardado para validar sesión y traer user */
  hydrate: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  isAuthenticated: false,
  isLoading: false,
  hydrated: false,
  errorMessage: null,

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
    set({ user: null, isAuthenticated: false, errorMessage: null });
  },

  hydrate: async () => {
    try {
      const user = await authService.me();
      set({ user, isAuthenticated: true, hydrated: true });
    } catch {
      // 401 / sin token → no autenticado, redirige a login
      set({ user: null, isAuthenticated: false, hydrated: true });
    }
  },
}));
