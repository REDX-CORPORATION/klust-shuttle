// KLUST Shuttle — map tile cache.
// Caches OpenStreetMap / OSM-Carto tile images in the browser's on-device
// Cache Storage, so re-opening the app or revisiting the same area of the
// map re-uses tiles already downloaded instead of sending a new request.
// This is separate from (and never touches) /api/login or any other
// same-origin request — it only intercepts the known tile hosts below.

const CACHE_NAME = 'klust-tiles-v1';
const TILE_HOSTS = ['tile.openstreetmap.org', 'tile.osmit.it'];
const MAX_ENTRIES = 1600; // ~a few MB of tiles; oldest are evicted first

self.addEventListener('install', () => { self.skipWaiting(); });
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  let url;
  try { url = new URL(req.url); } catch { return; }
  if (!TILE_HOSTS.includes(url.hostname)) return; // only tiles; everything else goes to the network as normal

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
