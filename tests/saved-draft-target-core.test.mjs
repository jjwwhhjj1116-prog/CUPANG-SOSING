import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,webcrypto} from 'node:crypto';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';
import {singlePacket,SINGLE_SENDER} from './helpers/supplier-hub-single-document.mjs';
import {createProductDocumentPacket} from '../extensions/supplier-hub/product-document.mjs';
import {createProductDocumentDraftReceiver,productDocumentIdentity} from '../extensions/supplier-hub/product-document-receiver.mjs';
import {SingleDocumentError,readPreparedDocumentPreviewCheckpoint} from '../extensions/supplier-hub/single-document.mjs';
import {PRODUCT_DOCUMENT_PREFLIGHT_TIMEOUT} from '../extensions/supplier-hub/product-document.mjs';

const copy=value=>structuredClone(value);
const canonical=value=>value===null||typeof value!=='object'?JSON.stringify(value):Array.isArray(value)?'['+value.map(canonical).join(',')+']':'{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonical(value[key])).join(',')+'}';
const digest=value=>createHash('sha256').update(canonical(value)).digest('hex');
const unexpected=async()=>{throw Error('This recovery must not call a document mutation or consent adapter.');};

async function fixture(options={}){
  const base=singlePacket(),now=Date.now(),members=[{optionId:base.optionId,optionLabel:'검정',documentIndex:0}],body=copy(base.body),prepared=copy(body);
  prepared.jsonDocument[0].imagePage.msrpAgree=false;prepared.jsonDocument[0].imagePage.labelContactAgreed=false;
  const scope={ownerId:base.ownerId,company:base.company,productId:base.productId,profileId:base.profileId,requestedProfileId:base.profileId,categoryId:base.categoryId,
    fingerprint:base.fingerprint,inputFingerprint:'d'.repeat(64),schemaSha256:base.schemaSha256,source:{...base.source,profileId:base.profileId}};
  const review={format:'yoofam-supplier-hub-product-document-v1',type:'YOOFAM_PRODUCT_DOCUMENT_REVIEW',identity:scope,members,body,originalBodySha256:digest(body),preparedBodySha256:digest(prepared),reviewDigest:null,registered:false,remoteWrites:false,submissionReady:false};
  review.reviewDigest=digest({format:review.format,type:review.type,identity:scope,members,originalBodySha256:review.originalBodySha256,preparedBodySha256:review.preparedBodySha256});
  const packet=await createProductDocumentPacket(review,{requestId:'f2940000-0000-4000-8000-000000000001',createdAt:now,now}),sender=copy(SINGLE_SENDER),context=await productDocumentIdentity(packet,sender,{now});
  const previousTarget={tabId:71,windowId:sender.tab.windowId,origin:'https://supplier.coupang.com',requestId:packet.requestId,packetDigest:context.packetDigest};
  const original={format:context.packet.format,key:context.key,laneKey:context.laneKey,identity:context.identity,identityDigest:context.identityDigest,bodySha256:context.bodySha256,originalBodySha256:context.originalBodySha256,packetDigest:context.packetDigest,
    requestId:packet.requestId,state:options.state??'update-requested',sequence:12,updatedAt:now-1000,docId:2347603,tab:{...previousTarget,authenticated:true,company:copy(base.company)},ownedTarget:previousTarget,sessionId:'historic-session',baselineDocIds:[123,'existing-draft'],validatedSteps:[],stageConsents:[],challenge:null,receipt:null,draftOnly:true,operationId:packet.requestId+':update',
    createRetry:{attempt:1,originalRequestedAt:now-90000,originalSequence:2,approvedAt:now-20000,resumeUsed:true},
    existingDocumentRepair:{format:'yoofam-existing-document-repair-v1',attempt:1,docId:2347603,startedAt:now-15000,priorSequence:5,priorOperationId:packet.requestId+':update',inspectionSha256:'e'.repeat(64)}};
  let saved=copy(original);
  const f={now,packet,sender,context,original:copy(original),sourceSnapshot:copy(packet),previousTarget,calls:[],oldClosed:true,newClosed:false,currentSession:'fresh-session',current:true,sourceCompany:copy(base.company),tabCompany:copy(base.company),created:0,qualified:0,writes:[],casFailures:new Set(),...options};
  const store={get:async()=>copy(saved),claim:unexpected,compareAndSet:async(_key,prior,next)=>{f.calls.push({name:'cas',phase:next.savedDraftTargetRecovery?.phase});if(f.casFailures.delete(next.savedDraftTargetRecovery?.phase))return false;if(canonical(saved)!==canonical(prior))return false;saved=copy(next);return true;}};
  f.saved=()=>copy(saved);f.force=value=>{saved=copy(value);};
  const record=(name,input)=>f.calls.push({name,input:copy(input)});
  const adapter={
    readSource:async input=>{record('readSource',input);return {current:f.current,submissionReady:true,priorDocumentClear:true,identity:{...copy(context.identity),company:copy(f.sourceCompany)},bodySha256:context.originalBodySha256,sessionId:f.currentSession,...f.sourceProof};},
    readOwnedTargetPresence:async input=>{record('presence',input);return {requestId:packet.requestId,packetDigest:context.packetDigest,tabId:input.tab.tabId,windowId:sender.tab.windowId,closed:input.tab.tabId===71?f.oldClosed:f.newClosed,checkedAt:f.now,...f.presenceProof};},
    createTarget:async input=>{record('createTarget',input);f.created++;if(f.lostTargetAck)throw Error('synthetic lost browser-tab ACK');return {...previousTarget,tabId:90};},
    readTab:async input=>{record('readTab',input);return {...copy(input.tab),authenticated:true,company:copy(f.tabCompany)};},
    qualifySavedDraftTarget:async input=>{record('qualifySavedDraftTarget',input);f.qualified++;const proof={format:'yoofam-current-saved-draft-target-v1',requestId:packet.requestId,docId:original.docId,tabId:input.tab.tabId,windowId:input.tab.windowId,identityDigest:context.identityDigest,packetDigest:context.packetDigest,preparedBodySha256:context.bodySha256,sourcePlanSha256:context.identity.fingerprint,baselineSha256:digest(original.baselineDocIds),bodySha256:context.bodySha256,fileSetSha256:'1'.repeat(64),byteSetSha256:'2'.repeat(64),filesCount:5,duplicateMatches:0,documentState:'UNFINISHED',readOnly:true,remoteWrites:false,historicalAckRecovered:false,observedAt:f.now};return f.proof?f.proof(proof):proof;},
    hubRequest:async input=>{record('hubRequest',input);if(input.method==='GET')return {ok:true,status:200,json:[{docId:original.docId}]};if(input.path.includes('/validate-step/'))return {ok:true,status:200,json:{code:200,data:[{success:true,errors:[]}]}};f.writes.push(copy(input));return unexpected();},
    readDocument:async input=>{record('readDocument',input);assert.equal(input.tab.tabId,90);return {docId:original.docId,company:copy(base.company),identityDigest:context.identityDigest,body:{...copy(prepared),docId:original.docId}};},
    qualifyPreparedDraft:async input=>{record('qualifyPreparedDraft',input);return {readOnly:true,docId:input.docId,company:copy(base.company),identityDigest:context.identityDigest,packetDigest:context.packetDigest,sourcePlanSha256:context.identity.fingerprint,metadataObserved:true,checkedAt:f.now};},
    recoverWrite:unexpected,readValidation:unexpected,navigate:unexpected,readAgreements:unexpected,verifyHumanConfirmation:unexpected,confirmAgreements:unexpected,submit:unexpected,observeReceipt:unexpected,
  };
  f.adapter=adapter;f.store=store;f.receiver=()=>createProductDocumentDraftReceiver({adapter,store,now:()=>f.now});
  f.assertReadOnly=()=>{assert.equal(f.writes.length,0);assert.deepEqual(f.packet,f.sourceSnapshot);assert.ok(f.calls.filter(call=>call.name==='hubRequest').every(call=>call.input.method==='GET'||call.input.path.includes('/validate-step/')));};
  return f;
}

