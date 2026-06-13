// Zero-dependency service worker for offline play.
//
// The built assets have content-hashed names, so instead of a precache
// manifest we cache at runtime:
//   - navigations (the app shell): network-first, fall back to cache offline
//   - everything else (hashed JS/CSS, icons, manifest): cache-first
// A fresh deploy ships hashed filenames, so a new build's index pulls its new
// assets over the network on the next online visit and caches them too.
// Bump CACHE to retire old entries.
const CACHE = 'tetetennis-v1';

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // let cross-origin pass through

  if (req.mode === 'navigate') {
    event.respondWith(networkFirst(req));
  } else {
    event.respondWith(cacheFirst(req));
  }
});

async function networkFirst(req) {
  const cache = await caches.open(CACHE);
  try {
    const res = await fetch(req);
    if (res && res.ok) cache.put(req, res.clone());
    return res;
  } catch (err) {
    return (await cache.match(req)) ||
      (await cache.match(self.registration.scope)) ||
      Response.error();
  }
}

async function cacheFirst(req) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res && res.ok && (res.type === 'basic' || res.type === 'default')) {
    cache.put(req, res.clone());
  }
  return res;
}
