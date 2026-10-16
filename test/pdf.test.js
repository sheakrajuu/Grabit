import test from 'node:test';
import assert from 'node:assert/strict';
import {deflateSync} from 'node:zlib';
import {PDFDocument} from 'pdf-lib';
import {createImagePdf} from '../server/pdf.js';

function crc32(bytes){
 let crc=0xffffffff;
 for(const byte of bytes){
  crc^=byte;
  for(let bit=0;bit<8;bit++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);
 }
 return(crc^0xffffffff)>>>0;
}

function pngChunk(name,data){
 const type=Buffer.from(name),length=Buffer.alloc(4),checksum=Buffer.alloc(4);
 length.writeUInt32BE(data.length);
 checksum.writeUInt32BE(crc32(Buffer.concat([type,data])));
 return Buffer.concat([length,type,data,checksum]);
}

function testPng(width,height){
 const header=Buffer.alloc(13);
 header.writeUInt32BE(width,0);header.writeUInt32BE(height,4);header[8]=8;header[9]=6;
 const pixels=Buffer.alloc(height*(1+width*4));
 for(let row=0;row<height;row++)pixels[row*(1+width*4)]=0;
 return Buffer.concat([
  Buffer.from([137,80,78,71,13,10,26,10]),
  pngChunk('IHDR',header),
  pngChunk('IDAT',deflateSync(pixels)),
  pngChunk('IEND',Buffer.alloc(0))
 ]);
}

test('creates one uncropped custom-size PDF page per selected image',async()=>{
 const landscape=testPng(600,300).toString('base64'),portrait=testPng(300,600).toString('base64');
 const bytes=await createImagePdf([
  {data:`data:image/png;base64,${landscape}`},
  {data:`data:image/png;base64,${portrait}`}
 ]);
 const pdf=await PDFDocument.load(bytes),pages=pdf.getPages();
 assert.equal(pages.length,2);
 assert.ok(Math.abs(pages[0].getWidth()-144)<0.01);
 assert.ok(Math.abs(pages[0].getHeight()-72)<0.01);
 assert.ok(Math.abs(pages[1].getWidth()-72)<0.01);
 assert.ok(Math.abs(pages[1].getHeight()-144)<0.01);
});

test('creates PDFs with more than 200 image pages',async()=>{
 const image=`data:image/png;base64,${testPng(1,1).toString('base64')}`;
 const bytes=await createImagePdf(Array.from({length:201},()=>({data:image})));
 const pdf=await PDFDocument.load(bytes);
 assert.equal(pdf.getPages().length,201);
});

test('rejects unsupported image types and empty selections',async()=>{
 await assert.rejects(createImagePdf([{data:'data:image/webp;base64,AAAA'}]),/Only JPEG and PNG/);
 await assert.rejects(createImagePdf([]),/at least one image/);
});
