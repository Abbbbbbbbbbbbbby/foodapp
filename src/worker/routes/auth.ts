import type { Env } from '../schema';
import { createOtp, sendOtpSms, verifyOtp } from '../otp';
import { buildSession, createSession, destroySession } from '../auth';
import { getAuthContext } from '../middleware';
import { normalizePhone } from '../db';
import { checkOtpSendLimit, checkVerifyLimit } from '../ratelimit';
import { readBodyCapped } from '../body';

// E2E-only: lets the Playwright harness read the OTP that would have gone
// out by SMS. Gated on ENVIRONMENT === 'test' — in production the var is
// 'production', so this branch is structurally unreachable there.
async function handleTestLatestOtp(env: Env, phone: string): Promise<Response> {
  const row = await env.DB.prepare(
    `SELECT code FROM otp_codes WHERE phone = ? AND used = 0 ORDER BY created_at DESC LIMIT 1`
  ).bind(phone).first<{ code: string }>();
  if (!row) return Response.json({ error: 'No active code' }, { status: 404 });
  return Response.json({ code: row.code });
}

export async function handleAuthRoutes(
  request: Request,
  env: Env,
  pathname: string
): Promise<Response | null> {
  if (pathname === '/api/auth/login' && request.method === 'POST') {
    return handleLogin(request, env);
  }
  if (pathname === '/api/auth/register' && request.method === 'POST') {
    return handleRegister(request, env);
  }
  if (pathname === '/api/auth/verify' && request.method === 'POST') {
    return handleVerify(request, env);
  }
  if (pathname === '/api/auth/logout' && request.method === 'DELETE') {
    return handleLogout(request, env);
  }
  if (pathname === '/api/auth/me' && request.method === 'GET') {
    return handleMe(request, env);
  }
  const testOtpMatch = pathname.match(/^\/api\/test\/latest-otp\/([0-9]+)$/);
  if (testOtpMatch && request.method === 'GET' && env.ENVIRONMENT === 'test') {
    // Belt-and-suspenders host gate: even with ENVIRONMENT=test (one env-var
    // flip away in the dashboard), this OTP-reading route must never answer
    // on a public hostname. Log before falling through — rejected input must
    // be visible (never silently dropped).
    if (!isLocalHostname(request)) {
      console.warn('test route denied on host', new URL(request.url).hostname);
      return null;
    }
    return handleTestLatestOtp(env, testOtpMatch[1]);
  }
  return null;
}


// Test-only routes answer exclusively on local hostnames, regardless of
// ENVIRONMENT. Exported for the client-events test route to share.
export function isLocalHostname(request: Request): boolean {
  const hostname = new URL(request.url).hostname;
  return hostname === 'localhost' || hostname === '127.0.0.1';
}

// Per-IP rate-limit dimension. Omitted (undefined) in the test environment:
// local .wrangler/state KV persists across e2e runs, and every local request
// shares one bucket, so repeated runs would eventually 429.
function clientIp(request: Request, env: Env): string | undefined {
  if (env.ENVIRONMENT === 'test') return undefined;
  return request.headers.get('CF-Connecting-IP') ?? 'unknown';
}


