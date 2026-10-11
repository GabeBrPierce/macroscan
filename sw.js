/* MacroScan service worker — offline shell cache.
   Network requests to USDA / Open Food Facts always go to the network. */
const CACHE = 'macroscan-v17';
const SHELL = [
  './',
  './index.html',
  './css/style.css',
  './js/config.js',
  './js/vendor/quagga.min.js',
  './js/store.js',
  './js/net.js',
  './js/scanner.js',
  './js/backup.js',
  './js/ui.js',
  './js/app.js',
  './icons/icon-56.png',
  './icons/icon-112.png',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

self.addEventListener('install', (e) => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).catch(() => {}));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  const url = e.request.url;
  // Never cache API calls.
  if (url.indexOf('api.nal.usda.gov') !== -1 || url.indexOf('openfoodfacts.org') !== -1) {
    return; // default network handling
  }
  e.respondWith(
    caches.match(e.request).then((r) => r || fetch(e.request).catch(() => caches.match('./index.html')))
  );
});
