export function matchesContentType(item,filter){
 if(filter==='all')return true;
 if(['bookmark','note','file','gallery','playlist'].includes(filter))return item.type===filter;
 if(filter!=='image'&&filter!=='video')return false;
 if(item.type===filter)return true;
 if((item.media||[]).some(media=>media.type===filter))return true;
 return(item.sourcePages||[]).some(page=>(page.media||[]).some(media=>media.type===filter));
}
