import test from 'node:test';
import assert from 'node:assert/strict';
import {MAX_VIDEO_UPLOAD_BYTES,isVideoFile,videoFile} from '../js/video-transcoder.js';

test('video uploads accept files up to 100 MB and preserve them as blobs',()=>{
 const file={name:'clip.mkv',type:'application/octet-stream',size:MAX_VIDEO_UPLOAD_BYTES};
 const result=videoFile(file);
 assert.equal(result.blob,file);
 assert.equal(result.mimeType,'video/x-matroska');
 assert.equal(result.size,MAX_VIDEO_UPLOAD_BYTES);
});

test('video uploads reject files larger than 100 MB',()=>{
 assert.throws(()=>videoFile({name:'clip.mp4',type:'video/mp4',size:MAX_VIDEO_UPLOAD_BYTES+1}),/100 MB or smaller/);
});

test('video detection recognizes uncommon extensions with generic MIME types',()=>{
 assert.equal(isVideoFile({name:'clip.m2ts',type:'application/octet-stream'}),true);
 assert.equal(isVideoFile({name:'clip.txt',type:'text/plain'}),false);
});
