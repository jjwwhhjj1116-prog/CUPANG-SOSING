import test from 'node:test';
import assert from 'node:assert/strict';
import {workspaceImageEditFixture,json,sha} from './helpers/workspace-image-edit-api.mjs';
import {companies} from './helpers/image-download-ui.mjs';
const plain=value=>JSON.parse(JSON.stringify(value));
const requestId='90700000-0000-4000-8000-000000000001';
async function fixture(company=companies[0]){
 const f=await workspaceImageEditFixture(company),calls=[],env=f.api.bindings;
 Object.assign(env,{SOURCEFLOW_IMAGE_TEXT_PROVIDER:'workers-ai-vision',SOURCEFLOW_IMAGE_TEXT_MODEL:'@cf/qwen/qwen3.8-27b',SOURCEFLOW_IMAGE_TEXT_PAID_ALLOWED:'true'});
 const controls={provider:null};env.AI.run=async(model,input,options)=>{calls.push({model,input:plain(input),options:plain(options)});return controls.provider?controls.provider():{response:{decision:'foreign-text',blocks:[{original:'黑色',translated:'검정',box:{x:0,y:0,width:20,height:1}}]}};};
 const route=f.api.load('app/api/products/[id]/image-text/route.ts'),configuration=plain(f.api.load('app/automation/workers-image-vision.ts').imageVisionConfiguration(env)),
  policy=f.api.load('app/image-text-vision.ts').IMAGE_TEXT_INSPECTION_POLICY;
 const post=(source,overrides={})=>route.POST(new Request('https://app.test'+f.base+'/image-text',{method:'POST',headers:{'content-type':'application/json',origin:'https://app.test'},
  body:JSON.stringify({action:'vision',source,configuration,sourceLanguage:'zh',requestId,inspectionPolicy:policy,...overrides})}),f.context);
 const status=(source,overrides={})=>route.GET(new Request('https://app.test'+f.base+'/image-text?'+new URLSearchParams({visionRequestId:requestId,source:JSON.stringify(source),sourceLanguage:'zh',inspectionPolicy:policy,...overrides})),f.context);
 return {...f,route,configuration,policy,calls,controls,post,status,networkBefore:[...f.api.network]};
}
const originalRows=f=>JSON.stringify(['products','product_content','product_options','product_quotation_fields','product_detail_workspaces'].map(table=>f.api.sqlite.prepare('SELECT * FROM '+table).all()));
test('an unadmitted new UUID is a confirmed rejection while the original running UUID stays ambiguous and untouched',async()=>{
 const f=await fixture();try{
  const source=(await json(await f.openImage())).source,ledger=f.api.load('db/image-vision-requests.ts'),claim=ledger.claimImageVisionRequest,oldId='90700000-0000-4000-8000-000000000009';let seeded;
  ledger.claimImageVisionRequest=async scope=>{if(!seeded){assert.equal((await claim({...scope,requestId:oldId})).claimed,true);seeded=JSON.stringify(f.api.sqlite.prepare('SELECT * FROM image_vision_requests').all());}return claim(scope);};
  const before=originalRows(f),rejected=await f.post(source),body=await rejected.json();assert.equal(rejected.status,409);assert.equal(body.code,'IMAGE_VISION_NOT_ADMITTED');assert.equal(body.uncertain,false);
  assert.equal(f.calls.length,0);assert.equal(JSON.stringify(f.api.sqlite.prepare('SELECT * FROM image_vision_requests').all()),seeded);assert.equal(f.api.sqlite.prepare('SELECT count(*) AS n FROM image_vision_requests WHERE request_id=?').get(requestId).n,0);
  assert.deepEqual(plain(f.api.sqlite.prepare('SELECT status,provider_requests FROM image_vision_requests WHERE request_id=?').get(oldId)),{status:'running',provider_requests:null});
  const original=await f.post(source,{requestId:oldId}),pending=await original.json();assert.equal(original.status,409);assert.notEqual(pending.uncertain,false);assert.equal(pending.code,undefined);assert.equal(f.calls.length,0);
  assert.equal(JSON.stringify(f.api.sqlite.prepare('SELECT * FROM image_vision_requests').all()),seeded);assert.equal(originalRows(f),before);
 }finally{f.api.close();}
});

