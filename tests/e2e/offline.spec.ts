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
  // Wait for the verify VIEW before filling: filling 'the first textbox'
  // during the register→verify transition could land the code in the
  // register form's name field, leaving Verify disabled forever.
  await page.getByText(/Enter code|Ingresar código/).waitFor();
  await page.getByRole('textbox', { name: /6-digit code|Código/ }).fill(code);
  await page.getByRole('button', { name: /Verify|Verificar/i }).click();
  await page.getByRole('button', { name: /Enter Data|Ingresar/i }).first().click();

  // ── Go OFFLINE before anything is entered ──
  await context.setOffline(true);

  const familyName = `E2E Offline Family ${Date.now().toString().slice(-6)}`;
  await page.getByRole('textbox').first().fill(familyName);
  await page.getByRole('button', { name: /Search \/ Buscar/ }).click();

  // Search fails on the dead network. With an EMPTY cache the offline
  // continue button appears; with earlier runs' E2E families in the cached
  // roster, the offline results screen appears instead — take its
  // register-as-new. Both are correct offline entries into the wizard.
  const offlineContinue = page.getByRole('button', { name: /continue and register as new/i });
  const cachedRegisterNew = page.getByRole('button', { name: /Register as new|Registrar como nuevo/i });
  await offlineContinue.or(cachedRegisterNew).first().waitFor();
  if (await cachedRegisterNew.isVisible()) await cachedRegisterNew.click();
  else await offlineContinue.click();
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

test('a RETURNING household checked in offline resolves to its existing record — no duplicate family', async ({ page, context }) => {
  const phone = `482${String(Date.now() % 10_000_000).padStart(7, '0')}`;
  await page.goto('/');

  // ── Register + sign in (online) ──
  await page.getByRole('link', { name: /Create account|Crear cuenta/i })
    .or(page.getByRole('button', { name: /Create account|Crear cuenta/i })).first().click();
  await page.getByRole('textbox', { name: /Full name|Nombre completo/i }).fill('E2E Returning Volunteer');
  await page.getByRole('textbox', { name: /Phone|Teléfono/i }).fill(phone);
  await page.getByRole('button', { name: /Create account|Crear cuenta/i }).click();
  const code = await otpFor(page, phone);
  // Wait for the verify VIEW before filling: filling 'the first textbox'
  // during the register→verify transition could land the code in the
  // register form's name field, leaving Verify disabled forever.
  await page.getByText(/Enter code|Ingresar código/).waitFor();
  await page.getByRole('textbox', { name: /6-digit code|Código/ }).fill(code);
  await page.getByRole('button', { name: /Verify|Verificar/i }).click();

  // ── First check-in ONLINE (creates the household) ──
  const familyName = `E2E Returning Family ${Date.now().toString().slice(-6)}`;
  await page.getByRole('button', { name: /Enter Data|Ingresar/i }).first().click();
  await page.getByRole('textbox').first().fill(familyName);
  await page.getByRole('button', { name: /Search \/ Buscar/ }).click();
  const registerNew = page.getByRole('button', { name: /Register as new|Registrar como nuevo/i });
  const howMany1 = page.getByRole('button', { name: /^1$/ });
  await registerNew.or(howMany1).first().waitFor();
  if (await registerNew.isVisible()) await registerNew.click();
  await howMany1.click();
  await page.getByRole('button', { name: /No designated|Sin persona/i }).click();
  await page.getByRole('button', { name: /Next \/ Siguiente/ }).click();
  await page.getByRole('button', { name: /Next \/ Siguiente|don't have|No tengo/i }).first().click();
  await page.getByRole('textbox').first().fill('85003');
  await page.getByRole('button', { name: /Next \/ Siguiente/ }).click();
  await page.getByRole('button', { name: /English/ }).first().click();
  await page.getByRole('button', { name: /^2$/ }).first().click();
  await page.getByRole('button', { name: /^0$/ }).first().click();
  await page.getByRole('button', { name: /^0$/ }).first().click();
  await page.getByRole('button', { name: /Prefer not to say|Prefiero no/i }).first().click();
  await page.getByRole('button', { name: /^No$/ }).first().click();
  await page.getByRole('button', { name: /^No$/ }).first().click();
  await page.getByRole('button', { name: /^No$/ }).first().click();
  await page.getByRole('button', { name: /^No$/ }).first().click();
  await expect(page.getByText(/Summary \/ Resumen/)).toBeVisible();
  // Finish the check-in like a real volunteer: back to the lookup.
  await page.getByRole('button', { name: /Next car/ }).click();

  // ── OUTAGE, SAME SESSION — no reload. The family created a moment ago
  //    must already be in the offline directory (create-time upsert); an
  //    earlier version only refreshed the cache at mount, which this test
  //    masked with a reload. ──
  await context.setOffline(true);
  await page.getByRole('textbox').first().fill(familyName);
  await page.getByRole('button', { name: /Search \/ Buscar/ }).click();

  // Served from the cached roster, NOT the register-as-new dead end.
  await expect(page.getByText(/last synced family list/)).toBeVisible();
  await page.getByRole('button', { name: new RegExp(familyName) }).click();
  // Family-select: toggle the household's card, then confirm.
  await page.getByRole('button', { name: /Their own family/ }).click();
  await page.getByRole('button', { name: /Confirm \/ Confirmar \(1\)/ }).click();
  await page.getByRole('button', { name: /No change \/ Sin cambios/ }).click();

  // Queued: the visit waits for the network.
  await expect(page.getByText(/pending sync/)).toBeVisible();

  // ── Reconnect and verify server-side ──
  await context.setOffline(false);
  await expect(page.getByText(/pending sync/)).not.toBeVisible({ timeout: 20_000 });

  const search = await apiGet(page, `/api/families/search?name=${encodeURIComponent(familyName)}`) as {
    results: { id: string; name: string }[];
  };
  const fams = search.results.filter(r => r.name === familyName);
  expect(fams, 'exactly ONE family — the offline visit resolved to the existing record').toHaveLength(1);

  const visits = await apiGet(page, `/api/visits?familyId=${fams[0].id}`) as { visits: { visit_date: string }[] };
  expect(visits.visits, 'the online check-in visit plus the offline queued visit').toHaveLength(2);
});
