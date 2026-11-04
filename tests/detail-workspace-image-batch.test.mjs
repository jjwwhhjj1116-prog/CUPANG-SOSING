import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import {createHash} from 'node:crypto';
import { detailWorkspaceFixture, json } from './helpers/detail-workspace-api.mjs';
import { cropClientFixture } from './helpers/free-image-crop.mjs';
import { runtime, plain } from './helpers/detail-workspace.mjs';
const signal = () => new AbortController().signal;
async function fixture({ bodyCount,vision=false,imageWidth=320,imageHeight=240 } = {}) {
  const f = await detailWorkspaceFixture({ companyCode: 'A01464742', companyName: '와이홉' });
  for (const key of f.selectedKeys) f.api.objects.set(key, await sharp({ create: { width: imageWidth, height: imageHeight, channels: 4, background: '#2468ac' } }).png().toBuffer());
  const photos = f.document().photos;
  const document = bodyCount ? f.document([photos[0], ...Array.from({ length: bodyCount }, (_, index) => ({ ...photos[1], id: 'body-' + index })), photos.at(-1)]) : f.document();
  const saved = await json(await f.put(await f.body(document))), selection = { productId: f.product.id, optionId: f.optionId, profileId: saved.view.categoryContext.profileId, view: saved.view };
  const route = f.api.load('app/api/products/[id]/workspace-image-text/route.ts'), calls = [], canvas = cropClientFixture({ imageWidth, imageHeight });
  let intercept = null;
  const request = async (url, init = {}) => {
    calls.push({ url, init });
    if (intercept) { const value = await intercept(url, init); if (value !== undefined) return value; }
    if (url.includes('/workspace-image-text')) return route[init.method ?? 'GET'](new Request('https://app.test' + url, init), f.context);
    if (url.includes('/detail-workspace?')) return f.route[init.method ?? 'GET'](new Request('https://app.test' + url, init), f.context);
    return f.request(url, init);
  };
  if(vision){Object.assign(f.api.bindings,{SOURCEFLOW_IMAGE_TEXT_PROVIDER:'workers-ai-vision',SOURCEFLOW_IMAGE_TEXT_MODEL:'@cf/qwen/qwen3.8-27b',SOURCEFLOW_IMAGE_TEXT_PAID_ALLOWED:'true'});
   const create=canvas.document.createElement;canvas.document.createElement=tag=>{const output=create(tag);output.getContext('2d').getImageData=(_x,_y,width,height)=>({data:new Uint8ClampedArray(width*height*4).fill(255)});return output;};}
  const transport=runtime(request,{'@/app/free-image-translation-client':canvas.client}).load('app/detail-workspace-image-client.ts');
  const r = runtime(request, { '@/app/free-image-translation-client': canvas.client,'@/app/detail-workspace-image-client':{...transport,readDetailWorkspaceImage:async(...args)=>{
   const image=await transport.readDetailWorkspaceImage(...args);if(!vision)delete image.visionConfiguration;return image;}} }), batch = r.load('app/detail-workspace-image-batch.ts');
  const deps = { fetcher: request, recognize: async (_image, language) => [canvas.region('line', { x: 2, y: 3, width: 100, height: 20 }, '', { text: language === 'zh' ? '中文' : 'English', selected: true })],
    translate: async (_source, _language, regions) => ({ regions: regions.map(region => ({ id: region.id, original: region.text, translated: '검토 문구', issue: null })), warnings: [] }) };
  return { ...f, saved, selection, batch, deps, canvas, calls,r, prepare: () => batch.prepareDetailWorkspaceImageBatch({ selection, saved, language: 'zh' }, signal(), () => {}, deps), intercept(fn) { intercept = fn; } };
}
const visionValue=(f,decision='foreign-text')=>({provider:'workers-ai-vision',model:'@cf/qwen/qwen3.8-27b',requests:1,notice:f.r.load('app/image-text-vision.ts').IMAGE_TEXT_VISION_NOTICE,
 inspection:{policy:'foreign-text-inspection-v1',decision},blocks:decision==='foreign-text'?[{id:'vision-1',text:'中文',translated:'검토 문구',issue:null,box:{x:20,y:20,width:100,height:25}}]:[]});
const visionBatchReply=(input,result=null)=>({format:'yoofam-image-vision-batch-v1',attempt:{requestId:input.requestId,source:input.source,sourceLanguage:input.sourceLanguage,configuration:input.configuration,inspectionPolicy:input.inspectionPolicy,transport:input.transport},
 status:result?'completed':'running',result,failure:null,execution:{requests:result?0:1},readOnly:false});
