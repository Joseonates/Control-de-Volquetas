/* Service worker: deja que la app abra sin señal. */
const VER = 'volquetas-v1';
const CORE = [
  './',
  './index.html',
  './app.js',
  './manifest.webmanifest',
  './icon-192.png',
  './icon-512.png',
  './icon-maskable.png'
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(VER).then(c => c.addAll(CORE)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(ks => Promise.all(ks.filter(k => k !== VER).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;                       // las escrituras van directo a la red
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;        // la base de datos y las fuentes no se cachean aquí

  // La app se sirve primero de la red para que las actualizaciones lleguen solas,
  // y cae al caché cuando no hay señal.
  e.respondWith(
    fetch(req)
      .then(r => {
        if (r && r.ok) {
          const copy = r.clone();
          caches.open(VER).then(c => c.put(req, copy));
        }
        return r;
      })
      .catch(() => caches.match(req).then(r => r || caches.match('./index.html')))
  );
});
