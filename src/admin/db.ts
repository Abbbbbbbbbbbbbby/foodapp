// All console reads. SELECT-only by contract — this worker must never write
// to the shared foodapp DB (see wrangler.admin.jsonc header).
//
// received_at mixes two formats: client ingests bind ISO-with-T strings while
// the column default is datetime('now')'s space format, and 'T' > ' ' makes
// raw string comparison/ordering wrong at the boundary. Every comparison and
// ordering below therefore normalizes with datetime(). The table is 30-day
// purged and ingest-capped, so the resulting full scans are fine.

import { azLocalToUtcIso } from './tz';

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
  // LEFT JOINed from users via user_id — both null when the event is
  // unattributed (logged-out/crashed session) or the user row is gone.
  volunteer_name: string | null;
  volunteer_phone: string | null;
}

// One column per client_events field, schema order — the events TABLE and the
// column-visibility toggle both render from this list (field-data rule: one
// fact per cell). This is the raw-table shape; EXPORT_COLUMNS below is the
// export shape, which is a strict superset — export must never lose a field
// the table can show.
export const EVENT_COLUMNS = [
  'id', 'received_at', 'occurred_at', 'user_id', 'session_id', 'device_id',
  'seq', 'level', 'kind', 'route', 'wizard_step', 'view_type', 'message',
  'stack', 'user_agent', 'online', 'app_version', 'extra',
] as const;

// CSV/export shape: every raw field, PLUS the joined volunteer identity as
// two additional facts appended at the end. Never reorders or removes an
// existing column — a saved parsing script against an old export must not
// silently break.
export const EXPORT_COLUMNS = [...EVENT_COLUMNS, 'volunteer_name', 'volunteer_phone'] as const;

export interface EventFilters {
  level?: string;
  kind?: string;
  userId?: string;
  deviceId?: string;
  from?: string; // <input type="datetime-local"> value, AZ-local wall time
  to?: string;
  sort?: string;
  dir?: string;
}

export const PAGE_SIZE = 50;
export const EXPORT_CAP = 2000;

// Identifier fields are bounded at ingest since issue #13, but legacy rows
// predate the bounds — substr() the projection so one hostile legacy row
// can't balloon a buffered export. `ce` alias is required once the LEFT JOIN
// to users is in play: `id` would otherwise be ambiguous (both tables have one).
const BOUNDED_PROJECTION = `
  substr(ce.id, 1, 128) AS id, ce.received_at, substr(ce.occurred_at, 1, 64) AS occurred_at,
  ce.user_id, substr(ce.session_id, 1, 128) AS session_id, substr(ce.device_id, 1, 128) AS device_id,
  ce.seq, ce.level, ce.kind, ce.route, ce.wizard_step, ce.view_type, ce.message, ce.stack, ce.user_agent,
  ce.online, ce.app_version, ce.extra, u.name AS volunteer_name, u.phone AS volunteer_phone`;

const FROM_JOIN = `client_events ce LEFT JOIN users u ON u.id = ce.user_id`;

// Sortable columns, allowlisted — never interpolate a user-supplied sort key
// directly into SQL. Each maps to the exact ORDER BY expression to use.
// `received_at` is normalized (see file header); others are stored/typed
// consistently enough to sort raw. `id` is always the final tiebreaker.
const SORTABLE_COLUMNS: Record<string, string> = {
  received_at: 'datetime(ce.received_at)',
  level: 'ce.level',
  kind: 'ce.kind',
  wizard_step: 'ce.wizard_step',
  volunteer: 'u.name',
};
export const SORT_KEYS = Object.keys(SORTABLE_COLUMNS);

function resolveOrderBy(sort?: string, dir?: string): string {
  // A plain-object lookup on user input would resolve inherited keys
  // (constructor/toString/__proto__) as truthy, defeating the `||`
  // fallback and interpolating a built-in's toString() into the SQL —
  // hasOwnProperty closes that off entirely.
  const col = sort && Object.prototype.hasOwnProperty.call(SORTABLE_COLUMNS, sort)
    ? SORTABLE_COLUMNS[sort]
    : SORTABLE_COLUMNS.received_at;
  const direction = dir === 'asc' ? 'ASC' : 'DESC';
  return `${col} ${direction}, ce.id DESC`;
}

// True when a non-empty from/to value failed to parse — lets callers
// distinguish "no filter requested" from "filter requested but ignored",
// so a garbage date narrows nothing without at least a log/UI signal.
export interface WhereResult {
  where: string;
  params: (string | number)[];
  droppedFrom: boolean;
  droppedTo: boolean;
}

