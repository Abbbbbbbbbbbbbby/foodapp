import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
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
