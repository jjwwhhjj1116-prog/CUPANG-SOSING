import test from 'node:test';
import assert from 'node:assert/strict';
import {acknowledgementClock,deferred,intakeWithDeadline,observe,settle} from './helpers/intake-collection-deadline.mjs';
import {companies,json,manualSpineDraft,plain,workflowSpineFixture} from './helpers/registration-workflow-spine.mjs';
import {createProductDocumentPacket} from '../extensions/supplier-hub/product-document.mjs';
import {dispatchProductDocument,PRODUCT_DOCUMENT_LIVE_VERIFIED} from '../extensions/supplier-hub/product-document-dispatch.mjs';
import {SINGLE_SENDER} from './helpers/supplier-hub-single-document.mjs';

async function fixture(company,phase){
 const f=await workflowSpineFixture(company),clock=acknowledgementClock(f.h.load),collect=intakeWithDeadline(f.h,clock),held=deferred(),controller=new AbortController(),jobs=[],progress=[];
 let committed=false,sourceBytes;
 const request=async(url,init={})=>{
  const response=await f.request(url,init);
  if(url.endsWith('/collect')&&init.method==='POST'){
   assert.equal(response.status,200,await response.clone().text());sourceBytes=JSON.stringify(f.h.sqlite.prepare('SELECT * FROM collection_results').all());committed=true;
   return phase==='headers'?held.promise:{ok:true,status:200,json:()=>held.promise};
  }
  return response;
 };
 const run=()=>collect(f.job,{signal:controller.signal,fetcher:request,onJob:value=>jobs.push(value),onProgress:value=>progress.push(value),
  captureFromBrowser:async()=>assert.fail('An uncertain acknowledgement cannot start a second collector'),probeExistingFromBrowser:async()=>null});
 return{...f,clock,held,controller,jobs,progress,run,get committed(){return committed;},get sourceBytes(){return sourceBytes;}};
}
async function ready(f){for(let i=0;i<80&&!f.committed;i++)await settle();assert.equal(f.committed,true,'Local real source handler must have committed before testing a lost acknowledgement');}

for(const company of companies)for(const phase of ['headers','body'])test(`${company.code}: a timed-out ${phase} ACK continues through reviewed seven-stage data and whole-product packet`,async()=>{
 const f=await fixture(company,phase);try{
  const promise=f.run();await ready(f);assert.equal(f.h.sqlite.prepare('SELECT count(*) n FROM products').get().n,0);
  f.clock.fire(40_000);const message=await promise;assert.match(message,/상품 초안 저장됨/);assert.equal(f.clock.timers.size,0);assert.equal(f.controller.signal.aborted,false);
  assert.equal(f.requests.filter(call=>call.url.endsWith('/collect')).length,1);assert.equal(f.requests.filter(call=>call.url.endsWith('/browser-capture')).length,0);
  assert.equal(f.h.sqlite.prepare('SELECT count(*) n FROM products').get().n,1);assert.equal(f.h.aiSources.length,1);
  const draft=await manualSpineDraft({...f,run:async()=>message}),{base,included,quotation}=draft;
  const candidate=await json(await f.h.route(base+'/supplier-hub-single-package'));
  assert.equal(candidate.review.canPrepare,true,JSON.stringify(candidate.review.issues));
  const prepared=await json(await f.h.route(base+'/supplier-hub-single-package',{method:'POST',body:{action:'prepare',expectedFingerprint:candidate.fingerprint}}));
  const review=await f.h.load('app/supplier-hub-product-document.ts').reviewCurrentSupplierHubProductDocument({productId:f.product().id,packageView:prepared,quotationView:quotation,fetcher:f.request,signal:new AbortController().signal});
  assert.equal(review.identity.company.code,company.code);assert.equal(review.identity.categoryId,f.snapshot.categoryId);
  assert.deepEqual(plain(review.members.map(member=>member.optionId)),included);assert.equal(review.body.jsonDocument.length,2);
  assert.equal(review.body.jsonDocument[0].startPage.productName,'첫 옵션 견적서 전용 제목');assert.equal(review.body.jsonDocument[1].startPage.productName,draft.title+', 직접 확인한 두 번째 옵션');
  assert.equal(review.body.jsonDocument[0].productPage.modelNumber,'');assert.equal(review.body.jsonDocument[1].productPage.commonAttributes.purchasePrice,'3333');
  assert.equal(review.body.jsonDocument[1].productPage.commonAttributes.coupangSalePrice,'4444');assert.equal(review.body.jsonDocument[1].productPage.commonAttributes.msrp,'5555');
  assert.ok(review.body.jsonDocument.every(doc=>doc.imagePage.details.htmlProductDetailContent===''));
  const before=f.state(),packet=await createProductDocumentPacket(review),preview=await dispatchProductDocument({type:'YOOFAM_PRODUCT_DOCUMENT_REQUEST',action:'preview',packet},SINGLE_SENDER);
  assert.equal(preview.remoteWrites,false);assert.equal(preview.registered,false);assert.equal(PRODUCT_DOCUMENT_LIVE_VERIFIED,false);assert.deepEqual(plain(packet.review.body),plain(review.body));
  assert.equal(JSON.stringify(f.h.sqlite.prepare('SELECT * FROM collection_results').all()),f.sourceBytes);
  f.held.resolve(phase==='headers'?Response.json({jobId:'wrong-late-job'}):{jobId:'wrong-late-job'});await settle();
  assert.equal(f.state(),before);assert.equal(f.requests.filter(call=>call.url.endsWith('/collect')).length,1);assert.equal(f.h.sqlite.prepare('SELECT count(*) n FROM supplier_hub_single_receipts').get().n,0);f.unchangedContext();
 }finally{f.close();}
});

for(const company of companies)test(`${company.code}: closing a stalled ACK preserves only the committed receipt and resuming does not recollect`,async()=>{
 const f=await fixture(company,'body');try{
  const pending=observe(f.run());await ready(f);f.controller.abort();await settle();assert.equal(pending.settled,true);assert.equal(pending.value,undefined);assert.equal(pending.error,undefined);
  assert.equal(f.h.sqlite.prepare('SELECT count(*) n FROM products').get().n,0);assert.equal(f.h.sqlite.prepare('SELECT count(*) n FROM collection_results').get().n,1);assert.equal(f.clock.timers.size,0);
  const job=await f.h.load('db/collection-jobs.ts').findCollectionJob('owner',f.job.id),sourceRequests=f.sourceCalls.length;assert.ok(job.received_at);
  const resumed=await intakeWithDeadline(f.h,f.clock)(job,{signal:new AbortController().signal,fetcher:f.request,onJob(){},onProgress(){}});
  assert.match(resumed,/상품 초안 저장됨/);assert.equal(f.h.sqlite.prepare('SELECT count(*) n FROM products').get().n,1);assert.equal(f.h.aiSources.length,1);
  assert.equal(f.requests.filter(call=>call.url.endsWith('/collect')).length,1);assert.equal(f.sourceCalls.length,sourceRequests);assert.equal(JSON.stringify(f.h.sqlite.prepare('SELECT * FROM collection_results').all()),f.sourceBytes);
  const before=f.state();f.held.reject(Error('late local body failure'));await settle();assert.equal(f.state(),before);assert.equal(f.clock.timers.size,0);f.unchangedContext();
 }finally{f.close();}
});
