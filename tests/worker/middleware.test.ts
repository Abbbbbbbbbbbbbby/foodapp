import { env } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';
import { getAuthContext, requireRole } from '../../src/worker/middleware';
import { buildSession, createSession } from '../../src/worker/auth';
import type { Env } from '../../src/worker/schema';

async function makeAuthHeader(
  userId: string,
  role: 'admin' | 'staff' | 'volunteer'
): Promise<string> {
  const e = env as unknown as Env;
  const { token, payload } = await buildSession(userId, '4805551234', role, e.JWT_SECRET);
  await createSession(e.SESSIONS, payload);
  return `Bearer ${token}`;
}

describe('getAuthContext', () => {
  it('returns context for a valid token', async () => {
    const e = env as unknown as Env;
    const authHeader = await makeAuthHeader('user-1', 'volunteer');
    const req = new Request('https://example.com', {
      headers: { Authorization: authHeader },
    });
    const ctx = await getAuthContext(req, e);
    expect(ctx).not.toBeNull();
    expect(ctx!.userId).toBe('user-1');
    expect(ctx!.role).toBe('volunteer');
  });

  it('returns null when Authorization header is missing', async () => {
    const e = env as unknown as Env;
    const req = new Request('https://example.com');
    const ctx = await getAuthContext(req, e);
    expect(ctx).toBeNull();
  });

  it('returns null for a malformed token', async () => {
    const e = env as unknown as Env;
    const req = new Request('https://example.com', {
      headers: { Authorization: 'Bearer not.a.jwt' },
    });
    const ctx = await getAuthContext(req, e);
    expect(ctx).toBeNull();
  });

  it('returns null when session has been destroyed', async () => {
    const e = env as unknown as Env;
    const { token, payload } = await buildSession('user-2', '4805551234', 'staff', e.JWT_SECRET);
    await createSession(e.SESSIONS, payload);
    await e.SESSIONS.delete(`session:${payload.sessionId}`);
    const req = new Request('https://example.com', {
      headers: { Authorization: `Bearer ${token}` },
    });
    const ctx = await getAuthContext(req, e);
    expect(ctx).toBeNull();
  });
});

describe('requireRole', () => {
  it('returns AuthContext when role matches', async () => {
    const e = env as unknown as Env;
    const authHeader = await makeAuthHeader('admin-1', 'admin');
    const req = new Request('https://example.com', {
      headers: { Authorization: authHeader },
    });
    const result = await requireRole('admin')(req, e);
    expect(result instanceof Response).toBe(false);
    expect((result as { role: string }).role).toBe('admin');
  });

  it('returns 401 when no token provided', async () => {
    const e = env as unknown as Env;
    const req = new Request('https://example.com');
    const result = await requireRole('admin')(req, e);
    expect(result instanceof Response).toBe(true);
    expect((result as Response).status).toBe(401);
  });

  it('returns 403 when role is insufficient', async () => {
    const e = env as unknown as Env;
    const authHeader = await makeAuthHeader('vol-1', 'volunteer');
    const req = new Request('https://example.com', {
      headers: { Authorization: authHeader },
    });
    const result = await requireRole('admin', 'staff')(req, e);
    expect(result instanceof Response).toBe(true);
    expect((result as Response).status).toBe(403);
  });

  it('accepts multiple allowed roles', async () => {
    const e = env as unknown as Env;
    const authHeader = await makeAuthHeader('staff-1', 'staff');
    const req = new Request('https://example.com', {
      headers: { Authorization: authHeader },
    });
    const result = await requireRole('admin', 'staff')(req, e);
    expect(result instanceof Response).toBe(false);
    expect((result as { role: string }).role).toBe('staff');
  });

  it('throws when called with no roles', () => {
    expect(() => requireRole()).toThrow('requireRole: at least one role is required');
  });
});
