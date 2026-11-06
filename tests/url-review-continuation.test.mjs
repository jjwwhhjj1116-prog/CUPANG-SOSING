import test from 'node:test';
import assert from 'node:assert/strict';
import {urlReviewFixture,plain,company,raw324} from './helpers/url-review-continuation.mjs';
import {mobileIntakeHarness} from './helpers/mobile-intake.mjs';
import {sourceReviewModule} from './helpers/source-review-intake.mjs';

test('fresh URL ACK needing review keeps its nonREADY exact capture and resumes the original row/job after selecting five',async()=>{
 const f=await urlReviewFixture();try{
  const row=await f.start();assert.equal(row.sourceCapture,undefined);assert.ok(row.sourceReviewContinuation,'fresh stored ACK cannot be discarded on ready409');
  assert.equal(f.h.sqlite.prepare('SELECT count(*) n FROM products').get().n,0);assert.equal(f.h.sqlite.prepare('SELECT count(*) n FROM collection_results').get().n,0);
  const job=f.h.sqlite.prepare('SELECT id FROM collection_jobs').get().id,original=plain(f.source),rowId=row.id;
  await f.click('수집정보 확인·수정');await f.click('선택 모두 해제');
  for(const index of [1,8,33,100,324])await f.ui.React.act(async()=>f.ui.container.querySelector(`[aria-label="${index}번째 수집 옵션 사용"]`).click());
  await f.click('검토한 상품정보 저장');await f.until(()=>f.draft.rows[0]?.sourceCapture?.revision===2);
  assert.equal(f.draft.rows[0].id,rowId);assert.equal(f.draft.rows[0].sourceCapture.captureId,f.captureId);assert.equal(f.captureCount,1);
  const close=f.ui.container.querySelector('[role="dialog"][aria-label="수집 상품정보 확인·수정"] header button');assert.ok(close);await f.ui.React.act(async()=>close.click());await f.ui.settle();
  await f.click('이 상품 초안 작성');await f.until(()=>f.h.sqlite.prepare('SELECT count(*) n FROM products').get().n===1);
  assert.equal(f.captureCount,1);assert.equal(f.h.sqlite.prepare('SELECT count(*) n FROM collection_jobs').get().n,1);assert.equal(f.h.sqlite.prepare('SELECT id FROM collection_jobs').get().id,job);
  assert.equal(f.calls.filter(call=>call.url==='/api/collection-jobs'&&call.method==='POST').length,1);
  const stored=await f.h.load('db/source-inbox.ts').readSourceInbox('owner',f.captureId);assert.deepEqual(plain(stored.snapshot),original);assert.equal(stored.snapshot.pagePriceBasis.rows.length,324);
  const receipt=JSON.parse(f.h.sqlite.prepare('SELECT payload FROM collection_results').get().payload);assert.deepEqual(receipt.options.map(option=>option.sku),[700000000000,700000000007,700000000032,700000000099,700000000323].map(String));assert.equal(receipt.pagePriceBasis.rows.length,324);
  assert.deepEqual(receipt.options.map(option=>option.unitPriceCny),[6,13,38,105,329]);const {review,...basis}=receipt.pagePriceBasis;assert.deepEqual(basis,original.pagePriceBasis);assert.deepEqual(review.sourceKeys,['key-0','key-7','key-32','key-99','key-323']);
  const options=JSON.parse(f.h.sqlite.prepare('SELECT payload FROM product_options').get().payload).rows;assert.deepEqual(options.map(option=>option.supplierSku),receipt.options.map(option=>option.sku));assert.deepEqual(options.map(option=>option.unitCostCny),[6,13,38,105,329]);assert.equal(f.h.aiSources.length,0);
 }finally{await f.close();}
});

test('a legitimate 324-to-five price review ACK retains original price facts and rejects original price drift',async()=>{
 const h=mobileIntakeHarness({companyCode:company.code,companyName:company.name});try{
  const snapshot=raw324(h.sourceUrl),app=h.load('app/source-inbox.ts'),store=h.load('db/source-inbox.ts'),id='13240000-0000-4000-8000-000000000001',fingerprint=await app.pageSourceFingerprint(snapshot);
  const before=(await store.storeSourceInbox('owner',company,id,fingerprint,snapshot)).item;
  const reviewed=app.reviewPageSource(snapshot,{title:snapshot.title,options:snapshot.options.slice(0,5).map(row=>({key:row.key}))}),saved=await store.reviewSourceInbox('owner',id,1,reviewed),model=sourceReviewModule('app/source-review-intake.ts');
  assert.equal(model.validateReviewedSourceTransition(before,saved,'owner'),true,'valid selection metadata must not discard its explicit ACK');
  const drift=plain(saved);drift.reviewed.pagePriceBasis.rows[100].observedPrice='999';assert.equal(model.validateReviewedSourceTransition(before,drift,'owner'),false);assert.deepEqual(plain(saved.snapshot),plain(snapshot));assert.equal(saved.reviewed.pagePriceBasis.rows.length,324);
  const response=await h.load('app/api/source-inbox/route.ts').PUT(new Request('https://app.test/api/source-inbox',{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify({expectedOwnerId:'owner',id,expectedRevision:2,review:{title:snapshot.title,options:snapshot.options.slice(0,201).map(row=>({key:row.key}))}})}));assert.equal(response.status,422);assert.equal((await store.readSourceInbox('owner',id)).revision,2);
 }finally{h.close();}
});

