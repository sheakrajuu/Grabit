import {PDFDocument} from 'pdf-lib';
import {openPublicMedia} from './extractor.js';

async function readStream(stream){
 const chunks=[];let length=0;
 for await(const chunk of stream){length+=chunk.length;chunks.push(chunk)}
 return Buffer.concat(chunks,length);
}

async function imageBytes(entry){
 if(typeof entry?.data==='string'){
  const match=entry.data.match(/^data:(image\/(?:jpeg|png));base64,([A-Za-z0-9+/]*={0,2})$/i);
  if(!match)throw new Error('Only JPEG and PNG images can be added to a PDF.');
  const bytes=Buffer.from(match[2],'base64');
    if(!bytes.length)throw new Error('The selected image is empty.');
  return{bytes,type:match[1].toLowerCase()};
 }
 if(typeof entry?.url!=='string'||entry.url.length>2048)throw new Error('Each PDF image must have a valid image URL or JPEG/PNG data.');
 const result=await openPublicMedia(entry.url);
 const type=result.contentType==='image/jpg'||result.contentType==='image/pjpeg'?'image/jpeg':result.contentType;
 if(!['image/jpeg','image/png'].includes(type)){
  result.stream.destroy();
  throw new Error('Only publicly accessible JPEG and PNG images can be added to a PDF.');
 }
 return{bytes:await readStream(result.stream),type};
}

export async function createImagePdf(images){
 if(!Array.isArray(images)||images.length<1)throw new Error('Select at least one image for a PDF.');
 const document=await PDFDocument.create();
 document.setCreator('Grabit');
 document.setProducer('Grabit');
 for(const entry of images){
  const {bytes,type}=await imageBytes(entry);
  const image=type==='image/png'?await document.embedPng(bytes):await document.embedJpg(bytes);
  const width=image.width*72/300,height=image.height*72/300;
  const page=document.addPage([width,height]);
  page.drawImage(image,{x:0,y:0,width,height});
 }
 return Buffer.from(await document.save({useObjectStreams:true}));
}
