import test from 'node:test';
import assert from 'node:assert/strict';
import {consumeShortLibraryShareLink,createItemShareData,createItemsShareData,createLibraryShareLink,createShortLibraryShareLink,hasLibraryShareLink,isShortLibraryShareLink,readLibraryShareLink} from '../js/share.js';

const library={format:'grabit-library',version:1,exportedAt:'2026-10-11T00:00:00.000Z',sections:[{id:'section-1',name:'Favorites'}],items:[{id:'item-1',type:'image',title:'Stored image',sectionIds:['section-1'],media:[{type:'image',storedDataUrl:'data:image/png;base64,AA=='}]}]};

test('creates and reads a compressed share link without changing exported library data',async()=>{
 const link=await createLibraryShareLink(library,'https://grabit.example/library.html?watch=item-1&page=2#old-route');
 assert.equal(hasLibraryShareLink(link),true);
 assert.equal(new URL(link).searchParams.has('watch'),false);
 const params=new URLSearchParams(new URL(link).hash.slice(1));
 assert.equal(params.has('grabit-share-data'),true);
 assert.equal(params.has('grabit-share-key'),true);
 assert.equal(params.has('grabit-share-iv'),true);
 assert.deepEqual(await readLibraryShareLink(link),library);
 assert.deepEqual(await readLibraryShareLink(new URL(link).hash),library);
});

test('rejects malformed, non-library, and oversized share links',async()=>{
 assert.equal(hasLibraryShareLink('https://grabit.example/#unrelated=value'),false);
 assert.equal(isShortLibraryShareLink('https://grabit.example/#grabit-share=compressed'),false);
 assert.equal(isShortLibraryShareLink('https://grabit.example/#grabit-share-id=abcdefghijklmnop'),true);
 await assert.rejects(readLibraryShareLink('https://grabit.example/#grabit-share=not-a-gzip-payload'));
 await assert.rejects(createLibraryShareLink({...library,format:'other'},'https://grabit.example/'),/supported Grabit library/);
 await assert.rejects(readLibraryShareLink(`https://grabit.example/#grabit-share=${'A'.repeat(900_001)}`),/too large/);
});

test('item share data contains only the chosen item and does not include its collections',()=>{
 const libraryData={...library,sections:[{id:'section-1',name:'Favorites'},{id:'section-2',name:'Private'}],items:[
  {...library.items[0],tags:['legacy'],sectionIds:['section-1','section-2'],hiddenFromInbox:true},
  {...library.items[0],id:'item-2',title:'Do not share'}
 ]};
 const shared=createItemShareData(libraryData,'item-1');
 assert.deepEqual(shared.items.map(item=>item.id),['item-1']);
 assert.deepEqual(shared.items[0].sectionIds,[]);
 assert.equal(shared.items[0].inbox,true);
 assert.equal(shared.items[0].hiddenFromInbox,false);
 assert.equal('tags'in shared.items[0],false);
 assert.deepEqual(shared.sections,[]);
 assert.throws(()=>createItemShareData(libraryData,'missing'),/no longer available/);
});

test('multi-item share data contains only selected items without collections or tags',()=>{
 const libraryData={...library,sections:[{id:'section-1',name:'Private'}],items:[
  {...library.items[0],tags:['legacy'],sectionIds:['section-1']},
  {...library.items[0],id:'item-2',title:'Selected item',sectionIds:['section-1']},
  {...library.items[0],id:'item-3',title:'Do not share'}
 ]};
 const shared=createItemsShareData(libraryData,['item-2','item-1']);
 assert.deepEqual(shared.sections,[]);
 assert.deepEqual(shared.items.map(item=>item.id),['item-2','item-1']);
 assert.deepEqual(shared.items.map(item=>item.sectionIds),[[],[]]);
 assert.equal(shared.items.every(item=>item.inbox),true);
 assert.equal(shared.items.every(item=>!('tags'in item)),true);
 assert.throws(()=>createItemsShareData(libraryData,['missing']),/no longer available/);
});

