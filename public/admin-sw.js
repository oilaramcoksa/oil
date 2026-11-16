'use strict';
const CACHE = 'aramco-admin-shell-v1';
const OFFLINE_URL = '/admin-offline.html';
self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.add(OFFLINE_URL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key.startsWith('aramco-admin-') && key !== CACHE).map((key) => caches.delete(key)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;
  // Never cache admin APIs, authentication, player records, or financial data.
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/admin')) {
    if (request.mode === 'navigate' && url.pathname.startsWith('/admin')) {
      event.respondWith(fetch(request).catch(() => caches.match(OFFLINE_URL)));
    }
    return;
  }
  if (url.pathname.startsWith('/_next/static/')) {
    event.respondWith(caches.open(CACHE).then(async (cache) => {
      const cached = await cache.match(request);
      const fresh = fetch(request).then((response) => { if (response.ok) void cache.put(request, response.clone()); return response; }).catch(() => cached);
      return cached || fresh;
    }));
  }
});
