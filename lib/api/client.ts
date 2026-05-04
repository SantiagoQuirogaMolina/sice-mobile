/**
 * SICE — API client para mobile.
 *
 * A diferencia de la web (cookies httpOnly), aquí guardamos los tokens en
 * SecureStore (Keychain Android) y los enviamos como Authorization Bearer.
 *
 * El header X-Client: mobile le dice al backend que devuelva los tokens
 * en el body del login (en vez de solo cookies).
 */

import * as SecureStore from 'expo-secure-store';
import Constants from 'expo-constants';

const ACCESS_KEY = 'sice.accessToken';
const REFRESH_KEY = 'sice.refreshToken';

/**
 * URL del backend. En dev por default apuntamos al backend de Railway
 * (mismo que usa la web). El usuario puede sobreescribir con EXPO_PUBLIC_API_URL.
 */
function resolveApiUrl(): string {
  // Permitir override por env (Expo lee EXPO_PUBLIC_* vars)
  const fromEnv = process.env.EXPO_PUBLIC_API_URL;
  if (fromEnv) return fromEnv;

  // Fallback al app.json
  const extra = Constants.expoConfig?.extra as
    | { apiUrl?: string; apiUrlDev?: string }
    | undefined;
  if (__DEV__ && extra?.apiUrlDev) return extra.apiUrlDev;
  return extra?.apiUrl ?? 'https://sice-backend-production.up.railway.app';
}

export const API_URL = resolveApiUrl();

export class ApiError extends Error {
  constructor(
    public code: string,
    message: string,
    public status: number,
    public details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  headers?: Record<string, string>;
  skipAuth?: boolean;
  /** Timeout en ms. Default 15s. Sin red, fetch falla rápido igual. */
  timeoutMs?: number;
}

async function getAccessToken(): Promise<string | null> {
  return SecureStore.getItemAsync(ACCESS_KEY);
}

export async function setTokens(access: string, refresh: string): Promise<void> {
  await SecureStore.setItemAsync(ACCESS_KEY, access);
  await SecureStore.setItemAsync(REFRESH_KEY, refresh);
}

export async function clearTokens(): Promise<void> {
  await SecureStore.deleteItemAsync(ACCESS_KEY);
  await SecureStore.deleteItemAsync(REFRESH_KEY);
}

export async function getRefreshToken(): Promise<string | null> {
  return SecureStore.getItemAsync(REFRESH_KEY);
}

async function request<T>(
  path: string,
  opts: RequestOptions = {},
): Promise<T> {
  const url = `${API_URL}${path.startsWith('/') ? path : `/${path}`}`;
  const headers: Record<string, string> = {
    Accept: 'application/json',
    'Content-Type': 'application/json',
    'X-Client': 'mobile',
    ...(opts.headers ?? {}),
  };

  if (!opts.skipAuth) {
    const token = await getAccessToken();
    if (token) headers.Authorization = `Bearer ${token}`;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), opts.timeoutMs ?? 15000);

  let res: Response;
  try {
    res = await fetch(url, {
      method: opts.method ?? 'GET',
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      signal: controller.signal,
    });
  } catch (e) {
    clearTimeout(timeout);
    const message = e instanceof Error ? e.message : 'Network error';
    throw new ApiError('NETWORK_ERROR', message, 0);
  }
  clearTimeout(timeout);

  if (!res.ok) {
    type ErrorBody = {
      code?: string;
      message?: string | string[];
      details?: unknown;
      error?: { code?: string; message?: string; details?: unknown } | string;
    };
    let body: ErrorBody | null = null;
    try {
      body = (await res.json()) as ErrorBody;
    } catch {
      // sin body
    }
    const wrapped =
      typeof body?.error === 'object' && body?.error !== null ? body.error : null;
    const code = wrapped?.code ?? body?.code ?? `HTTP_${res.status}`;
    const rawMsg = wrapped?.message ?? body?.message ?? res.statusText;
    const msg = Array.isArray(rawMsg) ? rawMsg.join(', ') : rawMsg;
    const details = wrapped?.details ?? body?.details;
    throw new ApiError(code, msg, res.status, details);
  }

  if (res.status === 204) return undefined as T;

  const json = (await res.json()) as { data?: T } | T;
  // Backend SICE usa envelope { data }
  if (json && typeof json === 'object' && 'data' in json) {
    return (json as { data: T }).data;
  }
  return json as T;
}

export const api = {
  get: <T>(path: string, opts?: Omit<RequestOptions, 'method' | 'body'>) =>
    request<T>(path, { ...opts, method: 'GET' }),
  post: <T>(path: string, body?: unknown, opts?: Omit<RequestOptions, 'method'>) =>
    request<T>(path, { ...opts, method: 'POST', body }),
  patch: <T>(path: string, body?: unknown, opts?: Omit<RequestOptions, 'method'>) =>
    request<T>(path, { ...opts, method: 'PATCH', body }),
  delete: <T>(path: string, opts?: Omit<RequestOptions, 'method' | 'body'>) =>
    request<T>(path, { ...opts, method: 'DELETE' }),
};
