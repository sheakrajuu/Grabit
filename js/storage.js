import {uid,host,normalized} from './utils.js';

const DB_NAME='grabit-library';const DB_VERSION=1;
let db;
const V={view:'all',sectionId:null,tag:null,q:'',type:'all',sort:'recent',selectMode:false,selected:new Set(),mediaIndex:0,items:[],sections:[]};
const icon=d=>`<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${d}"/></svg>`;
const icons={all:'M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z',inbox:'M3 12h5l1 2h6l1-2h5M5 5h14l2 7v7H3v-7z',star:'M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z',recent:'M3 12a9 9 0 1 0 3-6.7M3 4v5h5m4-1v5l3 2',archive:'M3 5h18v4H3zM5 9v11h14V9m-9 4h4',section:'M3 5h18v15H3zM3 9h18M7 5V3h10v2'};
function request(req){return new Promise((resolve,reject)=>{req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error||new Error('Database request failed'))})}
function txDone(tx){return new Promise((resolve,reject)=>{tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error||new Error('Database transaction aborted'));tx.onerror=()=>reject(tx.error||new Error('Database transaction failed'))})}
function openDB(){
 return new Promise((resolve,reject)=>{
  if(!('indexedDB'in window)){reject(new Error('IndexedDB is unavailable in this browser. Your library cannot be saved here.'));return}
  const req=indexedDB.open(DB_NAME,DB_VERSION);
  req.onupgradeneeded=()=>{const d=req.result;const items=d.createObjectStore('items',{keyPath:'id'});items.createIndex('canonicalUrl','canonicalUrl',{unique:false});items.createIndex('savedAt','savedAt',{unique:false});items.createIndex('type','type',{unique:false});d.createObjectStore('sections',{keyPath:'id'});d.createObjectStore('meta',{keyPath:'key'})};
  req.onsuccess=()=>{db=req.result;resolve(db)};req.onerror=()=>reject(req.error||new Error('Could not open the local library'));req.onblocked=()=>reject(new Error('The library database is blocked by another open tab. Close other Grabit tabs and retry.'));
 });
}
async function migrateLegacy(){
 const tx=db.transaction(['meta','items','sections'],'readwrite');const meta=tx.objectStore('meta');
 if(await request(meta.get('legacy-localstorage-migrated'))){await txDone(tx);return}
 let legacy=null;try{legacy=JSON.parse(localStorage.getItem('lib1')||'null')}catch(e){console.warn('Could not parse the previous Grabit library:',e)}
 if(legacy&&Array.isArray(legacy.items)){
  const items=tx.objectStore('items');const sections=tx.objectStore('sections');const hasOrganized=legacy.items.some(item=>item?.o);
  if(hasOrganized){await request(sections.put({id:'legacy-organized',name:'Organized',description:'Items migrated from the earlier organized library.',coverImage:'',position:0,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()}))}
  for(const old of legacy.items){
   if(!old||!old.id)continue;
   const url=old.url||'';
   const type=old.type==='URL'?'bookmark':old.type==='NOTE'?'note':old.type==='MP4'?'video':old.type==='JPG'?'image':'bookmark';
   const record={id:String(old.id),type,title:String(old.title||'Untitled'),description:'',notes:String(old.text||''),sourceUrl:url,originalUrl:url,canonicalUrl:normalized(url),sourceDomain:host(url),thumbnailUrl:old.img||'',media:old.img?[{id:uid(),type:'image',sourceUrl:old.img,storedDataUrl:old.img,position:0}]:[],tags:Array.isArray(old.tags)?old.tags.map(String):[],sectionIds:old.o?['legacy-organized']:[],isFavorite:!!old.s,isArchived:!!old.t,inbox:!old.o,savedAt:new Date().toISOString(),updatedAt:new Date().toISOString()};
   await request(items.put(record));
  }
 }
 await request(meta.put({key:'legacy-localstorage-migrated',value:true}));await txDone(tx);
}
async function loadLibrary(){
 const tx=db.transaction(['items','sections'],'readonly');
 const [items,sections]=await Promise.all([request(tx.objectStore('items').getAll()),request(tx.objectStore('sections').getAll())]);await txDone(tx);
 return{items,sections:sections.sort((a,b)=>(a.position||0)-(b.position||0))};
}
async function storeItem(item){const tx=db.transaction('items','readwrite');await request(tx.objectStore('items').put(item));await txDone(tx)}
async function storeSection(section){const tx=db.transaction('sections','readwrite');await request(tx.objectStore('sections').put(section));await txDone(tx)}
async function removeItem(id){const tx=db.transaction('items','readwrite');await request(tx.objectStore('items').delete(id));await txDone(tx)}
async function removeSection(id){const tx=db.transaction(['sections','items'],'readwrite');await request(tx.objectStore('sections').delete(id));const all=await request(tx.objectStore('items').getAll());for(const item of all){if(item.sectionIds.includes(id)){item.sectionIds=item.sectionIds.filter(x=>x!==id);item.inbox=!item.sectionIds.length;item.updatedAt=new Date().toISOString();await request(tx.objectStore('items').put(item))}}await txDone(tx)}

export {openDB,migrateLegacy,loadLibrary,storeItem,storeSection,removeItem,removeSection};