for(const action of ['recoverDraft','recoverPreparedDraft'])test(`closed known draft detection through ${action} preserves every checkpoint byte despite routine source session refresh`,async()=>{
  const f=await fixture(),before=f.saved(),reply=await f.receiver()[action](f.packet,f.sender);
  assert.equal(reply.error.code,'SAVED_DRAFT_TARGET_CLOSED');assert.equal(reply.docId,before.docId);assert.equal(reply.draftOnly,true);assert.deepEqual(f.saved(),before);assert.equal(f.created,0);
  assert.equal(f.calls.some(call=>call.name==='readTab'),false);assert.equal((await readPreparedDocumentPreviewCheckpoint(f.context,f.store)).savedDraftTargetRecoveryAvailableScope,true);f.assertReadOnly();
});

for(const state of ['update-requested','updated'])test(`saved draft recovery binds exact current read evidence without inventing historic ACKs (${state})`,async()=>{
  const f=await fixture({state}),reply=await f.receiver().recoverSavedDraftTarget(f.packet,f.sender),saved=f.saved(),audit=saved.savedDraftTargetRecovery;
  assert.equal(reply.state,'updated',JSON.stringify(reply));assert.equal(reply.recovered,true);assert.equal(reply.draftOnly,true);assert.equal(reply.docId,f.original.docId);assert.equal(saved.sessionId,'fresh-session');assert.equal(saved.ownedTarget.tabId,90);assert.equal(f.created,1);assert.equal(f.qualified,1);
  assert.equal(audit.phase,'bound');assert.equal(audit.priorState,state);assert.equal(audit.priorSequence,f.original.sequence);assert.equal(audit.previousSessionId,f.original.sessionId);assert.deepEqual(audit.previousTarget,f.previousTarget);assert.equal(audit.proofSha256,digest(audit.proof));assert.equal(audit.proof.historicalAckRecovered,false);
  for(const key of ['requestId','identity','identityDigest','bodySha256','originalBodySha256','packetDigest','baselineDocIds','createRetry','existingDocumentRepair','operationId'])assert.deepEqual(saved[key],f.original[key],key);
  assert.deepEqual(f.calls.filter(call=>call.name==='cas').map(call=>call.phase),['requested','created','bound']);
  const input=f.calls.find(call=>call.name==='qualifySavedDraftTarget').input;assert.equal(input.sessionId,'fresh-session');assert.equal(input.expectedBody.docId,f.original.docId);assert.deepEqual(input.baselineDocIds,f.original.baselineDocIds);assert.deepEqual(input.previousTarget,f.previousTarget);f.assertReadOnly();
});

