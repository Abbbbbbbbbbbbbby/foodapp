import { test, expect, type Page } from '@playwright/test';

// The core-feature journey: queue a family + visit + bag while OFFLINE,
// reconnect, wait for the background sync, and verify the records landed
// server-side. This is the path the whole offline queue exists for.

const PHONE = `481${String(Date.now() % 10_000_000).padStart(7, '0')}`;

async function otpFor(page: Page, phone: string): Promise<string> {
  const res = await page.request.get(`/api/test/latest-otp/${phone}`);
  expect(res.ok()).toBeTruthy();
  return (await res.json()).code;
}

// Authenticated API read using the token the app stored at login — lets the
// test verify SERVER-side state, not just what the UI claims.
async function apiGet(page: Page, path: string): Promise<unknown> {
  const token = await page.evaluate(() => {
    const raw = localStorage.getItem('foodapp_auth');
    return raw ? (JSON.parse(raw) as { token: string }).token : null;
  });
  expect(token).toBeTruthy();
  const res = await page.request.get(path, { headers: { Authorization: `Bearer ${token}` } });
  expect(res.ok()).toBeTruthy();
  return res.json();
}

test('offline check-in queues family, visit, and bag; reconnect syncs them to the server', async ({ page, context }) => {
  await page.goto('/');

  // ── Register + sign in (online) ──
  await page.getByRole('link', { name: /Create account|Crear cuenta/i })
    .or(page.getByRole('button', { name: /Create account|Crear cuenta/i })).first().click();
  await page.getByRole('textbox', { name: /Full name|Nombre completo/i }).fill('E2E Offline Volunteer');
  await page.getByRole('textbox', { name: /Phone|Teléfono/i }).fill(PHONE);
  await page.getByRole('button', { name: /Create account|Crear cuenta/i }).click();
  const code = await otpFor(page, PHONE);
  await page.getByRole('textbox').first().fill(code);
  await page.getByRole('button', { name: /Verify|Verificar|Sign in|Entrar/i }).first().click();
  await page.getByRole('button', { name: /Enter Data|Ingresar/i }).first().click();

  // ── Go OFFLINE before anything is entered ──
  await context.setOffline(true);

  const familyName = `E2E Offline Family ${Date.now().toString().slice(-6)}`;
  await page.getByRole('textbox').first().fill(familyName);
  await page.getByRole('button', { name: /Search \/ Buscar/ }).click();

  // Search fails on the dead network; the offline continue path opens the wizard.
  await page.getByRole('button', { name: /continue and register as new/i }).click();
  await page.getByRole('button', { name: /^1$/ }).click();
  await page.getByRole('button', { name: /No designated|Sin persona/i }).click();

  // ── Wizard (all steps, same journey as the online smoke) ──
  await page.getByRole('button', { name: /Next \/ Siguiente/ }).click();
  await page.getByRole('button', { name: /Next \/ Siguiente|don't have|No tengo/i }).first().click();
  await page.getByRole('textbox').first().fill('85002');
  await page.getByRole('button', { name: /Next \/ Siguiente/ }).click();
  await page.getByRole('button', { name: /English/ }).first().click();
  await page.getByRole('button', { name: /^3$/ }).first().click();
  await page.getByRole('button', { name: /^0$/ }).first().click();
  await page.getByRole('button', { name: /^0$/ }).first().click();
  await page.getByRole('button', { name: /Prefer not to say|Prefiero no/i }).first().click();
  await page.getByRole('button', { name: /^No$/ }).first().click();
  await page.getByRole('button', { name: /^No$/ }).first().click();
  await page.getByRole('button', { name: /^No$/ }).first().click();
  await page.getByRole('button', { name: /^No$/ }).first().click();

  // ── Summary: mark the bag while STILL offline ──
  await expect(page.getByText(/Summary \/ Resumen/)).toBeVisible();
  await page.getByRole('checkbox').first().check();
  await page.getByRole('button', { name: /Save bags/ }).click();
  await expect(page.getByText(/Recorded \/ Registradas/)).toBeVisible();

  // Queued locally: the pending badge is the volunteer's signal.
  await expect(page.getByText(/pending sync/)).toBeVisible();

  // ── Reconnect: Layout's 'online' listener flushes the queue ──
  await context.setOffline(false);
  // The badge clears only after family + visit + bag all replayed.
  await expect(page.getByText(/pending sync/)).not.toBeVisible({ timeout: 20_000 });
  // No failure banners: nothing dead-lettered, sync healthy.
  await expect(page.getByText(/could not be saved/)).not.toBeVisible();
  await expect(page.getByText(/Offline sync is unavailable/)).not.toBeVisible();

  // ── Verify SERVER-side records, not UI claims ──
  const search = await apiGet(page, `/api/families/search?name=${encodeURIComponent(familyName)}`) as {
    results: { id: string; name: string; num_people: number | null; last_visit_date: string | null }[];
  };
  const fam = search.results.find(r => r.name === familyName);
  expect(fam, 'family row exists on the server after sync').toBeTruthy();
  expect(fam!.num_people).toBe(3);
  expect(fam!.last_visit_date, 'visit synced with the family').toBeTruthy();

  const visits = await apiGet(page, `/api/visits?familyId=${fam!.id}`) as {
    visits: { visit_date: string; bag_received: boolean }[];
  };
  expect(visits.visits).toHaveLength(1);
  // Declared contract: strict boolean true — 0/1 leakage or a lost offline
  // bag flag both fail here.
  expect(visits.visits[0].bag_received).toBe(true);
});
