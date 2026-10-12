import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createServer} from 'node:net';
import {once} from 'node:events';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

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

test('share routes accept and return opaque ciphertext only, then consume it',async t=>{
 const baseUrl=await startServer(t);
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
 assert.match(id,/^[A-Za-z0-9_-]{16}$/);

 const retrieved=await fetch(`${baseUrl}/api/shares/${id}`);
 assert.equal(retrieved.headers.get('content-type'),'application/octet-stream');
 assert.equal(retrieved.headers.get('cache-control'),'no-store');
 assert.deepEqual(Buffer.from(await retrieved.arrayBuffer()),ciphertext);

 const consumed=await fetch(`${baseUrl}/api/shares/${id}`,{method:'DELETE'});
 assert.equal(consumed.status,204);
 assert.equal((await fetch(`${baseUrl}/api/shares/${id}`)).status,404);
});
