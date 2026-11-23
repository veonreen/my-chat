/* Galaxy Relax service worker: app shell cache (opens offline) + the quiet "new star" alert. */
const CACHE = 'galaxy-v6';   // change this with every release => old cache is deleted and both phones get the new version
const SHELL = [
  './', 'index.html', 'css/style.css', 'manifest.webmanifest',
  'js/config.js', 'js/icons.js', 'js/util.js', 'js/crypto.js', 'js/vendor/socket.io.min.js', 'js/api.js', 'js/emoji.js', 'js/fx.js',
  'js/app.js', 'js/chat.js', 'js/stealth.js', 'js/boot.js', 'js/kdf-worker.js', 'js/vendor/argon2.js', 'js/vendor/galaxy3d.js',
  'fonts/sora.woff2', 'fonts/manrope.woff2',
  'icons/logo.svg', 'icons/icon-192.png', 'icons/icon-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
// Same-origin GET: network first (updates arrive at once), cache when offline.
// cache:'no-cache' makes the browser revalidate even GitHub Pages' ~10 minute HTTP cache.
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  e.respondWith(
    fetch(req, { cache: 'no-cache' }).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {}); }
      return res;
    }).catch(() => caches.match(req, { ignoreSearch: true }).then((r) => r || caches.match('index.html')))
  );
});

// Web Push. Stealth: whatever the server sends, the alert text is ALWAYS the same. No sender, no message text, no "chat".
// While the app is on screen (hash #u = logged in) nothing is shown: the decoy sky's star glows instead.
self.addEventListener('push', (e) => {
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
    if (list.some((c) => c.visibilityState === 'visible' && /#u$/.test(c.url))) return;
    return self.registration.showNotification('Galaxy Relax', {
      body: '🌟 A new star is shining',
      icon: 'icons/icon-192.png', badge: 'icons/icon-192.png',
      tag: 'star', renotify: true,
    });
  }));
});
// Tapping the alert only brings the app forward. It never opens the private area: you still type the secret code.
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
    for (const c of list) { if ('focus' in c) return c.focus(); }
    return self.clients.openWindow('./');
  }));
});
