// Service worker minimal : rend la page installable et l'ouvre hors connexion.
// Réseau d'abord pour nos propres fichiers, cache en secours. Firebase et les API ne passent jamais par ici.
const CACHE = 'mywatchlist-v2';
const SHELL = ['./', './index.html', './css/style.css', './js/app.js', './js/config.js', './js/data.js', './js/external.js', './js/firebase.js', './manifest.webmanifest', './icons/icon-192.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  e.respondWith(
    fetch(e.request)
      .then(res => {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, copy));
        return res;
      })
      .catch(() => caches.match(e.request).then(hit => hit || caches.match('./index.html')))
  );
});
