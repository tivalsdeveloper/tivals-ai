const CACHE='tivals-ai-v24';
const STATIC=['./app-icon.svg','./manifest.webmanifest','./robots.txt','./sitemap.xml','./privacy.html','./terms.html'];
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(STATIC)).then(()=>self.skipWaiting())));
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key!==CACHE).map(key=>caches.delete(key)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',event=>{
  if(event.request.method!=='GET'||!event.request.url.startsWith(self.location.origin))return;
  const url=new URL(event.request.url);
  if(event.request.mode==='navigate'){
    event.respondWith(fetch(event.request,{cache:'no-store'}).then(async response=>{
      const html=await response.text();
      let enhanced=html.replace(/<link[^>]*tivals-theme\.css[^>]*>/gi,'').replace(/<script[^>]*mobile-nav\.js[^>]*><\/script>/gi,'').replace(/<script[^>]*tivals-image-generator\.js[^>]*><\/script>/gi,'').replace(/<script[^>]*tivals-chat-media\.js[^>]*><\/script>/gi,'');
      enhanced=enhanced.replace('</head>','<link rel="stylesheet" href="./tivals-theme.css?v=24"></head>');
      enhanced=enhanced.replace('</body>','<script src="./mobile-nav.js?v=24"></script><script src="./tivals-image-generator.js?v=24"></script><script src="./tivals-chat-media.js?v=24"></script></body>');
      const headers=new Headers(response.headers);headers.set('Content-Type','text/html; charset=utf-8');headers.set('Cache-Control','no-store, no-cache, must-revalidate, max-age=0');headers.set('Pragma','no-cache');
      return new Response(enhanced,{status:response.status,statusText:response.statusText,headers});
    }).catch(()=>new Response('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><body style="background:#061a35;color:white;font-family:system-ui;padding:32px"><h2>Tivals AI</h2><p>You appear to be offline. Reconnect and reload Tivals AI.</p></body>',{headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'}})));
    return;
  }
  if(/\/(mobile-nav\.js|tivals-theme\.css|tivals-image-generator\.js|tivals-chat-media\.js|index\.html)$/.test(url.pathname)){
    event.respondWith(fetch(event.request,{cache:'no-store'}));return;
  }
  event.respondWith(caches.match(event.request).then(cached=>cached||fetch(event.request).then(response=>{if(response.ok){const copy=response.clone();caches.open(CACHE).then(cache=>cache.put(event.request,copy))}return response})));
});
self.addEventListener('push',event=>{let data={title:'Tivals AI',body:'You have a new update.',url:'https://ai.tivalsdeveloper.site/'};try{data={...data,...event.data.json()}}catch{}event.waitUntil(self.registration.showNotification(data.title,{body:data.body,icon:'./app-icon.svg',badge:'./app-icon.svg',tag:data.tag||'tivals-ai',data:{url:data.url}}));});
self.addEventListener('notificationclick',event=>{event.notification.close();const url=event.notification.data?.url||'https://ai.tivalsdeveloper.site/';event.waitUntil(clients.matchAll({type:'window',includeUncontrolled:true}).then(list=>{for(const client of list){if('focus'in client){client.navigate(url);return client.focus()}}return clients.openWindow(url)}));});