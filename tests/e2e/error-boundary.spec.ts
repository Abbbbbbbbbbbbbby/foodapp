import { test, expect, type Page } from '@playwright/test';

// Issue #12: verifies the recovery path when the app actually crashes
// mid-wizard, using the shipped test hook (window.__throwAtWizardStep,
// 1-based displayed step — see Wizard.tsx). The hook is inert in normal use
// (requires setting a window property via devtools/console) and ships in
// the production bundle by design, to avoid a second build mode for e2e.

const PHONE = `480${String((Date.now() + 2) % 10_000_000).padStart(7, '0')}`;

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

test('a crash inside a wizard step shows the recovery banner (not a blank page) and resumes to the last committed step', async ({ page }) => {
  await page.goto('/');

  await page.getByRole('link', { name: /Create account|Crear cuenta/i })
    .or(page.getByRole('button', { name: /Create account|Crear cuenta/i })).first().click();
  await page.getByRole('textbox', { name: /Full name|Nombre completo/i }).fill('E2E Crash Volunteer');
  await page.getByRole('textbox', { name: /Phone|Teléfono/i }).fill(PHONE);
  await page.getByRole('button', { name: /Create account|Crear cuenta/i }).click();
  const code = await otpFor(page, PHONE);
  await page.getByText(/Enter code|Ingresar código/).waitFor();
  await page.getByRole('textbox', { name: /6-digit code|Código/ }).fill(code);
  await page.getByRole('button', { name: /Verify|Verificar/i }).click();

  const enterDataBtn = page.getByRole('button', { name: /Enter Data|Ingresar/i }).first();
  await enterDataBtn.waitFor();
  const userId = await readAuthUserId(page);
  const deviceId = await readDeviceId(page);

  await enterDataBtn.click();
  const stamp = Date.now().toString().slice(-6);
  const familyName = `E2E Crash Family ${stamp}`;
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
  await expect(page.getByText(/Step 5 of 11/)).toBeVisible();                      // 5 household

  // Wait for the step-5 draft commit before arming the throw.
  await expect.poll(() => readDraftWizardStep(page, userId)).toBe(4); // internal 0-based for displayed step 5

  await page.evaluate(() => { (window as { __throwAtWizardStep?: number }).__throwAtWizardStep = 6; }); // 1-based

  // Answering step 5 advances the wizard INTO step 6, whose render throws.
  await page.getByRole('button', { name: /^2$/ }).first().click();

  // ── Recovery: banner shown, page not blank, draft is still intact ──
  await expect(page.getByText(/Something went wrong/)).toBeVisible();
  await expect(page.getByText(/your check-in entry was saved/)).toBeVisible();
  const resumeBtn = page.getByRole('button', { name: /Resume entry|Continuar registro/i });
  await expect(resumeBtn).toBeVisible();

  // ── client_events: the crash is recorded with the step it crashed on ──
  const res = await page.request.get(`/api/test/client-events?device_id=${encodeURIComponent(deviceId)}&kind=react_boundary`);
  expect(res.ok()).toBeTruthy();
  const events = (await res.json()).events as { wizard_step: number }[];
  expect(events.some(e => e.wizard_step === 6)).toBe(true);

  // ── Recover: clear the hook, resume — lands back on the last committed
  // step (5), not the step that crashed (6). ──
  await page.evaluate(() => { delete (window as { __throwAtWizardStep?: number }).__throwAtWizardStep; });
  await resumeBtn.click();

  await expect(page.getByText(/Resume the entry for/)).toBeVisible();
  await page.getByRole('button', { name: /^Resume/i }).click();
  await expect(page.getByText(/Step 5 of 11/)).toBeVisible();
});
