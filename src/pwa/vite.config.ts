import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import legacy from '@vitejs/plugin-legacy';

// @vitejs/plugin-legacy injects a Safari 10.0/10.1 double-module fix that uses
// WebKit's 'beforeload' event. On iOS 9.3.5, 'onbeforeload' exists but
// 'noModule' does not, so the condition is truthy and the fix activates — but
// then calls e.preventDefault() on EVERY subsequent <script nomodule> tag,
// blocking the SystemJS polyfills bundle and causing a blank screen. Remove it.
function stripSafari10Guard(): Plugin {
  return {
    name: 'strip-safari10-nomodule-guard',
    transformIndexHtml: {
      order: 'post',
      handler(html: string) {
        return html.replace(/<script nomodule>[^<]*beforeload[^<]*<\/script>/, '');
      },
    },
  };
}

export default defineConfig({
  plugins: [
    react(),
    // Generates a legacy bundle for Safari 9 (iPad 2 / iOS 9.3.5 / A1395).
    // Handles: ES modules fallback, async/await transpilation, fetch polyfill.
    legacy({
      targets: ['ios >= 9'],
      additionalLegacyPolyfills: ['whatwg-fetch'],
    }),
    stripSafari10Guard(),
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
