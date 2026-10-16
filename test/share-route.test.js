import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {createServer} from 'node:net';
import {once} from 'node:events';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {PDFDocument} from 'pdf-lib';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');

async function availablePort(){
 const listener=createServer();
 listener.listen(0,'127.0.0.1');
 await once(listener,'listening');
 const {port}=listener.address();
 await new Promise((resolve,reject)=>listener.close(error=>error?reject(error):resolve()));
 return port;
}

async function startServer(t){
 const port=await availablePort();
 const child=spawn(process.execPath,['server.js'],{cwd:root,env:{...process.env,HOST:'127.0.0.1',PORT:String(port)},stdio:'ignore'});
 t.after(async()=>{
  if(child.exitCode!==null)return;
  child.kill();
  await once(child,'close');
 });
 const baseUrl=`http://127.0.0.1:${port}`;
 const deadline=Date.now()+10_000;
 while(Date.now()<deadline){
  if(child.exitCode!==null)throw new Error(`Grabit server exited with code ${child.exitCode}`);
  try{if((await fetch(`${baseUrl}/api/health`)).ok)return baseUrl}catch{}
  await new Promise(resolve=>setTimeout(resolve,100));
 }
 throw new Error('Grabit server did not start in time.');
}

test('serves the local backup validator module to the application',async t=>{
 const baseUrl=await startServer(t);
 const response=await fetch(`${baseUrl}/js/backup.js`);
 assert.equal(response.status,200);
 assert.match(response.headers.get('content-type'),/javascript/);
 assert.match(await response.text(),/inspectLibraryBackup/);
});

test('serves the content-type filter module to the application',async t=>{
 const baseUrl=await startServer(t);
 const response=await fetch(`${baseUrl}/js/library-filter.js`);
 assert.equal(response.status,200);
 assert.match(response.headers.get('content-type'),/javascript/);
 assert.match(await response.text(),/matchesContentType/);
});

test('serves the local video converter and its WebAssembly assets',async t=>{
 const baseUrl=await startServer(t);
 for(const file of ['video-transcoder.js']){
  const response=await fetch(`${baseUrl}/js/${file}`);
  assert.equal(response.status,200);
  assert.match(response.headers.get('content-type'),/javascript/);
  assert.match(await response.text(),/transcodeForBrowser/);
 }
 const worker=await fetch(`${baseUrl}/vendor/ffmpeg/ffmpeg/worker.js`);
 assert.equal(worker.status,200);
 assert.match(worker.headers.get('content-type'),/javascript/);
 const core=await fetch(`${baseUrl}/vendor/ffmpeg/core/ffmpeg-core.wasm`,{method:'HEAD'});
 assert.equal(core.status,200);
 assert.match(core.headers.get('content-type'),/application\/wasm/);
 const coreBytes=await fetch(`${baseUrl}/vendor/ffmpeg/core/ffmpeg-core.wasm`);
 assert.equal(coreBytes.status,200);
 const hash=createHash('sha256').update(Buffer.from(await coreBytes.arrayBuffer())).digest('hex');
 assert.equal(hash,'9f57947a5bd530d8f00c5b3f2cb2a3492faa7e5d823315342d6a8656d0a6b7b7');
 const coreModule=await fetch(`${baseUrl}/vendor/ffmpeg/core/ffmpeg-core.js`);
 assert.equal(coreModule.status,200);
 assert.match(coreModule.headers.get('content-type'),/javascript/);
 assert.match(await coreModule.text(),/createFFmpegCore/);
 const notice=await fetch(`${baseUrl}/THIRD-PARTY-NOTICES.txt`);
 assert.equal(notice.status,200);
 assert.match(await notice.text(),/GPL-2\.0-or-later/);
});

test('share routes accept and return opaque ciphertext only, then consume it',async t=>{
 const baseUrl=await startServer(t);
 const invalidPixivImage=await fetch(`${baseUrl}/api/pixiv-image?url=${encodeURIComponent('https://images.example/image.jpg')}`);
 assert.equal(invalidPixivImage.status,400);
 assert.match((await invalidPixivImage.json()).error,/Pixiv image CDN URL/);
 const invalidUgoira=await fetch(`${baseUrl}/api/pixiv-ugoira?url=${encodeURIComponent('https://images.example/animation.zip')}`);
 assert.equal(invalidUgoira.status,400);
 assert.match((await invalidUgoira.json()).error,/Pixiv animation archive URL/);
 const emptyPdf=await fetch(`${baseUrl}/api/pdf`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({images:[]})});
 assert.equal(emptyPdf.status,400);
 assert.match((await emptyPdf.json()).error,/Select at least one image/);
 const imageData='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jDf0AAAAASUVORK5CYII=';
 const galleryPdf=await fetch(`${baseUrl}/api/pdf`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({images:[{data:imageData}]})});
 assert.equal(galleryPdf.status,200);
 assert.equal(galleryPdf.headers.get('content-type'),'application/pdf');
 const parsedPdf=await PDFDocument.load(Buffer.from(await galleryPdf.arrayBuffer()));
 assert.equal(parsedPdf.getPages().length,1);
 const largeGalleryPdf=await fetch(`${baseUrl}/api/pdf`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({images:Array.from({length:201},()=>({data:imageData}))})});
 assert.equal(largeGalleryPdf.status,200);
 const parsedLargeGalleryPdf=await PDFDocument.load(Buffer.from(await largeGalleryPdf.arrayBuffer()));
 assert.equal(parsedLargeGalleryPdf.getPages().length,201);

 const plaintext='private-library-content-must-not-be-stored';
 const plaintextResponse=await fetch(`${baseUrl}/api/shares`,{
  method:'POST',
  headers:{'content-type':'application/json'},
  body:JSON.stringify({plaintext})
 });
 assert.equal(plaintextResponse.status,415);
 assert.match((await plaintextResponse.json()).error,/encrypted in the browser/);

 const invalidFormat=await fetch(`${baseUrl}/api/video/download?url=https%3A%2F%2Fvideo.example%2Fwatch&format=..%2Fbad`);
 assert.equal(invalidFormat.status,400);
 assert.match((await invalidFormat.json()).error,/quality is invalid/);

 const ciphertext=Buffer.from([0,2,4,8,16,32,64,128,...Buffer.from('opaque-ciphertext-not-plaintext')]);
 const created=await fetch(`${baseUrl}/api/shares`,{
  method:'POST',
  headers:{'content-type':'application/octet-stream'},
  body:ciphertext
 });
 assert.equal(created.status,201);
 const {id}=await created.json();
 assert.match(id,/^[A-Za-z0-9_-]{12}$/);

 const retrieved=await fetch(`${baseUrl}/api/shares/${id}`);
 assert.equal(retrieved.headers.get('content-type'),'application/octet-stream');
 assert.equal(retrieved.headers.get('cache-control'),'no-store');
 assert.deepEqual(Buffer.from(await retrieved.arrayBuffer()),ciphertext);

 const consumed=await fetch(`${baseUrl}/api/shares/${id}`,{method:'DELETE'});
 assert.equal(consumed.status,204);
 assert.equal((await fetch(`${baseUrl}/api/shares/${id}`)).status,404);
});
