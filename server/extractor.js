import dns from 'node:dns/promises';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import {createBrotliDecompress,createGunzip,createInflate} from 'node:zlib';

const MAX_HTML_BYTES=6*1024*1024;
const MAX_MEDIA=500;
const MAX_SRCSET_CANDIDATES=30;
const REQUEST_TIMEOUT_MS=9000;
const MAX_REDIRECTS=5;
const USER_AGENT='GrabitLinkPreview/1.0 (+local personal bookmark library)';

function isPrivateAddress(address){
 const family=net.isIP(address);
 if(family===4){
  const [a,b]=address.split('.').map(Number);
  return a===0||a===10||a===127||a>=224||(a===100&&b>=64&&b<=127)||(a===169&&b===254)||(a===172&&b>=16&&b<=31)||(a===192&&b===0)||(a===192&&b===168)||(a===198&&(b===18||b===19))||(a===198&&b===51)||(a===203&&b===0);
 }
 if(family===6){
  const value=address.toLowerCase().split('%')[0];
  if(value==='::'||value==='::1'||value.startsWith('fc')||value.startsWith('fd')||/^fe[89ab]/.test(value)||value.startsWith('ff')||value.startsWith('2001:db8'))return true;
  const mapped=value.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if(mapped)return isPrivateAddress(mapped[1]);
  const [left,right='']=value.split('::');
  const leftGroups=left?left.split(':'):[];
  const rightGroups=right?right.split(':'):[];
  const groups=[...leftGroups,...Array(8-leftGroups.length-rightGroups.length).fill('0'),...rightGroups].map(part=>Number.parseInt(part,16));
  if(groups.length!==8||groups.some(part=>!Number.isInteger(part)||part<0||part>0xffff))return true;
  if(groups.length===8&&groups.slice(0,5).every(part=>part===0)&&groups[5]===0xffff){
   const ipv4=[groups[6]>>8,groups[6]&255,groups[7]>>8,groups[7]&255].join('.');
   return isPrivateAddress(ipv4);
  }
  if(groups[0]<0x2000||groups[0]>=0x4000||groups[0]===0x2002||(groups[0]===0x2001&&groups[1]===0))return true;
  return false;
 }
 return true;
}

export async function resolvePublicAddress(hostname,lookup=dns.lookup){
 if(hostname.startsWith('[')&&hostname.endsWith(']'))hostname=hostname.slice(1,-1);
 if(net.isIP(hostname))return isPrivateAddress(hostname)?null:{address:hostname,family:net.isIP(hostname)};
 let addresses;
 try{addresses=await lookup(hostname,{all:true,verbatim:true})}catch{return null}
 if(!addresses.length||addresses.some(entry=>isPrivateAddress(entry.address)))return null;
 return addresses[0];
}

export function createPinnedLookup(address){
 return(_hostname,options,callback)=>{
  if(options.all)return callback(null,[address]);
  callback(null,address.address,address.family);
 };
}

function decodeEntities(value){
 return value.replace(/&(#(?:x[\da-f]+|\d+)|amp|quot|apos|lt|gt|nbsp);/gi,(whole,entity)=>{
  if(entity[0]==='#'){
   const hex=entity[1]?.toLowerCase()==='x';const point=Number.parseInt(entity.slice(hex?2:1),hex?16:10);
   return Number.isFinite(point)&&point>0&&point<=0x10ffff?String.fromCodePoint(point):whole;
  }
  return({amp:'&',quot:'"',apos:"'",lt:'<',gt:'>',nbsp:' '})[entity.toLowerCase()]||whole;
 });
}

