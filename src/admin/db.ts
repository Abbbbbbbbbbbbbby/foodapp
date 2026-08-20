// All console reads. SELECT-only by contract — this worker must never write
// to the shared foodapp DB (see wrangler.admin.jsonc header).
//
// received_at mixes two formats: client ingests bind ISO-with-T strings while
// the column default is datetime('now')'s space format, and 'T' > ' ' makes
// raw string comparison/ordering wrong at the boundary. Every comparison and
// ordering below therefore normalizes with datetime(). The table is 30-day
// purged and ingest-capped, so the resulting full scans are fine.

export interface ClientEventRow {
  id: string;
  received_at: string;
  occurred_at: string | null;
  user_id: string | null;
  session_id: string;
  device_id: string;
  seq: number | null;
  level: string;
  kind: string;
  route: string | null;
  wizard_step: number | null;
  view_type: string | null;
  message: string | null;
  stack: string | null;
  user_agent: string | null;
  online: number | null;
  app_version: string | null;
  extra: string | null;
}

// One column per client_events field, schema order — the CSV export and the
// events table both render from this list (field-data rule: one fact per cell).
export const EVENT_COLUMNS = [
  'id', 'received_at', 'occurred_at', 'user_id', 'session_id', 'device_id',
  'seq', 'level', 'kind', 'route', 'wizard_step', 'view_type', 'message',
  'stack', 'user_agent', 'online', 'app_version', 'extra',
] as const;

export interface EventFilters {
  level?: string;
  kind?: string;
  userId?: string;
  deviceId?: string;
  from?: string; // ISO or datetime-local string
  to?: string;
}

export const PAGE_SIZE = 50;
export const EXPORT_CAP = 2000;

// Identifier fields are bounded at ingest since issue #13, but legacy rows
// predate the bounds — substr() the projection so one hostile legacy row
// can't balloon a buffered export.
const BOUNDED_PROJECTION = `
  substr(id, 1, 128) AS id, received_at, substr(occurred_at, 1, 64) AS occurred_at,
  user_id, substr(session_id, 1, 128) AS session_id, substr(device_id, 1, 128) AS device_id,
  seq, level, kind, route, wizard_step, view_type, message, stack, user_agent,
  online, app_version, extra`;

function buildWhere(f: EventFilters): { where: string; params: (string | number)[] } {
  const clauses: string[] = [];
  const params: (string | number)[] = [];
  if (f.level) { clauses.push('level = ?'); params.push(f.level); }
  if (f.kind) { clauses.push('kind = ?'); params.push(f.kind); }
  if (f.userId) { clauses.push('user_id = ?'); params.push(f.userId); }
  if (f.deviceId) { clauses.push('device_id = ?'); params.push(f.deviceId); }
  if (f.from) { clauses.push('datetime(received_at) >= datetime(?)'); params.push(f.from); }
  if (f.to) { clauses.push('datetime(received_at) < datetime(?)'); params.push(f.to); }
  return { where: clauses.length ? `WHERE ${clauses.join(' AND ')}` : '', params };
}

export async function countErrorsLast24h(db: D1Database): Promise<number> {
  const row = await db.prepare(
    `SELECT COUNT(*) AS n FROM client_events
     WHERE level = 'error' AND datetime(received_at) >= datetime('now', '-1 day')`
  ).first<{ n: number }>();
  return row?.n ?? 0;
}

export async function listEvents(
  db: D1Database, filters: EventFilters, page: number
): Promise<{ rows: ClientEventRow[]; hasNext: boolean }> {
  const { where, params } = buildWhere(filters);
  const offset = (Math.max(1, page) - 1) * PAGE_SIZE;
  // PAGE_SIZE+1 rows: the extra row only signals a next page, it isn't shown.
  const res = await db.prepare(
    `SELECT ${BOUNDED_PROJECTION} FROM client_events ${where}
     ORDER BY datetime(received_at) DESC, id DESC LIMIT ? OFFSET ?`
  ).bind(...params, PAGE_SIZE + 1, offset).all<ClientEventRow>();
  const rows = res.results ?? [];
  return { rows: rows.slice(0, PAGE_SIZE), hasNext: rows.length > PAGE_SIZE };
}

export async function getEvent(db: D1Database, id: string): Promise<ClientEventRow | null> {
  return await db.prepare(
    `SELECT ${BOUNDED_PROJECTION} FROM client_events WHERE id = ?`
  ).bind(id).first<ClientEventRow>();
}

// Preceding 20 same-session events (breadcrumbs), chronological. seq is the
// intra-session ordering fact (README's data contract) but it is nullable and
// client-supplied, so the tuple is (normalized ts, seq, id) with id as the
// deterministic final tie-breaker. Returned oldest-first for display.
export async function getBreadcrumbs(
  db: D1Database, sessionId: string, anchor: ClientEventRow
): Promise<ClientEventRow[]> {
  const anchorTs = anchor.occurred_at ?? anchor.received_at;
  const res = await db.prepare(
    `SELECT ${BOUNDED_PROJECTION} FROM client_events
     WHERE session_id = ?
       AND (COALESCE(datetime(occurred_at), datetime(received_at)), COALESCE(seq, -1), id)
           < (COALESCE(datetime(?), datetime(?)), COALESCE(?, -1), ?)
     ORDER BY COALESCE(datetime(occurred_at), datetime(received_at)) DESC, COALESCE(seq, -1) DESC, id DESC
     LIMIT 20`
  ).bind(sessionId, anchorTs, anchor.received_at, anchor.seq, anchor.id).all<ClientEventRow>();
  return (res.results ?? []).reverse();
}

export async function exportEvents(
  db: D1Database, filters: EventFilters
): Promise<{ rows: ClientEventRow[]; truncated: boolean }> {
  const { where, params } = buildWhere(filters);
  // CAP+1 so exactly-at-cap and truncated are distinguishable; 2000 bounded
  // rows stay well inside the 128 MB isolate for a buffered CSV.
  const res = await db.prepare(
    `SELECT ${BOUNDED_PROJECTION} FROM client_events ${where}
     ORDER BY datetime(received_at) DESC, id DESC LIMIT ?`
  ).bind(...params, EXPORT_CAP + 1).all<ClientEventRow>();
  const rows = res.results ?? [];
  return { rows: rows.slice(0, EXPORT_CAP), truncated: rows.length > EXPORT_CAP };
}
