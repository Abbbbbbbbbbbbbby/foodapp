// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Every test dynamically re-imports both modules after vi.resetModules() so
// telemetry.ts's module-scope singletons (session id, seq counter, buffer,
// "initialized" flag) start fresh per test. The underlying fake-indexeddb
// global is unaffected by resetModules, so persisted-store scenarios
// (offline replay, cap eviction) can be seeded directly via offline.ts and
// observed across a "new session" telemetry.ts instance.
async function freshModules() {
  vi.resetModules();
  const offline = await import('../../src/pwa/lib/offline');
  const telemetry = await import('../../src/pwa/lib/telemetry');
  return { offline, telemetry };
}

function mockFetchOnce(status: number, body: unknown = { ok: true }) {
  return vi.fn(async () => new Response(JSON.stringify(body), { status }));
}

beforeEach(async () => {
  // Clear the store between tests via a fresh module instance.
  const { offline } = await freshModules();
  const rows = await offline.readAllStore<{ id: string }>(offline.TELEMETRY_STORE);
  for (const r of rows) await offline.deleteFromStore(offline.TELEMETRY_STORE, r.id);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('trackEvent + flushTelemetry — chunking', () => {
  it('sends 51 buffered events as two POST batches (50 + 1)', async () => {
    const { telemetry } = await freshModules();
    const calls: unknown[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_url, init) => {
      calls.push(JSON.parse((init as RequestInit).body as string));
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }));
    for (let i = 0; i < 51; i++) {
      telemetry.trackEvent('view_change', 'info', { viewType: `view-${i}` });
    }
    await telemetry.flushTelemetry();
    expect(calls.length).toBe(2);
    expect((calls[0] as unknown[]).length).toBe(50);
    expect((calls[1] as unknown[]).length).toBe(1);
  });
});

describe('trackEvent — error level triggers an immediate flush', () => {
  it('flushes without an explicit flushTelemetry() call', async () => {
    const { telemetry } = await freshModules();
    const fetchMock = mockFetchOnce(200);
    vi.stubGlobal('fetch', fetchMock);
    telemetry.trackError(new Error('boom'), 'js_error');
    // Immediate flush is fire-and-forget (void flushTelemetry()) — give the
    // microtask queue a turn to run it.
    await new Promise(r => setTimeout(r, 10));
    expect(fetchMock).toHaveBeenCalled();
  });
});

describe('flush outcomes per HTTP status', () => {
  it('400 drops the chunk silently (not retried, not left in the store)', async () => {
    const { telemetry, offline } = await freshModules();
    vi.stubGlobal('fetch', mockFetchOnce(400, { error: 'bad' }));
    telemetry.trackEvent('js_error', 'error' as const, { message: 'malformed' });
    await new Promise(r => setTimeout(r, 10)); // let the error-level auto-flush run
    const rows = await offline.readAllStore(offline.TELEMETRY_STORE);
    expect(rows.length).toBe(0);
  });

  it('5xx retains the event in the persisted store for a later retry', async () => {
    const { telemetry, offline } = await freshModules();
    vi.stubGlobal('fetch', mockFetchOnce(500, { error: 'server error' }));
    telemetry.trackEvent('view_change', 'info', { viewType: 'lookup' });
    await telemetry.flushTelemetry();
    const rows = await offline.readAllStore(offline.TELEMETRY_STORE);
    expect(rows.length).toBe(1);
  });

  it('a network error (fetch throws) also retains the event', async () => {
    const { telemetry, offline } = await freshModules();
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network down'); }));
    telemetry.trackEvent('view_change', 'info', { viewType: 'lookup' });
    await telemetry.flushTelemetry();
    const rows = await offline.readAllStore(offline.TELEMETRY_STORE);
    expect(rows.length).toBe(1);
  });
});

describe('event id stability across a retry', () => {
  it('the same client-minted id is sent on both the failed and the successful attempt', async () => {
    const { telemetry, offline } = await freshModules();
    vi.stubGlobal('fetch', mockFetchOnce(500));
    telemetry.trackEvent('view_change', 'info', { viewType: 'lookup' });
    await telemetry.flushTelemetry();
    const stored = await offline.readAllStore<{ id: string }>(offline.TELEMETRY_STORE);
    expect(stored.length).toBe(1);
    const firstId = stored[0].id;

    let sentId: string | undefined;
    vi.stubGlobal('fetch', vi.fn(async (_url, init) => {
      const body = JSON.parse((init as RequestInit).body as string);
      sentId = body[0].id;
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }));
    await telemetry.flushTelemetry();
    expect(sentId).toBe(firstId);
    const after = await offline.readAllStore(offline.TELEMETRY_STORE);
    expect(after.length).toBe(0);
  });
});

