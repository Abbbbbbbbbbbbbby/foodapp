import { getToken } from '../store/auth';
import { trackEvent } from './telemetry';

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = 'ApiError';
  }
}

async function apiFetch<T>(path: string, options?: RequestInit, tokenOverride?: string | null): Promise<T> {
  // undefined = read the live token; an explicit value (even null) pins it.
  const token = tokenOverride !== undefined ? tokenOverride : getToken();
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  let res: Response;
  try {
    res = await fetch(path, {
      ...options,
      headers: { ...headers, ...(options?.headers as Record<string, string> ?? {}) },
    });
  } catch (err) {
    trackEvent('api_failure', 'warn', { route: path, message: err instanceof Error ? err.message : String(err) });
    throw err;
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    const message = body.error ?? res.statusText;
    trackEvent('api_failure', 'warn', { route: path, message: `${res.status} ${message}` });
    throw new ApiError(res.status, message);
  }
  return res.json() as Promise<T>;
}

export const api = {
  get: <T>(path: string) => apiFetch<T>(path),
  post: <T>(path: string, body: unknown) =>
    apiFetch<T>(path, { method: 'POST', body: JSON.stringify(body) }),
  patch: <T>(path: string, body: unknown) =>
    apiFetch<T>(path, { method: 'PATCH', body: JSON.stringify(body) }),
  delete: <T>(path: string) =>
    apiFetch<T>(path, { method: 'DELETE' }),
};

// Identity-pinned variant for the offline flush: a queued submission spans
// several requests (family → visit → bag), and reading the live token per
// request lets a mid-flush account switch split ONE submission across TWO
// identities. Pinning the token at flush start makes every request in the
// flush carry the same identity; if that session dies mid-flush, requests
// 401 and the items stay queued — fail loud, never mixed attribution.
export function apiWithToken(token: string | null) {
  return {
    get: <T>(path: string) => apiFetch<T>(path, undefined, token),
    post: <T>(path: string, body: unknown) =>
      apiFetch<T>(path, { method: 'POST', body: JSON.stringify(body) }, token),
    patch: <T>(path: string, body: unknown) =>
      apiFetch<T>(path, { method: 'PATCH', body: JSON.stringify(body) }, token),
  };
}
