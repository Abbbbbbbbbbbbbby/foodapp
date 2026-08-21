import { Layout } from './layout';
import { EVENT_COLUMNS, SORT_KEYS, PAGE_SIZE, type ClientEventRow, type EventFilters } from '../db';
import { utcToAzDisplay } from '../tz';

export function LoginPage() {
  return (
    <Layout title="Sign in">
      <h1>Sign in</h1>
      <p>This console is for CCF staff. Sign in with your CCF Google Workspace account.</p>
      <a class="btn" href="/auth/login">Sign in with CCF Google</a>
    </Layout>
  );
}

export function DeniedPage() {
  return (
    <Layout title="Not authorized">
      <h1 class="denied">Not authorized</h1>
      <p>
        This console requires a CCF Workspace sign-in. If you are an external
        collaborator, ask an admin to grant you access on the CCF auth issuer's
        allowlist (see the repo README's admin-console section).
      </p>
      <a class="btn" href="/login">Back to sign-in</a>
    </Layout>
  );
}

export function HomePage(props: { user: string; errorCount: number; from: string }) {
  return (
    <Layout title="Home" user={props.user}>
      <h1>Errors in the last 24 hours</h1>
      <div class="bignum">{props.errorCount}</div>
      <a class="btn" href={`/events?level=error&from=${encodeURIComponent(props.from)}`}>
        View them
      </a>
    </Layout>
  );
}

const LEVELS = ['', 'error', 'warn', 'info'];
const KINDS = ['', 'js_error', 'unhandled_rejection', 'react_boundary', 'view_change', 'wizard_step',
  'draft_restored', 'draft_discarded', 'sw_update', 'visibility', 'api_failure'];

// Default-visible tier (DESIGN.md): human triage signal. Everything else in
// EVENT_COLUMNS is available via the "Show all columns" toggle but never
// dropped from the export — the toggle is display-only.
const DEFAULT_COLUMNS: readonly (typeof EVENT_COLUMNS)[number][] = [
  'received_at', 'level', 'kind', 'route', 'wizard_step', 'view_type', 'message',
];

// Timestamp columns render in AZ local on the table (a human scanning the
// list wants local time); the event-detail page keeps UTC for precision.
const AZ_DISPLAY_COLUMNS = new Set(['received_at', 'occurred_at']);
// Raw ids/correlation strings get a monospace treatment when the "show all
// columns" toggle reveals them — they're copy-paste keys, not prose.
const MONOSPACE_COLUMNS = new Set(['id', 'session_id', 'device_id']);

function cellValue(row: ClientEventRow, col: (typeof EVENT_COLUMNS)[number]): string {
  if (AZ_DISPLAY_COLUMNS.has(col)) return utcToAzDisplay(row[col] as string | null);
  const v = row[col];
  return v === null || v === undefined ? '' : String(v);
}

function cell(row: ClientEventRow, col: (typeof EVENT_COLUMNS)[number]) {
  const s = cellValue(row, col);
  const classes = [
    col === 'message' || col === 'stack' || col === 'extra' ? 'truncate' : null,
    MONOSPACE_COLUMNS.has(col) ? 'mono' : null,
  ].filter(Boolean).join(' ') || undefined;
  return (
    <td class={classes}>
      <a href={`/events/${encodeURIComponent(row.id)}`}>{s || ' '}</a>
    </td>
  );
}

// Volunteer identity is TWO facts (name, phone), not one — kept as two cells
// so each is independently scannable/sortable, matching how the CSV export
// already keeps them as two columns (field-data: one fact per cell).
//
// A null user_id and a joined-but-missing user row are DIFFERENT states: the
// first is a genuinely anonymous/crashed session, the second is an orphaned
// reference (the user row was deleted after the event was recorded). Users
// carrying a real user_id must never render as "not signed in" — that would
// be a confident false statement about the one thing this column exists to answer.
function volunteerCells(row: ClientEventRow) {
  const href = `/events/${encodeURIComponent(row.id)}`;
  if (!row.user_id) {
    return (
      <>
        <td><a href={href} class="muted">not signed in</a></td>
        <td><a href={href} class="muted">—</a></td>
      </>
    );
  }
  if (!row.volunteer_name && !row.volunteer_phone) {
    return (
      <>
        <td><a href={href} class="muted">unknown volunteer</a></td>
        <td><a href={href} class="mono muted">{row.user_id}</a></td>
      </>
    );
  }
  return (
    <>
      <td><a href={href}>{row.volunteer_name || <span class="muted">—</span>}</a></td>
      <td class="mono"><a href={href}>{row.volunteer_phone || <span class="muted">—</span>}</a></td>
    </>
  );
}

// Sortable header: wraps the label in a link toggling sort/dir via the query
// string (server round-trip, matching the existing pager-link pattern — no
// client JS). Shows a text arrow on the active column; never color alone.
// Always resets to page 1 on a sort change — a stale page number sorted a
// different way frequently lands past the end of the new result order.
function sortableHeader(key: string, label: string, query: string, filters: EventFilters) {
  const active = (filters.sort ?? 'received_at') === key;
  const nextDir = active && filters.dir !== 'asc' ? 'asc' : 'desc';
  const q = new URLSearchParams(query);
  q.set('sort', key);
  q.set('dir', nextDir);
  q.delete('page');
  const arrow = active ? (filters.dir === 'asc' ? ' ▲' : ' ▼') : '';
  return (
    <th><a href={`/events?${q.toString()}`}>{label}{arrow}</a></th>
  );
}

const SORT_LABELS: Record<string, string> = {
  received_at: 'received_at', level: 'level', kind: 'kind',
  wizard_step: 'wizard_step', volunteer: 'Volunteer',
};

export function EventsPage(props: {
  user: string; rows: ClientEventRow[]; hasNext: boolean; page: number;
  filters: EventFilters; query: string; showAll: boolean;
  droppedFrom: boolean; droppedTo: boolean;
}) {
  const f = props.filters;
  const columns = props.showAll ? EVENT_COLUMNS : DEFAULT_COLUMNS;
  const activeSort = f.sort ?? 'received_at';
  const isTimeSort = activeSort === 'received_at';
  const pageQuery = (p: number) => {
    const q = new URLSearchParams(props.query);
    q.set('page', String(p));
    return `/events?${q.toString()}`;
  };
  const toggleColumnsQuery = () => {
    const q = new URLSearchParams(props.query);
    q.set('all', props.showAll ? '0' : '1');
    return `/events?${q.toString()}`;
  };
  // The export always covers the full filtered result (up to EXPORT_CAP),
  // never just the current page — strip a stale page number from the link
  // so it can't be misread as "exports page N".
  const exportQuery = () => {
    const q = new URLSearchParams(props.query);
    q.delete('page');
    return `/events.csv?${q.toString()}`;
  };
  return (
    <Layout title="Client events" user={props.user}>
      <h1>Client events</h1>
      <form class="filters" method="get" action="/events">
        <label>Level
          <select name="level">{LEVELS.map(l => <option value={l} selected={f.level === l}>{l || 'any'}</option>)}</select>
        </label>
        <label>Kind
          <select name="kind">{KINDS.map(k => <option value={k} selected={f.kind === k}>{k || 'any'}</option>)}</select>
        </label>
        <label>User id<input name="user_id" value={f.userId ?? ''} /></label>
        <label>Device id<input name="device_id" value={f.deviceId ?? ''} /></label>
        <label>From (Arizona time)<input type="datetime-local" name="from" value={f.from ?? ''} /></label>
        <label>To (Arizona time)<input type="datetime-local" name="to" value={f.to ?? ''} /></label>
        <button type="submit">Filter</button>
        <a class="btn" href={exportQuery()}>Export CSV</a>
      </form>
      {props.droppedFrom || props.droppedTo ? (
        <p class="warning">
          {props.droppedFrom && props.droppedTo
            ? 'The From and To dates could not be read and were ignored — showing unfiltered results on both ends.'
            : props.droppedFrom
              ? 'The From date could not be read and was ignored — showing results with no lower bound.'
              : 'The To date could not be read and was ignored — showing results with no upper bound.'}
        </p>
      ) : null}
      <p class="muted">
        {isTimeSort ? 'Newest first.' : `Sorted by ${SORT_LABELS[activeSort] ?? activeSort} (${f.dir === 'asc' ? 'ascending' : 'descending'}).`}{' '}
        {props.rows.length} row(s) on this page.{' '}
        <a href={toggleColumnsQuery()}>{props.showAll ? 'Show fewer columns' : 'Show all columns'}</a>
      </p>
      {props.rows.length === 0 ? (
        <p class="empty">No events match these filters.</p>
      ) : (
        <table>
          <thead>
            <tr>
              {sortableHeader('volunteer', 'Volunteer', props.query, f)}
              <th>Phone</th>
              {columns.map(colName =>
                SORT_KEYS.includes(colName)
                  ? sortableHeader(colName, SORT_LABELS[colName] ?? colName, props.query, f)
                  : <th>{colName}</th>
              )}
            </tr>
          </thead>
          <tbody>
            {props.rows.map(row => (
              <tr>
                {volunteerCells(row)}
                {columns.map(colName => cell(row, colName))}
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div class="pager">
        {isTimeSort ? (
          <>
            {props.page > 1 ? <a href={pageQuery(props.page - 1)}>&larr; Newer</a> : null}
            {props.hasNext ? <a href={pageQuery(props.page + 1)}>Older ({PAGE_SIZE} more) &rarr;</a> : null}
          </>
        ) : (
          <>
            {props.page > 1 ? <a href={pageQuery(props.page - 1)}>&larr; Previous</a> : null}
            {props.hasNext ? <a href={pageQuery(props.page + 1)}>Next ({PAGE_SIZE} more) &rarr;</a> : null}
          </>
        )}
      </div>
    </Layout>
  );
}

export function EventDetailPage(props: { user: string; event: ClientEventRow; breadcrumbs: ClientEventRow[] }) {
  const e = props.event;
  let extraPretty = e.extra ?? '';
  try { if (e.extra) extraPretty = JSON.stringify(JSON.parse(e.extra), null, 2); } catch { /* show raw */ }
  const volunteerLabel = !e.user_id
    ? <span class="muted">not signed in</span>
    : !e.volunteer_name && !e.volunteer_phone
      ? <><span class="muted">unknown volunteer</span> <code>{e.user_id}</code></>
      : null;
  return (
    <Layout title={`Event ${e.id.slice(0, 8)}…`} user={props.user}>
      <h1>Event <code>{e.id}</code></h1>
      <table>
        <tbody>
          <tr><th>volunteer name</th><td>{volunteerLabel ?? (e.volunteer_name || <span class="muted">—</span>)}</td></tr>
          <tr><th>volunteer phone</th><td>{volunteerLabel ? '' : (e.volunteer_phone || <span class="muted">—</span>)}</td></tr>
          {EVENT_COLUMNS.filter(c => c !== 'message' && c !== 'stack' && c !== 'extra').map(colName => (
            <tr><th>{colName}</th><td>{String(e[colName] ?? '')}</td></tr>
          ))}
        </tbody>
      </table>
      <h2>message</h2>
      <pre>{e.message ?? '(none)'}</pre>
      <h2>stack</h2>
      <pre>{e.stack ?? '(none)'}</pre>
      <h2>extra</h2>
      <pre>{extraPretty || '(none)'}</pre>
      <h2>Breadcrumbs — preceding {props.breadcrumbs.length} event(s) in session <code>{e.session_id}</code></h2>
      <table>
        <thead><tr><th>occurred_at</th><th>seq</th><th>level</th><th>kind</th><th>route</th><th>wizard_step</th><th>view_type</th><th>message</th></tr></thead>
        <tbody>
          {props.breadcrumbs.map(b => (
            <tr>
              <td><a href={`/events/${encodeURIComponent(b.id)}`}>{b.occurred_at ?? b.received_at}</a></td>
              <td>{b.seq ?? ''}</td><td>{b.level}</td><td>{b.kind}</td>
              <td>{b.route ?? ''}</td><td>{b.wizard_step ?? ''}</td><td>{b.view_type ?? ''}</td>
              <td class="truncate">{b.message ?? ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p class="muted">Anchor event is the one above; breadcrumbs are the ≤20 events before it, oldest first.</p>
    </Layout>
  );
}
