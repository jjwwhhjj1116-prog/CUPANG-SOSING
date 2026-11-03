import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import cvReady from '@techstark/opencv-js';
import sharp from 'sharp';
import {freeImageEditFixture} from './helpers/free-image-edit-api.mjs';
const cv=await cvReady;

test('v2 preserves physical product markings while editing only the separate overlay, including textured product pixels',async()=>{
 const h=fixture((x,y)=>x>=70?((x+y)%2?[0,0,0,255]:[255,255,255,255]):[220,225,230,255]),policy='product-text-preservation-v2';
 const result=h.vision.parseImageVisionResponse({response:{decision:'foreign-text',blocks:[
  {original:'中文',translated:'중국어',kind:'overlay',box:{x:20,y:20,width:30,height:16}},
  {original:'YOGA SPORTS',translated:'요가 스포츠',kind:'product-marking',box:{x:72,y:20,width:20,height:16}}
 ]}},100,60,policy),styled=h.initializeVisionRegions(result.blocks,h.image.canvas,100,60);
 assert.equal(h.contract.isVerifiedNoForeignText(result),false);assert.deepEqual(plain(styled.issues),[]);
 Object.assign(h.image,{visionResult:result,visionStyleIssues:styled.issues});const before=h.image.canvas.pixels.slice(),prepared=h.prepareSelectedImageCleanup(h.image,styled.regions);
 assert.equal(prepared[0].selected,true);assert.equal(prepared[1].selected,false);assert.equal(prepared[1].erase,undefined);
 const rendered=await h.render(h.image,prepared,new AbortController().signal),after=new Uint8Array(await rendered.output.arrayBuffer());
 for(let y=0;y<60;y++)for(let x=70;x<100;x++){const i=(y*100+x)*4;assert.deepEqual(Array.from(after.slice(i,i+4)),Array.from(before.slice(i,i+4)));}
 assert.deepEqual(plain(result.blocks.map(row=>[row.text,row.kind])),[['中文','overlay'],['YOGA SPORTS','product-marking']]);
});

test('v2 unknown text placement blocks cleanup instead of guessing that a product inscription is an overlay',()=>{
 const h=fixture(),result=h.vision.parseImageVisionResponse({response:{decision:'unreadable',blocks:[{original:'NON-SLIP',translated:'미끄럼 방지',kind:'uncertain',box:{x:20,y:20,width:40,height:16}}]}},100,60,'product-text-preservation-v2');
 const styled=h.initializeVisionRegions(result.blocks,h.image.canvas,100,60);Object.assign(h.image,{visionResult:result,visionStyleIssues:styled.issues});
 assert.throws(()=>h.prepareSelectedImageCleanup(h.image,styled.regions),/검토/);assert.equal(h.operations.length,0);
});

