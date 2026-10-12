import test from 'node:test';
import assert from 'node:assert/strict';
import {discoverPlaylistUrl,previewUrl} from '../js/importer.js';

test('page preview can skip playlist discovery and carries an abort signal',async()=>{
 const originalFetch=globalThis.fetch;
 let requestUrl,requestOptions;
 globalThis.fetch=async(url,options)=>{
  requestUrl=url;requestOptions=options;
  return new Response(JSON.stringify({title:'Page',media:[]}),{headers:{'content-type':'application/json'}});
 };
 try{
  const controller=new AbortController();
  const page=await previewUrl('https://example.com/page',{includePlaylist:false},{signal:controller.signal});
  assert.equal(requestUrl,'/api/preview');
  assert.deepEqual(JSON.parse(requestOptions.body),{url:'https://example.com/page',includePlaylist:false});
  assert.ok(requestOptions.signal instanceof AbortSignal);
  assert.equal(page.title,'Page');
 }finally{globalThis.fetch=originalFetch}
});

test('video-list discovery uses its separate API endpoint',async()=>{
 const originalFetch=globalThis.fetch;
 let requestUrl,requestOptions;
 globalThis.fetch=async(url,options)=>{
  requestUrl=url;requestOptions=options;
  return new Response(JSON.stringify({media:[],playlistPaging:true,start:1,hasMore:false}),{headers:{'content-type':'application/json'}});
 };
 try{
  const result=await discoverPlaylistUrl('https://example.com/list');
  assert.equal(requestUrl,'/api/playlist');
  assert.deepEqual(JSON.parse(requestOptions.body),{url:'https://example.com/list'});
  assert.equal(result.playlistPaging,true);
 }finally{globalThis.fetch=originalFetch}
});
