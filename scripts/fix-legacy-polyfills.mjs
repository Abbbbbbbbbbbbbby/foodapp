import { readFileSync, writeFileSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import * as babel from '@babel/core';

// @vitejs/plugin-legacy builds its polyfills-legacy bundle (SystemJS +
// core-js + whatwg-fetch) through its own internal Rollup pass, so the
// `renderChunk` hook in vite.config.ts's forceEs5LegacyChunks — which forces
// arrow functions etc. down to ES5 for the app's OWN legacy chunk — never
// sees it. That bundle was wrongly assumed to already be pre-compiled ES5;
// a real iPad 2 on iOS 9.3.5 proved otherwise (un-transformed arrow function
// on line 1, breaking the app before anything else could load). This
// post-build step runs the same Babel pass directly on the built file.
export function fixLegacyPolyfills(code) {
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
      '@babel/plugin-transform-classes',
    ],
    sourceMaps: false,
    compact: true,
  });
  if (!result?.code) throw new Error('fix-legacy-polyfills: Babel produced no output');
  return result.code;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  const assetsDir = join(root, 'dist/pwa/assets');
  const file = readdirSync(assetsDir).find(f => f.startsWith('polyfills-legacy-') && f.endsWith('.js'));
  if (!file) {
    throw new Error('fix-legacy-polyfills: no polyfills-legacy-*.js file found in dist/pwa/assets — refusing to ship an unpatched legacy bundle');
  }
  const filePath = join(assetsDir, file);
  writeFileSync(filePath, fixLegacyPolyfills(readFileSync(filePath, 'utf8')), 'utf8');
  console.log(`fix-legacy-polyfills: patched ${file}`);
}
