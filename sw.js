const CACHE='tivals-ai-v26';
const STATIC=['./app-icon.svg','./manifest.webmanifest','./robots.txt','./sitemap.xml','./privacy.html','./terms.html'];

self.addEventListener('install',event=>event.waitUntil(
  caches.open(CACHE)
    .then(cache=>Promise.allSettled(STATIC.map(file=>cache.add(file))))
    .then(()=>self.skipWaiting())
));

self.addEventListener('activate',event=>event.waitUntil(
  caches.keys()
    .then(keys=>Promise.all(keys.filter(key=>key!==CACHE).map(key=>caches.delete(key))))
    .then(()=>self.clients.claim())
));

self.addEventListener('fetch',event=>{
  if(event.request.method!=='GET') return;

  // Do not intercept page navigation. The browser loads the live website directly.
  // This prevents DNS/server failures from being incorrectly shown as an offline page.
  if(event.request.mode==='navigate') return;

  const url=new URL(event.request.url);
  if(url.origin!==self.location.origin) return;

  event.respondWith(
    fetch(event.request).catch(()=>caches.match(event.request)).then(response=>{
      if(response){
        const copy=response.clone();
        caches.open(CACHE).then(cache=>cache.put(event.request,copy)).catch(()=>{});
      }
      return response;
    })
  );
});

self.addEventListener('push',event=>{
  let data={title:'Tivals AI',body:'You have a new update.',url:'https://ai.tivalsdeveloper.site/'};
  try{data={...data,...event.data.json()}}catch{}
  event.waitUntil(self.registration.showNotification(data.title,{
    body:data.body,
    icon:'./app-icon.svg',
    badge:'./app-icon.svg',
    tag:data.tag||'tivals-ai',
    data:{url:data.url}
  }));
});

self.addEventListener('notificationclick',event=>{
  event.notification.close();
  const url=event.notification.data?.url||'https://ai.tivalsdeveloper.site/';
  event.waitUntil(clients.matchAll({type:'window',includeUncontrolled:true}).then(list=>{
    for(const client of list){
      if('focus' in client){
        client.navigate(url);
        return client.focus();
      }
    }
    return clients.openWindow(url);
  }));
});
