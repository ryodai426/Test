// プッシュ通知を受け取る Service Worker
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));

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
