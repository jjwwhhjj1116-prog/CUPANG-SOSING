import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {createRequire} from 'node:module';
import {reviewSourceFixture,sourceReviewModule} from './helpers/source-review-intake.mjs';

const fixtureUrl=new URL('./dashboard-account-actions.test.mjs',import.meta.url),source=fs.readFileSync(fixtureUrl,'utf8'),ast=ts.createSourceFile(fixtureUrl.pathname,source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
let declarations=ast.statements.filter(statement=>ts.isVariableStatement(statement)||ts.isFunctionDeclaration(statement)).map(statement=>statement.getText(ast)).join('\n').replaceAll('import.meta.url',JSON.stringify(fixtureUrl.href));
declarations=declarations.replace("goal:'work',setGoal(){}","goal:'work',setGoal(value){draft.goal=value;}");
const {harness,nodes}=vm.runInNewContext(declarations+'\n({harness,nodes})',{assert,fs,vm,ts,createRequire,URL,Response,Request,File,Blob,FormData,URLSearchParams,TextEncoder,TextDecoder,AbortController,AbortSignal,crypto,structuredClone,setImmediate,setTimeout,clearTimeout});
const plain=value=>JSON.parse(JSON.stringify(value)),company={code:'A01526306',name:'유앤채'},owner='test-owner';
const reference=item=>sourceReviewModule('app/source-inbox-archive-client.ts').sourceArchiveReference(item,owner,company);
const check=(h,label,value)=>nodes(h.render()).find(node=>node.type==='input'&&node.props['aria-label']===label).props.onChange({target:{checked:value}});
const fresh=(h,item,id='new-source-product')=>({...h.products[0],id,source_url:item.snapshot.sourceUrl,title:'새 수집본 상품'});
async function start({items,initialIntakeRows=[]}={}){
 const item=items?.[0]??reviewSourceFixture(owner,company).saved,state={items:items??[item],reload(){},acceptReviewed(){return false;}};
 const h=harness({sourceRegistrationsState:state,initialIntakeRows});await h.settle();check(h,'전체 작업',false);check(h,'가격 작업',true);check(h,'견적서 작업',true);
 h.component('registration-board').onSourceSelectionChange(state.items.map(reference));const original=JSON.stringify(h.products);await h.click('작업 개시');
 return{h,item,state,original,queue:h.component('intake-queue-panel')};
}

test('selected source freezes chosen stages, pins its capture/category seed, then hands only the freshly read new product to the runner',async()=>{
 const {h,item,original,queue}=await start();try{
  assert.ok(queue);assert.equal(queue.autoStartSource,true);assert.equal(queue.goal,'collect');assert.equal(queue.sourceSeed.sourceUrl,item.snapshot.sourceUrl);assert.equal(queue.sourceSeed.sourceCapture.captureId,item.id);assert.equal(queue.sourceSeed.sourceCapture.revision,item.revision);assert.equal(queue.sourceSeed.title,item.reviewed.title);
  assert.equal(h.component('batch-work-panel'),undefined);assert.equal(h.button('작업 개시').props.disabled,true);
  check(h,'대표 이미지 작업',true);h.component('registration-board').onSelected(new Set([h.products[1].id]));
  const created=fresh(h,item);h.setProductReply(id=>Response.json({product:id===created.id?created:h.products.find(value=>value.id===id)}));
  const before=h.requests.length;await queue.onOpenProduct(created.id,new AbortController().signal);await h.settle();const runner=h.component('batch-work-panel');
  assert.ok(runner);assert.deepEqual(plain(runner.runRequest.stages),['pricing','quotation']);assert.deepEqual(plain(runner.products.map(value=>value.id)),[created.id]);assert.equal(runner.runRequest.ownerId,owner);assert.equal(runner.products[0].title,created.title);assert.equal(h.component('intake-queue-panel'),undefined);
  assert.ok(h.requests.slice(before).some(call=>call.url==='/api/products/'+created.id&&call.method==='GET'&&call.init.cache==='no-store'));assert.equal(JSON.stringify(h.products),original);assert.ok(h.requests.every(call=>call.method==='GET'));
 }finally{h.close();}
});

test('source continuation rejects an existing product identity and preserves every prior product and price',async()=>{
 const {h,item,original,queue}=await start();try{
  const existing={...h.products[0],source_url:item.snapshot.sourceUrl};h.setProductReply(()=>Response.json({product:existing}));
  await assert.rejects(()=>queue.onOpenProduct(existing.id,new AbortController().signal),/기존 상품|별도 초안/);await h.settle();assert.equal(h.component('batch-work-panel'),undefined);assert.equal(JSON.stringify(h.products),original);assert.ok(h.requests.every(call=>call.method==='GET'));
 }finally{h.close();}
});

test('category cancellation releases source kickoff without starting a runner or changing existing products',async()=>{
 const {h,original,queue}=await start();try{assert.equal(typeof queue.onSourceCancelled,'function');queue.onSourceCancelled();await h.settle();assert.equal(h.button('작업 개시').props.disabled,false);assert.equal(h.component('batch-work-panel'),undefined);assert.equal(JSON.stringify(h.products),original);assert.ok(h.requests.every(call=>call.method==='GET'));}finally{h.close();}
});

test('owner change invalidates an in-flight fresh-product read and releases the visible old source work state',async()=>{
 const {h,item,queue}=await start();try{
  const created=fresh(h,item),pending=h.deferProduct(created.id),operation=queue.onOpenProduct(created.id,new AbortController().signal);await h.settle();
  h.setSettingsBody({settings:{},scope:{ownerId:'next-owner',company}});h.switchOwner('next-owner');await h.settle();pending.resolve(Response.json({product:created}));await operation;await h.settle();
  assert.equal(h.component('batch-work-panel'),undefined);assert.equal(h.button('작업 개시').props.disabled,false);assert.ok(h.requests.every(call=>call.method==='GET'));
 }finally{h.close();}
});

test('a changed exact capture cannot authorize a late product response or an automatic runner',async()=>{
 const {h,item,state,queue}=await start();try{
  const created=fresh(h,item),pending=h.deferProduct(created.id),operation=queue.onOpenProduct(created.id,new AbortController().signal);await h.settle();state.items=[{...item,revision:item.revision+1}];h.render();pending.resolve(Response.json({product:created}));await operation;await h.settle();assert.equal(h.component('batch-work-panel'),undefined);assert.ok(h.requests.every(call=>call.method==='GET'));
 }finally{h.close();}
});

test('closing the intake modal or changing the same owner company prevents a retained completion from starting work',async()=>{
 for(const mode of ['close','company']){const {h,item,original,queue}=await start();try{
  const created=fresh(h,item),pending=h.deferProduct(created.id),operation=queue.onOpenProduct(created.id,new AbortController().signal);await h.settle();
  if(mode==='close'){
   const close=nodes(h.render()).find(node=>node.type==='button'&&node.props.className==='icon-close');assert.ok(close);close.props.onClick();await h.settle();
  }else{
   h.setSettingsBody({settings:{},scope:{ownerId:owner,company:{code:'A01464742',name:'와이홉'}}});await h.click('새로고침');
  }
  pending.resolve(Response.json({product:created}));await operation;await h.settle();assert.equal(h.component('batch-work-panel'),undefined,mode);assert.equal(JSON.stringify(h.products),original);assert.ok(h.requests.every(call=>call.method==='GET'));
 }finally{h.close();}}
});

test('multiple selected sources advance through distinct immutable seeds and start one frozen runner after both new readbacks',async()=>{
 const first=reviewSourceFixture(owner,company).saved,second=structuredClone(first);second.id='76400000-0000-4000-8000-000000000002';second.fingerprint='b'.repeat(64);second.snapshot.sourceUrl='https://detail.1688.com/offer/764000000002.html';second.snapshot.offerId='764000000002';second.reviewed.sourceUrl=second.snapshot.sourceUrl;second.reviewed.offerId=second.snapshot.offerId;
 const {h,original,queue}=await start({items:[first,second]});try{
  const a=fresh(h,first,'new-source-a'),b=fresh(h,second,'new-source-b');h.setProductReply(id=>Response.json({product:id===a.id?a:b}));
  await queue.onOpenProduct(a.id,new AbortController().signal);await h.settle();assert.equal(h.component('batch-work-panel'),undefined);const next=h.component('intake-queue-panel');assert.equal(next.sourceSeed.sourceCapture.captureId,second.id);assert.notEqual(next.sourceSeed.id,queue.sourceSeed.id);
  await next.onOpenProduct(b.id,new AbortController().signal);await h.settle();const runner=h.component('batch-work-panel');assert.deepEqual(plain(runner.products.map(value=>value.id)),[a.id,b.id]);assert.deepEqual(plain(runner.runRequest.stages),['pricing','quotation']);assert.equal(JSON.stringify(h.products),original);assert.ok(h.requests.every(call=>call.method==='GET'));
 }finally{h.close();}
});


test('completed source work refreshes saved board state once without resubmitting any operation',async()=>{
 const {h,queue,item,original}=await start();try{
  const created=fresh(h,item,'new-refresh-product');h.setProductReply(()=>Response.json({product:created}));
  await queue.onOpenProduct(created.id,new AbortController().signal);await h.settle();
  const runner=h.component('batch-work-panel'),before=h.requests.filter(call=>call.url==='/api/products').length;
  runner.onBusyChange(false);await h.settle();assert.equal(h.requests.filter(call=>call.url==='/api/products').length,before+1);
  runner.onBusyChange(false);await h.settle();assert.equal(h.requests.filter(call=>call.url==='/api/products').length,before+1);
  assert.equal(JSON.stringify(h.products),original);assert.ok(h.requests.every(call=>call.method==='GET'));
 }finally{h.close();}
});
