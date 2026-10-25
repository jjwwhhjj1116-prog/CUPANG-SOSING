import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {nativeReceiverReceiptFixture,companies} from './helpers/native-product-receiver-receipt-flow.mjs';
import {singleDocumentFixture,clone} from './helpers/supplier-hub-single-document.mjs';
import {createSupplierHubDocumentReceiver,singleDocumentIdentity,SingleDocumentError,readPreparedDocumentPreviewCheckpoint,SINGLE_DOCUMENT_FORMAT} from '../extensions/supplier-hub/single-document.mjs';
import {createProductDocumentDraftReceiver,productDocumentIdentity} from '../extensions/supplier-hub/product-document-receiver.mjs';
import {PRODUCT_DOCUMENT_LIVE_VERIFIED} from '../extensions/supplier-hub/product-document-dispatch.mjs';
import {SINGLE_DOCUMENT_LIVE_VERIFIED} from '../extensions/supplier-hub/single-dispatch.mjs';
import {PRODUCT_DOCUMENT_REQUEST_TTL} from '../extensions/supplier-hub/product-document.mjs';

const writes=f=>f.calls.filter(call=>call.name==='hub-fetch'&&call.init.method==='POST').map(call=>new URL(call.url).pathname);
function lifecycleProof(value){assert.equal(value.draftOnly,true);assert.equal(value.preparedLifecycle,true);assert.equal(value.draftProof,undefined);assert.equal(value.registered,false);assert.equal(value.success,false);
 const proof=value.lifecycleProof;assert.equal(proof.evidence,'native-prepared-draft-lifecycle');assert.deepEqual(proof.validatedSteps,[2,3,4,5]);assert.ok(proof.preparedCheckpointSequence>=1);assert.equal(proof.qualifiedCheckpointSequence,proof.preparedCheckpointSequence+1);assert.ok(proof.checkpointSequence>=proof.qualifiedCheckpointSequence);assert.ok(proof.qualifiedAt<=proof.observedAt);}

