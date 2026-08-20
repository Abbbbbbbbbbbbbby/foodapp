import { test, expect, type Page, type TestInfo } from '@playwright/test';

// Issue #12: reproduces Rachel's 2026-08-19 scenario — a volunteer hangs or
// reloads mid-wizard at "how many children under 18" (displayed step 6) and
// the entry must be recoverable, not lost. Draft writes on a step transition
// are synchronous (no debounce — see draft.ts), but the IndexedDB commit
// itself is still async, so this test polls for the commit rather than
// assuming a fixed delay is enough.
//
// Two numberings coexist here, matching Wizard.tsx / draft.ts / telemetry:
// the persisted draft's wizard.step is INTERNAL 0-based; anything "displayed"
// (on-screen "Step N of 11", the resume-prompt copy, __throwAtWizardStep,
// the client_events wizard_step column) is 1-based.

const PHONE = `480${String((Date.now() + 1) % 10_000_000).padStart(7, '0')}`;

async function otpFor(page: Page, phone: string): Promise<string> {
  const res = await page.request.get(`/api/test/latest-otp/${phone}`);
  expect(res.ok()).toBeTruthy();
  return (await res.json()).code;
}

async function readAuthUserId(page: Page): Promise<string> {
  return page.evaluate(() => {
    const raw = localStorage.getItem('foodapp_auth');
    return raw ? (JSON.parse(raw).user?.id as string) : '';
  });
}

async function readDeviceId(page: Page): Promise<string> {
  return page.evaluate(() => localStorage.getItem('foodapp_device_id') ?? '');
}

async function readDraftWizardStep(page: Page, userId: string): Promise<number | undefined> {
  return page.evaluate((uid) => new Promise<number | undefined>((resolve) => {
    const req = indexedDB.open('foodapp_offline');
    req.onsuccess = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('drafts')) { resolve(undefined); return; }
      const tx = db.transaction('drafts', 'readonly');
      const getReq = tx.objectStore('drafts').get(uid);
      getReq.onsuccess = () => resolve((getReq.result as { wizard?: { step: number } } | undefined)?.wizard?.step);
      getReq.onerror = () => resolve(undefined);
    };
    req.onerror = () => resolve(undefined);
  }), userId);
}

async function testEvents(page: Page, deviceId: string, kind: string): Promise<unknown[]> {
  const res = await page.request.get(`/api/test/client-events?device_id=${encodeURIComponent(deviceId)}&kind=${kind}`);
  expect(res.ok()).toBeTruthy();
  return (await res.json()).events;
}

