import { env, exports as workerExports } from 'cloudflare:workers';
import { describe, it, expect, beforeEach } from 'vitest';
import { buildSession, createSession } from '../../../src/worker/auth';
import type { Env } from '../../../src/worker/schema';

beforeEach(async () => {
  const db = (env as unknown as Env).DB;
  await db.prepare('DELETE FROM visits').run();
  await db.prepare('DELETE FROM families').run();
  await db.prepare('DELETE FROM users').run();
});

async function seedUser(id: string, name: string, phone: string, role: 'admin' | 'staff' | 'volunteer') {
  const db = (env as unknown as Env).DB;
  await db.prepare(`INSERT INTO users (id, name, phone, role) VALUES (?, ?, ?, ?)`).bind(id, name, phone, role).run();
}

async function makeToken(userId: string, phone: string, role: 'admin' | 'staff' | 'volunteer') {
  const e = env as unknown as Env;
  const { token, payload } = await buildSession(userId, phone, role, e.JWT_SECRET);
  await createSession(e.SESSIONS, payload);
  return token;
}

function authHeader(token: string) {
  return { Authorization: `Bearer ${token}` };
}

async function insertFamily(id: string, fields: Record<string, unknown>) {
  const db = (env as unknown as Env).DB;
  const cols = ['id', ...Object.keys(fields)];
  const vals = [id, ...Object.values(fields)];
  await db.prepare(`INSERT INTO families (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`).bind(...vals).run();
}

async function insertVisit(id: string, familyId: string, visitDate: string, extra: Record<string, unknown> = {}) {
  const db = (env as unknown as Env).DB;
  const cols = ['id', 'family_id', 'visit_date', ...Object.keys(extra)];
  const vals = [id, familyId, visitDate, ...Object.values(extra)];
  await db.prepare(`INSERT INTO visits (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`).bind(...vals).run();
}

