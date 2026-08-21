import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import legacy from '@vitejs/plugin-legacy';
import * as babel from '@babel/core';

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

// @babel/preset-env leaves arrow functions and shorthand methods untransformed
// for the 'ios >= 9' target because Safari 9 supposedly supports them. But
// iOS 9.3.5 on iPad 2 rejects them with "SyntaxError: unexpected token". This
// plugin runs a second Babel pass on legacy chunks only, forcing these two
// transforms down to ES5.
function forceEs5LegacyChunks(): Plugin {
  return {
    name: 'force-es5-legacy-chunks',
    renderChunk(code, chunk) {
      // Only transform app entry chunks — NOT the polyfills bundle.
      // The polyfills bundle (SystemJS + core-js) is pre-compiled ES5;
      // re-running Babel on minified code can corrupt it.
      if (!chunk.fileName.includes('-legacy-') || chunk.fileName.includes('polyfills-legacy')) return null;
      const result = babel.transformSync(code, {
        configFile: false,
        babelrc: false,
        plugins: [
          '@babel/plugin-transform-arrow-functions',
          '@babel/plugin-transform-shorthand-properties',
          '@babel/plugin-transform-template-literals',
          '@babel/plugin-transform-computed-properties',
          '@babel/plugin-transform-spread',
          '@babel/plugin-transform-destructuring',
        ],
        sourceMaps: false,
        compact: true,
      });
      return result?.code ? { code: result.code } : null;
    },
  };
}

// @vitejs/plugin-legacy emits an inline `System.import(...)` call with no
// guard. If the polyfills bundle hasn't finished executing (SystemJS not set),
// this throws "ReferenceError: Can't find variable: System" on iOS 9.
// Wait for the polyfill script's load event before calling System.import.
function guardLegacySystemImport(): Plugin {
  return {
    name: 'guard-legacy-system-import',
    transformIndexHtml: {
      order: 'post',
      handler(html: string) {
        return html.replace(
          /(<script[^>]*id="vite-legacy-entry"[^>]*>)System\.import\(([\s\S]+)\)(<\/script>)/,
          (_m, open, arg, close) =>
            `${open}(function(){var r=function(){System.import(${arg})};typeof System!=='undefined'?r():document.getElementById('vite-legacy-polyfill').addEventListener('load',r)})()${close}`
        );
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
    forceEs5LegacyChunks(),
    stripSafari10Guard(),
    guardLegacySystemImport(),
  ],
  root: 'src/pwa',
  publicDir: 'public',
  build: {
    outDir: '../../dist/pwa',
    emptyOutDir: true,
    manifest: true,
  },
  server: {
    proxy: {
      '/api': 'http://localhost:8787',
    },
  },
});
