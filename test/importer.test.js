import test from 'node:test';
import assert from 'node:assert/strict';
import {discoverPlaylistUrl,previewUrl,resolveVideoUrl} from '../js/importer.js';
import {expandPageNumberUrls} from '../js/utils.js';

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

test('page number ranges expand into multiple URLs',()=>{
 const urls=expandPageNumberUrls(['https://example.com/catalog?page=1'], '2-5');
 assert.deepEqual(urls,['https://example.com/catalog?page=2','https://example.com/catalog?page=3','https://example.com/catalog?page=4','https://example.com/catalog?page=5']);
 const mixed=expandPageNumberUrls(['https://example.com/page?page=1','https://example.com/other'], '2/3/4');
 assert.deepEqual(mixed,['https://example.com/page?page=2','https://example.com/page?page=3','https://example.com/page?page=4','https://example.com/other?page=2','https://example.com/other?page=3','https://example.com/other?page=4']);
 const pageColon=expandPageNumberUrls(['https://example.com/series'], 'page:2/3/4/5');
 assert.deepEqual(pageColon,['https://example.com/series?page=2','https://example.com/series?page=3','https://example.com/series?page=4','https://example.com/series?page=5']);
 const autoDetected=expandPageNumberUrls(['https://example.com/series?page:2/3/4/5']);
 assert.deepEqual(autoDetected,['https://example.com/series?page=2','https://example.com/series?page=3','https://example.com/series?page=4','https://example.com/series?page=5']);
});

test('page and video failures use clear public messages without backend details',async()=>{
 const originalFetch=globalThis.fetch;
 globalThis.fetch=async()=>new Response(JSON.stringify({error:'Install yt-dlp on the server and restart the worker.'}),{status:503,headers:{'content-type':'application/json'}});
 try{
  await assert.rejects(previewUrl('https://example.com/page'),/couldn't load page media/i);
  await assert.rejects(resolveVideoUrl('https://example.com/video'),/couldn't load video/i);
 }finally{globalThis.fetch=originalFetch}
});
