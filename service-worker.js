const CACHE_NAME='grabit-shell-v27';
const APP_SHELL=[
 './',
 './library.html',
 './manifest.webmanifest',
 './css/styles.css?v=27',
 './js/app.js?v=27',
 './js/importer.js',
 './js/storage.js',
 './js/utils.js',
 './icons/grabit.svg',
 './icons/grabit-192.png',
 './icons/grabit-512.png',
 './icons/grabit-192.svg',
 './icons/grabit-512.svg'
];

self.addEventListener('install',event=>{
 event.waitUntil(caches.open(CACHE_NAME).then(cache=>cache.addAll(APP_SHELL)));
 self.skipWaiting();
});

self.addEventListener('activate',event=>{
 event.waitUntil(caches.keys().then(names=>Promise.all(names.filter(name=>name.startsWith('grabit-shell-')&&name!==CACHE_NAME).map(name=>caches.delete(name)))));
 self.clients.claim();
});

self.addEventListener('fetch',event=>{
 const request=event.request,url=new URL(request.url);
 if(request.method!=='GET'||url.origin!==self.location.origin||url.pathname.includes('/api/'))return;
 if(request.mode==='navigate'){
  event.respondWith(fetch(request).then(response=>{
   if(response.ok){const copy=response.clone();caches.open(CACHE_NAME).then(cache=>cache.put('./library.html',copy))}
   return response;
  }).catch(()=>caches.match('./library.html')));
  return;
 }
 if(/\.(?:css|js|webmanifest)$/.test(url.pathname)){
  event.respondWith(fetch(request).then(response=>{
   if(response.ok&&response.type==='basic'){const copy=response.clone();caches.open(CACHE_NAME).then(cache=>cache.put(request,copy))}
   return response;
  }).catch(()=>caches.match(request)));
  return;
 }
 event.respondWith(caches.match(request).then(cached=>cached||fetch(request).then(response=>{
  if(response.ok&&response.type==='basic'){const copy=response.clone();caches.open(CACHE_NAME).then(cache=>cache.put(request,copy))}
  return response;
 })));
});
