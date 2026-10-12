export const MAX_VIDEO_UPLOAD_BYTES=100*1024*1024;

const VIDEO_MIME_BY_EXTENSION={mp4:'video/mp4',m4v:'video/mp4',mov:'video/quicktime',webm:'video/webm',ogv:'video/ogg',ogg:'video/ogg',mkv:'video/x-matroska',avi:'video/x-msvideo',wmv:'video/x-ms-wmv',flv:'video/x-flv',mpeg:'video/mpeg',mpg:'video/mpeg',m2ts:'video/mp2t',mts:'video/mp2t',ts:'video/mp2t',vob:'video/dvd',asf:'video/x-ms-asf','3gp':'video/3gpp','3g2':'video/3gpp2'};

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

export async function transcodeForBrowser(blob,{signal,onProgress=()=>{},onStatus=()=>{}}={}){
 const {FFmpeg}=await import('../vendor/ffmpeg/ffmpeg/index.js');
 const ffmpeg=new FFmpeg();
 const coreBase=new URL('../vendor/ffmpeg/core/',import.meta.url);
 const abort=()=>ffmpeg.terminate();
 try{
  if(signal?.aborted)throw new DOMException('Conversion cancelled.','AbortError');
  signal?.addEventListener('abort',abort,{once:true});
  onStatus('Loading the on-device video converter. Its first download is about 31 MB.');
  await ffmpeg.load({
   coreURL:new URL('ffmpeg-core.js',coreBase).href,
   wasmURL:new URL('ffmpeg-core.wasm',coreBase).href
  },{signal});
  if(signal?.aborted)throw new DOMException('Conversion cancelled.','AbortError');
  ffmpeg.on('progress',({progress})=>onProgress(Number.isFinite(progress)?Math.max(0,Math.min(1,progress)):0));
  onStatus('Preparing the video on this device.');
  await ffmpeg.writeFile('input-video',new Uint8Array(await blob.arrayBuffer()),{signal});
  if(signal?.aborted)throw new DOMException('Conversion cancelled.','AbortError');
  onStatus('Converting video locally. Large videos may take several minutes.');
  const status=await ffmpeg.exec([
   '-i','input-video',
   '-map','0:v:0',
   '-map','0:a:0?',
   '-c:v','libx264',
   '-preset','ultrafast',
   '-crf','24',
   '-c:a','aac',
   '-b:a','128k',
   '-movflags','+faststart',
   'playable.mp4'
  ],-1,{signal});
  if(status!==0)throw new Error('The video could not be converted by the local decoder.');
  const output=await ffmpeg.readFile('playable.mp4');
  if(!(output instanceof Uint8Array)||!output.byteLength)throw new Error('The converter produced an empty video.');
  return new Blob([output],{type:'video/mp4'});
 }finally{
  signal?.removeEventListener('abort',abort);
  ffmpeg.terminate();
 }
}
