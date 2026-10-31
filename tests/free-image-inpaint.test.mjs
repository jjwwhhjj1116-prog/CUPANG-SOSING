import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {createHash} from 'node:crypto';
import cvReady from '@techstark/opencv-js';

const cv=await cvReady,cache=new Map();
function load(file){
 if(cache.has(file))return cache.get(file);const exports={};cache.set(file,exports);
 vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../'+file,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,
  {exports,Error,Uint8ClampedArray,Uint8Array,Number,Promise,AbortController,AbortSignal,setTimeout,clearTimeout,require(name){assert.ok(name.startsWith('@/'));return load(name.slice(2)+'.ts');}});return exports;
}
const core=load('app/free-image-inpaint.ts'),{createFreeImageInpaintSession:session}=load('app/free-image-inpaint-client.ts');
function picture(){
 const width=80,height=56,mask={x:28,y:20,width:24,height:16},data=new Uint8ClampedArray(width*height*4),clean=new Uint8ClampedArray(data.length);
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){
  const index=(y*width+x)*4;
  clean.set([70+x*2,50+y*3,120+Math.floor(x/8),40+(x*7+y*3)%216],index);
  data.set(clean.subarray(index,index+4),index);
  if(x>=mask.x&&x<mask.x+mask.width&&y>=mask.y&&y<mask.y+mask.height&&(x%5<2||y%6<2))data.set([0,0,0,clean[index+3]],index);
 }
 return{width,height,mask,data,clean};
}
const inside=(x,y,b)=>x>=b.x&&x<b.x+b.width&&y>=b.y&&y<b.y+b.height;
function unchangedOutside(input,output){
 for(let y=0;y<input.height;y++)for(let x=0;x<input.width;x++){
  const i=(y*input.width+x)*4;assert.equal(output[i+3],input.data[i+3],`alpha ${x},${y}`);
  if(!inside(x,y,input.mask))assert.deepEqual(output.slice(i,i+4),input.data.slice(i,i+4),`outside ${x},${y}`);
 }
}
test('published pinned OpenCV restores synthetic text on a gradient, differs from a flat fill, and preserves exact outside RGBA/source/alpha',()=>{
 const input=picture(),before=input.data.slice(),output=core.inpaintFreeImagePixels(cv,input),colors=new Set();let sourceError=0,restoredError=0;
 for(let y=input.mask.y;y<input.mask.y+input.mask.height;y++)for(let x=input.mask.x;x<input.mask.x+input.mask.width;x++){
  const i=(y*input.width+x)*4;colors.add(Array.from(output.slice(i,i+3)).join(','));
  for(let c=0;c<3;c++){sourceError+=Math.abs(input.data[i+c]-input.clean[i+c]);restoredError+=Math.abs(output[i+c]-input.clean[i+c]);}
 }
 assert.ok(colors.size>30,'restored mask retains a varying background');assert.ok(restoredError<sourceError/3,{sourceError,restoredError});
 unchangedOutside(input,output);assert.deepEqual(input.data,before);assert.notEqual(output.buffer,input.data.buffer);
});
test('ROI context clips at image edges and refuses full-image masks or oversized allocations',()=>{
 assert.deepEqual(JSON.parse(JSON.stringify(core.freeImageInpaintRoi({x:0,y:0,width:10,height:10},100,60))),{x:0,y:0,width:22,height:22});
 assert.throws(()=>core.freeImageInpaintRoi({x:0,y:0,width:100,height:60},100,60));
 assert.throws(()=>core.freeImageInpaintRoi({x:0,y:0,width:16000,height:2000},16000,3000));
 for(const patch of [{mask:{x:-1,y:0,width:1,height:1}},{data:new Uint8ClampedArray(3)},{height:NaN}])assert.throws(()=>core.inpaintFreeImagePixels(cv,{...picture(),...patch}));
});
test('every allocated Mat is deleted after OpenCV throws; invalid output cannot be accepted',()=>{
 const made=[];class Mat{constructor(){this.data=new Uint8Array(80*56);made.push(this);}delete(){assert.equal(this.deleted,undefined);this.deleted=true;}static zeros(){return new Mat();}}
 const fake={Mat,matFromArray(){return new Mat();},cvtColor(){throw Error('CV failed');},inpaint(){assert.fail('conversion failed');},CV_8UC4:1,CV_8UC1:2,COLOR_RGBA2RGB:3,INPAINT_TELEA:1};
 assert.throws(()=>core.inpaintFreeImagePixels(fake,picture()),/CV failed/);assert.equal(made.length,4);assert.ok(made.every(mat=>mat.deleted));
 fake.cvtColor=()=>{};fake.inpaint=()=>{};assert.throws(()=>core.inpaintFreeImagePixels(fake,picture()),/크기/);assert.ok(made.every(mat=>mat.deleted));
});
function workerFixture(behavior){
 const made=[];return{made,factory(){const worker={terminateCount:0,requests:[],postMessage(request){this.requests.push(request);behavior?.(this,request);},terminate(){this.terminateCount++;}};made.push(worker);return worker;}};
}
test('lazy session reuses one worker sequentially, independently owns buffers, and defends outside pixels/alpha against worker output',async()=>{
 const fixture=workerFixture((worker,request)=>queueMicrotask(()=>worker.onmessage({data:{id:request.id,width:request.width,height:request.height,data:new Uint8ClampedArray(request.data.length).fill(247)}})));
 const controller=new AbortController(),work=session(controller.signal,{workerFactory:()=>fixture.factory()}),input=picture(),before=input.data.slice();assert.equal(fixture.made.length,0);
 const first=await work.restore(input),second=await work.restore(input);assert.equal(fixture.made.length,1);assert.equal(fixture.made[0].requests.length,2);
 unchangedOutside(input,first);unchangedOutside(input,second);assert.deepEqual(input.data,before);assert.notEqual(fixture.made[0].requests[0].data.buffer,input.data.buffer);
 work.close();assert.equal(fixture.made[0].terminateCount,1);assert.equal(first[(20*80+28)*4],247);
});
test('pending restoration owns the original dimensions, nested mask and RGBA despite caller mutation or buffer detachment',async()=>{
 for(const kind of ['mutate','detach']){
  const fixture=workerFixture(),work=session(new AbortController().signal,{workerFactory:()=>fixture.factory()}),input=picture();
  const snapshot={width:input.width,height:input.height,mask:{...input.mask},data:input.data.slice()},pending=work.restore(input);
  const worker=fixture.made[0],request=worker.requests[0];
  assert.notEqual(request.mask,input.mask);assert.notEqual(request.data.buffer,input.data.buffer);
  if(kind==='detach'){structuredClone(input.data,{transfer:[input.data.buffer]});assert.equal(input.data.byteLength,0);}
  else input.data.fill(9);
  input.width=2;input.height=2;input.mask.x=4;input.mask.width=1;input.mask={x:0,y:0,width:1,height:1};
  worker.onmessage({data:{id:request.id,width:snapshot.width,height:snapshot.height,data:new Uint8ClampedArray(snapshot.data.length).fill(247)}});
  const output=await pending;assert.equal(output.length,snapshot.data.length);unchangedOutside(snapshot,output);
  for(let y=snapshot.mask.y;y<snapshot.mask.y+snapshot.mask.height;y++)for(let x=snapshot.mask.x;x<snapshot.mask.x+snapshot.mask.width;x++){
   const i=(y*snapshot.width+x)*4;assert.deepEqual(Array.from(output.subarray(i,i+3)),[247,247,247],kind);assert.equal(output[i+3],snapshot.data[i+3]);
  }
  work.close();assert.equal(worker.terminateCount,1);
 }
});
test('abort, timeout, worker load errors, malformed output and postMessage failure terminate and reject without a fallback',async()=>{
 for(const kind of ['abort','timeout','load','malformed','post']){
  const controller=new AbortController(),fixture=workerFixture((worker,request)=>{
   if(kind==='post')throw Error('transport');
   if(kind==='load')queueMicrotask(()=>worker.onerror({}));
   if(kind==='malformed')queueMicrotask(()=>worker.onmessage({data:{id:request.id,width:request.width,height:request.height,data:new Uint8ClampedArray(1)}}));
  });
  const work=session(controller.signal,{workerFactory:()=>fixture.factory(),timeoutMs:10}),promise=work.restore(picture());
  if(kind==='abort')controller.abort(Error('cancelled'));
  await assert.rejects(promise);assert.equal(fixture.made[0].terminateCount,1,kind);await assert.rejects(work.restore(picture()));work.close();assert.equal(fixture.made[0].terminateCount,1);
 }
 const aborted=new AbortController();aborted.abort();assert.throws(()=>session(aborted.signal));
});
test('session rejects concurrent work and enforces cumulative allocation caps before posting another request',async()=>{
 const fixture=workerFixture(),work=session(new AbortController().signal,{workerFactory:()=>fixture.factory()});
 const pending=work.restore(picture());await assert.rejects(work.restore(picture()),/다시 시작/);const rejection=assert.rejects(pending);work.close();await rejection;
 const fast=workerFixture((worker,request)=>queueMicrotask(()=>worker.onmessage({data:{...request}}))),bounded=session(new AbortController().signal,{workerFactory:()=>fast.factory()});
 const input={width:1000,height:1000,data:new Uint8ClampedArray(4_000_000),mask:{x:12,y:12,width:10,height:10}};
 for(let i=0;i<4;i++)await bounded.restore(input);await assert.rejects(bounded.restore(input),/너무 많/);assert.equal(fast.made[0].requests.length,4);assert.equal(fast.made[0].terminateCount,1);
});
test('self-hosted assets match the pinned npm runtime, checksum manifest, embedded WASM and license with no >25 MiB files',()=>{
 const root=new URL('../public/inpaint/5.0.0-release.1/',import.meta.url),manifest=JSON.parse(fs.readFileSync(new URL('manifest.json',root),'utf8'));
 assert.equal(manifest.runtimeExternalDownloads,false);assert.equal(manifest.license,'Apache-2.0');
 for(const file of manifest.files){const bytes=fs.readFileSync(new URL(file.path,root));assert.equal(bytes.length,file.bytes);assert.ok(bytes.length<25*1024*1024);assert.equal(createHash('sha256').update(bytes).digest('hex'),file.sha256);}
 assert.deepEqual(fs.readFileSync(new URL('opencv.js',root)),fs.readFileSync(new URL('../node_modules/@techstark/opencv-js/dist/opencv.js',import.meta.url)));
 assert.match(fs.readFileSync(new URL('licenses/LICENSE-opencv-js.txt',root),'utf8'),/Apache License/);
});