function visionDeps(f,result=visionValue(f)){
 const stages=[];return{stages,deps:{...f.deps,recognize:async image=>{stages.push('vision');image.visionResult=plain(result);const styled=f.r.load('app/free-image-vision-style.ts').initializeVisionRegions(result.blocks,image.canvas,image.width,image.height);image.visionStyleIssues=styled.issues;
  if(!result.blocks.length)throw Error('empty image text');return styled.regions;},translate:async()=>assert.fail('Vision Korean must never go to Google'),render:async(image,regions,...args)=>{
   stages.push('render');assert.ok(regions.filter(row=>row.selected).every(row=>row.backgroundMode==='inpaint-telea-v1'));return f.canvas.client.renderFreeImageTranslation(image,regions.map(({backgroundMode,...row})=>{void backgroundMode;return row;}),...args);}}};
}

test('configured workspace Vision renders validated Korean with inpainting and never requests a second translator',async()=>{
 const f=await fixture({vision:true});try{
  const before=f.tables(),v=visionDeps(f),prepared=await f.batch.prepareDetailWorkspaceImageBatch({selection:f.selection,saved:f.saved,language:'zh'},signal(),()=>{},v.deps);
  assert.ok(prepared.items.every(item=>item.status==='ready'));assert.deepEqual(v.stages,['vision','render','vision','render']);assert.deepEqual(f.tables(),before);
  f.api.bindings.SOURCEFLOW_IMAGE_TEXT_PAID_ALLOWED='false';const blocked=visionDeps(f),unconfigured=await f.batch.prepareDetailWorkspaceImageBatch({selection:f.selection,saved:f.saved,language:'zh'},signal(),()=>{},blocked.deps);
  assert.ok(unconfigured.items.every(item=>item.status==='failed'));assert.deepEqual(blocked.stages,[]);
 }finally{f.api.close();}
});

