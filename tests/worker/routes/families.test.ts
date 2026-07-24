import { env, SELF } from 'cloudflare:test';
import { describe, it, expect, beforeAll } from 'vitest';
import { buildSession, createSession } from '../../../src/worker/auth';
import type { Env } from '../../../src/worker/schema';

const USER_ID = 'testfamilyuser01';
const USER_PHONE = '4805550100';
let authHeader: string;

async function insertFamily(name: string, phone?: string): Promise<string> {
  const e = env as unknown as Env;
  const id = crypto.randomUUID().replace(/-/g, '');
  await e.DB.prepare(
    `INSERT INTO families (id, name, phone, created_at, updated_at) VALUES (?, ?, ?, datetime('now'), datetime('now'))`
  ).bind(id, name, phone ?? null).run();
  return id;
}

beforeAll(async () => {
  const e = env as unknown as Env;
  await e.DB.prepare(
    `INSERT OR IGNORE INTO users (id, name, phone, role, active, self_registered) VALUES (?, 'Family Tester', ?, 'volunteer', 1, 1)`
  ).bind(USER_ID, USER_PHONE).run();
  const { token, payload } = await buildSession(USER_ID, USER_PHONE, 'volunteer', e.JWT_SECRET);
  await createSession(e.SESSIONS, payload);
  authHeader = `Bearer ${token}`;
});

describe('GET /api/families/search', () => {
  it('returns 401 without auth', async () => {
    const res = await SELF.fetch('http://example.com/api/families/search?name=Smith');
    expect(res.status).toBe(401);
  });

  it('returns 400 without name or phone', async () => {
    const res = await SELF.fetch('http://example.com/api/families/search', {
      headers: { Authorization: authHeader },
    });
    expect(res.status).toBe(400);
  });

  it('returns results by name', async () => {
    await insertFamily('Smith Family');
    const res = await SELF.fetch('http://example.com/api/families/search?name=Smith', {
      headers: { Authorization: authHeader },
    });
    expect(res.status).toBe(200);
    const data = await res.json<{ results: unknown[] }>();
    expect(Array.isArray(data.results)).toBe(true);
    expect(data.results.length).toBeGreaterThan(0);
  });
});

describe('GET /api/families/pickup', () => {
  it('returns 401 without auth', async () => {
    const res = await SELF.fetch('http://example.com/api/families/pickup?phone=4805550200');
    expect(res.status).toBe(401);
  });

  it('returns 400 without phone', async () => {
    const res = await SELF.fetch('http://example.com/api/families/pickup', {
      headers: { Authorization: authHeader },
    });
    expect(res.status).toBe(400);
  });

  it('returns own family when phone matches', async () => {
    await insertFamily('Pickup Family', '4805550200');
    const res = await SELF.fetch('http://example.com/api/families/pickup?phone=4805550200', {
      headers: { Authorization: authHeader },
    });
    expect(res.status).toBe(200);
    const data = await res.json<{ own: { name: string } | null; proxy: unknown[] }>();
    expect(data.own?.name).toBe('Pickup Family');
  });
});

describe('POST /api/families — malformed JSON', () => {
  it('returns 400 for non-JSON body', async () => {
    const res = await SELF.fetch('http://example.com/api/families', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: authHeader },
      body: 'not json {{{',
    });
    expect(res.status).toBe(400);
    const data = await res.json<{ error: string }>();
    expect(data.error).toMatch(/JSON/i);
  });
});

describe('PATCH /api/families/:id — enum validation', () => {
  it('returns 400 for invalid hispanic value', async () => {
    const id = await insertFamily('Enum Test');
    const res = await SELF.fetch(`http://example.com/api/families/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: authHeader },
      body: JSON.stringify({ hispanic: 'maybe' }),
    });
    expect(res.status).toBe(400);
    const data = await res.json<{ error: string }>();
    expect(data.error).toContain('hispanic');
  });

  it('returns 400 for invalid ami_bracket value', async () => {
    const id = await insertFamily('Enum Test 2');
    const res = await SELF.fetch(`http://example.com/api/families/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: authHeader },
      body: JSON.stringify({ ami_bracket: 'rich' }),
    });
    expect(res.status).toBe(400);
    const data = await res.json<{ error: string }>();
    expect(data.error).toContain('ami_bracket');
  });
});

describe('POST /api/families — idempotency', () => {
  it('returns the same id for the same idempotency_key', async () => {
    const key = `test-idem-${Date.now()}`;
    const body = { name: 'Idem Route Family', idempotency_key: key };
    const r1 = await SELF.fetch('http://example.com/api/families', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: authHeader },
      body: JSON.stringify(body),
    });
    const r2 = await SELF.fetch('http://example.com/api/families', {
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

describe('POST /api/families', () => {
  it('returns 401 without auth', async () => {
    const res = await SELF.fetch('http://example.com/api/families', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Test' }),
    });
    expect(res.status).toBe(401);
  });

  it('returns 400 without name', async () => {
    const res = await SELF.fetch('http://example.com/api/families', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: authHeader },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  it('creates family and returns id', async () => {
    const res = await SELF.fetch('http://example.com/api/families', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: authHeader },
      body: JSON.stringify({ name: 'New Family', num_people: 3 }),
    });
    expect(res.status).toBe(201);
    const data = await res.json<{ id: string }>();
    expect(typeof data.id).toBe('string');
    expect(data.id.length).toBeGreaterThan(0);
  });
});

describe('PATCH /api/families/:id', () => {
  it('returns 401 without auth', async () => {
    const id = await insertFamily('Patch Target');
    const res = await SELF.fetch(`http://example.com/api/families/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ num_people: 5 }),
    });
    expect(res.status).toBe(401);
  });

  it('updates family', async () => {
    const id = await insertFamily('Patchable');
    const res = await SELF.fetch(`http://example.com/api/families/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: authHeader },
      body: JSON.stringify({ num_people: 5 }),
    });
    expect(res.status).toBe(200);
    const data = await res.json<{ ok: boolean }>();
    expect(data.ok).toBe(true);
  });
});
