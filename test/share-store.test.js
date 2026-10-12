import test from 'node:test';
import assert from 'node:assert/strict';
import {createShareStore,MAX_SHARE_BYTES} from '../server/share-store.js';

test('share data does not expire and remains available until consumed once',async()=>{
 const store=createShareStore({idGenerator:()=> 'abcdefghijklmnop'});
 const created=store.create({items:[]},12);
 assert.deepEqual(created,{id:'abcdefghijklmnop'});
 assert.deepEqual(store.get(created.id),{items:[]});
 await new Promise(resolve=>setTimeout(resolve,15));
 assert.deepEqual(store.get(created.id),{items:[]});
 assert.equal(store.consume(created.id),true);
 assert.equal(store.get(created.id),null);
 assert.equal(store.consume(created.id),false);
 assert.equal(store.size,0);
});

test('share store enforces the per-library size limit',()=>{
 const store=createShareStore();
 assert.throws(()=>store.create({items:[]},MAX_SHARE_BYTES+1),{status:413});
});

test('share store applies its aggregate active-data limit without evicting valid shares',()=>{
 let nextId=0;
 const store=createShareStore({idGenerator:()=>String(nextId++).padStart(16,'0'),maxActiveBytes:10});
 const first=store.create({id:1},6);
 assert.throws(()=>store.create({id:2},5),{status:503});
 assert.deepEqual(store.get(first.id),{id:1});
});
