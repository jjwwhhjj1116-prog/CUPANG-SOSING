import test from 'node:test';
import assert from 'node:assert/strict';
import {nativeReviewFixture,companies,plain,json,syntheticObservation} from './helpers/native-source-review.mjs';

for(const company of companies)test(`${company.code}: actual receipt API stores a separately hashed filename-native observation and leaves product/source/public files unchanged`,async()=>{
 const f=await nativeReviewFixture(company);try{
  const review=await f.model.compileNativeSupplierHubProductDocument(f.input),observation=syntheticObservation(plain(review)),state=f.state(),images=f.objectState();
  const endpoint=f.base+'/supplier-hub-product-receipt',post=value=>f.h.route(endpoint,{method:'POST',body:{profileId:f.profile.id,observation:value}});
  const stored=await json(await post(observation));assert.equal(stored.receipt.fingerprint,f.sourcePlan.sourcePlanSha256);assert.equal(stored.receipt.members.length,2);assert.equal(stored.receipt.registered,false);assert.equal(stored.receipt.receipt.sourceStatus,'SUBMITTED');
  const again=await json(await post(observation));assert.deepEqual(again,stored);assert.equal(f.h.sqlite.prepare('SELECT count(*) AS n FROM supplier_hub_single_receipts').get().n,1);
  const history=await json(await f.h.route(endpoint));assert.equal(history.receipts.length,1);assert.equal(history.receipts[0].fingerprint,review.identity.fingerprint);assert.equal(f.state(),state);assert.equal(f.objectState(),images);assert.deepEqual(f.h.network,[]);
 }finally{f.close();}
});
test('a native receipt cannot be persisted for changed source or a body verified under the old public-url digest',async()=>{
 for(const kind of ['source','body','company']){const f=await nativeReviewFixture();try{
  const review=await f.model.compileNativeSupplierHubProductDocument(f.input),value=syntheticObservation(plain(review));
  if(kind==='source')f.h.sqlite.prepare('UPDATE products SET updated_at=? WHERE id=?').run('2026-10-21T00:00:00.000Z',f.id);
  if(kind==='body')value.preparedBodySha256='f'.repeat(64);
  if(kind==='company')value.identity.company=companies[1];
  const response=await f.h.route(f.base+'/supplier-hub-product-receipt',{method:'POST',body:{profileId:f.profile.id,observation:value}});assert.equal(response.status,409,await response.clone().text());assert.equal(f.h.sqlite.prepare('SELECT count(*) AS n FROM supplier_hub_single_receipts').get().n,0);assert.deepEqual(f.h.network,[]);
 }finally{f.close();}}
});
