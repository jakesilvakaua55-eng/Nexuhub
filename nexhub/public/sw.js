const CACHE='nexhub-static-v35';
const SHELL=['/','/index.html','/styles.css','/app.js','/icon.svg','/icon-192.png','/icon-512.png','/manifest.webmanifest'];
self.addEventListener('install',event=>{event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(SHELL)));self.skipWaiting();});
self.addEventListener('activate',event=>{event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))));self.clients.claim();});
self.addEventListener('fetch',event=>{
  const url=new URL(event.request.url);
  if(event.request.method!=='GET'||url.origin!==self.location.origin||url.pathname.startsWith('/api/')||url.pathname.startsWith('/invite/'))return;
  if(SHELL.includes(url.pathname)||url.pathname==='/app') {
    event.respondWith(fetch(event.request).then(res=>{
      if(res.ok&&res.type==='basic'){const clone=res.clone();caches.open(CACHE).then(cache=>cache.put(event.request,clone));}
      return res;
    }).catch(()=>caches.match(event.request).then(match=>match||caches.match('/index.html'))));
  }
});
self.addEventListener('push',event=>{
  const data=event.data?.json?.() || {title:'NexHub',body:'Nova atividade'};
  event.waitUntil(self.registration.showNotification(data.title||'NexHub',{body:data.body||'Nova notificação',icon:'/icon-192.png',badge:'/icon-192.png',data:{url:data.url||'/app'}}));
});
self.addEventListener('notificationclick',event=>{
  event.notification.close();
  const target=event.notification.data?.url||'/app';
  event.waitUntil(clients.matchAll({type:'window',includeUncontrolled:true}).then(list=>{
    for(const client of list){if(client.url.includes('/app'))return client.focus();}
    return clients.openWindow(target);
  }));
});