for(const company of companies)test(`${company.code}: exact prepared native draft advances through observed terms and only explicit synthetic human confirmations to one document receipt`,async t=>{
 t.mock.timers.enable({apis:['Date'],now:Date.now()});let f;
 try{f=await nativeReceiverReceiptFixture(company,{browser:{stageFlow:true,finalNoItems:true,...(company===companies[0]?{stageLostExecuteAck:'productPage'}:{})}});const receiver=createProductDocumentDraftReceiver({adapter:f.adapter,store:f.storage.store}),source=f.source.state(),objects=f.source.objectState(),protectedBefore=JSON.stringify(f.documents.get(f.prior.docId));
  const prepared=await receiver.prepareDraft(f.packet,f.sender);assert.equal(prepared.state,'validated',JSON.stringify(prepared));const originalWrites=writes(f),uploads=JSON.stringify(f.state.uploads),fileReads=f.state.uploadReads.length;
  const [fileName,descriptor]=f.state.registry.entries().next().value;f.state.registry.delete(fileName);const missing=await receiver.reviewPreparedDraft(f.packet,f.sender);assert.equal(missing.state,'validated');assert.ok(missing.error);assert.equal(missing.preparedLifecycle,undefined);assert.equal(f.nextClicks,0);f.state.registry.set(fileName,descriptor);
  let result=await receiver.reviewPreparedDraft(f.packet,f.sender);lifecycleProof(result);assert.equal(result.state,'awaiting-stage-consent',JSON.stringify(result));assert.equal(result.challenge.stage,'productPage');assert.equal(result.lifecycleProof.preparedCheckpointSequence,prepared.draftProof.checkpointSequence);assert.equal(result.lifecycleProof.consentRequested,false);assert.equal(result.lifecycleProof.submitRequested,false);
  assert.ok(f.state.uploadReads.length>fileReads,'qualification re-reads existing file metadata');assert.equal(JSON.stringify(f.state.uploads),uploads);assert.deepEqual(writes(f),originalWrites);assert.equal(f.submitted,0);assert.equal(f.state.humanConfirmations.length,0);assert.equal(f.stageApprovalClicks.productPage,0);
  const beforeDuplicate=f.nextClicks;const duplicate=await receiver.reviewPreparedDraft(f.packet,f.sender);assert.equal(duplicate.duplicate,true);assert.equal(f.nextClicks,beforeDuplicate);
  const recovered=await receiver.recoverPreparedDraft(f.packet,f.sender);assert.equal(recovered.recovered,true);assert.equal(recovered.challenge.stage,'productPage');assert.equal(f.nextClicks,beforeDuplicate);assert.equal(f.stageApprovalClicks.productPage,0);
  f.state.registry.set(fileName,{...descriptor,s3Link:'changed-after-qualification'});const changedFile=await receiver.confirmPreparedDraft(f.packet,f.sender,f.action(recovered));assert.ok(changedFile.error);assert.equal(changedFile.state,'awaiting-stage-consent');assert.equal(f.stageApprovalClicks.productPage,0);assert.equal(f.state.humanConfirmations.length,0);f.state.registry.set(fileName,descriptor);
  result=await receiver.confirmPreparedDraft(f.packet,f.sender,f.action(recovered));lifecycleProof(result);
  if(company===companies[0]){assert.equal(result.state,'stage-consent-requested');const before=f.nextClicks;result=await receiver.recoverPreparedDraft(f.packet,f.sender);assert.equal(result.state,'navigation-ready',JSON.stringify(result));assert.equal(result.recovered,true);assert.equal(f.nextClicks,before);assert.equal(f.stageApprovalClicks.productPage,1);result=await receiver.reviewPreparedDraft(f.packet,f.sender);}
  assert.equal(result.state,'awaiting-stage-consent',JSON.stringify(result));assert.equal(result.challenge.stage,'imagePage');assert.equal(result.lifecycleProof.consentRequested,true);assert.equal(result.lifecycleProof.submitRequested,false);assert.equal(f.submitted,0);
  result=await receiver.confirmPreparedDraft(f.packet,f.sender,f.action(result));assert.equal(result.state,'awaiting-consent',JSON.stringify(result));assert.equal(result.challenge.stage,'logisticsPage');assert.equal(f.submitted,0);assert.equal(f.stageApprovalClicks.productPage,1);assert.equal(f.stageApprovalClicks.imagePage,1);
  result=await receiver.confirmPreparedDraft(f.packet,f.sender,f.action(result));lifecycleProof(result);assert.equal(result.state,'pending',JSON.stringify(result));assert.equal(result.lifecycleProof.submitRequested,true);assert.equal(result.receipt.evidence,'document-receipt');assert.equal(result.receipt.qvtRequestId,'000769-QVT-raw');assert.equal(result.receipt.registered,false);assert.equal(f.submitted,1);assert.equal(f.state.humanConfirmations.length,3);
  const afterSubmit=f.nextClicks;await receiver.confirmPreparedDraft(f.packet,f.sender,f.action({...result,challenge:f.storage.get(f.context.key).challenge}));assert.equal(f.submitted,1);assert.equal(f.nextClicks,afterSubmit);
  const observed=await receiver.observePreparedDraft(f.packet,f.sender);assert.equal(observed.state,'pending');assert.equal(observed.receipt.qvtRequestId,result.receipt.qvtRequestId);assert.equal(f.submitted,1);
  assert.equal((await receiver.prepareDraft(f.packet,f.sender)).error.code,'CHECKPOINT_MODE');assert.equal((await receiver.recoverDraft(f.packet,f.sender)).error.code,'CHECKPOINT_MODE');await assert.rejects(f.receiver.resume(f.packet,f.sender),{code:'CHECKPOINT_MODE'});
  assert.equal(JSON.stringify(f.state.uploads),uploads);assert.deepEqual(writes(f),originalWrites);assert.equal(f.source.state(),source);assert.equal(f.source.objectState(),objects);assert.equal(JSON.stringify(f.documents.get(f.prior.docId)),protectedBefore);assert.equal(PRODUCT_DOCUMENT_LIVE_VERIFIED,false);assert.equal(SINGLE_DOCUMENT_LIVE_VERIFIED,false);
 }finally{f?.close();t.mock.timers.reset();}
});

async function core(company=companies[0],options={}){const f=await singleDocumentFixture(company,{stageFlow:true,finalNoItems:true,receipt:{state:'pending',evidence:'document-receipt',sourceStatus:'SUBMITTED',registered:false,qvtRequestId:'qualified-native-request',receiptId:'qualified-native-request',skuId:undefined},...options});f.qualifications=0;f.qualificationCurrent=true;
 f.adapter.qualifyPreparedDraft=async input=>{f.calls.push({name:'qualifyPreparedDraft',input:clone(input)});f.qualifications++;return {readOnly:true,docId:input.docId,company:clone(f.context.identity.company),identityDigest:f.context.identityDigest,packetDigest:f.context.packetDigest,sourcePlanSha256:f.context.identity.fingerprint,metadataObserved:f.qualificationCurrent,checkedAt:f.now};};
 f.adapter.readNavigation=async input=>{f.calls.push({name:'readNavigation',input:clone(input)});const stage=['productPage','imagePage','logisticsPage'][f.stageIndex],base={docId:input.docId,company:clone(f.context.identity.company),productName:f.packet.body.productName,stage};
  return stage==='logisticsPage'?{...base,readyForSubmit:true}:f.stageItems[stage].every(item=>item.checked)?{...base,readyForSubmit:false,readyForConsent:false,readyForContinue:true}:{...base,readyForSubmit:false,readyForConsent:true};};
 f.draft=createSupplierHubDocumentReceiver({adapter:f.adapter,store:f.storage.store,now:()=>f.now},{format:SINGLE_DOCUMENT_FORMAT,identity:singleDocumentIdentity,draftOnly:true,nativeLifecycle:true});return f;}
