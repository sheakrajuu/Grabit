import test from 'node:test';
import assert from 'node:assert/strict';
import {createShareStore,MAX_SHARE_BYTES} from '../server/share-store.js';

test('share data can be read until its five-minute expiry and is then removed',async()=>{
 let now=0;
 const store=createShareStore({now:()=>now,idGenerator:()=> 'abcdefghijklmnop',ttlMs:5});
 const created=store.create({items:[]},12);
 assert.equal(created.expiresAt,5);
 assert.deepEqual(store.get(created.id),{items:[]});
 await new Promise(resolve=>setTimeout(resolve,15));
 now=5;
 assert.equal(store.get(created.id),null);
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
