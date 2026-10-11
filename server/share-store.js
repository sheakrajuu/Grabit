import {randomBytes} from 'node:crypto';

export const SHARE_TTL_MS=5*60*1000;
export const MAX_SHARE_BYTES=30*1024*1024;
const MAX_ACTIVE_SHARE_BYTES=128*1024*1024;

export function createShareStore({now=Date.now,idGenerator=()=>randomBytes(12).toString('base64url'),ttlMs=SHARE_TTL_MS,maxActiveBytes=MAX_ACTIVE_SHARE_BYTES}={}){
 const shares=new Map();
 let activeBytes=0;

 function remove(id,entry){
  if(shares.get(id)!==entry)return;
  clearTimeout(entry.timer);
  shares.delete(id);
  activeBytes-=entry.bytes;
 }

 function removeExpired(){
  for(const [id,entry] of shares)if(entry.expiresAt<=now())remove(id,entry);
 }

 return{
  create(data,bytes){
   removeExpired();
   if(!Number.isSafeInteger(bytes)||bytes<0||bytes>MAX_SHARE_BYTES)throw Object.assign(new Error('Shared library exceeds the 30 MB limit.'),{status:413});
   if(activeBytes+bytes>maxActiveBytes)throw Object.assign(new Error('Share storage is temporarily full. Wait a few minutes and try again.'),{status:503});
   let id;
   do{id=idGenerator()}while(shares.has(id));
   const entry={data,bytes,expiresAt:now()+ttlMs,timer:null};
   entry.timer=setTimeout(()=>remove(id,entry),ttlMs);
   entry.timer.unref?.();
   shares.set(id,entry);
   activeBytes+=bytes;
   return{id,expiresAt:entry.expiresAt};
  },
  get(id){
   const entry=shares.get(id);
   if(!entry)return null;
   if(entry.expiresAt<=now()){remove(id,entry);return null}
   return entry.data;
  },
  get size(){return shares.size}
 };
}
