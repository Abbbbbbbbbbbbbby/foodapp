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
  esbuild: {
    // Explicit JSX config for the pool's esbuild pass — do not rely on it
    // discovering src/admin/tsconfig.json (planned fallback made primary).
    jsx: 'automatic',
    jsxImportSource: 'hono/jsx',
  },
  test: {
    setupFiles: ['./tests/admin/setup.ts'],
    include: ['tests/admin/**/*.test.ts'],
  },
});
