import { env, exports as workerExports } from 'cloudflare:workers';
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
    const res = await workerExports.default.fetch('http://example.com/api/families/search?name=Smith');
    expect(res.status).toBe(401);
  });

  it('returns 400 without name or phone', async () => {
    const res = await workerExports.default.fetch('http://example.com/api/families/search', {
      headers: { Authorization: authHeader },
    });
    expect(res.status).toBe(400);
  });

  it('returns results by name', async () => {
    await insertFamily('Smith Family');
    const res = await workerExports.default.fetch('http://example.com/api/families/search?name=Smith', {
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
    const res = await workerExports.default.fetch('http://example.com/api/families/pickup?phone=4805550200');
    expect(res.status).toBe(401);
  });

  it('returns 400 without phone', async () => {
    const res = await workerExports.default.fetch('http://example.com/api/families/pickup', {
      headers: { Authorization: authHeader },
    });
    expect(res.status).toBe(400);
  });

  it('returns own family when phone matches', async () => {
    await insertFamily('Pickup Family', '4805550200');
    const res = await workerExports.default.fetch('http://example.com/api/families/pickup?phone=4805550200', {
      headers: { Authorization: authHeader },
    });
    expect(res.status).toBe(200);
    const data = await res.json<{ own: { name: string } | null; proxy: unknown[] }>();
    expect(data.own?.name).toBe('Pickup Family');
  });
});

