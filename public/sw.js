const worker = self;
const TILE_HOST = 'avigis.avinor.no';
const TILE_PREFIX = 'flightplanner-icao-tiles-';
const TILE_LIMIT = 250;
let liveEdition = null;

const sanitiseEdition = (value) => String(value).replace(/[^A-Za-z0-9_-]/g, '');

worker.addEventListener('install', (event) => {
  event.waitUntil(worker.skipWaiting());
});

worker.addEventListener('activate', (event) => {
  event.waitUntil(worker.clients.claim());
});

worker.addEventListener('message', (event) => {
  const message = event.data || {};
  if (message.type !== 'chart-edition' || !message.edition) return;

  liveEdition = sanitiseEdition(message.edition);
  const activeCacheName = TILE_PREFIX + liveEdition;

  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(
        names.map((name) =>
          name.startsWith(TILE_PREFIX) && name !== activeCacheName
            ? caches.delete(name)
            : Promise.resolve(false),
        ),
      ),
    ),
  );
});

async function trimCache(cache) {
  const keys = await cache.keys();
  if (keys.length <= TILE_LIMIT) return;
  const excess = keys.slice(0, keys.length - TILE_LIMIT);
  await Promise.all(excess.map((request) => cache.delete(request)));
}

async function chartTileFirst(request) {
  const cache = await caches.open(TILE_PREFIX + liveEdition);
  const cached = await cache.match(request);
  if (cached) return cached;

  const response = await fetch(request);
  if (response && (response.ok || response.type === 'opaque')) {
    await cache.put(request, response.clone());
    await trimCache(cache);
  }
  return response;
}

worker.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET' || !liveEdition) return;

  let url;
  try {
    url = new URL(request.url);
  } catch {
    return;
  }

  if (url.hostname !== TILE_HOST || !url.pathname.endsWith('/export')) return;
  event.respondWith(chartTileFirst(request));
});
