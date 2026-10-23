import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {providedOptionModule} from './helpers/provided-option-quotation.mjs';
import {mobileIntakeHarness} from './helpers/mobile-intake.mjs';

const labels=providedOptionModule('app/product-label.ts'),draftModule=providedOptionModule('app/product-label-draft.ts');
const clone=value=>JSON.parse(JSON.stringify(value));
const png=new Uint8Array(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2RkcAAAAASUVORK5CYII=','base64'));
function initial(){
 const automatic=Object.fromEntries(labels.productLabelFields.map(field=>[field.key,({productName:'검토 제품',netContents:'1个',material:'海绵',productType:'后跟贴'})[field.key]??'']));
 return{productId:'selected-label',revision:0,inputFingerprint:'a'.repeat(64),productVersion:'2026-10-23T00:00:00.000Z',contentRevision:0,optionRevision:0,quotationRevision:0,quotationInputFingerprint:'b'.repeat(64),
  categoryContext:{source:'collection',profileId:null,categoryId:'80719',categoryPath:['합성 카테고리']},imageKeys:[],overrides:{common:{},options:{}},updatedAt:null,
  rows:[{optionId:null,optionLabel:'공통',included:false},{optionId:'one',optionLabel:'베이지',included:true},{optionId:'two',optionLabel:'검정',included:true},{optionId:'excluded',optionLabel:'제외',included:false}]
   .map(row=>({...row,automatic:{...automatic},values:{...automatic},sources:Object.fromEntries(Object.entries(automatic).map(([key,value])=>[key,value?'content':'empty']))}))};
}
function fixture({intercept,complete,prepare,afterWrite,currentCheck}={}){
 let view=initial();prepare?.(view);const calls=[],plans=[],attachments=[],controller=new AbortController();let scope=true,checks=0;
 const refresh=()=>{for(const row of view.rows){const own=row.optionId?view.overrides.options[row.optionId]??{}:{};row.values={...row.automatic,...view.overrides.common,...own};row.sources=Object.fromEntries(Object.keys(row.values).map(key=>[key,Object.hasOwn(own,key)?'manual-option':Object.hasOwn(view.overrides.common,key)?'manual-common':row.automatic[key]?'content':'empty']));}};
 refresh();const exports={};
 const render=async plan=>{plans.push(clone(plan));return{blob:new Blob([png],{type:'image/png'}),width:800,height:500};};
 const dependencies={
  '@/app/product-label':labels,'@/app/product-label-draft':draftModule,'@/app/document-image-render':{renderDocument:render},
  '@/app/product-label-save':{completeProductLabelSave:async(input,request)=>{input.assertCurrent();attachments.push(input.optionId);if(complete)return complete(input,request,{get view(){return view;},controller});await input.render(labels.productLabelPlan(input.view,input.optionId));await request(input.quotationEndpoint,{cache:'no-store'});return{view:clone(view),key:'owner/synthetic.png',quotation:{}};}},
 };
 vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../app/batch-selected-label-work.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,Error,Date,URL,Blob,require:name=>{assert.ok(dependencies[name],name);return dependencies[name];}});
 const fetcher=async(url,init={})=>{
  assert.equal(init.signal,controller.signal);assert.equal(init.redirect,'error');assert.equal(init.credentials,'same-origin');calls.push({url,init});
  const state={get view(){return view;},set view(next){view=next;},controller,refresh};
  const replaced=await intercept?.(url,init,state);if(replaced)return replaced;
  if(url.endsWith('/quotation-fields'))return Response.json({});
  if(url.endsWith('/product-label-draft')){
   const request=JSON.parse(init.body),row=view.rows.find(row=>row.optionId===request.optionId);
   assert.equal(request.expectedRevision,view.revision);assert.equal(request.expectedInputFingerprint,view.inputFingerprint);
   const values=Object.fromEntries(Object.entries({netContents:'1쌍',material:'스펀지',productType:'뒤꿈치 보호 패드'}).filter(([key])=>!['manual-common','manual-option'].includes(row.sources[key])));
   return Response.json({productId:view.productId,optionId:request.optionId,profileId:null,productVersion:view.productVersion,labelRevision:view.revision,inputFingerprint:view.inputFingerprint,values,warnings:['검토용 초안'],provider:draftModule.PRODUCT_LABEL_DRAFT_PROVIDER,model:draftModule.PRODUCT_LABEL_DRAFT_MODEL,generatedAt:'2026-10-23T00:00:01.000Z'});
  }
  assert.ok(url.endsWith('/product-labels'));
  if(init.method==='PUT'){
   const body=JSON.parse(init.body);assert.equal(body.expectedRevision,view.revision);assert.equal(body.expectedInputFingerprint,view.inputFingerprint);
   view.overrides=clone(labels.applyProductLabelChanges(view.overrides,body.changes));view.revision++;view.inputFingerprint=(view.revision+1).toString(16).padStart(64,'0');
   view.productVersion=new Date(Date.parse(view.productVersion)+1).toISOString();view.updatedAt=view.productVersion;refresh();
   await afterWrite?.(view);
  }
  return Response.json(view);
 };
 const controls={fetcher,signal:controller.signal,assertCurrent(){checks++;if(!scope)throw Error('owner/company changed');return currentCheck?.();},render};
 return{run:()=>exports.runSelectedLabelWork('selected-label',controls),calls,plans,attachments,controller,get view(){return view;},setScope(value){scope=value;},get checks(){return checks;}};
}

