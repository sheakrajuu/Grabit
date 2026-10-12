const MAX_SHARE_URL_LENGTH=900_000;
const MAX_LIBRARY_BYTES=79*1024*1024;
const SHARE_KEY='grabit-share';
const SHARE_ID_KEY='grabit-share-id';
const SHORT_SHARE_ID_KEY='s';
const ENCRYPTED_DATA_KEY='grabit-share-data';
const ENCRYPTION_KEY='grabit-share-key';
const ENCRYPTION_IV='grabit-share-iv';
const SHORT_ENCRYPTION_KEY='k';
const SHORT_ENCRYPTION_IV='v';
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

function cryptoApi(){
 if(!globalThis.crypto?.subtle)throw new Error('Secure sharing is not supported by this browser.');
 return globalThis.crypto;
}

async function encryptLibraryData(data){
 validateLibraryData(data);
 const bytes=new TextEncoder().encode(JSON.stringify(data));
 if(bytes.length>MAX_LIBRARY_BYTES)throw new Error('This share exceeds the 79 MB limit.');
 const crypto=cryptoApi(),key=await crypto.subtle.generateKey({name:'AES-GCM',length:256},true,['encrypt','decrypt']);
 const iv=crypto.getRandomValues(new Uint8Array(12));
 const ciphertext=await crypto.subtle.encrypt({name:'AES-GCM',iv},key,bytes);
 return{ciphertext:new Uint8Array(ciphertext),key:encodeBase64Url(new Uint8Array(await crypto.subtle.exportKey('raw',key))),iv:encodeBase64Url(iv)};
}

async function decryptLibraryData(ciphertext,keyToken,ivToken){
 const crypto=cryptoApi();
 let keyBytes,iv;
 try{keyBytes=decodeBase64Url(keyToken);iv=decodeBase64Url(ivToken)}catch{throw new Error('This share link contains an invalid encryption key.')}
 if(keyBytes.length!==32||iv.length!==12)throw new Error('This share link contains an invalid encryption key.');
 let plaintext;
 try{
  const key=await crypto.subtle.importKey('raw',keyBytes,{name:'AES-GCM'},false,['decrypt']);
  plaintext=await crypto.subtle.decrypt({name:'AES-GCM',iv},key,ciphertext);
 }catch{throw new Error('This share could not be decrypted. Check that the complete link was copied.')}
 let data;
 try{data=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(plaintext))}catch{throw new Error('The decrypted share does not contain valid Grabit data.')}
 return validateLibraryData(data);
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
 const encrypted=await encryptLibraryData(data);
 const url=new URL(currentUrl);
 for(const key of ['watch','page','media','scroll'])url.searchParams.delete(key);
 url.hash=new URLSearchParams([[ENCRYPTED_DATA_KEY,encodeBase64Url(encrypted.ciphertext)],[ENCRYPTION_KEY,encrypted.key],[ENCRYPTION_IV,encrypted.iv]]).toString();
 if(url.href.length>MAX_SHARE_URL_LENGTH)throw new Error('This library makes a share link that is too large to open reliably. Use the JSON export instead.');
 return url.href;
}

export async function createShortLibraryShareLink(data,currentUrl){
 validateLibraryData(data);
 const encrypted=await encryptLibraryData(data);
 const response=await fetch(new URL('/api/shares',currentUrl),{method:'POST',headers:{'content-type':'application/octet-stream'},body:encrypted.ciphertext,cache:'no-store'});
 let result;
 try{result=await response.json()}catch{throw new Error('The share service returned an invalid response.')}
 if(!response.ok)throw new Error(result.error||'Could not create a short share link.');
 if(typeof result.id!=='string'||!SHARE_ID_PATTERN.test(result.id))throw new Error('The share service returned an invalid share link.');
 const url=new URL('/',currentUrl);
 url.search='';
 url.hash=new URLSearchParams([[SHORT_SHARE_ID_KEY,result.id],[SHORT_ENCRYPTION_KEY,encrypted.key],[SHORT_ENCRYPTION_IV,encrypted.iv]]).toString();
 return url.href;
}

function shortShareEndpoint(value){
 const url=new URL(value,globalThis.location?.href||'http://localhost/');
 const pathMatch=url.pathname.match(/^\/s\/([A-Za-z0-9_-]{16})\/?$/);
 const params=new URLSearchParams(url.hash.slice(1));
 const shareId=pathMatch?.[1]||params.get(SHORT_SHARE_ID_KEY)||params.get(SHARE_ID_KEY);
 if(!shareId||!SHARE_ID_PATTERN.test(shareId))throw new Error('This is not a valid Grabit share link.');
 return new URL(`/api/shares/${shareId}`,url.origin);
}

export function isShortLibraryShareLink(value){
 try{
  const url=new URL(value,globalThis.location?.href||'http://localhost/');
  const params=new URLSearchParams(url.hash.slice(1));
  return /^\/s\/[A-Za-z0-9_-]{16}\/?$/.test(url.pathname)||params.has(SHORT_SHARE_ID_KEY)||params.has(SHARE_ID_KEY);
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
  return params.has(SHARE_KEY)||params.has(ENCRYPTED_DATA_KEY)||params.has(SHORT_SHARE_ID_KEY)||params.has(SHARE_ID_KEY)||/^\/s\/[A-Za-z0-9_-]{16}\/?$/.test(url.pathname);
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
 const params=new URLSearchParams(hash),token=params.get(SHARE_KEY),encryptedToken=params.get(ENCRYPTED_DATA_KEY);
 let shareId=params.get(SHORT_SHARE_ID_KEY)||params.get(SHARE_ID_KEY);
 if(!shareId){
  const shortPath=url.pathname.match(/^\/s\/([A-Za-z0-9_-]{16})\/?$/);
  if(shortPath)shareId=shortPath[1];
 }
 if(shareId){
  if(!SHARE_ID_PATTERN.test(shareId))throw new Error('This is not a valid Grabit share link.');
  const key=params.get(SHORT_ENCRYPTION_KEY)||params.get(ENCRYPTION_KEY),iv=params.get(SHORT_ENCRYPTION_IV)||params.get(ENCRYPTION_IV);
  if(!key||!iv)throw new Error('This share link is incomplete or predates encrypted sharing. Ask the sender to create and share a new link.');
  const response=await fetch(shortShareEndpoint(value),{cache:'no-store'});
  if(!response.ok){let result={};try{result=await response.json()}catch{}throw new Error(result.error||'This share link is unavailable.')}
  const ciphertext=await response.arrayBuffer();
  if(ciphertext.byteLength>MAX_LIBRARY_BYTES+16)throw new Error('This share exceeds the 79 MB limit.');
  return decryptLibraryData(ciphertext,key,iv);
 }
 if(encryptedToken){
  const key=params.get(ENCRYPTION_KEY),iv=params.get(ENCRYPTION_IV);
  if(!key||!iv)throw new Error('This share link is incomplete or predates encrypted sharing. Ask the sender to create and share a new link.');
  if(encryptedToken.length>MAX_SHARE_URL_LENGTH)throw new Error('The share link is too large to import.');
  return decryptLibraryData(decodeBase64Url(encryptedToken),key,iv);
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
    throw new Error('The shared library exceeds the 79 MB import limit.');
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
