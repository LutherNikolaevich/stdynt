// Offline-first: every file of a build is stored at install, then served from that copy.
// The network is only used to fetch the next build, never to open the app.
// VERSION and PRECACHE are filled in at build time (see precacheManifest in vite.config.js).
const VERSION = "43a63097fe2a";
const PRECACHE = [
  "./assets/bricolage-grotesque-latin-ext-wdth-normal-DoS1gVTC.woff2",
  "./assets/bricolage-grotesque-latin-wdth-normal-Dtb2a5nO.woff2",
  "./assets/bricolage-grotesque-vietnamese-wdth-normal-BKE08zty.woff2",
  "./assets/index-C-Rw8PmP.js",
  "./assets/index-D_kahlSf.css",
  "./icon-192-maskable.png",
  "./icon-192.png",
  "./icon-512-maskable.png",
  "./icon-512.png",
  "./index.html",
  "./manifest.json"
];
const CACHE_NAME = `stdynt-${VERSION}`;
const SHELL_URL = './index.html';
const MATCH = { ignoreVary: true };

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches
      .open(CACHE_NAME)
      // cache: 'reload' skips the HTTP cache, so a build is never assembled from stale files.
      // addAll is all-or-nothing: a failed download leaves the previous build in charge.
      .then((cache) => cache.addAll(PRECACHE.map((url) => new Request(url, { cache: 'reload' }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// A response that arrived through a redirect cannot answer a navigation; rebuild it clean.
const clean = (res) =>
  res.redirected ? new Response(res.body, { status: res.status, statusText: res.statusText, headers: res.headers }) : res;

self.addEventListener('fetch', (e) => {
  const { request } = e;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;

  const key = request.mode === 'navigate' ? SHELL_URL : request;
  e.respondWith(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.match(key, MATCH))
      .then((hit) => (hit ? clean(hit) : fetch(request)))
  );
});
