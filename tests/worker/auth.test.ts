import { env } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';
import {
  signJwt,
  verifyJwt,
  buildSession,
  createSession,
  getSession,
  destroySession,
} from '../../src/worker/auth';
import type { Env, UserRole } from '../../src/worker/schema';

const SECRET = 'test-secret-do-not-use-in-production-aabbccdd';

describe('signJwt + verifyJwt', () => {
  it('round-trips a valid payload', async () => {
    const payload = {
      userId: 'abc123',
      phone: '4805551234',
      role: 'volunteer' as UserRole,
      sessionId: 'sess1',
      exp: Math.floor(Date.now() / 1000) + 3600,
    };
    const token = await signJwt(payload, SECRET);
    expect(token.split('.').length).toBe(3);
    const decoded = await verifyJwt(token, SECRET);
    expect(decoded).not.toBeNull();
    expect(decoded!.userId).toBe('abc123');
    expect(decoded!.role).toBe('volunteer');
  });

  it('returns null for a tampered token', async () => {
    const payload = {
      userId: 'abc123',
      phone: '4805551234',
      role: 'admin' as UserRole,
      sessionId: 'sess1',
      exp: Math.floor(Date.now() / 1000) + 3600,
    };
    const token = await signJwt(payload, SECRET);
    const parts = token.split('.');
    // Flip a middle character of the signature: the final base64url char has
    // 4 dead padding bits, so tampering there can decode to identical bytes.
    const sig = parts[2];
    const flipped = sig[5] === 'A' ? 'B' : 'A';
    const tampered = `${parts[0]}.${parts[1]}.${sig.slice(0, 5)}${flipped}${sig.slice(6)}`;
    const result = await verifyJwt(tampered, SECRET);
    expect(result).toBeNull();
  });

  it('returns null for an expired token', async () => {
    const payload = {
      userId: 'abc123',
      phone: '4805551234',
      role: 'staff' as UserRole,
      sessionId: 'sess1',
      exp: Math.floor(Date.now() / 1000) - 1,
    };
    const token = await signJwt(payload, SECRET);
    const result = await verifyJwt(token, SECRET);
    expect(result).toBeNull();
  });

  it('returns null for a wrong secret', async () => {
    const payload = {
      userId: 'abc123',
      phone: '4805551234',
      role: 'volunteer' as UserRole,
      sessionId: 'sess1',
      exp: Math.floor(Date.now() / 1000) + 3600,
    };
    const token = await signJwt(payload, SECRET);
    const result = await verifyJwt(token, 'wrong-secret');
    expect(result).toBeNull();
  });
});

describe('session KV', () => {
  const kv = () => (env as unknown as Env).SESSIONS;

  it('creates and retrieves a session', async () => {
    const payload = {
      userId: 'u1',
      phone: '4805551234',
      role: 'volunteer' as UserRole,
      sessionId: 'sess-kv-1',
      exp: Math.floor(Date.now() / 1000) + 3600,
    };
    await createSession(kv(), payload);
    const result = await getSession(kv(), 'sess-kv-1');
    expect(result).not.toBeNull();
    expect(result!.userId).toBe('u1');
  });

  it('returns null after session is destroyed', async () => {
    const payload = {
      userId: 'u2',
      phone: '4805551234',
      role: 'volunteer' as UserRole,
      sessionId: 'sess-kv-2',
      exp: Math.floor(Date.now() / 1000) + 3600,
    };
    await createSession(kv(), payload);
    await destroySession(kv(), 'sess-kv-2');
    const result = await getSession(kv(), 'sess-kv-2');
    expect(result).toBeNull();
  });
});

describe('buildSession', () => {
  it('produces a token and payload with a sessionId', async () => {
    const { token, payload } = await buildSession('u1', '4805551234', 'admin', SECRET);
    expect(token.split('.').length).toBe(3);
    expect(payload.sessionId).toBeTruthy();
    expect(payload.role).toBe('admin');
  });
});
