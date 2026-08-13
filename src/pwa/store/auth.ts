export interface AuthUser {
  id: string;
  name: string;
  phone: string;
  role: 'admin' | 'staff' | 'volunteer';
}

interface AuthState {
  token: string;
  user: AuthUser;
}

// Exported so Layout can watch cross-tab auth changes via 'storage' events.
export const AUTH_STORAGE_KEY = 'foodapp_auth';
const KEY = AUTH_STORAGE_KEY;

export function getAuth(): AuthState | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as AuthState) : null;
  } catch {
    return null;
  }
}

export function setAuth(token: string, user: AuthUser): void {
  localStorage.setItem(KEY, JSON.stringify({ token, user }));
}

export function clearAuth(): void {
  localStorage.removeItem(KEY);
}

export function getToken(): string | null {
  return getAuth()?.token ?? null;
}

export function getUser(): AuthUser | null {
  return getAuth()?.user ?? null;
}