for(const recovered of [false,true])test(`${recovered?'completed-request recovery':'automatic preparation'} exposes the exact rejected BODY region while retaining all six original/Korean texts`,async()=>{
 const f=await fixture({vision:true,bodyCount:1,imageWidth:750,imageHeight:590});try{
  // Exact six overlay blocks from the 750x590 BODY result in step935-third-body-vision.json.
  const result={...visionValue(f),inspection:{policy:'product-text-preservation-v2',decision:'foreign-text'},blocks:[
   {id:'vision-1',text:'High cotton content',translated:'고함량 면',issue:null,box:{x:95,y:112,width:225,height:28},kind:'overlay'},
   {id:'vision-2',text:'高含棉量',translated:'고함량 면',issue:null,box:{x:115,y:158,width:195,height:42},kind:'overlay'},
   {id:'vision-3',text:'85% 棉，10% 氨纶，5% 锦纶',translated:'면 85%, 스판덱스 10%, 나일론 5%',issue:null,box:{x:45,y:222,width:320,height:28},kind:'overlay'},
   {id:'vision-4',text:'Boneless suture head',translated:'무봉제 헤더',issue:null,box:{x:90,y:472,width:225,height:28},kind:'overlay'},
   {id:'vision-5',text:'一体机无骨缝头',translated:'일체형 무봉제 헤더',issue:null,box:{x:40,y:518,width:320,height:42},kind:'overlay'},
   {id:'vision-6',text:'平整无棱  穿着舒适',translated:'매끄럽고 날카롭지 않아 착용 시 편안함',issue:null,box:{x:95,y:580,width:230,height:10},kind:'overlay'},
  ]},expectedResult=plain(result),before=f.tables(),saved=plain(f.saved),objects=new Map([...f.api.objects].map(([key,bytes])=>[key,Buffer.from(bytes)]));
  let request,posts=0,reads=0,renders=0,translations=0;
  f.intercept((url,init)=>{
   if(!url.endsWith('/image-text')||init.method!=='POST')return;
   const input=JSON.parse(init.body);
   if(input.action==='vision-batch'){
    posts++;request=input;assert.equal(input.transport,'workers-ai-batch-v1');
    return recovered?Response.json({error:'ACK lost'},{status:503}):Response.json(visionBatchReply(request),{status:202});
   }
   reads++;assert.deepEqual(input,{action:'vision-batch-poll',requestId:request.requestId});
   return Response.json(visionBatchReply(request,result));
  });
  const deps={...f.deps,recognize:f.canvas.client.recognizeFreeImage,translate:async()=>{translations++;assert.fail('rejected Vision must not translate');},render:async()=>{renders++;assert.fail('rejected Vision must not render');}};
  let prepared=await f.batch.prepareDetailWorkspaceImageBatch({selection:f.selection,saved:f.saved,language:'zh'},signal(),()=>{},deps);
  if(recovered){assert.equal(prepared.items[0].status,'uncertain');prepared=await f.batch.recoverDetailWorkspaceBatchResult(prepared,signal(),()=>{},deps);}
  const entry=prepared.items[0];
  assert.equal(entry.status,'failed');assert.equal(entry.rendered,undefined);assert.equal(entry.visionAttempt,undefined);
  assert.match(entry.message,/VISION_TEXT_FIT/u);assert.match(entry.message,/vision-6/u);
  assert.match(entry.message,/x=95, y=580, width=230, height=10/u);assert.match(entry.message,/6px/u);
  assert.deepEqual(plain(entry.texts),[
   {original:'High cotton content',translated:'고함량 면'},{original:'高含棉量',translated:'고함량 면'},
   {original:'85% 棉，10% 氨纶，5% 锦纶',translated:'면 85%, 스판덱스 10%, 나일론 5%'},
   {original:'Boneless suture head',translated:'무봉제 헤더'},{original:'一体机无骨缝头',translated:'일체형 무봉제 헤더'},
   {original:'平整无棱  穿着舒适',translated:'매끄럽고 날카롭지 않아 착용 시 편안함'},
  ]);
  assert.equal(posts,1);assert.equal(reads,1);assert.equal(renders,0);assert.equal(translations,0);
  assert.equal(f.calls.filter(call=>call.init.body instanceof FormData).length,0);assert.deepEqual(f.tables(),before);
  assert.deepEqual(plain(prepared.saved),saved);assert.deepEqual(result,expectedResult);
  assert.deepEqual([...f.api.objects.keys()],[...objects.keys()]);for(const [key,bytes]of objects)assert.deepEqual(Buffer.from(f.api.objects.get(key)),bytes,key);
 }finally{f.api.close();}
});
test('v2 workspace keeps physical inscriptions out of Korean rendering and preserves intrinsic-only photos without a save',async()=>{
 const f=await fixture({vision:true});try{
  for(const onlyMarkings of [false,true]){
   const value=visionValue(f),overlay=value.blocks[0];overlay.kind='overlay';value.inspection={policy:'product-text-preservation-v2',decision:onlyMarkings?'product-markings-only':'foreign-text'};
   value.blocks=[...(!onlyMarkings?[overlay]:[]),{id:onlyMarkings?'vision-1':'vision-2',text:'YOGA SPORTS',translated:null,issue:null,kind:'product-marking',box:{x:200,y:180,width:80,height:20}}];
   const before=f.tables(),v=visionDeps(f,value),prepared=await f.batch.prepareDetailWorkspaceImageBatch({selection:f.selection,saved:f.saved,language:'zh'},signal(),()=>{},v.deps);
   assert.ok(prepared.items.every(item=>item.status===(onlyMarkings?'unchanged':'ready')),JSON.stringify(prepared.items.map(item=>item.message)));assert.deepEqual(f.tables(),before);
   if(onlyMarkings)assert.ok(!v.stages.includes('render'));
   else for(const item of prepared.items){const row=item.rendered.editDocument.regions.find(region=>region.text==='YOGA SPORTS');assert.equal(row.selected,false);assert.equal(row.translated,'');}
  }
 }finally{f.api.close();}
});

test('an exact zh no-text proof skips zh inference and permits explicit English Vision without another translator',async()=>{
 const f=await fixture({vision:true});try{
  const requested=[],pending=new Map();f.intercept(async(url,init)=>{
   if(url.endsWith('/image-text')&&init.method==='POST'){
    const input=JSON.parse(init.body);if(input.action==='vision-batch-poll'){const job=pending.get(input.requestId);assert.ok(job);assert.deepEqual(input,{action:'vision-batch-poll',requestId:job.input.requestId});return Response.json(visionBatchReply(job.input,job.result));}
    requested.push(input);assert.equal(input.action,'vision-batch');assert.equal(input.sourceLanguage,'en');const result=visionValue(f);result.blocks[0].text='English';result.blocks[0].kind='overlay';result.inspection={policy:input.inspectionPolicy,decision:'foreign-text'};pending.set(input.requestId,{input,result});return Response.json(visionBatchReply(input),{status:202});
   }
   if(!url.includes('/workspace-image-text?'))return;const route=f.api.load('app/api/products/[id]/workspace-image-text/route.ts'),response=await route.GET(new Request('https://app.test'+url,init),f.context),body=await response.json(),source=body.source;
   body.noTextProof={policy:'foreign-text-inspection-v1',productId:source.productId,sourceKey:source.sourceKey,sourceSha256:source.sourceSha256,width:source.width,height:source.height,sourceLanguage:'zh',requestId:'90700000-0000-4000-8000-000000000008',verifiedAt:'2026-11-02T00:00:00.000Z',configuration:body.visionConfiguration};return Response.json(body);});
  const v=visionDeps(f),deps={...v.deps,recognize:f.canvas.client.recognizeFreeImage};
  const ready=await f.batch.prepareDetailWorkspaceImageBatch({selection:f.selection,saved:f.saved,language:'zh'},signal(),()=>{},deps);assert.ok(ready.items.every(item=>item.status==='unchanged'));
  assert.equal(requested.length,0);const english=await f.batch.prepareDetailWorkspaceImageBatch({selection:f.selection,saved:f.saved,language:'en'},signal(),()=>{},deps);assert.ok(english.items.every(item=>item.status==='ready'));
  assert.equal(requested.length,english.items.length);assert.equal(f.calls.filter(call=>typeof call.init.body==='string'&&JSON.parse(call.init.body).action==='vision-batch-poll').length,english.items.length);assert.deepEqual(v.stages,['render','render']);assert.ok(english.items.every(item=>item.texts[0].original==='English'));
 }finally{f.api.close();}
});

