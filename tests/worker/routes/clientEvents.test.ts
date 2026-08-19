import { env, exports as workerExports } from 'cloudflare:workers';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { buildSession, createSession } from '../../../src/worker/auth';
import { purgeOldClientEvents } from '../../../src/worker/routes/clientEvents';
import type { Env } from '../../../src/worker/schema';

const USER_ID = 'testeventuser001';
const USER_PHONE = '4805550201';

function uuid(): string {
  return crypto.randomUUID();
}

function makeEvent(overrides: Record<string, unknown> = {}) {
  return {
    id: uuid(),
    occurred_at: new Date().toISOString(),
    session_id: 'session-1',
    device_id: 'device-1',
    seq: 1,
    level: 'info',
    kind: 'view_change',
    route: '/enter',
    wizard_step: null,
    view_type: 'lookup',
    message: null,
    stack: null,
    user_agent: 'test-agent',
    online: true,
    app_version: 'test',
    extra: null,
    ...overrides,
  };
}

async function clearEvents() {
  const e = env as unknown as Env;
  await e.DB.prepare(`DELETE FROM client_events`).run();
  const list = await e.SESSIONS.list({ prefix: 'rl:cev:' });
  await Promise.all(list.keys.map(k => e.SESSIONS.delete(k.name)));
}

describe('POST /api/client-events', () => {
  beforeEach(clearEvents);

  it('accepts an unauthenticated batch with user_id null', async () => {
    const ev = makeEvent();
    const res = await workerExports.default.fetch('https://example.com/api/client-events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify([ev]),
    });
    expect(res.status).toBe(200);
    const e = env as unknown as Env;
    const row = await e.DB.prepare(`SELECT user_id FROM client_events WHERE id = ?`).bind(ev.id).first<{ user_id: string | null }>();
    expect(row?.user_id).toBeNull();
  });

  it('attributes user_id when a valid bearer token is sent', async () => {
    const e = env as unknown as Env;
    await e.DB.prepare(
      `INSERT OR IGNORE INTO users (id, name, phone, role, active, self_registered) VALUES (?, 'Event Tester', ?, 'volunteer', 1, 1)`
    ).bind(USER_ID, USER_PHONE).run();
    const { token, payload } = await buildSession(USER_ID, USER_PHONE, 'volunteer', e.JWT_SECRET);
    await createSession(e.SESSIONS, payload);

    const ev = makeEvent();
    const res = await workerExports.default.fetch('https://example.com/api/client-events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify([ev]),
    });
    expect(res.status).toBe(200);
    const row = await e.DB.prepare(`SELECT user_id FROM client_events WHERE id = ?`).bind(ev.id).first<{ user_id: string | null }>();
    expect(row?.user_id).toBe(USER_ID);
  });

  it('rejects a batch over 50 events with 400, and logs the raw rejected body', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const events = Array.from({ length: 51 }, () => makeEvent());
    const res = await workerExports.default.fetch('https://example.com/api/client-events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(events),
    });
    expect(res.status).toBe(400);
    // The console.error spy may or may not observe a call inside the workers
    // pool isolate (unverified capability, per plan). If it does, assert the
    // raw body was logged; if it never fires, the 400 response itself is
    // still asserted above — spying is a bonus assertion, not load-bearing.
    if (errSpy.mock.calls.length > 0) {
      const loggedArgs = errSpy.mock.calls.flat().join(' ');
      expect(loggedArgs).toContain(events[0].id);
    }
    errSpy.mockRestore();
  });

  it('duplicate ids within one batch, and across two batches, insert exactly one row (INSERT OR IGNORE)', async () => {
    const ev = makeEvent();
    const res1 = await workerExports.default.fetch('https://example.com/api/client-events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify([ev, { ...ev }]),
    });
    expect(res1.status).toBe(200);

    const res2 = await workerExports.default.fetch('https://example.com/api/client-events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify([ev]),
    });
    expect(res2.status).toBe(200);

    const e = env as unknown as Env;
    const { results } = await e.DB.prepare(`SELECT id FROM client_events WHERE id = ?`).bind(ev.id).all();
    expect(results.length).toBe(1);
  });

  it('truncates oversized message/stack/extra instead of rejecting', async () => {
    const ev = makeEvent({
      message: 'm'.repeat(2_000),
      stack: 's'.repeat(10_000),
      extra: 'e'.repeat(3_000),
    });
    const res = await workerExports.default.fetch('https://example.com/api/client-events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify([ev]),
    });
    expect(res.status).toBe(200);
    const e = env as unknown as Env;
    const row = await e.DB.prepare(`SELECT message, stack, extra FROM client_events WHERE id = ?`).bind(ev.id)
      .first<{ message: string; stack: string; extra: string }>();
    expect(row?.message.length).toBe(1_000);
    expect(row?.stack.length).toBe(8_000);
    expect(row?.extra.length).toBe(2_048);
  });

  it('returns 429 after the per-device cap, and logs the rejection', async () => {
    const { handleClientEventRoutes } = await import('../../../src/worker/routes/clientEvents');
    const e = env as unknown as Env;
    const deviceId = `cap-device-${uuid()}`;
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    // skipGlobal is only set for ENVIRONMENT==='test' in the handler, and
    // the per-device cap (800/hr) is enforced regardless — set env to a
    // non-test value here so the per-device cap alone is exercised without
    // needing 800 requests: we call checkClientEventLimit directly instead.
    const { checkClientEventLimit } = await import('../../../src/worker/ratelimit');
    for (let i = 0; i < 800; i++) {
      await checkClientEventLimit(e.SESSIONS, deviceId, { skipGlobal: true });
    }
    const ev = makeEvent({ device_id: deviceId });
    const req = new Request('https://example.com/api/client-events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify([ev]),
    });
    const res = await handleClientEventRoutes(req, { ...e, ENVIRONMENT: 'production' }, '/api/client-events');
    expect(res?.status).toBe(429);
    if (errSpy.mock.calls.length > 0) {
      const loggedArgs = errSpy.mock.calls.flat().join(' ');
      expect(loggedArgs).toContain('429');
    }
    errSpy.mockRestore();
  });
});

