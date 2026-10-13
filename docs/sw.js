/* Service worker: rende l'app installabile e utilizzabile anche offline (tranne le funzioni AI). */
const CACHE = 'scuola-ai-v4';
const SHELL = [
  './',
  'index.html',
  'manifest.webmanifest',
  'css/style.css',
  'js/util.js',
  'js/store.js',
  'js/gemini.js',
  'js/recorder.js',
  'js/mindmap.js',
  'js/components.js',
  'js/app.js',
  'js/ink.js',
  'js/notes.js',
  'js/quiz.js',
  'js/tools.js',
  'icons/icon.svg',
  'icons/icon-192.png',
  'icons/icon-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  // Mai mettere in cache le chiamate all'AI
  if (url.hostname.endsWith('googleapis.com')) return;

  if (url.origin === location.origin) {
    // Network-first per i file dell'app (così gli aggiornamenti arrivano subito), cache come riserva offline
    e.respondWith(
      fetch(e.request)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(e.request, copy));
          }
          return res;
        })
        .catch(() => caches.match(e.request, { ignoreSearch: true }).then((r) => r || caches.match('index.html')))
    );
  } else if (url.hostname === 'cdnjs.cloudflare.com') {
    // Cache-first per KaTeX e font
    e.respondWith(
      caches.match(e.request).then(
        (r) =>
          r ||
          fetch(e.request).then((res) => {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(e.request, copy));
            return res;
          })
      )
    );
  }
});
