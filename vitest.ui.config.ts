import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    include: ['tests/pwa-ui/**/*.test.tsx'],
    setupFiles: ['./tests/pwa-ui/setup.ts'],
    globals: false,
  },
});
