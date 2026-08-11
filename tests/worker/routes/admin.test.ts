import { env, SELF } from 'cloudflare:test';
import { describe, it, expect, beforeEach } from 'vitest';
import { buildSession, createSession } from '../../../src/worker/auth';
import type { Env } from '../../../src/worker/schema';

beforeEach(async () => {
  const db = (env as unknown as Env).DB;
  await db.prepare('DELETE FROM visits').run();
  await db.prepare('DELETE FROM families').run();
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
    const res = await SELF.fetch('https://example.com/api/admin/users', {
      headers: authHeader(token),
    });
    expect(res.status).toBe(403);
  });

  it('returns 401 with no auth', async () => {
    const res = await SELF.fetch('https://example.com/api/admin/users');
    expect(res.status).toBe(401);
  });

  it('returns user list for admin', async () => {
    await seedUser('a1', 'Admin', '4805550000', 'admin');
    await seedUser('u1', 'Alice', '4805550001', 'volunteer');
    const token = await makeToken('a1', '4805550000', 'admin');
    const res = await SELF.fetch('https://example.com/api/admin/users', {
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
    const res = await SELF.fetch('https://example.com/api/admin/users/u1', {
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
    const res = await SELF.fetch('https://example.com/api/admin/users/u1', {
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
    const res = await SELF.fetch('https://example.com/api/admin/users/u1', {
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
    const res = await SELF.fetch('https://example.com/api/admin/users/u2', {
      method: 'PATCH',
      headers: authHeader(token),
      body: JSON.stringify({ role: 'staff' }),
    });
    expect(res.status).toBe(403);
  });
});

describe('DELETE /api/admin/users/:id', () => {
  it('deletes a user', async () => {
    await seedUser('a1', 'Admin', '4805550000', 'admin');
    await seedUser('u1', 'Bob', '4805550002', 'volunteer');
    const token = await makeToken('a1', '4805550000', 'admin');
    const res = await SELF.fetch('https://example.com/api/admin/users/u1', {
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
    const res = await SELF.fetch('https://example.com/api/admin/users/a1', {
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
    const res = await SELF.fetch('https://example.com/api/admin/users/nonexistent', {
      method: 'DELETE',
      headers: authHeader(token),
    });
    expect(res.status).toBe(404);
  });

  it('returns 403 for non-admin', async () => {
    await seedUser('u1', 'Alice', '4805550001', 'volunteer');
    await seedUser('u2', 'Bob', '4805550002', 'volunteer');
    const token = await makeToken('u1', '4805550001', 'volunteer');
    const res = await SELF.fetch('https://example.com/api/admin/users/u2', {
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
    const res = await SELF.fetch('https://example.com/api/admin/users/u9', {
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

  it('still blocks deleting the last admin, without corrupting references', async () => {
    await seedUser('a1', 'Admin One', '4805550000', 'admin');
    await seedUser('a2', 'Admin Two', '4805550002', 'admin');
    const db = (env as unknown as Env).DB;
    await db.prepare(`UPDATE users SET active = 0 WHERE id = 'a2'`).run();
    await db.prepare(`INSERT INTO families (id, name, created_by) VALUES ('famG', 'Guard Fam', 'a1')`).run();

    const token = await makeToken('a2', '4805550002', 'admin');
    const res = await SELF.fetch('https://example.com/api/admin/users/a1', {
      method: 'DELETE',
      headers: authHeader(token),
    });
    expect(res.status).toBe(400);
    // Guard rejection left the reference intact — no orphaned attribution
    const fam = await db.prepare(`SELECT created_by FROM families WHERE id = 'famG'`).first<{ created_by: string | null }>();
    expect(fam!.created_by).toBe('a1');
    expect(await db.prepare(`SELECT id FROM users WHERE id = 'a1'`).first()).not.toBeNull();
  });
});
