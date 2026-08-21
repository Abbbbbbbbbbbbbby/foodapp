import { defineConfig } from '@playwright/test';

// E2E smoke against the REAL app on a local wrangler dev server: real worker,
// real (local) D1, real service worker — the layer unit tests can't reach.
// Run: npm run test:e2e   (builds, migrates the local DB, boots wrangler dev)
export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 60_000,
  retries: 1,
  // Serial: the specs share one server and one D1, and parallel OTP
  // registrations trip the global SMS rate cap.
  workers: 1,
  use: {
    baseURL: 'http://127.0.0.1:8787',
    trace: 'retain-on-failure',
  },
  // WebKit is the documented deployment target (iPad Safari); Chromium
  // catches regressions fast. Both projects run serially against the same
  // server/D1 (see `workers: 1` above).
  projects: [
    { name: 'chromium', use: { browserName: 'chromium' }, testIgnore: /admin-.*\.spec\.ts/ },
    { name: 'webkit', use: { browserName: 'webkit' }, testIgnore: /admin-.*\.spec\.ts/ },
    // Desktop-only admin console (foodbox-admin worker on :8788).
    {
      name: 'admin-chromium',
      use: { browserName: 'chromium', baseURL: 'http://127.0.0.1:8788' },
      testMatch: /admin-.*\.spec\.ts/,
    },
  ],
  webServer: [
    {
      command: 'npm run e2e:server',
      url: 'http://127.0.0.1:8787/api/health',
      // Never reuse in CI: a leftover server on :8787 would skip the build AND
      // the migrations, silently running the smoke against stale code.
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
    {
      // Waits for the PWA server (owner of migrations), then boots the admin
      // worker with the e2e session secret. Reuse is NEVER allowed here even
      // locally: a leftover `npm run admin:dev` runs with dev-secret, the
      // smoke mints cookies with e2e-admin-secret, and /healthz can't tell
      // the two apart.
      command: 'node scripts/e2e-admin-server.mjs',
      url: 'http://127.0.0.1:8788/healthz',
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
});
