import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config';

export default defineWorkersConfig({
  test: {
    poolOptions: {
      workers: {
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
      },
    },
    setupFiles: ['./tests/worker/setup.ts'],
    include: ['tests/worker/**/*.test.ts'],
  },
});
