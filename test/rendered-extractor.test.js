import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {once} from 'node:events';
import {extractRenderedPage} from '../server/rendered-extractor.js';

async function listen(server){
 server.listen(0,'127.0.0.1');
 await once(server,'listening');
 return server.address().port;
}

test('uses generic accessible gallery controls to reveal images without following ad redirects',async t=>{
 const gallery=http.createServer((request,response)=>{
  response.writeHead(200,{'content-type':'text/html; charset=utf-8'});
  response.end(`<!doctype html><title>Gallery</title><button id="more">Load more photos</button><div id="show" role="button" tabindex="0" aria-label="View all 3 pictures" style="width:120px;height:32px"></div><main><img src="/one.jpg" alt="One"></main><script>
   document.querySelector('#more').addEventListener('click',()=>{
    document.querySelector('main').insertAdjacentHTML('beforeend','<img src="/more.jpg" alt="More">');
    document.querySelector('#more').textContent='More loaded';
   });
   document.querySelector('#show').addEventListener('click',()=>{
    document.querySelector('main').insertAdjacentHTML('beforeend','<img src="/two.jpg" alt="Two"><img src="/three.jpg" alt="Three">');
    document.querySelector('#show').setAttribute('aria-label','All images shown');
    document.querySelector('#more').hidden=true;
    setTimeout(()=>location.href='https://marketplacia.example/ad',0);
   });
  </script>`);
 });
 const galleryPort=await listen(gallery);
 const proxy=http.createServer((request,response)=>{
  const destination=new URL(request.url);
  const upstream=http.request({
   host:'127.0.0.1',
   port:galleryPort,
   path:`${destination.pathname}${destination.search}`,
   method:request.method,
   headers:{...request.headers,host:`gallery.example:${galleryPort}`}
  },upstreamResponse=>{
   response.writeHead(upstreamResponse.statusCode||502,upstreamResponse.headers);
   upstreamResponse.pipe(response);
  });
  upstream.on('error',error=>{
   if(!response.headersSent)response.writeHead(502);
   response.end(error.message);
  });
  request.pipe(upstream);
 });
 const proxyPort=await listen(proxy);
 t.after(async()=>{
  for(const server of [proxy,gallery])await new Promise(resolve=>server.close(resolve));
 });

 const result=await extractRenderedPage('http://gallery.example/gallery',{
  createProxy:async()=>({url:`http://127.0.0.1:${proxyPort}`,close(){}})
 });
 assert.equal(result.title,'Gallery');
 assert.equal(result.finalUrl,'http://gallery.example/gallery');
 assert.deepEqual(result.media.map(media=>media.url),[
  'http://gallery.example/one.jpg',
  'http://gallery.example/two.jpg',
  'http://gallery.example/three.jpg'
 ]);
});