function attributes(tag){
 const result={};
 for(const match of tag.matchAll(/([^\s=<>"'\/]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g))result[match[1].toLowerCase()]=decodeEntities(match[2]??match[3]??match[4]??'');
 return result;
}

function cleanText(value,max=500){
 return decodeEntities(String(value||'').replace(/<[^>]*>/g,' ').replace(/[\u0000-\u001f\u007f]/g,' ').replace(/\s+/g,' ').trim()).slice(0,max);
}

function publicMediaUrl(value,base){
 if(typeof value!=='string'||!value.trim())return null;
 try{
  const url=new URL(value,base);
  if(!['http:','https:'].includes(url.protocol)||url.username||url.password||(net.isIP(url.hostname)&&isPrivateAddress(url.hostname)))return null;
  url.hash='';
  return url.href;
 }catch{return null}
}

export function srcsetCandidates(value,base){
 return String(value||'').split(/,\s+(?=(?:https?:\/\/|\/|\.\/|\.\.\/|data:))/i).map((candidate,index)=>{
  const [rawUrl,descriptor='']=candidate.trim().split(/\s+/);
  const url=publicMediaUrl(rawUrl,base);
  if(!url)return null;
  const parsed=descriptor.match(/^(\d+(?:\.\d+)?)(w|x)$/i);
  if(!parsed)return{url,quality:0,index};
  const amount=Number(parsed[1]);
  return{url,quality:parsed[2].toLowerCase()==='w'?amount:amount*1000,width:parsed[2].toLowerCase()==='w'?amount:undefined,density:parsed[2].toLowerCase()==='x'?amount:undefined,index};
 }).filter(Boolean).sort((a,b)=>b.quality-a.quality).slice(0,MAX_SRCSET_CANDIDATES);
}

export function bestSrcsetCandidate(value,base){
 const candidates=srcsetCandidates(value,base);
 const best=candidates[0];
 return best?{url:best.url,...(best.width?{width:best.width}:{}),...(best.density?{density:best.density}:{})}:null;
}

function addMedia(target,seen,entry,count){
 if(!entry?.url||seen.has(entry.url))return;
 seen.add(entry.url);count.value++;
 if(target.length<MAX_MEDIA)target.push(entry);
}

export function parsePage(html,pageUrl,limit=MAX_MEDIA){
 const titleMeta=[];const descriptionMeta=[];const metaImageCandidates=[];const imageCandidates=[];const videoCandidates=[];const seenMetaImages=new Set();const seenImages=new Set();const seenVideos=new Set();const metaImageCount={value:0};const imageCount={value:0};const videoCount={value:0};
 let canonicalUrl=pageUrl;
 for(const match of html.matchAll(/<(meta|link)\b[^>]*>/gi)){
  const tag=match[0];const attrs=attributes(tag);const key=(attrs.property||attrs.name||attrs.itemprop||'').toLowerCase();const rel=(attrs.rel||'').toLowerCase();
  if(match[1].toLowerCase()==='link'&&rel.split(/\s+/).includes('canonical')){canonicalUrl=publicMediaUrl(attrs.href,pageUrl)||canonicalUrl;continue}
  if(match[1].toLowerCase()!=='meta')continue;
  if(['og:title','twitter:title','title'].includes(key)&&attrs.content)titleMeta.push(attrs.content);
  if(['og:description','twitter:description','description'].includes(key)&&attrs.content)descriptionMeta.push(attrs.content);
  if(['og:image','og:image:url','og:image:secure_url','twitter:image','twitter:image:src','twitter:image:secure_url','image'].includes(key)){const url=publicMediaUrl(attrs.content,pageUrl);if(url)addMedia(metaImageCandidates,seenMetaImages,{url,alt:'',thumbnailUrl:url},metaImageCount)}
  if(['og:video','og:video:url','og:video:secure_url','twitter:player:stream'].includes(key)){const url=publicMediaUrl(attrs.content,pageUrl);if(url)addMedia(videoCandidates,seenVideos,{url,thumbnailUrl:''},videoCount)}
  if(key==='og:video'&&attrs.content){const image=publicMediaUrl(attrs['data-thumbnail'],pageUrl);if(image&&videoCandidates.length)videoCandidates.at(-1).thumbnailUrl=image}
 }
 const titleTag=html.match(/<title\b[^>]*>([\s\S]*?)<\/title\s*>/i);
 for(const match of html.matchAll(/<(img|video|source)\b[^>]*>/gi)){
  const tag=match[0];const name=match[1].toLowerCase();const attrs=attributes(tag);
  const poster=publicMediaUrl(attrs.poster,pageUrl);
  if(name==='img'){
   const alt=cleanText(attrs.alt||attrs.title||'',240);
   const srcset=srcsetCandidates(attrs.srcset||attrs['data-srcset'],pageUrl);
   const responsive=srcset[0];
   if(responsive)addMedia(imageCandidates,seenImages,{url:responsive.url,...(responsive.width?{width:responsive.width}:{}),...(responsive.density?{density:responsive.density}:{}),...(srcset.length>1?{qualityOptions:srcset.map(({index,...candidate})=>candidate)}:{}),alt,thumbnailUrl:responsive.url},imageCount);
   const candidates=responsive?[]:[attrs['data-original'],attrs['data-lazy-src'],attrs['data-src'],attrs['data-url'],attrs.src];
   for(const value of candidates){const url=publicMediaUrl(value,pageUrl);if(url)addMedia(imageCandidates,seenImages,{url,alt,thumbnailUrl:url,width:Number(attrs.width)||undefined,height:Number(attrs.height)||undefined},imageCount)}
  }
  if(name==='video'&&attrs.src){const url=publicMediaUrl(attrs.src,pageUrl);if(url){addMedia(videoCandidates,seenVideos,{url,thumbnailUrl:poster||'',...(Number(attrs.width)>0?{width:Number(attrs.width)}:{}),...(Number(attrs.height)>0?{height:Number(attrs.height)}:{})},videoCount);const existing=videoCandidates.find(entry=>entry.url===url);if(existing&&!existing.thumbnailUrl)existing.thumbnailUrl=poster||''}}
  if(name==='source'){
   const parentVideo=html.slice(Math.max(0,match.index-700),match.index).match(/<video\b[^>]*>/gi)?.at(-1);
   if(parentVideo){const parent=attributes(parentVideo);const url=publicMediaUrl(attrs.src,pageUrl);const thumbnailUrl=publicMediaUrl(parent.poster,pageUrl);const width=Number(attrs.width)||Number(parent.width),height=Number(attrs.height)||Number(parent.height);if(url){addMedia(videoCandidates,seenVideos,{url,thumbnailUrl:thumbnailUrl||'',...(width>0?{width}:{}),...(height>0?{height}:{})},videoCount);const existing=videoCandidates.find(entry=>entry.url===url);if(existing&&!existing.thumbnailUrl)existing.thumbnailUrl=thumbnailUrl||''}}
  }
 }
 const jsonLd=html.match(/<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script\s*>/i);
 if(jsonLd&&titleMeta.length===0){try{const data=JSON.parse(jsonLd[1]);const first=Array.isArray(data)?data[0]:data;if(first?.headline||first?.name)titleMeta.push(String(first.headline||first.name))}catch{}}
 const textTitle=titleMeta.map(x=>cleanText(x,240)).find(Boolean)||cleanText(titleTag?.[1],240)||new URL(pageUrl).hostname;
 const pageTitle=textTitle.split(/\s+[|–—]\s+/)[0].trim()||textTitle;
 const metadataImages=videoCandidates.length&&metaImageCandidates.length<2?[]:metaImageCandidates;
 const images=videoCount.value>1?[]:[...imageCandidates,...metadataImages.filter(candidate=>!seenImages.has(candidate.url))];
 const videos=videoCandidates.slice(0,limit);
 const media=[...images.slice(0,Math.max(0,limit-videos.length)).map(entry=>({type:'image',...entry})),...videos.map(entry=>({type:'video',...entry}))];
 const imageTotal=videoCount.value>1?0:imageCount.value+metadataImages.filter(candidate=>!seenImages.has(candidate.url)).length;
 return{title:pageTitle,description:descriptionMeta.map(x=>cleanText(x,1500)).find(Boolean)||'',canonicalUrl,media,mediaCount:media.length,truncated:imageTotal+videoCount.value>limit};
}

function pixivArtworkId(url){
 const hostname=url.hostname.toLowerCase();
 const match=url.pathname.match(/^\/(?:en\/)?artworks\/(\d+)\/?$/i);
 return ['pixiv.net','www.pixiv.net'].includes(hostname)?match?.[1]||'':'';
}

function pixivCdnUrl(value,base){
 const url=publicMediaUrl(value,base);
 if(!url)return null;
 return ['i.pximg.net','i-f.pximg.net'].includes(new URL(url).hostname.toLowerCase())?url:null;
}

export function parsePixivPages(payload,pageUrl,limit=MAX_MEDIA){
 if(!payload||payload.error!==false||!Array.isArray(payload.body))throw new Error('Pixiv did not return artwork image metadata.');
 const media=payload.body.flatMap(page=>{
  const original=pixivCdnUrl(page?.urls?.original,pageUrl);
  const preview=pixivCdnUrl(page?.urls?.regular||page?.urls?.small,pageUrl);
  if(!original)return [];
  return [{
   type:'image',
   url:original,
   thumbnailUrl:preview||original,
   alt:'',
   ...(Number(page.width)>0?{width:Number(page.width)}:{}),
   ...(Number(page.height)>0?{height:Number(page.height)}:{})
  }];
 });
 return{media:media.slice(0,limit),mediaCount:Math.min(media.length,limit),truncated:media.length>limit};
}

export function parsePixivUgoira(payload,pageUrl,artworkUrl){
 const body=payload?.body;
 const zipUrl=pixivCdnUrl(body?.zip_urls?.original||body?.zip_urls?.medium,pageUrl);
 if(payload?.error!==false||!zipUrl||!new URL(zipUrl).pathname.toLowerCase().endsWith('.zip')||!Array.isArray(body?.frames)||!body.frames.length||body.frames.length>MAX_MEDIA)throw new Error('Pixiv did not return valid ugoira animation metadata.');
 const frames=body.frames.map(frame=>{
  const file=String(frame?.file||''),delay=Number(frame?.delay);
  if(!/^[A-Za-z0-9_.-]{1,200}$/.test(file)||file==='.'||file==='..'||!Number.isFinite(delay)||delay<0||delay>10000)throw new Error('Pixiv returned invalid ugoira frame metadata.');
  return{file,delay:Math.max(20,delay)};
 });
 if(frames.reduce((total,frame)=>total+frame.delay,0)>600000)throw new Error('This Pixiv animation is longer than the 10 minute limit.');
 const thumbnailUrl=pixivCdnUrl(body?.src,pageUrl)||pixivCdnUrl(body?.originalSrc,pageUrl)||'';
 return{
  type:'video',
  url:artworkUrl,
  sourceUrl:artworkUrl,
  providerUrl:artworkUrl,
  thumbnailUrl,
  alt:'',
  pixivUgoira:{zipUrl,frames}
 };
}

export function decompress(response){
 return new Promise((resolve,reject)=>{
  const chunks=[];let length=0;
  const stream=response.headers['content-encoding']==='gzip'?createGunzip():response.headers['content-encoding']==='deflate'?createInflate():response.headers['content-encoding']==='br'?createBrotliDecompress():null;
  const input=stream?response.pipe(stream):response;
  input.on('data',chunk=>{length+=chunk.length;if(length>MAX_HTML_BYTES){input.destroy(new Error('The webpage exceeds the 6 MB extraction limit.'));return}chunks.push(chunk)});
  input.on('end',()=>resolve(Buffer.concat(chunks,length)));
  input.on('error',reject);
 });
}

function requestPage(url,address,headers={}){
 const transport=url.protocol==='https:'?https:http;
 return new Promise((resolve,reject)=>{
  const request=transport.request(url,{method:'GET',headers:{'user-agent':USER_AGENT,accept:'text/html,application/xhtml+xml;q=0.9','accept-encoding':'gzip, deflate, br',...headers},lookup:createPinnedLookup(address),servername:net.isIP(url.hostname)?undefined:url.hostname,rejectUnauthorized:true},response=>{
   const contentType=String(response.headers['content-type']||'').toLowerCase();
   if([301,302,303,307,308].includes(response.statusCode)||/^(image|video|audio)\//.test(contentType)){
    response.resume();resolve({status:response.statusCode||0,headers:response.headers,body:Buffer.alloc(0)});return;
   }
   decompress(response).then(body=>resolve({status:response.statusCode||0,headers:response.headers,body})).catch(reject);
  });
  request.setTimeout(REQUEST_TIMEOUT_MS,()=>request.destroy(new Error('The webpage request timed out.')));
  request.on('error',reject);request.end();
 });
}

function requestMediaStream(url,address){
 const transport=url.protocol==='https:'?https:http;
 return new Promise((resolve,reject)=>{
  const request=transport.get(url,{headers:mediaRequestHeaders(url),lookup:createPinnedLookup(address),servername:net.isIP(url.hostname)?undefined:url.hostname,rejectUnauthorized:true},response=>{
   const status=response.statusCode||0;
   if([301,302,303,307,308].includes(status)){response.resume();resolve({status,location:response.headers.location});return}
   const contentType=String(response.headers['content-type']||'application/octet-stream').split(';')[0].trim().toLowerCase();
   if(status<200||status>=300){response.resume();reject(new Error(`The media host returned HTTP ${status}.`));return}
   if(contentType==='text/html'||contentType==='application/xhtml+xml'){response.resume();reject(new Error('This URL serves a webpage, not a downloadable media file. Preview the page and download one of its media items instead.'));return}
   resolve({status,contentType,headers:response.headers,stream:response});
  });
  request.setTimeout(REQUEST_TIMEOUT_MS,()=>request.destroy(new Error('The media download timed out.')));
  request.on('error',reject);
 });
}

export function mediaRequestHeaders(url){
 const headers={'user-agent':USER_AGENT,accept:'image/*,video/*,audio/*,application/octet-stream;q=0.9,*/*;q=0.1','accept-encoding':'identity'};
 const hostname=url.hostname.toLowerCase();
 if(hostname==='pximg.net'||hostname.endsWith('.pximg.net'))headers.referer='https://www.pixiv.net/';
 return headers;
}

export function safeDownloadFilename(value){
 const name=String(value||'download').replace(/[/\\?%*:|"<>;\u0000-\u001f\u007f]/g,'_').replace(/^\.+/,'').trim().slice(0,180);
 return name||'download';
}

export async function openPublicMedia(rawUrl){
 let current;
 try{current=new URL(rawUrl)}catch{throw new Error('Enter a valid media URL.')}
 if(!['http:','https:'].includes(current.protocol)||current.username||current.password)throw new Error('Only public HTTP or HTTPS media URLs can be downloaded.');
 if((current.protocol==='https:'&&current.port&&current.port!=='443')||(current.protocol==='http:'&&current.port&&current.port!=='80'))throw new Error('Custom ports are not supported for downloads.');
 for(let redirects=0;redirects<=MAX_REDIRECTS;redirects++){
  const address=await resolvePublicAddress(current.hostname);
  if(!address)throw new Error('This media URL resolves to a private or unavailable network address and cannot be downloaded.');
  const result=await requestMediaStream(current,address);
  if([301,302,303,307,308].includes(result.status)){
   if(!result.location)throw new Error('The media host returned an invalid redirect.');
   if(redirects===MAX_REDIRECTS)throw new Error('The media URL redirected too many times.');
   current=new URL(result.location,current);
   if(!['http:','https:'].includes(current.protocol)||current.username||current.password)throw new Error('The media redirected to an unsupported address.');
   if((current.protocol==='https:'&&current.port&&current.port!=='443')||(current.protocol==='http:'&&current.port&&current.port!=='80'))throw new Error('The media redirected to an unsupported port.');
   continue;
  }
  const disposition=String(result.headers['content-disposition']||'').match(/filename\*?=(?:UTF-8''|")?([^";]+)/i)?.[1];
  let fromHeader='';
  if(disposition){try{fromHeader=decodeURIComponent(disposition.replace(/^"|"$/g,''))}catch{fromHeader=disposition}}
  let fromUrl='';
  try{fromUrl=decodeURIComponent(current.pathname.split('/').filter(Boolean).at(-1)||'')}catch{}
  return{stream:result.stream,contentType:result.contentType,contentLength:result.headers['content-length'],filename:safeDownloadFilename(fromHeader||fromUrl||'download')};
 }
 throw new Error('Could not follow the media redirect.');
}

export async function downloadPublicMedia(rawUrl){
 const result=await openPublicMedia(rawUrl);
 const chunks=[];
 for await(const chunk of result.stream)chunks.push(chunk);
 return{body:Buffer.concat(chunks),contentType:result.contentType,filename:result.filename};
}

export async function extractPage(rawUrl){
 let current;
 try{current=new URL(rawUrl)}catch{throw new Error('Enter a valid webpage URL.')}
 if(!['http:','https:'].includes(current.protocol)||current.username||current.password)throw new Error('Only public HTTP or HTTPS webpages are supported.');
 if((current.protocol==='https:'&&current.port&&current.port!=='443')||(current.protocol==='http:'&&current.port&&current.port!=='80'))throw new Error('Custom ports are not supported for extraction.');
 for(let redirects=0;redirects<=MAX_REDIRECTS;redirects++){
  const address=await resolvePublicAddress(current.hostname);
  if(!address)throw new Error('This website resolves to a private or unavailable network address and cannot be fetched.');
  const response=await requestPage(current,address);
  if([301,302,303,307,308].includes(response.status)){
   const destination=response.headers.location;
   if(!destination)throw new Error('The website returned an invalid redirect.');
   if(redirects===MAX_REDIRECTS)throw new Error('The webpage redirected too many times.');
   current=new URL(destination,current);
   if(!['http:','https:'].includes(current.protocol)||current.username||current.password)throw new Error('The webpage redirected to an unsupported address.');
   if((current.protocol==='https:'&&current.port&&current.port!=='443')||(current.protocol==='http:'&&current.port&&current.port!=='80'))throw new Error('The webpage redirected to an unsupported port.');
   continue;
  }
  if(response.status===401||response.status===403)throw new Error(`The website denied Grabit's preview request (HTTP ${response.status}). It may require sign-in or block automated fetching. Open the original page or save its individual media URLs instead.`);
  if(response.status<200||response.status>=300)throw new Error(`The website returned HTTP ${response.status}.`);
  const contentType=String(response.headers['content-type']||'').toLowerCase();
  if(!contentType.includes('text/html')&&!contentType.includes('application/xhtml+xml')){
   const type=contentType.startsWith('image/')?'image':contentType.startsWith('video/')?'video':'';
   if(type){const filename=current.pathname.split('/').filter(Boolean).at(-1)||current.hostname;let title;try{title=decodeURIComponent(filename)}catch{title=filename}return{title,description:'',canonicalUrl:current.href,sourceUrl:rawUrl,finalUrl:current.href,sourceDomain:current.hostname.replace(/^www\./,''),media:[{type,url:current.href,thumbnailUrl:type==='image'?current.href:''}],mediaCount:1,truncated:false}}
   throw new Error('This URL does not return an HTML webpage or a recognized media file.');
  }
  const html=response.body.toString('utf8');
  const page={...parsePage(html,current.href),sourceUrl:rawUrl,finalUrl:current.href,sourceDomain:current.hostname.replace(/^www\./,'')};
  const artworkId=pixivArtworkId(current);
  if(!artworkId)return page;
  const referer=`https://www.pixiv.net/artworks/${artworkId}`;
  const fetchArtworkJson=async endpoint=>{
   const apiUrl=new URL(endpoint,'https://www.pixiv.net');
   const apiAddress=await resolvePublicAddress(apiUrl.hostname);
   if(!apiAddress)throw new Error('Pixiv artwork metadata resolves to a private or unavailable network address.');
   const apiResponse=await requestPage(apiUrl,apiAddress,{accept:'application/json',referer});
   if(apiResponse.status===401||apiResponse.status===403)throw new Error('Pixiv requires sign-in or age confirmation for this artwork. Grabit cannot use your Pixiv login; open the artwork on Pixiv or try a publicly accessible post.');
   if(apiResponse.status<200||apiResponse.status>=300)throw new Error(`Pixiv artwork metadata returned HTTP ${apiResponse.status}.`);
   try{return JSON.parse(apiResponse.body.toString('utf8'))}catch{throw new Error('Pixiv returned invalid artwork metadata.')}
  };
  const detail=await fetchArtworkJson(`/ajax/illust/${artworkId}?lang=en`);
  if(detail?.error!==false||!detail.body)throw new Error('Pixiv did not return public artwork details. This post may be age-restricted and require Pixiv sign-in or age confirmation; Grabit cannot use your Pixiv login.');
  if(Number(detail.body.illustType)===2){
   const ugoira=await fetchArtworkJson(`/ajax/illust/${artworkId}/ugoira_meta?lang=en`);
   const animation=parsePixivUgoira(ugoira,current.href,`https://www.pixiv.net/artworks/${artworkId}`);
   return{...page,title:detail.body.illustTitle||page.title,media:[animation],mediaCount:1,truncated:false};
  }
  const artwork=parsePixivPages(await fetchArtworkJson(`/ajax/illust/${artworkId}/pages?lang=en`),current.href);
  return{...page,title:detail.body.illustTitle||page.title,...artwork};
 }
 throw new Error('Could not follow the webpage redirect.');
}

export const extractorLimits={maxMedia:MAX_MEDIA,maxHtmlBytes:MAX_HTML_BYTES,timeoutMs:REQUEST_TIMEOUT_MS};
