/**
 * SICE — API client para mobile.
 *
 * A diferencia de la web (cookies httpOnly), aquí guardamos los tokens en
 * SecureStore (Keychain Android) y los enviamos como Authorization Bearer.
 *
 * El header X-Client: mobile le dice al backend que devuelva los tokens
 * en el body del login (en vez de solo cookies).
 *
 * Sprint 9.6: refresh automático. Si una request autenticada devuelve 401,
 * el cliente intenta /auth/refresh con el refresh token guardado. Si va
 * bien, reintenta la request original con el nuevo access token. Si el
 * refresh también falla, los tokens se borran y el caller recibe el 401
 * (que el auth-store usa para mandar al login).
 */

import * as SecureStore from 'expo-secure-store';
import Constants from 'expo-constants';

const ACCESS_KEY = 'sice.accessToken';
const REFRESH_KEY = 'sice.refreshToken';

/**
 * URL del backend.
 *
 * Por default apunta al backend de Railway (producción) para que funcione
 * desde el primer arranque sin configuración en dispositivos físicos.
 *
 * Si querés apuntar a un backend local:
 *   1. Crear .env en sice-mobile/ con:
 *      EXPO_PUBLIC_API_URL=http://192.168.X.X:4000
 *   2. Reiniciar Metro con npm start
 *
 * NOTA: 10.0.2.2:4000 SOLO funciona en emulador Android. En celular físico
 * conectado por WiFi, hay que usar la IP LAN de la PC.
 */
function resolveApiUrl(): string {
  // 1. Override explícito por env (Expo lee EXPO_PUBLIC_* vars)
  const fromEnv = process.env.EXPO_PUBLIC_API_URL;
  if (fromEnv) return fromEnv;

  // 2. Fallback al apiUrl del app.json (production Railway por default)
  const extra = Constants.expoConfig?.extra as
    | { apiUrl?: string; apiUrlDev?: string }
    | undefined;
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
  /** Timeout en ms. Default 30s. Sin red, fetch falla rápido igual. */
  timeoutMs?: number;
  /**
   * Si true, NO se intenta refresh tras 401. Se usa internamente para que
   * la request a /auth/refresh no se reintente recursivamente.
   */
  skipRefreshOn401?: boolean;
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

/* ─────────────────────────── Refresh mutex ─────────────────────────── */

/**
 * Evita N requests concurrentes triggereando N refresh paralelos. Solo
 * uno corre a la vez; los demás esperan al mismo Promise.
 */
let refreshInFlight: Promise<boolean> | null = null;

async function tryRefresh(): Promise<boolean> {
  if (refreshInFlight) return refreshInFlight;

  refreshInFlight = (async () => {
    try {
      const refreshToken = await getRefreshToken();
      if (!refreshToken) return false;

      // skipRefreshOn401: la propia request a /refresh, si devuelve 401,
      // no debe disparar otro refresh — sería loop infinito.
      const res = await request<{
        ok: boolean;
        accessToken?: string;
        refreshToken?: string;
      }>('/api/v1/auth/refresh', {
        method: 'POST',
        body: { refreshToken },
        skipAuth: true,
        skipRefreshOn401: true,
      });

      if (res.accessToken && res.refreshToken) {
        await setTokens(res.accessToken, res.refreshToken);
        return true;
      }
      return false;
    } catch {
      return false;
    } finally {
      refreshInFlight = null;
    }
  })();

  return refreshInFlight;
}

/* ─────────────────────────── Request core ─────────────────────────── */

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

  // Sprint 9.0: timeout 30s. Railway free-tier puede tener cold start de
  // hasta 25s en la primera request del día. Si ya están todos los pods
  // calientes, una request normal toma <500ms.
  const timeoutMs = opts.timeoutMs ?? 30000;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  // Log visible en Metro logs para diagnóstico
  const startedAt = Date.now();
  // eslint-disable-next-line no-console
  console.log(`[api] ${opts.method ?? 'GET'} ${url}`);

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
    const elapsed = Date.now() - startedAt;
    const isAbort = e instanceof Error && e.name === 'AbortError';
    const message = isAbort
      ? `Timeout tras ${Math.round(elapsed / 1000)}s. Verifica internet o reintenta (Railway puede estar arrancando).`
      : e instanceof Error
        ? e.message
        : 'Network error';
    // Log a console.log (no .error) para no spamear el overlay rojo de Expo Go
    // cuando el operador está offline — es el caso esperado, no un bug.
    // Los logs siguen visibles en la terminal de Metro para diagnóstico.
    // eslint-disable-next-line no-console
    console.log(`[api] FAIL ${url} (${elapsed}ms):`, message);
    throw new ApiError(isAbort ? 'TIMEOUT' : 'NETWORK_ERROR', message, 0);
  }
  clearTimeout(timeout);
  // eslint-disable-next-line no-console
  console.log(`[api] ${res.status} ${url} (${Date.now() - startedAt}ms)`);

  // Sprint 9.6: 401 → intentar refresh + reintentar UNA vez.
  // - skipAuth → no hay nada que refrescar
  // - skipRefreshOn401 → el caller pidió no recurrir (típico: /refresh y
  //   logout, donde un refresh no sirve)
  if (
    res.status === 401 &&
    !opts.skipAuth &&
    !opts.skipRefreshOn401
  ) {
    const refreshed = await tryRefresh();
    if (refreshed) {
      // Reintentamos la request original con los nuevos tokens.
      return request<T>(path, { ...opts, skipRefreshOn401: true });
    }
    // Refresh falló → tokens inválidos. Limpiamos para forzar login.
    await clearTokens();
  }

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
