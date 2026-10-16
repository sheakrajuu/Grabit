import {chromium} from 'playwright';
import {parsePage} from './extractor.js';
import {createPublicProxy} from './public-proxy.js';

const MAX_RENDERED_IMAGES=2000;
const MAX_BUTTON_CLICKS=12;
const MAX_SCROLL_STEPS=24;
const MAX_RENDER_TIME_MS=35_000;
const MAX_BROWSER_REQUESTS=900;
const LOAD_ALL_LABEL=/\b(?:show|view|see|load|display)\s+all\b|\ball\s+(?:photos?|images?|pictures?)\b/i;
const LOAD_MORE_LABEL=/\b(?:show|view|see|load|display)\s+(?:all|more|all\s+(?:photos?|images?|pictures?))\b|\b(?:load|show)\s+more\b|\b(?:all|more)\s+(?:photos?|images?|pictures?)\b(?!\s+(?:shown|loaded|displayed|visible|complete))/i;
const browserSlots=[];
let activeBrowsers=0;
const MAX_ACTIVE_BROWSERS=2;

function acquireBrowserSlot(){
 if(activeBrowsers<MAX_ACTIVE_BROWSERS){activeBrowsers++;return Promise.resolve()}
 return new Promise(resolve=>browserSlots.push(resolve));
}

function releaseBrowserSlot(){
 const next=browserSlots.shift();
 if(next)next();
 else activeBrowsers--;
}