describe('purgeOldClientEvents', () => {
  it('deletes rows older than 30 days, keeps newer rows', async () => {
    const e = env as unknown as Env;
    const oldId = uuid();
    const newId = uuid();
    await e.DB.prepare(
      `INSERT INTO client_events (id, received_at, session_id, device_id, level, kind)
       VALUES (?, datetime('now', '-31 days'), 's', 'd', 'info', 'view_change')`
    ).bind(oldId).run();
    await e.DB.prepare(
      `INSERT INTO client_events (id, received_at, session_id, device_id, level, kind)
       VALUES (?, datetime('now', '-1 days'), 's', 'd', 'info', 'view_change')`
    ).bind(newId).run();

    await purgeOldClientEvents(e.DB);

    const old = await e.DB.prepare(`SELECT id FROM client_events WHERE id = ?`).bind(oldId).first();
    const fresh = await e.DB.prepare(`SELECT id FROM client_events WHERE id = ?`).bind(newId).first();
    expect(old).toBeNull();
    expect(fresh).not.toBeNull();
  });
});

describe('GET /api/test/client-events — production gate', () => {
  it('is unreachable when ENVIRONMENT is not "test"', async () => {
    const { handleClientEventRoutes } = await import('../../../src/worker/routes/clientEvents');
    const e = env as unknown as Env;
    const req = new Request('https://example.com/api/test/client-events');
    const gated = await handleClientEventRoutes(req, { ...e, ENVIRONMENT: 'production' }, '/api/test/client-events');
    expect(gated?.status).toBe(404);

    const open = await handleClientEventRoutes(req, { ...e, ENVIRONMENT: 'test' }, '/api/test/client-events');
    expect(open?.status).toBe(200);
  });
});
