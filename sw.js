// KLUST Shuttle — map tile cache.
// Caches OpenStreetMap / OSM-Carto tile images in the browser's on-device
// Cache Storage, so re-opening the app or revisiting the same area of the
// map re-uses tiles already downloaded instead of sending a new request.
// This is separate from (and never touches) /api/login or any other
// same-origin request — it only intercepts the known tile hosts below.

const CACHE_NAME = 'klust-tiles-v1';
const TILE_HOSTS = ['tile.openstreetmap.org', 'tile.osmit.it'];
const SHELL = 'klust-shell-v2'; // app shell for offline use
const MAX_ENTRIES = 1600; // ~a few MB of tiles; oldest are evicted first

self.addEventListener('install', () => { self.skipWaiting(); });
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== CACHE_NAME && k !== SHELL).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  let url;
  try { url = new URL(req.url); } catch { return; }
  if (!TILE_HOSTS.includes(url.hostname)) {
    // App shell (page, plus.js, QR library, fonts): network first, saved copy when offline. Never the login relay.
    const shell = (url.origin === location.origin && !url.pathname.startsWith('/api/')) || url.hostname === 'cdnjs.cloudflare.com' || url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com';
    if (!shell) return;
    event.respondWith((async () => {
      const c = await caches.open(SHELL);
      try { const res = await fetch(req); if (res && (res.ok || res.type === 'opaque')) c.put(req, res.clone()); return res; }
      catch (err) { return (await c.match(req)) || (req.mode === 'navigate' && (await c.match('/'))) || new Response('', { status: 504 }); }
    })());
    return;
  }

  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    const hit = await cache.match(req);
    if (hit) return hit; // served straight from device, no network request
    try {
      const res = await fetch(req);
      if (res && res.ok) { cache.put(req, res.clone()); trim(cache); }
      return res;
    } catch (err) {
      return hit || new Response('', { status: 504 });
    }
  })());
});

async function trim(cache) {
  const keys = await cache.keys();
  if (keys.length <= MAX_ENTRIES) return;
  const extra = keys.length - MAX_ENTRIES;
  for (let i = 0; i < extra; i++) await cache.delete(keys[i]);
}
