export async function extractPage(){
 const MAX_MEDIA=500,MAX_CLICKS=12,MAX_SCROLLS=24,MAX_DETAIL_PAGES=200,deadline=Date.now()+35_000;
 const loadAll=/\b(?:show|view|see|load|display)\s+all(?:\s+\d+)?\b|\ball(?:\s+\d+)?\s+(?:photos?|images?|pictures?)\b/i;
 const loadMore=/\b(?:show|view|see|load|display|expand)\s+(?:all|more)(?:\s+\d+)?\b|\b(?:load|show|view)\s+more\b|\b(?:all|more)(?:\s+\d+)?\s+(?:photos?|images?|pictures?)\b/i;
 const completed=/\b(?:shown|loaded|displayed|visible|complete|completed)\b/i;
 const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
 const labels=element=>[
  element.getAttribute('aria-label'),
  element.getAttribute('title'),
  element.innerText,
  element.textContent
 ].filter(Boolean).join(' ').replace(/\s+/g,' ').trim();
 const visible=element=>element.getClientRects().length>0
  &&getComputedStyle(element).visibility!=='hidden'
  &&getComputedStyle(element).display!=='none'
  &&!element.disabled
  &&element.getAttribute('aria-disabled')!=='true';

 for(let count=0;count<MAX_CLICKS&&Date.now()<deadline;){
  const controls=[...document.querySelectorAll('button,[role="button"],a')]
   .map(element=>({element,label:labels(element)}))
   .filter(({element,label})=>visible(element)&&label&&loadMore.test(label)&&!completed.test(label))
   .filter(({element})=>element.tagName!=='A'||new URL(element.href,location.href).origin===location.origin);
  const target=controls.find(({label})=>loadAll.test(label))||controls[0];
  if(!target)break;
  target.element.click();
  count++;
  await sleep(300);
 }

 let stable=0,previous='';
 for(let step=0;step<MAX_SCROLLS&&Date.now()<deadline&&stable<3;step++){
  window.scrollBy(0,Math.max(400,(window.innerHeight||800)*.8));
  for(const element of document.querySelectorAll('*')){
   if(element.scrollHeight>element.clientHeight+200&&element.clientHeight>100){
    element.scrollTop=Math.min(element.scrollHeight,element.scrollTop+Math.max(300,element.clientHeight*.75));
   }
  }
  await sleep(300);
  const state=`${document.images.length}:${document.documentElement.scrollHeight}`;
  if(state===previous)stable++;
  else stable=0;
  previous=state;
 }

 const safeUrl=(value,base=location.href)=>{
  try{
   const url=new URL(value,base);
   return ['http:','https:'].includes(url.protocol)&&!url.username&&!url.password?url.href:'';
  }catch{return ''}
 };
 const bestSrcset=(value,base=location.href)=>{
  const candidates=String(value||'').trim();
  if(!candidates)return '';
  return candidates.split(/,\s+(?=(?:https?:\/\/|\/|\.\/|\.\.\/))/i).map(candidate=>{
   const [rawUrl,descriptor='']=candidate.trim().split(/\s+/);
   const url=safeUrl(rawUrl,base),match=descriptor.match(/^(\d+(?:\.\d+)?)(w|x)$/i);
   return url?{url,quality:match?Number(match[1])*(match[2].toLowerCase()==='x'?1000:1):0}:null;
  })
  .filter(Boolean)
  .sort((left,right)=>right.quality-left.quality)[0]?.url||'';
 };
 const media=[],seen=new Set();
 const add=(type,value,alt='',thumbnailUrl='')=>{
  const url=safeUrl(value);
  if(!url||seen.has(url)||media.length>=MAX_MEDIA)return;
  seen.add(url);
  media.push({type,url,sourceUrl:url,thumbnailUrl:safeUrl(thumbnailUrl)||url,alt:String(alt||'').slice(0,240)});
 };

 const linkedImages=[...document.querySelectorAll('a[href]')]
  .map(anchor=>({anchor,url:safeUrl(anchor.href),images:[...anchor.querySelectorAll('img')].filter(visible)}))
  .filter(({anchor,url,images})=>url&&new URL(url).origin===location.origin&&url!==location.href&&images.length
   &&!/\.(?:avif|bmp|gif|jpe?g|png|webp|svg)(?:[?#]|$)/i.test(new URL(url).pathname));
 const containers=new Map();
 for(const candidate of linkedImages){
  let container=candidate.anchor.parentElement;
  while(container&&container!==document.body&&container.querySelectorAll('a img').length<3)container=container.parentElement;
  if(container)containers.set(container,(containers.get(container)||0)+1);
 }
 const mainContainer=[...containers].sort((left,right)=>right[1]-left[1])[0];
 const targets=mainContainer&&mainContainer[1]>=3
  ?linkedImages.filter(candidate=>candidate.anchor.parentElement&&mainContainer[0].contains(candidate.anchor)).map(candidate=>({
   url:candidate.url,
   thumbnails:candidate.images.map(image=>bestSrcset(image.getAttribute('srcset'))||image.currentSrc
    ||image.getAttribute('data-original')||image.getAttribute('data-src')||image.getAttribute('src')).filter(Boolean),
   alt:candidate.images[0]?.getAttribute('alt')||''
  })).filter((target,index,all)=>all.findIndex(other=>other.url===target.url)===index)
  :[];
 const targetUrls=new Set(targets.map(target=>target.url));

 for(const image of document.images){
  if(media.length>=MAX_MEDIA)break;
  const anchor=image.closest('a[href]'),anchorUrl=anchor?safeUrl(anchor.href):'';
  if(anchorUrl&&targetUrls.has(anchorUrl))continue;
  const source=bestSrcset(image.getAttribute('srcset'))||bestSrcset(image.getAttribute('data-srcset'))
   ||image.currentSrc||image.getAttribute('data-original')||image.getAttribute('data-lazy-src')
   ||image.getAttribute('data-src')||image.getAttribute('data-url')||image.getAttribute('src');
  add('image',source,image.getAttribute('alt')||image.getAttribute('title')||'');
 }
 for(const link of document.querySelectorAll('a[href]')){
  if(media.length>=MAX_MEDIA)break;
  if(/\.(?:avif|bmp|gif|jpe?g|png|webp)(?:[?#]|$)/i.test(link.href))add('image',link.href,link.getAttribute('aria-label')||link.innerText||'');
 }

 const pageImageCandidates=(document,pageUrl)=>{
  const candidates=[];
  for(const image of document.images){
   const source=bestSrcset(image.getAttribute('srcset'),pageUrl)||bestSrcset(image.getAttribute('data-srcset'),pageUrl)
    ||image.getAttribute('data-original')||image.getAttribute('data-lazy-src')
    ||image.getAttribute('data-src')||image.getAttribute('data-url')||image.getAttribute('src');
   const url=safeUrl(source,pageUrl);
   if(!url)continue;
   const width=Number(image.getAttribute('width'))||0,height=Number(image.getAttribute('height'))||0;
   candidates.push({url,alt:image.getAttribute('alt')||image.getAttribute('title')||'',area:width*height});
  }
  return candidates;
 };
 let failedDetailPages=0,completedDetailPages=0;
 const detailTargets=targets.slice(0,MAX_DETAIL_PAGES);
 const fetchDetail=async target=>{
  try{
   const remaining=deadline-Date.now();
   if(remaining<=0)throw new Error('The extraction time limit was reached.');
   const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),Math.min(7000,remaining));
   let response,html;
   try{
    response=await fetch(target.url,{credentials:'same-origin',headers:{accept:'text/html,application/xhtml+xml'},signal:controller.signal});
    const contentLength=Number(response.headers.get('content-length'))||0;
    if(!response.ok||!/^text\/html|application\/xhtml\+xml/i.test(response.headers.get('content-type')||'')
     ||new URL(response.url).origin!==location.origin||contentLength>5_000_000||!response.body)throw new Error('Linked page is unavailable.');
    const reader=response.body.getReader(),chunks=[];
    let size=0;
    try{
     while(true){
      const {done,value}=await reader.read();
      if(done)break;
      size+=value.byteLength;
      if(size>5_000_000){await reader.cancel();throw new Error('Linked page is too large.')}
      chunks.push(value);
     }
    }finally{reader.releaseLock()}
    const bytes=new Uint8Array(size);
    let offset=0;
    for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength}
    html=new TextDecoder().decode(bytes);
   }finally{clearTimeout(timeout)}
   const documentFromPage=new DOMParser().parseFromString(html,'text/html');
   let candidates=pageImageCandidates(documentFromPage,target.url);
   const largestArea=Math.max(0,...candidates.map(candidate=>candidate.area));
   if(largestArea>0)candidates=candidates.filter(candidate=>candidate.area>=largestArea*.8);
   if(candidates.length){
    for(const candidate of candidates)add('image',candidate.url,candidate.alt||target.alt,target.thumbnails[0]||'');
   }else{
    failedDetailPages++;
    for(const thumbnail of target.thumbnails)add('image',thumbnail,target.alt);
   }
  }catch{
   failedDetailPages++;
   for(const thumbnail of target.thumbnails)add('image',thumbnail,target.alt);
  }finally{completedDetailPages++}
 };
 for(let offset=0;offset<detailTargets.length&&Date.now()<deadline;offset+=6){
  await Promise.all(detailTargets.slice(offset,offset+6).map(fetchDetail));
 }
 for(const target of targets.slice(MAX_DETAIL_PAGES))for(const thumbnail of target.thumbnails)add('image',thumbnail,target.alt);

 for(const video of document.querySelectorAll('video,video source')){
  if(media.length>=MAX_MEDIA)break;
  add('video',video.currentSrc||video.getAttribute('src'),video.getAttribute('aria-label')||'',video.poster||'');
 }
 const description=document.querySelector('meta[name="description"],meta[property="og:description"]')?.content||'';
 const warnings=[];
 if(failedDetailPages)warnings.push(`${failedDetailPages} linked image ${failedDetailPages===1?'page could':'pages could'} not be opened; thumbnails were kept where available.`);
 if(targets.length>MAX_DETAIL_PAGES)warnings.push(`Only the first ${MAX_DETAIL_PAGES} linked image pages were opened.`);
 if(completedDetailPages<detailTargets.length)warnings.push('Some linked image pages were still loading when the extraction time limit was reached.');
 return{
  version:1,
  url:location.href,
  title:document.title||location.hostname,
  description:description.slice(0,1500),
  media,
  truncated:media.length>=MAX_MEDIA||targets.length>MAX_DETAIL_PAGES,
  warning:warnings.join(' ')
 };
}
