async function readResponse(response,feature){
 let payload;
 try{payload=await response.json()}
 catch(error){console.warn(`Grabit received an invalid ${feature} response:`,error);throw new Error(`Grabit couldn't load ${feature}. Please try again.`)}
 if(!response.ok){
  console.warn(`Grabit could not load ${feature}:`,payload.error||response.status);
  throw new Error(`Grabit couldn't load ${feature}. Please try again or save the link for later.`);
 }
 return payload;
}

export async function previewUrl(url,options={},requestOptions={}){
 let response;
 try{response=await fetch('/api/preview',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({url,...options}),signal:requestOptions.signal?AbortSignal.any([requestOptions.signal,AbortSignal.timeout(115000)]):AbortSignal.timeout(115000)})}
 catch(error){if(error.name==='AbortError')throw error;console.warn('Grabit page preview request failed:',error);throw new Error(error.name==='TimeoutError'?'This page is taking too long to load. You can still save the link.':'Could not load this page right now. You can still save the link.')}
 return readResponse(response,'page media');
}

export async function discoverPlaylistUrl(url,options={},requestOptions={}){
 let response;
 try{response=await fetch('/api/playlist',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({url,...options}),signal:requestOptions.signal?AbortSignal.any([requestOptions.signal,AbortSignal.timeout(115000)]):AbortSignal.timeout(115000)})}
 catch(error){if(error.name==='AbortError')throw error;console.warn('Grabit additional media lookup failed:',error);throw new Error(error.name==='TimeoutError'?'Finding more media took too long.':'Could not find more media right now.')}
 return readResponse(response,'additional media');
}

export async function resolveVideoUrl(url){
 let response;
 try{response=await fetch('/api/video/resolve',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({url}),signal:AbortSignal.timeout(115000)})}
 catch(error){console.warn('Grabit could not prepare a video for playback:',error);throw new Error(error.name==='TimeoutError'?'This video is taking too long to load.':'Could not prepare this video. Try the original link.')}
 const payload=await readResponse(response,'video');
 if(!payload.media||typeof payload.media.playbackUrl!=='string')throw new Error('No playable video was found for this link.');
 return payload.media;
}

export function videoDownloadUrl(url,title='video',formatId=''){
 return`/api/video/download?url=${encodeURIComponent(url)}&title=${encodeURIComponent(title)}${formatId?`&format=${encodeURIComponent(formatId)}`:''}`;
}
