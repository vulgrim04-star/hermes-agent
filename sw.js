/* Généré à la construction — ne pas modifier à la main. */
const CACHE = 'budget-' + "/hermes-agent/assets/index-jdJQD3lk.js";
const PRECACHE = [
  "/hermes-agent/",
  "/hermes-agent/index.html",
  "/hermes-agent/manifest.webmanifest",
  "/hermes-agent/icon-192.png",
  "/hermes-agent/icon-512.png",
  "/hermes-agent/icon.svg",
  "/hermes-agent/favicon.svg",
  "/hermes-agent/assets/index-jdJQD3lk.js",
  "/hermes-agent/assets/index-CI84OjWh.css"
];

self.addEventListener('install', (e) => {
  // Chaque fichier est demandé séparément : un seul 404 ne doit pas faire
  // échouer l'installation entière et laisser l'application sans cache.
  e.waitUntil(caches.open(CACHE).then((c) => Promise.all(
    PRECACHE.map((u) => c.add(new Request(u, { cache: 'reload' })).catch(() => null)),
  )).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((cles) => Promise.all(cles.filter((c) => c !== CACHE).map((c) => caches.delete(c))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const { request } = e;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  // Rien de ce qui sort du site n'est mis en cache : ni Supabase, ni quoi que
  // ce soit d'autre. Un journal comptable n'a pas à traîner dans un cache HTTP.
  if (url.origin !== self.location.origin) return;

  // Une navigation retombe sur la coquille : l'application est une SPA, et
  // hors ligne il n'y a personne pour servir /ecritures.
  if (request.mode === 'navigate') {
    e.respondWith(fetch(request).catch(() => caches.match("/hermes-agent/index.html")
      .then((r) => r || caches.match("/hermes-agent/"))));
    return;
  }

  // Les assets portent une empreinte : s'ils sont en cache, ils sont bons.
  e.respondWith(caches.match(request).then((hit) => hit || fetch(request).then((reponse) => {
    if (reponse && reponse.ok && reponse.type === 'basic') {
      const copie = reponse.clone();
      caches.open(CACHE).then((c) => c.put(request, copie));
    }
    return reponse;
  })));
});
