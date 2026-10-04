// Service worker di Traccemoto: app disponibile offline e mappa già vista in cache.
// VERSION viene aggiornata da `npm run versione` insieme ai ?v= di CSS e moduli.
const VERSION = '202610041754';
const SHELL = `tracce-shell-${VERSION}`;
const TILES = 'tracce-mappa-v1';
const MAX_TILES = 1500;

const LEAFLET = [
  'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.css',
  'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.js',
  'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/layers.png',
  'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/layers-2x.png',
];
const ASSETS = [
  './',
  'index.html',
  'manifest.webmanifest',
  `css/style.css?v=${VERSION}`,
  `css/roadbook.css?v=${VERSION}`,
  ...['app', 'core', 'places', 'passes', 'services', 'legs', 'config', 'roadbook', 'roadbook-view'].map((m) => `js/${m}.js?v=${VERSION}`),
  'icons/icon.svg',
  'icons/apple-touch-icon.png',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'fonts/saira-condensed-latin-600-normal.woff2',
  'fonts/saira-condensed-latin-800-normal.woff2',
];

// servizi delle tile: si conservano le porzioni di mappa già viste
const TILE_HOSTS = /(^|\.)(tile\.openstreetmap\.org|tile\.opentopomap\.org|basemaps\.cartocdn\.com)$/;

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL);
      await cache.addAll(ASSETS);
      // Leaflet è su un altro dominio: se non si scarica, l'app funziona lo stesso online
      await Promise.all(LEAFLET.map((url) => cache.add(new Request(url, { mode: 'cors' })).catch(() => {})));
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k.startsWith('tracce-shell-') && k !== SHELL).map((k) => caches.delete(k)));
      await self.clients.claim();
    })(),
  );
});

// la pagina chiede di attivare subito la nuova versione (pulsante «Aggiorna»)
self.addEventListener('message', (event) => {
  if (event.data === 'skipWaiting') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // la pagina: prima la rete (per avere sempre l'ultima versione), offline quella salvata
  // le guide e le altre pagine del sito: solo rete (offline, quella eventualmente in cache)
  const root = new URL('./', self.location).pathname;
  if (req.mode === 'navigate' && url.pathname !== root && url.pathname !== `${root}index.html`) {
    event.respondWith(fetch(req).catch(async () => (await caches.match(req)) || Response.error()));
    return;
  }
  if (req.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          const res = await fetch(req);
          const cache = await caches.open(SHELL);
          cache.put('index.html', res.clone());
          return res;
        } catch {
          return (await caches.match('index.html', { ignoreSearch: true })) || Response.error();
        }
      })(),
    );
    return;
  }

  // file dell'app e Leaflet: prima la cache (sono versionati, non cambiano)
  if (url.origin === self.location.origin || url.hostname === 'cdnjs.cloudflare.com') {
    event.respondWith(
      (async () => {
        const hit = await caches.match(req);
        if (hit) return hit;
        const res = await fetch(req);
        // anche Leaflet si salva la prima volta che arriva (se all'installazione non era raggiungibile)
        if (res.ok) (await caches.open(SHELL)).put(req, res.clone());
        return res;
      })(),
    );
    return;
  }

  // tile della mappa: subito quella salvata, intanto si aggiorna dalla rete
  if (TILE_HOSTS.test(url.hostname)) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(TILES);
        const hit = await cache.match(req);
        const fresh = fetch(req)
          .then(async (res) => {
            if (res.ok) {
              await cache.put(req, res.clone());
              trimTiles(cache);
            }
            return res;
          })
          .catch(() => null);
        if (hit) {
          event.waitUntil(fresh);
          return hit;
        }
        return (await fresh) || Response.error();
      })(),
    );
  }
  // percorsi, ricerca e Overpass: sempre dalla rete (nessuna risposta in cache)
});

let trimming = false;
async function trimTiles(cache) {
  if (trimming) return;
  trimming = true;
  try {
    const keys = await cache.keys();
    // le più vecchie escono per prime
    for (const k of keys.slice(0, Math.max(0, keys.length - MAX_TILES))) await cache.delete(k);
  } finally {
    trimming = false;
  }
}