describe('POST /api/families — malformed JSON', () => {
  it('returns 400 for non-JSON body', async () => {
    const res = await workerExports.default.fetch('http://example.com/api/families', {
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
    const res = await workerExports.default.fetch(`http://example.com/api/families/${id}`, {
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
    const res = await workerExports.default.fetch(`http://example.com/api/families/${id}`, {
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
    const r1 = await workerExports.default.fetch('http://example.com/api/families', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: authHeader },
      body: JSON.stringify(body),
    });
    const r2 = await workerExports.default.fetch('http://example.com/api/families', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: authHeader },
      body: JSON.stringify(body),
    });
    expect(r1.status).toBe(201); // genuinely created
    expect(r2.status).toBe(200); // idempotent replay
    const d1 = await r1.json<{ id: string }>();
    const d2 = await r2.json<{ id: string }>();
    expect(d1.id).toBe(d2.id);
  });
});

describe('POST /api/families', () => {
  it('returns 401 without auth', async () => {
    const res = await workerExports.default.fetch('http://example.com/api/families', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Test' }),
    });
    expect(res.status).toBe(401);
  });

  it('returns 400 without name', async () => {
    const res = await workerExports.default.fetch('http://example.com/api/families', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: authHeader },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  it('creates family and returns id', async () => {
    const res = await workerExports.default.fetch('http://example.com/api/families', {
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
    const res = await workerExports.default.fetch(`http://example.com/api/families/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ num_people: 5 }),
    });
    expect(res.status).toBe(401);
  });

  it('updates family', async () => {
    const id = await insertFamily('Patchable');
    const res = await workerExports.default.fetch(`http://example.com/api/families/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: authHeader },
      body: JSON.stringify({ num_people: 5 }),
    });
    expect(res.status).toBe(200);
    const data = await res.json<{ ok: boolean }>();
    expect(data.ok).toBe(true);
  });
});

describe('POST /api/families/:id/proxies', () => {
  async function createFamily(name: string): Promise<string> {
    const res = await workerExports.default.fetch('https://x/api/families', {
      method: 'POST',
      headers: { Authorization: authHeader, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    const body = await res.json() as { id: string };
    return body.id;
  }

  it('persists a normalized proxy and is idempotent on re-add', async () => {
    const famId = await createFamily('Proxy Target Family');
    for (let i = 0; i < 2; i++) {
      const res = await workerExports.default.fetch(`https://x/api/families/${famId}/proxies`, {
        method: 'POST',
        headers: { Authorization: authHeader, 'Content-Type': 'application/json' },
        body: JSON.stringify({ proxy_name: 'Helper Person', proxy_phone: '(480) 555-0199' }),
      });
      expect(res.status).toBe(200);
    }
    const rows = await env.DB.prepare(
      `SELECT proxy_name, proxy_phone FROM proxies WHERE family_id = ?`
    ).bind(famId).all<{ proxy_name: string; proxy_phone: string }>();
    expect(rows.results!.length).toBe(1);
    expect(rows.results![0].proxy_phone).toBe('4805550199');
  });

  it('surfaces the added family in pickup lookup by proxy phone', async () => {
    const famId = await createFamily('Pickup Via Proxy Family');
    await workerExports.default.fetch(`https://x/api/families/${famId}/proxies`, {
      method: 'POST',
      headers: { Authorization: authHeader, 'Content-Type': 'application/json' },
      body: JSON.stringify({ proxy_name: 'Neighbor', proxy_phone: '4805550777' }),
    });
    const res = await workerExports.default.fetch('https://x/api/families/pickup?phone=4805550777', {
      headers: { Authorization: authHeader },
    });
    const body = await res.json() as { proxy: Array<{ id: string }> };
    expect(body.proxy.some(f => f.id === famId)).toBe(true);
  });

  it('persists a phone-only authorization with NULL name (issue #7: appears next time) and 404s for a missing family', async () => {
    const famId = await createFamily('Validation Family');
    const noName = await workerExports.default.fetch(`https://x/api/families/${famId}/proxies`, {
      method: 'POST',
      headers: { Authorization: authHeader, 'Content-Type': 'application/json' },
      body: JSON.stringify({ proxy_phone: '4805550001' }),
    });
    expect(noName.status).toBe(200);
    // The functional requirement: this family now surfaces on the phone's pickups
    const pickup = await workerExports.default.fetch('https://x/api/families/pickup?phone=4805550001', {
      headers: { Authorization: authHeader },
    });
    const body = await pickup.json() as { proxy: Array<{ id: string }> };
    expect(body.proxy.some(f => f.id === famId)).toBe(true);
    const missing = await workerExports.default.fetch('https://x/api/families/ffffffffffffffff/proxies', {
      method: 'POST',
      headers: { Authorization: authHeader, 'Content-Type': 'application/json' },
      body: JSON.stringify({ proxy_name: 'X' }),
    });
    expect(missing.status).toBe(404);
  });
});

describe('POST /api/families — merged-key alias replay (probe round 4)', () => {
  it('alias replay returns 200 with the survivor id and creates no duplicate flags', async () => {
    const db = env.DB;
    await db.prepare(`DELETE FROM merged_keys`).run();
    await db.prepare(`DELETE FROM duplicate_flags`).run();
    await db.prepare(
      `INSERT INTO merged_keys (idempotency_key, kind, target_id) VALUES ('alias-key-1', 'family', ?)`
    ).bind((await (async () => {
      const r = await workerExports.default.fetch('https://x/api/families', {
        method: 'POST',
        headers: { Authorization: authHeader, 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Alias Survivor' }),
      });
      return ((await r.json()) as { id: string }).id;
    })())).run();

    const flagsBefore = await db.prepare(`SELECT COUNT(*) AS n FROM duplicate_flags`).first<{ n: number }>();
    const res = await workerExports.default.fetch('https://x/api/families', {
      method: 'POST',
      headers: { Authorization: authHeader, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Stale Discarded Name', idempotency_key: 'alias-key-1', proxy: { proxy_name: 'P', proxy_phone: '4805550123' } }),
    });
    expect(res.status).toBe(200); // replay, not creation
    const flagsAfter = await db.prepare(`SELECT COUNT(*) AS n FROM duplicate_flags`).first<{ n: number }>();
    expect(flagsAfter!.n).toBe(flagsBefore!.n); // no duplicate detection rerun
    const proxies = await db.prepare(`SELECT COUNT(*) AS n FROM proxies WHERE proxy_phone = '4805550123'`).first<{ n: number }>();
    expect(proxies!.n).toBe(0); // proxy not reprocessed on replay
  });
});

describe('GET /api/families/directory (offline roster cache)', () => {
  it('requires auth', async () => {
    const res = await workerExports.default.fetch('https://x/api/families/directory');
    expect(res.status).toBe(401);
  });

  it('returns the roster with last visit dates', async () => {
    const db = env.DB;
    await db.prepare(`INSERT INTO families (id, name, phone, num_people) VALUES ('dirF', 'Directory Fam', '4805554444', 5)`).run();
    await db.prepare(`INSERT INTO visits (id, family_id, visit_date) VALUES ('dirV', 'dirF', '2026-08-11')`).run();

    const res = await workerExports.default.fetch('https://x/api/families/directory', {
      headers: { Authorization: authHeader },
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { families: { id: string; name: string; phone: string | null; num_people: number | null; last_visit_date: string | null }[] };
    const fam = body.families.find(f => f.id === 'dirF');
    expect(fam).toBeTruthy();
    expect(fam!.name).toBe('Directory Fam');
    expect(fam!.num_people).toBe(5);
    expect(fam!.last_visit_date).toBe('2026-08-11');
  });
});
