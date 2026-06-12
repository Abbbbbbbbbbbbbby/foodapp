import type { Env } from '../schema';
import { createOtp, sendOtpSms, verifyOtp } from '../otp';
import { buildSession, createSession, destroySession } from '../auth';
import { getAuthContext } from '../middleware';
import { normalizePhone } from '../db';

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
  return null;
}

async function handleLogin(request: Request, env: Env): Promise<Response> {
  const body = await request.json<{ phone?: string }>();
  const phone = normalizePhone(body.phone ?? null);
  if (!phone) {
    return Response.json({ error: 'phone is required' }, { status: 400 });
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
  const body = await request.json<{ name?: string; phone?: string }>();
  const name = body.name?.trim();
  const phone = normalizePhone(body.phone ?? null);
  if (!name) {
    return Response.json({ error: 'name is required' }, { status: 400 });
  }
  if (!phone) {
    return Response.json({ error: 'phone is required' }, { status: 400 });
  }
  const existing = await env.DB.prepare(
    `SELECT id FROM users WHERE phone = ?`
  ).bind(phone).first();
  if (existing) {
    return Response.json({ error: 'Phone already registered. Please log in.' }, { status: 409 });
  }
  const id = crypto.randomUUID().replace(/-/g, '');
  await env.DB.prepare(
    `INSERT INTO users (id, name, phone, role, active, self_registered) VALUES (?, ?, ?, 'volunteer', 1, 1)`
  ).bind(id, name, phone).run();
  const code = await createOtp(env.DB, phone);
  if (env.ENVIRONMENT !== 'test') {
    await sendOtpSms(env.TWILIO_ACCOUNT_SID, env.TWILIO_AUTH_TOKEN, env.TWILIO_PHONE_NUMBER, phone, code);
  }
  return Response.json({ message: 'Code sent' });
}

async function handleVerify(request: Request, env: Env): Promise<Response> {
  const body = await request.json<{ phone?: string; code?: string }>();
  const phone = normalizePhone(body.phone ?? null);
  const code = body.code?.trim();
  if (!phone || !code) {
    return Response.json({ error: 'phone and code are required' }, { status: 400 });
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