test('bound recovery enters only the existing four validation steps and retains its separate current-read audit',async()=>{
  const f=await fixture();await f.receiver().recoverSavedDraftTarget(f.packet,f.sender);const audit=f.saved().savedDraftTargetRecovery;
  const reply=await f.receiver().prepareDraft(f.packet,f.sender);assert.equal(reply.state,'validated',JSON.stringify(reply));assert.deepEqual(reply.draftProof.validatedSteps,[2,3,4,5]);assert.deepEqual(f.saved().savedDraftTargetRecovery,audit);
  assert.deepEqual(f.calls.filter(call=>call.name==='hubRequest'&&call.input.method==='POST').map(call=>Number(call.input.path.split('/').at(-1))),[2,3,4,5]);
  for(const action of ['repairExistingDraft','retryExistingDraftRepair','continueApprovedRepair','resumeReservedRepair','retryCreateDraft','resumeCreateRetryDraft','recoverClosedTarget'])assert.equal((await f.receiver()[action](f.packet,f.sender)).error.code,'SAVED_DRAFT_TARGET_READ_ONLY');
  assert.equal(f.created,1);f.assertReadOnly();
});

test('a reserved read target uses exactly full start and final source guards without creating another tab',async()=>{
 const f=await fixture({proof:()=>null});assert.equal((await f.receiver().recoverSavedDraftTarget(f.packet,f.sender)).error.code,'SAVED_DRAFT_TARGET_UNCONFIRMED');
 const reserved=f.saved();f.proof=undefined;f.calls=[];const result=await f.receiver().recoverSavedDraftTarget(f.packet,f.sender);
 assert.equal(result.state,'updated',JSON.stringify(result));assert.equal(f.calls.filter(call=>call.name==='readSource').length,2);assert.equal(f.calls.some(call=>call.name==='createTarget'),false);assert.equal(f.created,1);
 assert.deepEqual(f.saved().savedDraftTargetRecovery.target,reserved.savedDraftTargetRecovery.target);f.assertReadOnly();
});