describe('offline replay — startup drain', () => {
  it('events persisted by one "session" are delivered on the next initTelemetry() startup drain', async () => {
    // Session 1: goes offline, event gets persisted to the store.
    {
      const { telemetry } = await freshModules();
      vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
      telemetry.trackEvent('view_change', 'info', { viewType: 'lookup' });
      await telemetry.flushTelemetry();
    }
    // Session 2 (fresh module instance, simulating a reload): initTelemetry()
    // drains the persisted store on startup.
    {
      const { telemetry, offline } = await freshModules();
      const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
      vi.stubGlobal('fetch', fetchMock);
      telemetry.initTelemetry();
      await new Promise(r => setTimeout(r, 10));
      expect(fetchMock).toHaveBeenCalled();
      const rows = await offline.readAllStore(offline.TELEMETRY_STORE);
      expect(rows.length).toBe(0);
    }
  });
});

describe('store cap eviction', () => {
  it('caps the persisted store at 500 rows, evicting the oldest first', async () => {
    const { offline, telemetry } = await freshModules();
    // Seed 501 events directly (bypassing telemetry.ts's own writer, which
    // would be slow one-at-a-time) with ascending occurred_at so eviction
    // order is deterministic.
    const base = Date.now();
    for (let i = 0; i < 501; i++) {
      await offline.putInStore(offline.TELEMETRY_STORE, {
        id: `seed-${i}`,
        occurred_at: new Date(base + i).toISOString(),
        session_id: 's', device_id: 'd', seq: i,
        level: 'info', kind: 'view_change',
        route: null, wizard_step: null, view_type: null,
        message: null, stack: null, user_agent: null, online: null,
        app_version: 'test', extra: null,
      });
    }
    // Force every flush chunk down the retry path (network error), which is
    // the only path that calls persistToStore → enforceCap.
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
    await telemetry.flushTelemetry();
    const rows = await offline.readAllStore<{ id: string }>(offline.TELEMETRY_STORE);
    expect(rows.length).toBe(500);
    expect(rows.find(r => r.id === 'seed-0')).toBeUndefined(); // oldest evicted
    expect(rows.find(r => r.id === 'seed-500')).not.toBeUndefined(); // newest kept
  });
});

describe('beacon chunking respects the 64 KiB sendBeacon limit (review finding)', () => {
  it('splits a large buffer into sub-64KiB beacon chunks, distinct from the larger fetch-path chunk size', async () => {
    const { telemetry } = await freshModules();
    const beaconCalls: number[] = [];
    const sendBeacon = vi.fn((_url: string, data: BodyInit) => {
      // Blob.size gives the real byte length of what would be sent.
      beaconCalls.push((data as Blob).size);
      return true;
    });
    Object.defineProperty(navigator, 'sendBeacon', { value: sendBeacon, configurable: true });

    // Each event's stack is truncated server-side at 8000 chars, but the
    // CLIENT buffer isn't truncated before flush — a handful of large
    // stack traces alone exceeds 64KiB, which is exactly the scenario
    // that broke before this fix (large chunk -> sendBeacon returns false
    // -> unreliable async persist during unload). Level 'warn', not
    // 'error' — 'error' would trigger an immediate FETCH-path auto-flush
    // (a different code path, different chunk-size constant) before this
    // test's explicit beacon flush runs.
    for (let i = 0; i < 10; i++) {
      telemetry.trackEvent('api_failure', 'warn', { stack: 's'.repeat(9_000) });
    }
    await telemetry.flushTelemetry({ beacon: true });

    expect(sendBeacon).toHaveBeenCalled();
    expect(beaconCalls.length).toBeGreaterThan(1); // had to split into multiple chunks
    for (const size of beaconCalls) {
      expect(size).toBeLessThan(64 * 1024);
    }
  });
});

describe('never throws', () => {
  it('trackEvent/trackError/setTelemetryContext/flushTelemetry tolerate malformed input', async () => {
    const { telemetry } = await freshModules();
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('down'); }));
    expect(() => telemetry.trackEvent('js_error', 'error', { extra: (() => { const o: Record<string, unknown> = {}; o.self = o; return o; })() })).not.toThrow();
    expect(() => telemetry.trackError(undefined, 'js_error')).not.toThrow();
    expect(() => telemetry.trackError({ weird: 'object' }, 'unhandled_rejection')).not.toThrow();
    expect(() => telemetry.setTelemetryContext({ wizardStep: null })).not.toThrow();
    await expect(telemetry.flushTelemetry()).resolves.toBeUndefined();
    // initTelemetry is idempotent — calling twice must not throw or double-install.
    expect(() => telemetry.initTelemetry()).not.toThrow();
    expect(() => telemetry.initTelemetry()).not.toThrow();
  });
});
