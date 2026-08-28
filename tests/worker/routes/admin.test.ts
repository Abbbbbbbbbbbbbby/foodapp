import { env, exports as workerExports } from 'cloudflare:workers';
import { describe, it, expect, beforeEach } from 'vitest';
import { buildSession, createSession } from '../../../src/worker/auth';
import type { Env } from '../../../src/worker/schema';

beforeEach(async () => {
  const db = (env as unknown as Env).DB;
  // FK-safe order: children before parents (the runtime enforces FKs now)
  await db.prepare('DELETE FROM record_changes').run();
  await db.prepare('DELETE FROM duplicate_flags').run();
  await db.prepare('DELETE FROM visits').run();
  await db.prepare('DELETE FROM proxies').run();
  await db.prepare('DELETE FROM families').run();
  await db.prepare('DELETE FROM otp_codes').run();
  await db.prepare('DELETE FROM users').run();
});

async function seedUser(
  id: string,
  name: string,
  phone: string,
  role: 'admin' | 'staff' | 'volunteer' = 'volunteer'
) {
  const db = (env as unknown as Env).DB;
  await db.prepare(
    `INSERT INTO users (id, name, phone, role) VALUES (?, ?, ?, ?)`
  ).bind(id, name, phone, role).run();
}

async function makeToken(userId: string, phone: string, role: 'admin' | 'staff' | 'volunteer') {
  const e = env as unknown as Env;
  const { token, payload } = await buildSession(userId, phone, role, e.JWT_SECRET);
  await createSession(e.SESSIONS, payload);
  return token;
}

