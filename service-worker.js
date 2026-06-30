/**
 * Service Worker — RAYVER Music PWA
 * Cachea el shell estático (HTML/CSS/JS/imágenes propias) para que la app
 * abra instantáneamente y funcione offline en lo básico.
 * NO cachea las llamadas a /api/* ni a SoundCloud/YouTube/Spotify/Apple Music,
 * que siempre van a red para tener datos frescos.
 */

const CACHE_VERSION = 'rayver-shell-v2';
const SHELL_ASSETS = [
  '/',
  '/index.html',
  '/styles.css',
  '/script.js',
  '/radio.js',
  '/logo.jpg',
  '/manifest.json'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) => cache.addAll(SHELL_ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Nunca interceptar llamadas a la API propia ni a APIs externas de música
  if (
    url.pathname.startsWith('/api/') ||
    url.hostname.includes('soundcloud.com') ||
    url.hostname.includes('spotify.com') ||
    url.hostname.includes('youtube.com') ||
    url.hostname.includes('googleapis.com') ||
    url.hostname.includes('apple.com') ||
    url.hostname.includes('mzstatic.com')
  ) {
    return; // deja pasar la petición normal a la red
  }

  // Solo cachear peticiones GET del propio origen
  if (event.request.method !== 'GET' || url.origin !== self.location.origin) return;

  // Network-first: siempre intenta la red para servir la última versión desplegada
  // (HTML/JS/CSS) — así el reproductor y el resto del código se actualizan en cada
  // deploy. Solo cae a la copia en cache si no hay red (offline).
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response && response.ok) {
          const clone = response.clone();
          caches.open(CACHE_VERSION).then((cache) => cache.put(event.request, clone));
        }
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});
