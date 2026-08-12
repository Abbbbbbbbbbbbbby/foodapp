import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const manifestPath = join(root, 'dist/pwa/.vite/manifest.json');
const swPath = join(root, 'dist/pwa/sw.js');

const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));

const urls = new Set();
for (const chunk of Object.values(manifest)) {
  if (chunk.file) urls.add('/' + chunk.file);
  for (const css of chunk.css ?? []) urls.add('/' + css);
}

const json = JSON.stringify([...urls]);
const sw = readFileSync(swPath, 'utf8');
const patched = sw.replace('[]', json);
writeFileSync(swPath, patched, 'utf8');

console.log(`inject-precache: ${urls.size} asset(s) injected into sw.js`);
