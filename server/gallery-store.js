import {randomBytes} from 'node:crypto';
import {mkdir,readdir,readFile,stat,writeFile,rename,unlink} from 'node:fs/promises';
import {createWriteStream} from 'node:fs';
import {pipeline} from 'node:stream/promises';
import path from 'node:path';

function safeName(value){
 const name=path.basename(String(value||'')).replace(/[\u0000-\u001f\u007f]/g,'').trim();
 if(!name||name==='.'||name==='..')throw Object.assign(new Error('Provide a valid file name.'),{status:400});
 return name;
}

export function createGalleryStore(directory=path.resolve(process.env.GALLERY_UPLOAD_DIR||'data/gallery')){
 async function ensureDirectory(){await mkdir(directory,{recursive:true})}
 async function list(){
  await ensureDirectory();
  const entries=await readdir(directory),files=[];
  for(const entry of entries.filter(name=>name.endsWith('.json'))){
   try{
    const metadata=JSON.parse(await readFile(path.join(directory,entry),'utf8'));
    const info=await stat(path.join(directory,`${metadata.id}.bin`));
    if(typeof metadata.id==='string'&&typeof metadata.name==='string')files.push({...metadata,size:info.size,url:`/api/gallery/files/${metadata.id}`});
   }catch(error){if(error.code!=='ENOENT')console.warn('Ignoring invalid server gallery metadata:',error.message)}
  }
  return files.sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
 }
 return{
  async list(){return list()},
    async create(name,contentType,source,extraMetadata={}){
     const filename=safeName(name),id=randomBytes(12).toString('base64url');
     const createdAt=new Date().toISOString(),metadata={id,name:filename,contentType:String(contentType||'application/octet-stream'),createdAt,...extraMetadata};
   await ensureDirectory();
   const dataPath=path.join(directory,`${id}.bin`),metadataPath=path.join(directory,`${id}.json`),temporaryMetadata=`${metadataPath}.tmp`;
     try{await pipeline(source,createWriteStream(dataPath,{flags:'wx'}));metadata.size=(await stat(dataPath)).size;await writeFile(temporaryMetadata,JSON.stringify(metadata),{flag:'wx'});await rename(temporaryMetadata,metadataPath)}
   catch(error){await Promise.all([unlink(dataPath).catch(()=>{}),unlink(temporaryMetadata).catch(()=>{})]);throw error}
   return{...metadata,url:`/api/gallery/files/${id}`};
  },
  async setGallerySource(id,pageCount){
   const metadataPath=path.join(directory,`${id}.json`),temporaryMetadata=`${metadataPath}.tmp`,metadata=JSON.parse(await readFile(metadataPath,'utf8'));
   Object.assign(metadata,{galleryId:id,galleryTitle:metadata.name,gallerySource:true,galleryPageCount:pageCount});
   await writeFile(temporaryMetadata,JSON.stringify(metadata),{flag:'wx'});await rename(temporaryMetadata,metadataPath);
   return{...metadata,url:`/api/gallery/files/${id}`};
  },
  async remove(id){await Promise.all([unlink(path.join(directory,`${id}.bin`)),unlink(path.join(directory,`${id}.json`))])},
  dataPath(id){return path.join(directory,`${id}.bin`)},
  async read(id){
   if(!/^[A-Za-z0-9_-]{16}$/.test(id))return null;
   try{
    const metadata=JSON.parse(await readFile(path.join(directory,`${id}.json`),'utf8'));
    const dataPath=path.join(directory,`${id}.bin`),info=await stat(dataPath);
    return{...metadata,dataPath,size:info.size};
   }catch(error){if(error.code==='ENOENT')return null;throw error}
  }
 };
}