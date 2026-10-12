const CACHE_NAME='grabit-shell-v76';
const APP_SHELL=[
 './',
 './library.html',
 './manifest.webmanifest',
 './css/styles.css?v=54',
 './js/app.js?v=77',
 './js/library-filter.js',
 './js/backup.js',
 './js/importer.js',
 './js/share.js',
 './js/storage.js',
 './js/utils.js',
 './js/video-transcoder.js',
 './icons/git.svg',
 './icons/sun.svg',
 './icons/moon.svg',
 './icons/android/icon-192.png',
 './icons/android/icon-512.png',
 './icons/apple/AppIcon-180.png'
];

self.addEventListener('install',event=>{
 event.waitUntil(Promise.all([
  caches.open(CACHE_NAME).then(cache=>cache.addAll(APP_SHELL)),
  self.skipWaiting()
 ]));
});

self.addEventListener('activate',event=>{
 event.waitUntil(Promise.all([
  caches.keys().then(names=>Promise.all(names.filter(name=>name.startsWith('grabit-shell-')&&name!==CACHE_NAME).map(name=>caches.delete(name)))),
  self.clients.claim()
 ]));
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
 const appShellAsset=/\/(?:library\.html|manifest\.webmanifest|css\/styles\.css|js\/(?:app|importer|share|storage|utils|video-transcoder)\.js|vendor\/ffmpeg\/ffmpeg\/[^/]+\.js|icons\/(?:git|sun|moon)\.svg|icons\/(?:android\/icon-(?:192|512)\.png|apple\/AppIcon-180\.png))$/.test(url.pathname);
 if(appShellAsset){
  event.respondWith(fetch(request).then(response=>{
   if(response.ok&&response.type==='basic'){const copy=response.clone();caches.open(CACHE_NAME).then(cache=>cache.put(request,copy))}
   return response;
  }).catch(()=>caches.match(request)));
  return;
 }
});
