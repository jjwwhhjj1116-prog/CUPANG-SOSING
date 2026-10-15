import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import sharp from 'sharp';
const exports={};
vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../app/image-dimensions.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,DataView});
const plain=value=>value===null?null:JSON.parse(JSON.stringify(value));
for(const format of ['jpeg','png','webp'])test(`${format} EXIF orientation matches visible dimensions while raw header dimensions stay unchanged`,async()=>{
 for(let orientation=1;orientation<=8;orientation++){
  const bytes=await sharp({create:{width:7,height:13,channels:3,background:'#73ab82'}}).withMetadata({orientation})[format]().toBuffer();
  assert.deepEqual(plain(exports.imageDimensions(bytes)),{width:7,height:13});
  assert.deepEqual(plain(exports.imageDisplayDimensions(bytes)),orientation>=5?{width:13,height:7}:{width:7,height:13});
 }
});
test('JPEG EXIF metadata stays bounded to its TIFF chunk and conflicting orientation is rejected',async()=>{
 const original=await sharp({create:{width:7,height:13,channels:3,background:'#73ab82'}}).withMetadata({orientation:6}).jpeg().toBuffer();
 const start=original.indexOf(Buffer.from('Exif\0\0'))+6,view=new DataView(original.buffer,original.byteOffset,original.length),little=original.toString('ascii',start,start+2)==='II',directory=start+view.getUint32(start+4,little);
 const badOffset=Buffer.from(original);badOffset.writeUInt32LE(0xfffffffe,start+4);assert.equal(exports.imageDisplayDimensions(badOffset),null);
 const badCount=Buffer.from(original);new DataView(badCount.buffer,badCount.byteOffset,badCount.length).setUint16(directory,6000,little);assert.equal(exports.imageDisplayDimensions(badCount),null);
 let entry;for(let i=0;i<view.getUint16(directory,little);i++){const offset=directory+2+i*12;if(view.getUint16(offset,little)===0x112)entry=offset;}
 assert.ok(entry);const badType=Buffer.from(original);new DataView(badType.buffer,badType.byteOffset,badType.length).setUint16(entry+2,4,little);assert.equal(exports.imageDisplayDimensions(badType),null);
 const badValue=Buffer.from(original);new DataView(badValue.buffer,badValue.byteOffset,badValue.length).setUint16(entry+8,9,little);assert.equal(exports.imageDisplayDimensions(badValue),null);
 // Copy a second complete APP1 EXIF segment with contradictory IFD0 orientation.
 const marker=original.indexOf(Buffer.from([0xff,0xe1])),length=original.readUInt16BE(marker+2)+2,segment=Buffer.from(original.subarray(marker,marker+length));
 const relativeEntry=entry-marker;new DataView(segment.buffer,segment.byteOffset,segment.length).setUint16(relativeEntry+8,1,little);
 assert.equal(exports.imageDisplayDimensions(Buffer.concat([original.subarray(0,2),segment,original.subarray(2)])),null);
});
test('unoriented images preserve dimensions and truncated unsupported input stays unverified',async()=>{
 for(const format of ['jpeg','png','webp','gif']){const bytes=await sharp({create:{width:7,height:13,channels:3,background:'#73ab82'}})[format]().toBuffer();assert.deepEqual(plain(exports.imageDisplayDimensions(bytes)),{width:7,height:13});}
 for(const bytes of [Buffer.alloc(0),Buffer.from('not an image'),Buffer.from([0xff,0xd8,0xff,0xe1,0xff,0xff])])assert.equal(exports.imageDisplayDimensions(bytes),null);
});
test('big-endian IFD0 orientation is interpreted without following thumbnail IFD pointers',async()=>{
 const jpeg=await sharp({create:{width:7,height:13,channels:3,background:'#73ab82'}}).jpeg().toBuffer(),tiff=Buffer.alloc(26);
 tiff.write('MM',0);tiff.writeUInt16BE(42,2);tiff.writeUInt32BE(8,4);tiff.writeUInt16BE(1,8);tiff.writeUInt16BE(0x112,10);tiff.writeUInt16BE(3,12);tiff.writeUInt32BE(1,14);tiff.writeUInt16BE(8,18);tiff.writeUInt32BE(0xfffffff0,22);
 const segment=Buffer.concat([Buffer.from('Exif\0\0'),tiff]),prefix=Buffer.from([0xff,0xe1,0,0]);prefix.writeUInt16BE(segment.length+2,2);
 assert.deepEqual(plain(exports.imageDisplayDimensions(Buffer.concat([jpeg.subarray(0,2),prefix,segment,jpeg.subarray(2)]))),{width:13,height:7});
});
