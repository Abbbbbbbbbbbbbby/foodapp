import type { Env, ClientEventKind, ClientEventLevel } from '../schema';
import { getAuthContext } from '../middleware';
import { isLocalHostname } from './auth';
import { checkClientEventLimit } from '../ratelimit';

const MAX_BODY_BYTES = 256 * 1024;
const MAX_EVENTS_PER_BATCH = 50;
const MAX_MESSAGE_CHARS = 1_000;
const MAX_STACK_CHARS = 8_000;
const MAX_EXTRA_CHARS = 2_048;

const VALID_KINDS: ClientEventKind[] = [
  'js_error', 'unhandled_rejection', 'react_boundary', 'view_change',
  'wizard_step', 'draft_restored', 'draft_discarded', 'sw_update',
  'visibility', 'api_failure',
];
const VALID_LEVELS: ClientEventLevel[] = ['error', 'warn', 'info'];

interface RawEvent {
  id?: unknown;
  occurred_at?: unknown;
  session_id?: unknown;
  device_id?: unknown;
  seq?: unknown;
  level?: unknown;
  kind?: unknown;
  route?: unknown;
  wizard_step?: unknown;
  view_type?: unknown;
  message?: unknown;
  stack?: unknown;
  user_agent?: unknown;
  online?: unknown;
  app_version?: unknown;
  extra?: unknown;
}

export async function handleClientEventRoutes(
  request: Request,
  env: Env,
  pathname: string
): Promise<Response | null> {
  if (pathname === '/api/client-events' && request.method === 'POST') {
    return handleIngest(request, env);
  }
  if (pathname === '/api/test/client-events' && request.method === 'GET') {
    if (env.ENVIRONMENT !== 'test') return Response.json({ error: 'Not found' }, { status: 404 });
    // Same belt-and-suspenders host gate as /api/test/latest-otp: a mistaken
    // ENVIRONMENT flip must not expose this on a public hostname.
    if (!isLocalHostname(request)) {
      console.warn('test route denied on host', new URL(request.url).hostname);
      return Response.json({ error: 'Not found' }, { status: 404 });
    }
    return handleTestList(request, env);
  }
  return null;
}

// Streams the body, counting real wire bytes, and aborts past maxBytes
// (returns null) instead of buffering first and checking after.
async function readBodyCapped(request: Request, maxBytes: number): Promise<string | null> {
  if (!request.body) return '';
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(merged);
}

function truncate(v: unknown, max: number): string | null {
  if (typeof v !== 'string') return null;
  return v.length > max ? v.slice(0, max) : v;
}

