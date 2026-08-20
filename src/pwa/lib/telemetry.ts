// Client-side error/breadcrumb capture, offline-safe delivery to
// /api/client-events. Every public function is wrapped so telemetry can
// NEVER throw into the app — a bug here must degrade to "no telemetry",
// never to "broken check-in flow".
//
// IMPORTANT: no side effects at module scope (no window/document/localStorage
// touches at import time). tests/pwa-ui/api-pinning.test.ts imports the REAL
// api.ts (which imports this module) in a jsdom origin whose localStorage
// shim only exists inside its beforeEach — a module-scope access here would
// throw before that shim is installed. All ids/handlers are created lazily.
import { generateUUID, putInStore, deleteFromStore, readAllStore, TELEMETRY_STORE } from './offline';
import { getToken } from '../store/auth';

export type EventKind =
  | 'js_error' | 'unhandled_rejection' | 'react_boundary' | 'view_change'
  | 'wizard_step' | 'draft_restored' | 'draft_discarded' | 'sw_update'
  | 'visibility' | 'api_failure';
export type EventLevel = 'error' | 'warn' | 'info';

interface TrackFields {
  route?: string;
  wizardStep?: number | null;
  viewType?: string | null;
  message?: string;
  stack?: string;
  extra?: unknown;
}

interface StoredEvent {
  id: string;
  occurred_at: string;
  session_id: string;
  device_id: string;
  seq: number;
  level: EventLevel;
  kind: EventKind;
  route: string | null;
  wizard_step: number | null;
  view_type: string | null;
  message: string | null;
  stack: string | null;
  user_agent: string | null;
  online: boolean | null;
  app_version: string;
  extra: string | null;
}

const DEVICE_ID_KEY = 'foodapp_device_id';
const FLUSH_INTERVAL_MS = 10_000;
const MIN_ERROR_FLUSH_INTERVAL_MS = 5_000;
const MAX_EVENTS_PER_CHUNK = 50;
const MAX_CHUNK_BYTES = 200 * 1024;
// navigator.sendBeacon's payload hard limit is 64 KiB (verified against
// MDN, 2026-08-19). Margin below that for JSON/encoding overhead — a chunk
// over the real limit makes sendBeacon() return false, which falls back to
// an async IndexedDB persist that (per this same file's pagehide fix
// earlier this PR) is not reliable during page teardown.
const MAX_BEACON_CHUNK_BYTES = 56 * 1024;
const STORE_CAP = 500;
const APP_VERSION = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : 'dev';

let sessionId: string | null = null;
let deviceId: string | null = null;
let seqCounter = 0;
let initialized = false;
let flushTimerId: ReturnType<typeof setInterval> | null = null;
let lastErrorFlushAt = 0;
const memoryBuffer: StoredEvent[] = [];
let telemetryContext: { route?: string; wizardStep?: number | null; viewType?: string | null } = {};

// Marks errors already reported by the ErrorBoundary so the chained
// window.onerror (which React re-fires for boundary-caught errors) doesn't
// double-report them or show a second banner.
const boundaryHandledErrors = new WeakSet<object>();
export function markBoundaryHandled(err: unknown): void {
  try {
    if (err && typeof err === 'object') boundaryHandledErrors.add(err as object);
  } catch {
    // never throw
  }
}

function readOrMintDeviceId(): string {
  try {
    const existing = localStorage.getItem(DEVICE_ID_KEY);
    if (existing) return existing;
    const fresh = generateUUID();
    localStorage.setItem(DEVICE_ID_KEY, fresh);
    return fresh;
  } catch {
    // Private mode / storage disabled: per-session fallback, still unique
    // for the life of this page load.
    return generateUUID();
  }
}

function ensureIds(): void {
  if (sessionId === null) sessionId = generateUUID();
  if (deviceId === null) deviceId = readOrMintDeviceId();
}

function safeStringify(v: unknown): string | null {
  if (v === undefined) return null;
  try {
    return JSON.stringify(v);
  } catch {
    return null;
  }
}

function buildEvent(kind: EventKind, level: EventLevel, fields?: TrackFields): StoredEvent {
  ensureIds();
  return {
    id: generateUUID(),
    occurred_at: new Date().toISOString(),
    session_id: sessionId!,
    device_id: deviceId!,
    seq: ++seqCounter,
    level,
    kind,
    route: fields?.route ?? telemetryContext.route ?? (typeof location !== 'undefined' ? location.pathname : null) ?? null,
    wizard_step: fields?.wizardStep !== undefined ? fields.wizardStep : telemetryContext.wizardStep ?? null,
    view_type: fields?.viewType !== undefined ? fields.viewType : telemetryContext.viewType ?? null,
    message: fields?.message ?? null,
    stack: fields?.stack ?? null,
    user_agent: typeof navigator !== 'undefined' ? navigator.userAgent : null,
    online: typeof navigator !== 'undefined' ? navigator.onLine : null,
    app_version: APP_VERSION,
    extra: fields?.extra !== undefined ? safeStringify(fields.extra) : null,
  };
}

