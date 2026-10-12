import test from 'node:test';
import assert from 'node:assert/strict';
import {matchesContentType} from '../js/library-filter.js';

test('matches standalone library items to their selected type',()=>{
 for(const type of ['bookmark','image','video','gallery','playlist','note']){
  assert.equal(matchesContentType({type,media:[]},type),true);
  assert.equal(matchesContentType({type,media:[]},'all'),true);
 }
});

test('image and video filters include matching media inside groups and saved pages',()=>{
 const gallery={type:'gallery',media:[{type:'image'}]};
 const playlist={type:'playlist',media:[{type:'video'}]};
 const bookmark={type:'bookmark',media:[],sourcePages:[{media:[{type:'image'},{type:'video'}]}]};
 assert.equal(matchesContentType(gallery,'image'),true);
 assert.equal(matchesContentType(playlist,'video'),true);
 assert.equal(matchesContentType(bookmark,'image'),true);
 assert.equal(matchesContentType(bookmark,'video'),true);
 assert.equal(matchesContentType(gallery,'video'),false);
 assert.equal(matchesContentType(playlist,'image'),false);
});

test('specific group filters remain distinct from image and video filters',()=>{
 assert.equal(matchesContentType({type:'gallery',media:[{type:'image'}]},'gallery'),true);
 assert.equal(matchesContentType({type:'gallery',media:[{type:'image'}]},'playlist'),false);
 assert.equal(matchesContentType({type:'playlist',media:[{type:'video'}]},'playlist'),true);
 assert.equal(matchesContentType({type:'playlist',media:[{type:'video'}]},'gallery'),false);
});