const writeCount=f=>f.calls.filter(call=>call.name==='hubRequest'&&call.input.method==='POST').length;

test('current source, exact body, native file metadata, original UUID and confirmed full preparation are required before qualification',async()=>{
 for(const mode of ['source','body','files','request','incomplete','rejected']){const f=await core(companies[0],mode==='incomplete'?{createLost:true}:mode==='rejected'?{validationResponse:()=>({code:200,data:[{success:false,errors:[]}]})}:{});try{
  await f.draft.prepareDraft(f.packet,f.sender);const before=writeCount(f),navigation=f.calls.filter(call=>call.name==='navigate').length;if(mode==='source')f.current=false;if(mode==='body')f.documents.get('created-'+companies[0].code).productName='changed';if(mode==='files')f.qualificationCurrent=false;
  const packet=mode==='request'?{...f.packet,requestId:'other-request'}:f.packet;
  if(mode==='request')await assert.rejects(f.draft.reviewPreparedDraft(packet,f.sender),{code:'CHECKPOINT_MODE'});else{const result=await f.draft.reviewPreparedDraft(packet,f.sender);assert.ok(result.error);assert.equal(result.preparedLifecycle,undefined);}
  assert.equal(f.calls.filter(call=>call.name==='navigate').length,navigation);assert.equal(writeCount(f),before);assert.equal(f.submitted,0);assert.equal(f.stageAcceptCounts.productPage,0);f.assertPreserved();
 }finally{f.close();}}
});

test('failed qualification can be recovered read-only as the same unpromoted draft without navigation or another remote write',async()=>{
 const f=await core();try{await f.draft.prepareDraft(f.packet,f.sender);f.qualificationCurrent=false;const failed=await f.draft.reviewPreparedDraft(f.packet,f.sender);assert.equal(failed.state,'validated');assert.equal(failed.preparedLifecycle,undefined);f.qualificationCurrent=true;
  const before=writeCount(f),recovered=await f.draft.recoverPreparedDraft(f.packet,f.sender);assert.equal(recovered.recovered,true);assert.equal(recovered.state,'validated');assert.equal(recovered.preparedLifecycle,undefined);assert.equal(recovered.draftProof.evidence,'document-draft-preparation');assert.equal(writeCount(f),before);assert.equal(f.calls.some(call=>call.name==='navigate'),false);
 }finally{f.close();}
});

test('prepared recovery also preserves older incomplete preparation requests without creating, uploading or promoting them',async()=>{
 for(const options of [{createLost:true},{updateLost:true},{validationLost:3}]){const f=await core(companies[0],options);try{
  const before=await f.draft.prepareDraft(f.packet,f.sender);assert.equal(before.needsRecovery,true);const count=writeCount(f),recovered=await f.draft.recoverPreparedDraft(f.packet,f.sender);assert.equal(recovered.recovered,true);assert.equal(recovered.preparedLifecycle,undefined);assert.equal(recovered.needsRecovery,false);assert.equal(writeCount(f),count);assert.equal(f.calls.some(call=>call.name==='navigate'||call.name==='qualifyPreparedDraft'),false);assert.equal(f.submitted,0);
 }finally{f.close();}}
});

test('lost stage-consent and submit ACKs recover exact observations without repeat agreement, next, upload or submit writes',async()=>{
 for(const fault of [{stageConsentLost:'productPage'},{submitLost:true}]){const f=await core(companies[1],fault);try{await f.draft.prepareDraft(f.packet,f.sender);let result=await f.draft.reviewPreparedDraft(f.packet,f.sender);
  if(fault.stageConsentLost){result=await f.draft.confirmPreparedDraft(f.packet,f.sender,f.action(result));assert.equal(result.state,'stage-consent-requested');assert.equal(result.needsRecovery,true);const before=f.calls.filter(call=>call.name==='navigate').length;const recovered=await f.draft.recoverPreparedDraft(f.packet,f.sender);assert.equal(recovered.recovered,true);assert.equal(recovered.state,'navigation-ready');assert.equal(recovered.needsRecovery,false);assert.equal(recovered.challenge,undefined);assert.equal(f.calls.filter(call=>call.name==='navigate').length,before);assert.equal(f.stageAcceptCounts.productPage,1);assert.equal(f.submitted,0);const continued=await f.draft.reviewPreparedDraft(f.packet,f.sender);assert.equal(continued.state,'awaiting-stage-consent');assert.equal(continued.challenge.stage,'imagePage');assert.equal(f.stageAcceptCounts.productPage,1);assert.equal(f.calls.filter(call=>call.name==='navigate').length,before+1);}
  else{result=await f.draft.confirmPreparedDraft(f.packet,f.sender,f.action(result));result=await f.draft.confirmPreparedDraft(f.packet,f.sender,f.action(result));result=await f.draft.confirmPreparedDraft(f.packet,f.sender,f.action(result));assert.equal(result.state,'submit-requested');assert.equal(f.submitted,1);const before=writeCount(f);const observed=await f.draft.recoverPreparedDraft(f.packet,f.sender);assert.equal(observed.state,'pending');assert.equal(f.submitted,1);assert.equal(writeCount(f),before);}
  f.assertPreserved();
 }finally{f.close();}}
});

