export const MAX_VIDEO_UPLOAD_BYTES=100*1024*1024;

const VIDEO_MIME_BY_EXTENSION={mp4:'video/mp4',m4v:'video/mp4',mov:'video/quicktime',webm:'video/webm',ogv:'video/ogg',ogg:'video/ogg',mkv:'video/x-matroska',avi:'video/x-msvideo',wmv:'video/x-ms-wmv',flv:'video/x-flv',mpeg:'video/mpeg',mpg:'video/mpeg',m2ts:'video/mp2t',mts:'video/mp2t',ts:'video/mp2t',vob:'video/dvd',asf:'video/x-ms-asf','3gp':'video/3gpp','3g2':'video/3gpp2'};
const MAX_UGOIRA_ZIP_BYTES=80*1024*1024;
const MAX_UGOIRA_FRAME_BYTES=25*1024*1024;
const MAX_UGOIRA_TOTAL_FRAME_BYTES=80*1024*1024;

export function isVideoFile(file){
 const extension=file?.name?.split('.').pop()?.toLowerCase()||'';
 return Boolean(file&&(file.type?.startsWith('video/')||VIDEO_MIME_BY_EXTENSION[extension]));
}

export function videoFile(file){
 if(!isVideoFile(file))throw new Error('Choose a valid video file.');
 if(file.size>MAX_VIDEO_UPLOAD_BYTES)throw new Error('Videos must be 100 MB or smaller.');
 const extension=String(file.name||'').split('.').pop()?.toLowerCase()||'';
 const mimeType=file.type?.startsWith('video/')?file.type:VIDEO_MIME_BY_EXTENSION[extension];
 return{blob:file,mimeType,size:file.size};
}

function validateSignal(signal){
 if(signal?.aborted)throw new DOMException('Conversion cancelled.','AbortError');
}

async function decodeZipEntry(archive,entry,signal){
 validateSignal(signal);
 const view=new DataView(archive),offset=entry.offset;
 if(offset+30>archive.byteLength||view.getUint32(offset,true)!==0x04034b50)throw new Error('The Pixiv animation archive is invalid.');
 const dataOffset=offset+30+view.getUint16(offset+26,true)+view.getUint16(offset+28,true);
 if(dataOffset+entry.compressedSize>archive.byteLength)throw new Error('The Pixiv animation archive is truncated.');
 const compressed=archive.slice(dataOffset,dataOffset+entry.compressedSize);
 let output;
 if(entry.method===0)output=compressed;
 else if(entry.method===8){
  if(typeof DecompressionStream!=='function')throw new Error('This browser cannot unpack Pixiv animations. Use a recent version of Chrome, Edge, or Firefox.');
  const reader=new Blob([compressed]).stream().pipeThrough(new DecompressionStream('deflate-raw')).getReader(),chunks=[];let length=0;
  try{
   while(true){
    validateSignal(signal);
    const{done,value}=await reader.read();if(done)break;
    length+=value.length;
    if(length>MAX_UGOIRA_FRAME_BYTES){await reader.cancel();throw new Error('A Pixiv animation frame exceeds the 25 MB limit.')}
    chunks.push(value);
   }
  }finally{reader.releaseLock()}
  output=new Uint8Array(length);let position=0;for(const chunk of chunks){output.set(chunk,position);position+=chunk.length}
 }else throw new Error('The Pixiv animation uses an unsupported ZIP compression method.');
 if(output.byteLength!==entry.size||output.byteLength>MAX_UGOIRA_FRAME_BYTES)throw new Error('A Pixiv animation frame is incomplete or too large.');
 return output;
}

function zipEntries(archive){
 const view=new DataView(archive),minimum=Math.max(0,archive.byteLength-65557);let end=-1;
 for(let offset=archive.byteLength-22;offset>=minimum;offset--)if(view.getUint32(offset,true)===0x06054b50){end=offset;break}
 if(end<0||view.getUint16(end+4,true)!==0||view.getUint16(end+6,true)!==0)throw new Error('Pixiv returned an invalid animation ZIP file.');
 const count=view.getUint16(end+10,true),centralSize=view.getUint32(end+12,true),centralOffset=view.getUint32(end+16,true);
 if(count>500||centralOffset+centralSize>archive.byteLength)throw new Error('The Pixiv animation archive exceeds the supported limits.');
 const entries=new Map();let offset=centralOffset;
 for(let index=0;index<count;index++){
  if(offset+46>archive.byteLength||view.getUint32(offset,true)!==0x02014b50)throw new Error('The Pixiv animation archive has an invalid file list.');
  const method=view.getUint16(offset+10,true),compressedSize=view.getUint32(offset+20,true),size=view.getUint32(offset+24,true),nameLength=view.getUint16(offset+28,true),extraLength=view.getUint16(offset+30,true),commentLength=view.getUint16(offset+32,true),localOffset=view.getUint32(offset+42,true);
  if(offset+46+nameLength+extraLength+commentLength>archive.byteLength)throw new Error('The Pixiv animation archive has a truncated file list.');
  const name=new TextDecoder().decode(new Uint8Array(archive,offset+46,nameLength));
  if(!name.includes('/')&&!name.includes('\\')&&name!=='..'&&size<=MAX_UGOIRA_FRAME_BYTES)entries.set(name,{method,compressedSize,size,offset:localOffset});
  offset+=46+nameLength+extraLength+commentLength;
 }
 return entries;
}

