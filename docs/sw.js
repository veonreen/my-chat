/* MyChat service worker: app shell cache (offline open) + notification click */
const CACHE = 'mychat-v2';
const SHELL = [
  './', 'index.html', 'css/style.css', 'manifest.webmanifest',
  'js/config.js', 'js/util.js', 'js/crypto.js', 'js/vendor/socket.io.min.js', 'js/api.js', 'js/emoji.js', 'js/app.js', 'js/chat.js', 'js/boot.js',
  'icons/logo.svg', 'icons/icon-192.png', 'icons/icon-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
// Same-origin GET: network first (taaki update turant mile), fail ho to cache.
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  e.respondWith(
    fetch(req).then((res) => {
      const copy = res.clone();
      caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
      return res;
    }).catch(() => caches.match(req).then((r) => r || caches.match('index.html')))
  );
});
// Web Push: server sirf "naya message" bhejta hai (E2EE: text server ko pata hi nahi).
// App screen par dikh raha ho to notification nahi dikhate.
self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (err) { d = {}; }
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
    if (list.some((c) => c.visibilityState === 'visible')) return;
    return self.registration.showNotification(d.title || 'MyChat', {
      body: d.body || 'Naya message',
      icon: 'icons/icon-192.png', badge: 'icons/icon-192.png',
      tag: 'chat-' + (d.from || 'x'), renotify: true, data: { peer: d.from },
    });
  }));
});
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const peer = e.notification.data && e.notification.data.peer;
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
    for (const c of list) { if ('focus' in c) { c.postMessage({ type: 'open-chat', peer }); return c.focus(); } }
    return self.clients.openWindow('./');
  }));
});
