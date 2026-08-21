import { defineConfig } from 'vitest/config';
import { cloudflareTest } from '@cloudflare/vitest-pool-workers';

// Admin worker (foodbox-admin) test suite — mirrors vitest.config.ts but
// boots from wrangler.admin.jsonc. No SESSIONS KV / JWT_SECRET here on
// purpose: the admin worker must not be able to touch PWA sessions.
export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: './wrangler.admin.jsonc' },
      miniflare: {
        d1Databases: ['DB'],
        bindings: {
          FOODBOX_ADMIN_SESSION_SECRET: 'test-admin-secret',
          AUTH_DOMAIN: 'creightoncommunityfoundation.org',
          OPENAUTH_ISSUER: 'https://auth.example.invalid',
          OPENAUTH_CLIENT_ID: 'foodbox-admin',
          ENVIRONMENT: 'test',
        },
      },
    }),
  ],
  // Vitest 4 transforms with oxc, not esbuild (an esbuild block here is
  // silently ignored — the runner warns and falls back to tsconfig
  // discovery). Configure the transform actually in use.
  oxc: {
    jsx: { runtime: 'automatic', importSource: 'hono/jsx' },
  },
  test: {
    setupFiles: ['./tests/admin/setup.ts'],
    include: ['tests/admin/**/*.test.ts'],
  },
});
