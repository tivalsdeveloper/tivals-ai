const CACHE = 'tivals-ai-v11';
const ASSETS = ['./', './index.html', './widget.js', './manifest.webmanifest', './app-icon.svg', './tivals-theme.css', './robots.txt', './sitemap.xml', './privacy.html', './terms.html'];
self.addEventListener('install', event => event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(ASSETS)).then(() => self.skipWaiting())));
self.addEventListener('activate', event => event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim())));
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET' || !event.request.url.startsWith(self.location.origin)) return;
  if (event.request.mode === 'navigate') {
    event.respondWith(fetch(event.request).then(async response => {
      const html = await response.text();
      const themed = html.includes('tivals-theme.css') ? html : html.replace('</head>', '<link rel="stylesheet" href="./tivals-theme.css?v=11"></head>');
      return new Response(themed, {status: response.status, statusText: response.statusText, headers: {'Content-Type':'text/html; charset=utf-8'}});
    }).catch(() => caches.match('./index.html')));
    return;
  }
  event.respondWith(fetch(event.request).then(response => { const copy=response.clone(); caches.open(CACHE).then(cache=>cache.put(event.request,copy)); return response; }).catch(() => caches.match(event.request)));
});