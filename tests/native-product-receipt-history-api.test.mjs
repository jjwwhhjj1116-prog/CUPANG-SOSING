import test from 'node:test';
import assert from 'node:assert/strict';
import {nativeReviewFixture,companies,plain,syntheticObservation,json} from './helpers/native-source-review.mjs';

async function fixture(company=companies[0]){
 const f=await nativeReviewFixture(company),review=plain(await f.model.compileNativeSupplierHubProductDocument(f.input));
 const observation=syntheticObservation(review,{observedAt:Date.now()-1000}),endpoint=f.base+'/supplier-hub-product-receipt';
 const post=body=>f.h.route(endpoint,{method:'POST',body});
 const saved=(await json(await post({profileId:f.profile.id,observation}))).receipt;
 const row=()=>f.h.sqlite.prepare('SELECT rowid,* FROM supplier_hub_single_receipts').get();
 const value=(status='FINISHED',observedAt=Date.now())=>{const result=plain(observation);result.state=result.receipt.state={SUBMITTED:'pending',FINISHED:'accepted',REJECTED:'rejected'}[status];result.receipt.sourceStatus=status;result.receipt.observedAt=observedAt;return result;};
 return {...f,review,observation,saved,endpoint,row,value,post,refresh:(observation=value())=>post({action:'observe-history',requestId:saved.requestId,observation})};
}
const immutable=value=>{const result=plain(value);delete result.recordedAt;for(const key of ['state','sourceStatus','observedAt','rejectionDetails'])delete result.receipt[key];return result;};

for(const company of companies)test(`${company.code}: historical refresh keeps the original native request when only current source clocks differ`,async()=>{
 const f=await fixture(company);try{
  const before=f.row(),at=f.h.sqlite.prepare('SELECT updated_at FROM products WHERE id=?').get(f.id).updated_at;
  f.h.sqlite.prepare('UPDATE products SET updated_at=? WHERE id=?').run(new Date(Date.parse(at)+1000).toISOString(),f.id);
  const currentSource=await f.source(),currentView=await f.fields(),currentReview=await f.model.compileNativeSupplierHubProductDocument({...f.input,sourcePlan:currentSource,quotationView:currentView});
  assert.notEqual(currentSource.sourcePlanSha256,f.saved.fingerprint);assert.equal(currentReview.originalBodySha256,f.review.originalBodySha256);assert.equal(currentReview.preparedBodySha256,f.review.preparedBodySha256);
  const body=f.value(),protectedSource=f.state(),protectedImages=f.objectState();
  await json(await f.post({profileId:f.profile.id,observation:body}),409,'normal transmission identity is unchanged');
  const result=(await json(await f.refresh(body))).receipt;assert.equal(result.receipt.sourceStatus,'FINISHED');assert.deepEqual(immutable(result),immutable(f.saved));
  assert.equal(result.source.productVersion,at);assert.equal(f.row().rowid,before.rowid);assert.equal(f.row().created_at,before.created_at);assert.equal(f.state(),protectedSource);assert.equal(f.objectState(),protectedImages);assert.deepEqual(f.h.network,[]);
  const summary=await f.h.load('db/supplier-hub-single-receipts.ts').readSingleReceiptSummaries('owner',[{id:f.id}]);assert.equal(summary[f.id].sourceStatus,'FINISHED');assert.equal(summary[f.id].registered,false);
 }finally{f.close();}
});

test('historical refresh never checks current image readiness or reads/publishes private image bytes',async()=>{
 const f=await fixture();try{
  const head=f.h.bindings.FILES.head;f.h.bindings.FILES.head=async key=>{const result=await head(key);return key===f.keys[0]&&result?{...result,customMetadata:{...result.customMetadata,sha256:'f'.repeat(64)}}:result;};
  const plan=await f.source();assert.equal(plan.metadataValid,false);assert.ok(plan.issues.length);
  const state=f.state(),images=f.objectState();let reads=0;const get=f.h.bindings.FILES.get;f.h.bindings.FILES.get=async(...args)=>{reads++;return get(...args);};
  const result=(await json(await f.refresh())).receipt;assert.equal(result.receipt.sourceStatus,'FINISHED');assert.equal(reads,0);assert.equal(f.state(),state);assert.equal(f.objectState(),images);assert.deepEqual(f.h.network,[]);
 }finally{f.close();}
});

