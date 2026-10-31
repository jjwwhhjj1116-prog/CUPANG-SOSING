import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import cvReady from '@techstark/opencv-js';
const cv=await cvReady;

const plain=value=>JSON.parse(JSON.stringify(value));
function fixture(color=()=>[220,225,230,255]){
 const operations=[],cache=new Map(),width=100,height=60;
 const source={productId:'product',productVersion:'2026-10-30T00:00:00.000Z',sourceKey:'owner/original.png',sourceSha256:'a'.repeat(64),role:'main',contentRevision:1,width,height,
  quotationTarget:{kind:'quotation',profileId:null,optionId:'option',input:'mainImage',fieldKey:'mainImage',slotIndex:0,revision:1,inputFingerprint:'b'.repeat(64),optionRevision:1,value:'owner/original.png',bindingSha256:'c'.repeat(64)}};
 const document={createElement(tag){
  assert.equal(tag,'canvas');const canvas={width:0,height:0,pixels:null};
  const context={font:'10px Arial',measureText(text){return{width:Array.from(text).length*Number(/([0-9.]+)px/u.exec(this.font)?.[1]??10)};},
   drawImage(input){canvas.pixels=input.pixels.slice();},save(){},restore(){},beginPath(){},rect(){},clip(){},
   getImageData(x,y,w,h){const data=new Uint8ClampedArray(w*h*4);for(let py=0;py<h;py++)for(let px=0;px<w;px++)data.set(canvas.pixels.slice(((y+py)*canvas.width+x+px)*4,((y+py)*canvas.width+x+px)*4+4),(py*w+px)*4);return{data,width:w,height:h};},
   putImageData(image,x,y,dirtyX,dirtyY,width,height){operations.push(['restore',x,y,dirtyX,dirtyY,width,height]);for(let py=dirtyY;py<dirtyY+height;py++)for(let px=dirtyX;px<dirtyX+width;px++)canvas.pixels.set(image.data.subarray((py*image.width+px)*4,(py*image.width+px)*4+4),((y+py)*canvas.width+x+px)*4);},
   fillRect(x,y,w,h){operations.push(['fill',x,y,w,h]);const rgb=[1,3,5].map(index=>parseInt(this.fillStyle.slice(index,index+2),16));for(let py=y;py<y+h;py++)for(let px=x;px<x+w;px++)canvas.pixels.set([...rgb,255],(py*canvas.width+px)*4);},
   fillText(){assert.fail('erase-only cleanup must never paint Korean or other replacement text');}};
  canvas.getContext=()=>context;canvas.toBlob=(callback,type)=>callback(new Blob([canvas.pixels],{type}));return canvas;
 }};
 function load(file){if(cache.has(file))return cache.get(file);const exports={};cache.set(file,exports);
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../'+file,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,
   {exports,Error,Date,URL,TextEncoder,Blob,Uint8ClampedArray,Uint8Array,AbortController,AbortSignal,structuredClone,document,setTimeout,clearTimeout,
    Worker:class{postMessage(request){queueMicrotask(()=>{try{const data=load('app/free-image-inpaint.ts').inpaintFreeImagePixels(cv,request);this.onmessage?.({data:{id:request.id,width:request.width,height:request.height,data}});}catch(error){this.onerror?.(error);}});}terminate(){}},
    fetch:()=>assert.fail('cleanup must not make a translation request'),require:name=>{assert.ok(name.startsWith('@/'));return load(name.slice(2)+'.ts');}});return exports;
 }
 const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;canvas.pixels=new Uint8ClampedArray(width*height*4);
 for(let y=0;y<height;y++)for(let x=0;x<width;x++)canvas.pixels.set(color(x,y),(y*width+x)*4);
 return{...load('app/selected-image-purpose.ts'),...load('app/free-image-vision-style.ts'),render:load('app/free-image-translation-client.ts').renderFreeImageTranslation,
  image:{source,canvas,width,height,blob:new Blob(['original'])},operations};
}
const region=(id,text='中文文句',box={x:20,y:20,width:40,height:16})=>({id,text,box,confidence:95,selected:true,translated:'',translationProvenance:'empty',issue:null,background:'#ffffff',foreground:'#111111',fontSize:10});

