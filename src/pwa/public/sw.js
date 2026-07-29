const CACHE = 'foodapp-v2';
const NAV_TIMEOUT_MS = 4000;

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.add('/')).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

function shouldCache(res, request) {
  if (!res.ok) return false;
  // Never cache HTML responses under a non-navigate URL — the SPA fallback
  // returns index.html for unknown JS/CSS paths; caching that would poison the asset.
  const ct = res.headers.get('content-type') || '';
  if (ct.includes('text/html') && request.destination !== 'document') return false;
  return true;
}

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (url.pathname.startsWith('/api/')) return;

  if (e.request.mode === 'navigate') {
    e.respondWith(
      Promise.race([
        fetch(e.request),
        new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), NAV_TIMEOUT_MS)),
      ]).then(res => {
        // Clone synchronously before returning res to the page.
        const copy = res.clone();
        if (shouldCache(res, e.request)) {
          e.waitUntil(caches.open(CACHE).then(c => c.put(e.request, copy)));
        }
        return res;
      }).catch(() => caches.match('/').then(r => r ?? fetch(e.request)))
    );
    return;
  }

  e.respondWith(
    caches.match(e.request).then(cached => {
      if (cached) return cached;
      return fetch(e.request).then(res => {
        // Clone synchronously before returning res to the page.
        const copy = res.clone();
        if (shouldCache(res, e.request)) {
          e.waitUntil(caches.open(CACHE).then(c => c.put(e.request, copy)));
        }
        return res;
      });
    })
  );
});