async function loadFfmpeg(signal,onProgress,onStatus){
 const {FFmpeg}=await import('../vendor/ffmpeg/ffmpeg/index.js');
 const ffmpeg=new FFmpeg();
 const coreBase=new URL('../vendor/ffmpeg/core/',import.meta.url);
 let terminated=false;
 const abort=()=>{if(!terminated){terminated=true;ffmpeg.terminate()}};
 validateSignal(signal);
 signal?.addEventListener('abort',abort,{once:true});
 onStatus('Loading the on-device video converter. Its first download is about 31 MB.');
 try{
  await ffmpeg.load({
   coreURL:new URL('ffmpeg-core.js',coreBase).href,
   wasmURL:new URL('ffmpeg-core.wasm',coreBase).href
  },{signal});
  ffmpeg.on('progress',({progress})=>onProgress(Number.isFinite(progress)?Math.max(0,Math.min(1,progress)):0));
  return{ffmpeg,abort};
 }catch(error){
  signal?.removeEventListener('abort',abort);
  abort();
  throw error;
 }
}

export async function transcodeForBrowser(blob,{signal,onProgress=()=>{},onStatus=()=>{}}={}){
 const{ffmpeg,abort}=await loadFfmpeg(signal,onProgress,onStatus);
 try{
  validateSignal(signal);
  onStatus('Preparing the video on this device.');
  await ffmpeg.writeFile('input-video',new Uint8Array(await blob.arrayBuffer()),{signal});
  validateSignal(signal);
  onStatus('Converting video locally. Large videos may take several minutes.');
  const status=await ffmpeg.exec(['-i','input-video','-map','0:v:0','-map','0:a:0?','-vf','scale=trunc(iw/2)*2:trunc(ih/2)*2,format=yuv420p','-c:v','libx264','-preset','ultrafast','-crf','22','-pix_fmt','yuv420p','-c:a','aac','-b:a','128k','-movflags','+faststart','playable.mp4'],-1,{signal});
  if(status!==0)throw new Error('The video could not be converted by the local decoder.');
  const output=await ffmpeg.readFile('playable.mp4');
  if(!(output instanceof Uint8Array)||!output.byteLength)throw new Error('The converter produced an empty video.');
  return new Blob([output],{type:'video/mp4'});
 }finally{
  signal?.removeEventListener('abort',abort);
  abort();
 }
}

export async function preparePixivUgoira(animation,{signal,onProgress=()=>{},onStatus=()=>{}}={}){
 const zipUrl=animation?.zipUrl,frames=animation?.frames;
 let parsed;
 try{parsed=new URL(zipUrl)}catch{throw new Error('Pixiv did not provide a valid animation archive URL.')}
 if(parsed.protocol!=='https:'||!['i.pximg.net','i-f.pximg.net'].includes(parsed.hostname.toLowerCase())||!parsed.pathname.toLowerCase().endsWith('.zip')||!Array.isArray(frames)||!frames.length||frames.length>500)throw new Error('Pixiv returned unsupported animation metadata.');
 validateSignal(signal);
 onStatus('Downloading Pixiv animation frames through Grabit.');
 const response=await fetch(`/api/pixiv-ugoira?url=${encodeURIComponent(parsed.href)}`,{signal});
 if(!response.ok){let message='Could not download the Pixiv animation archive.';try{message=(await response.json()).error||message}catch{}throw new Error(message)}
 const archive=await response.arrayBuffer();
 if(!archive.byteLength||archive.byteLength>MAX_UGOIRA_ZIP_BYTES)throw new Error('The Pixiv animation archive is empty or exceeds the 80 MB limit.');
 const entries=zipEntries(archive),{ffmpeg,abort}=await loadFfmpeg(signal,onProgress,onStatus);
 try{
  let totalBytes=0;const concat=[];
  for(let index=0;index<frames.length;index++){
   validateSignal(signal);
   const frame=frames[index],entry=entries.get(frame.file);
   if(!entry)throw new Error('A Pixiv animation frame is missing from its archive.');
   const data=await decodeZipEntry(archive,entry,signal);
   totalBytes+=data.byteLength;
   if(totalBytes>MAX_UGOIRA_TOTAL_FRAME_BYTES)throw new Error('The Pixiv animation frames exceed the 80 MB processing limit.');
   const extension=/\.png$/i.test(frame.file)?'png':'jpg',filename=`frame-${String(index).padStart(6,'0')}.${extension}`;
   await ffmpeg.writeFile(filename,data,{signal});
   concat.push(`file '${filename}'`,`duration ${(Math.max(20,Number(frame.delay)||0)/1000).toFixed(3)}`);
   onProgress((index+1)/frames.length);
  }
  validateSignal(signal);
  const lastExtension=/\.png$/i.test(frames.at(-1).file)?'png':'jpg';
  concat.push(`file 'frame-${String(frames.length-1).padStart(6,'0')}.${lastExtension}'`);
  await ffmpeg.writeFile('frames.txt',new TextEncoder().encode(concat.join('\n')+'\n'),{signal});
  onStatus('Converting Pixiv animation to a browser-playable MP4 on this device.');
  const status=await ffmpeg.exec(['-f','concat','-safe','0','-i','frames.txt','-vf','scale=trunc(iw/2)*2:trunc(ih/2)*2,format=yuv420p','-an','-c:v','libx264','-preset','ultrafast','-crf','18','-pix_fmt','yuv420p','-movflags','+faststart','playable.mp4'],-1,{signal});
  if(status!==0)throw new Error('The Pixiv animation could not be converted by the local decoder.');
  const output=await ffmpeg.readFile('playable.mp4');
  if(!(output instanceof Uint8Array)||!output.byteLength)throw new Error('The Pixiv animation converter produced an empty video.');
  return new Blob([output],{type:'video/mp4'});
 }finally{
  signal?.removeEventListener('abort',abort);
  abort();
 }
}
