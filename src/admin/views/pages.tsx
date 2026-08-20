import { Layout } from './layout';
import { EVENT_COLUMNS, PAGE_SIZE, type ClientEventRow, type EventFilters } from '../db';

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

function cell(row: ClientEventRow, col: (typeof EVENT_COLUMNS)[number]) {
  const v = row[col];
  const s = v === null || v === undefined ? '' : String(v);
  return (
    <td class={col === 'message' || col === 'stack' || col === 'extra' ? 'truncate' : undefined}>
      <a href={`/events/${encodeURIComponent(row.id)}`}>{s || ' '}</a>
    </td>
  );
}

export function EventsPage(props: {
  user: string; rows: ClientEventRow[]; hasNext: boolean; page: number; filters: EventFilters; query: string;
}) {
  const f = props.filters;
  const pageQuery = (p: number) => {
    const q = new URLSearchParams(props.query);
    q.set('page', String(p));
    return `/events?${q.toString()}`;
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
        <label>From (ISO)<input name="from" value={f.from ?? ''} placeholder="2026-08-19T00:00" /></label>
        <label>To (ISO)<input name="to" value={f.to ?? ''} /></label>
        <button type="submit">Filter</button>
        <a class="btn" href={`/events.csv?${props.query}`}>Export CSV</a>
      </form>
      <p class="muted">Newest first. {props.rows.length} row(s) on this page.</p>
      <table>
        <thead><tr>{EVENT_COLUMNS.map(colName => <th>{colName}</th>)}</tr></thead>
        <tbody>
          {props.rows.map(row => <tr>{EVENT_COLUMNS.map(colName => cell(row, colName))}</tr>)}
        </tbody>
      </table>
      <div class="pager">
        {props.page > 1 ? <a href={pageQuery(props.page - 1)}>&larr; Newer</a> : null}
        {props.hasNext ? <a href={pageQuery(props.page + 1)}>Older ({PAGE_SIZE} more) &rarr;</a> : null}
      </div>
    </Layout>
  );
}

export function EventDetailPage(props: { user: string; event: ClientEventRow; breadcrumbs: ClientEventRow[] }) {
  const e = props.event;
  let extraPretty = e.extra ?? '';
  try { if (e.extra) extraPretty = JSON.stringify(JSON.parse(e.extra), null, 2); } catch { /* show raw */ }
  return (
    <Layout title={`Event ${e.id.slice(0, 8)}…`} user={props.user}>
      <h1>Event <code>{e.id}</code></h1>
      <table>
        <tbody>
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
