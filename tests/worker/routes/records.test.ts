import { env, exports as workerExports } from 'cloudflare:workers';
import { describe, it, expect, beforeEach } from 'vitest';
import { buildSession, createSession } from '../../../src/worker/auth';
import type { Env } from '../../../src/worker/schema';

beforeEach(async () => {
  const db = (env as unknown as Env).DB;
  await db.prepare('DELETE FROM record_changes').run();
  await db.prepare('DELETE FROM visits').run();
  await db.prepare('DELETE FROM proxies').run();
  await db.prepare('DELETE FROM families').run();
  await db.prepare('DELETE FROM users').run();
});

async function seedUser(id: string, name: string, phone: string, role: 'admin' | 'staff' | 'volunteer' = 'staff') {
  const db = (env as unknown as Env).DB;
  await db.prepare('INSERT INTO users (id, name, phone, role) VALUES (?, ?, ?, ?)').bind(id, name, phone, role).run();
}

async function seedFamily(id: string, name: string, phone?: string) {
  const db = (env as unknown as Env).DB;
  await db.prepare('INSERT INTO families (id, name, phone, num_people) VALUES (?, ?, ?, 3)').bind(id, name, phone ?? null).run();
}

async function seedVisit(id: string, familyId: string, date: string, volunteerId: string) {
  const db = (env as unknown as Env).DB;
  await db.prepare(
    'INSERT INTO visits (id, family_id, visit_date, volunteer_id, bag_received) VALUES (?, ?, ?, ?, 0)'
  ).bind(id, familyId, date, volunteerId).run();
}

async function makeToken(userId: string, phone: string, role: 'admin' | 'staff' | 'volunteer') {
  const e = env as unknown as Env;
  const { token, payload } = await buildSession(userId, phone, role, e.JWT_SECRET);
  await createSession(e.SESSIONS, payload);
  return token;
}

