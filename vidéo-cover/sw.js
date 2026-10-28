const V = 'video-cover-v3';
const ASSETS = ['./', 'index.html', 'style.css', 'app.js', 'config.js', 'manifest.json', 'icons/icon-192.png', 'icons/icon-512.png'];
self.addEventListener('install', e => { e.waitUntil(caches.open(V).then(c => c.addAll(ASSETS))); self.skipWaiting(); });
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(k => Promise.all(k.filter(x => x !== V).map(x => caches.delete(x)))));
  self.clients.claim();
});
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET' || e.request.url.includes('/api/')) return;
  e.respondWith(caches.match(e.request).then(r => r || fetch(e.request).then(res => {
    if (res.ok || res.type === 'opaque') { const c = res.clone(); caches.open(V).then(x => x.put(e.request, c)); }
    return res;
  }).catch(() => caches.match('index.html'))));
});
