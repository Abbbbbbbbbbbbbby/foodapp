// Route-level tests against the real Hono app, including the real callback
// handler with an injected fake OpenAuth client (no CCF repo stubs the
// issuer; the live round-trip is verified manually at first deploy).
import { env, exports as workerExports } from 'cloudflare:workers';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { buildApp } from '../../src/admin/index';
import type { AdminEnv } from '../../src/admin/types';
import type { AuthClient } from '../../src/admin/auth';
import type { UserProps } from '../../src/admin/authz';
import { signSession, SESSION_COOKIE } from '../../src/admin/session';

const e = () => env as unknown as AdminEnv;
const SECRET = 'test-admin-secret';
const CCF = 'creightoncommunityfoundation.org';

async function authedGet(path: string, email = `staff@${CCF}`): Promise<Response> {
  const cookie = await signSession(email, SECRET);
  return workerExports.default.fetch(`http://127.0.0.1${path}`, {
    headers: { Cookie: `${SESSION_COOKIE}=${cookie}` },
  });
}

function fakeClient(props: UserProps): AuthClient {
  return {
    authorize: async () => ({ url: 'https://issuer.example/authorize' }),
    exchange: async () => ({ tokens: { access: 'fake-access' } }),
    verify: async () => ({ subject: { properties: props } }),
  };
}

async function clearEvents() {
  await e().DB.prepare('DELETE FROM client_events').run();
}

interface SeedRow {
  id: string; session_id?: string; device_id?: string; seq?: number | null;
  level?: string; kind?: string; message?: string | null;
  received_at?: string; occurred_at?: string | null; user_id?: string | null;
}
async function seed(rows: SeedRow[]) {
  for (const r of rows) {
    await e().DB.prepare(
      `INSERT INTO client_events (id, received_at, occurred_at, user_id, session_id, device_id, seq, level, kind, message, app_version)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'test')`
    ).bind(
      r.id, r.received_at ?? new Date().toISOString(), r.occurred_at ?? null,
      r.user_id ?? null, r.session_id ?? 's1', r.device_id ?? 'd1',
      r.seq ?? null, r.level ?? 'info', r.kind ?? 'view_change', r.message ?? null
    ).run();
  }
}

describe('auth gating', () => {
  it('unauthenticated / redirects to /login', async () => {
    const res = await workerExports.default.fetch('http://127.0.0.1/', { redirect: 'manual' });
    expect(res.status).toBe(302);
    expect(res.headers.get('Location')).toContain('/login');
  });

  it('unauthenticated /events.csv redirects to /login', async () => {
    const res = await workerExports.default.fetch('http://127.0.0.1/events.csv', { redirect: 'manual' });
    expect(res.status).toBe(302);
  });

  it('healthz is public', async () => {
    const res = await workerExports.default.fetch('http://127.0.0.1/healthz');
    expect(res.status).toBe(200);
  });

  it('serves 503 everywhere except healthz when the session secret is unset (fail closed)', async () => {
    const app = buildApp();
    const envNoSecret = { ...e(), FOODBOX_ADMIN_SESSION_SECRET: '' } as AdminEnv;
    const denied = await app.request('http://127.0.0.1/login', {}, envNoSecret);
    expect(denied.status).toBe(503);
    const health = await app.request('http://127.0.0.1/healthz', {}, envNoSecret);
    expect(health.status).toBe(200);
  });
});

