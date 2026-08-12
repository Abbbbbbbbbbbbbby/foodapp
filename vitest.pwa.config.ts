import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/pwa/**/*.test.ts'],
    coverage: {
      // Guard the logic layer: offline sync is the app's highest-risk code.
      // Components are covered by the separate UI suite (jsdom); pages and
      // types are excluded here so the threshold tracks lib/ only.
      include: ['src/pwa/lib/**'],
      exclude: ['src/pwa/lib/types.ts'],
      thresholds: {
        statements: 70,
        branches: 65,
        lines: 75,
      },
    },
  },
});