test('creates and reads a short server-backed share link',async()=>{
 const originalFetch=globalThis.fetch;
 let encryptedBytes;
 globalThis.fetch=async(input,options)=>{
  const url=new URL(input);
  if(options?.method==='POST'){
   assert.equal(url.pathname,'/api/shares');
   assert.equal(url.hash,'');
   assert.equal(options.headers['content-type'],'application/octet-stream');
   encryptedBytes=Buffer.from(options.body);
   assert.notDeepEqual(encryptedBytes,Buffer.from(JSON.stringify(library)));
   assert.equal(encryptedBytes.includes(Buffer.from('Stored image')),false);
   assert.equal(encryptedBytes.length>28,true);
   return new Response(JSON.stringify({id:'abcdefghijkl'}),{status:201,headers:{'content-type':'application/json'}});
  }
  assert.equal(url.pathname,'/api/shares/abcdefghijkl');
  return new Response(encryptedBytes,{headers:{'content-type':'application/octet-stream'}});
 };
 try{
  const link=await createShortLibraryShareLink(library,'https://grabit.example/library.html?watch=item-1#old-route');
  const params=new URLSearchParams(new URL(link).hash.slice(1));
  assert.equal(new URL(link).pathname,'/');
  assert.equal(params.get('s'),'abcdefghijkl');
  assert.ok(params.get('k'));
  assert.equal(params.has('v'),false);
  assert.ok(link.length<100);
  assert.equal(hasLibraryShareLink(link),true);
  assert.deepEqual(await readLibraryShareLink(link),library);
 }finally{globalThis.fetch=originalFetch}
});

test('encrypted shares preserve uploaded video data for the recipient',async()=>{
 const originalFetch=globalThis.fetch;
 const videoLibrary={...library,items:[{id:'video-1',type:'video',title:'Uploaded video',sectionIds:[],media:[{type:'video',mimeType:'video/mp4',size:4,storedDataUrl:'data:video/mp4;base64,AQIDBA=='}]}]};
 let ciphertext;
 globalThis.fetch=async(_input,options)=>{
  if(options?.method==='POST'){
   ciphertext=Buffer.from(options.body);
   assert.equal(ciphertext.includes(Buffer.from('data:video/mp4')),false);
   return new Response(JSON.stringify({id:'abcdefghijkl'}),{status:201,headers:{'content-type':'application/json'}});
  }
  return new Response(ciphertext,{headers:{'content-type':'application/octet-stream'}});
 };
 try{
  const link=await createShortLibraryShareLink(videoLibrary,'https://grabit.example/library.html');
  const imported=await readLibraryShareLink(link);
  assert.equal(imported.items[0].type,'video');
  assert.equal(imported.items[0].media[0].storedDataUrl,'data:video/mp4;base64,AQIDBA==');
 }finally{globalThis.fetch=originalFetch}
});

test('consumes a short share link only through its one-time endpoint',async()=>{
 const originalFetch=globalThis.fetch;
 const calls=[];
 globalThis.fetch=async(input,options)=>{
  calls.push({url:new URL(input),method:options?.method||'GET'});
  return new Response(null,{status:204});
 };
 try{
  await consumeShortLibraryShareLink('https://grabit.example/s/abcdefghijklmnop');
  assert.equal(calls.length,1);
  assert.equal(calls[0].url.pathname,'/api/shares/abcdefghijklmnop');
  assert.equal(calls[0].method,'DELETE');
 }finally{globalThis.fetch=originalFetch}
});

test('reports unavailable short-link responses and rejects invalid returned IDs',async()=>{
 const originalFetch=globalThis.fetch;
 globalThis.fetch=async(_input,options)=>options?.method==='POST'
  ?new Response(JSON.stringify({id:'bad'}),{status:201,headers:{'content-type':'application/json'}})
  :new Response(JSON.stringify({error:'This share link has already been used.'}),{status:404,headers:{'content-type':'application/json'}});
 try{
  await assert.rejects(readLibraryShareLink('https://grabit.example/s/abcdefghijklmnop#grabit-share-key=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA&grabit-share-iv=AAAAAAAAAAAAAAAA'),/already been used/);
  await assert.rejects(createShortLibraryShareLink(library,'https://grabit.example/'),/invalid share link/);
 }finally{globalThis.fetch=originalFetch}
});