describe('OAuth callback with injected fake client', () => {
  it('a good domain subject gets a session cookie and lands on /', async () => {
    const app = buildApp(() => fakeClient({ email: `abby@${CCF}`, authzBasis: 'domain', googleDomain: CCF }));
    const res = await app.request('http://127.0.0.1/auth/callback?code=x', {}, e());
    expect(res.status).toBe(302);
    expect(res.headers.get('Location')).toBe('/');
    expect(res.headers.get('Set-Cookie')).toContain(SESSION_COOKIE);
  });

  it('a group_membership subject is denied and the denial is logged', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const app = buildApp(() => fakeClient({ email: `x@${CCF}`, authzBasis: 'group_membership', googleDomain: CCF }));
    const res = await app.request('http://127.0.0.1/auth/callback?code=x', {}, e());
    expect(res.status).toBe(302);
    expect(res.headers.get('Location')).toBe('/denied');
    expect(res.headers.get('Set-Cookie')).toBeNull();
    expect(warn).toHaveBeenCalledWith('admin login denied', expect.objectContaining({ authzBasis: 'group_membership' }));
    warn.mockRestore();
  });

  it('a wrong-domain subject is denied and logged', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const app = buildApp(() => fakeClient({ email: 'x@evil.example', authzBasis: 'domain', googleDomain: 'evil.example' }));
    const res = await app.request('http://127.0.0.1/auth/callback?code=x', {}, e());
    expect(res.headers.get('Location')).toBe('/denied');
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('POST /logout clears the cookie and the next protected request is unauthenticated', async () => {
    const app = buildApp();
    const res = await app.request('http://127.0.0.1/logout', { method: 'POST' }, e());
    expect(res.status).toBe(302);
    const setCookie = res.headers.get('Set-Cookie') ?? '';
    expect(setCookie).toContain(`${SESSION_COOKIE}=`);
    expect(setCookie.toLowerCase()).toMatch(/max-age=0|expires=/);
    // A cleared cookie value verifies as nothing → redirect to login.
    const after = await app.request('http://127.0.0.1/', { headers: { Cookie: `${SESSION_COOKIE}=` } }, e());
    expect(after.status).toBe(302);
    expect(after.headers.get('Location')).toContain('/login');
  });
});

describe('home + events pages', () => {
  beforeEach(clearEvents);

  it('home shows the 24h error count, normalizing mixed received_at formats', async () => {
    const now = new Date();
    const iso = now.toISOString();                       // T-format
    const space = iso.slice(0, 19).replace('T', ' ');    // space-format, same instant (UTC)
    const oldIso = new Date(now.getTime() - 3 * 86400_000).toISOString();
    await seed([
      { id: 'err-t', level: 'error', received_at: iso },
      { id: 'err-space', level: 'error', received_at: space },
      { id: 'err-old', level: 'error', received_at: oldIso }, // outside 24h
      { id: 'info-1', level: 'info', received_at: iso },
    ]);
    const res = await authedGet('/');
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('>2<'); // both fresh errors, not the old one or the info
  });

  it('filters by level and device_id, newest first', async () => {
    const t = Date.now();
    await seed([
      { id: 'row-aa-1', level: 'error', device_id: 'dev-A', received_at: new Date(t - 2000).toISOString() },
      { id: 'row-aa-2', level: 'error', device_id: 'dev-A', received_at: new Date(t - 1000).toISOString() },
      { id: 'row-bb-1', level: 'error', device_id: 'dev-B', received_at: new Date(t).toISOString() },
      { id: 'row-aa-3', level: 'info', device_id: 'dev-A', received_at: new Date(t).toISOString() },
    ]);
    const res = await authedGet('/events?level=error&device_id=dev-A');
    const html = await res.text();
    expect(html).toContain('row-aa-1');
    expect(html).toContain('row-aa-2');
    expect(html).not.toContain('row-bb-1');
    expect(html).not.toContain('>row-aa-3<');
    expect(html.indexOf('row-aa-2')).toBeLessThan(html.indexOf('row-aa-1')); // newest first
  });

  it('paginates at 50 with an Older link, none on the last page', async () => {
    const t = Date.now();
    await seed(Array.from({ length: 51 }, (_, i) => ({
      id: `pg-${String(i).padStart(3, '0')}`,
      received_at: new Date(t - i * 1000).toISOString(),
    })));
    const p1 = await (await authedGet('/events')).text();
    expect(p1).toContain('Older');
    const p2 = await (await authedGet('/events?page=2')).text();
    expect(p2).toContain('pg-050');
    expect(p2).not.toContain('Older');
  });
});

