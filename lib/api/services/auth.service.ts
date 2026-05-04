/**
 * Auth service mobile — login, me, logout, refresh.
 */

import { api, clearTokens, getRefreshToken, setTokens } from '../client';

export type UserRole =
  | 'platform_admin'
  | 'super_admin'
  | 'coordinator'
  | 'gestor'
  | 'asistente'
  | 'digitador'
  | 'auditor';

export interface PublicUser {
  id: string;
  email: string;
  fullName: string;
  role: UserRole;
  tenantId?: string;
  tenant?: {
    id: string;
    name: string;
    slug: string;
    logoUrl?: string;
  } | null;
  isActive: boolean;
  twoFactorEnabled?: boolean;
  passwordChangeRequired?: boolean;
  avatarUrl?: string;
  lastLogin?: string;
}

export type LoginResult =
  | {
      flow: 'completed';
      user: PublicUser;
      accessToken: string;
      refreshToken: string;
    }
  | { flow: '2fa_required'; tempToken: string; maskedEmail: string }
  | { flow: 'first_login_required'; tempToken: string };

export const authService = {
  async login(email: string, password: string): Promise<LoginResult> {
    const res = await api.post<LoginResult>(
      '/api/v1/auth/login',
      { email: email.trim().toLowerCase(), password },
      { skipAuth: true },
    );
    if (res.flow === 'completed') {
      await setTokens(res.accessToken, res.refreshToken);
    }
    return res;
  },

  async verify2fa(tempToken: string, code: string): Promise<LoginResult> {
    const res = await api.post<LoginResult>(
      '/api/v1/auth/2fa',
      { tempToken, code },
      { skipAuth: true },
    );
    if (res.flow === 'completed') {
      await setTokens(res.accessToken, res.refreshToken);
    }
    return res;
  },

  async firstLogin(
    tempToken: string,
    currentPassword: string,
    newPassword: string,
  ): Promise<LoginResult> {
    const res = await api.post<LoginResult>(
      '/api/v1/auth/first-login',
      { tempToken, currentPassword, newPassword },
      { skipAuth: true },
    );
    if (res.flow === 'completed') {
      await setTokens(res.accessToken, res.refreshToken);
    }
    return res;
  },

  async me(): Promise<PublicUser> {
    return api.get<PublicUser>('/api/v1/auth/me');
  },

  async logout(): Promise<void> {
    const refresh = await getRefreshToken();
    try {
      await api.post(
        '/api/v1/auth/logout',
        { refreshToken: refresh ?? undefined },
        { skipAuth: false },
      );
    } catch {
      // si falla, limpiamos local igual
    }
    await clearTokens();
  },
};
