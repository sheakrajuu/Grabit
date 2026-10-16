import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {once} from 'node:events';
import {chromium} from 'playwright';
import {extractPage} from '../browser-extension/extractor.js';

test('opens repeated same-origin image links with browser credentials and keeps thumbnail fallbacks',async t=>{
 const detailRequests=[];
 const server=http.createServer((request,response)=>{
  const detail=request.url.match(/^\/detail\/(\d+)$/);
  if(request.url==='/'){
   response.writeHead(200,{'content-type':'text/html; charset=utf-8','set-cookie':'session=active; SameSite=Lax'});
   response.end(`<!doctype html><title>Generic gallery</title>
    <button id="more">Show more</button><button id="all" aria-label="View all 4 pictures">Show all</button>
    <main id="gallery"><a href="/detail/1"><img src="/thumb/1.jpg" alt="Page 1"></a></main>
    <script>
     document.querySelector('#all').addEventListener('click',()=>{
      const gallery=document.querySelector('#gallery');
      for(let page=2;page<=4;page++)gallery.insertAdjacentHTML('beforeend','<a href="/detail/'+page+'"><img src="/thumb/'+page+'.jpg" alt="Page '+page+'"></a>');
      document.querySelector('#all').setAttribute('aria-label','All images shown');
      document.querySelector('#more').hidden=true;
     });
     document.querySelector('#more').addEventListener('click',()=>{throw new Error('The non-priority control should not be clicked')});
    </script>`);
   return;
  }
  if(detail){
   detailRequests.push({path:request.url,cookie:request.headers.cookie||''});
   if(detail[1]==='4'){
    response.writeHead(503,{'content-type':'text/html'});
    response.end('Unavailable');
    return;
   }
   response.writeHead(200,{'content-type':'text/html; charset=utf-8'});
   response.end(`<!doctype html><title>Image ${detail[1]}</title><img src="../media/full-${detail[1]}-small.jpg" width="640" height="960"><img srcset="/media/full-${detail[1]}-small.jpg 640w, ../media/full-${detail[1]}.webp 1280w" width="1280" height="1920" alt="Full image ${detail[1]}">`);
   return;
  }
  response.writeHead(404);
  response.end();
 });
 server.listen(0,'127.0.0.1');
 await once(server,'listening');
 t.after(()=>new Promise(resolve=>{
  server.closeAllConnections();
  server.close(resolve);
 }));

 const browser=await chromium.launch({headless:true});
 t.after(()=>browser.close());
 const page=await browser.newPage();
 await page.goto(`http://127.0.0.1:${server.address().port}/`);
 const result=await page.evaluate(extractPage);

 assert.equal(result.title,'Generic gallery');
 assert.equal(detailRequests.length,4);
 assert.ok(detailRequests.every(request=>request.cookie.includes('session=active')));
 assert.deepEqual(result.media.map(media=>media.url).sort(),[
  `http://127.0.0.1:${server.address().port}/media/full-1.webp`,
  `http://127.0.0.1:${server.address().port}/media/full-2.webp`,
  `http://127.0.0.1:${server.address().port}/media/full-3.webp`,
  `http://127.0.0.1:${server.address().port}/thumb/4.jpg`
 ].sort());
 assert.equal(result.media.find(media=>media.url.endsWith('/media/full-1.webp')).thumbnailUrl,`http://127.0.0.1:${server.address().port}/thumb/1.jpg`);
 assert.match(result.warning,/1 linked image page could not be opened/);
});
