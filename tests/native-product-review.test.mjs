import test from 'node:test';
import assert from 'node:assert/strict';
import {nativeReviewFixture,companies,plain,digest} from './helpers/native-source-review.mjs';
import {createProductDocumentPacket,validateProductDocumentPacket} from '../extensions/supplier-hub/product-document.mjs';

for(const company of companies)test(`${company.code}: current private source plan compiles all included filename documents and passes the independent packet validator without publishing or sending`,async()=>{
 const f=await nativeReviewFixture(company);try{
  const db=f.state(),bytes=f.objectState(),old=plain(await(await f.h.route(f.endpoint)).json());
  const review=await f.model.reviewCurrentNativeSupplierHubProductDocument({...f.input,signal:new AbortController().signal,fetcher:f.request});
  assert.equal(review.identity.fingerprint,f.sourcePlan.sourcePlanSha256);assert.equal(review.identity.requestedProfileId,f.profile.id);assert.equal(review.members.length,2);assert.ok(Object.isFrozen(review));assert.ok(Object.isFrozen(review.members));
  assert.deepEqual(plain(review.body),f.sourcePlan.body);assert.equal(review.originalBodySha256,f.sourcePlan.originalBodySha256);assert.equal(review.preparedBodySha256,f.sourcePlan.preparedBodySha256);
  const packet=await createProductDocumentPacket(plain(review)),validated=await validateProductDocumentPacket(packet);assert.equal(validated.packet.review.identity.fingerprint,review.identity.fingerprint);
  assert.equal(f.calls.length,3);assert.equal(f.calls.filter(call=>call.url===f.sourcePath).length,1);assert.ok(f.calls.every(call=>call.method==='GET'));assert.equal(f.state(),db);assert.equal(f.objectState(),bytes);assert.deepEqual(plain(await(await f.h.route(f.endpoint)).json()),old);assert.deepEqual(f.h.network,[]);
  assert.equal([...f.h.objects.keys()].some(key=>key.startsWith('quotation-public-detail/')),false);assert.equal(f.h.sqlite.prepare('SELECT count(*) AS n FROM supplier_hub_receipts').get().n,0);
 }finally{f.close();}
});
test('native review rejects stale source, changed actor, changed options and a different requested profile without preparing a public package',async()=>{
 for(const kind of ['product','company','profile','options']){const f=await nativeReviewFixture();try{
  const input={...f.input,signal:new AbortController().signal,fetcher:f.request};
  if(kind==='product')f.h.sqlite.prepare('UPDATE products SET updated_at=? WHERE id=?').run('2026-10-21T00:00:00.000Z',f.id);
  if(kind==='company')f.h.setCompany(companies[1]);
  if(kind==='profile')input.profileId='different';
  if(kind==='options')input.quotationView={...plain(f.quotationView),resolved:{...plain(f.quotationView.resolved),rows:[...plain(f.quotationView.resolved.rows)].reverse()}};
  await assert.rejects(f.model.reviewCurrentNativeSupplierHubProductDocument(input));assert.deepEqual(f.h.network,[]);
 }finally{f.close();}}
});
test('wrong digest, unsafe/missing file, role path, slot order or filename body cannot become a current native review',async()=>{
 const f=await nativeReviewFixture();try{
  for(const mutate of [p=>p.sourcePlanSha256='f'.repeat(64),p=>p.identity.ownerId='other',p=>p.images[0].key='other/private.png',p=>p.images[0].references[0].wire.path=['imagePage','images','additionalImage'],p=>p.images[0].references[0].slotIndex=2,p=>p.images[0].transportName='../unsafe.png',p=>p.body.jsonDocument[0].imagePage.images.mainImage='foreign.png']){
   const sourcePlan=plain(f.sourcePlan);mutate(sourcePlan);await assert.rejects(f.model.compileNativeSupplierHubProductDocument({...f.input,sourcePlan}));
  }
  // Re-signing the source envelope cannot hide a role/path mismatch from the
  // independent consumer's semantic filename checks.
  const forged=plain(f.sourcePlan);forged.images.find(file=>file.imageType==='LABEL').references[0].wire.path=['imagePage','images','mainImage'];const {sourcePlanSha256:ignored,...rest}=forged;void ignored;forged.sourcePlanSha256=digest(rest);
  await assert.rejects(f.model.compileNativeSupplierHubProductDocument({...f.input,sourcePlan:forged}));assert.deepEqual(f.h.network,[]);
 }finally{f.close();}
});
test('source responses are bounded same-origin JSON, abortable, and compared again after the native review compiles',async()=>{
 const f=await nativeReviewFixture();try{
  const controller=new AbortController();controller.abort();await assert.rejects(f.model.readCurrentNativeAssetSource({...f.scope,signal:controller.signal,fetcher:f.request}));assert.equal(f.calls.length,0);
  for(const response of [()=>new Response('{}',{headers:{'content-type':'text/html'}}),()=>new Response('x'.repeat(6*1024*1024+1),{headers:{'content-type':'application/json'}})])await assert.rejects(f.model.readCurrentNativeAssetSource({...f.scope,signal:new AbortController().signal,fetcher:async path=>path.includes('catalog-context')?Response.json({ownerId:'owner',company:companies[0]}):response()}));
  for(const images of [{},[{imageType:'MAIN'}]])await assert.rejects(f.model.readCurrentNativeAssetSource({...f.scope,signal:new AbortController().signal,fetcher:async path=>Response.json(path.includes('catalog-context')?{ownerId:'owner',company:companies[0]}:{...plain(f.sourcePlan),metadataValid:false,images})}));
  let sources=0;const fetcher=async function(path,init){const response=await f.request(path,init);if(path===f.sourcePath){sources++;const body=await response.json();body.images[0].transportName='different.png';return Response.json(body);}return response;};
  await assert.rejects(f.model.reviewCurrentNativeSupplierHubProductDocument({...f.input,signal:new AbortController().signal,fetcher}));assert.equal(sources,1);assert.deepEqual(f.h.network,[]);
 }finally{f.close();}
});

test('native source failures show bounded API diagnostics without exposing HTML or accepting failed bodies',async()=>{
 const f=await nativeReviewFixture();try{
  const input={...f.scope,signal:new AbortController().signal};
  const responseFor=response=>async path=>path.includes('catalog-context')?Response.json({ownerId:'owner',company:companies[0]}):response;
  await assert.rejects(f.model.readCurrentNativeAssetSource({...input,fetcher:responseFor(Response.json({error:'현재 첨부 파일을 확인해주세요.',code:'NATIVE_ASSET_PLAN_CHANGED'},{status:409}))}),/HTTP 409 · NATIVE_ASSET_PLAN_CHANGED.*현재 첨부 파일/);
  for(const response of [new Response('<!DOCTYPE html>secret',{status:503,headers:{'content-type':'text/html'}}),Response.json({error:'<!DOCTYPE html>secret',code:'BAD<secret>'},{status:503}),new Response('<!DOCTYPE html>secret',{headers:{'content-type':'application/json'}})]){
   await assert.rejects(f.model.readCurrentNativeAssetSource({...input,fetcher:responseFor(response)}),error=>!error.message.includes('secret')&&!error.message.includes('Unexpected token'));
  }
  assert.deepEqual(f.h.network,[]);
 }finally{f.close();}
});