test('a forged lifecycle marker, old full checkpoint or missing current human proof cannot enter a qualified operation',async()=>{
 for(const mode of ['marker','full','human']){const f=await core(companies[0],{humanConfirmed:mode!=='human'});try{
  if(mode==='full'){await f.receiver.start(f.packet,f.sender);await assert.rejects(f.draft.reviewPreparedDraft(f.packet,f.sender),{code:'CHECKPOINT_MODE'});}
  else{await f.draft.prepareDraft(f.packet,f.sender);if(mode==='marker'){const old=f.storage.get(f.context.key);f.storage.force(f.context.key,{...old,preparedLifecycle:true});await assert.rejects(f.draft.recoverPreparedDraft(f.packet,f.sender));}
   else{const reviewed=await f.draft.reviewPreparedDraft(f.packet,f.sender),result=await f.draft.confirmPreparedDraft(f.packet,f.sender,f.action(reviewed));assert.equal(result.error.code,'HUMAN_CONFIRMATION');assert.equal(result.state,'awaiting-stage-consent');assert.equal(f.stageAcceptCounts.productPage,0);}}
  assert.equal(f.submitted,0);f.assertPreserved();
 }finally{f.close();}}
});

test('public lifecycle dispatch selects only native construction, preserves original confirmation and cannot enable ordinary full operations',async()=>{
 const f=await nativeReceiverReceiptFixture();try{const expired=createProductDocumentDraftReceiver({adapter:f.adapter,store:f.storage.store,now:()=>f.packet.createdAt+PRODUCT_DOCUMENT_REQUEST_TTL+1});await assert.rejects(expired.reviewPreparedDraft(f.packet,f.sender),{code:'EXPIRED'});
  const source=fs.readFileSync(new URL('../extensions/supplier-hub/product-document-dispatch.mjs',import.meta.url),'utf8').replace(/^import .*;\r?\n/gm,'').replace(/export /g,'');
  for(const native of [false,true]){const calls=[],sandbox={productDocumentIdentity,SingleDocumentError,readPreparedDocumentPreviewCheckpoint,resolveProductSourceContext:async context=>context,createVerifiedProductDocumentBrowserAdapter:async()=>({nativeAssets:native,sourcePlanSha256:f.context.identity.fingerprint,adapter:{dispose(){calls.push('dispose');}}}),createProductDocumentStore:()=>({get:async()=>null}),createProductDocumentReceiver:()=>assert.fail('General receiver remains gated'),
   createProductDocumentDraftReceiver:()=>Object.fromEntries(['reviewPreparedDraft','confirmPreparedDraft','recoverPreparedDraft','observePreparedDraft'].map(action=>[action,async(_packet,_sender,confirmation)=>{calls.push([action,confirmation]);return{preparedLifecycle:true,state:'awaiting-stage-consent'};}]))};
   const dispatch=vm.runInNewContext(source+'\ndispatchProductDocument',sandbox);for(const action of ['reviewPreparedDraft','confirmPreparedDraft','recoverPreparedDraft','observePreparedDraft']){const confirmation=action==='confirmPreparedDraft'?{challengeId:'exact-human-approval'}:undefined,message={type:'YOOFAM_PRODUCT_DOCUMENT_REQUEST',action,packet:f.packet,...(confirmation?{confirmation}:{})};
    if(native){await dispatch(message,f.sender);const actual=calls.findLast(value=>Array.isArray(value));assert.equal(actual[0],action);assert.equal(actual[1],confirmation);}else await assert.rejects(dispatch(message,f.sender),{code:'PRODUCT_DRAFT_NATIVE_SOURCE_REQUIRED'});}
   for(const action of ['start','resume','recover','observe','confirm'])await assert.rejects(dispatch({type:'YOOFAM_PRODUCT_DOCUMENT_REQUEST',action,packet:f.packet,...(action==='confirm'?{confirmation:{}}:{})},f.sender),{code:'PRODUCT_LIVE_CONTRACT_UNVERIFIED'});
  }
 }finally{f.close();}
});