const proofMutations={missing:()=>null,extra:proof=>({...proof,claimedHistoricAck:true}),identity:proof=>({...proof,identityDigest:'3'.repeat(64)}),packet:proof=>({...proof,packetDigest:'3'.repeat(64)}),body:proof=>({...proof,bodySha256:'3'.repeat(64)}),source:proof=>({...proof,sourcePlanSha256:'3'.repeat(64)}),baseline:proof=>({...proof,baselineSha256:'3'.repeat(64)}),document:proof=>({...proof,docId:2347604}),tab:proof=>({...proof,tabId:91}),window:proof=>({...proof,windowId:999}),duplicate:proof=>({...proof,duplicateMatches:1}),state:proof=>({...proof,documentState:'SUBMITTED'}),historic:proof=>({...proof,historicalAckRecovered:true}),writes:proof=>({...proof,remoteWrites:true}),bytes:proof=>({...proof,byteSetSha256:'bad'}),files:proof=>({...proof,filesCount:0}),stale:proof=>({...proof,observedAt:proof.observedAt-60001}),future:proof=>({...proof,observedAt:proof.observedAt+60001})};
for(const [name,proof]of Object.entries(proofMutations))test(`current server proof rejects ${name} without rebinding or any document write`,async()=>{
  const f=await fixture({proof}),reply=await f.receiver().recoverSavedDraftTarget(f.packet,f.sender);assert.equal(reply.error.code,'SAVED_DRAFT_TARGET_UNCONFIRMED',JSON.stringify(reply));assert.equal(f.saved().savedDraftTargetRecovery.phase,'created');assert.equal(f.saved().ownedTarget.tabId,71);assert.equal(f.saved().sessionId,'historic-session');assert.equal(f.created,1);f.assertReadOnly();
});

test('open original target, changed source, and changed company never reserve a replacement',async()=>{
  for(const options of [{oldClosed:false},{current:false},{sourceCompany:{code:'A01464742',name:'와이홉'}}]){const f=await fixture(options),reply=await f.receiver().recoverSavedDraftTarget(f.packet,f.sender);assert.ok(['SAVED_DRAFT_TARGET_SCOPE','SOURCE_CHANGED'].includes(reply.error.code));assert.equal(f.created,0);assert.deepEqual(f.saved(),f.original);f.assertReadOnly();}
});

test('created target remains reserved through company/proof failures and retries qualify only that target',async()=>{
  const f=await fixture({tabCompany:{code:'A01464742',name:'와이홉'}});assert.equal((await f.receiver().recoverSavedDraftTarget(f.packet,f.sender)).error.code,'TAB_CHANGED');assert.equal(f.saved().savedDraftTargetRecovery.phase,'created');
  f.tabCompany=copy(f.original.identity.company);assert.equal((await f.receiver().recoverSavedDraftTarget(f.packet,f.sender)).state,'updated');assert.equal(f.created,1);f.assertReadOnly();
});

test('lost browser target ACK reserves requested phase and blocks every subsequent target creation',async()=>{
  const f=await fixture({lostTargetAck:true});assert.equal((await f.receiver().recoverSavedDraftTarget(f.packet,f.sender)).error.code,'ADAPTER_FAILURE');assert.equal(f.saved().savedDraftTargetRecovery.phase,'requested');
  for(const action of ['recoverDraft','recoverPreparedDraft','recoverSavedDraftTarget'])assert.equal((await f.receiver()[action](f.packet,f.sender)).error.code,'SAVED_DRAFT_TARGET_PENDING');assert.equal(f.created,1);assert.equal(f.qualified,0);f.assertReadOnly();
});

test('CAS conflicts stop before browser creation, or retain requested/created reservations without replaying targets',async()=>{
  for(const phase of ['requested','created','bound']){const f=await fixture({casFailures:new Set([phase])}),reply=await f.receiver().recoverSavedDraftTarget(f.packet,f.sender);assert.equal(reply.error.code,'CHECKPOINT_CONFLICT',JSON.stringify(reply));assert.equal(f.created,phase==='requested'?0:1);
    const retry=await f.receiver().recoverSavedDraftTarget(f.packet,f.sender);assert.equal(retry.error?.code,phase==='created'?'SAVED_DRAFT_TARGET_PENDING':undefined);assert.equal(f.created,1);assert.equal(f.saved().savedDraftTargetRecovery.phase,phase==='created'?'requested':'bound');f.assertReadOnly();}
});