describe('GET /api/admin/export', () => {
  it('returns 401 without auth', async () => {
    const res = await workerExports.default.fetch('https://x/api/admin/export?fields=name');
    expect(res.status).toBe(401);
  });

  it('returns 403 for a volunteer', async () => {
    await seedUser('vol1', 'Vol', '4805550001', 'volunteer');
    const token = await makeToken('vol1', '4805550001', 'volunteer');
    const res = await workerExports.default.fetch('https://x/api/admin/export?fields=name', {
      headers: authHeader(token),
    });
    expect(res.status).toBe(403);
  });

  it('returns 400 when no valid fields are given', async () => {
    await seedUser('admin1', 'Admin', '4805550002', 'admin');
    const token = await makeToken('admin1', '4805550002', 'admin');
    const res = await workerExports.default.fetch('https://x/api/admin/export?fields=not_a_real_field', {
      headers: authHeader(token),
    });
    expect(res.status).toBe(400);
  });

  it('staff can export, admin can export', async () => {
    await seedUser('staff1', 'Staff', '4805550003', 'staff');
    const token = await makeToken('staff1', '4805550003', 'staff');
    const res = await workerExports.default.fetch('https://x/api/admin/export?fields=name', {
      headers: authHeader(token),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toContain('text/csv');
    expect(res.headers.get('Content-Disposition')).toContain('attachment');
  });

  it('exports requested family fields with CSV headers and correct row data', async () => {
    await seedUser('admin1', 'Admin', '4805550002', 'admin');
    const token = await makeToken('admin1', '4805550002', 'admin');
    await insertFamily('f1', { name: 'Garcia Family', phone: '4805551111', num_people: 3 });

    // filterMode=field (no filterField) avoids the default visit_date mode's
    // implicit JOIN on visits — see the dedicated test below for that behavior.
    const res = await workerExports.default.fetch('https://x/api/admin/export?fields=name,phone,num_people&filterMode=field', {
      headers: authHeader(token),
    });
    const text = await res.text();
    const lines = text.split('\r\n');
    expect(lines[0]).toBe('Family Name,Phone,Household Size');
    expect(lines[1]).toBe('Garcia Family,4805551111,3');
  });

  it('only exports fields present in the server whitelist — arbitrary column names are silently dropped', async () => {
    await seedUser('admin1', 'Admin', '4805550002', 'admin');
    const token = await makeToken('admin1', '4805550002', 'admin');
    await insertFamily('f1', { name: 'Garcia Family' });

    const res = await workerExports.default.fetch(
      'https://x/api/admin/export?fields=name,created_by,id_confirmed_at_all_costs&filterMode=field',
      { headers: authHeader(token) }
    );
    const text = await res.text();
    const lines = text.split('\r\n');
    expect(lines[0]).toBe('Family Name'); // only the whitelisted field survives
  });

  it('the default filterMode (visit_date) joins to visits — a family with no visit is silently excluded even with no date range set', async () => {
    // Worth pinning explicitly: this is a real, non-obvious behavior. The
    // frontend always sends filterMode explicitly so this only bites a
    // direct API caller that omits it, but it means "export family fields
    // only, no filter" is NOT the same as "every family" unless filterMode
    // is set to something other than the default.
    await seedUser('admin1', 'Admin', '4805550002', 'admin');
    const token = await makeToken('admin1', '4805550002', 'admin');
    await insertFamily('f1', { name: 'No Visit Yet' });
    await insertFamily('f2', { name: 'Has A Visit' });
    await insertVisit('v1', 'f2', '2026-08-01');

    const res = await workerExports.default.fetch('https://x/api/admin/export?fields=name', {
      headers: authHeader(token),
    });
    const lines = (await res.text()).split('\r\n');
    expect(lines).toEqual(['Family Name', 'Has A Visit']);
  });

  it('filters by visit_date range and joins visit + volunteer fields', async () => {
    await seedUser('admin1', 'Admin', '4805550002', 'admin');
    const token = await makeToken('admin1', '4805550002', 'admin');
    await seedUser('vol1', 'Pat Volunteer', '4805550009', 'volunteer');
    await insertFamily('f1', { name: 'Lopez Family' });
    await insertVisit('v1', 'f1', '2026-08-01', { volunteer_id: 'vol1', bag_received: 1 });
    await insertVisit('v2', 'f1', '2026-09-01', { volunteer_id: 'vol1', bag_received: 0 });

    const res = await workerExports.default.fetch(
      'https://x/api/admin/export?fields=name,visit_date,bag_received,volunteer_name&filterMode=visit_date&start=2026-08-01&end=2026-08-31',
      { headers: authHeader(token) }
    );
    const lines = (await res.text()).split('\r\n');
    expect(lines[0]).toBe('Family Name,Visit Date,Bag Received,User');
    expect(lines).toHaveLength(2); // header + exactly the one in-range visit
    expect(lines[1]).toBe('Lopez Family,2026-08-01,Yes,Pat Volunteer');
  });

  it('filters by a single field (filterMode=field), restricted to the filterable whitelist', async () => {
    await seedUser('admin1', 'Admin', '4805550002', 'admin');
    const token = await makeToken('admin1', '4805550002', 'admin');
    await insertFamily('f1', { name: 'English Family', language: 'English' });
    await insertFamily('f2', { name: 'Spanish Family', language: 'Spanish' });

    const res = await workerExports.default.fetch(
      'https://x/api/admin/export?fields=name,language&filterMode=field&filterField=language&filterValue=Spanish',
      { headers: authHeader(token) }
    );
    const lines = (await res.text()).split('\r\n');
    expect(lines).toEqual(['Family Name,Language', 'Spanish Family,Spanish']);
  });

  it('rejects a non-filterable field for filterMode=field — the WHERE clause is silently omitted', async () => {
    await seedUser('admin1', 'Admin', '4805550002', 'admin');
    const token = await makeToken('admin1', '4805550002', 'admin');
    await insertFamily('f1', { name: 'Family One' });
    await insertFamily('f2', { name: 'Family Two' });

    // "phone" is a real column but NOT in the FILTERABLE whitelist — must not
    // become an arbitrary WHERE clause.
    const res = await workerExports.default.fetch(
      'https://x/api/admin/export?fields=name&filterMode=field&filterField=phone&filterValue=anything',
      { headers: authHeader(token) }
    );
    const lines = (await res.text()).split('\r\n');
    expect(lines.length).toBe(3); // header + both families — filter ignored, not applied as SQL
  });

  it('filters by multiple fields (filterMode=multi), ANDed together', async () => {
    await seedUser('admin1', 'Admin', '4805550002', 'admin');
    const token = await makeToken('admin1', '4805550002', 'admin');
    await insertFamily('f1', { name: 'Match', language: 'English', zip_code: '85001' });
    await insertFamily('f2', { name: 'NoMatch', language: 'English', zip_code: '85002' });

    const res = await workerExports.default.fetch(
      'https://x/api/admin/export?fields=name&filterMode=multi&filterField=language&filterValue=English&filterField=zip_code&filterValue=85001',
      { headers: authHeader(token) }
    );
    const lines = (await res.text()).split('\r\n');
    expect(lines).toEqual(['Family Name', 'Match']);
  });

  it('guards Excel formula injection on free-text fields (OWASP CSV-injection)', async () => {
    await seedUser('admin1', 'Admin', '4805550002', 'admin');
    const token = await makeToken('admin1', '4805550002', 'admin');
    await insertFamily('f1', { name: '=cmd|\'/c calc\'!A1' });
    await insertFamily('f2', { name: '+1+1' });
    await insertFamily('f3', { name: '\t=1+1' }); // leading-whitespace vector

    const res = await workerExports.default.fetch('https://x/api/admin/export?fields=name&filterMode=field', {
      headers: authHeader(token),
    });
    const lines = (await res.text()).split('\r\n');
    const rows = lines.slice(1); // ORDER BY f.name ASC sorts by raw bytes, not insertion order
    expect(rows).toHaveLength(3);
    expect(rows).toContain("'=cmd|'/c calc'!A1"); // leading apostrophe neutralizes the formula
    expect(rows).toContain("'+1+1");
    expect(rows).toContain("'\t=1+1");
    for (const row of rows) {
      expect(/^[\t\r\n ]*[=+\-@]/.test(row)).toBe(false);
    }
  });

  it('quotes values containing commas, quotes, or newlines per RFC 4180', async () => {
    await seedUser('admin1', 'Admin', '4805550002', 'admin');
    const token = await makeToken('admin1', '4805550002', 'admin');
    await insertFamily('f1', { name: 'Smith, "Jr."' });

    const res = await workerExports.default.fetch('https://x/api/admin/export?fields=name&filterMode=field', {
      headers: authHeader(token),
    });
    const lines = (await res.text()).split('\r\n');
    expect(lines[1]).toBe('"Smith, ""Jr."""');
  });
});
