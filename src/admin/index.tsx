import { Hono } from 'hono';
import type { AdminEnv } from './types';
import { realClient, startLogin, handleCallback, logout, requireAuth, type AuthClient } from './auth';
import { LoginPage, DeniedPage, HomePage, EventsPage, EventDetailPage } from './views/pages';
import { countErrorsLast24h, listEvents, getEvent, getBreadcrumbs, exportEvents, type EventFilters } from './db';
import { toCsv } from './csv';

type App = { Bindings: AdminEnv; Variables: { user: string } };

// clientFactory is injectable so worker tests drive the real callback with a
// fake exchange/verify; production uses the real OpenAuth client.
export function buildApp(clientFactory: (env: AdminEnv) => AuthClient = realClient) {
  const app = new Hono<App>();

  // Fail closed: without the session secret nothing can be signed or
  // verified, so serve 503 everywhere except the deploy probe. The first
  // manual deploy legitimately precedes the secret.
  app.use('*', async (c, next) => {
    if (!c.env.FOODBOX_ADMIN_SESSION_SECRET && c.req.path !== '/healthz') {
      return c.text('Service unavailable: session secret not configured', 503);
    }
    return next();
  });

  app.get('/healthz', (c) => c.text('ok'));
  app.get('/login', (c) => c.html(<LoginPage />));
  app.get('/denied', (c) => c.html(<DeniedPage />, 403));
  app.get('/auth/login', (c) => startLogin(c, clientFactory(c.env)));
  app.get('/auth/callback', (c) => handleCallback(c, clientFactory(c.env)));
  app.post('/logout', (c) => logout(c));

  app.use('*', requireAuth());

  app.get('/', async (c) => {
    const errorCount = await countErrorsLast24h(c.env.DB);
    const from = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    return c.html(<HomePage user={c.var.user} errorCount={errorCount} from={from} />);
  });

  const parseFilters = (c: { req: { query(k: string): string | undefined } }): EventFilters => ({
    level: c.req.query('level') || undefined,
    kind: c.req.query('kind') || undefined,
    userId: c.req.query('user_id') || undefined,
    deviceId: c.req.query('device_id') || undefined,
    from: c.req.query('from') || undefined,
    to: c.req.query('to') || undefined,
  });

  app.get('/events', async (c) => {
    const filters = parseFilters(c);
    const page = Math.max(1, Number(c.req.query('page')) || 1);
    const { rows, hasNext } = await listEvents(c.env.DB, filters, page);
    const query = new URL(c.req.url).searchParams.toString();
    return c.html(<EventsPage user={c.var.user} rows={rows} hasNext={hasNext} page={page} filters={filters} query={query} />);
  });

  // Registered before /events/:id so ".csv" never matches as an id.
  app.get('/events.csv', async (c) => {
    const filters = parseFilters(c);
    const { rows, truncated } = await exportEvents(c.env.DB, filters);
    // A truncated export must be visible in logs AND in the artifact itself.
    console.log('csv export', { rowCount: rows.length, truncated, filters });
    const stamp = new Date().toISOString().replace(/[-:]/g, '').slice(0, 15);
    return c.body(toCsv(rows, truncated), 200, {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="client-events-${stamp}.csv"`,
    });
  });

  app.get('/events/:id', async (c) => {
    const event = await getEvent(c.env.DB, c.req.param('id'));
    if (!event) return c.text('Event not found', 404);
    const breadcrumbs = await getBreadcrumbs(c.env.DB, event.session_id, event);
    return c.html(<EventDetailPage user={c.var.user} event={event} breadcrumbs={breadcrumbs} />);
  });

  return app;
}

export default buildApp();
