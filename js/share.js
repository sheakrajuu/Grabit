const MAX_SHARE_URL_LENGTH=900_000;
const MAX_LIBRARY_BYTES=30*1024*1024;
const SHARE_KEY='grabit-share';

function encodeBase64Url(bytes){
 let binary='';
 for(let offset=0;offset<bytes.length;offset+=0x8000){
  binary+=String.fromCharCode(...bytes.subarray(offset,offset+0x8000));
 }
 return btoa(binary).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'');
}

function decodeBase64Url(value){
 if(!/^[A-Za-z0-9_-]+$/.test(value))throw new Error('The share link contains invalid data.');
 const base64=value.replaceAll('-','+').replaceAll('_','/');
 const binary=atob(base64.padEnd(Math.ceil(base64.length/4)*4,'='));
 return Uint8Array.from(binary,character=>character.charCodeAt(0));
}

function validateLibraryData(data){
 if(data?.format!=='grabit-library'||data.version!==1||!Array.isArray(data.items)||!Array.isArray(data.sections)){
  throw new Error('This link does not contain a supported Grabit library.');
 }
 return data;
}

export async function createLibraryShareLink(data,currentUrl){
 validateLibraryData(data);
 if(typeof CompressionStream!=='function')throw new Error('Compressed share links are not supported by this browser. Use the JSON export instead.');
 const bytes=new TextEncoder().encode(JSON.stringify(data));
 if(bytes.length>MAX_LIBRARY_BYTES)throw new Error('This library is too large for a share link. Use the JSON export instead.');
 const compressed=await new Response(new Blob([bytes]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer();
 const token=encodeBase64Url(new Uint8Array(compressed));
 const url=new URL(currentUrl);
 for(const key of ['watch','page','media','scroll'])url.searchParams.delete(key);
 url.hash=new URLSearchParams([[SHARE_KEY,token]]).toString();
 if(url.href.length>MAX_SHARE_URL_LENGTH)throw new Error('This library makes a share link that is too large to open reliably. Use the JSON export instead.');
 return url.href;
}

export function hasLibraryShareLink(value){
 try{
  const url=value.startsWith('#')?null:new URL(value);
  const hash=value.startsWith('#')?value.slice(1):url?.hash.slice(1);
  return new URLSearchParams(hash||'').has(SHARE_KEY);
 }catch{return false}
}

export async function readLibraryShareLink(value){
 if(typeof DecompressionStream!=='function')throw new Error('Compressed share links are not supported by this browser. Use the JSON export instead.');
 let hash;
 try{
  hash=value.startsWith('#')?value.slice(1):new URL(value).hash.slice(1);
 }catch{
  throw new Error('Enter a complete Grabit share link.');
 }
 const token=new URLSearchParams(hash).get(SHARE_KEY);
 if(!token)throw new Error('This is not a Grabit share link.');
 if(token.length>MAX_SHARE_URL_LENGTH)throw new Error('The share link is too large to import.');
 const compressed=decodeBase64Url(token),reader=new Blob([compressed]).stream().pipeThrough(new DecompressionStream('gzip')).getReader();
 const chunks=[];
 let length=0;
 try{
  while(true){
   const {done,value:chunk}=await reader.read();
   if(done)break;
   length+=chunk.length;
   if(length>MAX_LIBRARY_BYTES){
    await reader.cancel();
    throw new Error('The shared library exceeds the 30 MB import limit.');
   }
   chunks.push(chunk);
  }
 }finally{
  reader.releaseLock();
 }
 const bytes=new Uint8Array(length);
 let offset=0;
 for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length}
 let data;
 try{data=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes))}catch{
  throw new Error('The share link contains invalid or incomplete library data.');
 }
 return validateLibraryData(data);
}
