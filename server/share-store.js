import {randomBytes} from 'node:crypto';

export const MAX_SHARE_BYTES=80*1024*1024;
const MAX_ACTIVE_SHARE_BYTES=256*1024*1024;

export function createShareStore({idGenerator=()=>randomBytes(12).toString('base64url'),maxActiveBytes=MAX_ACTIVE_SHARE_BYTES}={}){
 const shares=new Map();
 let activeBytes=0;

 function remove(id,entry){
  if(shares.get(id)!==entry)return;
  shares.delete(id);
  activeBytes-=entry.bytes;
 }

 return{
  create(data,bytes){
   if(!Number.isSafeInteger(bytes)||bytes<0||bytes>MAX_SHARE_BYTES)throw Object.assign(new Error('Encrypted share exceeds the 80 MB limit.'),{status:413});
   if(activeBytes+bytes>maxActiveBytes)throw Object.assign(new Error('Share storage is temporarily full. Some links may not have been used yet.'),{status:503});
   let id;
   do{id=idGenerator()}while(shares.has(id));
   const entry={data,bytes};
   shares.set(id,entry);
   activeBytes+=bytes;
   return{id};
  },
  get(id){
   const entry=shares.get(id);
   return entry?.data??null;
  },
  consume(id){
   const entry=shares.get(id);
   if(!entry)return false;
   remove(id,entry);
   return true;
  },
  get size(){return shares.size}
 };
}