test('verified no-foreign-text remains unchanged while unreadable and legacy empty results fail without rendering or translation',async()=>{
 const f=await fixture({vision:true});try{
  for(const decision of ['no-foreign-text','unreadable','legacy-empty']){
   const result=visionValue(f,decision==='legacy-empty'?'no-foreign-text':decision);if(decision==='legacy-empty')delete result.inspection;
   const v=visionDeps(f,result),before=f.tables(),prepared=await f.batch.prepareDetailWorkspaceImageBatch({selection:f.selection,saved:f.saved,language:'zh'},signal(),()=>{},v.deps);
   assert.ok(prepared.items.every(item=>item.status===(decision==='no-foreign-text'?'unchanged':'failed')));assert.ok(prepared.items.every(item=>!item.rendered));assert.ok(v.stages.every(stage=>stage==='vision'));assert.deepEqual(f.tables(),before);
  }
 }finally{f.api.close();}
});

test('unknown Vision stops later BODY inference and original-status recovery prepares only that exact preview with zero new requests',async()=>{
 const f=await fixture({vision:true});try{
  let count=0,attempt;const v=visionDeps(f),deps={...v.deps,recognize:async(image,language)=>{count++;const error=new f.canvas.client.FreeImageVisionError('ACK lost','IMAGE_VISION_ACK_MISSING',true,{requestId:'90700000-0000-4000-8000-000000000005',source:image.source,sourceLanguage:language,configuration:image.visionConfiguration,inspectionPolicy:'foreign-text-inspection-v1'});attempt=error.attempt;throw error;}};
  let prepared=await f.batch.prepareDetailWorkspaceImageBatch({selection:f.selection,saved:f.saved,language:'zh'},signal(),()=>{},deps);
  assert.deepEqual(prepared.items.map(item=>item.status),['uncertain','pending']);assert.ok(prepared.items[0].visionAttempt);assert.equal(count,1);
  await assert.rejects(f.batch.prepareDetailWorkspaceImageBatch(prepared,signal(),()=>{},deps));assert.equal(count,1);
  const statuses=[];let state='uncertain';f.intercept((url,init)=>{if(!url.includes('visionRequestId='))return;statuses.push(init.method);return Response.json({format:'yoofam-image-vision-status-v1',source:attempt.source,configuration:attempt.configuration,sourceLanguage:attempt.sourceLanguage,requestId:attempt.requestId,
   status:state,result:state==='completed'?visionValue(f):null,failure:state==='uncertain'?'TIMEOUT':null,execution:{requests:0},readOnly:true});});
  const before=f.tables(),original=prepared;for(const pending of ['running','uncertain','not-found']){state=pending;prepared=await f.batch.recoverDetailWorkspaceBatchResult(prepared,signal(),()=>{},v.deps);assert.equal(prepared.items[0].status,'uncertain');}
  state='completed';prepared=await f.batch.recoverDetailWorkspaceBatchResult(prepared,signal(),()=>{},v.deps);
  assert.deepEqual(prepared.items.map(item=>item.status),['ready','pending']);assert.ok(prepared.items[0].rendered);assert.equal(prepared.items[0].visionAttempt,undefined);
  state='failed';const failed=await f.batch.recoverDetailWorkspaceBatchResult(original,signal(),()=>{},v.deps);assert.equal(failed.items[0].status,'failed');assert.equal(failed.items[0].visionAttempt,undefined);
  assert.deepEqual(statuses,Array(5).fill('GET'));assert.equal(count,1);assert.deepEqual(v.stages,['render']);assert.deepEqual(f.tables(),before);assert.equal(f.calls.filter(call=>call.init.body instanceof FormData).length,0);
 }finally{f.api.close();}
});