test('a source clock race that prevents the atomic claim reports only non-admission without creating or finishing a request',async()=>{
 const f=await fixture();try{
  const source=(await json(await f.openImage())).source,ledger=f.api.load('db/image-vision-requests.ts'),claim=ledger.claimImageVisionRequest,later='2099-01-01T00:00:00.000Z';
  ledger.claimImageVisionRequest=async scope=>{f.api.sqlite.prepare('UPDATE products SET updated_at=? WHERE id=?').run(later,f.product.id);return claim(scope);};
  const rejected=await f.post(source),body=await rejected.json();assert.equal(rejected.status,409);assert.equal(body.code,'IMAGE_VISION_NOT_ADMITTED');assert.equal(body.uncertain,false);assert.equal(f.calls.length,0);
  assert.equal(f.api.sqlite.prepare('SELECT count(*) AS n FROM image_vision_requests').get().n,0);assert.equal(f.api.sqlite.prepare('SELECT updated_at FROM products WHERE id=?').get(f.product.id).updated_at,later);
 }finally{f.api.close();}
});

for(const company of companies)test(`${company.companyCode}: exact saved BODY uses the Vision ledger/cache and historical GET without altering source or workspace`,async()=>{
 const f=await fixture(company);try{
  const opened=await json(await f.openImage()),source=opened.source,before=originalRows(f),files=[...f.api.objects].map(([key,bytes])=>[key,sha(bytes)]);
  assert.deepEqual(opened.visionConfiguration,f.configuration);assert.equal(opened.noTextProof,undefined);
  const result=await json(await f.post(source));assert.equal(result.execution.requests,1);assert.equal(result.result.blocks[0].translated,'검정');assert.equal(f.calls.length,1);
  assert.equal(f.calls[0].model,f.configuration.model);assert.deepEqual(f.calls[0].options,{rejectIfBusy:true});assert.equal(originalRows(f),before);
  assert.deepEqual([...f.api.objects].map(([key,bytes])=>[key,sha(bytes)]),files);
  const replay=await json(await f.post(source));assert.equal(replay.execution.requests,0);assert.equal(replay.replayed,true);
  const cached=await json(await f.post(source,{requestId:'90700000-0000-4000-8000-000000000002'}));assert.deepEqual(cached.execution,{requests:0,cached:true});assert.equal(f.calls.length,1);
  const current=await json(await f.read()),photos=plain(current.workspace.document.photos);[photos[1],photos[2]]=[photos[2],photos[1]];
  await json(await f.put(await f.body(f.document(photos),current)));const changed=originalRows(f);
  const observed=await json(await f.status(source));assert.equal(observed.status,'completed');assert.deepEqual(observed.execution,{requests:0});assert.equal(observed.readOnly,true);
  assert.equal((await f.post(source)).status,409,'historical source cannot start or replay a current operation');assert.equal(f.calls.length,1);assert.equal(originalRows(f),changed);
  assert.deepEqual(f.api.network,f.networkBefore);
 }finally{f.api.close();}
});

test('workspace Vision rejects forged bindings, banners, foreign sources and ordinary mutation routes before any provider call',async()=>{
 const f=await fixture();try{
  const source=(await json(await f.openImage())).source,before=originalRows(f),files=[...f.api.objects].map(([key,bytes])=>[key,sha(bytes)]);
  for(const patch of [{revision:99},{digest:'a'.repeat(64)},{bindingSha256:'b'.repeat(64)},{photoId:'missing-photo'},{photoId:f.openedWorkspace.workspace.document.photos[0].id},{optionId:'another-option'},{profileId:'another-profile'}]){
   assert.ok([404,409].includes((await f.post({...source,workspaceTarget:{...source.workspaceTarget,...patch}})).status));
  }
  for(const patch of [{sourceKey:'other/private.png'},{productId:'another-product'},{sourceSha256:'c'.repeat(64)},{width:799}])assert.notEqual((await f.post({...source,...patch})).status,200);
  const translate=await f.route.POST(new Request('https://app.test'+f.base+'/image-text',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action:'translate',source,sourceLanguage:'zh',regions:[{id:'one',text:'黑色'}]})}),f.context);
  assert.equal(translate.status,400);
  const recover=await f.route.POST(new Request('https://app.test'+f.base+'/image-text',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action:'recover',source,outputSha256:'d'.repeat(64),outputBytes:1,editDocument:f.editDocument()})}),f.context);
  assert.equal(recover.status,400);
  const form=new FormData();form.set('action','apply');form.set('source',JSON.stringify(source));form.set('file',new File([await f.png()],'forged.png',{type:'image/png'}));form.set('editDocument',JSON.stringify(f.editDocument()));
  assert.equal((await f.route.POST(new Request('https://app.test'+f.base+'/image-text',{method:'POST',body:form}),f.context)).status,400);
  assert.equal(f.calls.length,0);assert.equal(originalRows(f),before);assert.deepEqual([...f.api.objects].map(([key,bytes])=>[key,sha(bytes)]),files);assert.deepEqual(f.api.network,f.networkBefore);
 }finally{f.api.close();}
});

