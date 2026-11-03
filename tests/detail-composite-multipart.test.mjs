import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import {companies} from './helpers/image-download-ui.mjs';
import {makeCompositeFixture,loadComposite} from './helpers/detail-image-composite.mjs';
import {detailWorkspaceFixture,json} from './helpers/detail-workspace-api.mjs';
const signal=()=>new AbortController().signal;
const input=f=>({productId:f.product.id,optionId:f.optionId,profileId:f.view.categoryContext.profileId,view:f.view});
async function multipartFixture(){
 const f=await makeCompositeFixture(companies[0],{count:4,manualHtml:'<p>직접 입력한 원문 보존</p>'});
 for(let index=0;index<4;index++)await f.api.bindings.FILES.put(f.selectedKeys[index],await sharp({create:{width:800,height:5000,channels:4,background:f.colors[index]}}).png().toBuffer(),{httpMetadata:{contentType:'image/png'}});
 const previous=f.request;f.request=async(url,init={})=>{if(!url.includes('/detail-save'))return previous(url,init);f.calls.push({url,init});return f.api.load('app/api/products/[id]/detail-save/route.ts')[init.method??'GET'](new Request('https://app.test'+url,{...init}),{params:Promise.resolve({id:f.product.id})});};return f;
}
test('35 actual-height body photos plus banner become two ordered boundary-only PNG parts, without changing source or quotation',async()=>{
 const f=await makeCompositeFixture(companies[0],{count:36});try{
  for(let i=0;i<36;i++)await f.api.bindings.FILES.put(f.selectedKeys[i],await sharp({create:{width:i?750:800,height:i?(i===20?589:590):200,channels:4,background:f.colors[i]}}).png().toBuffer(),{httpMetadata:{contentType:'image/png'}});
  const before=f.retained(),originals=f.originals(),runtime=loadComposite(f),prepared=await runtime.helper.prepareDetailComposite(input(f),signal(),f.request);
  assert.equal(prepared.partsPolicy,'photo-boundary-parts-v2');assert.equal(prepared.parts.length,2);
  assert.deepEqual(JSON.parse(JSON.stringify(prepared.parts.map(p=>[p.start,p.end]))),[[0,26],[26,36]]);
  assert.equal(prepared.parts.reduce((sum,p)=>sum+p.height,0),22214);assert.equal(prepared.parts[0].uploadId,prepared.uploadId);
  assert.deepEqual([...prepared.sources.map(p=>p.key)],f.selectedKeys);assert.equal(runtime.draws.length,36);
  for(const part of prepared.parts){assert.ok(part.height<=16000);const meta=await sharp(Buffer.from(await part.output.arrayBuffer())).metadata();assert.equal(meta.width,800);assert.equal(meta.height,part.height);}
  assert.equal(prepared.output,prepared.parts[0].output);assert.equal(f.retained(),before);assert.equal(f.originals(),originals);assert.equal(f.calls.filter(c=>['POST','PUT','PATCH'].includes(c.init.method)).length,0);
 }finally{f.api.close();}
});
test('a single oversized normalized photo is rejected rather than cut or silently shrunk',async()=>{
 const f=await makeCompositeFixture(companies[0],{count:4});try{await f.api.bindings.FILES.put(f.selectedKeys[1],await sharp({create:{width:1,height:21,channels:4,background:'#abcdef'}}).png().toBuffer(),{httpMetadata:{contentType:'image/png'}});const before=f.retained();await assert.rejects(loadComposite(f).helper.prepareDetailComposite(input(f),signal(),f.request),/크기|나누|확인/);assert.equal(f.retained(),before);}finally{f.api.close();}
});
for(const lostStage of ['none','second-upload','save'])test(`multipart client commits all ordered parts once; ${lostStage} recovery reads only and never duplicates files`,async()=>{
 const f=await multipartFixture();try{
  const runtime=loadComposite(f),client=runtime.load('app/detail-save-client.ts'),prepared=await runtime.helper.prepareDetailComposite(input(f),signal(),f.request),attempt={};let uploads=0,lost=false;
  const request=async(url,init={})=>{const response=await f.request(url,init);if(url==='/api/files'&&init.method==='POST')uploads++;if(!lost&&(lostStage==='second-upload'&&uploads===2&&url==='/api/files'&&init.method==='POST'||lostStage==='save'&&url.includes('/detail-save')&&init.method==='POST')){lost=true;throw Error('lost ACK');}return response;};
  if(lostStage==='none')await client.applyDetailSave(prepared,attempt,signal(),request);else{
   await assert.rejects(client.applyDetailSave(prepared,attempt,signal(),request),/lost ACK/);const before=f.retained(),count=f.calls.filter(c=>c.init.method==='POST').length;
   const status=await client.recoverDetailSave(prepared,attempt,signal(),request);assert.equal(f.retained(),before);assert.equal(f.calls.filter(c=>c.init.method==='POST').length,count);
   if(status==='ready')await client.applyDetailSave(prepared,attempt,signal(),request);
  }
  assert.ok(attempt.completed);assert.equal(uploads,2);assert.equal(f.calls.filter(c=>c.url.includes('/detail-save')&&c.init.method==='POST').length,1);
  const keys=prepared.parts.map(part=>`owner/quotation-label-${part.uploadId}.png`);assert.equal(attempt.completed.overrides.common.detailImages,keys.join('\n'));
  for(const row of attempt.completed.resolved.rows){assert.equal(row.fields.detailImages.value,keys.join('\n'));assert.equal(row.fields.detailImages.validationIssues.length,0);}
  assert.deepEqual([...attempt.completed.detailEditorInputs.images.map(image=>image.key)],f.selectedKeys);assert.equal(attempt.completed.detailEditorInputs.parts.length,2);
  if(lostStage==='none'){const editor=runtime.load('app/detail-editor-inputs-client.ts'),selection={...input(f),view:attempt.completed},count=f.calls.filter(c=>c.init.method==='POST').length;
   const reopened=await editor.prepareSavedDetailInputs(selection,signal(),request);assert.deepEqual([...reopened.keys],f.selectedKeys);assert.equal(f.calls.filter(c=>c.init.method==='POST').length,count);
   await f.api.bindings.FILES.put(keys[1],new Uint8Array([1,2,3]),{httpMetadata:{contentType:'image/png'}});await assert.rejects(editor.prepareSavedDetailInputs(selection,signal(),request));}
 }finally{f.api.close();}
});
test('a saved long workspace renders and publishes every photo through its original all-option API scope',async()=>{
 const f=await detailWorkspaceFixture(companies[1],{wire:true,excluded:true});try{
  for(const [index,key]of f.selectedKeys.entries())await f.api.bindings.FILES.put(key,await sharp({create:{width:800,height:6000,channels:4,background:['#f00','#0f0','#00f','#ff0'][index]}}).png().toBuffer(),{httpMetadata:{contentType:'image/png'}});
  const saved=await json(await f.put(await f.body())),selection={productId:f.product.id,optionId:f.optionId,profileId:saved.view.categoryContext.profileId,view:saved.view},calls=[];
  const request=async(url,init={})=>{calls.push({url,init});if(url.includes('/detail-workspace?'))return f.route[init.method??'GET'](new Request('https://app.test'+url,init),f.context);return f.request(url,init);};
  const runtime=loadComposite({request}),client=runtime.load('app/detail-workspace-composite-client.ts'),before=f.tables(),prepared=await client.prepareDetailWorkspaceComposite(selection,saved,signal(),request);
  assert.equal(prepared.parts.length,2);assert.deepEqual(f.tables(),before);assert.deepEqual([...prepared.sources.map(source=>source.key)],f.selectedKeys);
  const attempt={},view=await client.applyDetailWorkspaceComposite(prepared,attempt,signal(),request);
  assert.equal(view.revision,saved.view.revision+1);assert.equal(view.detailEditorInputs.format,'saved-detail-inputs-v2');assert.equal(view.detailEditorInputs.parts.length,2);
  const reopened=await runtime.load('app/detail-editor-inputs-client.ts').prepareSavedDetailComposition({...selection,view},signal(),request);
  assert.equal(reopened.inputs.parts.length,2);assert.deepEqual([...reopened.keys],f.selectedKeys);assert.equal(typeof reopened.composition.html.effective,'string');
  for(const row of view.resolved.rows)assert.equal(row.fields[f.targets.detailImages.primary].value,attempt.keys.join('\n'));
  assert.equal(calls.filter(call=>call.url.includes('/detail-save')&&call.init.method==='POST').length,1);
 }finally{f.api.close();}
});
for(const stage of ['none','second-upload','second-pool','quote'])test(`selected-option multipart preserves every other option and can recover ${stage} without duplicate writes`,async()=>{
 const f=await multipartFixture();try{
  const runtime=loadComposite(f),helper=runtime.helper,prepared=await helper.prepareDetailComposite(input(f),signal(),f.request),before=JSON.parse(JSON.stringify(f.view.overrides)),attempt={};let uploads=0,pools=0,lost=false;
  const request=async(url,init={})=>{const response=await f.request(url,init);if(url==='/api/files'&&init.method==='POST')uploads++;if(url.endsWith('/attachments')&&init.method==='POST')pools++;
   if(!lost&&(stage==='second-upload'&&uploads===2&&url==='/api/files'&&init.method==='POST'||stage==='second-pool'&&pools===2&&url.endsWith('/attachments')&&init.method==='POST'||stage==='quote'&&url.includes('/quotation-fields')&&init.method==='PUT')){lost=true;throw Error('lost selected ACK');}return response;};
  if(stage==='none')await helper.applyDetailComposite(prepared,attempt,signal(),request);else{await assert.rejects(helper.applyDetailComposite(prepared,attempt,signal(),request),/lost selected ACK/);const count=f.calls.filter(c=>['POST','PUT'].includes(c.init.method)).length;const recovered=await helper.recoverDetailComposite(prepared,attempt,signal(),request);assert.equal(f.calls.filter(c=>['POST','PUT'].includes(c.init.method)).length,count);if(recovered==='ready')await helper.applyDetailComposite(prepared,attempt,signal(),request);}
  assert.ok(attempt.completed);assert.equal(uploads,2);assert.equal(pools,2);const keys=prepared.parts.map(part=>`owner/quotation-label-${part.uploadId}.png`);
  assert.equal(attempt.completed.overrides.options[f.optionId].detailImages,keys.join('\n'));assert.equal(attempt.completed.overrides.options[f.optionId].detailHtml,before.options[f.optionId].detailHtml);
  for(const [id,values]of Object.entries(before.options))if(id!==f.optionId)assert.deepEqual(JSON.parse(JSON.stringify(attempt.completed.overrides.options[id])),values);
 }finally{f.api.close();}
});
test('multipart manifest permits the measured 17.64MiB aggregate but still rejects an individual >10MiB or aggregate >30MiB',async()=>{
 const f=await makeCompositeFixture(companies[0],{count:4});try{const helpers=loadComposite(f).load('app/detail-composite-parts.ts');
  const part=(index,bytes)=>({start:index,end:index+1,width:800,height:1,sha256:String(index+1).repeat(64),bytes,uploadId:String(index+5).repeat(64)});
  assert.equal(helpers.validateDetailCompositeParts([part(0,9*1024*1024),part(1,9*1024*1024)],2).length,2);
  assert.throws(()=>helpers.validateDetailCompositeParts([part(0,10*1024*1024+1),part(1,1)],2));
  assert.throws(()=>helpers.validateDetailCompositeParts(Array.from({length:4},(_,index)=>part(index,8*1024*1024)),4));
 }finally{f.api.close();}
});