test('selected label work generates once per included option, preserves common/manual blanks, saves only proposals and renders draft PNGs',async()=>{
 const f=fixture({prepare(view){view.overrides.common.netContents='검토한 1쌍';view.overrides.options.one={material:''};}}),before=clone(f.view),result=await f.run();
 assert.equal(result.status,'draft');assert.equal(result.completedOptions,2);assert.equal(result.uncertain,false);assert.deepEqual(f.attachments,['one','two']);assert.equal(f.plans.length,2);
 assert.deepEqual(f.view.overrides.common,before.overrides.common);assert.equal(f.view.rows[1].values.material,'');assert.deepEqual(f.view.rows[3],before.rows[3]);
 const writes=f.calls.filter(call=>call.init.method==='PUT').map(call=>JSON.parse(call.init.body));
 assert.deepEqual(writes.map(write=>write.changes.map(change=>change.fieldKey)),[['productType'],['material','productType']]);
 assert.equal(f.calls.filter(call=>call.url.endsWith('/product-label-draft')).length,2);assert.ok(f.checks>f.calls.length);
 assert.match(result.message,/내용.*PNG.*검토/u);
});

test('fully protected fields skip AI and content-level manual no-fields replies still preserve saved rows',async()=>{
 const protectedAll=fixture({prepare(view){view.overrides.common={netContents:'',material:'수동 재질',productType:'수동 유형'};}});
 assert.equal((await protectedAll.run()).status,'draft');assert.equal(protectedAll.calls.filter(call=>call.url.endsWith('/product-label-draft')).length,0);assert.equal(protectedAll.calls.filter(call=>call.init.method==='PUT').length,0);
 const contentManual=fixture({intercept(url){if(url.endsWith('/product-label-draft'))return Response.json({code:'PRODUCT_LABEL_DRAFT_NO_FIELDS',error:'직접 저장한 값 유지'},{status:409});}}),before=clone(contentManual.view);
 assert.equal((await contentManual.run()).completedOptions,2);assert.deepEqual(contentManual.view,before);assert.equal(contentManual.calls.filter(call=>call.init.method==='PUT').length,0);
});

test('missing product names, excluded-only plans, wrong draft receipts and changed views never reach text/image writes',async()=>{
 for(const mode of ['name','excluded','receipt','changed']){
  const f=fixture({prepare(view){if(mode==='name')view.overrides.options.one={productName:''};if(mode==='excluded')view.rows.forEach(row=>row.included=false);},
   intercept(url,_init,state){if(!url.endsWith('/product-label-draft'))return;if(mode==='receipt')return Response.json({productId:'wrong'});if(mode==='changed'){state.view.productVersion='2026-10-23T01:00:00.000Z';}}});
  const result=await f.run();assert.ok(['blocked','failed'].includes(result.status),mode);assert.equal(f.calls.filter(call=>call.init.method==='PUT').length,0);assert.equal(f.attachments.length,0);
 }
});

