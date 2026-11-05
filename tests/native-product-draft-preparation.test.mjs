import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {nativeReceiverReceiptFixture,companies,plain} from './helpers/native-product-receiver-receipt-flow.mjs';
import {singleDocumentFixture} from './helpers/supplier-hub-single-document.mjs';
import {createSupplierHubDocumentReceiver,SingleDocumentError,singleDocumentIdentity,SINGLE_DOCUMENT_FORMAT} from '../extensions/supplier-hub/single-document.mjs';
import {createProductDocumentDraftReceiver,productDocumentIdentity} from '../extensions/supplier-hub/product-document-receiver.mjs';
import {PRODUCT_DOCUMENT_LIVE_VERIFIED} from '../extensions/supplier-hub/product-document-dispatch.mjs';
import {SINGLE_DOCUMENT_LIVE_VERIFIED} from '../extensions/supplier-hub/single-dispatch.mjs';
import {PRODUCT_DOCUMENT_REQUEST_TTL} from '../extensions/supplier-hub/product-document.mjs';

const writes=f=>f.calls.filter(call=>call.name==='hub-fetch'&&call.init.method==='POST').map(call=>new URL(call.url).pathname);
const coreWrites=f=>f.calls.filter(call=>call.name==='hubRequest'&&call.input.method==='POST').map(call=>call.input.path);
const forbidden=['navigate','readAgreements','readStageAgreements','verifyHumanConfirmation','confirmAgreements','confirmStageAgreements','submit','observeReceipt'];
const nativePlanReads=reads=>reads.filter(row=>{const url=new URL(row.url);return url.pathname.endsWith('/native-assets')&&!url.searchParams.has('key')&&!url.searchParams.has('bundle');}).length;
function draftCore(f){return createSupplierHubDocumentReceiver({adapter:f.adapter,store:f.storage.store,now:()=>f.now},{format:SINGLE_DOCUMENT_FORMAT,identity:singleDocumentIdentity,draftOnly:true});}
function proof(result){assert.equal(result.draftOnly,true);assert.equal(result.registered,false);assert.equal(result.success,false);assert.equal(result.receipt,undefined);assert.equal(result.challenge,undefined);
 assert.equal(result.draftProof.evidence,'document-draft-preparation');assert.equal(result.draftProof.submitted,false);assert.equal(result.draftProof.consented,false);assert.ok(Number.isSafeInteger(result.draftProof.checkpointSequence));assert.ok(result.draftProof.observedAt>0);}

test('initial native preparation reuses only its nested source proof and retains fresh final write checks',async()=>{
 const f=await nativeReceiverReceiptFixture();try{
  let firstWrite;const adapter={...f.adapter,hubRequest:(input,lease)=>{if(!firstWrite&&input.method==='POST')firstWrite={input,lease};return f.adapter.hubRequest(input,lease);}};
  const start=f.state.appReads.length,result=await createProductDocumentDraftReceiver({adapter,store:f.storage.store}).prepareDraft(f.packet,f.sender);
  assert.equal(result.state,'validated',JSON.stringify(result));assert.equal(result.draftProof.checkpointSequence,15);
  assert.equal(nativePlanReads(f.state.appReads.slice(start)),97,'a guard-owned proof avoids two redundant plan reads in each of eight nested Hub requests');
  assert.ok(firstWrite.lease?.sourceProof);const reads=f.state.appReads.length;
  for(const lease of [firstWrite.lease,{sourceProof:{}},{}])await assert.rejects(f.adapter.hubRequest(firstWrite.input,lease),{code:'SOURCE_CHANGED'});
  assert.equal(f.state.appReads.length,reads,'used or fabricated proofs cannot trigger another source read or Hub write');
  assert.equal(writes(f).length,6);assert.equal(f.state.uploads.length,4);assert.equal(f.submitted,0);
 }finally{f.close();}
});

