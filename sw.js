// Service worker : l'app s'ouvre hors ligne. Fichiers de l'app en réseau d'abord (mises à jour immédiates),
// jaquettes en cache d'abord (elles ne changent pas). OMDb : toujours en direct.
// À chaque modification du site, augmenter CACHE_VERSION (et APP_VERSION dans js/version.js).
const CACHE_VERSION = 'carnet-films-v6';
const POSTER_CACHE = 'carnet-films-posters';
const MAX_POSTERS = 600;
const SHELL = [
  './', 'index.html', 'manifest.webmanifest', 'css/app.css',
  'icons/icon.svg', 'icons/icon-180.png', 'icons/icon-512.png',
  'js/app.js', 'js/version.js', 'js/ui.js', 'js/store.js', 'js/model.js', 'js/omdb.js', 'js/synopsis.js', 'js/french.js', 'js/sync.js', 'js/sync-model.js',
  'js/taste.js', 'js/wikidata.js', 'js/recommend.js', 'apps-script/Code.gs',
  'js/views/carnet.js', 'js/views/search.js', 'js/views/detail.js', 'js/views/import.js', 'js/views/settings.js',
  'js/views/cloud.js', 'js/views/advanced.js', 'js/views/result-card.js', 'js/views/discover.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_VERSION).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_VERSION && k !== POSTER_CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

async function trimPosters(cache) {
  const keys = await cache.keys();
  await Promise.all(keys.slice(0, Math.max(0, keys.length - MAX_POSTERS)).map((k) => cache.delete(k)));
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  const isOwn = url.origin === self.location.origin;
  const isPoster = url.hostname === 'm.media-amazon.com';

  if (isPoster) {
    event.respondWith(caches.open(POSTER_CACHE).then(async (cache) => {
      const cached = await cache.match(request);
      if (cached) return cached;
      const res = await fetch(request);
      if (res.ok || res.type === 'opaque') { cache.put(request, res.clone()); trimPosters(cache); }
      return res;
    }));
    return;
  }
  if (!isOwn) return;
  event.respondWith(
    fetch(request)
      .then((res) => {
        if (res.ok) { const copy = res.clone(); caches.open(CACHE_VERSION).then((c) => c.put(request, copy)); }
        return res;
      })
      .catch(() => caches.match(request, { ignoreSearch: true }).then((c) => c || Response.error())),
  );
});
