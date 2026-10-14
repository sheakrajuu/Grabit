import http from 'node:http';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {extractPage,openPublicMedia,safeDownloadFilename} from './server/extractor.js';
import {extractVideoCollection,isVideoCollectionUrl,maxPlaylistItems,playlistPageSize,resolveVideo,startVideoDownload} from './server/playlist.js';
import {createShareStore,MAX_SHARE_BYTES} from './server/share-store.js';
import {classify,videoCollectionTitle,isPixivImageUrl} from './js/utils.js';

const root=path.dirname(fileURLToPath(import.meta.url));
const host=process.env.HOST||(process.env.PORT?'0.0.0.0':'127.0.0.1');
const port=Number(process.env.PORT||3000);
const MAX_BODY_BYTES=16*1024;
const RATE_WINDOW_MS=60_000;
const MAX_PREVIEWS_PER_WINDOW=12;
const MAX_PLAYLISTS_PER_WINDOW=12;
const MAX_DOWNLOADS_PER_WINDOW=20;
const MAX_PIXIV_IMAGES_PER_WINDOW=120;
const MAX_SHARES_PER_WINDOW=10;
const buckets=new Map();
const shareStore=createShareStore();
const publicFiles=new Set([
 '/library.html','/manifest.webmanifest','/service-worker.js','/THIRD-PARTY-NOTICES.txt','/licenses/COPYING.GPLv2',
 '/css/styles.css',
 '/js/app.js','/js/backup.js','/js/importer.js','/js/library-filter.js','/js/share.js','/js/storage.js','/js/utils.js','/js/video-transcoder.js',
 '/vendor/ffmpeg/ffmpeg/index.js','/vendor/ffmpeg/ffmpeg/classes.js','/vendor/ffmpeg/ffmpeg/const.js','/vendor/ffmpeg/ffmpeg/errors.js','/vendor/ffmpeg/ffmpeg/utils.js','/vendor/ffmpeg/ffmpeg/types.js','/vendor/ffmpeg/ffmpeg/worker.js',
 '/vendor/ffmpeg/core/ffmpeg-core.js','/vendor/ffmpeg/core/ffmpeg-core.wasm',
 '/icons/git.svg','/icons/sun.svg','/icons/moon.svg','/icons/android/icon-192.png','/icons/android/icon-512.png','/icons/apple/AppIcon-180.png'
]);
const vendorFiles=new Map([
 ...['index.js','classes.js','const.js','errors.js','utils.js','types.js','worker.js'].map(file=>[`/vendor/ffmpeg/ffmpeg/${file}`,path.join(root,'node_modules','@ffmpeg','ffmpeg','dist','esm',file)]),
 ['/vendor/ffmpeg/core/ffmpeg-core.js',path.join(root,'node_modules','@ffmpeg','core','dist','esm','ffmpeg-core.js')]
]);
const wasmPath='/vendor/ffmpeg/core/ffmpeg-core.wasm';
const wasmPartPaths=[
 path.join(root,'vendor','ffmpeg','core','ffmpeg-core.wasm.part-001'),
 path.join(root,'vendor','ffmpeg','core','ffmpeg-core.wasm.part-002')
];
const types={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.json':'application/json; charset=utf-8','.txt':'text/plain; charset=utf-8','.webmanifest':'application/manifest+json; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.wasm':'application/wasm'};

function send(response,status,payload){
 response.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff','referrer-policy':'no-referrer'});
 response.end(JSON.stringify(payload));
}

function getClientAddress(request){return request.socket.remoteAddress||'unknown'}
function pruneRateBuckets(now){
 if(buckets.size>5000)for(const [address,state]of buckets)if(now-state.start>RATE_WINDOW_MS)buckets.delete(address);
}
function allowPreview(request){
 const key=getClientAddress(request),now=Date.now();let bucket=buckets.get(key);
 if(!bucket||now-bucket.start>RATE_WINDOW_MS){bucket={start:now,count:0};buckets.set(key,bucket)}
 bucket.count++;
 pruneRateBuckets(now);
 return bucket.count<=MAX_PREVIEWS_PER_WINDOW;
}

function allowPlaylist(request){
 const key=`playlist:${getClientAddress(request)}`,now=Date.now();let bucket=buckets.get(key);
 if(!bucket||now-bucket.start>RATE_WINDOW_MS){bucket={start:now,count:0};buckets.set(key,bucket)}
 bucket.count++;
 pruneRateBuckets(now);
 return bucket.count<=MAX_PLAYLISTS_PER_WINDOW;
}

function allowDownload(request){
 const key=`download:${getClientAddress(request)}`,now=Date.now();let bucket=buckets.get(key);
 if(!bucket||now-bucket.start>RATE_WINDOW_MS){bucket={start:now,count:0};buckets.set(key,bucket)}
 bucket.count++;
 pruneRateBuckets(now);
 return bucket.count<=MAX_DOWNLOADS_PER_WINDOW;
}

function allowPixivImage(request){
 const key=`pixiv-image:${getClientAddress(request)}`,now=Date.now();let bucket=buckets.get(key);
 if(!bucket||now-bucket.start>RATE_WINDOW_MS){bucket={start:now,count:0};buckets.set(key,bucket)}
 bucket.count++;
 pruneRateBuckets(now);
 return bucket.count<=MAX_PIXIV_IMAGES_PER_WINDOW;
}

async function readJson(request,maxBytes=MAX_BODY_BYTES,limitMessage='Request body exceeds the 16 KB limit.'){
 const chunks=[];let length=0;
 for await(const chunk of request){
  length+=chunk.length;if(length>maxBytes)throw Object.assign(new Error(limitMessage),{status:413});
  chunks.push(chunk);
 }
 try{return JSON.parse(Buffer.concat(chunks).toString('utf8'))}catch{throw Object.assign(new Error('Request body must contain valid JSON.'),{status:400})}
}

async function readBinary(request,maxBytes){
 const chunks=[];let length=0;
 for await(const chunk of request){
  length+=chunk.length;
  if(length>maxBytes)throw Object.assign(new Error('Encrypted share exceeds the 80 MB limit.'),{status:413});
  chunks.push(chunk);
 }
 return Buffer.concat(chunks,length);
}

function sendBinary(response,status,payload){
 response.writeHead(status,{'content-type':'application/octet-stream','content-length':payload.length,'cache-control':'no-store','x-content-type-options':'nosniff','referrer-policy':'no-referrer'});
 response.end(payload);
}

function allowShareCreation(request){
 const key=`share:${getClientAddress(request)}`,now=Date.now();let bucket=buckets.get(key);
 if(!bucket||now-bucket.start>RATE_WINDOW_MS){bucket={start:now,count:0};buckets.set(key,bucket)}
 bucket.count++;
 pruneRateBuckets(now);
 return bucket.count<=MAX_SHARES_PER_WINDOW;
}

async function serveStatic(pathname,response){
 let decoded;try{decoded=decodeURIComponent(pathname)}catch{response.writeHead(400).end('Bad request');return}
 const relative=decoded==='/'?'/library.html':decoded;
 if(!publicFiles.has(relative)){response.writeHead(404,{'content-type':'text/plain; charset=utf-8','x-content-type-options':'nosniff'}).end('Not found');return}
 const target=vendorFiles.get(relative)||path.resolve(root,`.${relative}`);
 if(target!==root&&!target.startsWith(root+path.sep)){response.writeHead(403).end('Forbidden');return}
 let file;
 try{
  const fs=await import('node:fs/promises');
  if(relative===wasmPath){
   file=Buffer.concat(await Promise.all(wasmPartPaths.map(partPath=>fs.readFile(partPath))));
  }else file=await fs.readFile(target);
 }catch(error){
  const missing=error.code==='ENOENT';
  const incomplete=relative===wasmPath&&missing;
  console.error(`Could not serve static asset ${relative}:`,error);
  response.writeHead(missing?404:500,{'content-type':'text/plain; charset=utf-8'}).end(incomplete?'Split FFmpeg WebAssembly files are missing or incomplete.':missing?'Not found':'Could not load static asset');
  return;
 }
 response.writeHead(200,{'content-type':types[path.extname(target)]||'application/octet-stream','x-content-type-options':'nosniff','referrer-policy':'no-referrer','content-security-policy':"default-src 'self' data: blob:; img-src 'self' https: data:; media-src 'self' https: blob:; frame-src https:; style-src 'self' 'unsafe-inline'; script-src 'self' 'wasm-unsafe-eval'; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'"});
 response.end(file);
}

const server=http.createServer(async(request,response)=>{
 const url=new URL(request.url,'http://localhost');
 if(url.pathname==='/api/health'&&request.method==='GET'){send(response,200,{ok:true});return}
 if(url.pathname==='/api/shares'){
  if(request.method!=='POST'){send(response,405,{error:'Use POST to create a share link.'});return}
  if(!allowShareCreation(request)){send(response,429,{error:'Too many share links. Wait a minute and retry.'});return}
  try{
   if(request.headers['content-type']!=='application/octet-stream'){send(response,415,{error:'Share data must be encrypted in the browser before upload.'});return}
   const ciphertext=await readBinary(request,MAX_SHARE_BYTES);
   if(ciphertext.length<29){send(response,400,{error:'Encrypted share data is incomplete.'});return}
   const share=shareStore.create(ciphertext,ciphertext.length);
   send(response,201,share);
  }catch(error){send(response,error.status||400,{error:error.message||'Could not create a share link.'})}
  return;
 }
 const shareMatch=url.pathname.match(/^\/api\/shares\/([A-Za-z0-9_-]{12}|[A-Za-z0-9_-]{16})$/);
 if(shareMatch){
  if(request.method==='GET'){
   const ciphertext=shareStore.get(shareMatch[1]);
   if(!ciphertext){send(response,404,{error:'This share link has already been used or is no longer available. Ask the sender to make a new link.'});return}
   sendBinary(response,200,ciphertext);
   return;
  }
  if(request.method==='DELETE'){
   shareStore.consume(shareMatch[1]);
   response.writeHead(204,{'cache-control':'no-store','x-content-type-options':'nosniff','referrer-policy':'no-referrer'}).end();
   return;
  }
  send(response,405,{error:'Use GET to retrieve encrypted share data or DELETE to consume it.'});
  return;
 }
 const shortLinkMatch=url.pathname.match(/^\/s\/([A-Za-z0-9_-]{12}|[A-Za-z0-9_-]{16})$/);
 if(shortLinkMatch){
  if(request.method!=='GET'){response.writeHead(405,{'allow':'GET','cache-control':'no-store'}).end();return}
  response.writeHead(302,{'location':`/library.html#grabit-share-id=${shortLinkMatch[1]}`,'cache-control':'no-store','referrer-policy':'no-referrer','x-content-type-options':'nosniff'}).end();
  return;
 }
 if(url.pathname==='/api/preview'){
  if(request.method!=='POST'){send(response,405,{error:'Use POST to preview a webpage.'});return}
  if(!allowPreview(request)){send(response,429,{error:'Too many preview requests. Wait a minute and retry.'});return}
  try{
   const payload=await readJson(request);
   if(typeof payload.url!=='string'||payload.url.length>2048){send(response,400,{error:'Provide a valid webpage URL shorter than 2048 characters.'});return}
   let result;
   const start=payload.start??1;
   if(!Number.isSafeInteger(start)||start<1||start>maxPlaylistItems||((start-1)%playlistPageSize)!==0){send(response,400,{error:`Playlist position must start at 1 and advance in groups of ${playlistPageSize}, up to ${maxPlaylistItems-playlistPageSize+1}.`});return}
   const url=new URL(payload.url),knownCollection=isVideoCollectionUrl(payload.url);
   const shouldDiscoverCollection=payload.includePlaylist!==false&&(knownCollection||payload.start!==undefined||classify(payload.url)==='bookmark');
   let page,collection,collectionError,pageError;
   if(shouldDiscoverCollection){
    const [pageResult,collectionResult]=await Promise.allSettled([
     extractPage(payload.url),
     extractVideoCollection(payload.url,{start})
    ]);
    if(pageResult.status==='fulfilled')page=pageResult.value;
    else pageError=pageResult.reason;
    if(collectionResult.status==='fulfilled')collection=collectionResult.value;
    else collectionError=collectionResult.reason;
   }else page=await extractPage(payload.url);
   if(collection){
    const media=collection.media.map((entry,index)=>({...entry,position:start-1+index}));
    result={
     ...(page||{}),
     title:page?.title||videoCollectionTitle(payload.url)||url.hostname,
     description:page?.description||'',
     canonicalUrl:page?.canonicalUrl||payload.url,
     media,
     mediaCount:media.length,
     start:collection.start,
     hasMore:collection.hasMore,
     playlistPaging:collection.playlistPaging,
     truncated:collection.truncated||!!page?.truncated,
     refetchOnOpen:true,
     ...(collection.warning?{mediaWarning:'Some media could not be loaded.'}:{})
    };
   }else if(page){
    result=page;
    if(knownCollection&&collectionError){console.warn('Could not load all media from a collection:',collectionError);result={...page,refetchOnOpen:true,mediaWarning:'Some media could not be loaded.'}}
   }else throw collectionError||pageError||new Error('Could not preview this public URL.');
   send(response,200,result);
  }catch(error){console.warn('Page preview failed:',error);send(response,error.status||422,{error:'Could not prepare this page preview.'})}
  return;
 }
 if(url.pathname==='/api/playlist'){
  if(request.method!=='POST'){send(response,405,{error:'Use POST to discover a video list.'});return}
  if(!allowPlaylist(request)){send(response,429,{error:'Too many video-list requests. Wait a minute and retry.'});return}
  try{
   const payload=await readJson(request);
   if(typeof payload.url!=='string'||payload.url.length>2048){send(response,400,{error:'Provide a video-list URL shorter than 2048 characters.'});return}
   const start=payload.start??1;
   if(!Number.isSafeInteger(start)||start<1||start>maxPlaylistItems||((start-1)%playlistPageSize)!==0){send(response,400,{error:`Playlist position must start at 1 and advance in groups of ${playlistPageSize}, up to ${maxPlaylistItems-playlistPageSize+1}.`});return}
   const url=new URL(payload.url);
   const collection=await extractVideoCollection(payload.url,{start});
   const media=collection.media.map((entry,index)=>({...entry,position:start-1+index}));
   send(response,200,{
    title:videoCollectionTitle(payload.url)||url.hostname,
    canonicalUrl:payload.url,
    media,
    start:collection.start,
    hasMore:collection.hasMore,
    playlistPaging:collection.playlistPaging,
    truncated:collection.truncated,
    ...(collection.warning?{mediaWarning:'Some media could not be loaded.'}:{})
   });
  }catch(error){console.warn('Additional media lookup failed:',error);send(response,error.status||422,{error:'Could not load media from this link.'})}
  return;
 }
 if(url.pathname==='/api/video/resolve'){
  if(request.method!=='POST'){send(response,405,{error:'Use POST to resolve a video URL.'});return}
  if(!allowPreview(request)){send(response,429,{error:'Too many preview requests. Wait a minute and retry.'});return}
  try{
   const payload=await readJson(request);
   if(typeof payload.url!=='string'||payload.url.length>2048){send(response,400,{error:'Provide a video URL shorter than 2048 characters.'});return}
   send(response,200,{media:await resolveVideo(payload.url)});
  }catch(error){console.warn('Video preparation failed:',error);send(response,error.status||422,{error:'Could not prepare this video.'})}
  return;
 }
 if(url.pathname==='/api/video/download'){
  if(request.method!=='GET'){send(response,405,{error:'Use GET to download a video.'});return}
  if(!allowDownload(request)){send(response,429,{error:'Too many downloads. Wait a minute and retry.'});return}
  let child;
  try{
   const mediaUrl=url.searchParams.get('url')||'';
   if(mediaUrl.length>2048){send(response,400,{error:'Provide a video URL shorter than 2048 characters.'});return}
   const requestedFormat=url.searchParams.get('format')||'';
   if(requestedFormat&&!/^[\w.+-]{1,80}$/.test(requestedFormat)){send(response,400,{error:'The selected video quality is invalid.'});return}
   const media=await resolveVideo(mediaUrl);
   const selectedFormat=requestedFormat?media.formatOptions?.find(format=>format.formatId===requestedFormat):null;
   if(requestedFormat&&!selectedFormat){send(response,400,{error:'That video quality is no longer available. Find the media again and choose a listed quality.'});return}
   child=await startVideoDownload(mediaUrl,selectedFormat?.formatId||media.formatId);
   const downloadTitle=(url.searchParams.get('title')||media.alt||'video').slice(0,240);
   const extension=selectedFormat?.extension||media.extension;
   const filename=safeDownloadFilename(`${downloadTitle}.${extension}`);
   const contentTypes={mp4:'video/mp4',webm:'video/webm',mov:'video/quicktime'};
   response.writeHead(200,{'content-type':contentTypes[extension]||'application/octet-stream','content-disposition':`attachment; filename="${filename.replace(/["\\]/g,'_')}"; filename*=UTF-8''${encodeURIComponent(filename)}`,'cache-control':'no-store','x-content-type-options':'nosniff','referrer-policy':'no-referrer'});
   response.on('close',()=>{if(!response.writableFinished)child.kill()});
   child.stdout.pipe(response);
   child.on('error',error=>{console.error('Video download process failed:',error);response.destroy(error)});
   child.on('close',code=>{if((code!==0||child.videoDownloadTimedOut)&&!response.writableFinished)response.destroy(new Error(child.videoDownloadTimedOut?'The video download timed out.':`yt-dlp video download exited with status ${code}.`))});
  }catch(error){
   if(child)child.kill();
   if(response.headersSent)response.destroy(error);else send(response,error.status||422,{error:error.message||'Video download failed.'});
  }
  return;
 }
 if(url.pathname==='/api/pixiv-image'){
  if(request.method!=='GET'){send(response,405,{error:'Use GET to display a Pixiv image.'});return}
  if(!allowPixivImage(request)){send(response,429,{error:'Too many Pixiv image requests. Wait a minute and retry.'});return}
  const mediaUrl=url.searchParams.get('url')||'';
  if(mediaUrl.length>2048||!isPixivImageUrl(mediaUrl)){send(response,400,{error:'Provide a valid Pixiv image CDN URL.'});return}
  try{
   const result=await openPublicMedia(mediaUrl);
   if(!result.contentType.startsWith('image/')){result.stream.destroy();send(response,415,{error:'The Pixiv CDN did not return an image.'});return}
   const headers={'content-type':result.contentType,'cache-control':'private, max-age=300','x-content-type-options':'nosniff','referrer-policy':'no-referrer','content-security-policy':"default-src 'none'; sandbox"};
   if(/^\d+$/.test(String(result.contentLength||'')))headers['content-length']=result.contentLength;
   response.writeHead(200,headers);
   response.on('close',()=>{if(!response.writableFinished)result.stream.destroy()});
   result.stream.on('error',error=>{console.error('Pixiv image stream failed:',error);response.destroy(error)});
   result.stream.pipe(response);
  }catch(error){if(response.headersSent){response.destroy(error)}else send(response,error.status||422,{error:error.message||'Pixiv image fetch failed.'})}
  return;
 }
 if(url.pathname==='/api/download'){
  if(!['GET','POST'].includes(request.method)){send(response,405,{error:'Use GET or POST to download media.'});return}
  if(!allowDownload(request)){send(response,429,{error:'Too many downloads. Wait a minute and retry.'});return}
  try{
   const mediaUrl=request.method==='GET'?url.searchParams.get('url'):((await readJson(request)).url);
   if(typeof mediaUrl!=='string'||mediaUrl.length>2048){send(response,400,{error:'Provide a valid media URL shorter than 2048 characters.'});return}
   const result=await openPublicMedia(mediaUrl);
   let filename=safeDownloadFilename(result.filename);
   const extensions={'image/jpeg':'.jpg','image/png':'.png','image/gif':'.gif','image/webp':'.webp','image/avif':'.avif','image/svg+xml':'.svg','video/mp4':'.mp4','video/webm':'.webm','video/quicktime':'.mov','audio/mpeg':'.mp3','audio/mp4':'.m4a','audio/ogg':'.ogg','audio/wav':'.wav'};
   if(!path.extname(filename)&&extensions[result.contentType])filename+=extensions[result.contentType];
   const headers={'content-type':result.contentType,'content-disposition':`attachment; filename="${filename.replace(/["\\]/g,'_')}"; filename*=UTF-8''${encodeURIComponent(filename)}`,'cache-control':'no-store','x-content-type-options':'nosniff','referrer-policy':'no-referrer'};
   if(/^\d+$/.test(String(result.contentLength||'')))headers['content-length']=result.contentLength;
   response.writeHead(200,headers);
   response.on('close',()=>{if(!response.writableFinished)result.stream.destroy()});
   result.stream.on('error',error=>{console.error('Media download stream failed:',error);response.destroy(error)});
   result.stream.pipe(response);
  }catch(error){if(response.headersSent){response.destroy(error)}else send(response,error.status||422,{error:error.message||'Media download failed.'})}
  return;
 }
 if(request.method!=='GET'&&request.method!=='HEAD'){response.writeHead(405,{'allow':'GET, HEAD'}).end();return}
 if(request.method==='HEAD'){const fake={writeHead:(...args)=>response.writeHead(...args),end:(...args)=>response.end(...args)};await serveStatic(url.pathname,fake);return}
 await serveStatic(url.pathname,response);
});

server.listen(port,host,()=>console.log(`Grabit server listening on http://${host}:${port}`));
server.on('error',error=>{console.error('Grabit server failed to start:',error);process.exitCode=1});
