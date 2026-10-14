import {PDFDocument} from 'pdf-lib';
import {openPublicMedia} from './extractor.js';

export const MAX_PDF_IMAGES=200;
const MAX_PDF_IMAGE_BYTES=25*1024*1024;
const MAX_PDF_TOTAL_IMAGE_BYTES=80*1024*1024;

async function readBoundedStream(stream,limit){
 const chunks=[];let length=0;
 for await(const chunk of stream){
  length+=chunk.length;
  if(length>limit){stream.destroy();throw Object.assign(new Error('An image exceeds the 25 MB PDF limit.'),{status:413})}
  chunks.push(chunk);
 }
 return Buffer.concat(chunks,length);
}

async function imageBytes(entry){
 if(typeof entry?.data==='string'){
  const match=entry.data.match(/^data:(image\/(?:jpeg|png));base64,([A-Za-z0-9+/]*={0,2})$/i);
  if(!match)throw new Error('Only JPEG and PNG images can be added to a PDF.');
  const bytes=Buffer.from(match[2],'base64');
  if(!bytes.length||bytes.length>MAX_PDF_IMAGE_BYTES)throw Object.assign(new Error('An image exceeds the 25 MB PDF limit.'),{status:413});
  return{bytes,type:match[1].toLowerCase()};
 }
 if(typeof entry?.url!=='string'||entry.url.length>2048)throw new Error('Each PDF image must have a valid image URL or JPEG/PNG data.');
 const result=await openPublicMedia(entry.url);
 if(!['image/jpeg','image/png'].includes(result.contentType)){
  result.stream.destroy();
  throw new Error('Only publicly accessible JPEG and PNG images can be added to a PDF.');
 }
 const length=Number(result.contentLength);
 if(Number.isFinite(length)&&length>MAX_PDF_IMAGE_BYTES){result.stream.destroy();throw Object.assign(new Error('An image exceeds the 25 MB PDF limit.'),{status:413})}
 return{bytes:await readBoundedStream(result.stream,MAX_PDF_IMAGE_BYTES),type:result.contentType};
}

export async function createImagePdf(images){
 if(!Array.isArray(images)||images.length<1||images.length>MAX_PDF_IMAGES)throw new Error(`Select between 1 and ${MAX_PDF_IMAGES} images for a PDF.`);
 const document=await PDFDocument.create();
 document.setCreator('Grabit');
 document.setProducer('Grabit');
 let totalBytes=0;
 for(const entry of images){
  const {bytes,type}=await imageBytes(entry);
  totalBytes+=bytes.length;
  if(totalBytes>MAX_PDF_TOTAL_IMAGE_BYTES)throw Object.assign(new Error('Selected images exceed the 80 MB combined PDF limit.'),{status:413});
  const image=type==='image/png'?await document.embedPng(bytes):await document.embedJpg(bytes);
  const width=image.width*72/300,height=image.height*72/300;
  const page=document.addPage([width,height]);
  page.drawImage(image,{x:0,y:0,width,height});
 }
 return Buffer.from(await document.save({useObjectStreams:true}));
}
