import { env, exports as workerExports } from 'cloudflare:workers';
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

describe('POST /api/visits — malformed JSON', () => {
  it('returns 400 for non-JSON body', async () => {
    const res = await workerExports.default.fetch('http://example.com/api/visits', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: authHeader },
      body: 'not json {{{',
    });
    expect(res.status).toBe(400);
    const data = await res.json<{ error: string }>();
    expect(data.error).toMatch(/JSON/i);
  });
});

describe('POST /api/visits — idempotency', () => {
  it('returns the same id for the same idempotency_key', async () => {
    const key = `visit-idem-${Date.now()}`;
    const body = { family_id: testFamilyId, idempotency_key: key, visit_date: '2026-01-01' };
    const r1 = await workerExports.default.fetch('http://example.com/api/visits', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: authHeader },
      body: JSON.stringify(body),
    });
    const r2 = await workerExports.default.fetch('http://example.com/api/visits', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: authHeader },
      body: JSON.stringify(body),
    });
    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);
    const d1 = await r1.json<{ id: string }>();
    const d2 = await r2.json<{ id: string }>();
    expect(d1.id).toBe(d2.id);
  });
});

describe('POST /api/visits', () => {
  it('returns 401 without auth', async () => {
    const res = await workerExports.default.fetch('http://example.com/api/visits', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ family_id: testFamilyId }),
    });
    expect(res.status).toBe(401);
  });

  it('returns 400 without family_id', async () => {
    const res = await workerExports.default.fetch('http://example.com/api/visits', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: authHeader },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  it('returns 400 without visit_date', async () => {
    const res = await workerExports.default.fetch('http://example.com/api/visits', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: authHeader },
      body: JSON.stringify({ family_id: testFamilyId }),
    });
    expect(res.status).toBe(400);
  });

  it('creates visit and returns id', async () => {
    const res = await workerExports.default.fetch('http://example.com/api/visits', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: authHeader },
      body: JSON.stringify({ family_id: testFamilyId, visit_date: '2026-01-01' }),
    });
    expect(res.status).toBe(201);
    const data = await res.json<{ id: string }>();
    expect(typeof data.id).toBe('string');
  });
});

describe('GET /api/visits', () => {
  it('returns 401 without auth', async () => {
    const res = await workerExports.default.fetch(`http://example.com/api/visits?familyId=${testFamilyId}`);
    expect(res.status).toBe(401);
  });

  it('returns 400 without familyId', async () => {
    const res = await workerExports.default.fetch('http://example.com/api/visits', {
      headers: { Authorization: authHeader },
    });
    expect(res.status).toBe(400);
  });

  it('returns visits array', async () => {
    const res = await workerExports.default.fetch(`http://example.com/api/visits?familyId=${testFamilyId}`, {
      headers: { Authorization: authHeader },
    });
    expect(res.status).toBe(200);
    const data = await res.json<{ visits: unknown[] }>();
    expect(Array.isArray(data.visits)).toBe(true);
  });
});
