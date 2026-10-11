import {spawn} from 'node:child_process';
import {resolvePublicAddress} from './extractor.js';
import {createPublicProxy} from './public-proxy.js';

const MAX_PLAYLIST_ITEMS=500;
const PLAYLIST_PAGE_SIZE=10;
export const playlistPageSize=PLAYLIST_PAGE_SIZE;
export const maxPlaylistItems=MAX_PLAYLIST_ITEMS;
const MAX_OUTPUT_LINES=MAX_PLAYLIST_ITEMS*2+2;
const PROCESS_TIMEOUT_MS=30_000;
const MAX_OUTPUT_BYTES=16*1024*1024;
const VIDEO_COLLECTION_HOSTS=new Set(['xhofficial.com','xhamster.com']);

export function isVideoCollectionUrl(rawUrl){
 let url;
 try{url=new URL(rawUrl)}catch{return false}
 const hostname=url.hostname.toLowerCase().replace(/^www\./,'');
 return ['http:','https:'].includes(url.protocol)
  &&!url.username&&!url.password
  &&VIDEO_COLLECTION_HOSTS.has(hostname)
  &&/^\/users\/[^/]+\/videos\/?$/i.test(url.pathname);
}

export function ytDlpTargetUrl(rawUrl){
 const url=new URL(rawUrl);
 if(url.hostname.toLowerCase().replace(/^www\./,'')==='xhofficial.com')url.hostname='xhamster.com';
 return url.href;
}

function publicHttpUrl(value){
 if(typeof value!=='string'||!value||value==='NA')return '';
 try{
  const url=new URL(value);
  return ['http:','https:'].includes(url.protocol)&&!url.username&&!url.password?url.href:'';
 }catch{return ''}
}

export function parseYtDlpOutput(output){
 const seen=new Set(),media=[];
 const lines=String(output).split(/\r?\n/).filter(Boolean);
 for(const line of lines.slice(0,MAX_OUTPUT_LINES)){
  const [rawTitle,rawPageUrl,rawMediaUrl,rawThumbnail='']=line.split('\t');
  const pageUrl=publicHttpUrl(rawPageUrl);
  const directUrl=publicHttpUrl(rawMediaUrl);
  if(!pageUrl&&!directUrl)continue;
  const stableUrl=pageUrl||directUrl;
  const key=stableUrl;
  if(seen.has(key))continue;
  seen.add(key);
  const streamUrl=directUrl&&directUrl!==pageUrl?directUrl:'';
  let title='';
  try{title=JSON.parse(rawTitle)}catch{title=rawTitle||''}
  if(title==='NA')title='';
  const thumbnailUrl=publicHttpUrl(rawThumbnail);
  media.push({
   type:'video',
   url:stableUrl,
   sourceUrl:stableUrl,
   providerUrl:stableUrl,
   ...(streamUrl?{playbackUrl:streamUrl}:{embedUrl:stableUrl}),
   thumbnailUrl,
   alt:title
  });
 }
 return{media:media.slice(0,MAX_PLAYLIST_ITEMS),truncated:media.length>MAX_PLAYLIST_ITEMS};
}

export function parseYtDlpPlaylist(output){
 const seen=new Set(),items=[];
 let index=0;
 for(const line of String(output).split(/\r?\n/).filter(Boolean).slice(0,MAX_OUTPUT_LINES)){
  const url=publicHttpUrl(line.trim());
  if(!url)continue;
  index++;
  if(seen.has(url))continue;
  seen.add(url);
  items.push({url,index});
 }
 return items.slice(0,MAX_PLAYLIST_ITEMS);
}

const BROWSER_VIDEO_FORMAT='best[protocol=https][ext=mp4]/best[protocol=http][ext=mp4]/best[protocol=https][ext=webm]/best[protocol=http][ext=webm]';
async function spawnYtDlp(args){
 const command=process.env.PYTHON||(process.platform==='win32'?'python':'python3');
 const proxy=await createPublicProxy();
 const child=spawn(command,['-m','yt_dlp','--proxy',proxy.url,'--socket-timeout','12','--retries','1','--extractor-retries','1',...args],{windowsHide:true,stdio:['ignore','pipe','pipe']});
 child.once('close',()=>proxy.close());
 child.once('error',()=>proxy.close());
 return child;
}