test('stopping or changing owner before/during draft work fences all following save/render requests',async()=>{
 const pre=fixture();pre.controller.abort();assert.equal((await pre.run()).status,'blocked');assert.equal(pre.calls.length,0);
 let f;f=fixture({intercept(url){if(url.endsWith('/product-label-draft'))f.setScope(false);}});assert.equal((await f.run()).status,'blocked');assert.equal(f.calls.filter(call=>call.init.method==='PUT').length,0);assert.equal(f.attachments.length,0);
 const aborted=fixture({intercept(url,_init,state){if(url.endsWith('/product-label-draft'))state.controller.abort();}});assert.equal((await aborted.run()).status,'blocked');assert.equal(aborted.attachments.length,0);
});

test('asynchronous account verification is awaited and a later denied scope prevents all remaining writes',async()=>{
 let release;const held=new Promise(resolve=>{release=resolve;}),first=fixture({currentCheck:()=>held});
 const running=first.run();await new Promise(resolve=>setImmediate(resolve));assert.equal(first.calls.length,0,'No request before pending account proof');release();assert.equal((await running).status,'draft');
 const denied=fixture({currentCheck:async()=>{await Promise.resolve();throw Error('async account denied');}}),result=await denied.run();
 assert.equal(result.status,'blocked');assert.match(result.message,/async account denied/);assert.equal(denied.calls.length,0);
 let allow=true;const after=fixture({currentCheck:async()=>{await Promise.resolve();if(!allow)throw Error('async company changed');},intercept(url){if(url.endsWith('/product-label-draft'))allow=false;}});
 assert.equal((await after.run()).status,'blocked');assert.equal(after.calls.filter(call=>call.init.method==='PUT').length,0);assert.equal(after.attachments.length,0);
});

test('unacknowledged or mismatched text writes and PNG attachment failures report uncertainty and stop the option queue',async()=>{
 for(const mode of ['lost','wrong','png']){
  const f=fixture({intercept(url,init){if(url.endsWith('/product-labels')&&init.method==='PUT'&&mode!=='png')return mode==='wrong'?Response.json({...initial(),productId:'other'}):new Response('<html>503</html>',{status:503});},
   ...(mode==='png'?{complete:async()=>{throw Error('PNG receipt unavailable');}}:{})});
  const result=await f.run();assert.equal(result.status,'blocked');assert.equal(result.uncertain,true);assert.equal(result.completedOptions,0);
  assert.match(result.message,/저장 결과가 미확인/);assert.equal(f.calls.filter(call=>call.url.endsWith('/product-label-draft')).length,1);assert.equal(f.calls.filter(call=>call.init.method==='PUT').length,1);
 }
});

test('lost or invalid AI draft acknowledgments retain uncertainty before any label save; definite pre-provider rejection clears it',async()=>{
 for(const mode of ['network','html','receipt','scope']){
  let allowed=true;
  const f=fixture({currentCheck:async()=>{if(!allowed)throw Error('account changed after draft');},intercept(url){
   if(!url.endsWith('/product-label-draft'))return;
   if(mode==='network')throw Error('lost provider response');
   if(mode==='html')return new Response('<html>gateway</html>',{status:503});
   if(mode==='receipt')return Response.json({productId:'wrong'});
   allowed=false;
  }}),result=await f.run();
  assert.equal(result.status,'blocked',mode);assert.equal(result.uncertain,true,mode);assert.match(result.message,/AI 초안 생성 결과가 미확인/);
  assert.equal(f.calls.filter(call=>call.url.endsWith('/product-label-draft')).length,1);assert.equal(f.calls.filter(call=>call.init.method==='PUT').length,0);assert.equal(f.attachments.length,0);
 }
 const rejected=fixture({intercept(url){if(url.endsWith('/product-label-draft'))return Response.json({code:'PRODUCT_LABEL_DRAFT_NOT_CONFIGURED',error:'not configured'},{status:503});}});
 assert.equal((await rejected.run()).uncertain,false);assert.equal(rejected.calls.filter(call=>call.init.method==='PUT').length,0);
});