function buildWhere(f: EventFilters): WhereResult {
  const clauses: string[] = [];
  const params: (string | number)[] = [];
  let droppedFrom = false;
  let droppedTo = false;
  if (f.level) { clauses.push('ce.level = ?'); params.push(f.level); }
  if (f.kind) { clauses.push('ce.kind = ?'); params.push(f.kind); }
  if (f.userId) { clauses.push('ce.user_id = ?'); params.push(f.userId); }
  if (f.deviceId) { clauses.push('ce.device_id = ?'); params.push(f.deviceId); }
  if (f.from) {
    const utc = azLocalToUtcIso(f.from);
    if (utc) { clauses.push('datetime(ce.received_at) >= datetime(?)'); params.push(utc); }
    else droppedFrom = true;
  }
  if (f.to) {
    const utc = azLocalToUtcIso(f.to);
    if (utc) { clauses.push('datetime(ce.received_at) < datetime(?)'); params.push(utc); }
    else droppedTo = true;
  }
  if (droppedFrom || droppedTo) {
    // Log-before-widen: a filter that silently vanishes must leave a trace —
    // the admin is about to see MORE data than they asked for, unknowingly.
    console.warn('admin filter dropped: unparseable date', { from: f.from, to: f.to, droppedFrom, droppedTo });
  }
  return { where: clauses.length ? `WHERE ${clauses.join(' AND ')}` : '', params, droppedFrom, droppedTo };
}

export async function countErrorsLast24h(db: D1Database): Promise<number> {
  // No join needed — this is a bare count, not a row read.
  const row = await db.prepare(
    `SELECT COUNT(*) AS n FROM client_events
     WHERE level = 'error' AND datetime(received_at) >= datetime('now', '-1 day')`
  ).first<{ n: number }>();
  return row?.n ?? 0;
}

export async function listEvents(
  db: D1Database, filters: EventFilters, page: number
): Promise<{ rows: ClientEventRow[]; hasNext: boolean; droppedFrom: boolean; droppedTo: boolean }> {
  const { where, params, droppedFrom, droppedTo } = buildWhere(filters);
  const offset = (Math.max(1, page) - 1) * PAGE_SIZE;
  const orderBy = resolveOrderBy(filters.sort, filters.dir);
  // PAGE_SIZE+1 rows: the extra row only signals a next page, it isn't shown.
  const res = await db.prepare(
    `SELECT ${BOUNDED_PROJECTION} FROM ${FROM_JOIN} ${where}
     ORDER BY ${orderBy} LIMIT ? OFFSET ?`
  ).bind(...params, PAGE_SIZE + 1, offset).all<ClientEventRow>();
  const rows = res.results ?? [];
  return { rows: rows.slice(0, PAGE_SIZE), hasNext: rows.length > PAGE_SIZE, droppedFrom, droppedTo };
}

export async function getEvent(db: D1Database, id: string): Promise<ClientEventRow | null> {
  return await db.prepare(
    `SELECT ${BOUNDED_PROJECTION} FROM ${FROM_JOIN} WHERE ce.id = ?`
  ).bind(id).first<ClientEventRow>();
}

// Preceding 20 same-session events (breadcrumbs), chronological. seq is the
// intra-session ordering fact (README's data contract) but it is nullable and
// client-supplied, so the tuple is (normalized ts, seq, id) with id as the
// deterministic final tie-breaker. Returned oldest-first for display. Always
// chronological — not user-sortable, unlike the main events table.
export async function getBreadcrumbs(
  db: D1Database, sessionId: string, anchor: ClientEventRow
): Promise<ClientEventRow[]> {
  const anchorTs = anchor.occurred_at ?? anchor.received_at;
  const res = await db.prepare(
    `SELECT ${BOUNDED_PROJECTION} FROM ${FROM_JOIN}
     WHERE ce.session_id = ?
       AND (COALESCE(datetime(ce.occurred_at), datetime(ce.received_at)), COALESCE(ce.seq, -1), ce.id)
           < (COALESCE(datetime(?), datetime(?)), COALESCE(?, -1), ?)
     ORDER BY COALESCE(datetime(ce.occurred_at), datetime(ce.received_at)) DESC, COALESCE(ce.seq, -1) DESC, ce.id DESC
     LIMIT 20`
  ).bind(sessionId, anchorTs, anchor.received_at, anchor.seq, anchor.id).all<ClientEventRow>();
  return (res.results ?? []).reverse();
}

export async function exportEvents(
  db: D1Database, filters: EventFilters
): Promise<{ rows: ClientEventRow[]; truncated: boolean }> {
  const { where, params } = buildWhere(filters);
  const orderBy = resolveOrderBy(filters.sort, filters.dir);
  // CAP+1 so exactly-at-cap and truncated are distinguishable; 2000 bounded
  // rows stay well inside the 128 MB isolate for a buffered CSV.
  const res = await db.prepare(
    `SELECT ${BOUNDED_PROJECTION} FROM ${FROM_JOIN} ${where}
     ORDER BY ${orderBy} LIMIT ?`
  ).bind(...params, EXPORT_CAP + 1).all<ClientEventRow>();
  const rows = res.results ?? [];
  return { rows: rows.slice(0, EXPORT_CAP), truncated: rows.length > EXPORT_CAP };
}
