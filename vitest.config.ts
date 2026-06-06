import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config';

export default defineWorkersConfig({
  test: {
    poolOptions: {
      workers: {
        wrangler: { configPath: './wrangler.toml' },
        miniflare: {
          d1Databases: ['DB'],
          kvNamespaces: ['SESSIONS'],
        },
      },
    },
    setupFiles: ['./tests/worker/setup.ts'],
    include: ['tests/worker/**/*.test.ts'],
  },
});