test('reload at wizard step 6 offers to resume, and Resume restores the entry with data intact', async ({ page }, testInfo: TestInfo) => {
  await page.goto('/');

  // ── Register + OTP verify ──
  await page.getByRole('link', { name: /Create account|Crear cuenta/i })
    .or(page.getByRole('button', { name: /Create account|Crear cuenta/i })).first().click();
  await page.getByRole('textbox', { name: /Full name|Nombre completo/i }).fill('E2E Draft Volunteer');
  await page.getByRole('textbox', { name: /Phone|Teléfono/i }).fill(PHONE);
  await page.getByRole('button', { name: /Create account|Crear cuenta/i }).click();
  const code = await otpFor(page, PHONE);
  await page.getByText(/Enter code|Ingresar código/).waitFor();
  await page.getByRole('textbox', { name: /6-digit code|Código/ }).fill(code);
  await page.getByRole('button', { name: /Verify|Verificar/i }).click();

  // Wait for the post-verify redirect to land (setAuth() has run by then)
  // before reading localStorage.
  const enterDataBtn = page.getByRole('button', { name: /Enter Data|Ingresar/i }).first();
  await enterDataBtn.waitFor();
  const userId = await readAuthUserId(page);
  const deviceId = await readDeviceId(page);
  expect(userId).toBeTruthy();
  expect(deviceId).toBeTruthy();

  // ── Home → Enter Data → new family → walk to displayed step 6 ──
  await enterDataBtn.click();
  const stamp = Date.now().toString().slice(-6);
  const familyName = `E2E Draft Family ${stamp}`;
  await page.getByRole('textbox').first().fill(familyName);
  await page.getByRole('button', { name: /Search \/ Buscar/ }).click();

  const registerNew = page.getByRole('button', { name: /Register as new|Registrar como nuevo/i });
  const howMany1 = page.getByRole('button', { name: /^1$/ });
  await registerNew.or(howMany1).first().waitFor();
  if (await registerNew.isVisible()) await registerNew.click();
  await howMany1.click();
  await page.getByRole('button', { name: /No designated|Sin persona/i }).click();

  await page.getByRole('button', { name: /Next \/ Siguiente/ }).click();          // 1 name (prefilled)
  await page.getByRole('button', { name: /Next \/ Siguiente|don't have|No tengo/i }).first().click(); // 2 phone
  await page.getByRole('textbox').first().fill('85001');                           // 3 zip
  await page.getByRole('button', { name: /Next \/ Siguiente/ }).click();
  await page.getByRole('button', { name: /English/ }).first().click();             // 4 language
  await page.getByRole('button', { name: /^2$/ }).first().click();                 // 5 household
  await expect(page.getByText(/Step 6 of 11/)).toBeVisible();                      // 6 children <18 — Rachel's step

  // Wait for the step-6 draft commit before reloading: the write is
  // synchronous (no debounce) but the IndexedDB transaction still resolves
  // asynchronously.
  await expect.poll(() => readDraftWizardStep(page, userId)).toBe(5); // internal 0-based for displayed step 6

  await page.reload();

  // ── Resume prompt ──
  await expect(page.getByText(/Resume the entry for/)).toBeVisible();
  await expect(page.getByText(/step 6 of 11/i)).toBeVisible();
  await page.getByRole('button', { name: /^Resume/i }).click();

  await expect(page.getByText(/Step 6 of 11/)).toBeVisible();

  // ── Data intact: walk back to step 1 and confirm the name survived ──
  for (let i = 0; i < 5; i++) {
    await page.getByRole('button', { name: /Back|Atrás/i }).first().click();
  }
  await expect(page.getByText(/Step 1 of 11/)).toBeVisible();
  await expect(page.getByRole('textbox').first()).toHaveValue(familyName);

  // ── client_events: the reload is visible with session/device/step ──
  // info-level events (draft_restored included) aren't flushed immediately
  // — only the 10s periodic timer or a pagehide/unload delivers them — so
  // this polls rather than asserting on the first read.
  await expect.poll(
    async () => (await testEvents(page, deviceId, 'draft_restored')).length,
    { timeout: 15_000 }
  ).toBeGreaterThan(0);

  // Best-effort wait (not asserted on its own — see the webkit soft-gate
  // below): the pagehide beacon should have landed during the reload, but
  // give it a moment before deciding it's genuinely absent.
  let visibilityCount = 0;
  // Observed one flake at 10x500ms=5s under CI-adjacent load — this is
  // testing an async unload-time delivery mechanism (pagehide → beacon →
  // worker → D1) with inherent timing variance, so give it real margin
  // rather than chase a tighter number.
  for (let i = 0; i < 20 && visibilityCount === 0; i++) {
    visibilityCount = (await testEvents(page, deviceId, 'visibility')).length;
    if (visibilityCount === 0) await page.waitForTimeout(500);
  }
  if (testInfo.project.name === 'webkit' && visibilityCount === 0) {
    // WebKit's pagehide/sendBeacon delivery at unload is a known weak spot
    // (see telemetry.ts) — soft-gate here, hard-gate on chromium.
    console.warn('[draft-resume e2e] no visibility row observed on WebKit — beacon delivery gap, not asserting');
  } else {
    expect(visibilityCount).toBeGreaterThan(0);
  }
});