test('a rejected v1 old-source collision stays failed while the real v2 route and client prepare the next distinct BODY without retry or final publication',async()=>{
 const f=await fixture({vision:true});try{
  const route=f.api.load('app/api/products/[id]/image-text/route.ts'),ledger=f.api.load('db/image-vision-requests.ts'),claim=ledger.claimImageVisionRequest,oldId='90700000-0000-4000-8000-000000000009',providerRequestId='768f15b7-4fd6-4498-906e-ad94ffc7f8d2',posts=[],responses=[],provider=[],providerReads=[];let oldRow;
  ledger.claimImageVisionRequest=async scope=>{if(!oldRow){const source=posts[0].source,sourceScope=createHash('sha256').update(JSON.stringify([source.sourceKey,source.sourceSha256,scope.company,scope.model,'zh','foreign-text-inspection-v1'])).digest('hex');assert.notEqual(sourceScope,scope.sourceScope);
   assert.equal((await claim({...scope,requestId:oldId,sourceScope,fingerprint:'9'.repeat(64)})).claimed,true);oldRow=JSON.stringify(f.api.sqlite.prepare('SELECT * FROM image_vision_requests WHERE request_id=?').get(oldId));}return claim(scope);};
  f.api.bindings.AI.run=async(model,input,options)=>{
   if(input.request_id){providerReads.push({model,input,options});assert.deepEqual(plain(input),{request_id:providerRequestId});assert.equal(options,undefined);return{responses:[{id:0,success:true,result:{response:{decision:'foreign-text',blocks:[{original:'中文',translated:'한국어',kind:'overlay',box:{x:20,y:20,width:100,height:25}}]}}}]};}
   provider.push({model,input,options});assert.deepEqual(plain(options),{queueRequest:true});assert.equal(input.requests.length,1);return{model,status:'queued',request_id:providerRequestId};
  };
  f.intercept(async(url,init)=>{if(!url.endsWith('/image-text')||init.method!=='POST')return;const input=JSON.parse(init.body);if(input.action==='vision-batch')posts.push(input);else assert.deepEqual(input,{action:'vision-batch-poll',requestId:posts[1].requestId});const response=await route.POST(new Request('https://app.test'+url,{...init,headers:{...init.headers,origin:'https://app.test'}}),f.context);if(input.action==='vision-batch')responses.push(await response.clone().json());return response;});
  const before=plain(f.tables()),v=visionDeps(f),prepared=await f.batch.prepareDetailWorkspaceImageBatch({selection:f.selection,saved:f.saved,language:'zh'},signal(),()=>{},{...v.deps,recognize:f.canvas.client.recognizeFreeImage});
  assert.deepEqual(prepared.items.map(item=>item.status),['failed','ready']);assert.equal(prepared.items[0].visionAttempt,undefined);assert.equal(prepared.items[0].rendered,undefined);assert.ok(prepared.items[1].rendered);assert.equal(responses[0].code,'IMAGE_VISION_NOT_ADMITTED');assert.equal(responses[0].uncertain,false);
  assert.equal(posts.length,2);assert.equal(posts[0].inspectionPolicy,'product-text-preservation-v2');assert.notEqual(posts[0].source.sourceKey,posts[1].source.sourceKey);assert.notEqual(posts[0].requestId,posts[1].requestId);assert.equal(provider.length,1);assert.equal(providerReads.length,1);assert.equal(JSON.stringify(f.api.sqlite.prepare('SELECT * FROM image_vision_requests WHERE request_id=?').get(oldId)),oldRow);
  assert.deepEqual(plain(f.api.sqlite.prepare('SELECT status,provider_requests FROM image_vision_requests WHERE request_id=?').get(oldId)),{status:'running',provider_requests:null});assert.deepEqual(plain(f.api.sqlite.prepare('SELECT status,provider_requests FROM image_vision_requests WHERE request_id=?').get(posts[1].requestId)),{status:'completed',provider_requests:1});
  assert.equal(f.api.sqlite.prepare('SELECT count(*) AS n FROM image_vision_requests WHERE request_id=?').get(posts[0].requestId).n,0);assert.equal(f.api.sqlite.prepare('SELECT count(*) AS n FROM image_vision_requests').get().n,2);
  const after=plain(f.tables());for(const table of ['products','product_content','product_options','product_quotation_fields','product_detail_workspaces'])assert.deepEqual(after[table],before[table],table);
  assert.equal(f.calls.filter(call=>call.init.body instanceof FormData).length,0);assert.deepEqual(v.stages,['render']);
 }finally{f.api.close();}
});

