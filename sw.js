// Tivals AI no longer uses a service worker for offline caching.
// This retirement worker removes legacy caches and unregisters itself so
// old cached offline pages cannot continue controlling the website.

self.addEventListener('install', event => {
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.map(key => caches.delete(key)));
    await self.registration.unregister();

    const windows = await self.clients.matchAll({
      type: 'window',
      includeUncontrolled: true
    });

    for (const client of windows) {
      try {
        await client.navigate(client.url);
      } catch (_) {}
    }
  })());
});

// Deliberately no fetch handler.
// All website requests now go directly to the network/browser.
