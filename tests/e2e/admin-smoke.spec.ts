// Issue #13 admin console desktop smoke. Auth strategy: mint a valid
// admin_session locally (the session is a locally-signed HMAC cookie —
// signSession runs under Node's WebCrypto) instead of stubbing the issuer;
// the real OAuth round-trip is a manual first-deploy verification. Seeding
// goes through the RUNNING PWA server's public ingest endpoint, so this spec
// also exercises the real /api/client-events path end-to-end.
import { test, expect, request as playwrightRequest } from '@playwright/test';
import { signSession, SESSION_COOKIE } from '../../src/admin/session';

const E2E_SECRET = 'e2e-admin-secret'; // matches scripts/e2e-admin-server.mjs
const PWA_URL = 'http://127.0.0.1:8787';

// Fresh per-run: fixed ids would be repeat-unsafe (the 800/device rate cap
// charges before INSERT OR IGNORE against a KV that persists across runs,
// and re-ignored rows would keep a stale received_at).
const RUN = Date.now();
const SEED_DEVICE = `e2e-admin-seed-${RUN}`;
const SEED_SESSION = `e2e-admin-session-${RUN}`;
const ERROR_ID = `e2e-admin-err-${RUN}`;

test.beforeAll(async () => {
  // The test-scoped `request` fixture is not available in beforeAll — build
  // an API context explicitly.
  const api = await playwrightRequest.newContext({ baseURL: PWA_URL });
  const base = { session_id: SEED_SESSION, device_id: SEED_DEVICE, app_version: 'e2e-admin' };
  const t0 = RUN - 60_000;
  // A 25-event breadcrumb trail plus one error-level anchor.
  const trail = Array.from({ length: 25 }, (_, i) => ({
    ...base,
    id: `e2e-admin-crumb-${RUN}-${String(i).padStart(2, '0')}`,
    seq: i,
    level: 'info',
    kind: 'view_change',
    occurred_at: new Date(t0 + i * 1000).toISOString(),
    view_type: 'lookup',
  }));
  const anchor = {
    ...base,
    id: ERROR_ID,
    seq: 25,
    level: 'error',
    kind: 'js_error',
    occurred_at: new Date(t0 + 25_000).toISOString(),
    message: 'e2e seeded error',
  };
  for (const batch of [trail, [anchor]]) {
    const res = await api.post('/api/client-events', { data: batch });
    expect(res.ok()).toBeTruthy();
  }
  await api.dispose();
});

test('admin console: cookie-authed home count, filtered events, detail with breadcrumbs', async ({ page, context }) => {
  const cookie = await signSession('e2e@creightoncommunityfoundation.org', E2E_SECRET);
  await context.addCookies([{
    name: SESSION_COOKIE, value: cookie, url: 'http://127.0.0.1:8788',
  }]);

  // Home: at least our seeded error in the last 24h.
  await page.goto('/');
  const bignum = page.locator('.bignum');
  await expect(bignum).toBeVisible();
  expect(Number(await bignum.textContent())).toBeGreaterThanOrEqual(1);

  // Events filtered to the seed device: anchor visible.
  await page.goto(`/events?device_id=${encodeURIComponent(SEED_DEVICE)}&level=error`);
  await expect(page.locator(`a[href="/events/${ERROR_ID}"]`).first()).toBeVisible();

  // Row-click → detail with the 20 preceding breadcrumbs from this session.
  await page.locator(`a[href="/events/${ERROR_ID}"]`).first().click();
  await expect(page.getByText('e2e seeded error').first()).toBeVisible();
  await expect(page.getByText(`Breadcrumbs — preceding 20 event(s)`)).toBeVisible();
});

test('unauthenticated access redirects to the sign-in page', async ({ page }) => {
  await page.goto('/events');
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByText('Sign in with CCF Google')).toBeVisible();
});