test('an aborted unknown Vision response still publishes its original attempt and preserves already prepared rows',async()=>{
 const f=await fixture({vision:true});try{
  const controller=new AbortController(),v=visionDeps(f);let count=0,latest;
  const prepared=await f.batch.prepareDetailWorkspaceImageBatch({selection:f.selection,saved:f.saved,language:'zh'},controller.signal,value=>{latest=value;},{...v.deps,recognize:async(image,language)=>{
   if(++count===1)return v.deps.recognize(image,language);controller.abort();throw new f.canvas.client.FreeImageVisionError('aborted acknowledgement','IMAGE_VISION_ACK_MISSING',true,{requestId:'90700000-0000-4000-8000-000000000006',source:image.source,sourceLanguage:language,configuration:image.visionConfiguration,inspectionPolicy:'foreign-text-inspection-v1'});
  }});
  assert.deepEqual(prepared.items.map(item=>item.status),['ready','uncertain']);assert.ok(latest.items[0].rendered);assert.ok(latest.items[1].visionAttempt);assert.equal(count,2);
 }finally{f.api.close();}
});

test('completed historical Vision cannot prepare a preview against a changed workspace and retains its original fence',async()=>{
 const f=await fixture({vision:true});try{
  const v=visionDeps(f);let attempt;
  const prepared=await f.batch.prepareDetailWorkspaceImageBatch({selection:f.selection,saved:f.saved,language:'zh'},signal(),()=>{},{...v.deps,recognize:async(image,language)=>{
   const error=new f.canvas.client.FreeImageVisionError('ACK lost','IMAGE_VISION_ACK_MISSING',true,{requestId:'90700000-0000-4000-8000-000000000009',source:image.source,sourceLanguage:language,configuration:image.visionConfiguration,inspectionPolicy:'foreign-text-inspection-v1'});attempt=error.attempt;throw error;
  }});
  const photos=plain(f.saved.workspace.document.photos);[photos[1],photos[2]]=[photos[2],photos[1]];await json(await f.put(await f.body(f.document(photos),f.saved)));
  let reads=0;f.intercept((url,init)=>{if(!url.includes('visionRequestId='))return;reads++;assert.equal(init.method,'GET');return Response.json({format:'yoofam-image-vision-status-v1',source:attempt.source,configuration:attempt.configuration,sourceLanguage:'zh',requestId:attempt.requestId,status:'completed',result:visionValue(f),failure:null,execution:{requests:0},readOnly:true});});
  await assert.rejects(f.batch.recoverDetailWorkspaceBatchResult(prepared,signal(),()=>{},v.deps));assert.equal(prepared.items[0].status,'uncertain');assert.ok(prepared.items[0].visionAttempt);assert.equal(reads,1);assert.deepEqual(v.stages,[]);
 }finally{f.api.close();}
});
 test('preparation reads only stored BODY photos without writing quotation or workspace', async () => {
  const f = await fixture(); try {
   const before = f.tables(), prepared = await f.prepare(), body = f.saved.workspace.document.photos.filter(photo => photo.role === 'body');
   assert.deepEqual(plain(prepared.items.map(item => item.photoId)), body.map(photo => photo.id));
   assert.ok(prepared.items.length >= 2); assert.ok(prepared.items.every(item => item.status === 'ready' && item.rendered.editDocument));
   assert.deepEqual(f.tables(), before); assert.ok(f.calls.every(call => (call.init.method ?? 'GET') === 'GET'));
   assert.ok(!f.calls.some(call => call.url.includes('/quotation-fields') || call.url.includes('/image-text?')));
  } finally { f.api.close(); }
 });
 test('two explicitly reviewed BODY saves use exact fresh revision while banners/order/manual quote stay exact', async () => {
  const f = await fixture(); try {
   const before = f.tables(), prepared = await f.prepare(), ids = prepared.items.map(item => item.photoId);
   let next = await f.batch.applyDetailWorkspaceBatchResult(prepared, ids[0], signal(), () => {}, f.deps);
   next = await f.batch.applyDetailWorkspaceBatchResult(next, ids[1], signal(), () => {}, f.deps);
   assert.equal(next.saved.workspace.revision, f.saved.workspace.revision + 2);
   assert.deepEqual(plain(next.saved.view), plain(f.saved.view));
   assert.deepEqual(next.saved.workspace.document.photos.map(photo => [photo.id, photo.originKey, photo.role]), f.saved.workspace.document.photos.map(photo => [photo.id, photo.originKey, photo.role]));
   for (const photo of f.saved.workspace.document.photos.filter(photo => photo.role !== 'body')) assert.deepEqual(plain(next.saved.workspace.document.photos.find(row => row.id === photo.id)), photo);
   const uploads = f.calls.filter(call => call.init.body instanceof FormData);
   assert.deepEqual(uploads.map(call => JSON.parse(call.init.body.get('source')).workspaceTarget.revision), [f.saved.workspace.revision, f.saved.workspace.revision + 1]);
   for (const [table, rows] of Object.entries(before)) if (table !== 'product_detail_workspaces') assert.deepEqual(f.tables()[table], rows, table);
  } finally { f.api.close(); }
 });
 for (const kind of ['order', 'origin', 'banner', 'manual', 'sha']) test(`external ${kind} change fences an old BODY preview before upload`, async () => {
  const f = await fixture(); try {
   const prepared = await f.prepare();
   if (kind === 'manual') await f.set(f.targets.detailHtml.linked.map(fieldKey => ({ optionId: f.optionId, fieldKey, value: '<p>new manual HTML</p>' })));
   else if (kind === 'sha') f.api.objects.set(prepared.items[0].sourceKey, await sharp({ create: { width: 320, height: 240, channels: 4, background: '#000000' } }).png().toBuffer());
   else { const document = plain(f.saved.workspace.document); if (kind === 'order') [document.photos[1], document.photos[2]] = [document.photos[2], document.photos[1]];
    if (kind === 'origin') document.photos[1] = { ...document.photos[2], id: 'replacement-photo' };
    if (kind === 'banner') document.imageMargin = 3;
    document.generatedHtml = f.model.generateDetailWorkspaceHtml(document.photos, document.imageMargin);
    const body = await f.body(document, f.saved); await json(await f.put(body));
   }
   await assert.rejects(f.batch.applyDetailWorkspaceBatchResult(prepared, prepared.items[0].photoId, signal(), () => {}, f.deps));
   assert.equal(f.calls.filter(call => call.init.body instanceof FormData).length, 0);
  } finally { f.api.close(); }
 });
 test('lost apply ACK retains exact attempt, fences later photos, and recovers without multipart replay', async () => {
  const f = await fixture(); try {
   const prepared = await f.prepare(); let latest = prepared;
   f.intercept(async (url, init) => { if (!(init.body instanceof FormData)) return; const route = f.api.load('app/api/products/[id]/workspace-image-text/route.ts'); const response = await route.POST(new Request('https://app.test' + url, init), f.context); assert.equal(response.status, 200); return Response.json({ error: 'ACK lost' }, { status: 503 }); });
   await assert.rejects(f.batch.applyDetailWorkspaceBatchResult(prepared, prepared.items[0].photoId, signal(), next => { latest = next; }, f.deps));
   assert.equal(latest.items[0].status, 'uncertain'); assert.ok(latest.items[0].attempt.image === latest.items[0].rendered || latest.items[0].attempt.image.output === latest.items[0].rendered.output);
   await assert.rejects(f.batch.applyDetailWorkspaceBatchResult(latest, prepared.items[1].photoId, signal(), () => {}, f.deps));
   const recovered = await f.batch.recoverDetailWorkspaceBatchResult(latest, signal(), () => {}, f.deps);
   assert.equal(recovered.items[0].status, 'applied'); assert.equal(recovered.items[1].status, 'ready');
   assert.equal(f.calls.filter(call => call.init.body instanceof FormData).length, 1);
   assert.equal(f.calls.filter(call => typeof call.init.body === 'string' && JSON.parse(call.init.body).action === 'recover').length, 1);
  } finally { f.api.close(); }
 });

