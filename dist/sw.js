const VERSION = "9b4e72d39fc4";
const PRECACHE = [
  "./assets/bricolage-grotesque-latin-ext-wdth-normal-DoS1gVTC.woff2",
  "./assets/bricolage-grotesque-latin-wdth-normal-Dtb2a5nO.woff2",
  "./assets/bricolage-grotesque-vietnamese-wdth-normal-BKE08zty.woff2",
  "./assets/index-DB6XnfE8.js",
  "./assets/index-JKp3NXyk.css",
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