function headers(token: string) {
  return { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` };
}

// ── GET /api/records/visits ──────────────────────────────────────────────────

describe('GET /api/records/visits', () => {
  it('returns 401 with no auth', async () => {
    const res = await workerExports.default.fetch('https://example.com/api/records/visits');
    expect(res.status).toBe(401);
  });

  it('returns 403 for volunteer', async () => {
    await seedUser('v1', 'Vol', '4801110001', 'volunteer');
    const token = await makeToken('v1', '4801110001', 'volunteer');
    const res = await workerExports.default.fetch('https://example.com/api/records/visits', { headers: headers(token) });
    expect(res.status).toBe(403);
  });

  it('returns visits for staff', async () => {
    await seedUser('s1', 'Staff', '4801110002', 'staff');
    await seedFamily('f1', 'Smith');
    await seedVisit('vi1', 'f1', '2026-07-01', 's1');
    const token = await makeToken('s1', '4801110002', 'staff');
    const res = await workerExports.default.fetch('https://example.com/api/records/visits', { headers: headers(token) });
    expect(res.status).toBe(200);
    const body = await res.json() as { visits: unknown[] };
    expect(body.visits.length).toBe(1);
  });

  it('filters by date range', async () => {
    await seedUser('s1', 'Staff', '4801110002', 'staff');
    await seedFamily('f1', 'Smith');
    await seedVisit('vi1', 'f1', '2026-07-01', 's1');
    await seedVisit('vi2', 'f1', '2026-06-15', 's1');
    const token = await makeToken('s1', '4801110002', 'staff');
    const res = await workerExports.default.fetch('https://example.com/api/records/visits?start=2026-07-01&end=2026-07-31', { headers: headers(token) });
    expect(res.status).toBe(200);
    const body = await res.json() as { visits: { id: string }[] };
    expect(body.visits.length).toBe(1);
    expect(body.visits[0].id).toBe('vi1');
  });
});

// ── GET /api/records/families ────────────────────────────────────────────────

describe('GET /api/records/families', () => {
  it('returns all families for staff', async () => {
    await seedUser('s1', 'Staff', '4801110002', 'staff');
    await seedFamily('f1', 'Smith', '4805550001');
    await seedFamily('f2', 'Jones');
    const token = await makeToken('s1', '4801110002', 'staff');
    const res = await workerExports.default.fetch('https://example.com/api/records/families', { headers: headers(token) });
    expect(res.status).toBe(200);
    const body = await res.json() as { families: unknown[] };
    expect(body.families.length).toBe(2);
  });

  it('searches by name', async () => {
    await seedUser('s1', 'Staff', '4801110002', 'staff');
    await seedFamily('f1', 'Smith');
    await seedFamily('f2', 'Jones');
    const token = await makeToken('s1', '4801110002', 'staff');
    const res = await workerExports.default.fetch('https://example.com/api/records/families?q=smith', { headers: headers(token) });
    expect(res.status).toBe(200);
    const body = await res.json() as { families: { id: string }[] };
    expect(body.families.length).toBe(1);
    expect(body.families[0].id).toBe('f1');
  });
});

// ── PATCH /api/records/visits/:id ───────────────────────────────────────────

describe('PATCH /api/records/visits/:id', () => {
  it('staff can update visit_date and bag_received', async () => {
    await seedUser('s1', 'Staff', '4801110002', 'staff');
    await seedFamily('f1', 'Smith');
    await seedVisit('vi1', 'f1', '2026-07-01', 's1');
    const token = await makeToken('s1', '4801110002', 'staff');
    const res = await workerExports.default.fetch('https://example.com/api/records/visits/vi1', {
      method: 'PATCH',
      headers: headers(token),
      body: JSON.stringify({ visit_date: '2026-07-05', bag_received: true }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { ok: boolean };
    expect(body.ok).toBe(true);
  });

  it('staff cannot update volunteer_id', async () => {
    await seedUser('s1', 'Staff', '4801110002', 'staff');
    await seedFamily('f1', 'Smith');
    await seedVisit('vi1', 'f1', '2026-07-01', 's1');
    const token = await makeToken('s1', '4801110002', 'staff');
    const res = await workerExports.default.fetch('https://example.com/api/records/visits/vi1', {
      method: 'PATCH',
      headers: headers(token),
      body: JSON.stringify({ volunteer_id: 'other' }),
    });
    expect(res.status).toBe(400);
  });

  it('admin can update volunteer_id', async () => {
    await seedUser('a1', 'Admin', '4801110000', 'admin');
    await seedUser('s1', 'Staff', '4801110002', 'staff');
    await seedFamily('f1', 'Smith');
    await seedVisit('vi1', 'f1', '2026-07-01', 's1');
    const token = await makeToken('a1', '4801110000', 'admin');
    const res = await workerExports.default.fetch('https://example.com/api/records/visits/vi1', {
      method: 'PATCH',
      headers: headers(token),
      body: JSON.stringify({ volunteer_id: 'a1' }),
    });
    expect(res.status).toBe(200);
  });

  it('returns 404 for unknown visit', async () => {
    await seedUser('s1', 'Staff', '4801110002', 'staff');
    const token = await makeToken('s1', '4801110002', 'staff');
    const res = await workerExports.default.fetch('https://example.com/api/records/visits/nope', {
      method: 'PATCH',
      headers: headers(token),
      body: JSON.stringify({ visit_date: '2026-07-01' }),
    });
    expect(res.status).toBe(404);
  });

  it('logs change in record_changes', async () => {
    await seedUser('s1', 'Staff', '4801110002', 'staff');
    await seedFamily('f1', 'Smith');
    await seedVisit('vi1', 'f1', '2026-07-01', 's1');
    const token = await makeToken('s1', '4801110002', 'staff');
    await workerExports.default.fetch('https://example.com/api/records/visits/vi1', {
      method: 'PATCH',
      headers: headers(token),
      body: JSON.stringify({ visit_date: '2026-07-10' }),
    });
    const db = (env as unknown as Env).DB;
    const row = await db.prepare('SELECT * FROM record_changes WHERE record_id = ?').bind('vi1').first<{ changes: string }>();
    expect(row).not.toBeNull();
    const changes = JSON.parse(row!.changes) as { visit_date: { old: string; new: string } };
    expect(changes.visit_date.new).toBe('2026-07-10');
  });
});

// ── PATCH /api/records/families/:id ─────────────────────────────────────────

describe('PATCH /api/records/families/:id', () => {
  it('staff can update num_people', async () => {
    await seedUser('s1', 'Staff', '4801110002', 'staff');
    await seedFamily('f1', 'Smith');
    const token = await makeToken('s1', '4801110002', 'staff');
    const res = await workerExports.default.fetch('https://example.com/api/records/families/f1', {
      method: 'PATCH',
      headers: headers(token),
      body: JSON.stringify({ num_people: 5 }),
    });
    expect(res.status).toBe(200);
  });

  it('staff cannot update name', async () => {
    await seedUser('s1', 'Staff', '4801110002', 'staff');
    await seedFamily('f1', 'Smith');
    const token = await makeToken('s1', '4801110002', 'staff');
    const res = await workerExports.default.fetch('https://example.com/api/records/families/f1', {
      method: 'PATCH',
      headers: headers(token),
      body: JSON.stringify({ name: 'Hacker' }),
    });
    expect(res.status).toBe(400);
  });

  it('admin can update name and demographics', async () => {
    await seedUser('a1', 'Admin', '4801110000', 'admin');
    await seedFamily('f1', 'Smith');
    const token = await makeToken('a1', '4801110000', 'admin');
    const res = await workerExports.default.fetch('https://example.com/api/records/families/f1', {
      method: 'PATCH',
      headers: headers(token),
      body: JSON.stringify({ name: 'Johnson', num_children_under_18: 2 }),
    });
    expect(res.status).toBe(200);
  });
});

// ── DELETE /api/records/visits/:id ──────────────────────────────────────────

describe('DELETE /api/records/visits/:id', () => {
  it('staff cannot delete', async () => {
    await seedUser('s1', 'Staff', '4801110002', 'staff');
    await seedFamily('f1', 'Smith');
    await seedVisit('vi1', 'f1', '2026-07-01', 's1');
    const token = await makeToken('s1', '4801110002', 'staff');
    const res = await workerExports.default.fetch('https://example.com/api/records/visits/vi1', {
      method: 'DELETE',
      headers: headers(token),
    });
    expect(res.status).toBe(403);
  });

  it('admin can delete visit and logs it', async () => {
    await seedUser('a1', 'Admin', '4801110000', 'admin');
    await seedFamily('f1', 'Smith');
    await seedVisit('vi1', 'f1', '2026-07-01', 'a1');
    const token = await makeToken('a1', '4801110000', 'admin');
    const res = await workerExports.default.fetch('https://example.com/api/records/visits/vi1', {
      method: 'DELETE',
      headers: headers(token),
    });
    expect(res.status).toBe(200);
    const db = (env as unknown as Env).DB;
    const visit = await db.prepare('SELECT id FROM visits WHERE id = ?').bind('vi1').first();
    expect(visit).toBeNull();
    const log = await db.prepare('SELECT * FROM record_changes WHERE record_id = ?').bind('vi1').first();
    expect(log).not.toBeNull();
  });

  it('returns 404 for unknown visit', async () => {
    await seedUser('a1', 'Admin', '4801110000', 'admin');
    const token = await makeToken('a1', '4801110000', 'admin');
    const res = await workerExports.default.fetch('https://example.com/api/records/visits/nope', {
      method: 'DELETE',
      headers: headers(token),
    });
    expect(res.status).toBe(404);
  });
});

// ── DELETE /api/records/families/:id ────────────────────────────────────────

describe('DELETE /api/records/families/:id', () => {
  it('admin deletes family and cascades visits', async () => {
    await seedUser('a1', 'Admin', '4801110000', 'admin');
    await seedFamily('f1', 'Smith');
    await seedVisit('vi1', 'f1', '2026-07-01', 'a1');
    const token = await makeToken('a1', '4801110000', 'admin');
    const res = await workerExports.default.fetch('https://example.com/api/records/families/f1', {
      method: 'DELETE',
      headers: headers(token),
    });
    expect(res.status).toBe(200);
    const db = (env as unknown as Env).DB;
    const family = await db.prepare('SELECT id FROM families WHERE id = ?').bind('f1').first();
    expect(family).toBeNull();
    const visit = await db.prepare('SELECT id FROM visits WHERE family_id = ?').bind('f1').first();
    expect(visit).toBeNull();
  });

  it('staff cannot delete family', async () => {
    await seedUser('s1', 'Staff', '4801110002', 'staff');
    await seedFamily('f1', 'Smith');
    const token = await makeToken('s1', '4801110002', 'staff');
    const res = await workerExports.default.fetch('https://example.com/api/records/families/f1', {
      method: 'DELETE',
      headers: headers(token),
    });
    expect(res.status).toBe(403);
  });
});

// ── POST /api/records/visits (admin backdated) ───────────────────────────────

describe('POST /api/records/visits', () => {
  it('admin can add a backdated visit', async () => {
    await seedUser('a1', 'Admin', '4801110000', 'admin');
    await seedFamily('f1', 'Smith');
    const token = await makeToken('a1', '4801110000', 'admin');
    const res = await workerExports.default.fetch('https://example.com/api/records/visits', {
      method: 'POST',
      headers: headers(token),
      body: JSON.stringify({ family_id: 'f1', visit_date: '2026-06-01', bag_received: true }),
    });
    expect(res.status).toBe(201);
    const body = await res.json() as { id: string };
    expect(typeof body.id).toBe('string');
  });

  it('staff cannot add backdated visit', async () => {
    await seedUser('s1', 'Staff', '4801110002', 'staff');
    await seedFamily('f1', 'Smith');
    const token = await makeToken('s1', '4801110002', 'staff');
    const res = await workerExports.default.fetch('https://example.com/api/records/visits', {
      method: 'POST',
      headers: headers(token),
      body: JSON.stringify({ family_id: 'f1', visit_date: '2026-06-01' }),
    });
    expect(res.status).toBe(403);
  });

  it('returns 404 for unknown family_id', async () => {
    await seedUser('a1', 'Admin', '4801110000', 'admin');
    const token = await makeToken('a1', '4801110000', 'admin');
    const res = await workerExports.default.fetch('https://example.com/api/records/visits', {
      method: 'POST',
      headers: headers(token),
      body: JSON.stringify({ family_id: 'nope', visit_date: '2026-06-01' }),
    });
    expect(res.status).toBe(404);
  });
});

// ── GET /api/records/changes ─────────────────────────────────────────────────

describe('GET /api/records/changes/:table/:id', () => {
  it('returns 403 for staff', async () => {
    await seedUser('s1', 'Staff', '4801110002', 'staff');
    const token = await makeToken('s1', '4801110002', 'staff');
    const res = await workerExports.default.fetch('https://example.com/api/records/changes/visits/vi1', { headers: headers(token) });
    expect(res.status).toBe(403);
  });

  it('admin sees change history', async () => {
    await seedUser('a1', 'Admin', '4801110000', 'admin');
    await seedFamily('f1', 'Smith');
    await seedVisit('vi1', 'f1', '2026-07-01', 'a1');
    const token = await makeToken('a1', '4801110000', 'admin');
    // Patch to create a log entry
    await workerExports.default.fetch('https://example.com/api/records/visits/vi1', {
      method: 'PATCH',
      headers: headers(token),
      body: JSON.stringify({ bag_received: true }),
    });
    const res = await workerExports.default.fetch('https://example.com/api/records/changes/visits/vi1', { headers: headers(token) });
    expect(res.status).toBe(200);
    const body = await res.json() as { changes: { changed_by_name: string }[] };
    expect(body.changes.length).toBe(1);
    expect(body.changes[0].changed_by_name).toBe('Admin');
  });
});
