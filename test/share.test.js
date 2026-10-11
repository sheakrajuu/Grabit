import test from 'node:test';
import assert from 'node:assert/strict';
import {createLibraryShareLink,hasLibraryShareLink,readLibraryShareLink} from '../js/share.js';

const library={format:'grabit-library',version:1,exportedAt:'2026-10-11T00:00:00.000Z',sections:[{id:'section-1',name:'Favorites'}],items:[{id:'item-1',type:'image',title:'Stored image',sectionIds:['section-1'],media:[{type:'image',storedDataUrl:'data:image/png;base64,AA=='}]}]};

test('creates and reads a compressed share link without changing exported library data',async()=>{
 const link=await createLibraryShareLink(library,'https://grabit.example/library.html?watch=item-1&page=2#old-route');
 assert.equal(hasLibraryShareLink(link),true);
 assert.equal(new URL(link).searchParams.has('watch'),false);
 assert.equal(new URL(link).hash.startsWith('#grabit-share='),true);
 assert.deepEqual(await readLibraryShareLink(link),library);
 assert.deepEqual(await readLibraryShareLink(new URL(link).hash),library);
});

test('rejects malformed, non-library, and oversized share links',async()=>{
 assert.equal(hasLibraryShareLink('https://grabit.example/#unrelated=value'),false);
 await assert.rejects(readLibraryShareLink('https://grabit.example/#grabit-share=not-a-gzip-payload'));
 await assert.rejects(createLibraryShareLink({...library,format:'other'},'https://grabit.example/'),/supported Grabit library/);
 await assert.rejects(readLibraryShareLink(`https://grabit.example/#grabit-share=${'A'.repeat(900_001)}`),/too large/);
});