function escapeAttribute(value){
 return String(value||'').slice(0,4000).replace(/[&<>"']/g,character=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]));
}

function renderedImagesHtml(images,title){
 const imageTags=images.map(image=>{
  const attributes=[
   ['src',image.currentSrc||image.src],
   ['srcset',[image.srcset,...image.pictureSrcsets].filter(Boolean).join(', ')],
   ['data-srcset',image.dataSrcset],
   ['data-original',image.dataOriginal],
   ['data-lazy-src',image.dataLazySrc],
   ['data-src',image.dataSrc],
   ['data-url',image.dataUrl],
   ['alt',image.alt],
   ['title',image.title],
   ['width',image.width],
   ['height',image.height]
  ].filter(([,value])=>value!==null&&value!==undefined&&value!=='')
   .map(([name,value])=>`${name}="${escapeAttribute(value)}"`).join(' ');
  return`<img ${attributes}>`;
 }).join('');
 return`<title>${escapeAttribute(title)}</title>${imageTags}`;
}

export function parseRenderedImages(images,pageUrl,title){
 return parsePage(renderedImagesHtml(images,title),pageUrl);
}

async function expandVisibleGalleries(page,deadline){
 let clicked=0;
 while(clicked<MAX_BUTTON_CLICKS&&Date.now()<deadline){
  const matches=await page.locator('button,[role="button"],a').evaluateAll((elements,pattern)=>elements
   .map((element,index)=>({
    index,
    label:(element.getAttribute('aria-label')||element.getAttribute('title')||element.innerText||element.textContent||'').replace(/\s+/g,' ').trim(),
    visible:element.getClientRects().length>0&&getComputedStyle(element).visibility!=='hidden'
   }))
   .filter(({label,visible})=>visible&&label&&new RegExp(pattern,'i').test(label)),LOAD_MORE_LABEL.source);
  const match=matches.find(({label})=>LOAD_ALL_LABEL.test(label))||matches[0];
  if(!match)break;
  try{
   await page.locator('button,[role="button"],a').nth(match.index).click({timeout:1200,noWaitAfter:true});
   clicked++;
   await page.waitForTimeout(350);
  }catch(error){
   if(/timeout|not visible|not enabled|detached/i.test(error.message))break;
   throw error;
  }
 }
 return clicked;
}

async function loadLazyImages(page,deadline){
 let stableSteps=0,previousState='';
 for(let step=0;step<MAX_SCROLL_STEPS&&Date.now()<deadline&&stableSteps<3;step++){
  await page.evaluate(()=>{
   const viewHeight=window.innerHeight||800;
   window.scrollBy(0,Math.max(400,viewHeight*.8));
   for(const element of document.querySelectorAll('*')){
    if(element.scrollHeight>element.clientHeight+200&&element.clientHeight>100){
     element.scrollTop=Math.min(element.scrollHeight,element.scrollTop+Math.max(300,element.clientHeight*.75));
    }
   }
  });
  await page.waitForTimeout(300);
  await expandVisibleGalleries(page,deadline);
  const state=await page.evaluate(()=>`${document.images.length}:${document.documentElement.scrollHeight}`);
  if(state===previousState)stableSteps++;
  else stableSteps=0;
  previousState=state;
 }
}

export async function extractRenderedPage(rawUrl,{launchBrowser=options=>chromium.launch(options),createProxy=createPublicProxy}={}){
 await acquireBrowserSlot();
 let proxy,browser;
 try{
  proxy=await createProxy();
  browser=await launchBrowser({
   headless:true,
   proxy:{server:proxy.url,bypass:'<-loopback>'},
   args:['--disable-dev-shm-usage']
  });
  const context=await browser.newContext({serviceWorkers:'block',acceptDownloads:false});
  const page=await context.newPage();
  let requests=0,trustedOrigin='';
  await page.route('**/*',async route=>{
   requests++;
   const request=route.request();
   if(trustedOrigin&&request.isNavigationRequest()&&request.frame()===page.mainFrame()&&new URL(request.url()).origin!==trustedOrigin){
    await route.fulfill({status:204,body:''});
    return;
   }
   if(requests>MAX_BROWSER_REQUESTS||!/^https?:$/.test(new URL(request.url()).protocol)||['font','media','websocket'].includes(request.resourceType())){
    await route.abort();
    return;
   }
   await route.continue();
  });
  const deadline=Date.now()+MAX_RENDER_TIME_MS;
  await page.goto(rawUrl,{waitUntil:'domcontentloaded',timeout:15_000});
  trustedOrigin=new URL(page.url()).origin;
  await page.waitForTimeout(500);
  await expandVisibleGalleries(page,deadline);
  await loadLazyImages(page,deadline);
  const extracted=await page.evaluate(limit=>{
   const images=Array.from(document.images).slice(0,limit).map(image=>({
    src:image.getAttribute('src'),
    currentSrc:image.currentSrc,
    srcset:image.getAttribute('srcset'),
    dataSrcset:image.getAttribute('data-srcset'),
    dataOriginal:image.getAttribute('data-original'),
    dataLazySrc:image.getAttribute('data-lazy-src'),
    dataSrc:image.getAttribute('data-src'),
    dataUrl:image.getAttribute('data-url'),
    alt:image.getAttribute('alt'),
    title:image.getAttribute('title'),
    width:image.getAttribute('width'),
    height:image.getAttribute('height'),
    pictureSrcsets:Array.from(image.closest('picture')?.querySelectorAll('source')||[]).map(source=>source.getAttribute('srcset')).filter(Boolean)
   }));
   for(const link of document.querySelectorAll('a[href]')){
    if(images.length>=limit||!/\.(?:avif|bmp|gif|jpe?g|png|webp)(?:[?#]|$)/i.test(link.href))continue;
    images.push({src:link.href,currentSrc:'',srcset:'',dataSrcset:'',dataOriginal:'',dataLazySrc:'',dataSrc:'',dataUrl:'',alt:link.getAttribute('aria-label')||link.innerText||'',title:link.getAttribute('title')||'',width:'',height:'',pictureSrcsets:[]});
   }
   return{title:document.title,finalUrl:location.href,images};
  },MAX_RENDERED_IMAGES);
  return{
   ...parseRenderedImages(extracted.images,extracted.finalUrl,extracted.title),
   finalUrl:extracted.finalUrl,
   truncated:extracted.images.length>=MAX_RENDERED_IMAGES
  };
 }finally{
  if(browser)await browser.close();
  if(proxy)proxy.close();
  releaseBrowserSlot();
 }
}
