export const $=selector=>document.querySelector(selector);
export const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const uid=()=>globalThis.crypto?.randomUUID?.()||`${Date.now().toString(36)}${Math.random().toString(36).slice(2,9)}`;
export const host=url=>{try{return new URL(url).hostname.replace(/^www\./,'')}catch{return ''}};
export const validUrl=value=>{try{const url=new URL(value);return ['http:','https:'].includes(url.protocol)&&!!url.hostname&&!url.username&&!url.password?url:null}catch{return null}};
export const isPixivImageUrl=value=>{const url=validUrl(value);return !!url&&url.protocol==='https:'&&!url.port&&(url.hostname.toLowerCase()==='pximg.net'||url.hostname.toLowerCase().endsWith('.pximg.net'))};
export const pixivImageProxyUrl=value=>isPixivImageUrl(value)?`/api/pixiv-image?url=${encodeURIComponent(new URL(value).href)}`:value;
export const normalized=value=>{const url=validUrl(value);if(!url)return '';url.hash='';if(url.pathname!='/')url.pathname=url.pathname.replace(/\/+$/,'');return url.href};
export function parsePageNumberList(value){
 const entry=String(value??'').trim();
 if(!entry)return [];
 const normalized=entry
  .replace(/^(?:page|pages)\s*[:=]/i,'')
  .replace(/^\s*[:/]+/,'')
  .replace(/\s+/g,'');
 const numbers=[];
 const seen=new Set();
 const candidates=normalized.split(/[,/;|]+/).filter(Boolean);
 for(const token of candidates){
  if(!token)continue;
  const rangeMatch=token.match(/^(\d+)\s*-\s*(\d+)$/);
  if(rangeMatch){
   const start=Number(rangeMatch[1]),end=Number(rangeMatch[2]);
   if(end<start)continue;
   for(let page=start;page<=end;page++){
    if(!seen.has(page)){seen.add(page);numbers.push(page)}
   }
   continue;
  }
  const singleMatch=token.match(/^\d+$/);
  if(singleMatch){
   const page=Number(singleMatch[0]);
   if(!seen.has(page)){seen.add(page);numbers.push(page)}
  }
 }
 return numbers.sort((a,b)=>a-b);
}

