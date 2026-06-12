import { env, SELF } from 'cloudflare:test';
import { describe, it, expect, beforeEach } from 'vitest';
import { createOtp } from '../../../src/worker/otp';
import { buildSession, createSession } from '../../../src/worker/auth';
import type { Env } from '../../../src/worker/schema';

beforeEach(async () => {
  const db = (env as unknown as Env).DB;
  await db.prepare('DELETE FROM otp_codes').run();
  await db.prepare('DELETE FROM users').run();
});

async function seedUser(phone: string, role: 'admin' | 'staff' | 'volunteer' = 'volunteer') {
  const db = (env as unknown as Env).DB;
  const id = crypto.randomUUID().replace(/-/g, '');
  await db.prepare(
    `INSERT INTO users (id, name, phone, role) VALUES (?, ?, ?, ?)`
  ).bind(id, 'Test User', phone, role).run();
  return id;
}

async function makeAuthToken(userId: string, role: 'admin' | 'staff' | 'volunteer') {
  const e = env as unknown as Env;
  const { token, payload } = await buildSession(userId, '4805551234', role, e.JWT_SECRET);
  await createSession(e.SESSIONS, payload);
  return token;
}

describe('POST /api/auth/login', () => {
  it('returns 200 when user exists', async () => {
    await seedUser('4805551234');
    const res = await SELF.fetch('https://example.com/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: '4805551234' }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { message: string };
    expect(body.message).toBe('Code sent');
  });

  it('returns 404 when user does not exist', async () => {
    const res = await SELF.fetch('https://example.com/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: '9999999999' }),
    });
    expect(res.status).toBe(404);
  });

  it('returns 400 for a missing phone', async () => {
    const res = await SELF.fetch('https://example.com/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });
});

describe('POST /api/auth/register', () => {
  it('creates a volunteer account and returns 200', async () => {
    const res = await SELF.fetch('https://example.com/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Rosa Mendez', phone: '4805551234' }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { message: string };
    expect(body.message).toBe('Code sent');
    const db = (env as unknown as Env).DB;
    const user = await db.prepare(
      `SELECT role FROM users WHERE phone = ?`
    ).bind('4805551234').first<{ role: string }>();
    expect(user?.role).toBe('volunteer');
  });

  it('returns 409 when phone already registered', async () => {
    await seedUser('4805551234');
    const res = await SELF.fetch('https://example.com/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Rosa Mendez', phone: '4805551234' }),
    });
    expect(res.status).toBe(409);
  });

  it('returns 400 for missing name', async () => {
    const res = await SELF.fetch('https://example.com/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: '4805551234' }),
    });
    expect(res.status).toBe(400);
  });
});

describe('POST /api/auth/verify', () => {
  it('returns a JWT token on valid OTP', async () => {
    const userId = await seedUser('4805551234');
    const db = (env as unknown as Env).DB;
    const code = await createOtp(db, '4805551234');
    const res = await SELF.fetch('https://example.com/api/auth/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: '4805551234', code }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { token: string; user: { id: string; role: string } };
    expect(body.token).toBeTruthy();
    expect(body.user.id).toBe(userId);
    expect(body.user.role).toBe('volunteer');
  });

  it('returns 401 for an invalid code', async () => {
    await seedUser('4805551234');
    await createOtp((env as unknown as Env).DB, '4805551234');
    const res = await SELF.fetch('https://example.com/api/auth/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: '4805551234', code: '000000' }),
    });
    expect(res.status).toBe(401);
  });
});

describe('DELETE /api/auth/logout', () => {
  it('destroys the session and returns 200', async () => {
    const userId = await seedUser('4805551234');
    const token = await makeAuthToken(userId, 'volunteer');
    const res = await SELF.fetch('https://example.com/api/auth/logout', {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
  });

  it('returns 401 when not authenticated', async () => {
    const res = await SELF.fetch('https://example.com/api/auth/logout', {
      method: 'DELETE',
    });
    expect(res.status).toBe(401);
  });
});

describe('GET /api/auth/me', () => {
  it('returns user info for authenticated request', async () => {
    const userId = await seedUser('4805551234', 'staff');
    const token = await makeAuthToken(userId, 'staff');
    const res = await SELF.fetch('https://example.com/api/auth/me', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { id: string; role: string };
    expect(body.id).toBe(userId);
    expect(body.role).toBe('staff');
  });

  it('returns 401 when not authenticated', async () => {
    const res = await SELF.fetch('https://example.com/api/auth/me');
    expect(res.status).toBe(401);
  });
});