// Auth request bodies are tiny (a phone, maybe a 6-digit code). Cap the read
// hard so a pre-auth client can't buffer a huge body into the isolate before
// the handler runs — the streamed cap aborts instead of buffering-then-checking.
const MAX_AUTH_BODY_BYTES = 4096;
async function readJsonCapped<T extends object>(request: Request): Promise<T | null | 'too_large'> {
  const raw = await readBodyCapped(request, MAX_AUTH_BODY_BYTES);
  if (raw === null) return 'too_large';
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

async function handleLogin(request: Request, env: Env): Promise<Response> {
  const parsed = await readJsonCapped<{ phone?: string }>(request);
  if (parsed === 'too_large') {
    console.warn('auth body rejected', 'too large', request.url);
    return Response.json({ error: 'Body too large' }, { status: 413 });
  }
  if (parsed === null) {
    console.warn('auth body rejected', 'invalid json', request.url);
    return Response.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  const phone = normalizePhone(parsed.phone ?? null);
  if (!phone) {
    console.warn('auth body rejected', 'phone required', request.url);
    return Response.json({ error: 'phone is required' }, { status: 400 });
  }
  const limit = await checkOtpSendLimit(env.SESSIONS, phone, { skipGlobal: env.ENVIRONMENT === 'test', ip: clientIp(request, env) });
  if (!limit.allowed) {
    return Response.json({ error: 'Too many code requests. Try again later.' }, { status: 429 });
  }
  const user = await env.DB.prepare(
    `SELECT id FROM users WHERE phone = ? AND active = 1`
  ).bind(phone).first<{ id: string }>();
  if (!user) {
    return Response.json({ error: 'No account found for this phone number' }, { status: 404 });
  }
  const code = await createOtp(env.DB, phone);
  if (env.ENVIRONMENT !== 'test') {
    await sendOtpSms(env.TWILIO_ACCOUNT_SID, env.TWILIO_AUTH_TOKEN, env.TWILIO_PHONE_NUMBER, phone, code);
  }
  return Response.json({ message: 'Code sent' });
}

async function handleRegister(request: Request, env: Env): Promise<Response> {
  const parsed = await readJsonCapped<{ name?: string; phone?: string }>(request);
  if (parsed === 'too_large') {
    console.warn('auth body rejected', 'too large', request.url);
    return Response.json({ error: 'Body too large' }, { status: 413 });
  }
  if (parsed === null) {
    console.warn('auth body rejected', 'invalid json', request.url);
    return Response.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  const name = parsed.name?.trim();
  const phone = normalizePhone(parsed.phone ?? null);
  if (!name) {
    console.warn('auth body rejected', 'name required', request.url);
    return Response.json({ error: 'name is required' }, { status: 400 });
  }
  if (!phone) {
    console.warn('auth body rejected', 'phone required', request.url);
    return Response.json({ error: 'phone is required' }, { status: 400 });
  }
  const limit = await checkOtpSendLimit(env.SESSIONS, phone, { skipGlobal: env.ENVIRONMENT === 'test', ip: clientIp(request, env) });
  if (!limit.allowed) {
    return Response.json({ error: 'Too many code requests. Try again later.' }, { status: 429 });
  }
  const existing = await env.DB.prepare(
    `SELECT id FROM users WHERE phone = ?`
  ).bind(phone).first();
  if (existing) {
    return Response.json({ error: 'Phone already registered. Please log in.' }, { status: 409 });
  }
  const id = crypto.randomUUID().replace(/-/g, '');
  try {
    await env.DB.prepare(
      `INSERT INTO users (id, name, phone, role, active, self_registered) VALUES (?, ?, ?, 'volunteer', 1, 1)`
    ).bind(id, name, phone).run();
  } catch (err: unknown) {
    if (err instanceof Error && err.message.includes('UNIQUE constraint failed')) {
      return Response.json({ error: 'Phone already registered. Please log in.' }, { status: 409 });
    }
    throw err;
  }
  const code = await createOtp(env.DB, phone);
  if (env.ENVIRONMENT !== 'test') {
    await sendOtpSms(env.TWILIO_ACCOUNT_SID, env.TWILIO_AUTH_TOKEN, env.TWILIO_PHONE_NUMBER, phone, code);
  }
  return Response.json({ message: 'Code sent' });
}

async function handleVerify(request: Request, env: Env): Promise<Response> {
  const parsed = await readJsonCapped<{ phone?: string; code?: string }>(request);
  if (parsed === 'too_large') {
    console.warn('auth body rejected', 'too large', request.url);
    return Response.json({ error: 'Body too large' }, { status: 413 });
  }
  if (parsed === null) {
    console.warn('auth body rejected', 'invalid json', request.url);
    return Response.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  const phone = normalizePhone(parsed.phone ?? null);
  const code = parsed.code?.trim();
  if (!phone || !code) {
    console.warn('auth body rejected', 'phone and code required', request.url);
    return Response.json({ error: 'phone and code are required' }, { status: 400 });
  }
  const limit = await checkVerifyLimit(env.SESSIONS, phone, { ip: clientIp(request, env) });
  if (!limit.allowed) {
    return Response.json({ error: 'Too many verification attempts. Try again later.' }, { status: 429 });
  }
  const valid = await verifyOtp(env.DB, phone, code);
  if (!valid) {
    return Response.json({ error: 'Invalid or expired code' }, { status: 401 });
  }
  const user = await env.DB.prepare(
    `SELECT id, name, phone, role FROM users WHERE phone = ? AND active = 1`
  ).bind(phone).first<{ id: string; name: string; phone: string; role: string }>();
  if (!user) {
    return Response.json({ error: 'User not found' }, { status: 404 });
  }
  const { token, payload } = await buildSession(
    user.id, user.phone, user.role as 'admin' | 'staff' | 'volunteer', env.JWT_SECRET
  );
  await createSession(env.SESSIONS, payload);
  return Response.json({ token, user: { id: user.id, name: user.name, phone: user.phone, role: user.role } });
}

async function handleLogout(request: Request, env: Env): Promise<Response> {
  const ctx = await getAuthContext(request, env);
  if (!ctx) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }
  await destroySession(env.SESSIONS, ctx.sessionId);
  return Response.json({ message: 'Logged out' });
}

async function handleMe(request: Request, env: Env): Promise<Response> {
  const ctx = await getAuthContext(request, env);
  if (!ctx) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const user = await env.DB.prepare(
    `SELECT id, name, phone, role FROM users WHERE id = ?`
  ).bind(ctx.userId).first<{ id: string; name: string; phone: string; role: string }>();
  if (!user) {
    return Response.json({ error: 'User not found' }, { status: 404 });
  }
  return Response.json(user);
}
