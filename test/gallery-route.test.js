import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {createServer} from 'node:net';
import {once} from 'node:events';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import yazl from 'yazl';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');

async function availablePort(){
 const listener=createServer();listener.listen(0,'127.0.0.1');await once(listener,'listening');
 const {port}=listener.address();await new Promise((resolve,reject)=>listener.close(error=>error?reject(error):resolve()));return port;
}

async function startServer(t){
 const port=await availablePort(),directory=await mkdtemp(path.join(os.tmpdir(),'grabit-gallery-'));
 const child=spawn(process.execPath,['server.js'],{cwd:root,env:{...process.env,HOST:'127.0.0.1',PORT:String(port),GALLERY_UPLOAD_DIR:directory},stdio:'ignore'});
 t.after(async()=>{if(child.exitCode===null){child.kill();await once(child,'close')}await rm(directory,{recursive:true,force:true})});
 const baseUrl=`http://127.0.0.1:${port}`,deadline=Date.now()+10_000;
 while(Date.now()<deadline){if(child.exitCode!==null)throw new Error(`Grabit server exited with code ${child.exitCode}`);try{if((await fetch(`${baseUrl}/api/health`)).ok)return baseUrl}catch{}await new Promise(resolve=>setTimeout(resolve,100))}
 throw new Error('Grabit server did not start in time.');
}

test('server gallery accepts safe documents and serves them as attachments',async t=>{
 const baseUrl=await startServer(t),bytes=Buffer.from('sample comic archive');
 const uploaded=await fetch(`${baseUrl}/api/gallery/files?name=${encodeURIComponent('My comic.cbz')}`,{method:'POST',headers:{'content-type':'application/octet-stream','x-file-content-type':'application/vnd.comicbook+zip'},body:bytes});
 assert.equal(uploaded.status,201);
 const file=await uploaded.json();assert.equal(file.name,'My comic.cbz');assert.equal(file.size,bytes.length);
 const listing=await fetch(`${baseUrl}/api/gallery/files`);assert.deepEqual((await listing.json()).files.map(entry=>entry.id),[file.id]);
 const download=await fetch(`${baseUrl}${file.url}`);assert.equal(download.status,200);assert.match(download.headers.get('content-disposition'),/attachment/);assert.deepEqual(Buffer.from(await download.arrayBuffer()),bytes);
});

test('server gallery accepts arbitrary file extensions and rejects invalid methods',async t=>{
 const baseUrl=await startServer(t);
 const uploaded=await fetch(`${baseUrl}/api/gallery/files?name=archive.custom`,{method:'POST',headers:{'content-type':'application/octet-stream'},body:'custom file'});
 assert.equal(uploaded.status,201);
 assert.equal((await fetch(`${baseUrl}/api/gallery/files`,{method:'DELETE'})).status,405);
});

test('CBZ uploads unpack image entries into a grouped server gallery',async t=>{
 const baseUrl=await startServer(t),zip=new yazl.ZipFile(),chunks=[];
 zip.outputStream.on('data',chunk=>chunks.push(chunk));
 const archiveReady=new Promise((resolve,reject)=>{zip.outputStream.on('end',()=>resolve(Buffer.concat(chunks)));zip.outputStream.on('error',reject)});
 zip.addBuffer(Buffer.from('first page'),'pages/1.jpg');zip.addBuffer(Buffer.from('second page'),'pages/2.png');zip.addBuffer(Buffer.from('skip me'),'notes/readme.txt');zip.end();
 const archive=await archiveReady;
 const response=await fetch(`${baseUrl}/api/gallery/files?name=sample.cbz`,{method:'POST',headers:{'content-type':'application/octet-stream','x-file-content-type':'application/vnd.comicbook+zip'},body:archive});
 assert.equal(response.status,201);
 const source=await response.json();assert.equal(source.galleryPageCount,2);assert.equal(source.gallerySource,true);assert.equal(source.pages.length,2);
 const listing=await fetch(`${baseUrl}/api/gallery/files`),files=(await listing.json()).files,pages=files.filter(file=>file.galleryId===source.id&&file.galleryPage);
 assert.equal(pages.length,2);assert.deepEqual(pages.map(page=>page.entryName).sort(),['1.jpg','2.png']);
 const jpgPage=pages.find(page=>page.name==='1.jpg'),pageResponse=await fetch(`${baseUrl}${jpgPage.url}`);assert.equal(pageResponse.headers.get('content-type'),'image/jpeg');assert.match(pageResponse.headers.get('content-disposition'),/inline/);
});

test('CBZ uploads create galleries with more than 300 image pages',async t=>{
 const baseUrl=await startServer(t),zip=new yazl.ZipFile(),chunks=[];
 zip.outputStream.on('data',chunk=>chunks.push(chunk));
 const archiveReady=new Promise((resolve,reject)=>{zip.outputStream.on('end',()=>resolve(Buffer.concat(chunks)));zip.outputStream.on('error',reject)});
 for(let page=1;page<=301;page++)zip.addBuffer(Buffer.from(`page ${page}`),`pages/${String(page).padStart(3,'0')}.jpg`);
 zip.end();
 const archive=await archiveReady,response=await fetch(`${baseUrl}/api/gallery/files?name=large.cbz`,{method:'POST',headers:{'content-type':'application/octet-stream'},body:archive});
 assert.equal(response.status,201);
 const gallery=await response.json();assert.equal(gallery.galleryPageCount,301,JSON.stringify(gallery));assert.equal(gallery.pages.length,301);
});