import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const exports = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../app/image-dimensions.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,DataView});
const {imageDimensions,imageDimensionMetadata}=exports;
const plain=value=>JSON.parse(JSON.stringify(value));
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2RkcAAAAASUVORK5CYII=','base64');
test('reads PNG dimensions from real bytes and respects nonzero buffer offsets',()=>{
 assert.deepEqual(plain(imageDimensions(png)),{width:1,height:1});
 const padded=Buffer.concat([Buffer.alloc(17),png]);
 assert.deepEqual(plain(imageDimensions(padded.subarray(17))),{width:1,height:1});
 assert.deepEqual(plain(imageDimensionMetadata(png)),{dimensionValidation:'header-v1',imageWidth:'1',imageHeight:'1'});
});
test('parses GIF and baseline/progressive JPEG frame headers without treating EXIF text as dimensions',()=>{
 const gif=Buffer.alloc(13);gif.write('GIF89a');gif.writeUInt16LE(780,6);gif.writeUInt16LE(1500,8);
 assert.deepEqual(plain(imageDimensions(gif)),{width:780,height:1500});
 for(const marker of [0xc0,0xc2]){
  const jpeg=Buffer.from([255,216,255,225,0,4,0,0,255,marker,0,11,8,3,232,7,208,1,1,17,0,255,217]);
  assert.deepEqual(plain(imageDimensions(jpeg)),{width:2000,height:1000});
  jpeg[11]=255;assert.equal(imageDimensions(jpeg),null);
 }
});
test('parses WebP extended, lossy and lossless headers with bounded RIFF chunks',()=>{
 for(const type of ['VP8X','VP8 ','VP8L']){
  const b=Buffer.alloc(30);b.write('RIFF');b.writeUInt32LE(22,4);b.write('WEBP',8);b.write(type,12);b.writeUInt32LE(10,16);
  if(type==='VP8X'){b.writeUIntLE(779,24,3);b.writeUIntLE(1499,27,3);}
  if(type==='VP8 '){b.set([157,1,42],23);b.writeUInt16LE(780,26);b.writeUInt16LE(1500,28);}
  if(type==='VP8L'){b[20]=47;b.writeUInt32LE(779+(1499<<14),21);}
  assert.deepEqual(plain(imageDimensions(b)),{width:780,height:1500});
  b.writeUInt32LE(200,16);assert.equal(imageDimensions(b),null);
 }
});
test('truncated and unsupported bytes never throw or fabricate dimensions',()=>{
 for(let i=0;i<33;i++)assert.equal(imageDimensions(png.subarray(0,i)),null);
 for(const b of [Buffer.alloc(0),Buffer.from('AVIF unknown'),Buffer.from([255,216,255]),Buffer.from([255,216,255,225,0,0])]){
  assert.equal(imageDimensions(b),null);assert.deepEqual(plain(imageDimensionMetadata(b)),{});
 }
 const invalid=Buffer.from(png);invalid.writeUInt32BE(0,16);assert.equal(imageDimensions(invalid),null);
});
