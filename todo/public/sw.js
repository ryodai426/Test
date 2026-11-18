// プッシュ通知を受け取り、アプリの部品を端末に保存して起動を速くする Service Worker
const CACHE = 'app-v2';
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

  // ページ本体：まず最新を取りに行く（新しい版をすぐ反映するため）。
  // 電波が悪くて3秒たっても返ってこないとき・つながらないときだけ、保存したページを出す
  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE);
      const fresh = fetch(req).then(res => {
        if (res.ok && url.pathname === '/') cache.put('/', res.clone());
        return res;
      });
      event.waitUntil(fresh.catch(() => {}));
      const slow = new Promise(r => setTimeout(r, 3000, null));
      try {
        const res = await Promise.race([fresh, slow]);
        if (res) return res;
      } catch { /* つながらない */ }
      const hit = url.pathname === '/' ? await cache.match('/') : null;
      if (hit) return hit;
      try { return await fresh; } catch { return Response.error(); }
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
      data: { url: data.url || '/', confirm: data.confirm || null },
      // 「完了しましたか？」には、その場で答えられるボタン（対応している端末だけ。iPhone は通知を押すとアプリで聞く）
      actions: data.confirm ? [
        { action: 'done', title: '完了' },
        { action: 'later', title: 'まだ（15分後）' },
        { action: 'hold', title: '保留' },
      ] : [],
    });
  })());
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const c = event.notification.data && event.notification.data.confirm;
  if (c && ['done', 'later', 'hold'].includes(event.action)) {
    const path = event.action === 'done' ? `/api/tasks/${c.taskId}/done` : `/api/tasks/${c.taskId}/followup`;
    const body = event.action === 'done' ? { day: c.day, done: true } : { day: c.day, action: event.action };
    event.waitUntil(fetch(path, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).catch(() => {}));
    return;
  }
  const url = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const w of wins) {
      if ('focus' in w) { await w.focus(); w.postMessage({ type: 'open', url }); return; }
    }
    await self.clients.openWindow(url);
  })());
});
