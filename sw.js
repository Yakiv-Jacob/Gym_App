// Service worker: зберігає файли програми на телефоні, щоб вона працювала без інтернету.
// ВАЖЛИВО: після будь-якої зміни файлів програми збільшити VERSION —
// інакше телефон продовжить показувати стару версію.
const VERSION = 'v2';
const CACHE = `gym-log-${VERSION}`;
const FILES = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/styles.css',
  './js/app.js',
  './js/store.js',
  './js/stats.js',
  './js/util.js',
  './icons/apple-touch-icon.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/favicon.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)));
  // Нова версія чекає, поки користувач натисне «Оновити» (див. app.js).
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('gym-log-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('message', (e) => {
  if (e.data === 'skip-waiting') self.skipWaiting();
});

// Спершу з кешу (миттєво і без інтернету), інакше — з мережі.
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  e.respondWith(
    caches.match(req, { ignoreSearch: true }).then((hit) => {
      if (hit) return hit;
      return fetch(req).catch(() =>
        req.mode === 'navigate' ? caches.match('./index.html') : Response.error());
    }),
  );
});
