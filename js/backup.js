import {validUrl} from './utils.js';

const ITEM_TYPES=new Set(['bookmark','note','image','video','gallery','playlist']);

export function inspectLibraryBackup(data){
 if(data?.format!=='grabit-library'||data.version!==1||!Array.isArray(data.items)||!Array.isArray(data.sections)){
  throw new Error('This is not a supported Grabit library backup.');
 }
 const sectionIds=new Set(),sections=[];
 for(const section of data.sections){
  if(!section||typeof section!=='object'||Array.isArray(section)||typeof section.id!=='string'||!section.id.trim()||typeof section.name!=='string'||!section.name.trim()||sectionIds.has(section.id))continue;
  sectionIds.add(section.id);sections.push(section);
 }
 const itemIds=new Set(),items=[];
 for(const item of data.items){
  if(!item||typeof item!=='object'||Array.isArray(item)||typeof item.id!=='string'||!item.id.trim()||itemIds.has(item.id)
   ||typeof item.title!=='string'||!ITEM_TYPES.has(item.type)||!Array.isArray(item.media)||!Array.isArray(item.sectionIds)
   ||item.sectionIds.some(id=>typeof id!=='string')
   ||(item.sourceUrl!==undefined&&(typeof item.sourceUrl!=='string'||Boolean(item.sourceUrl&&!validUrl(item.sourceUrl))))
   ||item.media.some(media=>!validMedia(media)))continue;
  itemIds.add(item.id);items.push(item);
 }
 return{
  data:{...data,sections,items},
  validItems:items.length,
  skippedItems:data.items.length-items.length,
  validSections:sections.length,
  skippedSections:data.sections.length-sections.length
 };
}

function validMedia(media){
 if(!media||typeof media!=='object'||Array.isArray(media)||!['image','video'].includes(media.type))return false;
 if(media.sourceUrl!==undefined&&(typeof media.sourceUrl!=='string'||Boolean(media.sourceUrl&&!validUrl(media.sourceUrl))))return false;
 if(media.storedDataUrl!==undefined&&media.storedDataUrl!==null){
  if(typeof media.storedDataUrl!=='string')return false;
  const expected=media.type==='image'?'data:image/':'data:video/';
  if(!media.storedDataUrl.startsWith(expected))return false;
 }
 if(media.convertedDataUrl!==undefined&&(media.type!=='video'||typeof media.convertedDataUrl!=='string'||!media.convertedDataUrl.startsWith('data:video/')))return false;
 for(const key of ['url','playbackUrl','thumbnailUrl']){
  if(media[key]!==undefined&&media[key]!==''&&media[key]!==null&&(typeof media[key]!=='string'||!validUrl(media[key])))return false;
 }
 return true;
}
