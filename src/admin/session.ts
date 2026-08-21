// Locally-signed session cookie with an embedded expiry. Issuer tokens are
// discarded after the callback — no refresh path; an expired cookie re-runs
// OAuth. Pure module (no Hono imports): Playwright imports signSession under
// Node to mint e2e cookies.

export const SESSION_COOKIE = 'admin_session';
export const SESSION_TTL_SECONDS = 8 * 3600;

const enc = (s: string) => new TextEncoder().encode(s);

function b64url(buf: ArrayBuffer | Uint8Array): string {
  const u = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  return btoa(String.fromCharCode(...u)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function fromB64url(s: string): Uint8Array {
  const b = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
  const u = new Uint8Array(b.length);
  for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i);
  return u;
}
async function hmacKey(secret: string, usage: 'sign' | 'verify'): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', enc(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [usage]);
}

export async function signSession(email: string, secret: string, now = Date.now()): Promise<string> {
  const payload = b64url(enc(JSON.stringify({ email, exp: Math.floor(now / 1000) + SESSION_TTL_SECONDS })));
  const sig = await crypto.subtle.sign('HMAC', await hmacKey(secret, 'sign'), enc(payload));
  return `${payload}.${b64url(sig)}`;
}

// Returns the email, or null on bad signature, malformed payload, or expiry.
// Signature is checked first (constant-time crypto.subtle.verify), so a
// forged payload never reaches JSON.parse trusted-side.
export async function verifySession(token: string, secret: string, now = Date.now()): Promise<string | null> {
  const i = token.lastIndexOf('.');
  if (i < 0) return null;
  const payload = token.slice(0, i);
  let sig: Uint8Array;
  try {
    sig = fromB64url(token.slice(i + 1));
  } catch {
    return null;
  }
  const ok = await crypto.subtle.verify('HMAC', await hmacKey(secret, 'verify'), sig, enc(payload));
  if (!ok) return null;
  try {
    const parsed = JSON.parse(new TextDecoder().decode(fromB64url(payload))) as { email?: unknown; exp?: unknown };
    if (typeof parsed.email !== 'string' || typeof parsed.exp !== 'number') return null;
    if (parsed.exp <= Math.floor(now / 1000)) return null;
    return parsed.email;
  } catch {
    return null;
  }
}

// Generic short-lived signed value (same HMAC scheme as the session cookie).
// Used for the OAuth state/verifier challenge cookie — integrity-protected so
// a fixated cookie can't smuggle an attacker-chosen state/verifier pair.
export async function signCompact<T>(obj: T, secret: string, ttlSeconds: number, now = Date.now()): Promise<string> {
  const payload = b64url(enc(JSON.stringify({ v: obj, exp: Math.floor(now / 1000) + ttlSeconds })));
  const sig = await crypto.subtle.sign('HMAC', await hmacKey(secret, 'sign'), enc(payload));
  return `${payload}.${b64url(sig)}`;
}

export async function verifyCompact<T>(token: string, secret: string, now = Date.now()): Promise<T | null> {
  const i = token.lastIndexOf('.');
  if (i < 0) return null;
  const payload = token.slice(0, i);
  let sig: Uint8Array;
  try {
    sig = fromB64url(token.slice(i + 1));
  } catch {
    return null;
  }
  const ok = await crypto.subtle.verify('HMAC', await hmacKey(secret, 'verify'), sig, enc(payload));
  if (!ok) return null;
  try {
    const parsed = JSON.parse(new TextDecoder().decode(fromB64url(payload))) as { v?: T; exp?: unknown };
    if (typeof parsed.exp !== 'number' || parsed.exp <= Math.floor(now / 1000)) return null;
    return parsed.v ?? null;
  } catch {
    return null;
  }
}
