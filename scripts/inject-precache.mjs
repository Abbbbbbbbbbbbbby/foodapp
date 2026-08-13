import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const MARKER = '// __PRECACHE_URLS__';

// Exported for unit testing: returns the patched source or throws when the
// marker line is missing — a silently-unpatched SW would ship with an empty
// precache and quietly reintroduce the offline white-screen bug.
export function injectPrecache(swSource, urls) {
  const markerLine = new RegExp(`const PRECACHE_URLS = \\[\\]; ?${MARKER.replace(/[/]/g, '\\/')}`);
  if (!markerLine.test(swSource)) {
    throw new Error(`inject-precache: marker line "const PRECACHE_URLS = []; ${MARKER}" not found in sw.js — refusing to ship an SW without a precache list`);
  }
  return swSource.replace(markerLine, `const PRECACHE_URLS = ${JSON.stringify(urls)};`);
}

export function urlsFromManifest(manifest) {
  const urls = new Set();
  for (const chunk of Object.values(manifest)) {
    if (chunk.file) urls.add('/' + chunk.file);
    for (const css of chunk.css ?? []) urls.add('/' + css);
  }
  return [...urls];
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  const manifest = JSON.parse(readFileSync(join(root, 'dist/pwa/.vite/manifest.json'), 'utf8'));
  const urls = urlsFromManifest(manifest);
  const swPath = join(root, 'dist/pwa/sw.js');
  writeFileSync(swPath, injectPrecache(readFileSync(swPath, 'utf8'), urls), 'utf8');
  console.log(`inject-precache: ${urls.length} asset(s) injected into sw.js`);
}
