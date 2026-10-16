import test from 'node:test';
import assert from 'node:assert/strict';
import {inspectLibraryBackup} from '../js/backup.js';

test('inspects valid library data and skips malformed records before restore',()=>{
 const backup={
  format:'grabit-library',
  version:1,
  sections:[{id:'section-1',name:'Saved'},{id:'',name:'Invalid section'}],
  items:[
   {id:'item-1',type:'image',title:'Uploaded image',sectionIds:['section-1'],sourceUrl:'',media:[{type:'image',storedDataUrl:'data:image/png;base64,AA=='}]},
   {id:'item-2',type:'bookmark',title:'Bad URL',sectionIds:[],media:[],sourceUrl:'javascript:alert(1)'},
   {id:'item-3',type:'video',title:'Bad media',sectionIds:[],media:[null]}
  ]
 };
 const result=inspectLibraryBackup(backup);
 assert.deepEqual(result.data.sections,[backup.sections[0]]);
 assert.deepEqual(result.data.items,[backup.items[0]]);
 assert.equal(result.validSections,1);
 assert.equal(result.skippedSections,1);
 assert.equal(result.validItems,1);
 assert.equal(result.skippedItems,2);
});

test('rejects unsupported backup envelopes',()=>{
 assert.throws(()=>inspectLibraryBackup({format:'other',version:1,items:[],sections:[]}),/supported Grabit library backup/);
 assert.throws(()=>inspectLibraryBackup({format:'grabit-library',version:2,items:[],sections:[]}),/supported Grabit library backup/);
});

test('skips duplicate IDs and invalid media URLs',()=>{
 const backup={
  format:'grabit-library',
  version:1,
  sections:[],
  items:[
   {id:'same',type:'bookmark',title:'First',sectionIds:[],media:[],sourceUrl:'https://example.com'},
   {id:'same',type:'bookmark',title:'Duplicate ID',sectionIds:[],media:[],sourceUrl:'https://example.org'},
   {id:'unsafe-media',type:'image',title:'Unsafe media',sectionIds:[],media:[{type:'image',sourceUrl:'file:///secret'}]}
  ]
 };
 const result=inspectLibraryBackup(backup);
 assert.equal(result.validItems,1);
 assert.equal(result.skippedItems,2);
});

test('preserves browser-converted video data while validating its media type',()=>{
 const backup={format:'grabit-library',version:1,sections:[],items:[
  {id:'converted-video',type:'video',title:'Converted',sectionIds:[],media:[{type:'video',storedDataUrl:'data:video/x-matroska;base64,AA==',convertedDataUrl:'data:video/mp4;base64,AQ=='}]},
  {id:'invalid-conversion',type:'image',title:'Invalid conversion',sectionIds:[],media:[{type:'image',convertedDataUrl:'data:video/mp4;base64,AQ=='}]}
 ]};
 const result=inspectLibraryBackup(backup);
 assert.deepEqual(result.data.items,[backup.items[0]]);
 assert.equal(result.skippedItems,1);
});

test('keeps server-hosted file items in library backups',()=>{
 const fileItem={id:'server-file',type:'file',title:'manual.pdf',sectionIds:[],media:[{type:'file',sourceUrl:'https://example.com/api/gallery/files/0123456789abcdef',fileName:'manual.pdf'}]};
 const result=inspectLibraryBackup({format:'grabit-library',version:1,sections:[],items:[fileItem]});
 assert.deepEqual(result.data.items,[fileItem]);
 assert.equal(result.skippedItems,0);
});