// Ambient context (current route / wizard step / view type). Shallow-merged,
// never replaced — a call that only sets wizardStep must not drop route.
export function setTelemetryContext(partial: Partial<{ route: string; wizardStep: number | null; viewType: string | null }>): void {
  try {
    telemetryContext = { ...telemetryContext, ...partial };
  } catch {
    // never throw
  }
}

export function trackEvent(kind: EventKind, level: EventLevel, fields?: TrackFields): void {
  try {
    const event = buildEvent(kind, level, fields);
    memoryBuffer.push(event);
    if (level === 'error') {
      const now = Date.now();
      if (now - lastErrorFlushAt >= MIN_ERROR_FLUSH_INTERVAL_MS) {
        lastErrorFlushAt = now;
        void flushTelemetry();
      }
    }
  } catch {
    // never throw
  }
}

function normalizeError(err: unknown): { message: string; stack?: string } {
  if (err instanceof Error) return { message: err.message, stack: err.stack };
  if (typeof err === 'string') return { message: err };
  try {
    return { message: JSON.stringify(err) };
  } catch {
    return { message: String(err) };
  }
}

export function trackError(err: unknown, kind: 'js_error' | 'unhandled_rejection' | 'react_boundary'): void {
  try {
    const { message, stack } = normalizeError(err);
    trackEvent(kind, 'error', { message, stack });
  } catch {
    // never throw
  }
}

function byteLength(s: string): number {
  // .length is UTF-16 code units, not bytes — undercounts for this app's
  // own accented Spanish text, which matters right at a hard byte cap
  // (the beacon path below has none to spare).
  return new TextEncoder().encode(s).length;
}

function chunkEvents(events: StoredEvent[], maxBytes: number): StoredEvent[][] {
  const chunks: StoredEvent[][] = [];
  let current: StoredEvent[] = [];
  let currentSize = 2;
  for (const e of events) {
    const size = byteLength(JSON.stringify(e)) + 1;
    if (current.length >= MAX_EVENTS_PER_CHUNK || (currentSize + size) > maxBytes) {
      if (current.length) chunks.push(current);
      current = [];
      currentSize = 2;
    }
    current.push(e);
    currentSize += size;
  }
  if (current.length) chunks.push(current);
  return chunks;
}

async function safeReadStore(): Promise<StoredEvent[]> {
  try {
    return await readAllStore<StoredEvent>(TELEMETRY_STORE);
  } catch (err) {
    // Best-effort — but a broken telemetry store degrades both this and
    // draft.ts's safety net silently unless traced somewhere (matches the
    // rememberInDirectory pattern already used elsewhere in this app).
    console.warn('telemetry store read failed:', err);
    return [];
  }
}

async function persistToStore(events: StoredEvent[]): Promise<void> {
  try {
    for (const e of events) {
      await putInStore(TELEMETRY_STORE, e);
    }
    await enforceCap();
  } catch (err) {
    // Best-effort — losing a persisted retry is degraded telemetry, not a
    // broken app, but worth a trace.
    console.warn('telemetry store persist failed:', err);
  }
}

async function removeFromStoreSafe(events: StoredEvent[]): Promise<void> {
  for (const e of events) {
    try {
      await deleteFromStore(TELEMETRY_STORE, e.id);
    } catch {
      // no-op — a leftover row just gets re-sent (INSERT OR IGNORE is
      // idempotent server-side) or purged after 30 days.
    }
  }
}

async function enforceCap(): Promise<void> {
  try {
    const all = await readAllStore<StoredEvent>(TELEMETRY_STORE);
    if (all.length <= STORE_CAP) return;
    const sorted = [...all].sort((a, b) => (a.occurred_at ?? '').localeCompare(b.occurred_at ?? ''));
    const excess = sorted.slice(0, sorted.length - STORE_CAP);
    for (const e of excess) {
      await deleteFromStore(TELEMETRY_STORE, e.id);
    }
  } catch (err) {
    // Best-effort cap — an occasional overflow is acceptable, throwing isn't.
    console.warn('telemetry store cap enforcement failed:', err);
  }
}

type ChunkOutcome = 'ok' | 'drop' | 'retry';

async function postChunk(chunk: StoredEvent[]): Promise<ChunkOutcome> {
  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    const token = getToken();
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const res = await fetch('/api/client-events', {
      method: 'POST',
      headers,
      body: JSON.stringify(chunk),
    });
    if (res.ok) return 'ok';
    if (res.status === 400) return 'drop';
    // 429, 5xx, and anything else (incl. a hypothetical 401) retry — this
    // endpoint never actually 401s, and telemetry never touches auth state
    // regardless of status.
    return 'retry';
  } catch {
    return 'retry';
  }
}

async function flushViaFetch(): Promise<void> {
  const stored = await safeReadStore();
  const combined = [...stored, ...memoryBuffer];
  memoryBuffer.length = 0;
  if (combined.length === 0) return;
  for (const chunk of chunkEvents(combined, MAX_CHUNK_BYTES)) {
    const outcome = await postChunk(chunk);
    if (outcome === 'retry') {
      await persistToStore(chunk);
    } else {
      await removeFromStoreSafe(chunk);
    }
  }
}

