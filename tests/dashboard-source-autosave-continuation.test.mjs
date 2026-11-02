import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {createRequire} from 'node:module';
import {reviewSourceFixture} from './helpers/source-review-intake.mjs';

const company={code:'A01526306',name:'유앤채'},owner='test-owner';
const profile={id:'00000000-0000-0000-0000-000000000647',revision:1,categoryId:'80719',categoryPath:['주방용품','주방수납','바스켓']};
const sourceUrl=index=>`https://detail.1688.com/offer/${764000000001+index}.html`;

/** Actual dashboard, draft hook, intake panel and submit adapter. Collection
 * execution is held locally; the panel itself calls the parent's product
 * continuation. No test calls onOpenProduct or contacts a provider/browser. */
async function setup(kinds=['page','query']){
 const file=new URL('./dashboard-account-actions.test.mjs',import.meta.url),source=fs.readFileSync(file,'utf8'),ast=ts.createSourceFile(file.pathname,source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
 let declarations=ast.statements.filter(row=>ts.isVariableStatement(row)||ts.isFunctionDeclaration(row)).map(row=>row.getText(ast)).join('\n').replaceAll('import.meta.url',JSON.stringify(file.href));
 const replace=(before,after)=>{assert.ok(declarations.includes(before),before);declarations=declarations.replace(before,after);};
 replace("if(name==='@/app/components/use-intake-draft')return{useIntakeDraft:()=>draft};", "if(name==='@/app/components/use-intake-draft')return load('app/components/use-intake-draft.ts');if(name==='@/app/components/intake-queue-panel')return load('app/components/intake-queue-panel.tsx');if(name==='@/app/intake-collection')return{collectIntakeProduct:auditCollect};if(name==='@/app/browser-product-bridge')return{capture1688FromChrome:()=>assert.fail('Browser forbidden'),probe1688FromChrome:()=>assert.fail('Browser forbidden')};");
 replace("requests.push({url,init,method:init.method??'GET'});", "requests.push({url,init,method:init.method??'GET'});const override=await auditTransport(url,init);if(override!==undefined)return override;");
 replace('setTimeout:()=>0','setTimeout:auditSetTimeout,clearTimeout:auditClearTimeout');
 replace('structuredClone,crypto,fetch:request','structuredClone,crypto,setTimeout,clearTimeout,queueMicrotask,fetch:request');
 replace("RegistrationBoard:'registration-board'", "RegistrationBoard:'registration-board',IntakeQueuePanel:'intake-queue-panel'");
 const timers=new Map(),writes=[],collections=[];let serial=0,readFailure=false,persisted={revision:0,rows:[],goal:'work',updatedAt:null};
 const auditSetTimeout=(fn,ms)=>{timers.set(++serial,{fn,ms});return serial;},auditClearTimeout=id=>timers.delete(id);
 const auditTransport=async(url,init)=>{
  if(url==='/api/intake-draft'){
   if(init.method==='PUT')return new Promise((resolve,reject)=>writes.push({resolve,reject,body:JSON.parse(init.body)}));
   return readFailure?Response.json({error:'합성 초안 조회 실패'},{status:503}):Response.json({ownerId:owner,draft:persisted});
  }
  if(url==='/api/collection-jobs'&&init.method==='POST'){
   const body=JSON.parse(init.body),job={id:'00000000-0000-0000-0001-'+String(collections.length+1).padStart(12,'0'),owner_id:owner,
    source_url:body.urls[0],offer_id:/offer\/(\d+)/u.exec(body.urls[0])[1],goal:body.goal,status:'awaiting_connector',context:{category:profile,features:body.features,keywords:body.keywords}};
   return Response.json({jobs:[job],preservedRequests:[]});
  }
 };
 const auditCollect=(job,callbacks)=>new Promise(resolve=>collections.push({job,callbacks,resolve}));
 const {harness,nodes,text}=vm.runInNewContext(declarations+'\n({harness,nodes,text})',{assert,fs,vm,ts,createRequire,reviewSourceFixture,URL,Response,Request,File,Blob,FormData,URLSearchParams,
  TextEncoder,TextDecoder,AbortController,AbortSignal,crypto,structuredClone,setImmediate,setTimeout,clearTimeout,queueMicrotask,auditTransport,auditCollect,auditSetTimeout,auditClearTimeout});
 const page=index=>{const item=reviewSourceFixture(owner,company).saved;item.id='76400000-0000-4000-8000-'+String(index+1).padStart(12,'0');item.snapshot.sourceUrl=sourceUrl(index);item.snapshot.offerId=String(764000000001+index);item.reviewed.sourceUrl=item.snapshot.sourceUrl;item.reviewed.offerId=item.snapshot.offerId;return item;};
 const query=index=>({id:'76400000-0000-4000-8000-'+String(index+1).padStart(12,'0'),ownerId:owner,company,fingerprint:'c'.repeat(64),revision:1,captureVersion:1,
  receivedAt:'2026-11-02T00:00:00.000Z',archivedAt:null,sourceUrl:sourceUrl(index),offerId:String(764000000001+index),title:'URL 합성 원문 '+index,optionCount:2,thumbnailUrl:null});
 const state={items:kinds.flatMap((kind,index)=>kind==='page'?[page(index)]:[]),queryItems:kinds.flatMap((kind,index)=>kind==='query'?[query(index)]:[]),reload(){},acceptReviewed(){return false;}};
 const h=harness({sourceRegistrationsState:state,realRegistrationBoard:true,profiles:[profile]});h.products.splice(0);await h.settle();
 nodes(h.render()).find(row=>row.type==='input'&&row.props['aria-label']==='전체 작업').props.onChange({target:{checked:false}});
 nodes(h.render()).find(row=>row.type==='input'&&row.props['aria-label']==='가격 작업').props.onChange({target:{checked:true}});await h.settle();
 await h.click('최근 상품 전체 선택');await h.click('작업 개시');
 const choose=async()=>{assert.ok(h.component('category-picker'));h.component('category-picker').onSelected(profile);await h.settle();};
 const tick=async()=>{for(const [id,timer]of [...timers])if(timer.ms===1000){timers.delete(id);timer.fn();}await h.settle();};
 const complete=async index=>{
  const collection=collections[index],product={id:'fresh-intake-'+index,owner_id:owner,source_url:collection.job.source_url,title:'합성 상품 '+index,
   updated_at:'2026-11-02T00:00:01.000Z',created_at:'2026-11-02T00:00:01.000Z',image_keys:'[]',options_count:1};
  h.products.push(product);h.setProductReply(id=>Response.json({product:h.products.find(row=>row.id===id)}));collection.callbacks.onJob({...collection.job,product_id:product.id});collection.resolve('합성 원본 반영 완료');await h.settle();return product;
 };
 const acknowledge=async(index=0,lost=false)=>{
  const pending=writes[index],body=pending.body;persisted={revision:body.expectedRevision+1,goal:body.goal,updatedAt:'2026-11-02T00:00:00.000Z',rows:body.rows.map(row=>({id:row.id,profile,url:row.url,
   features:row.features,keywords:row.keywords,status:'draft',message:'',...(row.sourceCapture?{sourceCapture:row.sourceCapture}:{})}))};
  if(lost)pending.reject(Error('합성 저장 ACK 유실'));else pending.resolve(Response.json({ownerId:owner,draft:persisted}));await h.settle();
 };
 return{h,state,writes,collections,choose,tick,complete,acknowledge,text:()=>text(h.render()),failRead:value=>readFailure=value};
}

for(const kinds of [['page','page'],['query','query'],['page','query']])test(kinds.join('/')+' keeps the selected continuation through a real pending draft autosave and launches fresh IDs once',async()=>{
 const f=await setup(kinds);try{
  await f.choose();assert.equal(f.collections.length,1);await f.tick();assert.equal(f.writes.length,1);const first=await f.complete(0);
  assert.equal(f.h.component('category-picker'),undefined);assert.equal(f.h.component('batch-work-panel'),undefined);
  assert.equal(f.h.button('작업 개시').props.disabled,true,'the original source plan stays active while its draft save is pending');
  await f.acknowledge();assert.ok(f.h.component('category-picker'));await f.choose();assert.equal(f.collections.length,2);const second=await f.complete(1);
  const batch=f.h.component('batch-work-panel'),mount=f.h.componentMount('batch-work-panel'),request=batch.runRequest;
  assert.deepEqual(Array.from(batch.products,row=>row.id),[first.id,second.id]);assert.deepEqual(Array.from(request.stages),['pricing']);
  f.collections[0].callbacks.onJob({...f.collections[0].job,product_id:first.id});f.collections[0].resolve('늦은 기존 완료 응답');
  await f.h.settle();assert.equal(f.h.componentMount('batch-work-panel'),mount);assert.equal(f.h.component('batch-work-panel').runRequest,request);
  assert.equal(f.collections.length,2);assert.doesNotMatch(f.text(),/현재 상품 목록과 대기열을 확인한 뒤 다시 추가/);
  const starts=Array.from(f.h.requests).filter(row=>row.url==='/api/collection-jobs'&&row.method==='POST').map(row=>JSON.parse(row.init.body)).sort((a,b)=>a.urls[0].localeCompare(b.urls[0]));
  assert.deepEqual(starts.map(row=>[row.profileId,row.expectedProfileRevision,row.goal,row.urls[0]]),kinds.map((_,index)=>[profile.id,profile.revision,'collect',sourceUrl(index)]));
  assert.deepEqual(f.collections.map(row=>row.callbacks.selectedCapture).sort((a,b)=>a.sourceUrl.localeCompare(b.sourceUrl)).map(row=>row.format),kinds.map(kind=>kind==='page'?'yoofam-saved-page-capture-v1':'yoofam-saved-query-capture-v1'));
 }finally{f.h.close();}
});

test('a lost draft ACK is reconciled by the real hook before the next category without recollecting the first source',async()=>{
 const f=await setup();try{
  await f.choose();await f.tick();await f.complete(0);await f.acknowledge(0,true);assert.ok(f.h.component('category-picker'));
  assert.equal(f.writes.length,1);assert.equal(f.collections.length,1);await f.choose();await f.complete(1);
  assert.equal(f.h.component('batch-work-panel').products.length,2);assert.equal(f.collections.length,2);
 }finally{f.h.close();}
});

test('a failed draft save keeps the original plan paused for explicit retry and never loops collection',async()=>{
 const f=await setup();try{
  await f.choose();await f.tick();await f.complete(0);f.failRead(true);f.writes[0].reject(Error('합성 저장 실패'));await f.h.settle();
  assert.match(f.text(),/자동저장 일시중지/);assert.equal(f.h.component('category-picker'),undefined);assert.equal(f.collections.length,1);assert.equal(f.h.button('작업 개시').props.disabled,true);
  await f.tick();assert.equal(f.writes.length,1);assert.equal(f.collections.length,1);
  f.failRead(false);await f.h.click('저장 다시 시도');assert.equal(f.writes.length,2);await f.acknowledge(1);assert.ok(f.h.component('category-picker'));
  await f.choose();await f.complete(1);assert.equal(f.h.component('batch-work-panel').products.length,2);assert.equal(f.collections.length,2);
 }finally{f.h.close();}
});

test('the final fresh product also waits for the pending queue save before one batch launch',async()=>{
 const f=await setup(['query']);try{
  await f.choose();await f.tick();const product=await f.complete(0);assert.equal(f.h.component('batch-work-panel'),undefined);
  await f.acknowledge();assert.deepEqual(Array.from(f.h.component('batch-work-panel').products,row=>row.id),[product.id]);assert.equal(f.collections.length,1);
 }finally{f.h.close();}
});

test('owner, company, settings and capture changes still cancel a plan while draft saving waits',async()=>{
 for(const change of ['owner','company','settings','capture']){
  const f=await setup();try{
   await f.choose();await f.tick();await f.complete(0);
   if(change==='owner')f.h.switchOwner('next-owner');
   if(change==='company'){f.h.setSettingsBody({settings:{brand:'다른 승인 회사'},scope:{ownerId:owner,company:{code:'A01464742',name:'와이홉'}}});await f.h.click('새로고침');}
   if(change==='settings')f.h.component('intake-queue-panel').onSettingsReloadStarted();
   if(change==='capture')f.state.queryItems=f.state.queryItems.map(row=>({...row,revision:row.revision+1}));
   await f.h.settle();await f.acknowledge();assert.equal(f.h.component('category-picker'),undefined,change);assert.equal(f.h.component('batch-work-panel'),undefined,change);
   assert.equal(f.collections.length,1,change);assert.equal(f.writes.length,1,change);
  }finally{f.h.close();}
 }
});
