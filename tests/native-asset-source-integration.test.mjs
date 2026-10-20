import test from 'node:test';
import assert from 'node:assert/strict';
import {assetApiFixture,companies,imageBytes,plain,sha} from './helpers/supplier-hub-single-assets.mjs';
import {prepareNativeAssetMultipart,nativeAssetMultipartCanonical,nativeAssetUploadPlanSha256} from '../extensions/supplier-hub/native-asset-multipart.mjs';

const read=async(response,status=200)=>{assert.equal(response.status,status,await response.clone().text());return response.json();};
const jsonSha=value=>sha(nativeAssetMultipartCanonical(value));
async function fixture(company=companies[0]){
 const f=await assetApiFixture(company),context={params:Promise.resolve({id:f.id})};
 // The legacy fixture appends a byte to distinguish tiny image bodies. Native
 // multipart requires a complete PNG ending at IEND, so use valid fixture-only
 // originals and their actual metadata. No production file is read or changed.
 for(const [index,key]of f.keys.entries()){
  const bytes=imageBytes(index).slice(0,-1);
  await f.h.bindings.FILES.put(key,bytes,{httpMetadata:{contentType:'image/png'},customMetadata:{sha256:sha(bytes)}});
 }
 const legal=f.h.load('app/api/products/[id]/legal-documents/route.ts');
 const before=await read(await legal.GET(new Request('https://app.test'+f.base+'/legal-documents'),context));
 await read(await legal.PATCH(new Request('https://app.test'+f.base+'/legal-documents',{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify({expectedRevision:before.revision,applicability:'not-applicable'})}),context));
 const api=f.h.load('app/api/products/[id]/native-assets/route.ts');
 const source=()=>api.GET(new Request('https://app.test'+f.base+'/native-assets'+f.query),context);
 const raw=(plan,key)=>api.GET(new Request('https://app.test'+f.base+'/native-assets'+f.query+'&sourcePlanSha256='+plan.sourcePlanSha256+'&key='+encodeURIComponent(key)),context);
 return {...f,source,raw};
}
async function uploadFixture(f){
 const source=await read(await f.source());assert.equal(source.metadataValid,true,JSON.stringify(source.issues));
 // A separate synthetic newly-created-document checkpoint stands in for the
 // future verified browser create result. This is not a real Hub document ID.
 const target={docId:'759001',requestId:'synthetic-new-create-759',packetDigest:'7'.repeat(64),preparedBodySha256:source.preparedBodySha256,createOperationId:'synthetic-new-create-759:create',baselineDocIds:['758001']};
 const plan={format:'yoofam-native-asset-upload-plan-v1',identity:plain(source.identity),identityDigest:source.identityDigest,target:plain(target),images:plain(source.images),nativeLegalAttachmentPlan:plain(source.nativeLegalAttachmentPlan),planSha256:null,registered:false,remoteWrites:false,submissionReady:false,transportReady:false};
 plan.planSha256=await nativeAssetUploadPlanSha256(plan);
 let reads=0;
 const options={expectedIdentity:plain(source.identity),expectedTarget:plain(target),expectedPlanSha256:plan.planSha256,readImage:async file=>{reads++;const response=await f.raw(source,file.key);assert.equal(response.status,200,await response.clone().text());return response.arrayBuffer();}};
 return {source,plan,options,get reads(){return reads;}};
}
function bodyValue(document,wire){
 let node=document;for(const key of wire.path)node=node[key];
 return wire.name===undefined?node:node.find(row=>row[wire.nameKey]===wire.name)[wire.valueKey];
}
for(const company of companies)test(`${company.code}: actual private source API feeds multipart bytes and exact filename-native body while legacy reviewed data stays unchanged`,async()=>{
 const f=await fixture(company);try{
  const legacy=await read(await f.h.route(f.endpoint)),before=f.objectState(),state=f.state(),u=await uploadFixture(f);
  assert.equal(u.source.originalBodySha256,jsonSha(u.source.body));
  const normalized=plain(u.source.body);for(const document of normalized.jsonDocument)for(const key of ['msrpAgree','labelContactAgreed'])if(Object.hasOwn(document.imagePage,key))document.imagePage[key]=false;
  assert.equal(u.source.preparedBodySha256,jsonSha(normalized));
  const prepared=await prepareNativeAssetMultipart(u.plan,u.options);
  assert.equal(u.reads,u.source.images.length);assert.equal(prepared.bytesVerified,true);
  assert.deepEqual(prepared.requests.map(request=>request.imageType),['MAIN','ADDITIONAL','LABEL','DETAIL']);
  assert.equal(prepared.filenameBindings.length,u.source.images.flatMap(image=>image.references).reduce((set,ref)=>set.add(ref.documentIndex+'\0'+nativeAssetMultipartCanonical(ref.wire)),new Set()).size);
  for(const binding of prepared.filenameBindings)assert.equal(bodyValue(u.source.body.jsonDocument[binding.documentIndex],binding.wire),binding.value);
  for(const request of prepared.requests){
   assert.equal(request.path,`/sr/draft/api/upload-images/759001?imageType=${request.imageType}`);
   for(const [index,[field,file]]of [...request.body.entries()].entries()){
    const expected=request.files[index];assert.equal(field,'additionalImageFiles');assert.equal(file.name,expected.transportName);
    assert.equal(sha(new Uint8Array(await file.arrayBuffer())),expected.sha256);assert.equal(file.size,expected.byteLength);
   }
  }
  for(const flag of ['targetVerified','actualUploadVerified','transportReady','registered','remoteWrites','submissionReady'])assert.equal(prepared[flag],false);
  assert.deepEqual(plain(await read(await f.h.route(f.endpoint))),plain(legacy));assert.equal(f.objectState(),before);assert.equal(f.state(),state);
  assert.deepEqual(f.h.network,[]);assert.equal(f.h.sqlite.prepare('SELECT count(*) AS n FROM supplier_hub_receipts').get().n,0);
 }finally{f.close();}
});
test('a saved source edit between planning and multipart reads rejects all preparation without reusing stale filenames',async()=>{
 const f=await fixture();try{
  const u=await uploadFixture(f);f.h.sqlite.prepare('UPDATE products SET updated_at=? WHERE id=?').run('2026-10-20T23:59:59.999Z',f.id);
  await assert.rejects(prepareNativeAssetMultipart(u.plan,u.options));assert.equal(u.reads,1);
  assert.deepEqual(f.h.network,[]);assert.equal(f.h.sqlite.prepare('SELECT count(*) AS n FROM supplier_hub_receipts').get().n,0);
 }finally{f.close();}
});
test('private same-key binary replacement cannot satisfy the reviewed source plan even with refreshed storage metadata',async()=>{
 const f=await fixture();try{
  const u=await uploadFixture(f),file=u.source.images[0],bytes=new Uint8Array(f.h.objects.get(file.key));bytes[40]^=1;
  await f.h.bindings.FILES.put(file.key,bytes,{httpMetadata:{contentType:'image/png'},customMetadata:{sha256:sha(bytes)}});
  await assert.rejects(prepareNativeAssetMultipart(u.plan,u.options));assert.equal(u.reads,1);assert.deepEqual(f.h.network,[]);
 }finally{f.close();}
});
test('independent company and created-document checkpoints reject a sidecar substitution before any private API read',async()=>{
 const f=await fixture();try{
  const u=await uploadFixture(f);u.options.expectedIdentity.company=companies[1];
  await assert.rejects(prepareNativeAssetMultipart(u.plan,u.options));assert.equal(u.reads,0);
  u.options.expectedIdentity=plain(u.source.identity);u.options.expectedTarget.docId='758001';
  await assert.rejects(prepareNativeAssetMultipart(u.plan,u.options));assert.equal(u.reads,0);assert.deepEqual(f.h.network,[]);
 }finally{f.close();}
});
