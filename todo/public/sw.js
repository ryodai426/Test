// プッシュ通知を受け取り、アプリの部品を端末に保存して起動を速くする Service Worker
const CACHE = 'app-v1';
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil((async () => {
  for (const k of await caches.keys()) if (k !== CACHE) await caches.delete(k);
  await self.clients.claim();
})()));

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return; // データは毎回取りに行く

  // 名前に版が入っている部品（JS・CSS・フォント）は変わらないので、保存したものを使う
  if (url.pathname.startsWith('/_next/static/')) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE);
      const hit = await cache.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok) cache.put(req, res.clone());
      return res;
    })());
    return;
  }

  // ページ本体：保存したものをすぐ出し、裏で最新を取ってきて次回に備える
  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE);
      const hit = await cache.match('/');
      const fresh = fetch(req).then(res => {
        if (res.ok && url.pathname === '/') cache.put('/', res.clone());
        return res;
      });
      if (hit && url.pathname === '/') { event.waitUntil(fresh.catch(() => {})); return hit; }
      try { return await fresh; } catch { return hit || Response.error(); }
    })());
  }
});

self.addEventListener('push', event => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = { title: 'わすれないYO', body: event.data && event.data.text() }; }
  event.waitUntil((async () => {
    // アプリを開いて見ている最中なら、画面の中に大きく出す（通知が二重にならないように）
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const focused = wins.find(w => w.focused && w.visibilityState === 'visible');
    if (focused) { focused.postMessage({ type: 'push', data }); return; }
    await self.registration.showNotification(data.title || 'わすれないYO', {
      body: data.body || '',
      tag: data.tag,
      renotify: !!data.tag,
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      data: { url: data.url || '/' },
    });
  })());
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const w of wins) {
      if ('focus' in w) { await w.focus(); w.postMessage({ type: 'open', url }); return; }
    }
    await self.clients.openWindow(url);
  })());
});
