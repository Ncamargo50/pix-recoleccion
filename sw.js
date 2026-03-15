// Pixadvisor Coleta - Service Worker for Offline Support
const CACHE_NAME = 'pix-coleta-v1';
const TILE_CACHE = 'pix-tiles-v1';
const DATA_CACHE = 'pix-data-v1';

const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/css/app.css',
  '/js/app.js',
  '/js/db.js',
  '/js/map.js',
  '/js/gps.js',
  '/js/scanner.js',
  '/js/sync.js',
  '/js/drive.js',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
  'https://unpkg.com/html5-qrcode@2.3.8/html5-qrcode.min.js',
  'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap'
];

// Install - cache static assets
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(STATIC_ASSETS))
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
  if (url.hostname.includes('tile.openstreetmap.org') || url.hostname.includes('mt') && url.hostname.includes('google')) {
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
      }).catch(() => caches.match('/index.html'));
    })
  );
});

// Background sync
self.addEventListener('sync', event => {
  if (event.tag === 'sync-samples') {
    event.respondWith(syncSamples());
  }
});

// Listen for messages from main thread
self.addEventListener('message', event => {
  if (event.data === 'skipWaiting') self.skipWaiting();
});
