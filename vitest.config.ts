import { defineConfig } from 'vitest/config';
import { cloudflareTest } from '@cloudflare/vitest-pool-workers';

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: './wrangler.jsonc' },
      miniflare: {
        d1Databases: ['DB'],
        kvNamespaces: ['SESSIONS'],
        bindings: {
          JWT_SECRET: 'test-secret-do-not-use-in-production-aabbccdd',
          TWILIO_ACCOUNT_SID: 'test',
          TWILIO_AUTH_TOKEN: 'test',
          TWILIO_PHONE_NUMBER: '0000000000',
          ENVIRONMENT: 'test',
        },
      },
    }),
  ],
  test: {
    setupFiles: ['./tests/worker/setup.ts'],
    include: ['tests/worker/**/*.test.ts'],
  },
});
