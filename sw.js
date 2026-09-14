const CACHE='tivals-ai-v25';
const SHELL_CACHE='tivals-ai-shell-v25';
const STATIC=['./app-icon.svg','./manifest.webmanifest','./robots.txt','./sitemap.xml','./privacy.html','./terms.html'];

self.addEventListener('install',event=>event.waitUntil(
  Promise.all([
    caches.open(CACHE).then(cache=>cache.addAll(STATIC)),
    fetch('./',{cache:'no-store'}).then(response=>{
      if(!response.ok) throw new Error('Unable to cache app shell');
      return caches.open(SHELL_CACHE).then(cache=>cache.put('./',response.clone()));
    }).catch(()=>{})
  ]).then(()=>self.skipWaiting())
));

self.addEventListener('activate',event=>event.waitUntil(
  caches.keys().then(keys=>Promise.all(keys.filter(key=>key!==CACHE&&key!==SHELL_CACHE).map(key=>caches.delete(key))))
    .then(()=>self.clients.claim())
));

async function enhanceHtml(response){
  const html=await response.text();
  let enhanced=html
    .replace(/<link[^>]*tivals-theme\.css[^>]*>/gi,'')
    .replace(/<script[^>]*mobile-nav\.js[^>]*><\/script>/gi,'')
    .replace(/<script[^>]*tivals-image-generator\.js[^>]*><\/script>/gi,'')
    .replace(/<script[^>]*tivals-chat-media\.js[^>]*><\/script>/gi,'');
  enhanced=enhanced.replace('</head>','<link rel="stylesheet" href="./tivals-theme.css?v=25"></head>');
  enhanced=enhanced.replace('</body>','<script src="./mobile-nav.js?v=25"></script><script src="./tivals-image-generator.js?v=25"></script><script src="./tivals-chat-media.js?v=25"></script></body>');
  const headers=new Headers(response.headers);
  headers.set('Content-Type','text/html; charset=utf-8');
  headers.set('Cache-Control','no-store, no-cache, must-revalidate, max-age=0');
  headers.set('Pragma','no-cache');
  return new Response(enhanced,{status:response.status,statusText:response.statusText,headers});
}

self.addEventListener('fetch',event=>{
  if(event.request.method!=='GET'||!event.request.url.startsWith(self.location.origin)) return;
  const url=new URL(event.request.url);

  if(event.request.mode==='navigate'){
    event.respondWith((async()=>{
      try{
        const response=await fetch(event.request,{cache:'no-store'});
        if(!response.ok) throw new Error('Navigation failed');
        const shellCopy=response.clone();
        caches.open(SHELL_CACHE).then(cache=>cache.put('./',shellCopy)).catch(()=>{});
        return await enhanceHtml(response);
      }catch(error){
        const cached=await caches.open(SHELL_CACHE).then(cache=>cache.match('./'));
        if(cached) return enhanceHtml(cached.clone());
        const fallback=await caches.match('./index.html');
        if(fallback) return enhanceHtml(fallback.clone());
        return new Response('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#061a35"><title>Tivals AI</title></head><body style="margin:0;background:#061a35;color:white;font-family:system-ui;display:grid;place-items:center;min-height:100vh"><main style="max-width:420px;padding:32px;text-align:center"><img src="./app-icon.svg" alt="Tivals AI" width="72" height="72"><h2>Tivals AI</h2><p style="opacity:.82;line-height:1.5">Connection unavailable. Tivals AI will reconnect when your network returns.</p><button onclick="location.reload()" style="border:0;border-radius:12px;padding:12px 20px;font-weight:700">Try again</button></main><script>addEventListener(\'online\',()=>location.reload())</script></body></html>',{headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'}});
      }
    })());
    return;
  }

  if(/\/(mobile-nav\.js|tivals-theme\.css|tivals-image-generator\.js|tivals-chat-media\.js|index\.html)$/.test(url.pathname)){
    event.respondWith(fetch(event.request,{cache:'no-store'}).catch(()=>caches.match(event.request)));
    return;
  }

  event.respondWith(caches.match(event.request).then(cached=>cached||fetch(event.request).then(response=>{
    if(response.ok){
      const copy=response.clone();
      caches.open(CACHE).then(cache=>cache.put(event.request,copy));
    }
    return response;
  })));
});

self.addEventListener('push',event=>{
  let data={title:'Tivals AI',body:'You have a new update.',url:'https://ai.tivalsdeveloper.site/'};
  try{data={...data,...event.data.json()}}catch{}
  event.waitUntil(self.registration.showNotification(data.title,{body:data.body,icon:'./app-icon.svg',badge:'./app-icon.svg',tag:data.tag||'tivals-ai',data:{url:data.url}}));
});

self.addEventListener('notificationclick',event=>{
  event.notification.close();
  const url=event.notification.data?.url||'https://ai.tivalsdeveloper.site/';
  event.waitUntil(clients.matchAll({type:'window',includeUncontrolled:true}).then(list=>{
    for(const client of list){
      if('focus' in client){client.navigate(url);return client.focus();}
    }
    return clients.openWindow(url);
  }));
});
