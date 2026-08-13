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
    expect(r1.status).toBe(201); // genuinely created
    expect(r2.status).toBe(200); // idempotent replay
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

  it('stores picked_up_by_phone NORMALIZED (proxy pickup attribution)', async () => {
    const key = `visit-proxy-${Date.now()}`;
    const res = await workerExports.default.fetch('http://example.com/api/visits', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: authHeader },
      // Raw formatted input — replayed queue items and the wizard proxy
      // path arrive like this; it must match proxies.proxy_phone later.
      body: JSON.stringify({ family_id: testFamilyId, visit_date: '2026-02-01', picked_up_by_phone: '+1 (480) 555-7777', idempotency_key: key }),
    });
    expect(res.status).toBe(201);
    const row = await env.DB.prepare(`SELECT picked_up_by_phone FROM visits WHERE idempotency_key = ?`)
      .bind(key).first<{ picked_up_by_phone: string }>();
    expect(row!.picked_up_by_phone).toBe('4805557777');
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

describe('GET /api/visits/resolve/:key (bag recovery)', () => {
  it('resolves a live visit by idempotency key', async () => {
    const db = env.DB;
    await db.prepare(`INSERT OR IGNORE INTO families (id, name) VALUES ('rf1', 'Resolve Fam')`).run();
    await db.prepare(`INSERT INTO visits (id, family_id, visit_date, idempotency_key) VALUES ('rv1', 'rf1', '2026-08-12', 'resolve-key-1')`).run();
    const res = await workerExports.default.fetch('https://x/api/visits/resolve/resolve-key-1', {
      headers: { Authorization: authHeader },
    });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { id: string }).id).toBe('rv1');
  });

  it('resolves through a merge alias and 404s unknown keys', async () => {
    const db = env.DB;
    await db.prepare(`INSERT OR IGNORE INTO families (id, name) VALUES ('rf2', 'Resolve Fam 2')`).run();
    await db.prepare(`INSERT INTO visits (id, family_id, visit_date) VALUES ('rv2', 'rf2', '2026-08-12')`).run();
    await db.prepare(`INSERT INTO merged_keys (idempotency_key, kind, target_id) VALUES ('aliased-key', 'visit', 'rv2')`).run();

    const aliased = await workerExports.default.fetch('https://x/api/visits/resolve/aliased-key', {
      headers: { Authorization: authHeader },
    });
    expect(((await aliased.json()) as { id: string }).id).toBe('rv2');

    const missing = await workerExports.default.fetch('https://x/api/visits/resolve/no-such-key', {
      headers: { Authorization: authHeader },
    });
    expect(missing.status).toBe(404);
  });
});

describe('PATCH /api/visits/:id/bag — contract hardening (issue #6)', () => {
  it('rejects a missing/non-boolean bag_received instead of silently un-marking', async () => {
    const db = env.DB;
    await db.prepare(`INSERT OR IGNORE INTO families (id, name) VALUES ('bagf1', 'Bag Fam')`).run();
    await db.prepare(`INSERT INTO visits (id, family_id, visit_date, bag_received) VALUES ('bagv1', 'bagf1', '2026-08-12', 1)`).run();
    const res = await workerExports.default.fetch('https://x/api/visits/bagv1/bag', {
      method: 'PATCH', headers: { Authorization: authHeader, 'Content-Type': 'application/json' }, body: '{}',
    });
    expect(res.status).toBe(400);
    const v = await db.prepare(`SELECT bag_received FROM visits WHERE id = 'bagv1'`).first<{ bag_received: number }>();
    expect(v!.bag_received).toBe(1); // unchanged
  });

  it('writes an audit row and updated_by on success', async () => {
    const db = env.DB;
    await db.prepare(`INSERT OR IGNORE INTO families (id, name) VALUES ('bagf2', 'Bag Fam 2')`).run();
    await db.prepare(`INSERT INTO visits (id, family_id, visit_date, bag_received) VALUES ('bagv2', 'bagf2', '2026-08-12', 0)`).run();
    const res = await workerExports.default.fetch('https://x/api/visits/bagv2/bag', {
      method: 'PATCH', headers: { Authorization: authHeader, 'Content-Type': 'application/json' },
      body: JSON.stringify({ bag_received: true }),
    });
    expect(res.status).toBe(200);
    const v = await db.prepare(`SELECT bag_received, updated_by FROM visits WHERE id = 'bagv2'`).first<{ bag_received: number; updated_by: string | null }>();
    expect(v!.bag_received).toBe(1);
    expect(v!.updated_by).not.toBeNull();
    const audit = await db.prepare(`SELECT changes FROM record_changes WHERE table_name = 'visits' AND record_id = 'bagv2'`).first<{ changes: string }>();
    expect(audit).not.toBeNull();
  });

  it('404s a nonexistent visit and leaves NO phantom audit row', async () => {
    const db = env.DB;
    const res = await workerExports.default.fetch('https://x/api/visits/no-such-visit/bag', {
      method: 'PATCH', headers: { Authorization: authHeader, 'Content-Type': 'application/json' },
      body: JSON.stringify({ bag_received: true }),
    });
    expect(res.status).toBe(404);
    // The batch unavoidably inserts the audit row; the compensating delete
    // must remove it or history accumulates changes for untouched visits.
    const phantom = await db.prepare(
      `SELECT COUNT(*) AS n FROM record_changes WHERE table_name = 'visits' AND record_id = 'no-such-visit'`
    ).first<{ n: number }>();
    expect(phantom!.n).toBe(0);
  });
});

describe('POST /api/visits — stale cached family id (offline replay after merge/delete)', () => {
  it('a visit against a merged-away family id lands on the survivor', async () => {
    const db = env.DB;
    await db.prepare(`INSERT INTO families (id, name) VALUES ('survivor', 'Survivor Fam')`).run();
    await db.prepare(`INSERT INTO merged_family_ids (old_id, target_id) VALUES ('mergedAway', 'survivor')`).run();

    const res = await workerExports.default.fetch('https://x/api/visits', {
      method: 'POST', headers: { Authorization: authHeader, 'Content-Type': 'application/json' },
      body: JSON.stringify({ family_id: 'mergedAway', visit_date: '2026-08-12', idempotency_key: 'stale-key-1' }),
    });
    expect(res.status).toBe(201);
    const v = await db.prepare(`SELECT family_id FROM visits WHERE idempotency_key = 'stale-key-1'`).first<{ family_id: string }>();
    expect(v!.family_id).toBe('survivor');
  });

  it('a visit against a genuinely gone family id is a permanent 404, not a retry-forever 500', async () => {
    const res = await workerExports.default.fetch('https://x/api/visits', {
      method: 'POST', headers: { Authorization: authHeader, 'Content-Type': 'application/json' },
      body: JSON.stringify({ family_id: 'never-existed', visit_date: '2026-08-12' }),
    });
    // 4xx → the offline queue dead-letters it with the recoverable payload
    // instead of classifying it transient and retrying forever.
    expect(res.status).toBe(404);
    const body = await res.json() as { error: string };
    expect(body.error).toMatch(/merged or removed/);
  });
});
