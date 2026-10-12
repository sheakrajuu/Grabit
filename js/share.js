const MAX_SHARE_URL_LENGTH=900_000;
const MAX_LIBRARY_BYTES=30*1024*1024;
const SHARE_KEY='grabit-share';
const SHARE_ID_KEY='grabit-share-id';
const SHARE_ID_PATTERN=/^[A-Za-z0-9_-]{16}$/;

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

export function createItemShareData(data,itemId){
 validateLibraryData(data);
 const item=data.items.find(entry=>entry?.id===itemId);
 if(!item)throw new Error('This library item is no longer available.');
 return{...data,sections:[],items:[shareableItem(item)]};
}

export function createItemsShareData(data,itemIds){
 validateLibraryData(data);
 const ids=[...new Set(itemIds)];
 if(!ids.length)throw new Error('Select at least one library item to share.');
 const byId=new Map(data.items.map(item=>[item?.id,item]));
 const items=ids.map(id=>byId.get(id));
 if(items.some(item=>!item))throw new Error('A selected library item is no longer available.');
 return{...data,sections:[],items:items.map(shareableItem)};
}

function shareableItem(item){
 const {tags,...cleanItem}=item;
 return{...cleanItem,sectionIds:[],inbox:true,hiddenFromInbox:false};
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

export async function createShortLibraryShareLink(data,currentUrl){
 validateLibraryData(data);
 const body=JSON.stringify(data);
 if(new TextEncoder().encode(body).length>MAX_LIBRARY_BYTES)throw new Error('This library is too large for a share link. Use the JSON export instead.');
 const response=await fetch(new URL('/api/shares',currentUrl),{method:'POST',headers:{'content-type':'application/json'},body,cache:'no-store'});
 let result;
 try{result=await response.json()}catch{throw new Error('The share service returned an invalid response.')}
 if(!response.ok)throw new Error(result.error||'Could not create a short share link.');
 if(typeof result.id!=='string'||!SHARE_ID_PATTERN.test(result.id))throw new Error('The share service returned an invalid share link.');
 const url=new URL(`/s/${result.id}`,currentUrl);
 url.search='';
 url.hash='';
 return url.href;
}

function shortShareEndpoint(value){
 const url=new URL(value,globalThis.location?.href||'http://localhost/');
 const pathMatch=url.pathname.match(/^\/s\/([A-Za-z0-9_-]{16})\/?$/);
 const params=new URLSearchParams(url.hash.slice(1));
 const shareId=pathMatch?.[1]||params.get(SHARE_ID_KEY);
 if(!shareId||!SHARE_ID_PATTERN.test(shareId))throw new Error('This is not a valid Grabit share link.');
 return new URL(`/api/shares/${shareId}`,url.origin);
}

export function isShortLibraryShareLink(value){
 try{
  const url=new URL(value,globalThis.location?.href||'http://localhost/');
  return /^\/s\/[A-Za-z0-9_-]{16}\/?$/.test(url.pathname)||new URLSearchParams(url.hash.slice(1)).has(SHARE_ID_KEY);
 }catch{return false}
}

export async function consumeShortLibraryShareLink(value){
 const response=await fetch(shortShareEndpoint(value),{method:'DELETE',cache:'no-store'});
 if(!response.ok)throw new Error('The share link could not be marked as used.');
}

export function hasLibraryShareLink(value){
 try{
  const base=globalThis.location?.href||'http://localhost/';
  const url=new URL(value,base);
  const params=new URLSearchParams(url.hash.slice(1));
  return params.has(SHARE_KEY)||params.has(SHARE_ID_KEY)||/^\/s\/[A-Za-z0-9_-]{16}\/?$/.test(url.pathname);
 }catch{return false}
}

export async function readLibraryShareLink(value){
 let url,hash;
 try{
  url=new URL(value,globalThis.location?.href||'http://localhost/');
  hash=value.startsWith('#')?value.slice(1):url.hash.slice(1);
 }catch{
  throw new Error('Enter a complete Grabit share link.');
 }
 const params=new URLSearchParams(hash),token=params.get(SHARE_KEY);
 let shareId=params.get(SHARE_ID_KEY);
 if(!shareId){
  const shortPath=url.pathname.match(/^\/s\/([A-Za-z0-9_-]{16})\/?$/);
  if(shortPath)shareId=shortPath[1];
 }
 if(shareId){
  if(!SHARE_ID_PATTERN.test(shareId))throw new Error('This is not a valid Grabit share link.');
  const response=await fetch(shortShareEndpoint(value),{cache:'no-store'});
  let result;
  try{result=await response.json()}catch{throw new Error('The share service returned an invalid response.')}
  if(!response.ok)throw new Error(result.error||'This share link is unavailable.');
  return validateLibraryData(result);
 }
 if(!token)throw new Error('This is not a Grabit share link.');
 if(typeof DecompressionStream!=='function')throw new Error('Compressed share links are not supported by this browser. Use the JSON export instead.');
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
