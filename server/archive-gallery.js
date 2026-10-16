import yauzl from 'yauzl';
import path from 'node:path';

const IMAGE_TYPES=new Map([['.avif','image/avif'],['.bmp','image/bmp'],['.gif','image/gif'],['.jpeg','image/jpeg'],['.jpg','image/jpeg'],['.png','image/png'],['.webp','image/webp']]);
const ARCHIVE_EXTENSIONS=new Set(['.cbz','.epub','.zip']);
const MAX_CONCURRENT_PAGE_WRITES=8;

export function isImageArchive(name){return ARCHIVE_EXTENSIONS.has(path.extname(name).toLowerCase())}

function openEntry(zip,entry){return new Promise((resolve,reject)=>zip.openReadStream(entry,(error,stream)=>error?reject(error):resolve(stream)))}

export async function extractArchiveGallery(archivePath,galleryId,galleryTitle,store){
 const zip=await new Promise((resolve,reject)=>yauzl.open(archivePath,{lazyEntries:true,autoClose:true,decodeStrings:true},(error,file)=>error?reject(error):resolve(file)));
 const pages=[];
 const activeTasks=new Set(),queuedEntries=[];
 try{
  await new Promise((resolve,reject)=>{
    let settled=false,readingEnded=false,readPending=false,active=0;
     const finish=()=>{if(!settled&&readingEnded&&!active&&!queuedEntries.length){settled=true;resolve()}};
     const fail=error=>{if(settled)return;settled=true;zip.close();reject(error)};
    const requestNext=()=>{
     if(!settled&&!readingEnded&&!readPending&&active<MAX_CONCURRENT_PAGE_WRITES){readPending=true;zip.readEntry()}
    };
     const drain=()=>{
        while(!settled&&active<MAX_CONCURRENT_PAGE_WRITES&&queuedEntries.length){
         const entry=queuedEntries.shift();active++;
         const task=(async()=>{
            const entryPath=entry.fileName.replace(/\\/g,'/'),extension=path.posix.extname(entryPath).toLowerCase(),contentType=IMAGE_TYPES.get(extension);
            let entryName=path.posix.basename(entryPath).replace(/[\u0000-\u001f\u007f]/g,'').trim();
            if(!entryName||entryName==='.'||entryName==='..')entryName=`page-${pages.length+1}${extension}`;
            const stream=await openEntry(zip,entry),page=await store.create(entryName,contentType,stream,{galleryId,galleryTitle,galleryPage:true,entryName});
            pages.push(page);
         })();
         activeTasks.add(task);
         task.then(()=>activeTasks.delete(task),error=>{activeTasks.delete(task);fail(error)}).finally(()=>{active--;drain();finish()});
        }
        requestNext();
        finish();
     };
   zip.on('error',fail);
         zip.on('end',()=>{readPending=false;readingEnded=true;finish()});
   zip.on('entry',entry=>{
        readPending=false;
    if(settled)return;
        const extension=path.posix.extname(entry.fileName.replace(/\\/g,'/')).toLowerCase();
        if(!IMAGE_TYPES.has(extension)||entry.fileName.endsWith('/')){requestNext();return}
        queuedEntries.push(entry);drain();
   });
         requestNext();
  });
  return pages;
 }catch(error){
  zip.close();
    await Promise.allSettled(activeTasks);
  await Promise.all(pages.map(page=>store.remove(page.id).catch(()=>{})));
  throw error;
 }
}