test('preview retention stops at 30MB across many stored BODY rows without any write', async () => {
 const f = await fixture({ bodyCount: 4 }); try {
  const before = f.tables();
  const batch = await f.batch.prepareDetailWorkspaceImageBatch({ selection: f.selection, saved: f.saved, language: 'zh' }, signal(), () => {}, { ...f.deps,
   render: async (...args) => ({ ...await f.canvas.client.renderFreeImageTranslation(...args), output: new Blob([new Uint8Array(9 * 1024 * 1024)], { type: 'image/png' }) }) });
  assert.deepEqual(batch.items.map(item => item.status), ['ready', 'ready', 'ready', 'failed']);
  assert.equal(batch.items.reduce((bytes, item) => bytes + (item.rendered?.output.size ?? 0), 0), 27 * 1024 * 1024);
  assert.deepEqual(f.tables(), before); assert.equal(f.calls.filter(call => call.init.body instanceof FormData).length, 0);
 } finally { f.api.close(); }
});

for (const kind of ['manual', 'crop-manual-brush']) test(`an existing ${kind} BODY edit remains untouched and only unedited BODY photos enter batch OCR/render`, async () => {
 const f = await fixture(); try {
  const client = runtime(f.deps.fetcher, { '@/app/free-image-translation-client': f.canvas.client }).load('app/detail-workspace-image-client.ts');
  const body = f.saved.workspace.document.photos.filter(photo => photo.role === 'body'), editedId = body[0].id, untouchedIds = body.slice(1).map(photo => photo.id);
  const context = saved => ({ selection: f.selection, saved, target: { kind: 'detail-workspace', profileId: f.selection.profileId, optionId: f.selection.optionId,
    photoId: editedId, revision: saved.workspace.revision, digest: saved.workspace.digest } });
  const image = await client.readDetailWorkspaceImage(context(f.saved), signal());
  const regions = [{ ...f.canvas.region('saved-manual', { x: 20, y: 20, width: 140, height: 40 }, '수동 문구 유지'), text: '原文', translationProvenance: 'manual',
    fontFamily: 'serif', bold: true, italic: true, textAlign: 'right', lineHeight: 1.7 }];
  if (kind === 'crop-manual-brush') {
    const drawing = f.canvas.brush.createFreeImageBrush(4, [{ x: 40, y: 80 }, { x: 70, y: 90 }], 320, 240);
    regions.push({ ...f.canvas.region('saved-brush', drawing.box, ''), erase: true, brush: drawing.brush });
  }
  const crop = kind === 'crop-manual-brush' ? { x: 10, y: 12, width: 200, height: 150 } : undefined;
  const rendered = await f.canvas.client.renderFreeImageTranslation(image, regions, signal(), [], crop, 'zh');
  const stored = await client.applyDetailWorkspaceImage(rendered, context(f.saved), signal()), saved = { view: stored.view, workspace: stored.workspace, roles: stored.roles };
  const document = plain(rendered.editDocument), before = f.tables(), objects = new Map([...f.api.objects].map(([key, bytes]) => [key, Buffer.from(bytes)])), start = f.calls.length;
  const stages = [], deps = { ...f.deps,
    recognize: async (...args) => { stages.push(['ocr', args[0].source.workspaceTarget.photoId]); return f.deps.recognize(...args); },
    translate: async (...args) => { stages.push(['translate', args[0].workspaceTarget.photoId]); return f.deps.translate(...args); },
    render: async (...args) => { stages.push(['render', args[0].source.workspaceTarget.photoId]); return f.canvas.client.renderFreeImageTranslation(...args); } };
  let batch = await f.batch.prepareDetailWorkspaceImageBatch({ selection: f.selection, saved, language: 'zh' }, signal(), () => {}, deps);
  assert.deepEqual(stages.filter(([, id]) => id === editedId), [], 'an editable saved photo must never reach OCR, translation or rendering');
  for (const stage of ['ocr', 'translate', 'render']) assert.deepEqual(stages.filter(([name]) => name === stage).map(([, id]) => id), untouchedIds);
  const skipped = batch.items.find(item => item.photoId === editedId);
  assert.equal(skipped.status, 'failed'); assert.equal(skipped.rendered, undefined); assert.match(skipped.message, /개별.*편집/u);
  assert.ok(batch.items.filter(item => item.photoId !== editedId).every(item => item.status === 'ready'));
  assert.deepEqual(f.tables(), before); assert.ok(f.calls.slice(start).every(call => (call.init.method ?? 'GET') === 'GET'));
  for (const [key, bytes] of objects) assert.deepEqual(Buffer.from(f.api.objects.get(key)), bytes, key);
  await assert.rejects(f.batch.applyDetailWorkspaceBatchResult(batch, editedId, signal(), () => {}, f.deps));
  batch = await f.batch.applyDetailWorkspaceBatchResult(batch, untouchedIds[0], signal(), () => {}, f.deps);
  const reopened = await client.readDetailWorkspaceImage(context(batch.saved), signal());
  assert.deepEqual(plain(reopened.editDocument), document); assert.equal(reopened.source.editorSource.resultKey, stored.key);
  if (crop) { assert.deepEqual([rendered.width, rendered.height], [200, 150]); assert.deepEqual(plain(reopened.editDocument.crop), { ...crop, sourceWidth: 320, sourceHeight: 240 }); }
  assert.deepEqual(plain(batch.saved.workspace.document.photos.find(photo => photo.id === editedId)), plain(saved.workspace.document.photos.find(photo => photo.id === editedId)));
 } finally { f.api.close(); }
});