export function normalizeTags(value){
 const input=Array.isArray(value)?value:[String(value??'')];
 const tags=[];
 const seen=new Set();
 for(const entry of input){
  for(const part of String(entry).split(/[\n,]+/)){
   const tag=part.trim().replace(/^#+/,'').replace(/\s+/g,' ').toLowerCase();
   if(!tag||tag.length>40||seen.has(tag))continue;
   seen.add(tag);tags.push(tag);
  }
 }
 return tags;
}

export function groupPageSeries({baseUrl='',urls=[],pattern=''}={}){
 const list=[...new Set((Array.isArray(urls)?urls:[]).map(value=>validUrl(value)?.href || value).filter(Boolean))];
 const rule=(pattern||list.map(url=>detectPageNumberPattern(url)).find(Boolean)||'').trim();
 const pages=parsePageNumberList(rule);
 return{baseUrl:validUrl(baseUrl)?.href||baseUrl||list[0]||'',pattern:rule,pages,urls:list};
}

export function detectPageNumberPattern(rawUrl){
 if(typeof rawUrl!=='string')return '';
 const text=rawUrl.trim();
 if(!text)return '';
 const patterns=[
  /(?:[?&]|\b)(?:page(?:s)?|p|pg|pageNo|pageNumber|page_num|pageno|pageIndex)\s*[:=]\s*([0-9\s,/;|\-]+)/i,
  /(?:[?&]|\b)(?:page(?:s)?|p|pg|pageNo|pageNumber|page_num|pageno|pageIndex)\s*[:=]\s*\{?([0-9\s,/;|\-]+)\}?/i,
  /(?:page|pages)\s*[:=]\s*([0-9\s,/;|\-]+)/i
 ];
 for(const pattern of patterns){
  const match=text.match(pattern);
  if(match){return `page:${match[1].trim()}`;}
 }
 return '';
}

export function expandPageNumberUrls(baseUrls,pagePattern=''){
 const urls=Array.isArray(baseUrls)?baseUrls.filter(Boolean):[baseUrls].filter(Boolean);
 const pattern=pagePattern?.trim() || urls.map(rawUrl=>detectPageNumberPattern(rawUrl)).find(Boolean) || '';
 const numbers=parsePageNumberList(pattern);
 if(!numbers.length)return urls;
 const expanded=[];
 for(const rawUrl of urls){
  if(!rawUrl){continue}
  const parsed=validUrl(rawUrl);
  const base=parsed?parsed.href:rawUrl;
  const sourceUrl=validUrl(rawUrl)||new URL(rawUrl,location?.href||'http://localhost');
  const nextBase=sourceUrl.href.replace(/([?&])(page(?:s)?|p|pg|pageNo|pageNumber|page_num|pageno|pageIndex)\s*[:=][^&]*/gi,'');
  for(const page of numbers){
   let nextUrl;
   try{
    const url=new URL(nextBase);
    const keys=['page','p','pg','pageNo','pageNumber','page_num','pageIndex','pageno'];
    let replaced=false;
    for(const key of keys){
     if(url.searchParams.has(key)){
      url.searchParams.set(key,String(page));
      replaced=true;
      break;
     }
    }
    if(!replaced)url.searchParams.set('page',String(page));
    nextUrl=url.href;
   }catch{
    nextUrl=base;
   }
   expanded.push(nextUrl);
  }
 }
 return expanded;
}
export const videoCollectionTitle=value=>{const url=validUrl(value);if(!url||!['xhofficial.com','xhamster.com'].includes(url.hostname.toLowerCase().replace(/^www\./,'')))return '';const match=url.pathname.match(/^\/users\/([^/]+)\/videos\/?$/i);if(!match)return '';let name=match[1];try{name=decodeURIComponent(name)}catch{}return`${name} videos`};
export const EXT_IMAGE=/\.(?:avif|bmp|gif|jpe?g|png|svg|webp)(?:$)/i;
export const EXT_VIDEO=/\.(?:m4v|mov|mp4|ogv|webm)(?:$)/i;
export const classify=url=>{const path=(validUrl(url)?.pathname||'').toLowerCase();return EXT_IMAGE.test(path)?'image':EXT_VIDEO.test(path)?'video':'bookmark'};
export const videoEmbedUrl=value=>{const url=validUrl(value);if(!url)return '';const hostname=url.hostname.toLowerCase().replace(/^www\./,'');let id='';
 if(hostname==='youtu.be')id=url.pathname.split('/').filter(Boolean)[0]||'';
 else if(['youtube.com','m.youtube.com','youtube-nocookie.com'].includes(hostname)){id=url.searchParams.get('v')||url.pathname.match(/^\/(?:embed|shorts|live)\/([^/?]+)/)?.[1]||''}
 if(id&&/^[\w-]{6,20}$/.test(id))return`https://www.youtube-nocookie.com/embed/${id}?rel=0`;
 if(['vimeo.com','player.vimeo.com'].includes(hostname)){id=url.pathname.match(/(?:video\/)?(\d{5,})/)?.[1]||'';if(id)return`https://player.vimeo.com/video/${id}`}
 if(['x.com','twitter.com','mobile.twitter.com'].includes(hostname)){id=url.pathname.match(/\/status\/(\d+)/)?.[1]||'';if(id)return`https://platform.twitter.com/embed/Tweet.html?id=${id}`}
 if(hostname==='tiktok.com'){id=url.pathname.match(/\/video\/(\d+)/)?.[1]||'';if(id)return`https://www.tiktok.com/player/v1/${id}?autoplay=0`}
 if(hostname==='instagram.com'){const match=url.pathname.match(/\/(?:p|reel|tv)\/([\w-]+)/);if(match)return`https://www.instagram.com/${url.pathname.split('/').filter(Boolean)[0]}/${match[1]}/embed/`}
 return'';
};
export const socialMediaEmbed=value=>{
 const url=validUrl(value);if(!url)return null;
 const hostname=url.hostname.toLowerCase().replace(/^www\./,'');
 if(hostname==='instagram.com'){
  const match=url.pathname.match(/^\/(?:p|reel|tv)\/([\w-]+)/);
  if(match)return{type:/^\/(?:reel|tv)\//.test(url.pathname)?'video':'image',url:`https://www.instagram.com/${url.pathname.split('/')[1]}/${match[1]}/embed/`};
 }
 const video=videoEmbedUrl(url.href);
 if(video)return{type:'video',url:video};
 if(hostname==='facebook.com'||hostname.endsWith('.facebook.com')||hostname==='fb.watch'){
  if(hostname==='fb.watch'||/^\/watch(?:\/|$)/i.test(url.pathname)||/\/(?:reel|videos?)(?:\/|$)/i.test(url.pathname)||/^\/share\/[vr](?:\/|$)/i.test(url.pathname)){
   return{type:'video',url:`https://www.facebook.com/plugins/video.php?href=${encodeURIComponent(url.href)}&show_text=false`};
  }
  if(/\/(?:photos?|posts?|permalink\.php)(?:\/|$)/i.test(url.pathname)||/^\/share\/p(?:\/|$)/i.test(url.pathname)||/^\/photo\.php$/i.test(url.pathname)){
   return{type:'image',url:`https://www.facebook.com/plugins/post.php?href=${encodeURIComponent(url.href)}&show_text=false`};
  }
 }
 if(hostname==='pinterest.com'||hostname.endsWith('.pinterest.com')){
  const match=url.pathname.match(/^\/pin\/(\d+)/);
  if(match)return{type:'image',url:`https://assets.pinterest.com/ext/embed.html?id=${match[1]}`};
 }
 return null;
};
export const fallbackThumbnail=(type='media')=>`data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="640" height="480" viewBox="0 0 640 480"><rect width="640" height="480" fill="#303038"/><circle cx="320" cy="220" r="52" fill="#44444d"/><path d="M306 190v60l48-30z" fill="#f4f4f7"/><text x="320" y="355" text-anchor="middle" fill="#bbb" font-family="Arial,sans-serif" font-size="19">${String(type).toUpperCase()}</text></svg>`)}`;
