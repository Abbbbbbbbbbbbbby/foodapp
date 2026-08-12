import { test, expect, type Page } from '@playwright/test';

// Full volunteer journey against the real stack: register → OTP login →
// check in a new family through all 11 wizard steps → mark a bag → next car.
// The OTP is read back through the ENVIRONMENT=test-only endpoint.

// Unique per run: with reuseExistingServer the local D1 persists across
// runs, and re-registering a fixed phone issues no fresh OTP.
const PHONE = `480${String(Date.now() % 10_000_000).padStart(7, '0')}`;

async function otpFor(page: Page, phone: string): Promise<string> {
  const res = await page.request.get(`/api/test/latest-otp/${phone}`);
  expect(res.ok()).toBeTruthy();
  return (await res.json()).code;
}

test('register, check in a new family, and record a bag', async ({ page }) => {
  await page.goto('/');

  // ── Register + OTP verify ──
  await page.getByRole('link', { name: /Create account|Crear cuenta/i })
    .or(page.getByRole('button', { name: /Create account|Crear cuenta/i })).first().click();
  await page.getByRole('textbox', { name: /Full name|Nombre completo/i }).fill('E2E Volunteer');
  await page.getByRole('textbox', { name: /Phone|Teléfono/i }).fill(PHONE);
  await page.getByRole('button', { name: /Create account|Crear cuenta/i }).click();

  const code = await otpFor(page, PHONE);
  await page.getByRole('textbox').first().fill(code);
  await page.getByRole('button', { name: /Verify|Verificar|Sign in|Entrar/i }).first().click();

  // ── Home → Enter Data ──
  await page.getByRole('button', { name: /Enter Data|Ingresar/i }).first().click();

  // ── Lookup: no match → new family path ──
  const stamp = Date.now().toString().slice(-6);
  const familyName = `E2E Family ${stamp}`;
  await page.getByRole('textbox').first().fill(familyName);
  await page.getByRole('button', { name: /Search \/ Buscar/ }).click();

  // Fresh DB (CI): no results → straight to the how-many step. Reused local
  // DB: earlier runs' E2E families fuzzy-match, so take the results screen's
  // "Register as new" escape hatch first.
  const registerNew = page.getByRole('button', { name: /Register as new|Registrar como nuevo/i });
  const howMany1 = page.getByRole('button', { name: /^1$/ });
  await registerNew.or(howMany1).first().waitFor();
  if (await registerNew.isVisible()) await registerNew.click();

  // How many families → 1
  await howMany1.click();
  // Proxy question → no designated person
  await page.getByRole('button', { name: /No designated|Sin persona/i }).click();

  // ── Wizard: 11 steps ──
  await page.getByRole('button', { name: /Next \/ Siguiente/ }).click();          // 1 name (prefilled)
  await page.getByRole('button', { name: /Next \/ Siguiente|don't have|No tengo/i }).first().click(); // 2 phone
  await page.getByRole('textbox').first().fill('85001');                           // 3 zip
  await page.getByRole('button', { name: /Next \/ Siguiente/ }).click();
  await page.getByRole('button', { name: /English/ }).first().click();             // 4 language
  await page.getByRole('button', { name: /^2$/ }).first().click();                 // 5 household
  await page.getByRole('button', { name: /^0$/ }).first().click();                 // 6 children <18
  await page.getByRole('button', { name: /^0$/ }).first().click();                 // 7 children <5
  await page.getByRole('button', { name: /Prefer not to say|Prefiero no/i }).first().click(); // 8 income
  await page.getByRole('button', { name: /^No$/ }).first().click();                // 9 SNAP
  await page.getByRole('button', { name: /^No$/ }).first().click();                // 10 insurance
  await page.getByRole('button', { name: /^No$/ }).first().click();                // 11a texts
  await page.getByRole('button', { name: /^No$/ }).first().click();                // 11b updates

  // ── Summary: bag question → picklist → save ──
  await expect(page.getByText(/Summary \/ Resumen/)).toBeVisible();
  await page.getByRole('checkbox').first().check();
  await expect(page.getByText(familyName)).toBeVisible();
  await page.getByRole('button', { name: /Save bags/ }).click();
  await expect(page.getByText(/Recorded \/ Registradas/)).toBeVisible();

  // ── Next car returns to lookup, and the family is now findable ──
  await page.getByRole('button', { name: /Next car/ }).click();
  await page.getByRole('textbox').first().fill(familyName);
  await page.getByRole('button', { name: /Search \/ Buscar/ }).click();
  await expect(page.getByText(familyName)).toBeVisible();
});