function runYtDlp(url,{flat=false,items=[],json=false}={}){
 const outputTemplate='%(title)j\t%(webpage_url)s\t%(url)s\t%(thumbnail)s';
 const args=[
  '--ignore-config',
  '--no-plugin-dirs',
  '--quiet',
  '--ignore-errors',
  '--skip-download',
 ];
 if(flat)args.push('--flat-playlist','--playlist-end',String(MAX_PLAYLIST_ITEMS),'--print','%(webpage_url)s');
 else if(json)args.push('--no-playlist','--format',BROWSER_VIDEO_FORMAT,'--dump-single-json');
 else args.push('--format','best[ext=mp4]/best[ext=webm]/best','--playlist-items',items.join(','),'--print',outputTemplate);
 args.push('--',url);
 return new Promise((resolve,reject)=>{
  let child;
  const chunks=[];
  let outputBytes=0,stderr='',settled=false;
  const finish=(error,result)=>{
   if(settled)return;
   settled=true;clearTimeout(timer);
   if(error)reject(error);else resolve(result);
  };
  const timer=setTimeout(()=>{
   child?.kill();
   finish(Object.assign(new Error('yt-dlp timed out while processing the video URL.'),{status:504}));
  },PROCESS_TIMEOUT_MS);
  spawnYtDlp(args).then(process=>{
   child=process;
   if(settled){child.kill();return}
   child.stdout.on('data',chunk=>{
    outputBytes+=chunk.length;
    if(outputBytes>MAX_OUTPUT_BYTES){
     child.kill();
     finish(Object.assign(new Error('The video list exceeded Grabit’s 16 MB extraction limit.'),{status:413}));
     return;
    }
    chunks.push(chunk);
   });
   child.stderr.on('data',chunk=>{if(stderr.length<8192)stderr+=chunk.toString('utf8').slice(0,8192-stderr.length)});
   child.on('error',error=>{
    if(error.code==='ENOENT')finish(Object.assign(new Error('yt-dlp is not available on this server. Install the Python requirements and restart Grabit.'),{status:503}));
    else finish(new Error(`Could not start yt-dlp: ${error.message}`));
   });
   child.on('close',code=>{
    if(settled)return;
    const output=Buffer.concat(chunks).toString('utf8');
    if(code!==0){
     if(/No module named ['"]?yt_dlp/.test(stderr)){
      finish(Object.assign(new Error('yt-dlp is not installed on this server. Install the Python requirements and restart Grabit.'),{status:503}));
      return;
     }
     const detail=stderr.trim().split(/\r?\n/).filter(Boolean).at(-1);
     finish(null,{output,warning:detail?`yt-dlp exited with status ${code}: ${detail}`:`yt-dlp exited with status ${code}.`});
     return;
    }
    finish(null,{output,warning:stderr.trim()});
   });
  }).catch(error=>finish(error));
 });
}

export function parseResolvedVideo(output,sourceUrl){
 let info;
 try{info=JSON.parse(output)}catch{throw new Error('The video provider returned invalid video details.')}
 const playbackUrl=publicHttpUrl(info.url);
 const pageUrl=publicHttpUrl(info.webpage_url)||publicHttpUrl(sourceUrl);
 if(!playbackUrl||!pageUrl)throw new Error('No browser-playable video stream was exposed for this URL.');
 const extension=typeof info.ext==='string'&&/^[a-z0-9]{2,5}$/i.test(info.ext)?info.ext.toLowerCase():'mp4';
 const formatId=typeof info.format_id==='string'&&/^[\w.-]{1,80}$/.test(info.format_id)?info.format_id:'';
 return{
  type:'video',
  url:pageUrl,
  sourceUrl:pageUrl,
  providerUrl:pageUrl,
  playbackUrl,
  thumbnailUrl:publicHttpUrl(info.thumbnail),
  alt:typeof info.title==='string'?info.title.slice(0,500):'',
  extension,
  formatId
 };
}

async function validatePublicVideoUrl(rawUrl){
 let url;
 try{url=new URL(rawUrl)}catch{throw Object.assign(new Error('Enter a valid video URL.'),{status:400})}
 if(!['http:','https:'].includes(url.protocol)||url.username||url.password)throw Object.assign(new Error('Only public HTTP or HTTPS video URLs are supported.'),{status:400});
 if((url.protocol==='https:'&&url.port&&url.port!=='443')||(url.protocol==='http:'&&url.port&&url.port!=='80'))throw Object.assign(new Error('Custom ports are not supported for video extraction.'),{status:400});
 const address=await resolvePublicAddress(url.hostname);
 if(!address)throw Object.assign(new Error('This video website resolves to a private or unavailable network address.'),{status:422});
 return url.href;
}

export async function resolveVideo(rawUrl){
 const url=await validatePublicVideoUrl(rawUrl);
 const result=await runYtDlp(url,{json:true});
 if(!result.output.trim())throw new Error(result.warning||'No playable video was exposed. The video may require sign-in or be blocked by its provider.');
 const media=parseResolvedVideo(result.output,url);
 const address=await resolvePublicAddress(new URL(media.playbackUrl).hostname);
 if(!address)throw new Error('The video stream resolves to a private or unavailable network address.');
 return media;
}

export async function startVideoDownload(rawUrl,formatId=''){
 const url=await validatePublicVideoUrl(rawUrl);
 const args=['--ignore-config','--no-plugin-dirs','--no-warnings','--quiet','--no-progress','--no-playlist','--format',formatId||BROWSER_VIDEO_FORMAT,'--output','-','--',url];
 return new Promise((resolve,reject)=>{
  let child;
  let settled=false,stderr='',timedOut=false;
  let timer;
  const finish=(error,keepTimer=false)=>{
   if(settled)return;
   settled=true;if(!keepTimer&&timer)clearTimeout(timer);
   if(error)reject(error);else resolve(child);
  };
  spawnYtDlp(args).then(process=>{
   child=process;
   child.videoDownloadTimedOut=false;
   timer=setTimeout(()=>{timedOut=true;child.videoDownloadTimedOut=true;child.kill()},30*60_000);
   child.stderr.on('data',chunk=>{if(stderr.length<8192)stderr+=chunk.toString('utf8').slice(0,8192-stderr.length)});
   child.once('error',error=>finish(error.code==='ENOENT'?Object.assign(new Error('yt-dlp is not available on this server.'),{status:503}):new Error(`Could not start yt-dlp: ${error.message}`)));
   child.stdout.once('data',chunk=>{
    child.stdout.unshift(chunk);
    finish(null,true);
   });
   child.once('close',code=>{
    clearTimeout(timer);
    if(!settled){
     const missingYtDlp=/No module named ['"]?yt_dlp/.test(stderr);
     const message=timedOut?'The video download timed out.':missingYtDlp?'yt-dlp is not installed on this server. Install the Python requirements and restart Grabit.':stderr.trim().split(/\r?\n/).filter(Boolean).at(-1)||`yt-dlp exited with status ${code}.`;
     finish(Object.assign(new Error(message),{status:timedOut?504:missingYtDlp?503:422}));
    }
   });
  }).catch(error=>finish(error));
 });
}

export async function extractVideoCollection(rawUrl,{start=1}={}){
 if(!Number.isSafeInteger(start)||start<1||start>MAX_PLAYLIST_ITEMS||((start-1)%PLAYLIST_PAGE_SIZE)!==0){
  throw Object.assign(new Error(`Playlist position must be between 1 and ${MAX_PLAYLIST_ITEMS} in groups of ${PLAYLIST_PAGE_SIZE}.`),{status:400});
 }
 const targetUrl=ytDlpTargetUrl(await validatePublicVideoUrl(rawUrl));
 const listing=await runYtDlp(targetUrl,{flat:true});
 const playlist=parseYtDlpPlaylist(listing.output);
 if(!playlist.length)return null;
 const selected=playlist.slice(start-1,start-1+PLAYLIST_PAGE_SIZE);
 if(!selected.length)throw new Error(listing.warning?`yt-dlp did not expose any videos at this position. ${listing.warning}`:'yt-dlp did not expose any videos at this position.');
 const result=await runYtDlp(targetUrl,{items:selected.map(item=>item.index)});
 const parsed=parseYtDlpOutput(result.output);
 const mediaByUrl=new Map(parsed.media.map(media=>[media.sourceUrl,media]));
 const media=selected.map(item=>mediaByUrl.get(item.url)).filter(Boolean);
 if(!media.length)throw new Error(result.warning?`yt-dlp did not expose any playable videos from this page. ${result.warning}`:'yt-dlp did not expose any playable videos from this page.');
 return{
  media,
  start,
  hasMore:playlist.length>start-1+PLAYLIST_PAGE_SIZE,
  playlistPaging:isVideoCollectionUrl(rawUrl)||playlist.length>1,
  truncated:playlist.length===MAX_PLAYLIST_ITEMS,
  warning:[listing.warning,result.warning].filter(Boolean).join(' ')
 };
}
