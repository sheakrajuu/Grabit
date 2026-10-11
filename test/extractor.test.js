import test from 'node:test';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {brotliCompressSync,deflateSync,gzipSync} from 'node:zlib';
import {parsePage,bestSrcsetCandidate,resolvePublicAddress,createPinnedLookup,decompress,safeDownloadFilename,downloadPublicMedia,openPublicMedia,extractorLimits} from '../server/extractor.js';
import {videoEmbedUrl,socialMediaEmbed} from '../js/utils.js';

test('extracts page metadata and canonical URL',()=>{
 const html='<title>Example page | Example</title><meta property="og:description" content="Useful page"><link rel="canonical" href="/canonical"><meta property="og:image" content="/cover.jpg">';
 const page=parsePage(html,'https://example.test/source');
 assert.equal(page.title,'Example page');
 assert.equal(page.description,'Useful page');
 assert.equal(page.canonicalUrl,'https://example.test/canonical');
 assert.equal(page.media[0].url,'https://example.test/cover.jpg');
});

test('extracts more than thirty page images',()=>{
 const html=Array.from({length:40},(_,index)=>`<img src="/image-${index}.jpg" alt="Image ${index}">`).join('');
 const page=parsePage(html,'https://example.test/gallery');
 assert.equal(page.media.length,40);
 assert.equal(page.mediaCount,40);
 assert.equal(page.truncated,false);
});

test('prefers the highest-resolution responsive image candidate',()=>{
 const page=parsePage('<img src="/small.jpg" srcset="/small.jpg 320w, /medium.jpg 900w, /large.jpg 1800w">','https://example.test/gallery');
 assert.equal(page.media.length,1);
 assert.equal(page.media[0].url,'https://example.test/large.jpg');
 assert.equal(page.media[0].width,1800);
 assert.deepEqual(bestSrcsetCandidate('/2x.jpg 2x, /3x.jpg 3x','https://example.test/'),{
  url:'https://example.test/3x.jpg',density:3
 });
});

test('returns media limit and reports truncation when a page exceeds the cap',()=>{
 const html=Array.from({length:extractorLimits.maxMedia+1},(_,index)=>`<img src="/image-${index}.jpg">`).join('');
 const page=parsePage(html,'https://example.test/gallery');
 assert.equal(page.media.length,extractorLimits.maxMedia);
 assert.equal(page.truncated,true);
});

test('parses video sources and their poster thumbnails',()=>{
 const page=parsePage('<video poster="/preview.jpg"><source src="/video.mp4"></video>','https://example.test/watch');
 assert.deepEqual(page.media,[{type:'video',url:'https://example.test/video.mp4',thumbnailUrl:'https://example.test/preview.jpg'}]);
});

test('does not include video poster metadata as page image media',()=>{
 const page=parsePage('<meta property="og:image" content="/poster.jpg"><meta property="og:video" content="/video.mp4"><video poster="/frame.jpg"><source src="/video.mp4"></video>','https://example.test/watch');
 assert.deepEqual(page.media,[{type:'video',url:'https://example.test/video.mp4',thumbnailUrl:'https://example.test/frame.jpg'}]);
});

test('retains every discovered video without treating its page image as media',()=>{
 const page=parsePage('<meta property="og:image" content="/poster.jpg"><video><source src="/video-1.mp4"></video><video><source src="/video-2.mp4"></video>','https://example.test/watch');
 assert.deepEqual(page.media.map(media=>media.url),[
  'https://example.test/video-1.mp4',
  'https://example.test/video-2.mp4'
 ]);
 assert.ok(page.media.every(media=>media.type==='video'));
});

test('keeps actual page images alongside video media when both are present',()=>{
 const page=parsePage('<meta property="og:image" content="/poster.jpg"><video poster="/frame.jpg"><source src="/video.mp4"></video><img src="/photo.jpg">','https://example.test/watch');
 assert.deepEqual(page.media.map(media=>[media.type,media.url]),[
  ['image','https://example.test/photo.jpg'],
  ['video','https://example.test/video.mp4']
 ]);
});

test('preserves video media when a page approaches the extraction limit',()=>{
 const html=Array.from({length:extractorLimits.maxMedia},(_,index)=>`<img src="/image-${index}.jpg">`).join('')+'<video src="/video.mp4"></video>';
 const page=parsePage(html,'https://example.test/watch');
 assert.equal(page.media.length,extractorLimits.maxMedia);
 assert.ok(page.media.some(media=>media.type==='video'&&media.url==='https://example.test/video.mp4'));
 assert.equal(page.truncated,true);
});

test('rejects private, loopback, and mapped private IP addresses',async()=>{
 for(const address of ['127.0.0.1','10.0.0.1','169.254.1.2','192.168.1.1','::1','::ffff:127.0.0.1']){
  assert.equal(await resolvePublicAddress(address),null,address);
 }
});