test('two concurrent recoveries create one target; stale repeated reads preserve audit and a closed rebound never loops targets',async()=>{
  const f=await fixture();await Promise.all([f.receiver().recoverSavedDraftTarget(f.packet,f.sender),f.receiver().recoverSavedDraftTarget(f.packet,f.sender)]);assert.equal(f.created,1);
  if(f.saved().savedDraftTargetRecovery.phase!=='bound')await f.receiver().recoverSavedDraftTarget(f.packet,f.sender);
  const saved=f.saved(),audit=saved.savedDraftTargetRecovery;f.now+=180000;const repeated=await f.receiver().recoverSavedDraftTarget(f.packet,f.sender);assert.equal(repeated.state,'updated');assert.equal(repeated.duplicate,true);assert.deepEqual(f.saved(),saved);assert.deepEqual(f.saved().savedDraftTargetRecovery,audit);
  f.newClosed=true;assert.equal((await f.receiver().recoverSavedDraftTarget(f.packet,f.sender)).error.code,'SAVED_DRAFT_TARGET_LIMIT');assert.equal((await f.receiver().recoverDraft(f.packet,f.sender)).error.code,'SAVED_DRAFT_TARGET_LIMIT');assert.equal(f.created,1);f.assertReadOnly();
});

test('tampered durable proof hashes and recovery audit fields fail checkpoint validation',async()=>{
  for(const mutate of [saved=>{saved.savedDraftTargetRecovery.proofSha256='4'.repeat(64);},saved=>{saved.savedDraftTargetRecovery.proof.baselineSha256='4'.repeat(64);saved.savedDraftTargetRecovery.proofSha256=digest(saved.savedDraftTargetRecovery.proof);},saved=>{saved.savedDraftTargetRecovery.unexpected=true;},saved=>{saved.savedDraftTargetRecovery.docId=2347604;},saved=>{saved.state='created';}]){const f=await fixture();await f.receiver().recoverSavedDraftTarget(f.packet,f.sender);const saved=f.saved();mutate(saved);f.force(saved);await assert.rejects(f.receiver().recoverSavedDraftTarget(f.packet,f.sender),error=>error.code==='CHECKPOINT');assert.equal(f.created,1);f.assertReadOnly();}
});

test('a prior approved target-recovery audit remains immutable through the distinct known-document rebind',async()=>{
  const f=await fixture(),prior=f.saved();prior.targetRecovery={format:'approved-closed-target-v1',phase:'bound',previousTarget:{...f.previousTarget,tabId:66},approvedAt:f.now-12000,target:copy(f.previousTarget)};f.force(prior);
  const reply=await f.receiver().recoverSavedDraftTarget(f.packet,f.sender);assert.equal(reply.state,'updated',JSON.stringify(reply));assert.deepEqual(f.saved().targetRecovery,prior.targetRecovery);assert.equal(f.saved().savedDraftTargetRecovery.previousTarget.tabId,prior.targetRecovery.target.tabId);f.assertReadOnly();
});

test('missing ownership evidence, source changes during qualification, and ineligible draft states cannot bind a saved target',async()=>{
  for(const presenceProof of [{checkedAt:Date.now()-600001},{tabId:999},{windowId:999},{packetDigest:'f'.repeat(64)},{closed:'yes'}]){const f=await fixture({presenceProof}),reply=await f.receiver().recoverSavedDraftTarget(f.packet,f.sender);assert.equal(reply.error.code,'TAB_CHANGED');assert.equal(f.created,0);assert.deepEqual(f.saved(),f.original);f.assertReadOnly();}
  const changed=await fixture();changed.proof=proof=>{changed.current=false;return proof;};assert.equal((await changed.receiver().recoverSavedDraftTarget(changed.packet,changed.sender)).error.code,'SOURCE_CHANGED');assert.equal(changed.saved().savedDraftTargetRecovery.phase,'created');assert.equal(changed.saved().ownedTarget.tabId,71);changed.assertReadOnly();
  for(const mutate of [saved=>{saved.state='created';saved.operationId=saved.requestId+':create';},saved=>{saved.validatedSteps=[2];},saved=>{saved.baselineDocIds.push(String(saved.docId));}]){const f=await fixture(),prior=f.saved();mutate(prior);f.force(prior);const reply=await f.receiver().recoverSavedDraftTarget(f.packet,f.sender);assert.equal(reply.error.code,'SAVED_DRAFT_TARGET_SCOPE');assert.equal(f.created,0);f.assertReadOnly();}
});

