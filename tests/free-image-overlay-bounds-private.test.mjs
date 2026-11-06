import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import sharp from 'sharp';
import cvReady from '@techstark/opencv-js';
const file=process.env.IMAGE_MASK_PRIVATE_FIXTURE;
test('private image17 source glyph spill is covered while photographs/logos/independent next line stay exact',{skip:!file},async t=>{
 const cache=new Map();function load(file){if(cache.has(file))return cache.get(file);const exports={};cache.set(file,exports);vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../'+file,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,Error,Uint8ClampedArray,Uint8Array,Int32Array,require:name=>load(name.slice(2)+'.ts')});return exports;}
 const {data,info}=await sharp(file).ensureAlpha().raw().toBuffer({resolveWithObject:true});assert.deepEqual([info.width,info.height],[750,590]);
 const originals=[[99,109,209,27],[112,155,173,46],[45,224,293,45],[82,474,233,26],[37,519,308,51]].map(([x,y,width,height])=>({x,y,width,height}));
 const blocks=originals.map((box,i)=>({id:`vision-${i+1}`,text:'원본 증거',translated:'검토용 한국어',issue:null,kind:'overlay',box}));
 const reader={getImageData(x,y,w,h){const pixels=new Uint8ClampedArray(w*h*4);for(let yy=0;yy<h;yy++)pixels.set(data.subarray(((y+yy)*info.width+x)*4,((y+yy)*info.width+x+w)*4),yy*w*4);return{data:pixels};}};
 const refined=load('app/free-image-overlay-bounds.ts').refineFlatOverlayBounds(blocks,reader,info.width,info.height),inside=(x,y,b)=>x>=b.x&&x<b.x+b.width&&y>=b.y&&y<b.y+b.height;
 assert.ok(refined.every((box,i)=>JSON.stringify(box)!==JSON.stringify(originals[i])),'all five clipped glyph groups require correction');
 let spill=0;const points=[];
 for(let n=0;n<originals.length;n++){const box=originals[n];for(let y=Math.max(0,box.y-12);y<Math.min(info.height,box.y+box.height+2);y++)for(let x=Math.max(0,box.x-12);x<Math.min(info.width,box.x+box.width+12);x++){
  const i=(y*info.width+x)*4;if(!inside(x,y,box)&&Math.min(data[i],data[i+1],data[i+2])<220){spill++;points.push([x,y]);assert.ok(inside(x,y,refined[n]),`original glyph spill ${n+1} at ${x},${y}`);}
 }}
 assert.ok(spill>=521,`must include the reported 521 dark source pixels, got ${spill}`);
 const core=load('app/free-image-inpaint.ts'),cv=await cvReady,output=new Uint8ClampedArray(data);
 for(const group of core.groupFreeImageInpaintRois(refined,info.width,info.height)){
  const {roi,masks}=group,pixels=reader.getImageData(roi.x,roi.y,roi.width,roi.height).data,result=core.inpaintFreeImagePixels(cv,{width:roi.width,height:roi.height,data:pixels,masks});
  for(const box of masks)for(let y=box.y;y<box.y+box.height;y++)for(let x=box.x;x<box.x+box.width;x++)output.set(result.subarray((y*roi.width+x)*4,(y*roi.width+x)*4+4),((y+roi.y)*info.width+x+roi.x)*4);
 }
 let photoChanges=0;for(let y=0;y<info.height;y++)for(let x=0;x<info.width;x++){const i=(y*info.width+x)*4;if(!refined.some(b=>inside(x,y,b)))assert.deepEqual([...output.subarray(i,i+4)],[...data.subarray(i,i+4)],`protected/outside ${x},${y}`);if(x>=365&&output.subarray(i,i+4).some((v,c)=>v!==data[i+c]))photoChanges++;}
 assert.equal(photoChanges,0);assert.ok(points.every(([x,y])=>Math.min(...output.subarray((y*info.width+x)*4,(y*info.width+x)*4+3))>=230),'covered source ink must become flat-panel background');
 t.diagnostic(JSON.stringify({refined,sourceSpillPixels:spill,uncoveredSpill:0,photoChanges}));
});