test('lost primary acknowledgement and an interrupted owned read recover only the original capture without another capture or collect',async()=>{
 for(const mode of ['lost','read-interrupted','malformed']){
  const f=await urlReviewFixture();try{
   if(mode==='lost')f.ack='error';else if(mode==='malformed')f.ack='malformed';else f.inboxStatus=503;
   const first=await f.start(),continuation=first.sourceReviewContinuation;assert.ok(continuation);assert.equal(first.sourceCapture,undefined);assert.equal(f.captureCount,1);
   if(mode==='read-interrupted'){assert.equal(continuation.state,'uncertain');assert.equal(continuation.reference.item,undefined);f.inboxStatus=200;}
   const collectCount=f.calls.filter(call=>call.url.endsWith('/collect')).length,queueCount=f.calls.filter(call=>call.url==='/api/collection-jobs'&&call.method==='POST').length;
   await f.click('시작 (1건)');await f.until(()=>f.draft.rows[0].sourceReviewContinuation?.reference.item);
   const next=f.draft.rows[0];assert.equal(next.sourceReviewContinuation.nonce,continuation.nonce);assert.equal(next.sourceReviewContinuation.reference.captureId,f.captureId);assert.equal(next.sourceCapture,undefined);assert.equal(f.captureCount,1);
   assert.equal(f.calls.filter(call=>call.url.endsWith('/collect')).length,collectCount);assert.equal(f.calls.filter(call=>call.url==='/api/collection-jobs'&&call.method==='POST').length,queueCount);assert.equal(f.h.sqlite.prepare('SELECT count(*) n FROM products').get().n,0);
  }finally{await f.close();}
 }
});

test('fresh capture review rejects foreign owner/company, URL and fingerprint responses without binding READY or repeating capture',async()=>{
 for(const mutate of [
  body=>({...body,ownerId:'foreign',items:body.items.map(item=>({...item,ownerId:'foreign'}))}),
  body=>({...body,company:{code:'A01464742',name:'와이홉'},items:body.items.map(item=>({...item,company:{code:'A01464742',name:'와이홉'}}))}),
  body=>({...body,items:body.items.map(item=>({...item,snapshot:{...item.snapshot,sourceUrl:item.snapshot.sourceUrl.replace('813724060928','813724060929')}}))}),
  body=>({...body,items:body.items.map(item=>({...item,fingerprint:'b'.repeat(64)}))}),
 ]){
  const f=await urlReviewFixture();try{f.changeInbox=mutate;const row=await f.start();assert.equal(row.sourceCapture,undefined);assert.equal(row.sourceReviewContinuation?.state,'uncertain');assert.equal(row.sourceReviewContinuation.reference.item,undefined);
   await f.click('시작 (1건)');await f.ui.settle();assert.equal(f.captureCount,1);assert.equal(f.h.sqlite.prepare('SELECT count(*) n FROM products').get().n,0);
  }finally{await f.close();}
 }
});

test('only the exact current row intent, owner/company scope, nonce and unassigned row can adopt its explicit review ACK',async()=>{
 const f=await urlReviewFixture();try{
  const row=await f.start(),continuation=row.sourceReviewContinuation,before=continuation.reference.item;
  const response=await f.fetcher('/api/source-inbox',{method:'PUT',body:JSON.stringify({expectedOwnerId:'owner',id:before.id,expectedRevision:before.revision,review:{title:before.snapshot.title,options:before.snapshot.options.slice(0,5).map(option=>({key:option.key}))}})});assert.equal(response.status,200);const saved=(await response.json()).item;
  const model=f.ui.load('app/source-review-intake.ts'),targets=[{rowId:row.id,sourceCapture:f.ui.load('app/source-capture-selection.ts').sourceCaptureSelection(before),continuation}],input={goal:'collect',settings:f.h.settings,scope:continuation.scope};
  const adopted=model.applyReviewedSourceToIntakeRows([row],targets,before,saved,input);assert.equal(adopted[0].sourceCapture.revision,2);
  for(const patch of [{profile:{...row.profile,revision:2}},{features:'changed'},{keywords:'changed'},{url:row.url.replace('813724060928','813724060929')},{status:'saved'},{productId:'assigned'},{forkJobId:'fork'},{pendingJobId:'pending'},{sourceReviewContinuation:{...continuation,nonce:'new-intent'}},{sourceReviewContinuation:undefined}]){
   const rows=[{...row,...patch}];assert.equal(model.applyReviewedSourceToIntakeRows(rows,targets,before,saved,input),rows);
  }
  for(const changed of [{...input,goal:'work'},{...input,settings:{...f.h.settings,brand:'changed'}},{...input,scope:{}},{...input,scope:{ownerId:'owner',company}}])assert.equal(model.applyReviewedSourceToIntakeRows([row],targets,before,saved,changed)[0],row);
  for(const patch of [{ownerId:'foreign'},{company:{code:'A01464742',name:'와이홉'}},{revision:4},{fingerprint:'b'.repeat(64)},{id:'99990000-0000-4000-8000-000000000001'}])assert.equal(model.applyReviewedSourceToIntakeRows([row],targets,before,{...saved,...patch},input)[0],row);
 }finally{await f.close();}
});