for(const mode of ['saved-source','body','file','account','company','tab','outdated-proof'])test(`nested source proof cannot authorize a write after ${mode} changes`,async()=>{
 const f=await nativeReceiverReceiptFixture();try{
  let changed=false;
  const adapter={...f.adapter,hubRequest:async(input,lease)=>{
   if(!changed&&input.method==='POST'&&input.path.endsWith('/create')){
    changed=true;
    if(mode==='saved-source')f.source.h.sqlite.prepare('UPDATE products SET updated_at=? WHERE id=?').run('2099-01-01T00:00:00.000Z',f.source.id);
    if(mode==='body')f.source.h.sqlite.prepare('UPDATE product_quotation_fields SET payload=replace(payload,?,?) WHERE product_id=?').run('합성 전체 첫째','변경된 상품명',f.source.id);
    if(mode==='file'){const bytes=f.source.h.objects.get(f.plan.images[0].key).slice();bytes[bytes.length-1]^=1;f.source.h.objects.set(f.plan.images[0].key,bytes);}
    if(mode==='account')f.source.h.auth.getChatGPTUser=async()=>null;
    if(mode==='company')f.source.h.setCompany(companies.find(company=>company.code!==f.context.identity.company.code));
    if(mode==='tab'){const get=f.browser.api.tabs.get;f.browser.api.tabs.get=async id=>id===f.sender.tab.id?{...await get(id),url:'https://untrusted.example/'}:get(id);}
    if(mode==='outdated-proof')await f.adapter.readSource({identity:f.context.identity,bodySha256:f.context.originalBodySha256,preparedBodySha256:f.context.bodySha256,packetDigest:f.context.packetDigest,requestId:f.packet.requestId,docId:null});
   }
   return f.adapter.hubRequest(input,lease);
  }};
  const result=await createProductDocumentDraftReceiver({adapter,store:f.storage.store}).prepareDraft(f.packet,f.sender);
  assert.equal(changed,true);assert.notEqual(result.state,'validated');assert.equal(writes(f).length,0);assert.equal(f.state.uploads.length,0);assert.equal(f.submitted,0);
 }finally{f.close();}
});

for(const company of companies)test(`${company.code}: actual native preparation creates only one new draft, uploads current originals, validates all steps and stops before navigation or terms`,async t=>{
 t.mock.timers.enable({apis:['Date'],now:Date.now()});let f;
 try{
  f=await nativeReceiverReceiptFixture(company);const receiver=createProductDocumentDraftReceiver({adapter:f.adapter,store:f.storage.store}),source=f.source.state(),objects=f.source.objectState(),prior=JSON.stringify(f.documents.get(f.prior.docId));
  assert.equal(typeof receiver.start,'undefined');assert.equal(typeof receiver.confirm,'undefined');assert.equal(typeof receiver.resume,'undefined');
  const result=await receiver.prepareDraft(f.packet,f.sender);proof(result);assert.equal(result.state,'validated',JSON.stringify(result));assert.deepEqual(result.draftProof.validatedSteps,[2,3,4,5]);assert.equal(result.needsRecovery,false);
  assert.deepEqual(writes(f),['/sr/draft/api/create','/sr/draft/api/update','/sr/qvt/api/validate-step/2','/sr/qvt/api/validate-step/3','/sr/qvt/api/validate-step/4','/sr/qvt/api/validate-step/5']);
  assert.deepEqual(f.state.uploads.map(row=>row.group),['MAIN','ADDITIONAL','LABEL','DETAIL']);assert.equal(f.nextClicks,0);assert.equal(f.checkboxClicks,0);assert.equal(f.submitted,0);assert.equal(f.state.humanConfirmations.length,0);
  assert.equal(f.hubLocation.pathname,'/dashboard/KR');assert.deepEqual(f.documents.get(f.createdDocId).jsonDocument,plain(f.context.packet.body.jsonDocument));
  const beforeWrites=writes(f),uploads=JSON.stringify(f.state.uploads),checkpoint=JSON.stringify(f.storage.get(f.context.key));
  const duplicate=await receiver.prepareDraft(f.packet,f.sender);proof(duplicate);assert.equal(duplicate.duplicate,true);assert.equal(duplicate.docId,result.docId);assert.equal(JSON.stringify(f.storage.get(f.context.key)),checkpoint);
  const recovered=await createProductDocumentDraftReceiver({adapter:f.adapter,store:f.storage.store}).recoverDraft(f.packet,f.sender);proof(recovered);assert.equal(recovered.recovered,true);assert.equal(recovered.state,'validated');
  assert.deepEqual(writes(f),beforeWrites);assert.equal(JSON.stringify(f.state.uploads),uploads);assert.equal(f.submitted,0);
  t.mock.timers.tick(f.packet.createdAt+PRODUCT_DOCUMENT_REQUEST_TTL+1-Date.now());await assert.rejects(receiver.prepareDraft(f.packet,f.sender),{code:'EXPIRED'});
  assert.equal((await receiver.recoverDraft(f.packet,f.sender)).state,'validated');assert.deepEqual(writes(f),beforeWrites);
  assert.equal(f.source.state(),source);assert.equal(f.source.objectState(),objects);assert.equal(JSON.stringify(f.documents.get(f.prior.docId)),prior);assert.deepEqual(f.source.h.network,[]);
  assert.equal(PRODUCT_DOCUMENT_LIVE_VERIFIED,false);assert.equal(SINGLE_DOCUMENT_LIVE_VERIFIED,false);
 }finally{f?.close();t.mock.timers.reset();}
});

