import { env, SELF } from 'cloudflare:test';
import { describe, it, expect, beforeAll } from 'vitest';
import { buildSession, createSession } from '../../../src/worker/auth';
import type { Env } from '../../../src/worker/schema';

const USER_ID = 'testvisituser001';
const USER_PHONE = '4805550101';
let authHeader: string;
let testFamilyId: string;

beforeAll(async () => {
  const e = env as unknown as Env;
  await e.DB.prepare(
    `INSERT OR IGNORE INTO users (id, name, phone, role, active, self_registered) VALUES (?, 'Visit Tester', ?, 'volunteer', 1, 1)`
  ).bind(USER_ID, USER_PHONE).run();
  const { token, payload } = await buildSession(USER_ID, USER_PHONE, 'volunteer', e.JWT_SECRET);
  await createSession(e.SESSIONS, payload);
  authHeader = `Bearer ${token}`;
  testFamilyId = crypto.randomUUID().replace(/-/g, '');
  await e.DB.prepare(
    `INSERT INTO families (id, name, created_at, updated_at) VALUES (?, 'Visit Family', datetime('now'), datetime('now'))`
  ).bind(testFamilyId).run();
});

describe('POST /api/visits', () => {
  it('returns 401 without auth', async () => {
    const res = await SELF.fetch('http://example.com/api/visits', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ family_id: testFamilyId }),
    });
    expect(res.status).toBe(401);
  });

  it('returns 400 without family_id', async () => {
    const res = await SELF.fetch('http://example.com/api/visits', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: authHeader },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  it('creates visit and returns id', async () => {
    const res = await SELF.fetch('http://example.com/api/visits', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: authHeader },
      body: JSON.stringify({ family_id: testFamilyId }),
    });
    expect(res.status).toBe(201);
    const data = await res.json<{ id: string }>();
    expect(typeof data.id).toBe('string');
  });
});

describe('GET /api/visits', () => {
  it('returns 401 without auth', async () => {
    const res = await SELF.fetch(`http://example.com/api/visits?familyId=${testFamilyId}`);
    expect(res.status).toBe(401);
  });

  it('returns 400 without familyId', async () => {
    const res = await SELF.fetch('http://example.com/api/visits', {
      headers: { Authorization: authHeader },
    });
    expect(res.status).toBe(400);
  });

  it('returns visits array', async () => {
    const res = await SELF.fetch(`http://example.com/api/visits?familyId=${testFamilyId}`, {
      headers: { Authorization: authHeader },
    });
    expect(res.status).toBe(200);
    const data = await res.json<{ visits: unknown[] }>();
    expect(Array.isArray(data.visits)).toBe(true);
  });
});