async function handleIngest(request: Request, env: Env): Promise<Response> {
  // Content-Length pre-check: reject before buffering the body when the
  // client honestly reports its size. A client can lie about this header
  // (or omit it), so the post-read byte check below is still the
  // authoritative guard — this is a cheap first line of defense only.
  const declaredLength = Number(request.headers.get('content-length'));
  if (declaredLength && declaredLength > MAX_BODY_BYTES) {
    console.error('client-events rejected', 400, `declared content-length ${declaredLength} exceeds ${MAX_BODY_BYTES}`);
    return Response.json({ error: 'Body too large' }, { status: 400 });
  }

  // Read the raw body with a HARD byte cap enforced DURING the read — a
  // request without Content-Length would otherwise buffer unbounded into the
  // isolate's 128 MB before the post-read check ever ran. Every rejection
  // below logs, so a malformed or oversized batch is never silently dropped.
  const raw = await readBodyCapped(request, MAX_BODY_BYTES);
  if (raw === null) {
    console.error('client-events rejected', 400, `body exceeded ${MAX_BODY_BYTES} bytes mid-read`);
    return Response.json({ error: 'Body too large' }, { status: 400 });
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    console.error('client-events rejected', 400, raw.slice(0, 64_000));
    return Response.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  if (!Array.isArray(parsed) || parsed.length === 0) {
    console.error('client-events rejected', 400, raw.slice(0, 64_000));
    return Response.json({ error: 'Body must be a non-empty array of events' }, { status: 400 });
  }
  if (parsed.length > MAX_EVENTS_PER_BATCH) {
    console.error('client-events rejected', 400, raw.slice(0, 64_000));
    return Response.json({ error: `Batch exceeds ${MAX_EVENTS_PER_BATCH} events` }, { status: 400 });
  }

  const events: RawEvent[] = parsed;
  for (const e of events) {
    if (typeof e !== 'object' || e === null) {
      console.error('client-events rejected', 400, raw.slice(0, 64_000));
      return Response.json({ error: 'Each event must be an object' }, { status: 400 });
    }
    if (typeof e.id !== 'string' || !e.id) {
      console.error('client-events rejected', 400, raw.slice(0, 64_000));
      return Response.json({ error: 'Each event requires an id' }, { status: 400 });
    }
    if (typeof e.session_id !== 'string' || !e.session_id) {
      console.error('client-events rejected', 400, raw.slice(0, 64_000));
      return Response.json({ error: 'Each event requires a session_id' }, { status: 400 });
    }
    if (typeof e.device_id !== 'string' || !e.device_id) {
      console.error('client-events rejected', 400, raw.slice(0, 64_000));
      return Response.json({ error: 'Each event requires a device_id' }, { status: 400 });
    }
    if (typeof e.level !== 'string' || !VALID_LEVELS.includes(e.level as ClientEventLevel)) {
      console.error('client-events rejected', 400, raw.slice(0, 64_000));
      return Response.json({ error: 'Each event requires a valid level' }, { status: 400 });
    }
    if (typeof e.kind !== 'string' || !VALID_KINDS.includes(e.kind as ClientEventKind)) {
      console.error('client-events rejected', 400, raw.slice(0, 64_000));
      return Response.json({ error: 'Each event requires a valid kind' }, { status: 400 });
    }
  }

  // Unauthenticated error reports are accepted by design — a crashed or
  // logged-out client must still be able to report. Best-effort attribution
  // only; never 401 this endpoint.
  const ctx = await getAuthContext(request, env);
  const userId = ctx?.userId ?? null;

  // Per-device rate limit is keyed on client-supplied device_id, so it only
  // dampens an honest client's bug; the global cap (inside
  // checkClientEventLimit) is the real backstop. All events in a batch share
  // one device_id in practice (one client, one flush) — key on the first.
  // Bounded to match the stored column AND to keep the KV rate-limit key
  // under KV's 512-byte key cap — an oversized device_id would otherwise
  // make the kv.put throw and 500 the whole batch.
  const deviceId = (typeof events[0].device_id === 'string' ? events[0].device_id : 'unknown').slice(0, 128);
  const ip = env.ENVIRONMENT === 'test' ? undefined : request.headers.get('CF-Connecting-IP') ?? 'unknown';
  const limit = await checkClientEventLimit(env.SESSIONS, deviceId, events.length, { skipGlobal: env.ENVIRONMENT === 'test', ip });
  if (!limit.allowed) {
    console.error('client-events rejected', 429, raw.slice(0, 64_000));
    return Response.json({ error: 'Rate limited' }, { status: 429 });
  }

  const now = new Date().toISOString();
  const statements = events.map(e => env.DB.prepare(
    `INSERT OR IGNORE INTO client_events
      (id, received_at, occurred_at, user_id, session_id, device_id, seq, level, kind,
       route, wizard_step, view_type, message, stack, user_agent, online, app_version, extra)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    // Identifier fields are bounded too — honest ids are 36-char UUIDs, but
    // these are client-supplied and otherwise let one event approach the
    // 256 KiB body cap, which would blow up any later buffered export.
    truncate(e.id, 128),
    now,
    truncate(e.occurred_at, 64),
    userId,
    truncate(e.session_id, 128),
    truncate(e.device_id, 128),
    typeof e.seq === 'number' ? e.seq : null,
    e.level,
    e.kind,
    truncate(e.route, 512),
    typeof e.wizard_step === 'number' ? e.wizard_step : null,
    truncate(e.view_type, 128),
    truncate(e.message, MAX_MESSAGE_CHARS),
    truncate(e.stack, MAX_STACK_CHARS),
    truncate(e.user_agent, 512),
    e.online === true ? 1 : e.online === false ? 0 : null,
    truncate(e.app_version, 64),
    truncate(e.extra, MAX_EXTRA_CHARS)
  ));

  await env.DB.batch(statements);
  return Response.json({ ok: true });
}

async function handleTestList(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const sessionId = url.searchParams.get('session_id');
  const deviceId = url.searchParams.get('device_id');
  const kind = url.searchParams.get('kind');

  const conditions: string[] = [];
  const params: string[] = [];
  if (sessionId) { conditions.push('session_id = ?'); params.push(sessionId); }
  if (deviceId) { conditions.push('device_id = ?'); params.push(deviceId); }
  if (kind) { conditions.push('kind = ?'); params.push(kind); }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const { results } = await env.DB.prepare(
    `SELECT * FROM client_events ${where} ORDER BY received_at DESC LIMIT 100`
  ).bind(...params).all();
  return Response.json({ events: results });
}

// Exported for the scheduled handler (src/worker/index.ts) and tested
// directly rather than via a wall-clock-dependent scheduled-controller test.
export async function purgeOldClientEvents(db: D1Database): Promise<void> {
  await db.prepare(
    `DELETE FROM client_events WHERE received_at < datetime('now', '-30 days')`
  ).run();
}