test('the public action requires the dedicated native current-read qualification capability',async()=>{
  const f=await fixture();delete f.adapter.qualifySavedDraftTarget;const reply=await f.receiver().recoverSavedDraftTarget(f.packet,f.sender);assert.equal(reply.error.code,'SAVED_DRAFT_TARGET_SCOPE');assert.equal(f.created,0);assert.deepEqual(f.saved(),f.original);f.assertReadOnly();
});

test('production dispatcher exposes only native recovery capability and uses a fresh disposed adapter for explicit recovery',async()=>{
  const source=fs.readFileSync(new URL('../extensions/supplier-hub/product-document-dispatch.mjs',import.meta.url),'utf8').replace(/^import .*;\r?\n/gm,'').replace(/export /g,'');
  for(const nativeAssets of [false,true]){const f=await fixture();let disposed=0;f.adapter.dispose=()=>{disposed++;};
    const dispatch=vm.runInNewContext(source+'\ndispatchProductDocument',{productDocumentIdentity,SingleDocumentError,readPreparedDocumentPreviewCheckpoint,PRODUCT_DOCUMENT_PREFLIGHT_TIMEOUT,setTimeout,clearTimeout,Date,
      resolveProductSourceContext:async context=>context,createVerifiedProductDocumentBrowserAdapter:async()=>({adapter:f.adapter,nativeAssets,sourcePlanSha256:f.context.identity.fingerprint}),createProductDocumentStore:()=>f.store,
      createProductDocumentDraftReceiver:options=>createProductDocumentDraftReceiver({...options,now:()=>f.now}),createProductDocumentReceiver:()=>assert.fail('Ordinary full-product writes remain gated')});
    const preview=await dispatch({type:'YOOFAM_PRODUCT_DOCUMENT_REQUEST',action:'preview',packet:f.packet},f.sender);assert.equal(preview.savedDraftTargetRecoveryAvailable,nativeAssets);assert.equal(preview.remoteWrites,false);assert.deepEqual(f.saved(),f.original);assert.equal(f.created,0);assert.equal(disposed,1);
    if(nativeAssets){const before=f.saved(),closed=await dispatch({type:'YOOFAM_PRODUCT_DOCUMENT_REQUEST',action:'recoverPreparedDraft',packet:f.packet},f.sender);assert.equal(closed.error.code,'SAVED_DRAFT_TARGET_CLOSED');assert.equal(closed.draftOnly,true);assert.equal(closed.preparedLifecycle,undefined);assert.deepEqual(f.saved(),before);assert.equal(f.created,0);assert.equal(disposed,2);
      const result=await dispatch({type:'YOOFAM_PRODUCT_DOCUMENT_REQUEST',action:'recoverSavedDraftTarget',packet:f.packet},f.sender);assert.equal(result.state,'updated',JSON.stringify(result));assert.equal(result.recovered,true);assert.equal(disposed,3);assert.equal(f.created,1);}
    else await assert.rejects(dispatch({type:'YOOFAM_PRODUCT_DOCUMENT_REQUEST',action:'recoverSavedDraftTarget',packet:f.packet},f.sender),error=>error.code==='PRODUCT_DRAFT_NATIVE_SOURCE_REQUIRED');
    f.assertReadOnly();
  }
});

