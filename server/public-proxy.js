import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import {createPinnedLookup,resolvePublicAddress} from './extractor.js';

const MAX_PROXY_PORTS=new Set([80,443]);

async function resolveTarget(rawUrl){
 let url;
 try{url=new URL(rawUrl)}catch{return null}
 if(!['http:','https:'].includes(url.protocol)||url.username||url.password)return null;
 const port=Number(url.port||(url.protocol==='https:'?443:80));
 if(!MAX_PROXY_PORTS.has(port))return null;
 const address=await resolvePublicAddress(url.hostname);
 return address?{url,port,address}:null;
}

function safeHeaders(headers){
 const result={...headers};
 delete result['proxy-authorization'];
 delete result['proxy-connection'];
 return result;
}

export async function createPublicProxy(){
 const sockets=new Set();
 const server=http.createServer(async(request,response)=>{
  const target=await resolveTarget(request.url);
  if(!target){response.writeHead(403,{'content-type':'text/plain'}).end('Proxy destination is not public HTTP or HTTPS.');return}
  const {url,address}=target;
  const transport=url.protocol==='https:'?https:http;
  const upstream=transport.request(url,{
   method:request.method,
   headers:safeHeaders(request.headers),
   lookup:createPinnedLookup(address),
   servername:net.isIP(url.hostname)?undefined:url.hostname,
   rejectUnauthorized:true,
   agent:false
  },upstreamResponse=>{
   response.writeHead(upstreamResponse.statusCode||502,upstreamResponse.headers);
   upstreamResponse.pipe(response);
  });
  upstream.setTimeout(15_000,()=>upstream.destroy(new Error('yt-dlp proxy request timed out.')));
  upstream.on('error',()=>{if(!response.headersSent)response.writeHead(502);response.end()});
  request.pipe(upstream);
 });
 server.on('connection',socket=>{sockets.add(socket);socket.once('close',()=>sockets.delete(socket))});
 server.on('connect',async(request,client,head)=>{
  const target=await resolveTarget(`http://${request.url}`);
  if(!target){client.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');return}
  const upstream=net.connect({host:target.address.address,port:target.port,family:target.address.family});
  upstream.setTimeout(15_000,()=>upstream.destroy(new Error('yt-dlp proxy tunnel timed out.')));
  upstream.once('connect',()=>{
   client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
   if(head.length)upstream.write(head);
   client.pipe(upstream);upstream.pipe(client);
  });
  upstream.on('error',()=>client.destroy());
  client.on('error',()=>upstream.destroy());
 });
 await new Promise((resolve,reject)=>{
  server.once('error',reject);
  server.listen(0,'127.0.0.1',resolve);
 });
 return{
  url:`http://127.0.0.1:${server.address().port}`,
  close(){
   for(const socket of sockets)socket.destroy();
   server.close();
  }
 };
}