test('preparation rejects a full-submission checkpoint and full submission rejects a preparation checkpoint without new remote effects',async()=>{
 for(const initial of ['full','draft']){
  const f=await singleDocumentFixture();try{
   const receiver=draftCore(f);await(initial==='full'?f.receiver.start(f.packet,f.sender):receiver.prepareDraft(f.packet,f.sender));const before=coreWrites(f),checkpoint=JSON.stringify(f.storage.get(f.context.key));
   if(initial==='full')await assert.rejects(receiver.recoverDraft(f.packet,f.sender),{code:'CHECKPOINT_MODE'});
   else await assert.rejects(f.receiver.resume(f.packet,f.sender),{code:'CHECKPOINT_MODE'});
   assert.deepEqual(coreWrites(f),before);assert.equal(JSON.stringify(f.storage.get(f.context.key)),checkpoint);
  }finally{f.close();}
 }
});

test('lost create/update/validation ACKs never replay writes; explicit read-only recovery precedes only remaining unrequested preparation steps',async()=>{
 for(const fault of [{createLost:true},{updateLost:true},{validationLost:3}]){
  const f=await singleDocumentFixture(companies[0],fault);try{
   const receiver=draftCore(f),first=await receiver.prepareDraft(f.packet,f.sender);proof(first);assert.equal(first.needsRecovery,true);
   const writesBefore=coreWrites(f);const duplicate=await receiver.prepareDraft(f.packet,f.sender);proof(duplicate);assert.equal(duplicate.needsRecovery,true);assert.deepEqual(coreWrites(f),writesBefore);
   const recovered=await receiver.recoverDraft(f.packet,f.sender);proof(recovered);assert.equal(recovered.recovered,true);assert.deepEqual(coreWrites(f),writesBefore,'recovery is remote read-only');
   const completed=await receiver.prepareDraft(f.packet,f.sender);proof(completed);assert.equal(completed.state,'validated',JSON.stringify(completed));assert.deepEqual(completed.draftProof.validatedSteps,[2,3,4,5]);
   assert.equal(f.createCount,1);assert.equal(f.updateCount,1);assert.equal(coreWrites(f).filter(path=>path.endsWith('/3')).length,1);assert.equal(f.calls.some(call=>forbidden.includes(call.name)),false);f.assertPreserved();
  }finally{f.close();}
 }
});

