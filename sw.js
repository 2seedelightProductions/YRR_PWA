// Yacht Rock Radio PWA — Service Worker v1.5.7 111426 (approx. location on votes)
// v1.5.2: Stream/media requests now BYPASS the service worker entirely.
// Previously respondWith(fetch()) proxied the endless Live365 stream through
// the SW; when the browser froze/killed the SW (screen off, app backgrounded)
// the stream died after the buffer drained.
const CACHE_NAME = 'yacht-rock-v1-5-7';
const SHELL_FILES = [
  '/',
  '/index.html',
  '/manifest.json',
  '/library.json',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
];


// Domains the SW must never touch — browser talks to them directly
const NETWORK_ONLY = [
  'streaming.live365.com',
  'player.live365.com',
  'api.live365.com',
  'musicbrainz.org',
  'coverartarchive.org',
];


// Install: cache app shell
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_FILES))
  );
  self.skipWaiting();
});


// Activate: clean old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});


// Fetch handler
self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);


  // Hands off: non-GET, audio/video, range requests, and external live domains.
  // NOT calling respondWith() lets the browser fetch directly, so the stream
  // survives screen-off and backgrounding.
  if (
    req.method !== 'GET' ||
    req.destination === 'audio' ||
    req.destination === 'video' ||
    req.headers.has('range') ||
    NETWORK_ONLY.some(domain => url.hostname.includes(domain))
  ) {
    return;
  }


  // Only manage our own origin — leave every other third-party request alone
  if (url.origin !== self.location.origin) {
    return;
  }

  // Live data on our own site — always from the network, never cached
  if (url.pathname.startsWith('/api/') || url.pathname === '/crawl-promos.json' || url.pathname === '/dd-notes.json') {
    return;
  }


  // Local shell files — cache-first, fall back to network
  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;
      return fetch(req).then((response) => {
        if (response && response.status === 200 && response.type === 'basic') {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, clone));
        }
        return response;
      });
    }).catch(() => caches.match('/index.html'))
  );
});