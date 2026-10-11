import http from 'node:http';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {extractPage,openPublicMedia,safeDownloadFilename} from './server/extractor.js';
import {extractVideoCollection,isVideoCollectionUrl} from './server/playlist.js';
import {videoCollectionTitle} from './js/utils.js';

const root=path.dirname(fileURLToPath(import.meta.url));
const host=process.env.HOST||(process.env.PORT?'0.0.0.0':'127.0.0.1');
const port=Number(process.env.PORT||3000);
const MAX_BODY_BYTES=16*1024;
const RATE_WINDOW_MS=60_000;
const MAX_PREVIEWS_PER_WINDOW=12;
const MAX_DOWNLOADS_PER_WINDOW=20;
const buckets=new Map();
const publicFiles=new Set([
 '/library.html','/manifest.webmanifest','/service-worker.js',
 '/css/styles.css',
 '/js/app.js','/js/importer.js','/js/share.js','/js/storage.js','/js/utils.js',
 '/icons/git.svg','/icons/android/icon-192.png','/icons/android/icon-512.png','/icons/apple/AppIcon-180.png'
]);
const types={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.json':'application/json; charset=utf-8','.webmanifest':'application/manifest+json; charset=utf-8','.svg':'image/svg+xml','.png':'image/png'};

function send(response,status,payload){
 response.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff','referrer-policy':'no-referrer'});
 response.end(JSON.stringify(payload));
}

function getClientAddress(request){return request.socket.remoteAddress||'unknown'}
function allowPreview(request){
 const key=getClientAddress(request),now=Date.now();let bucket=buckets.get(key);
 if(!bucket||now-bucket.start>RATE_WINDOW_MS){bucket={start:now,count:0};buckets.set(key,bucket)}
 bucket.count++;
 if(buckets.size>5000)for(const [address,state]of buckets)if(now-state.start>RATE_WINDOW_MS)buckets.delete(address);
 return bucket.count<=MAX_PREVIEWS_PER_WINDOW;
}

function allowDownload(request){
 const key=`download:${getClientAddress(request)}`,now=Date.now();let bucket=buckets.get(key);
 if(!bucket||now-bucket.start>RATE_WINDOW_MS){bucket={start:now,count:0};buckets.set(key,bucket)}
 bucket.count++;
 return bucket.count<=MAX_DOWNLOADS_PER_WINDOW;
}

async function readJson(request){
 const chunks=[];let length=0;
 for await(const chunk of request){
  length+=chunk.length;if(length>MAX_BODY_BYTES)throw Object.assign(new Error('Request body exceeds the 16 KB limit.'),{status:413});
  chunks.push(chunk);
 }
 try{return JSON.parse(Buffer.concat(chunks).toString('utf8'))}catch{throw Object.assign(new Error('Request body must contain valid JSON.'),{status:400})}
}

async function serveStatic(pathname,response){
 let decoded;try{decoded=decodeURIComponent(pathname)}catch{response.writeHead(400).end('Bad request');return}
 const relative=decoded==='/'?'/library.html':decoded;
 if(!publicFiles.has(relative)){response.writeHead(404,{'content-type':'text/plain; charset=utf-8','x-content-type-options':'nosniff'}).end('Not found');return}
 const target=path.resolve(root,`.${relative}`);
 if(target!==root&&!target.startsWith(root+path.sep)){response.writeHead(403).end('Forbidden');return}
 let file;try{file=await import('node:fs/promises').then(fs=>fs.readFile(target))}catch{response.writeHead(404,{'content-type':'text/plain; charset=utf-8'}).end('Not found');return}
 response.writeHead(200,{'content-type':types[path.extname(target)]||'application/octet-stream','x-content-type-options':'nosniff','referrer-policy':'no-referrer','content-security-policy':"default-src 'self' data: blob:; img-src 'self' https: data:; media-src 'self' https: blob:; frame-src 'self' https://xhamster.com https://www.youtube-nocookie.com https://player.vimeo.com https://www.tiktok.com https://www.instagram.com https://platform.twitter.com https://www.facebook.com https://assets.pinterest.com; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'"});
 response.end(file);
}

const server=http.createServer(async(request,response)=>{
 const url=new URL(request.url,'http://localhost');
 if(url.pathname==='/api/health'&&request.method==='GET'){send(response,200,{ok:true});return}
 if(url.pathname==='/api/preview'){
  if(request.method!=='POST'){send(response,405,{error:'Use POST to preview a webpage.'});return}
  if(!allowPreview(request)){send(response,429,{error:'Too many preview requests. Wait a minute and retry.'});return}
  try{
   const payload=await readJson(request);
   if(typeof payload.url!=='string'||payload.url.length>2048){send(response,400,{error:'Provide a valid webpage URL shorter than 2048 characters.'});return}
   let result;
   if(isVideoCollectionUrl(payload.url)){
    const start=payload.start??1;
    if(!Number.isSafeInteger(start)||start<1||start>500||((start-1)%10)!==0){send(response,400,{error:'Playlist position must start at 1, 11, 21, and so on, up to 491.'});return}
    try{
     const collection=await extractVideoCollection(payload.url,{start});
     const media=collection.media.map((entry,index)=>({...entry,position:start-1+index}));
     result={title:videoCollectionTitle(payload.url)||new URL(payload.url).hostname,description:'',canonicalUrl:payload.url,media,mediaCount:media.length,start:collection.start,hasMore:collection.hasMore,truncated:false,refetchOnOpen:true,...(collection.warning?{mediaWarning:collection.warning}:{})};
    }catch(error){
     let page;
     try{page=await extractPage(payload.url)}catch(pageError){page={title:new URL(payload.url).hostname,description:'',canonicalUrl:payload.url,media:[],mediaCount:0,truncated:false,previewWarning:pageError.message}}
     if(!page.media?.length)throw error;
     result={...page,refetchOnOpen:true,mediaWarning:`yt-dlp could not list every video: ${error.message}`};
    }
   }else result=await extractPage(payload.url);
   send(response,200,result);
  }catch(error){send(response,error.status||422,{error:error.message||'Page extraction failed.'})}
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