test('workspace changes during a provider await fence the original request as uncertain and status never calls the provider again',async()=>{
 const f=await fixture();try{
  const source=(await json(await f.openImage())).source;
  f.controls.provider=async()=>{const current=await json(await f.read()),photos=plain(current.workspace.document.photos);[photos[1],photos[2]]=[photos[2],photos[1]];await json(await f.put(await f.body(f.document(photos),current)));return{response:{decision:'foreign-text',blocks:[{original:'黑色',translated:'검정',box:{x:0,y:0,width:20,height:1}}]}};};
  assert.equal((await f.post(source)).status,409);assert.equal(f.calls.length,1);
  const row=f.api.sqlite.prepare('SELECT status,failure,provider_requests FROM image_vision_requests WHERE request_id=?').get(requestId);assert.deepEqual(plain(row),{status:'uncertain',failure:'CURRENT_CHANGED',provider_requests:1});
  const before=originalRows(f),observed=await json(await f.status(source));assert.equal(observed.status,'uncertain');assert.equal(observed.execution.requests,0);
  assert.equal((await f.post(source,{requestId:'90700000-0000-4000-8000-000000000002'})).status,409);assert.equal(f.calls.length,1);assert.equal(originalRows(f),before);
 }finally{f.api.close();}
});

test('workspace source GET exposes only the exact configured no-text receipt after the same bytes were inspected',async()=>{
 const f=await fixture();try{
  const source=(await json(await f.openImage())).source;f.controls.provider=()=>({response:{decision:'no-foreign-text',blocks:[]}});
  const result=await json(await f.post(source));assert.equal(result.result.inspection.decision,'no-foreign-text');
  const before=originalRows(f),reopened=await json(await f.openImage()),proof=reopened.noTextProof;
  assert.equal(proof.productId,source.productId);assert.equal(proof.sourceKey,source.sourceKey);assert.equal(proof.sourceSha256,source.sourceSha256);
  assert.equal(proof.width,source.width);assert.equal(proof.height,source.height);assert.equal(proof.requestId,requestId);assert.deepEqual(proof.configuration,f.configuration);
  assert.equal(originalRows(f),before);assert.equal(f.calls.length,1);
  f.api.objects.set(source.sourceKey,await f.png('#654321'));assert.equal((await f.openImage()).status,409);assert.equal(f.calls.length,1);
 }finally{f.api.close();}
});

test('member and Vision configuration changes during inference discard the workspace result and preserve the original ledger attempt',async()=>{
 for(const mode of ['member','configuration']){
  const f=await fixture();try{
   const source=(await json(await f.openImage())).source,before=originalRows(f);
   f.controls.provider=()=>{if(mode==='member')f.api.setMembershipStatus('pending');else f.api.bindings.SOURCEFLOW_IMAGE_TEXT_PAID_ALLOWED='false';
    return{response:{decision:'foreign-text',blocks:[{original:'黑色',translated:'검정',box:{x:0,y:0,width:20,height:1}}]}};};
   assert.equal((await f.post(source)).status,409);assert.equal(f.calls.length,1);assert.equal(originalRows(f),before);
   f.api.setMembershipStatus('approved');f.api.bindings.SOURCEFLOW_IMAGE_TEXT_PAID_ALLOWED='true';
   const observed=await json(await f.status(source));assert.equal(observed.status,'uncertain');assert.equal(observed.execution.requests,0);assert.equal(f.calls.length,1);
   assert.equal((await f.post(source)).status,409);assert.equal(f.calls.length,1);
  }finally{f.api.close();}
 }
});
