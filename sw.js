/* Service worker: deja que la app abra sin señal y garantiza que las
   actualizaciones lleguen. El número al final del nombre cambia en cada
   versión, así el celular descarta la caché vieja. */
const VER = 'volquetas-v8';
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
    caches.open(VER)
      // cache:'reload' obliga a bajarlos del servidor, ignorando la caché del navegador
      .then(c => Promise.all(CORE.map(u => c.add(new Request(u, {cache: 'reload'})).catch(() => null))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(ks => Promise.all(ks.filter(k => k !== VER).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', e => {
  if (e.data && e.data.t === 'actualizar') self.skipWaiting();
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // La app y sus archivos se piden siempre al servidor, saltándose la caché del
  // navegador; el caché propio queda solo como respaldo para cuando no hay señal.
  const esApp = req.mode === 'navigate' || /\.(html|js|webmanifest)$/.test(url.pathname) || url.pathname.endsWith('/');
  const pedir = esApp ? fetch(new Request(req.url, {cache: 'no-store', credentials: 'same-origin'})) : fetch(req);

  e.respondWith(
    pedir
      .then(r => {
        if (r && r.ok) {
          const copia = r.clone();
          caches.open(VER).then(c => c.put(req, copia));
        }
        return r;
      })
      .catch(() => caches.match(req).then(r => r || caches.match('./index.html')))
  );
});