function authHeader(token: string) {
  return { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` };
}

describe('GET /api/admin/users', () => {
  it('returns 403 for non-admin', async () => {
    await seedUser('u1', 'Alice', '4805550001', 'volunteer');
    const token = await makeToken('u1', '4805550001', 'volunteer');
    const res = await workerExports.default.fetch('https://example.com/api/admin/users', {
      headers: authHeader(token),
    });
    expect(res.status).toBe(403);
  });

  it('returns 401 with no auth', async () => {
    const res = await workerExports.default.fetch('https://example.com/api/admin/users');
    expect(res.status).toBe(401);
  });

  it('returns user list for admin', async () => {
    await seedUser('a1', 'Admin', '4805550000', 'admin');
    await seedUser('u1', 'Alice', '4805550001', 'volunteer');
    const token = await makeToken('a1', '4805550000', 'admin');
    const res = await workerExports.default.fetch('https://example.com/api/admin/users', {
      headers: authHeader(token),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { users: { id: string; name: string }[] };
    expect(body.users.length).toBe(2);
    const names = body.users.map(u => u.name).sort();
    expect(names).toEqual(['Admin', 'Alice']);
  });
});

describe('PATCH /api/admin/users/:id', () => {
  it('changes role for admin', async () => {
    await seedUser('a1', 'Admin', '4805550000', 'admin');
    await seedUser('u1', 'Bob', '4805550002', 'volunteer');
    const token = await makeToken('a1', '4805550000', 'admin');
    const res = await workerExports.default.fetch('https://example.com/api/admin/users/u1', {
      method: 'PATCH',
      headers: authHeader(token),
      body: JSON.stringify({ role: 'staff' }),
    });
    expect(res.status).toBe(200);
    const db = (env as unknown as Env).DB;
    const user = await db.prepare('SELECT role FROM users WHERE id = ?').bind('u1').first<{ role: string }>();
    expect(user?.role).toBe('staff');
  });

  it('rejects invalid role', async () => {
    await seedUser('a1', 'Admin', '4805550000', 'admin');
    await seedUser('u1', 'Bob', '4805550002', 'volunteer');
    const token = await makeToken('a1', '4805550000', 'admin');
    const res = await workerExports.default.fetch('https://example.com/api/admin/users/u1', {
      method: 'PATCH',
      headers: authHeader(token),
      body: JSON.stringify({ role: 'superuser' }),
    });
    expect(res.status).toBe(400);
  });

  it('can deactivate a user', async () => {
    await seedUser('a1', 'Admin', '4805550000', 'admin');
    await seedUser('u1', 'Bob', '4805550002', 'volunteer');
    const token = await makeToken('a1', '4805550000', 'admin');
    const res = await workerExports.default.fetch('https://example.com/api/admin/users/u1', {
      method: 'PATCH',
      headers: authHeader(token),
      body: JSON.stringify({ active: false }),
    });
    expect(res.status).toBe(200);
    const db = (env as unknown as Env).DB;
    const user = await db.prepare('SELECT active FROM users WHERE id = ?').bind('u1').first<{ active: number }>();
    expect(user?.active).toBe(0);
  });

  it('returns 403 for non-admin', async () => {
    await seedUser('u1', 'Alice', '4805550001', 'volunteer');
    await seedUser('u2', 'Bob', '4805550002', 'volunteer');
    const token = await makeToken('u1', '4805550001', 'volunteer');
    const res = await workerExports.default.fetch('https://example.com/api/admin/users/u2', {
      method: 'PATCH',
      headers: authHeader(token),
      body: JSON.stringify({ role: 'staff' }),
    });
    expect(res.status).toBe(403);
  });

  it('updates name and phone, normalizing the phone', async () => {
    await seedUser('a1', 'Admin', '4805550000', 'admin');
    await seedUser('u1', 'Bob', '4805550002', 'volunteer');
    const token = await makeToken('a1', '4805550000', 'admin');
    const res = await workerExports.default.fetch('https://example.com/api/admin/users/u1', {
      method: 'PATCH',
      headers: authHeader(token),
      body: JSON.stringify({ name: '  Bobby  ', phone: '(480) 555-0099' }),
    });
    expect(res.status).toBe(200);
    const db = (env as unknown as Env).DB;
    const user = await db.prepare('SELECT name, phone FROM users WHERE id = ?').bind('u1').first<{ name: string; phone: string }>();
    expect(user?.name).toBe('Bobby');
    expect(user?.phone).toBe('4805550099');
  });

  it('rejects an empty name', async () => {
    await seedUser('a1', 'Admin', '4805550000', 'admin');
    await seedUser('u1', 'Bob', '4805550002', 'volunteer');
    const token = await makeToken('a1', '4805550000', 'admin');
    const res = await workerExports.default.fetch('https://example.com/api/admin/users/u1', {
      method: 'PATCH',
      headers: authHeader(token),
      body: JSON.stringify({ name: '   ' }),
    });
    expect(res.status).toBe(400);
  });

  it('rejects a phone that does not normalize to 10 digits', async () => {
    await seedUser('a1', 'Admin', '4805550000', 'admin');
    await seedUser('u1', 'Bob', '4805550002', 'volunteer');
    const token = await makeToken('a1', '4805550000', 'admin');
    const res = await workerExports.default.fetch('https://example.com/api/admin/users/u1', {
      method: 'PATCH',
      headers: authHeader(token),
      body: JSON.stringify({ phone: '12345' }),
    });
    expect(res.status).toBe(400);
  });

  it('rejects a phone already used by another account', async () => {
    await seedUser('a1', 'Admin', '4805550000', 'admin');
    await seedUser('u1', 'Bob', '4805550002', 'volunteer');
    await seedUser('u2', 'Carol', '4805550003', 'volunteer');
    const token = await makeToken('a1', '4805550000', 'admin');
    const res = await workerExports.default.fetch('https://example.com/api/admin/users/u1', {
      method: 'PATCH',
      headers: authHeader(token),
      body: JSON.stringify({ phone: '4805550003' }),
    });
    expect(res.status).toBe(400);
    const db = (env as unknown as Env).DB;
    const user = await db.prepare('SELECT phone FROM users WHERE id = ?').bind('u1').first<{ phone: string }>();
    expect(user?.phone).toBe('4805550002'); // unchanged
  });

  it('allows re-saving a user\'s own unchanged phone', async () => {
    await seedUser('a1', 'Admin', '4805550000', 'admin');
    await seedUser('u1', 'Bob', '4805550002', 'volunteer');
    const token = await makeToken('a1', '4805550000', 'admin');
    const res = await workerExports.default.fetch('https://example.com/api/admin/users/u1', {
      method: 'PATCH',
      headers: authHeader(token),
      body: JSON.stringify({ name: 'Bob', phone: '480-555-0002' }),
    });
    expect(res.status).toBe(200);
  });
});

describe('DELETE /api/admin/users/:id', () => {
  it('deletes a user', async () => {
    await seedUser('a1', 'Admin', '4805550000', 'admin');
    await seedUser('u1', 'Bob', '4805550002', 'volunteer');
    const token = await makeToken('a1', '4805550000', 'admin');
    const res = await workerExports.default.fetch('https://example.com/api/admin/users/u1', {
      method: 'DELETE',
      headers: authHeader(token),
    });
    expect(res.status).toBe(200);
    const db = (env as unknown as Env).DB;
    const user = await db.prepare('SELECT id FROM users WHERE id = ?').bind('u1').first();
    expect(user).toBeNull();
  });

  it('prevents deleting self', async () => {
    await seedUser('a1', 'Admin', '4805550000', 'admin');
    const token = await makeToken('a1', '4805550000', 'admin');
    const res = await workerExports.default.fetch('https://example.com/api/admin/users/a1', {
      method: 'DELETE',
      headers: authHeader(token),
    });
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toMatch(/own account/);
  });

  it('returns 404 for unknown user', async () => {
    await seedUser('a1', 'Admin', '4805550000', 'admin');
    const token = await makeToken('a1', '4805550000', 'admin');
    const res = await workerExports.default.fetch('https://example.com/api/admin/users/nonexistent', {
      method: 'DELETE',
      headers: authHeader(token),
    });
    expect(res.status).toBe(404);
  });

  it('returns 403 for non-admin', async () => {
    await seedUser('u1', 'Alice', '4805550001', 'volunteer');
    await seedUser('u2', 'Bob', '4805550002', 'volunteer');
    const token = await makeToken('u1', '4805550001', 'volunteer');
    const res = await workerExports.default.fetch('https://example.com/api/admin/users/u2', {
      method: 'DELETE',
      headers: authHeader(token),
    });
    expect(res.status).toBe(403);
  });
});

describe('DELETE /api/admin/users/:id — FK-referenced users (review round)', () => {
  it('deletes a user referenced by families.updated_by, visits.updated_by, and duplicate_flags.reviewed_by', async () => {
    await seedUser('a1', 'Admin', '4805550000', 'admin');
    await seedUser('u9', 'Referenced', '4805550009', 'staff');
    const db = (env as unknown as Env).DB;
    await db.prepare(`INSERT INTO families (id, name, created_by, updated_by) VALUES ('famA', 'Fam A', 'u9', 'u9')`).run();
    await db.prepare(`INSERT INTO families (id, name) VALUES ('famB', 'Fam B')`).run();
    await db.prepare(`INSERT INTO visits (id, family_id, visit_date, volunteer_id, updated_by) VALUES ('vA', 'famA', '2026-08-01', 'u9', 'u9')`).run();
    await db.prepare(`INSERT INTO duplicate_flags (id, family_a_id, family_b_id, reason, status, reviewed_by) VALUES ('dfA', 'famA', 'famB', 'phone', 'dismissed', 'u9')`).run();
    await db.prepare(`INSERT INTO otp_codes (id, phone, code, expires_at) VALUES ('otpA', '4805550009', '123456', datetime('now', '+10 minutes'))`).run();

    const token = await makeToken('a1', '4805550000', 'admin');
    const res = await workerExports.default.fetch('https://example.com/api/admin/users/u9', {
      method: 'DELETE',
      headers: authHeader(token),
    });
    expect(res.status).toBe(200);

    expect(await db.prepare(`SELECT id FROM users WHERE id = 'u9'`).first()).toBeNull();
    const fam = await db.prepare(`SELECT created_by, updated_by FROM families WHERE id = 'famA'`).first<{ created_by: string | null; updated_by: string | null }>();
    expect(fam!.created_by).toBeNull();
    expect(fam!.updated_by).toBeNull();
    const visit = await db.prepare(`SELECT volunteer_id, updated_by FROM visits WHERE id = 'vA'`).first<{ volunteer_id: string | null; updated_by: string | null }>();
    expect(visit!.volunteer_id).toBeNull();
    expect(visit!.updated_by).toBeNull();
    const flag = await db.prepare(`SELECT reviewed_by FROM duplicate_flags WHERE id = 'dfA'`).first<{ reviewed_by: string | null }>();
    expect(flag!.reviewed_by).toBeNull();
    expect(await db.prepare(`SELECT id FROM otp_codes WHERE id = 'otpA'`).first()).toBeNull();
  });

  it('a deactivated admin token can no longer act at all (401)', async () => {
    await seedUser('a1', 'Admin One', '4805550000', 'admin');
    await seedUser('a2', 'Admin Two', '4805550002', 'admin');
    const db = (env as unknown as Env).DB;
    const token = await makeToken('a2', '4805550002', 'admin');
    await db.prepare(`UPDATE users SET active = 0 WHERE id = 'a2'`).run();

    const res = await workerExports.default.fetch('https://example.com/api/admin/users/a1', {
      method: 'DELETE',
      headers: authHeader(token),
    });
    expect(res.status).toBe(401); // deactivation ends access immediately
    expect(await db.prepare(`SELECT id FROM users WHERE id = 'a1'`).first()).not.toBeNull();
  });

  it('the SQL race guard no-ops the whole batch when the target is the last active admin', async () => {
    // The endpoint path to this 400 requires the concurrent race (an active
    // admin actor always counts as "another admin"), so pin the guard at the
    // statement level — using the route's OWN exported predicate, so this
    // test fails if the deployed SQL ever changes.
    const { LAST_ADMIN_GUARD } = await import('../../../src/worker/routes/admin');
    await seedUser('a1', 'Last Admin', '4805550000', 'admin');
    const db = (env as unknown as Env).DB;
    await db.prepare(`INSERT INTO families (id, name, created_by) VALUES ('famG', 'Guard Fam', 'a1')`).run();

    const results = await db.batch([
      db.prepare(`UPDATE families SET created_by = NULL WHERE created_by = ?1 AND ${LAST_ADMIN_GUARD}`).bind('a1'),
      db.prepare(`DELETE FROM users WHERE id = ?1 AND ${LAST_ADMIN_GUARD}`).bind('a1'),
    ]);
    expect(results[1].meta.rows_written).toBe(0); // delete blocked
    const fam = await db.prepare(`SELECT created_by FROM families WHERE id = 'famG'`).first<{ created_by: string | null }>();
    expect(fam!.created_by).toBe('a1'); // reference untouched — batch no-oped together
  });
});

describe('GET /api/admin/users/:id/data-summary', () => {
  it('counts families the user registered and their visits', async () => {
    await seedUser('a1', 'Admin', '4805550000', 'admin');
    await seedUser('u1', 'Bob', '4805550002', 'volunteer');
    const db = (env as unknown as Env).DB;
    await db.prepare(`INSERT INTO families (id, name, created_by) VALUES ('sf1', 'Fam One', 'u1')`).run();
    await db.prepare(`INSERT INTO families (id, name, created_by) VALUES ('sf2', 'Fam Two', 'u1')`).run();
    await db.prepare(`INSERT INTO visits (id, family_id, visit_date) VALUES ('sv1', 'sf1', '2026-08-01')`).run();
    await db.prepare(`INSERT INTO visits (id, family_id, visit_date) VALUES ('sv2', 'sf1', '2026-08-08')`).run();
    await db.prepare(`INSERT INTO visits (id, family_id, visit_date) VALUES ('sv3', 'sf2', '2026-08-01')`).run();
    // A family registered by someone else, visited by u1: must NOT count.
    await db.prepare(`INSERT INTO families (id, name, created_by) VALUES ('sf3', 'Other Fam', 'a1')`).run();
    await db.prepare(`INSERT INTO visits (id, family_id, visit_date, volunteer_id) VALUES ('sv4', 'sf3', '2026-08-01', 'u1')`).run();

    const token = await makeToken('a1', '4805550000', 'admin');
    const res = await workerExports.default.fetch('https://example.com/api/admin/users/u1/data-summary', {
      headers: authHeader(token),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { families: number; visits: number };
    expect(body.families).toBe(2);
    expect(body.visits).toBe(3);
  });

  it('returns zero counts for a user with no registrations', async () => {
    await seedUser('a1', 'Admin', '4805550000', 'admin');
    await seedUser('u1', 'Bob', '4805550002', 'volunteer');
    const token = await makeToken('a1', '4805550000', 'admin');
    const res = await workerExports.default.fetch('https://example.com/api/admin/users/u1/data-summary', {
      headers: authHeader(token),
    });
    const body = await res.json() as { families: number; visits: number };
    expect(body).toEqual({ families: 0, visits: 0 });
  });

  it('returns 403 for non-admin', async () => {
    await seedUser('u1', 'Alice', '4805550001', 'volunteer');
    await seedUser('u2', 'Bob', '4805550002', 'volunteer');
    const token = await makeToken('u1', '4805550001', 'volunteer');
    const res = await workerExports.default.fetch('https://example.com/api/admin/users/u2/data-summary', {
      headers: authHeader(token),
    });
    expect(res.status).toBe(403);
  });
});

describe('DELETE /api/admin/users/:id?deleteData=1', () => {
  it('cascades: deletes registered families, their visits/proxies, and duplicate_flags referencing them', async () => {
    await seedUser('a1', 'Admin', '4805550000', 'admin');
    await seedUser('u1', 'Bad Actor', '4805550002', 'volunteer');
    const db = (env as unknown as Env).DB;
    await db.prepare(`INSERT INTO families (id, name, created_by) VALUES ('df1', 'Bad Fam One', 'u1')`).run();
    await db.prepare(`INSERT INTO families (id, name, created_by) VALUES ('df2', 'Bad Fam Two', 'u1')`).run();
    await db.prepare(`INSERT INTO families (id, name) VALUES ('dfOther', 'Unrelated Fam')`).run();
    await db.prepare(`INSERT INTO visits (id, family_id, visit_date) VALUES ('dv1', 'df1', '2026-08-01')`).run();
    await db.prepare(`INSERT INTO proxies (id, family_id, proxy_name, proxy_phone) VALUES ('dp1', 'df1', 'Helper', '4805559999')`).run();
    await db.prepare(`INSERT INTO duplicate_flags (id, family_a_id, family_b_id, reason) VALUES ('ddf1', 'df1', 'dfOther', 'name_fuzzy')`).run();

    const token = await makeToken('a1', '4805550000', 'admin');
    const res = await workerExports.default.fetch('https://example.com/api/admin/users/u1?deleteData=1', {
      method: 'DELETE',
      headers: authHeader(token),
    });
    expect(res.status).toBe(200);

    expect(await db.prepare(`SELECT id FROM users WHERE id = 'u1'`).first()).toBeNull();
    expect(await db.prepare(`SELECT id FROM families WHERE id IN ('df1','df2')`).all()).toMatchObject({ results: [] });
    expect(await db.prepare(`SELECT id FROM visits WHERE id = 'dv1'`).first()).toBeNull();
    expect(await db.prepare(`SELECT id FROM proxies WHERE id = 'dp1'`).first()).toBeNull();
    expect(await db.prepare(`SELECT id FROM duplicate_flags WHERE id = 'ddf1'`).first()).toBeNull();
    // Unrelated family (not created by u1) must survive untouched.
    expect(await db.prepare(`SELECT id FROM families WHERE id = 'dfOther'`).first()).not.toBeNull();
  });

  it('leaves families the user did not create in place, only detaching them, and still deletes registered ones', async () => {
    await seedUser('a1', 'Admin', '4805550000', 'admin');
    await seedUser('u1', 'Mixed Actor', '4805550002', 'volunteer');
    const db = (env as unknown as Env).DB;
    await db.prepare(`INSERT INTO families (id, name, created_by) VALUES ('mf1', 'Own Fam', 'u1')`).run();
    await db.prepare(`INSERT INTO families (id, name, created_by, updated_by) VALUES ('mf2', 'Someone Elses Fam', 'a1', 'u1')`).run();
    await db.prepare(`INSERT INTO visits (id, family_id, visit_date, volunteer_id) VALUES ('mv1', 'mf2', '2026-08-01', 'u1')`).run();

    const token = await makeToken('a1', '4805550000', 'admin');
    const res = await workerExports.default.fetch('https://example.com/api/admin/users/u1?deleteData=1', {
      method: 'DELETE',
      headers: authHeader(token),
    });
    expect(res.status).toBe(200);

    expect(await db.prepare(`SELECT id FROM families WHERE id = 'mf1'`).first()).toBeNull();
    const other = await db.prepare(`SELECT created_by, updated_by FROM families WHERE id = 'mf2'`)
      .first<{ created_by: string; updated_by: string | null }>();
    expect(other!.created_by).toBe('a1'); // untouched
    expect(other!.updated_by).toBeNull(); // detached, not deleted
    const visit = await db.prepare(`SELECT volunteer_id FROM visits WHERE id = 'mv1'`).first<{ volunteer_id: string | null }>();
    expect(visit!.volunteer_id).toBeNull(); // this user's visit-logging elsewhere is detached, not destroyed
  });

  it('writes an audit record to record_changes describing what was deleted', async () => {
    await seedUser('a1', 'Admin', '4805550000', 'admin');
    await seedUser('u1', 'Audited Actor', '4805550002', 'volunteer');
    const db = (env as unknown as Env).DB;
    await db.prepare(`INSERT INTO families (id, name, created_by) VALUES ('af1', 'Audited Fam', 'u1')`).run();
    await db.prepare(`INSERT INTO visits (id, family_id, visit_date) VALUES ('av1', 'af1', '2026-08-01')`).run();

    const token = await makeToken('a1', '4805550000', 'admin');
    const res = await workerExports.default.fetch('https://example.com/api/admin/users/u1?deleteData=1', {
      method: 'DELETE',
      headers: authHeader(token),
    });
    expect(res.status).toBe(200);

    const audit = await db.prepare(
      `SELECT changed_by, changes FROM record_changes WHERE table_name = 'users' AND record_id = 'u1'`
    ).first<{ changed_by: string; changes: string }>();
    expect(audit).not.toBeNull();
    expect(audit!.changed_by).toBe('a1');
    const changes = JSON.parse(audit!.changes);
    expect(changes.deleted_user.phone).toBe('4805550002');
    expect(changes.families_deleted).toBe(1);
    expect(changes.visits_deleted).toBe(1);
  });

  it('the last-admin guard blocks deleteData too — nothing is destroyed', async () => {
    const { LAST_ADMIN_GUARD } = await import('../../../src/worker/routes/admin');
    await seedUser('a1', 'Last Admin', '4805550000', 'admin');
    const db = (env as unknown as Env).DB;
    await db.prepare(`INSERT INTO families (id, name, created_by) VALUES ('gf1', 'Guard Fam', 'a1')`).run();

    // Same SQL-level guard probe as the existing last-admin test, extended to
    // confirm a guarded cascade delete also no-ops.
    const results = await db.batch([
      db.prepare(`DELETE FROM families WHERE created_by = ?1 AND ${LAST_ADMIN_GUARD}`).bind('a1'),
      db.prepare(`DELETE FROM users WHERE id = ?1 AND ${LAST_ADMIN_GUARD}`).bind('a1'),
    ]);
    expect(results[1].meta.rows_written).toBe(0);
    expect(await db.prepare(`SELECT id FROM families WHERE id = 'gf1'`).first()).not.toBeNull();
  });

  it('without the query flag, behaves exactly as before (data detached, not deleted)', async () => {
    await seedUser('a1', 'Admin', '4805550000', 'admin');
    await seedUser('u1', 'Bob', '4805550002', 'volunteer');
    const db = (env as unknown as Env).DB;
    await db.prepare(`INSERT INTO families (id, name, created_by) VALUES ('pf1', 'Plain Fam', 'u1')`).run();

    const token = await makeToken('a1', '4805550000', 'admin');
    const res = await workerExports.default.fetch('https://example.com/api/admin/users/u1', {
      method: 'DELETE',
      headers: authHeader(token),
    });
    expect(res.status).toBe(200);
    const fam = await db.prepare(`SELECT created_by FROM families WHERE id = 'pf1'`).first<{ created_by: string | null }>();
    expect(fam!.created_by).toBeNull(); // still exists, just detached
  });
});

describe('POST /api/admin/import — bubble_id idempotency (issue #6)', () => {
  it('re-running the same import is a no-op even for phoneless families', async () => {
    await seedUser('imp-admin', 'Importer', '4805550088', 'admin');
    const token = await makeToken('imp-admin', '4805550088', 'admin');
    const db = (env as unknown as Env).DB;
    const payload = JSON.stringify({
      families: [
        { bubble_id: 'bub-1', name: 'Phoneless Fam', phone: null, visits: ['2026-08-01'] },
        { bubble_id: 'bub-2', name: 'Phoned Fam', phone: '480-555-7777', visits: [] },
      ],
    });
    for (let i = 0; i < 2; i++) {
      const res = await workerExports.default.fetch('https://example.com/api/admin/import', {
        method: 'POST', headers: authHeader(token), body: payload,
      });
      expect(res.status).toBe(200);
    }
    const fams = await db.prepare(`SELECT COUNT(*) AS n FROM families WHERE bubble_id IN ('bub-1','bub-2')`).first<{ n: number }>();
    expect(fams!.n).toBe(2); // not 4
    const visits = await db.prepare(`SELECT COUNT(*) AS n FROM visits WHERE visit_date = '2026-08-01'`).first<{ n: number }>();
    expect(visits!.n).toBe(1); // visit not duplicated either
  });

  it('a phoneless family from a pre-bubble_id import gets its id backfilled and visits merged', async () => {
    await seedUser('imp-admin2', 'Importer Two', '4805550089', 'admin');
    const token = await makeToken('imp-admin2', '4805550089', 'admin');
    const db = (env as unknown as Env).DB;
    // Simulates a row imported before migration 0008: phoneless, no bubble_id.
    await db.prepare(
      `INSERT INTO families (id, name, phone) VALUES ('preFam', 'Legacy NoPhone', NULL)`
    ).bind().run();
    await db.prepare(
      `INSERT INTO visits (id, family_id, visit_date) VALUES ('preV', 'preFam', '2026-07-01')`
    ).bind().run();

    const res = await workerExports.default.fetch('https://example.com/api/admin/import', {
      method: 'POST', headers: authHeader(token),
      body: JSON.stringify({
        families: [
          { bubble_id: 'bub-legacy', name: 'Legacy NoPhone', phone: null, visits: ['2026-07-01', '2026-08-05'] },
        ],
      }),
    });
    expect(res.status).toBe(200);

    // Deduped by name — no second family — and the bubble_id was adopted.
    const fam = await db.prepare(
      `SELECT COUNT(*) AS n FROM families WHERE name = 'Legacy NoPhone'`
    ).first<{ n: number }>();
    expect(fam!.n).toBe(1);
    const backfilled = await db.prepare(
      `SELECT bubble_id FROM families WHERE id = 'preFam'`
    ).first<{ bubble_id: string | null }>();
    expect(backfilled!.bubble_id).toBe('bub-legacy');

    // New visit merged, existing one not duplicated.
    const visits = await db.prepare(
      `SELECT visit_date FROM visits WHERE family_id = 'preFam' ORDER BY visit_date`
    ).all<{ visit_date: string }>();
    expect((visits.results ?? []).map(v => v.visit_date)).toEqual(['2026-07-01', '2026-08-05']);
  });

  it('reports a conflicting bubble_id instead of silently discarding it', async () => {
    await seedUser('imp-admin3', 'Importer Three', '4805550090', 'admin');
    const token = await makeToken('imp-admin3', '4805550090', 'admin');
    const db = (env as unknown as Env).DB;
    // Family already claimed by bubble_id B1, reachable by phone.
    await db.prepare(
      `INSERT INTO families (id, name, phone, bubble_id) VALUES ('conFam', 'Conflict Fam', '4805556666', 'bub-B1')`
    ).run();

    // A second source record with the SAME phone but a DIFFERENT bubble_id.
    const res = await workerExports.default.fetch('https://example.com/api/admin/import', {
      method: 'POST', headers: authHeader(token),
      body: JSON.stringify({
        families: [{ bubble_id: 'bub-B2', name: 'Conflict Fam', phone: '480-555-6666', visits: [] }],
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { errors: { error: string }[] };
    expect(body.errors.some(e => e.error.includes('bub-B2') && e.error.includes('different bubble_id'))).toBe(true);
    // And the stored mapping is untouched.
    const fam = await db.prepare(`SELECT bubble_id FROM families WHERE id = 'conFam'`).first<{ bubble_id: string }>();
    expect(fam!.bubble_id).toBe('bub-B1');
  });

  it('a visit date repeated within one source row creates exactly one visit', async () => {
    await seedUser('imp-admin4', 'Importer Four', '4805550091', 'admin');
    const token = await makeToken('imp-admin4', '4805550091', 'admin');
    const db = (env as unknown as Env).DB;

    // New-family branch: duplicate date in one row.
    const res = await workerExports.default.fetch('https://example.com/api/admin/import', {
      method: 'POST', headers: authHeader(token),
      body: JSON.stringify({
        families: [{ bubble_id: 'bub-dup', name: 'Dup Dates Fam', phone: null, visits: ['2026-08-10', '2026-08-10'] }],
      }),
    });
    expect(res.status).toBe(200);
    const famId = (await db.prepare(`SELECT id FROM families WHERE bubble_id = 'bub-dup'`).first<{ id: string }>())!.id;
    let visits = await db.prepare(`SELECT COUNT(*) AS n FROM visits WHERE family_id = ?`).bind(famId).first<{ n: number }>();
    expect(visits!.n).toBe(1);

    // Existing-family branch: re-import with a NEW date repeated twice.
    const res2 = await workerExports.default.fetch('https://example.com/api/admin/import', {
      method: 'POST', headers: authHeader(token),
      body: JSON.stringify({
        families: [{ bubble_id: 'bub-dup', name: 'Dup Dates Fam', phone: null, visits: ['2026-08-11', '2026-08-11'] }],
      }),
    });
    expect(res2.status).toBe(200);
    visits = await db.prepare(`SELECT COUNT(*) AS n FROM visits WHERE family_id = ?`).bind(famId).first<{ n: number }>();
    expect(visits!.n).toBe(2); // one per distinct date, not three
  });

  it('does not import a proxy row whose phone matches the family\'s own phone', async () => {
    await seedUser('imp-admin5', 'Importer Five', '4805550092', 'admin');
    const token = await makeToken('imp-admin5', '4805550092', 'admin');
    const db = (env as unknown as Env).DB;

    const res = await workerExports.default.fetch('https://example.com/api/admin/import', {
      method: 'POST', headers: authHeader(token),
      body: JSON.stringify({
        families: [{
          bubble_id: 'bub-selfproxy', name: 'Self Proxy Source Fam', phone: '480-555-4444', visits: [],
          proxies: [{ name: 'Self Proxy Source Fam', phone: '480-555-4444' }],
        }],
      }),
    });
    expect(res.status).toBe(200);
    const famId = (await db.prepare(`SELECT id FROM families WHERE bubble_id = 'bub-selfproxy'`).first<{ id: string }>())!.id;
    const proxies = await db.prepare(`SELECT COUNT(*) AS n FROM proxies WHERE family_id = ?`).bind(famId).first<{ n: number }>();
    expect(proxies!.n).toBe(0);
  });
});
