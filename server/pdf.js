import {PDFDocument} from 'pdf-lib';
import {chromium} from 'playwright';
import {openPublicMedia} from './extractor.js';

const CONVERTIBLE_IMAGE_TYPES=new Set(['image/webp','image/gif','image/avif','image/bmp']);

async function rasterizeImage(bytes,type,browser){
 const page=await browser.newPage();
 try{
  const dataUrl=`data:${type};base64,${bytes.toString('base64')}`;
  const png=await page.evaluate(async source=>{
   const image=new Image();image.src=source;await image.decode();
   const canvas=document.createElement('canvas');canvas.width=image.naturalWidth;canvas.height=image.naturalHeight;
   const context=canvas.getContext('2d');if(!context)throw new Error('Image processing is unavailable.');
   context.drawImage(image,0,0);
   return canvas.toDataURL('image/png').split(',')[1];
  },dataUrl);
  return{bytes:Buffer.from(png,'base64'),type:'image/png'};
 }catch{
  throw new Error(`The selected ${type} image could not be converted for the PDF.`);
 }finally{await page.close()}
}

async function imageBytes(entry,getBrowser){
 let image;
 if(typeof entry?.data==='string'){
  const match=entry.data.match(/^data:(image\/[a-z0-9.+-]+);base64,([A-Za-z0-9+/]*={0,2})$/i);
  if(!match)throw new Error('Each PDF image must have a supported image data URL.');
  const bytes=Buffer.from(match[2],'base64');
  if(!bytes.length)throw new Error('The selected image is empty.');
  image={bytes,type:match[1].toLowerCase()};
 }else{
  if(typeof entry?.url!=='string'||entry.url.length>2048)throw new Error('Each PDF image must have a valid image URL or image data.');
  const result=await openPublicMedia(entry.url);
  const type=result.contentType==='image/jpg'||result.contentType==='image/pjpeg'?'image/jpeg':result.contentType;
  if(!type.startsWith('image/')){
   result.stream.destroy();
   throw new Error('The selected URL does not contain an image.');
  }
  const chunks=[];let length=0;
  for await(const chunk of result.stream){length+=chunk.length;chunks.push(chunk)}
  image={bytes:Buffer.concat(chunks,length),type};
 }
 if(!image.bytes.length)throw new Error('The selected image is empty.');
 if(image.type==='image/jpeg'||image.type==='image/png')return image;
 if(!CONVERTIBLE_IMAGE_TYPES.has(image.type))throw new Error('PDF export supports JPEG, PNG, WebP, GIF, AVIF, and BMP images.');
 return rasterizeImage(image.bytes,image.type,await getBrowser());
}

export async function createImagePdf(images){
 if(!Array.isArray(images)||images.length<1)throw new Error('Select at least one image for a PDF.');
 const document=await PDFDocument.create();
 let browser;
 const getBrowser=async()=>browser||(browser=await chromium.launch({headless:true}));
 document.setCreator('Grabit');
 document.setProducer('Grabit');
 try{
  for(const entry of images){
   const {bytes,type}=await imageBytes(entry,getBrowser);
   const image=type==='image/png'?await document.embedPng(bytes):await document.embedJpg(bytes);
   const width=image.width*72/300,height=image.height*72/300;
   const page=document.addPage([width,height]);
   page.drawImage(image,{x:0,y:0,width,height});
  }
  return Buffer.from(await document.save({useObjectStreams:true}));
 }finally{
  if(browser)await browser.close();
 }
}
