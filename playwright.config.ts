import { defineConfig } from '@playwright/test';

// E2E smoke against the REAL app on a local wrangler dev server: real worker,
// real (local) D1, real service worker — the layer unit tests can't reach.
// Run: npm run test:e2e   (builds, migrates the local DB, boots wrangler dev)
export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 60_000,
  retries: 1,
  use: {
    baseURL: 'http://127.0.0.1:8787',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'npm run e2e:server',
    url: 'http://127.0.0.1:8787/api/health',
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
