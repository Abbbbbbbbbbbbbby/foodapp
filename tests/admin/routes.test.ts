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

const FAKE_STATE = 'state-abc-123';
function fakeClient(props: UserProps): AuthClient {
  return {
    authorize: async () => ({
      url: 'https://issuer.example/authorize',
      challenge: { state: FAKE_STATE, verifier: 'fake-verifier' },
    }),
    exchange: async () => ({ tokens: { access: 'fake-access' } }),
    verify: async () => ({ subject: { properties: props } }),
  };
}

// Runs the full flow: /auth/login mints the signed challenge cookie, then the
// callback is invoked with that cookie and the issuer-echoed state. Returns
// the callback response.
async function callbackWithState(app: ReturnType<typeof buildApp>, state = FAKE_STATE): Promise<Response> {
  const login = await app.request('http://127.0.0.1/auth/login', {}, e());
  const oauthCookie = (login.headers.get('Set-Cookie') ?? '').split(';')[0];
  return app.request(`http://127.0.0.1/auth/callback?code=x&state=${encodeURIComponent(state)}`, {
    headers: { Cookie: oauthCookie },
  }, e());
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
    const res = await callbackWithState(app);
    expect(res.status).toBe(302);
    expect(res.headers.get('Location')).toBe('/');
    const setCookie = res.headers.get('Set-Cookie') ?? '';
    expect(setCookie).toContain(SESSION_COOKIE);
    // Pin the session-theft hardening attributes, not just the name.
    expect(setCookie).toMatch(/HttpOnly/i);
    expect(setCookie).toMatch(/Secure/i);
    expect(setCookie).toMatch(/SameSite=Lax/i);
    expect(setCookie).toMatch(/Path=\//i);
  });

  it('a callback without the challenge cookie is denied and logged (login-CSRF binding)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const app = buildApp(() => fakeClient({ email: `abby@${CCF}`, authzBasis: 'domain', googleDomain: CCF }));
    const res = await app.request(`http://127.0.0.1/auth/callback?code=x&state=${FAKE_STATE}`, {}, e());
    expect(res.headers.get('Location')).toBe('/denied');
    expect(warn).toHaveBeenCalledWith('admin login denied', expect.objectContaining({ hadCookie: false }));
    warn.mockRestore();
  });

  it('a callback with a mismatched state is denied', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const app = buildApp(() => fakeClient({ email: `abby@${CCF}`, authzBasis: 'domain', googleDomain: CCF }));
    const res = await callbackWithState(app, 'some-other-state');
    expect(res.headers.get('Location')).toBe('/denied');
    warn.mockRestore();
  });

  it('a subject without an email is denied and logged (no empty-session loop)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const app = buildApp(() => fakeClient({ authzBasis: 'allowlist' }));
    const res = await callbackWithState(app);
    expect(res.headers.get('Location')).toBe('/denied');
    expect(res.headers.get('Set-Cookie') ?? '').not.toContain(`${SESSION_COOKIE}=e`);
    expect(warn).toHaveBeenCalledWith('admin login denied', expect.objectContaining({ reason: 'no email in subject' }));
    warn.mockRestore();
  });

  it('a group_membership subject is denied and the denial is logged', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const app = buildApp(() => fakeClient({ email: `x@${CCF}`, authzBasis: 'group_membership', googleDomain: CCF }));
    const res = await callbackWithState(app);
    expect(res.status).toBe(302);
    expect(res.headers.get('Location')).toBe('/denied');
    expect(res.headers.get('Set-Cookie') ?? '').not.toContain(`${SESSION_COOKIE}=e`);
    expect(warn).toHaveBeenCalledWith('admin login denied', expect.objectContaining({ authzBasis: 'group_membership' }));
    warn.mockRestore();
  });

  it('a wrong-domain subject is denied and logged', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const app = buildApp(() => fakeClient({ email: 'x@evil.example', authzBasis: 'domain', googleDomain: 'evil.example' }));
    const res = await callbackWithState(app);
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

describe('response hardening + edge cases', () => {
  beforeEach(clearEvents);

  it('authed responses carry no-store and frame-denial headers', async () => {
    const res = await authedGet('/');
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(res.headers.get('X-Frame-Options')).toBe('DENY');
    expect(res.headers.get('Content-Security-Policy')).toContain("frame-ancestors 'none'");
  });

  it('nonsense page params clamp to 1 instead of erroring', async () => {
    await seed([{ id: 'clamp-1' }]);
    for (const p of ['-1', '0', 'abc', 'Infinity', '1e309', '99999999999999999999']) {
      const res = await authedGet(`/events?page=${p}`);
      expect(res.status).toBe(200);
    }
  });

  it('breadcrumbs work for an anchor with null occurred_at (real error events)', async () => {
    const t0 = Date.parse('2026-08-20T10:00:00Z');
    await seed([0, 1, 2].map(i => ({
      id: `na-${i}`, session_id: 's-na', seq: i,
      occurred_at: new Date(t0 + i * 1000).toISOString(),
      received_at: new Date(t0 + i * 1000).toISOString(),
    })));
    await seed([{ id: 'na-anchor', session_id: 's-na', seq: 3, level: 'error',
      occurred_at: null, received_at: new Date(t0 + 3000).toISOString() }]);
    const html = await (await authedGet('/events/na-anchor')).text();
    expect(html).toContain('na-2');
    expect(html).toContain('na-0');
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

  it('guards whitespace-prefixed formulas (OWASP tab/CR/LF vectors) and handles an empty result set', async () => {
    await seed([
      { id: 'csv-tab', message: '\t=cmd|/C calc!A1' },
      { id: 'csv-cr', message: '\r@SUM(1,2)' },
    ]);
    const res = await authedGet('/events.csv');
    const body = await res.text();
    // The apostrophe lands ahead of the leading control character. A bare tab
    // needs no RFC-4180 quoting; a CR does, so that cell is also quoted.
    expect(body).toContain(`'\t=cmd|/C calc!A1`);
    expect(body).toContain(`"'\r@SUM(1,2)"`);

    await clearEvents();
    const empty = await (await authedGet('/events.csv')).text();
    expect(empty.trim()).toBe('id,received_at,occurred_at,user_id,session_id,device_id,seq,level,kind,route,wizard_step,view_type,message,stack,user_agent,online,app_version,extra');
  });

  it('a byte-budget truncation is distinguishable from a row-cap truncation', async () => {
    // A handful of near-max-size hostile rows exhausts the 8M-char budget well
    // before the 2000-row cap — the log and the artifact must say "byte budget".
    const t = Date.now();
    await seed(Array.from({ length: 30 }, (_, i) => ({
      id: `fat-${String(i).padStart(3, '0')}`, level: 'info',
      message: 'x'.repeat(900_000),
      received_at: new Date(t - i * 10).toISOString(),
    })));
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const res = await authedGet('/events.csv?level=info');
    const body = await res.text();
    expect(body).toContain('(byte budget)');
    expect(body).not.toContain('(row cap)');
    expect(log).toHaveBeenCalledWith('csv export', expect.objectContaining({ truncation: 'byte-budget' }));
    log.mockRestore();
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
    expect(body).toContain('# TRUNCATED at 2000 rows (row cap)');
    expect(log).toHaveBeenCalledWith('csv export', expect.objectContaining({ truncation: 'row-cap', rowCount: 2000 }));
    log.mockRestore();
  });
});