test('actual app prepared-read client accepts the production dispatcher closed-draft reply as a verified same-document recovery hint',async()=>{
  const f=await fixture(),origin=new URL(f.sender.url).origin,listeners=new Set(),modules=new Map(),sent=[],native=createRequire(import.meta.url);f.adapter.dispose=()=>{};
  const source=fs.readFileSync(new URL('../extensions/supplier-hub/product-document-dispatch.mjs',import.meta.url),'utf8').replace(/^import .*;\r?\n/gm,'').replace(/export /g,'');
  const dispatch=vm.runInNewContext(source+'\ndispatchProductDocument',{productDocumentIdentity,SingleDocumentError,readPreparedDocumentPreviewCheckpoint,PRODUCT_DOCUMENT_PREFLIGHT_TIMEOUT,setTimeout,clearTimeout,Date,
    resolveProductSourceContext:async context=>context,createVerifiedProductDocumentBrowserAdapter:async()=>({adapter:f.adapter,nativeAssets:true,sourcePlanSha256:f.context.identity.fingerprint}),createProductDocumentStore:()=>f.store,
    createProductDocumentDraftReceiver:options=>createProductDocumentDraftReceiver({...options,now:()=>f.now}),createProductDocumentReceiver:()=>assert.fail('Ordinary full-product writes remain gated')});
  const win={location:{origin},addEventListener:(type,listener)=>{if(type==='message')listeners.add(listener);},removeEventListener:(_type,listener)=>listeners.delete(listener),postMessage:(message,target)=>{
    assert.equal(target,origin);sent.push(message.payload.action);const emit=result=>{for(const listener of [...listeners])listener({source:win,origin,data:{channel:'YOOFAM_HUB_HANDOFF_RESULT',requestId:message.requestId,result}});};void Promise.resolve().then(async()=>emit({ok:true,result:await dispatch({type:'YOOFAM_PRODUCT_DOCUMENT_REQUEST',...message.payload},f.sender)})).catch(error=>emit({ok:false,code:error.code,error:error.message}));
  }};
  class LocalDate extends Date{static now(){return f.now;}}
  const load=file=>{if(modules.has(file))return modules.get(file);const exports={};modules.set(file,exports);vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../'+file,import.meta.url),'utf8'),{fileName:file,compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,
    {exports,Error,Date:LocalDate,URL,TextEncoder,TextDecoder,Uint8Array,AbortController,structuredClone,crypto:webcrypto,window:win,setTimeout,clearTimeout,fetch:unexpected,
      require:name=>name.startsWith('@/')?load(name.slice(2)+'.ts'):name.endsWith('.mjs')?native(fileURLToPath(new URL('../'+path.posix.join(path.posix.dirname(file),name),import.meta.url))):native(name)},{filename:file});return exports;};
  const client=load('app/supplier-hub-product-client.ts'),session=await client.previewProductDocument(f.packet,new AbortController().signal),before=f.saved();
  await assert.rejects(client.runPreparedProductDocument(session,'recoverPreparedDraft',new AbortController().signal),error=>error.code==='PRODUCT_DOCUMENT_DRAFT_SOURCE_FAILURE'&&error.savedDraftTargetClosed===true&&error.knownDocId===f.original.docId&&error.uncertain===false);
  assert.deepEqual(sent,['preview','recoverPreparedDraft']);assert.deepEqual(f.saved(),before);assert.equal(f.created,0);assert.equal(f.qualified,0);assert.equal(listeners.size,0);f.assertReadOnly();
});

test('prepared qualification receives only exact previously confirmed checkpoint stages, with no implicit agreement acceptance',async()=>{
  const f=await fixture();await f.receiver().recoverSavedDraftTarget(f.packet,f.sender);await f.receiver().prepareDraft(f.packet,f.sender);
  const saved=f.saved(),challenge=stage=>({id:(stage==='productPage'?'5':'6').repeat(64),docId:saved.docId,packetDigest:f.context.packetDigest,issuedAt:f.now-100,expiresAt:f.now-100+120000,stage,
    items:[{key:stage==='productPage'?'msrpAgree':'labelContactAgreed',id:stage==='productPage'?'agreeMSRPTerm':'agreeLabelContact',text:'직접 확인한 단계 동의',required:true,title:'직접 확인한 약관 제목',termsText:'직접 읽고 확인한 약관 전문'}]});
  const previous={stage:'productPage',challenge:challenge('productPage'),confirmedAt:f.now-50};
  f.force({...saved,state:'awaiting-stage-consent',sequence:saved.sequence+2,preparedLifecycle:true,preparationOrigin:{preparedCheckpointSequence:saved.sequence,qualifiedCheckpointSequence:saved.sequence+1,qualifiedAt:f.now},stageConsents:[previous],challenge:challenge('imagePage')});
  const before=f.saved(),reply=await f.receiver().confirmPreparedDraft(f.packet,f.sender,{}),qualifications=f.calls.filter(call=>call.name==='qualifyPreparedDraft');
  assert.equal(reply.error.code,'HUMAN_CONFIRMATION');assert.equal(qualifications.length,1);assert.deepEqual(qualifications[0].input.stageConsents,[previous]);assert.deepEqual(f.saved(),before);assert.equal(f.calls.some(call=>call.name==='confirmAgreements'),false);f.assertReadOnly();
});