test('an unobserved create remains unresolved and a validation rejection never reaches navigation or agreements',async()=>{
 for(const options of [{createNoCommit:true},{validationResponse:()=>({code:200,data:[{success:false,errors:[{columnName:'물류','message':'포장 무게 확인'}]}]})}]){
  const f=await singleDocumentFixture(companies[1],options);try{
   const receiver=draftCore(f),first=await receiver.prepareDraft(f.packet,f.sender);proof(first);const before=coreWrites(f);
   const recovered=await receiver.recoverDraft(f.packet,f.sender);proof(recovered);assert.deepEqual(coreWrites(f),before);
   if(options.createNoCommit){assert.equal(recovered.state,'create-requested');assert.equal(recovered.needsRecovery,true);assert.equal(recovered.error.code,'READBACK_UNCONFIRMED');}
   else {assert.equal(recovered.state,'validation-rejected');assert.equal(recovered.draftProof.submitted,false);assert.equal(recovered.draftProof.validatedSteps.length,0);assert.equal(f.storage.get(f.context.key).validationErrors[0].message,'포장 무게 확인');}
   await receiver.prepareDraft(f.packet,f.sender);assert.deepEqual(coreWrites(f),before);assert.equal(f.calls.some(call=>forbidden.includes(call.name)),false);assert.equal(f.submitted,0);
  }finally{f.close();}
 }
});

test('source, session and original request changes block preparation or recovery without widening a pending lane',async()=>{
 for(const mode of ['source','session','request']){
  const f=await singleDocumentFixture(companies[0],{createLost:true});try{
   const receiver=draftCore(f);await receiver.prepareDraft(f.packet,f.sender);const before=coreWrites(f),checkpoint=JSON.stringify(f.storage.get(f.context.key));
   if(mode==='source')f.current=false;if(mode==='session')f.sessionId='different-session';const packet=mode==='request'?{...f.packet,requestId:'different-request'}:f.packet;
   if(mode==='request')await assert.rejects(receiver.recoverDraft(packet,f.sender),{code:'CHECKPOINT_MODE'});else{const result=await receiver.recoverDraft(packet,f.sender);assert.equal(result.state,'scope-blocked');assert.equal(result.error.code,'SOURCE_CHANGED');}
   assert.deepEqual(coreWrites(f),before);assert.equal(JSON.stringify(f.storage.get(f.context.key)),checkpoint);
  }finally{f.close();}
 }
});

test('public preparation dispatcher requires the independently selected native adapter, and cannot open a full receiver or flip the live gate',async()=>{
 const f=await nativeReceiverReceiptFixture();try{
  const source=fs.readFileSync(new URL('../extensions/supplier-hub/product-document-dispatch.mjs',import.meta.url),'utf8').replace(/^import .*;\r?\n/gm,'').replace(/export /g,'');
  for(const native of [false,true]){
   let disposed=0,constructed=0,called=0;const sandbox={productDocumentIdentity,SingleDocumentError,resolveProductSourceContext:async context=>context,
    createVerifiedProductDocumentBrowserAdapter:async()=>({nativeAssets:native,sourcePlanSha256:f.context.identity.fingerprint,adapter:{dispose(){disposed++;}}}),
    createProductDocumentReceiver:()=>assert.fail('Full receiver must remain gated'),createProductDocumentStore:()=>({}),
    createProductDocumentDraftReceiver:()=>{constructed++;return{prepareDraft:async()=>{called++;return{draftOnly:true,state:'validated',registered:false};}};}};
   const dispatch=vm.runInNewContext(source+'\ndispatchProductDocument',sandbox),message={type:'YOOFAM_PRODUCT_DOCUMENT_REQUEST',action:'prepareDraft',packet:f.packet};
   if(native){assert.equal((await dispatch(message,f.sender)).draftOnly,true);assert.equal(constructed,1);assert.equal(called,1);await dispatch(message,f.sender);assert.equal(constructed,1);assert.equal(disposed,1);}
   else {await assert.rejects(dispatch(message,f.sender),{code:'PRODUCT_DRAFT_NATIVE_SOURCE_REQUIRED'});assert.equal(constructed,0);assert.equal(called,0);assert.equal(disposed,1);}
   for(const action of ['start','resume','confirm'])await assert.rejects(dispatch({...message,action,...(action==='confirm'?{confirmation:{}}:{})},f.sender),{code:'PRODUCT_LIVE_CONTRACT_UNVERIFIED'});
  }
 }finally{f.close();}
});