describe('event detail + breadcrumbs', () => {
  beforeEach(clearEvents);

  it('shows preceding ≤20 same-session events, tuple-ordered, none cross-session', async () => {
    const t0 = Date.parse('2026-08-19T10:00:00Z');
    // 25 events before the anchor in session s-bc, plus another session's rows.
    await seed(Array.from({ length: 25 }, (_, i) => ({
      id: `bc-${String(i).padStart(2, '0')}`, session_id: 's-bc', seq: i,
      occurred_at: new Date(t0 + i * 1000).toISOString(),
      received_at: new Date(t0 + i * 1000).toISOString(),
    })));
    await seed([
      { id: 'anchor', session_id: 's-bc', seq: 25, level: 'error', kind: 'js_error',
        occurred_at: new Date(t0 + 25_000).toISOString(), received_at: new Date(t0 + 25_000).toISOString() },
      { id: 'other-session', session_id: 's-other', seq: 3,
        occurred_at: new Date(t0 + 20_000).toISOString(), received_at: new Date(t0 + 20_000).toISOString() },
    ]);
    const html = await (await authedGet('/events/anchor')).text();
    expect(html).not.toContain('other-session');
    expect(html).toContain('bc-24');
    expect(html).toContain('bc-05'); // 20 crumbs: bc-05 … bc-24
    expect(html).not.toContain('>bc-04<');
  });

  it('same-timestamp middle anchor: tuple predicate picks exactly the lower-seq events', async () => {
    const ts = '2026-08-19T11:00:00.000Z';
    await seed([0, 1, 2, 3, 4].map(i => ({
      id: `same-${i}`, session_id: 's-same', seq: i, occurred_at: ts, received_at: ts,
    })));
    const html = await (await authedGet('/events/same-2')).text();
    expect(html).toContain('same-0');
    expect(html).toContain('same-1');
    expect(html).not.toContain('same-3');
    expect(html).not.toContain('same-4');
  });

  it('null/duplicate seq still orders deterministically via the id tie-breaker', async () => {
    const ts = '2026-08-19T12:00:00.000Z';
    await seed([
      { id: 'dup-a', session_id: 's-dup', seq: null, occurred_at: ts, received_at: ts },
      { id: 'dup-b', session_id: 's-dup', seq: null, occurred_at: ts, received_at: ts },
      { id: 'dup-z', session_id: 's-dup', seq: 1, occurred_at: ts, received_at: ts },
    ]);
    const html = await (await authedGet('/events/dup-z')).text();
    expect(html).toContain('dup-a');
    expect(html).toContain('dup-b');
  });
});

describe('CSV export', () => {
  beforeEach(clearEvents);

  it('returns text/csv attachment with quoting and the formula-injection guard', async () => {
    await seed([
      { id: 'csv-1', message: 'has,comma and\nnewline' },
      { id: 'csv-2', message: '=SUM(A1:A9)' },
    ]);
    const res = await authedGet('/events.csv');
    expect(res.headers.get('Content-Type')).toContain('text/csv');
    expect(res.headers.get('Content-Disposition')).toContain('attachment');
    const body = await res.text();
    expect(body.split('\r\n')[0]).toContain('id,received_at');
    expect(body).toContain('"has,comma and\nnewline"');
    expect(body).toContain(`'=SUM(A1:A9)`);
    expect(body).not.toContain('# TRUNCATED');
  });

  it('filters apply and the truncation marker appears at the cap', async () => {
    const t = Date.now();
    await seed(Array.from({ length: 2001 }, (_, i) => ({
      id: `big-${String(i).padStart(4, '0')}`, level: 'info',
      received_at: new Date(t - i * 10).toISOString(),
    })));
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const res = await authedGet('/events.csv?level=info');
    const body = await res.text();
    expect(body).toContain('# TRUNCATED at 2000 rows');
    expect(log).toHaveBeenCalledWith('csv export', expect.objectContaining({ truncated: true, rowCount: 2000 }));
    log.mockRestore();
  });
});
