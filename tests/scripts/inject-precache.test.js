import { describe, it, expect } from 'vitest';
import { injectPrecache, urlsFromManifest } from '../../scripts/inject-precache.mjs';

describe('injectPrecache', () => {
  it('replaces the marker line with the asset list', () => {
    const sw = `const CACHE = 'x';\nconst PRECACHE_URLS = []; // __PRECACHE_URLS__\nrest();`;
    const out = injectPrecache(sw, ['/assets/a.js', '/assets/b.css']);
    expect(out).toContain('const PRECACHE_URLS = ["/assets/a.js","/assets/b.css"];');
    expect(out).not.toContain('__PRECACHE_URLS__');
  });

  it('THROWS when the marker is missing instead of shipping an empty precache', () => {
    const sw = `const CACHE = 'x';\nconst OTHER = [];\nrest();`;
    expect(() => injectPrecache(sw, ['/a.js'])).toThrow(/marker line/);
  });

  it('an unrelated [] earlier in the file is not patched', () => {
    const sw = `const decoy = [];\nconst PRECACHE_URLS = []; // __PRECACHE_URLS__`;
    const out = injectPrecache(sw, ['/a.js']);
    expect(out).toContain('const decoy = [];');
    expect(out).toContain('const PRECACHE_URLS = ["/a.js"];');
  });
});

describe('urlsFromManifest', () => {
  it('collects js and css entries uniquely', () => {
    const manifest = {
      'a.ts': { file: 'assets/a.js', css: ['assets/a.css'] },
      'b.ts': { file: 'assets/b.js', css: ['assets/a.css'] },
    };
    expect(urlsFromManifest(manifest).sort()).toEqual(['/assets/a.css', '/assets/a.js', '/assets/b.js']);
  });
});
