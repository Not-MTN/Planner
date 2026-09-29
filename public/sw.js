/* Planner service worker — offline app shell. Planner data lives in localStorage, never here. */
const CACHE = 'planner-shell-v3';
const SHELL = ['/', '/index.html', '/theme-init.js', '/manifest.webmanifest', '/favicon.svg'];

self.addEventListener('install', (event) => {
  // No automatic skipWaiting: the page offers "refresh to update" and tells us
  // via SKIP_WAITING when the user is ready, so a hard swap never hits mid-session.
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)));
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  // Never cache AI calls.
  if (url.origin === self.location.origin && url.pathname.startsWith('/api/')) return;

  // Pages: network first so updates arrive, cached shell when offline.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put('/index.html', copy));
          return response;
        })
        .catch(() => caches.match('/index.html').then((hit) => hit || caches.match('/'))),
    );
    return;
  }

  // Hashed build assets, images and fonts: cache first, then refresh in the background.
  const cacheable = url.origin === self.location.origin || url.hostname.endsWith('gstatic.com') || url.hostname.endsWith('googleapis.com');
  if (!cacheable) return;
  event.respondWith(
    caches.match(request).then((hit) => {
      const network = fetch(request)
        .then((response) => {
          if (response.ok || response.type === 'opaque') {
            const copy = response.clone();
            caches.open(CACHE).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => hit);
      return hit || network;
    }),
  );
});

self.addEventListener('push', (event) => {
  let payload = {};
  try { payload = event.data ? event.data.json() : {}; } catch { payload = {}; }
  const title = typeof payload.title === 'string' ? payload.title : 'Planner reminder';
  const options = {
    body: typeof payload.body === 'string' ? payload.body : 'A reminder is due. Open Planner to see your schedule.',
    icon: '/favicon.svg',
    tag: typeof payload.tag === 'string' ? payload.tag : 'planner-reminder',
    data: { url: typeof payload.url === 'string' ? payload.url : '/#/today' },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = event.notification.data && typeof event.notification.data.url === 'string' ? event.notification.data.url : '/#/today';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(async (clients) => {
      const open = clients.find((client) => 'focus' in client);
      if (open) {
        if ('navigate' in open) await open.navigate(target);
        return open.focus();
      }
      return self.clients.openWindow(target);
    }),
  );
});