test('rejects hexadecimal IPv4-mapped IPv6 addresses that point to private networks',async()=>{
 for(const address of ['::ffff:7f00:1','::ffff:a00:1','::ffff:c0a8:101']){
  assert.equal(await resolvePublicAddress(address),null,address);
 }
 assert.deepEqual(await resolvePublicAddress('::ffff:808:808'),{address:'::ffff:808:808',family:6});
});

test('rejects hostnames with any private DNS answer',async()=>{
 const result=await resolvePublicAddress('mixed.example',async()=>[
  {address:'203.0.113.10',family:4},
  {address:'192.168.1.5',family:4}
 ]);
 assert.equal(result,null);
});

test('uses a resolved public DNS address for eligible hostnames',async()=>{
 const expected={address:'8.8.8.8',family:4};
 const result=await resolvePublicAddress('public.example',async()=>[expected]);
 assert.deepEqual(result,expected);
});

test('returns pinned addresses in both Node DNS lookup callback formats',()=>{
 const expected={address:'8.8.8.8',family:4};
 const lookup=createPinnedLookup(expected);
 lookup('public.example',{all:true},(error,addresses)=>{
  assert.ifError(error);
  assert.deepEqual(addresses,[expected]);
 });
 lookup('public.example',{all:false},(error,address,family)=>{
  assert.ifError(error);
  assert.equal(address,expected.address);
  assert.equal(family,expected.family);
 });
});

test('decompresses gzip, deflate, and Brotli webpage responses',async()=>{
 const body=Buffer.from('<title>Compressed page</title>');
 const encodings=[
  ['gzip',gzipSync(body)],
  ['deflate',deflateSync(body)],
  ['br',brotliCompressSync(body)]
 ];
 for(const [encoding,compressed]of encodings){
  const response=Readable.from([compressed]);
  response.headers={'content-encoding':encoding};
  assert.deepEqual(await decompress(response),body,encoding);
 }
});

test('sanitizes attachment filenames before returning download headers',()=>{
 assert.equal(safeDownloadFilename('../folder/bad:name?.jpg'),'_folder_bad_name_.jpg');
 assert.equal(safeDownloadFilename(''),'download');
});

test('rejects non-HTTP and private-network download targets',async()=>{
 await assert.rejects(downloadPublicMedia('ftp://example.test/file.jpg'),/Only public HTTP or HTTPS/);
 await assert.rejects(downloadPublicMedia('http://127.0.0.1/file.jpg'),/private or unavailable/);
});

test('streamed downloads reject non-HTTP and private-network targets',async()=>{
 await assert.rejects(openPublicMedia('ftp://example.test/file.mp4'),/Only public HTTP or HTTPS/);
 await assert.rejects(openPublicMedia('http://127.0.0.1/file.mp4'),/private or unavailable/);
});

test('creates approved public player URLs for supported social video links',()=>{
 assert.equal(videoEmbedUrl('https://youtu.be/Abcdef12345'),'https://www.youtube-nocookie.com/embed/Abcdef12345?rel=0');
 assert.equal(videoEmbedUrl('https://vimeo.com/12345678'),'https://player.vimeo.com/video/12345678');
 assert.equal(videoEmbedUrl('https://www.tiktok.com/@creator/video/1234567890123456789'),'https://www.tiktok.com/player/v1/1234567890123456789?autoplay=0');
 assert.equal(videoEmbedUrl('https://www.instagram.com/reel/AbCdEf12/'),'https://www.instagram.com/reel/AbCdEf12/embed/');
 assert.equal(videoEmbedUrl('https://x.com/creator/status/1234567890123456789'),'https://platform.twitter.com/embed/Tweet.html?id=1234567890123456789');
 assert.equal(videoEmbedUrl('javascript:alert(1)'),'');
});

test('creates public social-media embeds for image posts and videos',()=>{
 assert.deepEqual(socialMediaEmbed('https://www.instagram.com/p/AbCdEf12/'),{
  type:'image',url:'https://www.instagram.com/p/AbCdEf12/embed/'
 });
 assert.deepEqual(socialMediaEmbed('https://www.instagram.com/reel/AbCdEf12/'),{
  type:'video',url:'https://www.instagram.com/reel/AbCdEf12/embed/'
 });
 assert.deepEqual(socialMediaEmbed('https://www.facebook.com/creator/posts/123456789'),{
  type:'image',url:'https://www.facebook.com/plugins/post.php?href=https%3A%2F%2Fwww.facebook.com%2Fcreator%2Fposts%2F123456789&show_text=false'
 });
 const facebookVideo=socialMediaEmbed('https://www.facebook.com/watch/?v=123456789');
 assert.equal(facebookVideo.type,'video');
 assert.match(facebookVideo.url,/facebook\.com\/plugins\/video\.php\?href=/);
 assert.deepEqual(socialMediaEmbed('https://www.pinterest.com/pin/123456789012345678/'),{
  type:'image',url:'https://assets.pinterest.com/ext/embed.html?id=123456789012345678'
 });
 assert.equal(socialMediaEmbed('https://www.facebook.com/'),null);
});
