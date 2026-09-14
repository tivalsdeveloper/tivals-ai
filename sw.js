const CACHE = 'tivals-ai-v23';
const ASSETS = ['./', './index.html', './widget.js', './manifest.webmanifest', './app-icon.svg', './robots.txt', './sitemap.xml', './privacy.html', './terms.html', './tivals-image-generator.js', './tivals-chat-media.js'];
self.addEventListener('install', event => event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(ASSETS)).then(() => self.skipWaiting())));
self.addEventListener('activate', event => event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim())));
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET' || !event.request.url.startsWith(self.location.origin)) return;
  if (event.request.mode === 'navigate') {
    event.respondWith(fetch(event.request,{cache:'no-store'}).then(async response => {
      const html = await response.text();
      let enhanced = html.replace(/<link[^>]*tivals-theme\.css[^>]*>/gi,'').replace(/<script[^>]*mobile-nav\.js[^>]*><\/script>/gi,'').replace(/<script[^>]*tivals-image-generator\.js[^>]*><\/script>/gi,'').replace(/<script[^>]*tivals-chat-media\.js[^>]*><\/script>/gi,'');
      enhanced = enhanced.replace('</head>', '<link rel="stylesheet" href="./tivals-theme.css?v=23"></head>');
      enhanced = enhanced.replace('</body>', '<script src="./mobile-nav.js?v=23"></script><script src="./tivals-image-generator.js?v=23"></script><script src="./tivals-chat-media.js?v=23"></script></body>');
      return new Response(enhanced,{status:response.status,statusText:response.statusText,headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'}});
    }).catch(() => caches.match('./index.html')));
    return;
  }
  const url = new URL(event.request.url);
  if (/\/(mobile-nav\.js|tivals-theme\.css|tivals-image-generator\.js|tivals-chat-media\.js)$/.test(url.pathname)) {event.respondWith(fetch(event.request,{cache:'no-store'}));return;}
  event.respondWith(fetch(event.request).then(response => {const copy=response.clone();caches.open(CACHE).then(cache=>cache.put(event.request,copy));return response;}).catch(()=>caches.match(event.request)));
});
self.addEventListener('push', event => {let data={title:'Tivals AI',body:'You have a new update.',url:'https://ai.tivalsdeveloper.site/'};try{data={...data,...event.data.json()}}catch{}event.waitUntil(self.registration.showNotification(data.title,{body:data.body,icon:'./app-icon.svg',badge:'./app-icon.svg',tag:data.tag||'tivals-ai',data:{url:data.url}}));});
self.addEventListener('notificationclick', event => {event.notification.close();const url=event.notification.data?.url||'https://ai.tivalsdeveloper.site/';event.waitUntil(clients.matchAll({type:'window',includeUncontrolled:true}).then(list=>{for(const client of list){if('focus'in client){client.navigate(url);return client.focus()}}return clients.openWindow(url)}));});