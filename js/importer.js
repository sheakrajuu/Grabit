export async function previewUrl(url,options={}){
 let response;
 try{response=await fetch('/api/preview',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({url,...options}),signal:AbortSignal.timeout(115000)})}
 catch(error){throw new Error(error.name==='TimeoutError'?'The preview server timed out. You can still save this URL as a bookmark.':'The preview server is unavailable. Start Grabit with npm start to extract webpage images.')}
 let payload;
 try{payload=await response.json()}catch{throw new Error(`Preview server returned an invalid response (${response.status}).`)}
 if(!response.ok)throw new Error(payload.error||`Preview failed (${response.status}).`);
 return payload;
}

export async function resolveVideoUrl(url){
 let response;
 try{response=await fetch('/api/video/resolve',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({url}),signal:AbortSignal.timeout(115000)})}
 catch(error){throw new Error(error.name==='TimeoutError'?'The video provider took too long to find a playable stream.':'The video resolver is unavailable. Try opening the original provider player instead.')}
 let payload;
 try{payload=await response.json()}catch{throw new Error(`Video resolver returned an invalid response (${response.status}).`)}
 if(!response.ok)throw new Error(payload.error||`Video resolution failed (${response.status}).`);
 if(!payload.media||typeof payload.media.playbackUrl!=='string')throw new Error('No playable video stream was found for this URL.');
 return payload.media;
}

export function videoDownloadUrl(url,title='video'){
 return`/api/video/download?url=${encodeURIComponent(url)}&title=${encodeURIComponent(title)}`;
}