test('actual renderer restores selected OCR pixels with pinned OpenCV without translated Korean and retains every editable original row',async()=>{
 const h=fixture(),rows=[region('chosen'),{...region('numbers','12345',{x:70,y:20,width:20,height:16}),selected:false,confidence:20},region('korean','한국어',{x:20,y:45,width:20,height:10})];
 // Represent the original glyph pixels inside the selected rectangle.
 h.image.canvas.pixels.set([0,0,0,255],(25*h.image.width+25)*4);
 h.image.canvas.pixels.set([0,0,0,255],(25*h.image.width+75)*4);
 const original=h.image.canvas.pixels.slice(),before=plain(rows),prepared=h.prepareSelectedImageCleanup(h.image,rows),rendered=await h.render(h.image,prepared,new AbortController().signal);
 assert.deepEqual(h.operations,[['restore',8,8,12,12,40,16]]);assert.equal(h.image.canvas.pixels[0],original[0]);assert.deepEqual(plain(rows),before);
 const output=new Uint8Array(await rendered.output.arrayBuffer());
 for(let y=0;y<h.image.height;y++)for(let x=0;x<h.image.width;x++){
  const index=(y*h.image.width+x)*4,inside=x>=20&&x<60&&y>=20&&y<36;
  if(inside){for(let c=0;c<3;c++)assert.ok(Math.abs(output[index+c]-[220,225,230][c])<8,`restored ${x},${y}`);assert.equal(output[index+3],255);}
  else assert.deepEqual(Array.from(output.slice(index,index+4)),Array.from(original.slice(index,index+4)),`pixel ${x},${y}`);
 }
 const saved=plain(rendered.editDocument.regions);assert.deepEqual(saved.map(row=>[row.id,row.text,row.box]),before.map(row=>[row.id,row.text,row.box]));
 assert.equal(saved[0].erase,true);assert.equal(saved[0].backgroundMode,'inpaint-telea-v1');assert.equal(saved[0].translated,'');assert.equal(saved[0].translationProvenance,'empty');assert.equal(saved[0].background,'#dce1e6');assert.equal(saved[1].selected,false);assert.equal(saved[2].selected,false);
});

test('the exact Korean fit-only diagnostic does not require a Korean replacement to erase, while genuine provider issues remain blocked',()=>{
 const h=fixture(),box={x:20,y:20,width:10,height:10},blocks=[{id:'vision-1',text:'中文',translated:'한국어'.repeat(80),issue:null,box}],styled=h.initializeVisionRegions(blocks,h.image.canvas,h.image.width,h.image.height);
 assert.deepEqual(plain(styled.issues),['VISION_TEXT_FIT']);assert.equal(styled.regions[0].selected,false);h.image.visionStyleIssues=styled.issues;
 const prepared=h.prepareSelectedImageCleanup(h.image,styled.regions);assert.equal(prepared[0].selected,true);assert.equal(prepared[0].erase,true);assert.equal(prepared[0].issue,null);assert.equal(prepared[0].translated,'');
 for(const issue of ['번역 검증을 통과하지 못했습니다. 원문과 영역을 확인해주세요.','원문에 없는 성능·주장. '+styled.regions[0].issue,'VISION_TEXT_FIT: unrecognized review message']){
  const rows=[{...styled.regions[0],issue}];assert.throws(()=>h.prepareSelectedImageCleanup(h.image,rows),/검토가 필요/);assert.equal(rows[0].issue,issue);
 }
});

test('uniform-fill cleanup rejects complex, transparent, unavailable and overlapping OCR geometry before rendering',()=>{
 for(const [color,code]of [[(x,y)=>(x+y)%2?[0,0,0,255]:[255,255,255,255],'VISION_BACKGROUND_COMPLEX'],[()=>[220,225,230,0],'VISION_BACKGROUND_UNAVAILABLE']]){
  const h=fixture(color);assert.throws(()=>h.prepareSelectedImageCleanup(h.image,[region('text')]),new RegExp(code));assert.equal(h.operations.length,0);
 }
 const missing=fixture();missing.image.canvas.getContext=()=>null;assert.throws(()=>missing.prepareSelectedImageCleanup(missing.image,[region('text')]),/VISION_BACKGROUND_UNAVAILABLE/);
 const overlap=fixture();assert.throws(()=>overlap.prepareSelectedImageCleanup(overlap.image,[region('first'),region('second','English words',{x:30,y:25,width:30,height:10})]),/VISION_REGION_OVERLAP/);
 const invalid=fixture();assert.throws(()=>invalid.prepareSelectedImageCleanup(invalid.image,[region('outside','中文',{x:90,y:20,width:20,height:10})]),/원본 크기/);
 const uncertain=fixture(),rows=[region('certain'),{...region('uncertain','English caption',{x:70,y:20,width:20,height:16}),selected:false,confidence:20}];
 assert.throws(()=>uncertain.prepareSelectedImageCleanup(uncertain.image,rows),/미선택 외국어/);assert.equal(uncertain.operations.length,0);assert.equal(rows[1].selected,false);
});