test('actual queue input A-B-A retires the pending nonce so an old review ACK cannot rebind the URL row',async()=>{
 const f=await urlReviewFixture();try{
  const old=await f.start(),continuation=old.sourceReviewContinuation;
  const input=f.ui.container.querySelector('[aria-label="1번째 1688 링크"]'),setter=Object.getOwnPropertyDescriptor(f.ui.window.HTMLInputElement.prototype,'value').set;
  for(const value of [f.h.sourceUrl.replace('813724060928','813724060929'),f.h.sourceUrl]){await f.ui.React.act(async()=>{setter.call(input,value);input.dispatchEvent(new f.ui.window.Event('input',{bubbles:true}));});await f.ui.settle();}
  assert.equal(f.draft.rows[0].sourceReviewContinuation,undefined);assert.equal(f.draft.rows[0].url,old.url);assert.equal(f.draft.rows[0].sourceCapture,undefined);
  const before=continuation.reference.item,app=f.h.load('app/source-inbox.ts'),saved={...before,revision:2,reviewed:app.reviewPageSource(before.snapshot,{title:before.snapshot.title,options:before.snapshot.options.slice(0,5).map(row=>({key:row.key}))}),issues:[]},targets=[{rowId:old.id,sourceCapture:f.ui.load('app/source-capture-selection.ts').sourceCaptureSelection(before),continuation}];
  const rows=f.draft.rows;assert.equal(f.ui.load('app/source-review-intake.ts').applyReviewedSourceToIntakeRows(rows,targets,before,saved,{goal:'collect',settings:f.h.settings,scope:continuation.scope}),rows);assert.equal(f.captureCount,1);
 }finally{await f.close();}
});

test('actual dashboard company A-B-A retires a held review ACK while preserving its saved raw source',async()=>{
 const f=await urlReviewFixture();let release;try{
  await f.start({recordRefresh:true});assert.equal(typeof f.refreshWorkspace,'function');await f.click('수집정보 확인·수정');await f.click('선택 모두 해제');
  for(const index of [1,2,3,4,5])await f.ui.React.act(async()=>f.ui.container.querySelector(`[aria-label="${index}번째 수집 옵션 사용"]`).click());
  f.reviewGate=new Promise(resolve=>{release=resolve;});await f.click('검토한 상품정보 저장');await f.until(()=>f.h.sqlite.prepare('SELECT revision FROM source_inbox WHERE id=?').get(f.captureId)?.revision===2);
  for(const next of [{code:'A01464742',name:'와이홉'},company]){f.company=next;f.h.setCompany(next);await f.ui.React.act(async()=>f.refreshWorkspace());await f.until(()=>f.ui.records.get('registration-board')?.sourceCompany?.code===next.code);}
  await f.ui.React.act(async()=>release());await f.ui.settle();assert.equal(f.draft.rows[0].sourceCapture,undefined);assert.equal(f.captureCount,1);assert.equal(f.h.sqlite.prepare('SELECT count(*) n FROM products').get().n,0);
  assert.deepEqual(plain((await f.h.load('db/source-inbox.ts').readSourceInbox('owner',f.captureId)).snapshot),plain(f.source));
 }finally{release?.();await f.close();}
});

test('late original-capture lookup cannot attach through an actual owner A-B-A navigation',async()=>{
 const f=await urlReviewFixture();let release;try{
  const gate=new Promise(resolve=>{release=resolve;});f.changeInbox=async body=>{if(f.captureCount&&f.calls.some(call=>call.url.startsWith('/api/source-inbox/ready?')))await gate;return body;};
  await f.start({waitForError:false});await f.until(()=>f.calls.some(call=>call.url.startsWith('/api/source-inbox/ready?')));
  for(const owner of ['foreign-owner','owner']){await f.ui.render(f.Component,{userName:'offline',workspaceOwnerId:owner});await f.ui.settle();}
  await f.ui.React.act(async()=>release());await f.ui.settle();assert.ok(f.draft.rows.every(row=>!row.sourceCapture&&!row.sourceReviewContinuation));assert.equal(f.captureCount,1);assert.equal(f.h.sqlite.prepare('SELECT count(*) n FROM products').get().n,0);
 }finally{release?.();await f.close();}
});
