import type { UserRole } from './schema';

const ALGORITHM = { name: 'HMAC', hash: 'SHA-256' };
const SESSION_TTL_SECONDS = 12 * 60 * 60; // 12 hours

export interface SessionPayload {
  userId: string;
  phone: string;
  role: UserRole;
  sessionId: string;
  exp: number;
}

async function importKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    ALGORITHM,
    false,
    ['sign', 'verify']
  );
}

function toBase64url(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function fromBase64url(str: string): string {
  return atob(str.replace(/-/g, '+').replace(/_/g, '/'));
}

export async function signJwt(
  payload: SessionPayload,
  secret: string
): Promise<string> {
  const enc = new TextEncoder();
  const header = toBase64url(enc.encode(JSON.stringify({ alg: 'HS256', typ: 'JWT' })));
  const body = toBase64url(enc.encode(JSON.stringify(payload)));
  const key = await importKey(secret);
  const sig = await crypto.subtle.sign(ALGORITHM, key, enc.encode(`${header}.${body}`));
  return `${header}.${body}.${toBase64url(sig)}`;
}

export async function verifyJwt(
  token: string,
  secret: string
): Promise<SessionPayload | null> {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [header, body, sigB64] = parts;
  try {
    const key = await importKey(secret);
    const sigBytes = Uint8Array.from(fromBase64url(sigB64), c => c.charCodeAt(0));
    const valid = await crypto.subtle.verify(
      ALGORITHM,
      key,
      sigBytes,
      new TextEncoder().encode(`${header}.${body}`)
    );
    if (!valid) return null;
    const payload: SessionPayload = JSON.parse(fromBase64url(body));
    if (payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

export async function createSession(
  kv: KVNamespace,
  payload: SessionPayload
): Promise<void> {
  await kv.put(`session:${payload.sessionId}`, JSON.stringify(payload), {
    expirationTtl: SESSION_TTL_SECONDS,
  });
}

export async function getSession(
  kv: KVNamespace,
  sessionId: string
): Promise<SessionPayload | null> {
  const raw = await kv.get(`session:${sessionId}`);
  if (!raw) return null;
  return JSON.parse(raw) as SessionPayload;
}

export async function destroySession(
  kv: KVNamespace,
  sessionId: string
): Promise<void> {
  await kv.delete(`session:${sessionId}`);
}

export async function buildSession(
  userId: string,
  phone: string,
  role: UserRole,
  secret: string
): Promise<{ token: string; payload: SessionPayload }> {
  const sessionId = crypto.randomUUID().replace(/-/g, '');
  const payload: SessionPayload = {
    userId,
    phone,
    role,
    sessionId,
    exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS,
  };
  const token = await signJwt(payload, secret);
  return { token, payload };
}
