const VERSION = '__VERSION__';
const PRECACHE = [/*__PRECACHE__*/];
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
  e.waitUntil(self.clients.claim());
});

self.addEventListener('message', (e) => {
  if (e.data !== 'prune' || self.registration.installing || self.registration.waiting) return;
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
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
      .then((hit) => hit || caches.match(key, MATCH))
      .then((hit) => (hit ? clean(hit) : fetch(request)))
  );
});