test('historical refresh cannot create an original receipt or accept an alternate request',async()=>{
 const f=await fixture();try{
  f.h.sqlite.prepare('DELETE FROM supplier_hub_single_receipts').run();await json(await f.refresh(),409);assert.equal(f.row(),undefined);
  await json(await f.post({action:'observe-history',requestId:'76000000-0000-4000-8000-000000000002',observation:f.value()}),409);assert.equal(f.row(),undefined);assert.deepEqual(f.h.network,[]);
 }finally{f.close();}
});

test('historical observation pins all original source/body/member/document and typed registration-file identifiers',async()=>{
 const f=await fixture();try{
  const before=f.row().payload,mutations=[value=>value.requestId='76000000-0000-4000-8000-000000000002',value=>value.docId=String(value.docId),value=>value.receipt.docId=String(value.receipt.docId),
   value=>value.receipt.qvtRequestId=String(value.receipt.qvtRequestId),value=>value.receipt.receiptId++,value=>value.identity.ownerId='another-owner',value=>value.identity.company=companies[1],
   value=>value.identity.source.contentRevision++,value=>value.identity.members.reverse(),value=>value.identity.appTabId++,value=>value.identityDigest='f'.repeat(64),value=>value.packetDigest='f'.repeat(64),
   value=>value.originalBodySha256='f'.repeat(64),value=>value.preparedBodySha256='f'.repeat(64),value=>value.receipt.preparedBodySha256='f'.repeat(64),value=>value.receipt.identityDigest='f'.repeat(64),
   value=>value.registered=true,value=>value.success=true,value=>value.needsRecovery=true,value=>value.receipt.observedAt=Date.now()+120000,value=>value.receipt.extra=true,value=>value.recordedAt=new Date().toISOString()];
  for(const mutate of mutations){const value=f.value();mutate(value);await json(await f.refresh(value),409);assert.equal(f.row().payload,before);}
  await json(await f.post({action:'observe-history',requestId:f.saved.requestId,observation:f.value(),profileId:f.profile.id}),400);assert.equal(f.row().payload,before);assert.deepEqual(f.h.network,[]);
 }finally{f.close();}
});

test('historical refresh is idempotent after a lost ACK and cannot regress accepted or rejected evidence',async()=>{
 const f=await fixture();try{
  const first=f.value('FINISHED',Date.now()-100),result=(await json(await f.refresh(first))).receipt,row=f.row();
  const retry=(await json(await f.refresh(first))).receipt;assert.deepEqual(retry,result);assert.equal(f.row().created_at,row.created_at);assert.equal(f.row().rowid,row.rowid);
  await json(await f.refresh(f.value('SUBMITTED',Date.now())),409);assert.equal(f.row().payload,row.payload);
  const rejected=(await json(await f.refresh(f.value('REJECTED',Date.now()+1)))).receipt;assert.equal(rejected.receipt.sourceStatus,'REJECTED');const rejectedPayload=f.row().payload;
  await json(await f.refresh(f.value('FINISHED',Date.now()+2)),409);assert.equal(f.row().payload,rejectedPayload);
  assert.equal(f.h.sqlite.prepare('SELECT count(*) n FROM supplier_hub_single_receipts').get().n,1);assert.equal(f.row().rowid,row.rowid);assert.deepEqual(f.h.network,[]);
 }finally{f.close();}
});

test('current source or membership changes inside the historical UPDATE fail CAS and preserve the original receipt',async()=>{
 for(const mode of ['source','quotation','member','request']){const f=await fixture();try{
  const before=f.row().payload,prepare=f.h.db.prepare;let injected=false;
  f.h.db.prepare=sql=>{const query=prepare(sql),first=query.first;if(/^UPDATE supplier_hub_single_receipts SET observed_at=/u.test(sql.trim()))query.first=async()=>{
   f.h.db.prepare=prepare;injected=true;
   if(mode==='source')f.h.sqlite.prepare('UPDATE products SET updated_at=? WHERE id=?').run('2026-10-21T00:00:00.000Z',f.id);
   if(mode==='quotation')f.h.sqlite.prepare('UPDATE product_quotation_fields SET revision=revision+1 WHERE product_id=?').run(f.id);
   if(mode==='member')f.h.sqlite.prepare("UPDATE members SET status='rejected' WHERE id='owner'").run();
   if(mode==='request')f.h.sqlite.prepare("UPDATE supplier_hub_single_receipts SET payload=json_set(payload,'$.identityDigest',?)").run('f'.repeat(64));
   return first.call(query);
  };return query;};
  await json(await f.refresh(),409);assert.equal(injected,true,mode);if(mode!=='request')assert.equal(f.row().payload,before);assert.equal(f.row().observed_at,f.saved.receipt.observedAt);assert.deepEqual(f.h.network,[]);
 }finally{f.close();}}
});
