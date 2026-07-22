import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import legacy from '@vitejs/plugin-legacy';

export default defineConfig({
  plugins: [
    react(),
    // Generates a legacy bundle for Safari 9 (iPad 3 / iOS 9.3.6 / A1416).
    // Handles: ES modules fallback, async/await transpilation, fetch polyfill.
    legacy({
      targets: ['ios >= 9'],
      additionalLegacyPolyfills: ['whatwg-fetch'],
    }),
  ],
  root: 'src/pwa',
  publicDir: 'public',
  build: {
    outDir: '../../dist/pwa',
    emptyOutDir: true,
  },
  server: {
    proxy: {
      '/api': 'http://localhost:8787',
    },
  },
});
