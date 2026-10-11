import {spawn} from 'node:child_process';
import {resolvePublicAddress} from './extractor.js';

const MAX_PLAYLIST_ITEMS=500;
const PLAYLIST_PAGE_SIZE=10;
const MAX_OUTPUT_LINES=MAX_PLAYLIST_ITEMS*2+2;
const PROCESS_TIMEOUT_MS=90_000;
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

function runYtDlp(url,{flat=false,items=[]}={}){
 const command=process.env.PYTHON|| (process.platform==='win32'?'python':'python3');
 const outputTemplate='%(title)j\t%(webpage_url)s\t%(url)s\t%(thumbnail)s';
 const args=[
  '-m','yt_dlp',
  '--ignore-config',
  '--no-plugin-dirs',
  '--quiet',
  '--ignore-errors',
  '--skip-download',
 ];
 if(flat)args.push('--flat-playlist','--playlist-end',String(MAX_PLAYLIST_ITEMS),'--print','%(webpage_url)s');
 else args.push('--format','best[ext=mp4]/best[ext=webm]/best','--playlist-items',items.join(','),'--print',outputTemplate);
 args.push('--',url);
 return new Promise((resolve,reject)=>{
  const child=spawn(command,args,{windowsHide:true,stdio:['ignore','pipe','pipe']});
  const chunks=[];
  let outputBytes=0,stderr='',settled=false;
  const finish=(error,result)=>{
   if(settled)return;
   settled=true;clearTimeout(timer);
   if(error)reject(error);else resolve(result);
  };
  const timer=setTimeout(()=>{
   child.kill();
   finish(Object.assign(new Error('yt-dlp timed out while reading the video list.'),{status:504}));
  },PROCESS_TIMEOUT_MS);
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
 });
}

export async function extractVideoCollection(rawUrl,{start=1}={}){
 if(!isVideoCollectionUrl(rawUrl))return null;
 if(!Number.isSafeInteger(start)||start<1||start>MAX_PLAYLIST_ITEMS||((start-1)%PLAYLIST_PAGE_SIZE)!==0){
  throw Object.assign(new Error(`Playlist position must be between 1 and ${MAX_PLAYLIST_ITEMS} in groups of ${PLAYLIST_PAGE_SIZE}.`),{status:400});
 }
 const url=new URL(rawUrl);
 if((url.protocol==='https:'&&url.port&&url.port!=='443')||(url.protocol==='http:'&&url.port&&url.port!=='80')){
  throw new Error('Custom ports are not supported for video-list extraction.');
 }
 const address=await resolvePublicAddress(url.hostname);
 if(!address)throw new Error('This video-list website resolves to a private or unavailable network address.');
 const targetUrl=ytDlpTargetUrl(url.href);
 const itemIndexes=Array.from({length:Math.min(PLAYLIST_PAGE_SIZE,MAX_PLAYLIST_ITEMS-start+1)},(_,index)=>start+index);
 const [listing,result]=await Promise.all([
  runYtDlp(targetUrl,{flat:true}),
  runYtDlp(targetUrl,{items:itemIndexes})
 ]);
 const playlist=parseYtDlpPlaylist(listing.output);
 const selected=playlist.slice(start-1,start-1+PLAYLIST_PAGE_SIZE);
 if(!selected.length)throw new Error(listing.warning?`yt-dlp did not expose any playable videos from this page. ${listing.warning}`:'yt-dlp did not expose any playable videos from this page.');
 const parsed=parseYtDlpOutput(result.output);
 const mediaByUrl=new Map(parsed.media.map(media=>[media.sourceUrl,media]));
 const media=selected.map(item=>mediaByUrl.get(item.url)).filter(Boolean);
 if(!media.length)throw new Error(result.warning?`yt-dlp did not expose any playable videos from this page. ${result.warning}`:'yt-dlp did not expose any playable videos from this page.');
 return{
  media,
  start,
  hasMore:playlist.length>start-1+PLAYLIST_PAGE_SIZE,
  truncated:playlist.length===MAX_PLAYLIST_ITEMS,
  warning:[listing.warning,result.warning].filter(Boolean).join(' ')
 };
}
