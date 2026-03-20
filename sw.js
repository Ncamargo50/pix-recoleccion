// PIX Muestreo - Service Worker for Offline Support
const CACHE_NAME = 'pix-muestreo-v5';
const TILE_CACHE = 'pix-tiles-v1';
const DATA_CACHE = 'pix-data-v1';

const LOCAL_ASSETS = [
  '/pixadvisor-coleta/',
  '/pixadvisor-coleta/index.html',
  '/pixadvisor-coleta/manifest.json',
  '/pixadvisor-coleta/css/app.css',
  '/pixadvisor-coleta/js/utils.js',
  '/pixadvisor-coleta/js/app.js',
  '/pixadvisor-coleta/js/db.js',
  '/pixadvisor-coleta/js/map.js',
  '/pixadvisor-coleta/js/gps.js',
  '/pixadvisor-coleta/js/scanner.js',
  '/pixadvisor-coleta/js/sync.js',
  '/pixadvisor-coleta/js/drive.js',
  '/pixadvisor-coleta/js/agent-field.js',
  '/pixadvisor-coleta/icons/icon-192.png',
  '/pixadvisor-coleta/icons/icon-512.png'
];

const CDN_ASSETS = [
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
  'https://unpkg.com/html5-qrcode@2.3.8/html5-qrcode.min.js',
  'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap'
];

// Install - cache local assets (required), CDN assets (best-effort)
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(async cache => {
      await cache.addAll(LOCAL_ASSETS);
      for (const url of CDN_ASSETS) {
        try { await cache.add(url); } catch (e) { console.warn('[SW] CDN cache miss:', url); }
      }
    })
  );
  self.skipWaiting();
});

// Activate - clean old caches
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME && k !== TILE_CACHE && k !== DATA_CACHE).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Fetch - cache-first for static, network-first for API, cache tiles
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // Cache map tiles
  if (url.hostname.includes('tile.openstreetmap.org') || (url.hostname.includes('mt') && url.hostname.includes('google'))) {
    event.respondWith(
      caches.open(TILE_CACHE).then(cache =>
        cache.match(event.request).then(cached => {
          if (cached) return cached;
          return fetch(event.request).then(response => {
            cache.put(event.request, response.clone());
            return response;
          }).catch(() => new Response('', { status: 404 }));
        })
      )
    );
    return;
  }

  // Google API calls - network only
  if (url.hostname.includes('googleapis.com')) {
    event.respondWith(fetch(event.request));
    return;
  }

  // Static assets - cache first
  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached;
      return fetch(event.request).then(response => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        }
        return response;
      }).catch(() => caches.match('/pixadvisor-coleta/index.html'));
    })
  );
});

// Background sync
self.addEventListener('sync', event => {
  if (event.tag === 'sync-samples') {
    event.waitUntil(
      self.clients.matchAll().then(clients => {
        clients.forEach(client => {
          client.postMessage({ type: 'sync-samples' });
        });
      })
    );
  }
});

// Listen for messages from main thread
self.addEventListener('message', event => {
  if (event.data === 'skipWaiting') self.skipWaiting();

  // Cache a specific tile URL (used by tile pre-loader)
  if (event.data && event.data.type === 'cache-tile' && event.data.url) {
    event.waitUntil(
      caches.open(TILE_CACHE).then(cache =>
        cache.match(event.data.url).then(existing => {
          if (existing) return; // already cached
          return fetch(event.data.url).then(response => {
            if (response.ok) {
              return cache.put(event.data.url, response);
            }
          });
        })
      )
    );
  }
});