// Deliberately does NOT read the persisted `telemetry` store first (unlike
// flushViaFetch). Verified 2026-08-19 against real Chromium under
// Playwright: an `await` on an IndexedDB read before the sendBeacon call
// loses the race against page teardown on reload/unload often enough that
// the beacon send silently never happens — sometimes the read resolves,
// sometimes its continuation just never runs. Anything already in the
// persisted store gets picked up by the NEXT page's startup drain (a
// regular, non-unload flushViaFetch call) instead; this function only
// drains what's in the in-memory buffer, synchronously up through the
// sendBeacon calls themselves, so it can't lose that race.
async function flushViaBeacon(): Promise<void> {
  const combined = [...memoryBuffer];
  memoryBuffer.length = 0;
  if (combined.length === 0) return;
  if (typeof navigator === 'undefined' || typeof navigator.sendBeacon !== 'function') {
    await persistToStore(combined);
    return;
  }
  const chunks = chunkEvents(combined, MAX_BEACON_CHUNK_BYTES);
  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    let ok = false;
    try {
      const blob = new Blob([JSON.stringify(chunk)], { type: 'text/plain' });
      ok = navigator.sendBeacon('/api/client-events', blob);
    } catch {
      ok = false;
    }
    if (!ok) {
      // The browser's beacon queue rejected this chunk (a known WebKit
      // weak spot at unload) — further beacon sends in this unload are
      // unlikely to fare better. Best-effort persist of what's left; if
      // the page tears down before this completes too, those events are
      // lost — the same accepted risk already documented for WebKit.
      const remaining = chunks.slice(i).flat();
      await persistToStore(remaining);
      return;
    }
  }
}

export async function flushTelemetry(opts?: { beacon?: boolean }): Promise<void> {
  try {
    if (opts?.beacon) {
      await flushViaBeacon();
    } else {
      await flushViaFetch();
    }
  } catch {
    // never throw/reject
  }
}

function drainEarlyErrors(): void {
  try {
    if (typeof window === 'undefined') return;
    const early = window.__earlyErrors;
    if (!early || early.length === 0) return;
    for (const e of early) {
      trackEvent('js_error', 'error', { message: e.msg, stack: e.stack });
    }
    window.__earlyErrors = [];
  } catch {
    // never throw
  }
}

function installErrorHandlers(): void {
  try {
    if (typeof window === 'undefined') return;
    const previousOnError = window.onerror;
    window.onerror = function (msg, src, line, col, err) {
      try {
        if (err && typeof err === 'object' && boundaryHandledErrors.has(err as object)) {
          // Already reported by ErrorBoundary.componentDidCatch — React
          // re-fires caught errors to window.onerror; suppress the
          // duplicate js_error row AND the chained (early-banner) handler.
          return true;
        }
        trackError(err ?? new Error(String(msg)), 'js_error');
      } catch {
        // never throw from a handler
      }
      if (typeof previousOnError === 'function') {
        return previousOnError.call(window, msg, src, line, col, err);
      }
      return false;
    };
  } catch {
    // never throw
  }
  try {
    window.addEventListener('unhandledrejection', (e: PromiseRejectionEvent) => {
      try {
        trackError(e.reason, 'unhandled_rejection');
      } catch {
        // never throw
      }
    });
  } catch {
    // unhandledrejection unsupported (old Safari) — no-op
  }
}

function installVisibilityHandlers(): void {
  try {
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', () => {
        try {
          if (document.visibilityState === 'hidden') {
            trackEvent('visibility', 'info', { extra: { state: 'hidden' } });
          }
        } catch {
          // never throw
        }
      });
    }
  } catch {
    // no-op
  }
  try {
    if (typeof window !== 'undefined') {
      window.addEventListener('pagehide', () => {
        try {
          // Verified (2026-08-19, Chromium under Playwright): a same-tab
          // reload fires 'pagehide' but NOT 'visibilitychange' — so this
          // breadcrumb can't rely on the visibilitychange handler above for
          // the reload/unload case. Emit it directly here, synchronously,
          // before the flush call reads the buffer.
          trackEvent('visibility', 'info', { extra: { state: 'pagehide' } });
        } catch {
          // never throw
        }
        void flushTelemetry({ beacon: true });
      });
    }
  } catch {
    // no-op
  }
}

function startFlushTimer(): void {
  try {
    if (flushTimerId !== null) return;
    if (typeof setInterval === 'undefined') return;
    flushTimerId = setInterval(() => { void flushTelemetry(); }, FLUSH_INTERVAL_MS);
  } catch {
    // never throw
  }
}

export function initTelemetry(): void {
  try {
    if (initialized) return;
    initialized = true;
    ensureIds();
    installErrorHandlers();
    installVisibilityHandlers();
    drainEarlyErrors();
    startFlushTimer();
    // Startup drain: sends anything left in the telemetry store from a
    // previous session's pagehide fallback.
    void flushTelemetry();
  } catch {
    // never throw
  }
}
