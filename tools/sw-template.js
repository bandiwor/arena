/* NULL//ARENA service worker — generated at build time (see vite.config.ts → pwaPlugin). */
const VERSION = '__VERSION__';
const CACHE = 'null-arena-' + VERSION;
const FONTS = 'null-arena-fonts';
const PRECACHE = __PRECACHE__;

self.addEventListener('install', (e) => {
  // no skipWaiting: the page asks the player before switching versions
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(PRECACHE)));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('null-arena-') && k !== CACHE && k !== FONTS).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('message', (e) => {
  if (e.data && e.data.type === 'SKIP_WAITING') self.skipWaiting();
  if (e.data && e.data.type === 'GET_VERSION') e.source && e.source.postMessage({ type: 'VERSION', version: VERSION });
});

function timeout(ms) {
  return new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms));
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  // Google Fonts: stale-while-revalidate
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    e.respondWith(
      caches.open(FONTS).then(async (c) => {
        const hit = await c.match(req);
        const net = fetch(req)
          .then((r) => {
            if (r.ok || r.type === 'opaque') c.put(req, r.clone());
            return r;
          })
          .catch(() => hit);
        return hit || net;
      }),
    );
    return;
  }
  if (url.origin !== self.location.origin) return;
  // navigations: network-first (fresh index), cached shell when offline / slow
  if (req.mode === 'navigate') {
    e.respondWith(
      Promise.race([fetch(req), timeout(3500)])
        .then((r) => {
          if (r.ok) caches.open(CACHE).then((c) => c.put('./', r.clone()));
          return r;
        })
        .catch(() => caches.match('./', { cacheName: CACHE, ignoreVary: true }).then((r) => r || caches.match(req, { ignoreVary: true }))),
    );
    return;
  }
  // hashed assets & icons: cache-first
  e.respondWith(
    caches.match(req, { ignoreVary: true }).then(
      (hit) =>
        hit ||
        fetch(req).then((r) => {
          if (r.ok && url.pathname.includes('/assets/')) caches.open(CACHE).then((c) => c.put(req, r.clone()));
          return r;
        }),
    ),
  );
});