test('v2 intrinsic-only Vision route returns a distinct server preservation proof on exact source GET with no PNG or quotation write',async()=>{
 const f=await freeImageEditFixture({code:'A01464742',name:'와이홉'}),h=fixture();try{
  const bytes=new Uint8Array(await sharp(h.image.canvas.pixels,{raw:{width:100,height:60,channels:4}}).png().toBuffer());f.h.objects.set(f.keys[0],bytes);
  const contract=f.h.load('app/image-text-vision.ts');let requests=0;Object.assign(f.h.bindings,{SOURCEFLOW_IMAGE_TEXT_PROVIDER:'workers-ai-vision',SOURCEFLOW_IMAGE_TEXT_MODEL:contract.IMAGE_TEXT_VISION_MODEL,SOURCEFLOW_IMAGE_TEXT_PAID_ALLOWED:'true'});
  f.h.bindings.AI.run=async()=>{requests++;return{response:{decision:'product-markings-only',blocks:[{original:'YOGA SPORTS',translated:'YOGA SPORTS',kind:'product-marking',box:{x:20,y:20,width:40,height:16}}]}};};
  const before=plain(await f.read()),keys=[...f.h.objects.keys()],opened=await(await f.source('mainImage')).json();
  const response=await f.h.load('app/api/products/[id]/image-text/route.ts').POST(new Request('https://app.test'+f.base+'/image-text',{method:'POST',headers:{'content-type':'application/json',origin:'https://app.test'},body:JSON.stringify({action:'vision',source:opened.source,sourceLanguage:'zh',configuration:opened.visionConfiguration,requestId:crypto.randomUUID(),inspectionPolicy:contract.IMAGE_TEXT_PRESERVATION_POLICY})}),{params:Promise.resolve({id:f.id})});
  assert.equal(response.status,200,await response.clone().text());assert.equal(requests,1);const source=await(await f.source('mainImage')).json();
  assert.equal(source.noTextProof,undefined);assert.equal(source.preservationProof.reason,'product-markings-only');assert.equal(source.preservationProof.sourceSha256,opened.source.sourceSha256);
  assert.deepEqual(plain(await f.read()),before);assert.deepEqual([...f.h.objects.keys()],keys);assert.deepEqual(f.h.objects.get(f.keys[0]),bytes);
 }finally{f.close();}
});

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
   {exports,Error,Date,URL,TextEncoder,Blob,Uint8ClampedArray,Uint8Array,DataView,btoa,AbortController,AbortSignal,structuredClone,document,setTimeout,clearTimeout,
    Worker:class{postMessage(request){queueMicrotask(()=>{try{const data=load('app/free-image-inpaint.ts').inpaintFreeImagePixels(cv,request);this.onmessage?.({data:{id:request.id,width:request.width,height:request.height,data}});}catch(error){this.onerror?.(error);}});}terminate(){}},
    fetch:()=>assert.fail('cleanup must not make a translation request'),require:name=>{assert.ok(name.startsWith('@/'));return load(name.slice(2)+'.ts');}});return exports;
 }
 const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;canvas.pixels=new Uint8ClampedArray(width*height*4);
 for(let y=0;y<height;y++)for(let x=0;x<width;x++)canvas.pixels.set(color(x,y),(y*width+x)*4);
 return{...load('app/selected-image-purpose.ts'),...load('app/free-image-vision-style.ts'),vision:load('app/automation/workers-image-vision.ts'),contract:load('app/image-text-vision.ts'),render:load('app/free-image-translation-client.ts').renderFreeImageTranslation,
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

for(const stage of ['main','additional'])test(`${stage}: configured Qwen model-code OCR reaches actual OpenCV cleanup without needing Korean replacement text`,async()=>{
 const h=fixture(),box={x:20,y:20,width:60,height:16};h.image.source.role=stage;h.image.source.quotationTarget.input=stage==='main'?'mainImage':'additionalImages';h.image.source.quotationTarget.fieldKey=h.image.source.quotationTarget.input;
 h.image.canvas.pixels.set([0,0,0,255],(25*h.image.width+25)*4);const original=h.image.canvas.pixels.slice(),bytes=new Uint8Array(await sharp(original,{raw:{width:h.image.width,height:h.image.height,channels:4}}).png().toBuffer());let providerCalls=0;
 const env={SOURCEFLOW_IMAGE_TEXT_PROVIDER:'workers-ai-vision',SOURCEFLOW_IMAGE_TEXT_MODEL:h.contract.IMAGE_TEXT_VISION_MODEL,SOURCEFLOW_IMAGE_TEXT_PAID_ALLOWED:'true',AI:{run:async(model,input)=>{
  providerCalls++;assert.equal(model,h.contract.IMAGE_TEXT_VISION_MODEL);assert.equal(input.messages[1].content[1].type,'image_url');return{response:{decision:'foreign-text',blocks:[{original:'UV400',translated:'UV400',box}]}};
 }}};
 assert.equal(h.vision.imageVisionConfiguration(env).configured,true);
 const result=await h.vision.readImageVision(bytes,{width:h.image.width,height:h.image.height},'zh',env,new AbortController().signal,h.contract.IMAGE_TEXT_INSPECTION_POLICY),styled=h.initializeVisionRegions(result.blocks,h.image.canvas,h.image.width,h.image.height);
 assert.equal(result.blocks[0].translated,null);assert.match(result.blocks[0].issue,/번역 검증/);assert.deepEqual(plain(styled.issues),[]);
 h.image.visionResult=result;h.image.visionStyleIssues=styled.issues;const before=plain(styled.regions),prepared=h.prepareSelectedImageCleanup(h.image,styled.regions),rendered=await h.render(h.image,prepared,new AbortController().signal),output=new Uint8Array(await rendered.output.arrayBuffer());
 assert.equal(providerCalls,1);assert.equal(h.operations.filter(row=>row[0]==='restore').length,1);assert.ok(!h.operations.some(row=>row[0]==='fill'));
 assert.deepEqual(plain(styled.regions),before);assert.deepEqual(plain(rendered.editDocument.regions.map(row=>({text:row.text,box:row.box,erase:row.erase,translated:row.translated,translationProvenance:row.translationProvenance,issue:row.issue}))),[{text:'UV400',box,erase:true,translated:'',translationProvenance:'empty',issue:null}]);
 for(let y=0;y<h.image.height;y++)for(let x=0;x<h.image.width;x++){const index=(y*h.image.width+x)*4;if(x>=box.x&&x<box.x+box.width&&y>=box.y&&y<box.y+box.height){for(let c=0;c<3;c++)assert.ok(Math.abs(output[index+c]-[220,225,230][c])<8);}else assert.deepEqual(Array.from(output.slice(index,index+4)),Array.from(original.slice(index,index+4)));}
});

test('a translation-only exception requires matching validated foreign-text Vision blocks and never removes geometry/background or unknown review issues',()=>{
 const h=fixture(),box={x:20,y:20,width:60,height:16},result=h.vision.parseImageVisionResponse({response:{decision:'foreign-text',blocks:[{original:'UV400',translated:'UV400',box}]}},100,60),styled=h.initializeVisionRegions(result.blocks,h.image.canvas,100,60);
 h.image.visionResult=result;h.image.visionStyleIssues=styled.issues;
 for(const change of [value=>{delete value.visionResult.inspection;},value=>{value.visionResult.inspection.decision='unreadable';},value=>{value.visionResult.blocks[0].text='other';},value=>{value.visionResult.blocks[0].box.x++;},value=>{value.source.role='detail';}]){
  const image={...h.image,source:plain(h.image.source),visionResult:plain(result)};change(image);assert.throws(()=>h.prepareSelectedImageCleanup(image,styled.regions),/검토가 필요/);
 }
 for(const rows of [[{...styled.regions[0],selected:false}],[{...styled.regions[0],issue:'알 수 없는 검토 '+styled.regions[0].issue}]])assert.throws(()=>h.prepareSelectedImageCleanup(h.image,rows),/검토가 필요/);
 const omitted={...h.image,visionResult:{...plain(result),blocks:[...plain(result.blocks),{...plain(result.blocks[0]),id:'vision-2',text:'AB123',box:{x:5,y:45,width:30,height:10}}]}};assert.throws(()=>h.prepareSelectedImageCleanup(omitted,styled.regions),/검토가 필요/);
 const complex=fixture((x,y)=>(x+y)%2?[0,0,0,255]:[255,255,255,255]);complex.image.visionResult=plain(result);complex.image.visionStyleIssues=['VISION_BACKGROUND_COMPLEX'];assert.throws(()=>complex.prepareSelectedImageCleanup(complex.image,styled.regions),/VISION_BACKGROUND_COMPLEX/);
 const overlap=fixture(),rows=[...result.blocks,{...result.blocks[0],id:'vision-2',text:'AB123',box:{x:30,y:25,width:30,height:10}}],overlapResult={...plain(result),blocks:rows},overlapStyled=overlap.initializeVisionRegions(rows,overlap.image.canvas,100,60);overlap.image.visionResult=overlapResult;overlap.image.visionStyleIssues=overlapStyled.issues;assert.throws(()=>overlap.prepareSelectedImageCleanup(overlap.image,overlapStyled.regions),/VISION_REGION_OVERLAP/);
});

test('a matching code with the exact translation and text-fit diagnostics is erase-only while original diagnostics remain untouched',()=>{
 const h=fixture(),result=h.vision.parseImageVisionResponse({response:{decision:'foreign-text',blocks:[{original:'UV400',translated:'UV400',box:{x:20,y:20,width:40,height:16}}]}},100,60),styled=h.initializeVisionRegions(result.blocks,h.image.canvas,100,60),before=plain(styled);
 assert.deepEqual(plain(styled.issues),['VISION_TEXT_FIT']);assert.equal(styled.regions[0].selected,false);h.image.visionResult=result;h.image.visionStyleIssues=styled.issues;
 const prepared=h.prepareSelectedImageCleanup(h.image,styled.regions);assert.equal(prepared[0].selected,true);assert.equal(prepared[0].erase,true);assert.equal(prepared[0].issue,null);assert.deepEqual(plain(styled),before);
});

for(const stage of ['main','additional'])test(`${stage}: one actual Vision API result restores pixels and saves only the exact final quotation image slot with its editable OCR source`,async()=>{
 const f=await freeImageEditFixture({code:'A01464742',name:'와이홉'}),h=fixture();try{
  h.image.canvas.pixels.set([0,0,0,255],(25*h.image.width+25)*4);const original=h.image.canvas.pixels.slice(),bytes=new Uint8Array(await sharp(original,{raw:{width:h.image.width,height:h.image.height,channels:4}}).png().toBuffer());
  f.h.objects.set(f.keys[0],bytes);const contract=f.h.load('app/image-text-vision.ts'),input=stage==='main'?'mainImage':'additionalImages';let providerCalls=0;
  Object.assign(f.h.bindings,{SOURCEFLOW_IMAGE_TEXT_PROVIDER:'workers-ai-vision',SOURCEFLOW_IMAGE_TEXT_MODEL:contract.IMAGE_TEXT_VISION_MODEL,SOURCEFLOW_IMAGE_TEXT_PAID_ALLOWED:'true'});
  f.h.bindings.AI.run=async(model)=>{providerCalls++;assert.equal(model,contract.IMAGE_TEXT_VISION_MODEL);return{response:{decision:'foreign-text',blocks:[{original:'UV400',translated:'UV400',box:{x:20,y:20,width:60,height:16}}]}};};
  const openedResponse=await f.source(input);assert.equal(openedResponse.status,200,await openedResponse.clone().text());const opened=await openedResponse.json(),source=opened.source;
  assert.equal(opened.visionConfiguration.configured,true);const response=await f.h.load('app/api/products/[id]/image-text/route.ts').POST(new Request('https://app.test'+f.base+'/image-text',{method:'POST',headers:{'content-type':'application/json',origin:'https://app.test','sec-fetch-site':'same-origin'},body:JSON.stringify({action:'vision',source,sourceLanguage:'zh',configuration:opened.visionConfiguration,requestId:crypto.randomUUID(),inspectionPolicy:contract.IMAGE_TEXT_INSPECTION_POLICY})}),{params:Promise.resolve({id:f.id})});assert.equal(response.status,200,await response.clone().text());const read=await response.json();
  const styled=h.initializeVisionRegions(read.result.blocks,h.image.canvas,h.image.width,h.image.height);Object.assign(h.image,{source,visionResult:read.result,visionStyleIssues:styled.issues});
  const prepared=h.prepareSelectedImageCleanup(h.image,styled.regions),rendered=await h.render(h.image,prepared,new AbortController().signal),pixels=new Uint8Array(await rendered.output.arrayBuffer()),png=new Uint8Array(await sharp(pixels,{raw:{width:h.image.width,height:h.image.height,channels:4}}).png().toBuffer()),before=await f.read(),raw=f.sourceRows();
  const saved=await f.applyEdit(source,rendered.editDocument,png);assert.equal(saved.status,200,await saved.clone().text());const body=await saved.json(),after=await f.read(),target=f.h.load('app/quotation-seo-targets.ts').exactPrimaryQuotationTarget(before.resolved.schema.fields,input),slot=source.quotationTarget.slotIndex;
  assert.equal(providerCalls,1);assert.equal(f.sourceRows(),raw);assert.deepEqual(f.h.objects.get(f.keys[0]),bytes);assert.deepEqual(f.h.objects.get(body.key),png);
  const expectedOverrides=plain(before.overrides);for(const key of target.linked){const selected=before.resolved.rows.find(row=>row.optionId===f.selected).fields[key].value.split('\n');selected[slot]=body.key;expectedOverrides.options[f.selected][key]=selected.join('\n');}assert.deepEqual(after.overrides,expectedOverrides);
  if(stage==='main'){const issue=f.h.load('app/quotation-schema.ts').duplicateQuotationImageIssue;assert.ok(before.resolved.rows.find(row=>row.optionId===f.selected).fields.detailImages.issues.includes(issue));assert.equal(after.resolved.rows.find(row=>row.optionId===f.selected).fields.detailImages.issues.includes(issue),false);}
  for(const row of after.resolved.rows){const prior=before.resolved.rows.find(prior=>prior.optionId===row.optionId);for(const [key,cell]of Object.entries(prior.fields)){
   if(row.optionId===f.selected&&target.linked.includes(key)){const expected=cell.value.split('\n');expected[slot]=body.key;assert.equal(row.fields[key].value,expected.join('\n'));}
   else{assert.equal(row.fields[key].value,cell.value);assert.equal(row.fields[key].source,cell.source);}
  }}
  const reopened=await f.source(input,{sourceKey:body.key,editor:'saved'});assert.equal(reopened.status,200,await reopened.clone().text());const editable=await reopened.json();
  assert.equal(editable.source.editorSource.resultKey,body.key);assert.equal(editable.editDocument.regions[0].text,'UV400');assert.equal(editable.editDocument.regions[0].erase,true);assert.equal(editable.editDocument.regions[0].translated,'');assert.equal(editable.editDocument.regions[0].issue,null);
 }finally{f.close();}
});
