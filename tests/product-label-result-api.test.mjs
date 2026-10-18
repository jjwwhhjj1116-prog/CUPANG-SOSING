import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {sizeChartApiFixture,companies,json,plain,allTables} from './helpers/supplier-hub-single-size-chart.mjs';
import {SINGLE_DOCUMENT_LIVE_VERIFIED} from '../extensions/supplier-hub/single-dispatch.mjs';

const sha=value=>createHash('sha256').update(value).digest('hex'),proofs=[];
const files=['app/product-label-result.ts','app/product-label.ts','app/product-label-references.ts','app/product-label-proof.ts','app/product-label-attachment.ts','app/api/files/route.ts','tests/product-label-result-api.test.mjs'];
const hashes=()=>Object.fromEntries(files.map(file=>[file,sha(fs.readFileSync(new URL('../'+file,import.meta.url)))]));let frozen;
const png=Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2RkcAAAAASUVORK5CYII=','base64'));

for(const company of companies)test(`current saved label result is authenticated and stable across real rewrite/attachment routes (${company.code})`,async()=>{
 frozen??=hashes();const f=await sizeChartApiFixture(company),{h}=f,endpoint=f.base+'/product-labels'+f.query,quotationEndpoint=f.base+'/quotation-fields'+f.query,calls=[];
 const request=async(url,init={})=>{const method=init.method??'GET',response=url==='/api/files'?await h.load('app/api/files/route.ts').POST(new Request('https://app.test/api/files',{method,body:init.body})):await f.route(url,{method,...(init.body===undefined?{}:{body:init.body})});calls.push({url,method,status:response.status});return response;};
 const read=()=>request(endpoint).then(json),quote=()=>request(quotationEndpoint).then(json),scope={productId:f.id,optionId:'synthetic-one',endpoint,quotationEndpoint};
 const result=h.load('app/product-label-result.ts'),attachment=h.load('app/product-label-attachment.ts'),receipt=h.load('app/product-label-proof.ts'),upload=h.load('app/product-label-upload.ts');
 const imageTarget=h.load('app/quotation-seo-targets.ts').exactPrimaryQuotationTarget(f.view.resolved.schema.fields,'labelImages');
 const select=async(keys,optionId=scope.optionId)=>f.edit(imageTarget.linked.map(fieldKey=>({optionId,fieldKey,value:keys===null?null:keys.join('\n')})));
 const state=()=>({database:allTables(f),objects:f.objectState()});
 const resolve=async(input=scope,transport=request)=>{const before=state(),start=calls.length,out=await result.readCurrentProductLabelResult(input,transport);assert.deepEqual(state(),before,'result classification never mutates business state or files');assert.ok(calls.slice(start).every(call=>call.method==='GET'));return out;};
 const attach=async(optionId=scope.optionId)=>{const view=await read();return attachment.attachProductLabel({productId:f.id,endpoint,quotationEndpoint,optionId,renderedView:view,blob:new Blob([png],{type:'image/png'}),uploadedKey:null,onUploaded(){}},request);};
 try{
  const view=await read();await json(await request(endpoint,{method:'PUT',body:{expectedRevision:view.revision,expectedInputFingerprint:view.inputFingerprint,changes:[{optionId:null,fieldKey:'productName',value:'동일 계획의 검수 제품'},{optionId:null,fieldKey:'material',value:'검토 재질'},{optionId:null,fieldKey:'netContents',value:''}]}}));
  await select([],null);await select([]);await select([],'synthetic-two');
  const first=await attach(),firstView=await read(),firstContext={productId:f.id,endpoint,optionId:scope.optionId,view:firstView},oldId=await upload.productLabelUploadId(firstContext);
  assert.equal((await receipt.readProductLabelReceipt(oldId,request)).key,first.key);
  let current=await resolve();assert.equal(current.reason,null);assert.equal(current.result.key,first.key);assert.equal(current.result.plan,'filtered');assert.equal(current.result.proof.optionId,scope.optionId);assert.equal(current.result.proof.renderEpoch,undefined);
  const afterFirst=state(),beforeEpoch=await read(),rewritten=await json(await request(endpoint,{method:'POST',body:{expectedRevision:beforeEpoch.revision,expectedInputFingerprint:beforeEpoch.inputFingerprint}}));
  assert.equal(rewritten.renderEpoch,1);assert.deepEqual(plain(rewritten.rows),plain(beforeEpoch.rows));assert.equal(state().objects,afterFirst.objects);const old=await resolve();assert.equal(old.result,null);assert.equal(old.reason,'stale');
  const next=await attach();assert.notEqual(next.key,first.key);current=await resolve();assert.equal(current.result.key,next.key);assert.equal(current.result.proof.renderEpoch,1);assert.equal(current.reason,null);assert.ok(h.objects.has(first.key),'old generated file remains stored');

  const manual='owner/label.png';await select([manual]);let out=await resolve();assert.equal(out.reason,'manual');assert.equal(out.result,null);
  await select([next.key,manual]);out=await resolve();assert.equal(out.reason,'ambiguous');assert.equal(out.result,null);
  await select([]);out=await resolve();assert.equal(out.reason,'missing');assert.equal(out.result,null);
  await select([next.key]);
  const head=h.bindings.FILES.head,newId=next.key.match(/quotation-label-([a-f0-9]{64})\.png$/)[1];
  const poolRow=h.sqlite.prepare('SELECT image_keys FROM products WHERE id=?').get(f.id);h.sqlite.prepare('UPDATE products SET image_keys=? WHERE id=?').run(JSON.stringify(JSON.parse(poolRow.image_keys).filter(key=>key!==next.key)),f.id);
  assert.equal((await receipt.readProductLabelReceipt(newId,request)).key,next.key,'durable receipt exists independently of current product pool membership');out=await resolve();assert.equal(out.reason,'unconfirmed');assert.equal(out.result,null);h.sqlite.prepare('UPDATE products SET image_keys=? WHERE id=?').run(poolRow.image_keys,f.id);
  // An object under a different owner's prefix never substitutes for the
  // authenticated requested key, even when the upload id and metadata match.
  const ownMetadata=await head(next.key),foreignKey='foreign-owner/quotation-label-'+newId+'.png';
  await h.bindings.FILES.put(foreignKey,png,{httpMetadata:ownMetadata.httpMetadata,customMetadata:ownMetadata.customMetadata});
  h.bindings.FILES.head=async key=>key===next.key?null:head(key);out=await resolve();assert.equal(out.reason,'unconfirmed');assert.equal(out.result,null);assert.ok(h.objects.has(foreignKey));h.bindings.FILES.head=head;
  h.bindings.FILES.head=async key=>{if(key===next.key)throw Error('isolated R2 outage');return head(key);};
  let unchanged=state();await assert.rejects(result.readCurrentProductLabelResult(scope,request),/확인|읽|저장|연결/);assert.deepEqual(state(),unchanged);assert.equal(calls.at(-1).status,503);h.bindings.FILES.head=head;
  h.bindings.FILES.head=async key=>{const object=await head(key);return key===next.key?{...object,customMetadata:{...object.customMetadata,productLabelRenderEpoch:'0'}}:object;};
  unchanged=state();await assert.rejects(result.readCurrentProductLabelResult(scope,request));assert.deepEqual(state(),unchanged);assert.equal(calls.at(-1).status,503);h.bindings.FILES.head=head;

  // The real persisted common reference is inherited only after removing all
  // explicit option-linked overrides. Equal pixels alone never prove it.
  const common=await attach(null);await select(null);out=await resolve();assert.equal(out.reason,null);assert.equal(out.result.key,common.key);assert.equal(out.result.proof.optionId,null);
  await select([common.key]);out=await resolve();assert.equal(out.reason,'stale');assert.equal(out.result,null,'explicitly selecting a common recipe is not automatic common inheritance');
  await select([next.key]);

  const foreign={...h.sqlite.prepare('SELECT * FROM products WHERE id=?').get(f.id),id:'result-foreign-product',owner_id:'foreign-owner'},columns=Object.keys(foreign);h.sqlite.prepare(`INSERT INTO products(${columns.join(',')}) VALUES(${columns.map(()=>'?').join(',')})`).run(...columns.map(key=>foreign[key]));
  unchanged=state();await assert.rejects(result.readCurrentProductLabelResult({...scope,productId:foreign.id,endpoint:endpoint.replace(f.id,foreign.id),quotationEndpoint:quotationEndpoint.replace(f.id,foreign.id)},request));assert.deepEqual(state(),unchanged);
  h.setCompany(companies.find(other=>other.code!==company.code));unchanged=state();await assert.rejects(result.readCurrentProductLabelResult(scope,request));assert.deepEqual(state(),unchanged);h.setCompany(company);

  // Race the final proof acknowledgement with a real source clock change.
  // The helper's second exact references read must reject the late result.
  let changed=false,concurrentState;const race=async(url,init)=>{const response=await request(url,init);if(!changed&&url.startsWith('/api/files?labelUploadId=')){changed=true;const value=await h.load('db/queries.ts').findProduct('owner',f.id);h.sqlite.prepare('UPDATE products SET updated_at=? WHERE id=?').run(new Date(Date.parse(value.updated_at)+1).toISOString(),f.id);concurrentState=state();}return response;};
  await assert.rejects(result.readCurrentProductLabelResult(scope,race),/변경|다시|상태|원천/);assert.equal(changed,true);assert.deepEqual(state(),concurrentState,'only the explicit concurrent fixture clock update remains');
  current=await resolve();assert.equal(current.reason,null);assert.equal(current.result.key,next.key,'unrelated source clock advances do not invalidate an identical same-generation saved plan');
  const packageView=await json(await f.route(f.endpoint));assert.equal(packageView.submissionReady,false);assert.equal(packageView.registered,false);assert.equal(packageView.remoteWrites,false);assert.equal((await quote()).submissionReady,false);assert.equal(SINGLE_DOCUMENT_LIVE_VERIFIED,false);
  assert.deepEqual(h.network,[]);assert.equal(h.aiSources.length,0);assert.equal(h.sqlite.prepare('SELECT count(*) n FROM supplier_hub_receipts').get().n,0);assert.equal(h.sqlite.prepare('SELECT count(*) n FROM supplier_hub_single_receipts').get().n,0);
  proofs.push({company,calls,firstKey:first.key,currentKey:next.key,commonKey:common.key,legacyThenRewriteEpoch:1,actualGeneratedPngProof:true,readOnlyClassification:true,manualAndAmbiguousAndMissingSeparate:true,missingReceiptUnconfirmed:true,foreignNamespaceCannotSubstitute:true,storageAndMalformedProof503Throw:true,trueCommonInheritanceOnly:true,wrongCompanyAndProductRejected:true,sourceRaceRejected:true,unrelatedClockWithSamePlanRetained:true,liveVerified:SINGLE_DOCUMENT_LIVE_VERIFIED,submissionReady:false,registered:false,remoteWrites:false,externalRequests:0,providerCalls:0});
 }finally{f.close();}
});

test.after(()=>{assert.deepEqual(hashes(),frozen,'result/API sources stay frozen during focused checks');fs.writeFileSync(process.env.STEP712_RESULT_API_PROOF_PATH??'outputs/step712-label-result-api-proof.json',JSON.stringify({format:'step712-label-result-api-v1',sourceHashes:frozen,cases:proofs,browserActions:0,externalRequests:0,providerCalls:0,liveProductWrites:0,supplierHubWrites:0,boundary:'Actual result helper, labels/quotation/files/upload/attachment route handlers and isolated SQLite/R2. Synthetic products/category/PNG/auth; no browser pixel fidelity or real external acceptance claim.'},null,2)+'\n');});