test('a committed text save with a lost acknowledgement is proven by one read and is never PUT twice',async()=>{
 let lost=true;const f=fixture({afterWrite(){if(lost){lost=false;throw Error('committed text ACK lost');}}}),result=await f.run();
 assert.equal(result.status,'draft');assert.equal(result.uncertain,false);assert.equal(result.completedOptions,2);
 assert.equal(f.calls.filter(call=>call.init.method==='PUT').length,2,'Exactly one text PUT per included option');
 assert.equal(f.calls.filter(call=>call.url.endsWith('/product-label-draft')).length,2,'No regenerated proposal on lost ACK');
 assert.equal(f.view.rows[1].values.material,'스펀지');assert.deepEqual(f.attachments,['one','two']);
});

test('real label draft/save/upload/reference handlers persist the proposed values and exact option PNGs in local SQLite only',async()=>{
 const h=mobileIntakeHarness();try{
  await h.intake();const product=h.sqlite.prepare('SELECT * FROM products').get(),base='/api/products/'+product.id;
  const originalGet=h.bindings.FILES.get;h.bindings.FILES.get=async(key,options)=>{const object=await originalGet(key),bytes=h.objects.get(key);if(!object||!bytes)return object;const offset=options?.range?.offset??0,end=options?.range?.length===undefined?bytes.byteLength:offset+options.range.length;return{...object,body:new Response(bytes.slice(offset,end)).body};};
  h.bindings.SOURCEFLOW_QUOTATION_AI_PROVIDER='workers-ai';h.bindings.SOURCEFLOW_QUOTATION_AI_FREE_ONLY='true';let aiCalls=0;
  h.bindings.AI.run=async(_model,input)=>{assert.equal(JSON.parse(input.messages[1].content).task,'KOREAN_LABELS');aiCalls++;return{response:JSON.stringify({content:'1개',material:'합성 시험 재질',type:'합성 시험 유형'})};};
  const before=await(await h.route(base+'/product-labels')).json(),included=before.rows.filter(row=>row.optionId!==null&&row.included);assert.ok(included.length);
  const excluded=before.rows.filter(row=>row.optionId===null||!row.included),calls=[],rendered=[],controller=new AbortController();
  const request=async(url,init={})=>{assert.equal(init.signal,controller.signal);calls.push({url,method:init.method??'GET'});if(url==='/api/files')return h.load('app/api/files/route.ts').POST(new Request('https://app.test/api/files',{method:'POST',body:init.body}));return h.route(url,{method:init.method??'GET',...(init.body?{body:JSON.parse(init.body)}:{})});};
  const beforeNetwork=h.network.length,result=await h.load('app/batch-selected-label-work.ts').runSelectedLabelWork(product.id,{signal:controller.signal,fetcher:request,assertCurrent(){},render:async plan=>{rendered.push(clone(plan));return{blob:new Blob([png],{type:'image/png'}),width:800,height:500};}});
  assert.equal(result.status,'draft',result.message);assert.equal(result.completedOptions,included.length);assert.equal(result.uncertain,false);assert.equal(aiCalls,included.length);assert.equal(rendered.length,included.length);
  const saved=await(await h.route(base+'/product-labels')).json(),quote=await(await h.route(base+'/quotation-fields')).json();
  assert.deepEqual(saved.rows.filter(row=>row.optionId===null||!row.included),excluded);
  for(const row of included){const next=saved.rows.find(item=>item.optionId===row.optionId),key=quote.resolved.rows.find(item=>item.optionId===row.optionId).fields.labelImages.value;assert.equal(next.values.material,'합성 시험 재질');assert.match(key,/owner\/quotation-label-[a-f0-9]{64}\.png/u);assert.deepEqual(h.objects.get(key),png);}
  assert.equal(calls.filter(call=>call.url==='/api/files'&&call.method==='POST').length,included.length);assert.equal(h.network.length,beforeNetwork,'No live source/provider requests');
 }finally{h.close();}
});
