import test from 'node:test';
import assert from 'node:assert/strict';
import {nativeReviewFixture,syntheticObservation,companies,json,plain} from './helpers/native-source-review.mjs';
const statusState={SUBMITTED:'pending',FINISHED:'accepted',REJECTED:'rejected'};

for(const company of companies)for(const historical of [false,true])test(company.code+': '+(historical?'historical':'current')+' receipt API retains equal-time terminal progress for the exact document only',async()=>{
 const f=await nativeReviewFixture(company);try{
  const review=await f.model.compileNativeSupplierHubProductDocument(f.input),at=Date.now()-1000,initial=syntheticObservation(review,{observedAt:at}),path=f.base+'/supplier-hub-product-receipt',sourceBefore=f.state(),objectsBefore=f.objectState();
  const post=observation=>f.h.route(path,{method:'POST',body:historical?{action:'observe-history',requestId:observation.requestId,observation}:{profileId:f.profile.id,observation}});
  await json(await f.h.route(path,{method:'POST',body:{profileId:f.profile.id,observation:initial}}));
  for(const status of ['FINISHED','REJECTED']){const observation=plain(initial);observation.state=statusState[status];observation.receipt.state=statusState[status];observation.receipt.sourceStatus=status;const saved=await json(await post(observation));assert.equal(saved.receipt.receipt.sourceStatus,status);assert.equal(saved.receipt.receipt.observedAt,at);}
  const before=f.h.sqlite.prepare('SELECT * FROM supplier_hub_single_receipts').get();
  for(const status of ['SUBMITTED','FINISHED']){const observation=plain(initial);observation.state=statusState[status];observation.receipt.state=statusState[status];observation.receipt.sourceStatus=status;const result=await post(observation);assert.ok([200,409].includes(result.status));assert.deepEqual(f.h.sqlite.prepare('SELECT * FROM supplier_hub_single_receipts').get(),before);}
  const history=await json(await f.h.route(path+f.query));assert.equal(history.receipts.length,1);assert.equal(history.receipts[0].receipt.sourceStatus,'REJECTED');assert.equal(f.state(),sourceBefore);assert.equal(f.objectState(),objectsBefore);assert.deepEqual(f.h.network,[]);
 }finally{f.close();}
});

for(const company of companies)test(company.code+': historical receipt CAS does not acknowledge lower equal-time evidence after another writer wins',async()=>{
 const f=await nativeReviewFixture(company);try{
  const review=await f.model.compileNativeSupplierHubProductDocument(f.input),initial=syntheticObservation(review,{observedAt:Date.now()-1000}),path=f.base+'/supplier-hub-product-receipt';
  await json(await f.h.route(path,{method:'POST',body:{profileId:f.profile.id,observation:initial}}));
  const observation=plain(initial);observation.state='rejected';observation.receipt.state='rejected';observation.receipt.sourceStatus='REJECTED';const post=()=>f.h.route(path,{method:'POST',body:{action:'observe-history',requestId:initial.requestId,observation}}),prepare=f.h.db.prepare;let raced=false;
  f.h.db.prepare=function(sql){const query=prepare.call(this,sql),first=query.first;if(!raced&&/^UPDATE supplier_hub_single_receipts SET/u.test(sql)){query.first=async()=>{raced=true;f.h.db.prepare=prepare;const row=f.h.sqlite.prepare('SELECT payload FROM supplier_hub_single_receipts').get(),record=JSON.parse(row.payload);record.receipt.state='accepted';record.receipt.sourceStatus='FINISHED';f.h.sqlite.prepare('UPDATE supplier_hub_single_receipts SET payload=?').run(f.h.load('app/supplier-hub-single-receipt.ts').singleReceiptCanonical(record));return first.call(query);};}return query;};
  await json(await post(),409);assert.equal(raced,true);assert.equal((await json(await f.h.route(path+f.query))).receipts[0].receipt.sourceStatus,'FINISHED');
  const retried=await json(await post());assert.equal(retried.receipt.receipt.sourceStatus,'REJECTED');assert.equal(retried.receipt.requestId,initial.requestId);assert.equal(f.h.sqlite.prepare('SELECT count(*) AS n FROM supplier_hub_single_receipts').get().n,1);assert.deepEqual(f.h.network,[]);
 }finally{f.close();}
});
