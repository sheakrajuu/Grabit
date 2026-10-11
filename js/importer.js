export async function previewUrl(url){
 let response;
 try{response=await fetch('/api/preview',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({url}),signal:AbortSignal.timeout(12000)})}
 catch(error){throw new Error(error.name==='TimeoutError'?'The preview server timed out. You can still save this URL as a bookmark.':'The preview server is unavailable. Start Grabit with npm start to extract webpage images.')}
 let payload;
 try{payload=await response.json()}catch{throw new Error(`Preview server returned an invalid response (${response.status}).`)}
 if(!response.ok)throw new Error(payload.error||`Preview failed (${response.status}).`);
 return payload;
}
