import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {createHash,webcrypto} from 'node:crypto';
import {createProductDocumentPacket,PRODUCT_DOCUMENT_PREFLIGHT_TIMEOUT,PRODUCT_DOCUMENT_PREVIEW_ACK_TIMEOUT} from '../extensions/supplier-hub/product-document.mjs';
import {productDocumentIdentity} from '../extensions/supplier-hub/product-document-receiver.mjs';
import {singleDocumentIdentity} from '../extensions/supplier-hub/single-document.mjs';
import {singlePacket,SINGLE_COMPANIES,SINGLE_SENDER} from './helpers/supplier-hub-single-document.mjs';
import {normalizeRejectionDetails} from '../extensions/supplier-hub/rejection-details.mjs';

const native=createRequire(import.meta.url),origin=new URL(SINGLE_SENDER.url).origin,plain=value=>JSON.parse(JSON.stringify(value));
const canonical=value=>value===null||typeof value!=='object'?JSON.stringify(value):Array.isArray(value)?'['+value.map(canonical).join(',')+']':'{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonical(value[key])).join(',')+'}';
const digest=value=>createHash('sha256').update(canonical(value)).digest('hex'),cases=[];
const files=['app/supplier-hub-product-client.ts','app/supplier-hub-single-client.ts','extensions/supplier-hub/product-document-receiver.mjs','tests/supplier-hub-product-client.test.mjs'];
const hashes=()=>Object.fromEntries(files.map(file=>[file,createHash('sha256').update(fs.readFileSync(new URL('../'+file,import.meta.url))).digest('hex')]));
const frozen=hashes();
after(()=>{assert.deepEqual(hashes(),frozen);fs.writeFileSync(new URL('../outputs/step728-product-client-proof.json',import.meta.url),JSON.stringify({sourceHashes:frozen,cases,
  boundary:'Actual app client, pure product packet, browser-bound identity and receipt parsers. Window bridge, clock and local API are isolated fixtures; true live flag is a synthetic test response only.',hubWrites:0,businessWrites:0,externalRequests:0,actualReceiptVerified:false},null,2)+'\n');});
async function fixture(company=SINGLE_COMPANIES[0],options={}){
  const clock={now:Date.now()},listeners=new Set(),timers=new Map(),sent=[],calls=[],modules=new Map();let sequence=0;
  const single=singlePacket(company),body=plain(single.body),second=plain(body.jsonDocument[0]);second.startPage.productName='두 번째 저장 옵션';second.productPage.modelNumber='';second.productPage.supplyPrice='';body.jsonDocument.push(second);
  const identity={ownerId:single.ownerId,company:plain(company),productId:single.productId,profileId:single.profileId,requestedProfileId:options.queryless?null:single.profileId,
    categoryId:single.categoryId,fingerprint:single.fingerprint,inputFingerprint:'d'.repeat(64),schemaSha256:single.schemaSha256,source:{...single.source,profileId:single.profileId}};
  const review={format:'yoofam-supplier-hub-product-document-v1',type:'YOOFAM_PRODUCT_DOCUMENT_REVIEW',identity,members:[{optionId:'first',optionLabel:'첫 옵션',documentIndex:0},{optionId:'second',optionLabel:'둘째 옵션',documentIndex:1}],body,registered:false,remoteWrites:false,submissionReady:false};
  const deferred=plain(body);for(const document of deferred.jsonDocument)for(const key of ['msrpAgree','labelContactAgreed'])document.imagePage[key]=false;
  review.originalBodySha256=digest(body);review.preparedBodySha256=digest(deferred);review.reviewDigest=digest({format:review.format,type:review.type,identity,members:review.members,originalBodySha256:review.originalBodySha256,preparedBodySha256:review.preparedBodySha256});
  const packet=await createProductDocumentPacket(review,{now:clock.now}),context=await productDocumentIdentity(packet,SINGLE_SENDER,{now:clock.now});
  const f={clock,packet,context,review,sent,calls,timers,listeners,actor:{ownerId:identity.ownerId,company:plain(company)},history:[],bridge:null};
  const win={location:{origin},addEventListener(type,fn){if(type==='message')listeners.add(fn);},removeEventListener(type,fn){if(type==='message')listeners.delete(fn);},postMessage(message,target){assert.equal(target,origin);assert.equal(message.type,'PRODUCT_DOCUMENT');sent.push(plain(message));void Promise.resolve().then(async()=>{const result=await f.bridge(message.payload);if(result!==undefined)f.emit(message,result);}).catch(error=>f.emit(message,null,{ok:false,error:error.message,code:error.code}));}};
  f.emit=(message,result,envelope,overrides={})=>{for(const listener of [...listeners])listener({source:win,origin,data:{channel:'YOOFAM_HUB_HANDOFF_RESULT',requestId:message.requestId,result:envelope??{ok:true,result}},...overrides});};
  const setTimer=(fn,delay)=>{const id=++sequence;timers.set(id,{fn,due:clock.now+delay});return id;},clearTimer=id=>timers.delete(id);
  class LocalDate extends Date{static now(){return clock.now;}}
  f.fetch=async(url,init={})=>{calls.push({url,method:init.method??'GET',body:init.body?JSON.parse(init.body):undefined});await options.beforeFetch?.(url,init,f);
    if(url==='/api/supplier-hub/catalog-context')return Response.json(f.actor);
    if(String(url).includes('/supplier-hub-product-receipt')){
      if(init.method==='POST'){
        const body=JSON.parse(init.body),record={...plain(await load('app/supplier-hub-product-receipt.ts').validateProductReceiptObservation(body.observation,review,origin,clock.now)),recordedAt:new Date(clock.now).toISOString()};
        await options.beforeSaveReply?.(record,f);f.history=[record];return Response.json({receipt:record});
      }
      return options.historyResponse?options.historyResponse(f):Response.json({format:'yoofam-native-receipt-history-v1',productId:identity.productId,receipts:f.history});
    }throw Error('Unexpected/forbidden request '+url);
  };
  const load=file=>{if(modules.has(file))return modules.get(file);const exports={};modules.set(file,exports);vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../'+file,import.meta.url),'utf8'),{fileName:file,compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,
    {exports,Error,Date:LocalDate,URL,TextEncoder,TextDecoder,Uint8Array,AbortController,structuredClone,crypto:webcrypto,window:win,setTimeout:setTimer,clearTimeout:clearTimer,fetch:(...args)=>f.fetch(...args),require:name=>name.startsWith('@/')?load(name.slice(2)+'.ts'):name.endsWith('.mjs')?native(fileURLToPath(new URL('../'+path.posix.join(path.posix.dirname(file),name),import.meta.url))):native(name)},{filename:file});return exports;};
  f.load=load;f.window=win;f.client=load('app/supplier-hub-product-client.ts');
  f.preview=()=>({format:review.format,requestId:packet.requestId,identity:plain(context.identity),identityDigest:context.identityDigest,packetDigest:context.packetDigest,productId:identity.productId,fingerprint:identity.fingerprint,members:plain(review.members),reviewDigest:review.reviewDigest,
    preparedBodySha256:review.preparedBodySha256,originalBodySha256:review.originalBodySha256,liveVerified:options.verified===true,remoteWrites:false,registered:false});
  f.state=(state='awaiting-consent',extra={})=>({format:review.format,requestId:packet.requestId,identity:plain(context.identity),identityDigest:context.identityDigest,packetDigest:context.packetDigest,originalBodySha256:review.originalBodySha256,preparedBodySha256:review.preparedBodySha256,state,docId:'new-document-728',registered:false,success:false,needsRecovery:false,...extra});
  f.challenge=(stage)=>({id:'1'.repeat(64),docId:'new-document-728',packetDigest:context.packetDigest,issuedAt:clock.now,expiresAt:clock.now+120000,...(stage?{stage}:{}),items:stage==='logisticsPage'?[]:[{key:'businessTerms',id:'businessTerms',text:'직접 검토할 합성 약관',required:true,...(stage?{title:'정확한 약관 제목',termsText:'첫 문단\n전체 약관\n마지막 문단'}:{})}]});
  f.observation=(status='SUBMITTED')=>{const state={SUBMITTED:'pending',FINISHED:'accepted',REJECTED:'rejected'}[status];return f.state(state,{receipt:{state,sourceStatus:status,docId:'new-document-728',company:plain(company),identityDigest:context.identityDigest,preparedBodySha256:context.bodySha256,observedAt:clock.now,receiptId:'qvt-728',qvtRequestId:'qvt-728',evidence:'document-receipt',registered:false}});};
  f.bridge=async payload=>payload.action==='preview'?f.preview():f.state('awaiting-consent',{challenge:f.challenge()});
  f.advance=amount=>{clock.now+=amount;for(const [id,timer]of [...timers])if(timer.due<=clock.now){timers.delete(id);timer.fn();}};
  f.wait=async predicate=>{for(let i=0;i<300;i++){if(predicate())return;await new Promise(resolve=>setImmediate(resolve));}assert.fail('Client fixture did not reach requested boundary.');};
  f.session=()=>f.client.previewProductDocument(packet,new AbortController().signal);return f;
}
function draftState(f,state='validated',extra={}){
 const steps=state==='validated'?[2,3,4,5]:state==='validation-rejected'?[2]:[];
 return f.state(state,{draftOnly:true,draftProof:{evidence:'document-draft-preparation',validatedSteps:steps,checkpointSequence:10,observedAt:f.clock.now,submitted:false,consented:false},...extra});
}

function lifecycleState(f,state='awaiting-stage-consent',extra={}){
 const submitted=['submit-requested','pending','accepted','rejected'].includes(state);
 return f.state(state,{draftOnly:true,preparedLifecycle:true,lifecycleProof:{evidence:'native-prepared-draft-lifecycle',preparedCheckpointSequence:10,qualifiedCheckpointSequence:11,checkpointSequence:12,qualifiedAt:f.clock.now,observedAt:f.clock.now,validatedSteps:[2,3,4,5],consentRequested:submitted||['stage-consent-requested','consent-requested'].includes(state),submitRequested:submitted},...extra});
}

for(const company of SINGLE_COMPANIES)test(`${company.code}: qualified prepared lifecycle carries staged terms and exact receipt through the unchanged strict API`,async()=>{
 const f=await fixture(company);f.bridge=async()=>({...f.preview(),draftPreparationAvailable:true,preparedLifecycleAvailable:true});const session=await f.session();
 f.bridge=async()=>lifecycleState(f,'awaiting-stage-consent',{challenge:f.challenge('productPage')});
 const reviewed=await f.client.runPreparedProductDocument(session,'reviewPreparedDraft',new AbortController().signal);assert.equal(reviewed.preparedLifecycle,true);assert.match(reviewed.challenge.items[0].termsText,/마지막 문단/);assert.ok(Object.isFrozen(reviewed.lifecycleProof.validatedSteps));
 const confirmation=f.load('app/supplier-hub-single-client.ts').singleConsentConfirmation(reviewed.challenge,['businessTerms']);
 f.bridge=async()=>lifecycleState(f,'awaiting-consent',{challenge:f.challenge('logisticsPage')});
 await f.client.runPreparedProductDocument(session,'confirmPreparedDraft',new AbortController().signal,confirmation);
 for(const status of ['SUBMITTED','FINISHED','REJECTED']){
  const observation=f.observation(status);f.bridge=async payload=>lifecycleState(f,observation.state,{receipt:observation.receipt,...(payload.action==='recoverPreparedDraft'?{recovered:true}:{})});
  const result=await f.client.runPreparedProductDocument(session,status==='SUBMITTED'?'recoverPreparedDraft':'observePreparedDraft',new AbortController().signal);
  const projected=f.client.preparedReceiptObservation(result);assert.equal(projected.draftOnly,undefined);assert.equal(projected.lifecycleProof,undefined);assert.equal(projected.receipt.sourceStatus,status);
  const saved=await f.client.saveProductReceiptObservation({packet:session.packet,observation:projected},new AbortController().signal,f.fetch);
  assert.equal(saved.receipt.sourceStatus,status);assert.equal(saved.registered,false);
 }
 await assert.rejects(f.client.runProductDocument(session,'start',new AbortController().signal),error=>error.code==='PRODUCT_DOCUMENT_LIVE_CONTRACT_UNVERIFIED');
 assert.deepEqual(f.sent.map(row=>row.payload.action),['preview','reviewPreparedDraft','confirmPreparedDraft','recoverPreparedDraft','observePreparedDraft','observePreparedDraft']);
});

test('prepared lifecycle rejects missing capability, malformed qualification, absent recovery marker and premature receipt projection',async()=>{
 const f=await fixture();const old=await f.session();await assert.rejects(f.client.runPreparedProductDocument(old,'reviewPreparedDraft',new AbortController().signal),error=>error.code==='PRODUCT_PREPARED_UNAVAILABLE');assert.equal(f.sent.length,1);
 f.bridge=async()=>({...f.preview(),preparedLifecycleAvailable:true});const session=await f.session();
 const changes=[v=>v.lifecycleProof.qualifiedCheckpointSequence=12,v=>v.lifecycleProof.validatedSteps=[2,3,4],v=>v.lifecycleProof.submitRequested=true,v=>v.lifecycleProof.observedAt=f.clock.now+60000,v=>v.lifecycleProof.extra=true,v=>v.identity.company=SINGLE_COMPANIES[1],v=>v.packetDigest='f'.repeat(64),v=>delete v.recovered];
 for(const change of changes){f.bridge=async()=>{const value=lifecycleState(f,'awaiting-stage-consent',{challenge:f.challenge('productPage'),recovered:true});change(value);return value;};await assert.rejects(f.client.runPreparedProductDocument(session,'recoverPreparedDraft',new AbortController().signal),error=>error.code==='PRODUCT_PREPARED_REPLY_IDENTITY'&&!error.uncertain);}
 assert.throws(()=>f.client.preparedReceiptObservation(lifecycleState(f)),/접수 결과/);assert.equal(f.calls.length,0);
});

test('prepared read recovery accepts original partial draft without promotion; navigation ready needs explicit review action',async()=>{
 const f=await fixture();f.bridge=async()=>({...f.preview(),preparedLifecycleAvailable:true});const session=await f.session();
 f.bridge=async()=>draftState(f,'created',{recovered:true});const partial=await f.client.runPreparedProductDocument(session,'recoverPreparedDraft',new AbortController().signal);assert.equal(partial.preparedLifecycle,undefined);assert.equal(partial.state,'created');
 f.bridge=async()=>lifecycleState(f,'navigation-ready',{recovered:true});const result=await f.client.runPreparedProductDocument(session,'recoverPreparedDraft',new AbortController().signal);assert.equal(result.needsRecovery,false);assert.equal(result.challenge,undefined);assert.equal(result.state,'navigation-ready');
 assert.deepEqual(f.sent.map(row=>row.payload.action),['preview','recoverPreparedDraft','recoverPreparedDraft']);assert.equal(f.calls.length,0);
});

for(const company of SINGLE_COMPANIES)test(`${company.code}: trusted draft capability prepares/recover only a new draft while the full live gate stays false`,async()=>{
 const f=await fixture(company);f.bridge=async payload=>payload.action==='preview'?{...f.preview(),draftPreparationAvailable:true}:draftState(f,'validated',{recovered:payload.action==='recoverDraft'});
 const session=await f.session();assert.equal(session.preview.liveVerified,false);assert.equal(session.preview.draftPreparationAvailable,true);
 const prepared=await f.client.runProductDocumentDraft(session,'prepareDraft',new AbortController().signal);assert.equal(prepared.draftOnly,true);assert.equal(prepared.state,'validated');assert.equal(prepared.registered,false);assert.equal(prepared.success,false);assert.equal(prepared.receipt,undefined);assert.equal(prepared.challenge,undefined);assert.ok(Object.isFrozen(prepared.draftProof.validatedSteps));
 const recovered=await f.client.runProductDocumentDraft(session,'recoverDraft',new AbortController().signal);assert.equal(recovered.recovered,true);
 for(const action of ['start','resume','confirm','observe'])await assert.rejects(f.client.runProductDocument(session,action,new AbortController().signal),error=>error.code==='PRODUCT_DOCUMENT_LIVE_CONTRACT_UNVERIFIED');
 assert.deepEqual(f.sent.map(message=>message.payload.action),['preview','prepareDraft','recoverDraft']);assert.equal(f.calls.length,0);
});

test('older or false draft capability cannot send a mutation; malformed capability cannot expose a session',async()=>{
 for(const capability of [undefined,false]){const f=await fixture();f.bridge=async()=>({...f.preview(),...(capability===undefined?{}:{draftPreparationAvailable:capability})});const session=await f.session();
  await assert.rejects(f.client.runProductDocumentDraft(session,'prepareDraft',new AbortController().signal),error=>error.code==='PRODUCT_DOCUMENT_DRAFT_UNAVAILABLE'&&!error.uncertain);assert.equal(f.sent.length,1);
 }
 for(const capability of ['true',1,null]){const f=await fixture();f.bridge=async()=>({...f.preview(),draftPreparationAvailable:capability});await assert.rejects(f.session(),error=>error.code==='PRODUCT_DOCUMENT_REPLY_IDENTITY');assert.equal(f.sent.length,1);}
});

test('draft-only replies reject receipt/consent/advanced state, altered proof and stale scope without relaxing live checks',async()=>{
 const changes=[v=>v.receipt={},v=>v.challenge={},v=>v.state='accepted',v=>v.draftOnly=false,v=>v.draftProof.submitted=true,v=>v.draftProof.consented=true,
  v=>v.draftProof.validatedSteps=[2,4,5],v=>v.draftProof.validatedSteps=[2,3,4],v=>v.draftProof.checkpointSequence=0,v=>v.draftProof.observedAt=Date.now()+60000,
  v=>v.identity.company=SINGLE_COMPANIES[1],v=>v.packetDigest='f'.repeat(64),v=>v.preparedBodySha256='f'.repeat(64),v=>v.docId=null,v=>v.needsRecovery=true,v=>v.registered=true,
  v=>v.draftProof.extra='not allowed',v=>v.recovered=false];
 for(const change of changes){const f=await fixture();f.bridge=async()=>({...f.preview(),draftPreparationAvailable:true});const session=await f.session();f.bridge=async()=>{const value=draftState(f,'validated',{recovered:true});change(value);return value;};
  await assert.rejects(f.client.runProductDocumentDraft(session,'recoverDraft',new AbortController().signal),error=>error.code==='PRODUCT_DOCUMENT_DRAFT_REPLY_IDENTITY'&&error.uncertain===false);assert.deepEqual(f.sent.map(message=>message.payload.action),['preview','recoverDraft']);assert.equal(f.calls.length,0);
 }
});

test('draft busy and missing ACK never retry a create; recovery timeout remains read-only',async()=>{
 for(const action of ['prepareDraft','recoverDraft']){
  const f=await fixture();f.bridge=async()=>({...f.preview(),draftPreparationAvailable:true});const session=await f.session();
  f.bridge=async()=>({format:f.review.format,requestId:f.packet.requestId,state:'busy',registered:false,success:false});
  await assert.rejects(f.client.runProductDocumentDraft(session,action,new AbortController().signal),error=>error.code==='PRODUCT_DOCUMENT_DRAFT_BUSY'&&error.uncertain===(action==='prepareDraft'));
  f.bridge=async()=>undefined;const pending=f.client.runProductDocumentDraft(session,action,new AbortController().signal);await f.wait(()=>f.sent.length===3);f.advance(action==='prepareDraft'?120001:180001);
  await assert.rejects(pending,error=>error.code==='PRODUCT_DOCUMENT_ACK_MISSING'&&error.uncertain===(action==='prepareDraft'));
  assert.deepEqual(f.sent.map(message=>message.payload.action),['preview',action,action]);assert.equal(f.listeners.size,0);assert.equal(f.timers.size,0);
 }
});

test('native recovery accepts a delayed original reply after sixty seconds without dispatching a mutation or renewing packet TTL',async()=>{
 const f=await fixture();f.bridge=async()=>({...f.preview(),draftPreparationAvailable:true});const session=await f.session(),createdAt=session.packet.createdAt;
 f.bridge=async()=>undefined;
 const pending=f.client.runProductDocumentDraft(session,'recoverDraft',new AbortController().signal);await f.wait(()=>f.sent.length===2);
 assert.equal([...f.timers.values()][0].due-f.clock.now,180000);
 f.advance(90000);assert.equal(f.listeners.size,1);assert.equal(f.sent.length,2);
 f.emit(f.sent[1],draftState(f,'created',{recovered:true}));
 const result=await pending;assert.equal(result.state,'created');assert.equal(result.receipt,undefined);assert.equal(result.registered,false);
 assert.equal(session.packet.createdAt,createdAt);assert.deepEqual(f.sent.map(message=>message.payload.action),['preview','recoverDraft']);
 assert.equal(f.listeners.size,0);assert.equal(f.timers.size,0);assert.equal(f.calls.length,0);
});

test('saved-document target recovery requires its boolean capability and never inherits a general draft permission',async()=>{
 for(const available of [undefined,false]){const f=await fixture();f.bridge=async()=>({...f.preview(),draftPreparationAvailable:true,...(available===undefined?{}:{savedDraftTargetRecoveryAvailable:available})});const session=await f.session();
  await assert.rejects(f.client.runProductDocumentDraft(session,'recoverSavedDraftTarget',new AbortController().signal),error=>error.code==='PRODUCT_DOCUMENT_SAVED_TARGET_RECOVERY_UNAVAILABLE'&&!error.uncertain);assert.equal(f.sent.length,1);
 }
 for(const capability of ['true',null,1,true]){const f=await fixture();f.bridge=async()=>({...f.preview(),savedDraftTargetRecoveryAvailable:capability,...(capability===true?{}:{draftPreparationAvailable:true})});
  await assert.rejects(f.session(),error=>error.code==='PRODUCT_DOCUMENT_REPLY_IDENTITY');
 }
});

test('only a fully bound closed saved-document read exposes target recovery eligibility',async()=>{
 for(const mode of ['eligible','unrelated','no-capability','request','identity','packet','original-body','prepared-body','no-document','proof']){const f=await fixture();f.bridge=async()=>({...f.preview(),draftPreparationAvailable:true,...(mode==='no-capability'?{}:{savedDraftTargetRecoveryAvailable:true})});const session=await f.session();
  f.bridge=async()=>{const value=draftState(f,'update-requested',{docId:'2347603',needsRecovery:true,error:{code:mode==='unrelated'?'OWNED_RECORD_MISSING':'SAVED_DRAFT_TARGET_CLOSED',message:'원래 전용 검증 탭이 닫혔습니다.'}});
   if(mode==='request')value.requestId='different-request';if(mode==='identity')value.identityDigest='a'.repeat(64);if(mode==='packet')value.packetDigest='b'.repeat(64);
   if(mode==='original-body')value.originalBodySha256='c'.repeat(64);if(mode==='prepared-body')value.preparedBodySha256='d'.repeat(64);if(mode==='no-document')value.docId=null;if(mode==='proof')value.draftProof.consented=true;
   return value;
  };
  await assert.rejects(f.client.runProductDocumentDraft(session,'recoverDraft',new AbortController().signal),error=>{
   assert.equal(error.savedDraftTargetClosed,mode==='eligible');assert.equal(error.uncertain,false);
   if(['eligible','unrelated','no-capability'].includes(mode)){assert.equal(error.code,'PRODUCT_DOCUMENT_DRAFT_SOURCE_FAILURE');assert.equal(error.knownDocId,'2347603');}
   else assert.equal(error.code,'PRODUCT_DOCUMENT_DRAFT_REPLY_IDENTITY');return true;
  });assert.deepEqual(f.sent.map(row=>row.payload.action),['preview','recoverDraft']);assert.equal(f.calls.length,0);
 }
});

test('saved-document target recovery accepts only an independently read updated checkpoint and uses a read-only timeout',async()=>{
 const f=await fixture();f.bridge=async()=>({...f.preview(),draftPreparationAvailable:true,savedDraftTargetRecoveryAvailable:true});const session=await f.session();
 f.bridge=async()=>undefined;const pending=f.client.runProductDocumentDraft(session,'recoverSavedDraftTarget',new AbortController().signal);await f.wait(()=>f.sent.length===2);
 assert.equal([...f.timers.values()][0].due-f.clock.now,180000);f.advance(90000);assert.equal(f.listeners.size,1);assert.equal(f.sent.length,2);
 f.emit(f.sent[1],draftState(f,'updated',{docId:'2347603',recovered:true}));const recovered=await pending;
 assert.equal(recovered.state,'updated');assert.equal(recovered.docId,'2347603');assert.deepEqual(plain(recovered.draftProof.validatedSteps),[]);assert.equal(recovered.receipt,undefined);assert.equal(recovered.challenge,undefined);
 for(const mode of ['created','validated','missing-recovered','error']){f.bridge=async()=>draftState(f,['created','validated'].includes(mode)?mode:'updated',{docId:'2347603',...(mode==='missing-recovered'?{}:{recovered:true}),...(mode==='error'?{error:{code:'UNQUALIFIED',message:'미확인'}}:{})});
  await assert.rejects(f.client.runProductDocumentDraft(session,'recoverSavedDraftTarget',new AbortController().signal),error=>error.code==='PRODUCT_DOCUMENT_DRAFT_REPLY_IDENTITY'&&!error.uncertain);
 }
 f.bridge=async()=>undefined;const missing=f.client.runProductDocumentDraft(session,'recoverSavedDraftTarget',new AbortController().signal);await f.wait(()=>f.sent.length===7);f.advance(180001);
 await assert.rejects(missing,error=>error.code==='PRODUCT_DOCUMENT_ACK_MISSING'&&!error.uncertain&&!error.savedDraftTargetClosed);assert.equal(f.calls.length,0);assert.equal(f.listeners.size,0);assert.equal(f.timers.size,0);
});

test('same-document repair validates its new capability and only authenticated missing-record evidence enables approval',async()=>{
 const f=await fixture();f.bridge=async()=>({...f.preview(),draftPreparationAvailable:true});const older=await f.session();
 await assert.rejects(f.client.runProductDocumentDraft(older,'repairExistingDraft',new AbortController().signal),error=>error.code==='PRODUCT_DOCUMENT_REPAIR_UNAVAILABLE'&&!error.uncertain);
 assert.equal(f.sent.length,1);
 for(const capabilities of [{existingDocumentRepairAvailable:'true',draftPreparationAvailable:true},{existingDocumentRepairAvailable:true}]){
  f.bridge=async()=>({...f.preview(),...capabilities});await assert.rejects(f.session(),error=>error.code==='PRODUCT_DOCUMENT_REPLY_IDENTITY');
 }
 f.bridge=async()=>({...f.preview(),draftPreparationAvailable:true,preparedLifecycleAvailable:true,existingDocumentRepairAvailable:true});const session=await f.session();
 await assert.rejects(f.client.runProductDocumentDraft(session,'retryExistingDraftRepair',new AbortController().signal),error=>error.code==='PRODUCT_DOCUMENT_REPAIR_RETRY_UNAVAILABLE');
 const missing=()=>draftState(f,'update-requested',{docId:'2347603',needsRecovery:true,error:{code:'OWNED_RECORD_MISSING',message:'원래 문서 2347603 파일 저장 결과 미확인'}});
 f.bridge=async()=>missing();
 await assert.rejects(f.client.runPreparedProductDocument(session,'recoverPreparedDraft',new AbortController().signal),error=>error.code==='PRODUCT_DOCUMENT_DRAFT_SOURCE_FAILURE'&&error.existingDocumentRepairEligible===true&&error.knownDocId==='2347603'&&!error.existingDocumentRepairAttempted&&!error.uncertain);
 for(const change of [value=>value.error.code='SOURCE_CHANGED',value=>value.draftProof.existingDocumentRepairAttempted=true]){
  let attempted=false;f.bridge=async()=>{const value=missing();change(value);attempted=value.draftProof.existingDocumentRepairAttempted===true;return value;};await assert.rejects(f.client.runProductDocumentDraft(session,'recoverDraft',new AbortController().signal),error=>error.code==='PRODUCT_DOCUMENT_DRAFT_SOURCE_FAILURE'&&!error.existingDocumentRepairEligible&&error.existingDocumentRepairAttempted===attempted);
 }
 for(const change of [value=>value.identity.company=SINGLE_COMPANIES[1],value=>value.preparedBodySha256='0'.repeat(64),value=>value.draftProof.existingDocumentRepairAttempted=false]){
  f.bridge=async()=>{const value=missing();change(value);return value;};await assert.rejects(f.client.runProductDocumentDraft(session,'recoverDraft',new AbortController().signal),error=>error.code==='PRODUCT_DOCUMENT_DRAFT_REPLY_IDENTITY'&&!error.existingDocumentRepairEligible);
 }
 f.bridge=async()=>draftState(f,'updated',{docId:'2347603',recovered:true,draftProof:{...missing().draftProof,existingDocumentRepairAttempted:true}});
 const repaired=await f.client.runProductDocumentDraft(session,'repairExistingDraft',new AbortController().signal);assert.equal(repaired.docId,'2347603');assert.equal(repaired.state,'updated');assert.equal(repaired.draftProof.existingDocumentRepairAttempted,true);assert.equal(repaired.receipt,undefined);
 assert.equal(f.calls.length,0);assert.equal(f.sent.filter(row=>row.payload.action==='repairExistingDraft').length,1);
});

test('a fully bound failed draft recovery exposes its actual cause without treating it as a recovered state or retrying a write',async()=>{
 const f=await fixture();f.bridge=async()=>({...f.preview(),draftPreparationAvailable:true});const session=await f.session();
 f.bridge=async()=>draftState(f,'target-created',{docId:null,error:{code:'SOURCE_CHANGED',message:'현재 회원 연결을 다시 확인해주세요.'}});
 await assert.rejects(f.client.runProductDocumentDraft(session,'recoverDraft',new AbortController().signal),error=>error.code==='PRODUCT_DOCUMENT_DRAFT_SOURCE_FAILURE'&&!error.uncertain&&/target-created.*현재 회원 연결/.test(error.message));
 assert.deepEqual(f.sent.map(message=>message.payload.action),['preview','recoverDraft']);assert.equal(f.calls.length,0);
 f.bridge=async()=>draftState(f,'target-created',{docId:null,identity:{...f.context.identity,ownerId:'other'},error:{code:'SOURCE_CHANGED',message:'검증되지 않은 오류'}});
 await assert.rejects(f.client.runProductDocumentDraft(session,'recoverDraft',new AbortController().signal),error=>error.code==='PRODUCT_DOCUMENT_DRAFT_REPLY_IDENTITY'&&!/검증되지 않은 오류/.test(error.message));
});

test('a correlated negative scope result reports the source failure without exposing a recovered state or retransmitting',async()=>{
 const f=await fixture();f.bridge=async()=>({...f.preview(),draftPreparationAvailable:true});const session=await f.session();
 f.bridge=async()=>({format:f.review.format,requestId:f.packet.requestId,state:'scope-blocked',registered:false,success:false,needsRecovery:false,error:{code:'SOURCE_CHANGED',message:'현재 회원·회사·저장한 견적서를 확인해주세요.'}});
 await assert.rejects(f.client.runProductDocumentDraft(session,'recoverDraft',new AbortController().signal),error=>error.code==='SOURCE_CHANGED'&&!error.uncertain&&/현재 회원/.test(error.message));
 assert.deepEqual(f.sent.map(message=>message.payload.action),['preview','recoverDraft']);assert.equal(f.calls.length,0);
});

test('only a fully authenticated closed-target result exposes the separate connection approval',async()=>{
 const f=await fixture();f.bridge=async()=>({...f.preview(),draftPreparationAvailable:true});const session=await f.session();
 const result=()=>draftState(f,'create-requested',{docId:null,needsRecovery:true,error:{code:'CLOSED_TARGET_APPROVAL',message:'원래 검증 탭이 닫혔습니다.'},
  draftProof:{evidence:'document-draft-preparation',validatedSteps:[],checkpointSequence:12,observedAt:f.clock.now,submitted:false,consented:false,createRetryApproved:true}});
 f.bridge=async()=>result();
 await assert.rejects(f.client.runProductDocumentDraft(session,'recoverDraft',new AbortController().signal),error=>error.closedTargetRecovery===true&&error.approvedCreateRetry===true&&error.draftState==='create-requested');
 f.bridge=async()=>({...result(),identity:{...f.context.identity,ownerId:'other'}});
 await assert.rejects(f.client.runProductDocumentDraft(session,'recoverDraft',new AbortController().signal),error=>error.closedTargetRecovery===false&&error.code==='PRODUCT_DOCUMENT_DRAFT_REPLY_IDENTITY');
 assert.equal(f.calls.length,0);
});

for(const company of SINGLE_COMPANIES)test(company.name+' full preview binds all rows; production false gate emits no start and never scalar fallback',async()=>{
  const f=await fixture(company),session=await f.session();assert.equal(session.preview.members.length,2);assert.equal(session.packet.review.body.jsonDocument[1].productPage.modelNumber,'');assert.equal(Object.hasOwn(session.preview.identity,'optionId'),false);assert.equal(session.preview.packetDigest,f.context.packetDigest);
  assert.ok(Object.isFrozen(session.packet.review.body.jsonDocument[1]));await assert.rejects(f.client.runProductDocument(session,'start',new AbortController().signal),error=>error.code==='PRODUCT_DOCUMENT_LIVE_CONTRACT_UNVERIFIED'&&error.uncertain===false);
  assert.deepEqual(f.sent.map(message=>message.payload.action),['preview']);assert.equal(f.calls.length,0);cases.push({name:'full readonly preview '+company.code,members:2,scalarFallback:false,mutationMessages:0});
});

test('preview rejects changed membership, body, saved company and browser identity without exposing a session',async()=>{
  const changes=[value=>value.members.reverse(),value=>value.identity.members[1].optionId='other',value=>value.identity.company=SINGLE_COMPANIES[1],value=>value.identity.windowId=-1,value=>value.identityDigest='f'.repeat(64),value=>value.preparedBodySha256='f'.repeat(64),value=>value.reviewDigest='f'.repeat(64),value=>value.registered=true,value=>value.optionId='first'];
  for(const change of changes){const f=await fixture();f.bridge=async()=>{const value=f.preview();change(value);return value;};await assert.rejects(f.session(),error=>error.code==='PRODUCT_DOCUMENT_REPLY_IDENTITY');assert.equal(f.sent.length,1);}
  cases.push({name:'preview scope rejection',mutations:changes.length});
});

test('preview waits beyond the old 20-second timer for the bounded independent preflight, then exposes only its verified read-only session',async()=>{
  const f=await fixture();f.bridge=async()=>undefined;
  const pending=f.session();await f.wait(()=>f.sent.length===1);
  assert.equal([...f.timers.values()][0].due-f.clock.now,PRODUCT_DOCUMENT_PREVIEW_ACK_TIMEOUT);
  f.advance(25000);assert.equal(f.listeners.size,1);assert.equal(f.timers.size,1);f.emit(f.sent[0],f.preview());
  const session=await pending;assert.equal(session.preview.registered,false);assert.equal(session.preview.liveVerified,false);
  assert.equal(f.listeners.size,0);assert.equal(f.timers.size,0);assert.equal(f.sent.length,1);
  await assert.rejects(f.client.runProductDocument(session,'start',new AbortController().signal),error=>error.code==='PRODUCT_DOCUMENT_LIVE_CONTRACT_UNVERIFIED');
  assert.equal(f.sent.length,1);assert.equal(f.calls.length,0);
});

test('the bounded extension preflight timeout reaches the app before its ACK timer and never exposes a session',async()=>{
  const f=await fixture();f.bridge=async()=>undefined;
  const pending=f.session();await f.wait(()=>f.sent.length===1);f.advance(PRODUCT_DOCUMENT_PREFLIGHT_TIMEOUT);
  assert.ok(PRODUCT_DOCUMENT_PREVIEW_ACK_TIMEOUT>PRODUCT_DOCUMENT_PREFLIGHT_TIMEOUT);assert.equal(f.listeners.size,1);
  f.emit(f.sent[0],null,{ok:false,error:'원본 확인 시간이 초과됐습니다.',code:'PRODUCT_SOURCE_PREFLIGHT_TIMEOUT'});
  await assert.rejects(pending,error=>error.code==='PRODUCT_SOURCE_PREFLIGHT_TIMEOUT'&&error.uncertain===false);
  assert.equal(f.listeners.size,0);assert.equal(f.timers.size,0);assert.equal(f.sent.length,1);assert.equal(f.calls.length,0);
});

test('preview timeout or explicit cancellation removes listeners and ignores late positive ACKs without retry or mutation',async()=>{
  for(const mode of ['timeout','abort']){
    const f=await fixture(),controller=new AbortController();f.bridge=async()=>undefined;let succeeded=0;
    const pending=f.client.previewProductDocument(f.packet,controller.signal);pending.then(()=>{succeeded++;},()=>{});await f.wait(()=>f.sent.length===1);
    if(mode==='timeout')f.advance(PRODUCT_DOCUMENT_PREVIEW_ACK_TIMEOUT);else controller.abort();
    await assert.rejects(pending,error=>error.uncertain===false&&(mode==='abort'||error.code==='PRODUCT_DOCUMENT_ACK_MISSING'));
    assert.equal(f.listeners.size,0);assert.equal(f.timers.size,0);f.emit(f.sent[0],f.preview());
    await new Promise(resolve=>setImmediate(resolve));assert.equal(succeeded,0);assert.equal(f.sent.length,1);assert.equal(f.calls.length,0);
  }
});

test('synthetic enabled response validates complete staged terms and native statuses while never declaring SKU registration',async()=>{
  const f=await fixture(SINGLE_COMPANIES[0],{verified:true}),session=await f.session();f.bridge=async()=>f.state('awaiting-stage-consent',{challenge:f.challenge('productPage')});
  const stage=await f.client.runProductDocument(session,'start',new AbortController().signal);assert.match(stage.challenge.items[0].termsText,/마지막 문단/);assert.equal(stage.registered,false);
  for(const status of ['SUBMITTED','FINISHED','REJECTED']){f.bridge=async()=>f.observation(status);const result=await f.client.runProductDocument(session,'observe',new AbortController().signal);assert.equal(result.receipt.sourceStatus,status);assert.equal(result.registered,false);assert.equal(result.success,false);assert.equal(result.identity.members.length,2);}
  f.bridge=async()=>f.state('awaiting-consent',{challenge:f.challenge('logisticsPage')});assert.equal((await f.client.runProductDocument(session,'observe',new AbortController().signal)).challenge.items.length,0);
  cases.push({name:'stages and native receipts',testOnlyEnabled:true,receiptRecords:1,catalogRegistrationClaim:false});
});

test('every returned identity and receipt is checked; second member edits or scalar SKU cannot pass',async()=>{
  const changes=[value=>value.identity.members[1].optionLabel='changed',value=>value.identity.requestedProfileId=null,value=>value.preparedBodySha256='f'.repeat(64),value=>value.receipt.skuId='single-sku',value=>value.receipt.qvtRequestId='different',value=>value.registered=true,value=>value.state='registered',value=>value.identity.optionId='first'];
  for(const change of changes){const f=await fixture(SINGLE_COMPANIES[0],{verified:true}),session=await f.session();f.bridge=async()=>{const value=f.observation();change(value);return value;};await assert.rejects(f.client.runProductDocument(session,'observe',new AbortController().signal),error=>error.code==='PRODUCT_DOCUMENT_REPLY_IDENTITY'&&error.uncertain===false);assert.equal(f.sent.length,2);}
  const f=await fixture(SINGLE_COMPANIES[0],{verified:true}),session=await f.session(),changed=plain(session);changed.packet.review.members[1].optionId='other';await assert.rejects(f.client.runProductDocument(changed,'start',new AbortController().signal));assert.equal(f.sent.length,1);
});

test('lost ACK and abort retain uncertain original operation; bridge never retries or accepts another tab response',async()=>{
  const f=await fixture(SINGLE_COMPANIES[0],{verified:true}),session=await f.session();f.bridge=async()=>undefined;
  const start=f.client.runProductDocument(session,'start',new AbortController().signal);await f.wait(()=>f.sent.length===2);
  f.emit(f.sent[1],f.observation(),undefined,{origin:'https://other.test'});assert.equal(f.listeners.size,1);f.advance(60001);
  await assert.rejects(start,error=>error.code==='PRODUCT_DOCUMENT_ACK_MISSING'&&error.uncertain===true);assert.equal(f.sent.length,2);assert.equal(f.listeners.size,0);
  const controller=new AbortController(),recover=f.client.runProductDocument(session,'recover',controller.signal);await f.wait(()=>f.sent.length===3);controller.abort();await assert.rejects(recover,error=>error.uncertain===false);assert.equal(f.sent.length,3);assert.equal(f.listeners.size,0);cases.push({name:'unknown ACK',automaticRetries:0,mutatingUncertain:true,readonlyUncertain:false});
});

test('expired initial preview/start are blocked, exact observed request can still recover after initial TTL',async()=>{
  const f=await fixture(SINGLE_COMPANIES[0],{verified:true}),session=await f.session();f.advance(180000);await assert.rejects(f.session());await assert.rejects(f.client.runProductDocument(session,'start',new AbortController().signal));assert.equal(f.sent.length,1);
  f.bridge=async()=>f.state('created');assert.equal((await f.client.runProductDocument(session,'recover',new AbortController().signal)).state,'created');assert.equal(f.sent.length,2);
});

async function groupRecord(f,status='SUBMITTED'){return {...plain(await f.load('app/supplier-hub-product-receipt.ts').validateProductReceiptObservation(f.observation(status),f.review,origin,f.clock.now)),recordedAt:new Date(f.clock.now).toISOString()};}

for(const company of SINGLE_COMPANIES)test(company.name+' Single client saves refreshed rejected diagnostics with same timestamp and exact document identity',async()=>{
 const f=await fixture(company),record=await legacyRecord(f),packet=singlePacket(company);packet.accountContext=record.identity.accountContext;
 record.receipt.state='rejected';record.receipt.sourceStatus='REJECTED';record.receipt.rejectionDetails=normalizeRejectionDetails(JSON.stringify({errors:[{columnName:'무게',message:'처음 사유'}]}));
 const observation={format:packet.format,requestId:record.requestId,identity:record.identity,identityDigest:record.identityDigest,packetDigest:record.packetDigest,preparedBodySha256:record.preparedBodySha256,originalBodySha256:record.originalBodySha256,
  state:'rejected',docId:record.docId,registered:false,success:false,needsRecovery:false,receipt:plain(record.receipt)};
 const attempt={packet,profileId:packet.profileId,optionId:packet.optionId,observation},saved=plain(record);saved.receipt.rejectionDetails=normalizeRejectionDetails(JSON.stringify({errors:[{columnName:'크기',message:'갱신 사유'}]}));
 const calls=[],request=async(url,init)=>{calls.push({url,method:init?.method});return Response.json(String(url).includes('catalog-context')?f.actor:{receipt:saved});};
 const client=f.load('app/supplier-hub-single-client.ts'),value=await client.saveSingleReceiptObservation(attempt,new AbortController().signal,request);
 assert.equal(value.receipt.rejectionDetails.errors[0].columnName,'크기');assert.equal(value.docId,observation.docId);assert.equal(value.registered,false);assert.equal(calls.filter(row=>row.method==='POST').length,1);assert.equal(f.sent.length,0);
 saved.receipt.qvtRequestId='foreign';await assert.rejects(client.saveSingleReceiptObservation(attempt,new AbortController().signal,request));
});
async function legacyRecord(f){const packet=singlePacket(f.actor.company);packet.accountContext=digest(['sourceflow-managed-product-account-v1',packet.ownerId,packet.company.code,packet.company.name]);const context=await singleDocumentIdentity(packet,SINGLE_SENDER),state={format:packet.format,requestId:packet.requestId,identity:context.identity,identityDigest:context.identityDigest,packetDigest:context.packetDigest,originalBodySha256:context.originalBodySha256,preparedBodySha256:context.bodySha256,state:'pending',docId:'legacy-doc-728',registered:false,success:false,needsRecovery:false,
  receipt:{state:'pending',sourceStatus:'SUBMITTED',docId:'legacy-doc-728',company:f.actor.company,identityDigest:context.identityDigest,preparedBodySha256:context.bodySha256,observedAt:f.clock.now,receiptId:'legacy-qvt-728',qvtRequestId:'legacy-qvt-728',evidence:'document-receipt',registered:false}};
  return {...plain(await f.load('app/supplier-hub-single-receipt.ts').validateSingleReceiptObservation(state,packet,origin,f.clock.now)),recordedAt:new Date(f.clock.now).toISOString()};}

for(const company of SINGLE_COMPANIES)test(company.name+' mixed native history reads once per document with company before/after and queryless scope preserved',async()=>{
  const f=await fixture(company,{queryless:true});f.history=[await groupRecord(f),await legacyRecord(f)];const before=canonical(f.history),records=await f.client.readNativeReceiptHistory({productId:f.packet.review.identity.productId},new AbortController().signal,f.fetch);
  assert.equal(records.length,2);assert.equal(records[0].members.length,2);assert.equal(records[0].requestedProfileId,null);assert.equal(records[1].optionId,'synthetic-option');assert.equal(canonical(f.history),before);assert.ok(f.calls.every(call=>call.method==='GET'));assert.equal(f.calls.filter(call=>call.url.includes('product-receipt')).length,1);assert.equal(f.calls.some(call=>call.url.includes('?profileId=')),false);assert.equal(f.sent.length,0);
});

test('history rejects company change, foreign member, bad profile and malformed JSON without restoring any bridge session',async()=>{
  for(const kind of ['account-change','foreign-record','profile','malformed','redirect','html']){
    const options={beforeFetch:async(url,init,f)=>{if(kind==='account-change'&&String(url).includes('product-receipt'))f.actor={...f.actor,company:SINGLE_COMPANIES[1]};},historyResponse:undefined};
    if(kind==='malformed')options.historyResponse=()=>new Response('{',{headers:{'content-type':'application/json'}});
    if(kind==='redirect')options.historyResponse=()=>{const response=Response.json({});Object.defineProperty(response,'redirected',{value:true});return response;};
    if(kind==='html')options.historyResponse=()=>new Response('<html/>',{headers:{'content-type':'text/html'}});
    const f=await fixture(SINGLE_COMPANIES[0],options);f.history=[await groupRecord(f)];if(kind==='foreign-record')f.history[0].identity.ownerId='other-owner';
    await assert.rejects(f.client.readNativeReceiptHistory({productId:f.packet.review.identity.productId,...(kind==='profile'?{profileId:'other-profile'}:{})},new AbortController().signal,f.fetch));assert.equal(f.sent.length,0);assert.ok(f.calls.every(call=>call.method==='GET'));
  }
});

for(const company of SINGLE_COMPANIES)test(company.name+' product client permits newer rejection diagnostics for exact IDs, but rejects false success or malformed details',async()=>{
 const f=await fixture(company,{beforeSaveReply:async(record)=>{record.receipt.rejectionDetails=normalizeRejectionDetails(JSON.stringify({errors:[{columnName:'크기',message:'새로 확인한 사유'}]}));}});
 const observation=f.observation('REJECTED');observation.receipt.rejectionDetails=normalizeRejectionDetails(JSON.stringify({errors:[{columnName:'무게',message:'이전 사유'}]}));
 const attempt={packet:f.packet,observation},before=canonical(attempt),saved=await f.client.saveProductReceiptObservation(attempt,new AbortController().signal,f.fetch);
 assert.equal(saved.receipt.rejectionDetails.errors[0].columnName,'크기');assert.equal(saved.docId,observation.docId);assert.equal(saved.registered,false);assert.equal(canonical(attempt),before);assert.equal(f.sent.length,0);
 for(const mutate of [o=>o.receipt.rejectionDetails.errors[0].secret=true,o=>{o.state=o.receipt.state='accepted';o.receipt.sourceStatus='FINISHED';}]){
  const bad=plain(attempt);mutate(bad.observation);const posts=f.calls.filter(row=>row.method==='POST').length;await assert.rejects(f.client.saveProductReceiptObservation(bad,new AbortController().signal,f.fetch));assert.equal(f.calls.filter(row=>row.method==='POST').length,posts);
 }
});

for(const company of SINGLE_COMPANIES)test(company.name+' one immutable full-group observation saves once, explicit local retry preserves null query and never emits Hub action',async()=>{
  const f=await fixture(company,{queryless:true}),observation=f.observation(),attempt={packet:f.packet,observation},before=canonical(attempt),record=await f.client.saveProductReceiptObservation(attempt,new AbortController().signal,f.fetch);
  assert.equal(record.members.length,2);assert.equal(record.registered,false);assert.equal(record.receipt.qvtRequestId,'qvt-728');assert.equal(f.calls.filter(call=>call.method==='POST').length,1);assert.equal(f.calls.find(call=>call.method==='POST').body.profileId,null);assert.equal(f.sent.length,0);assert.equal(canonical(attempt),before);
  const retried=await f.client.saveProductReceiptObservation(attempt,new AbortController().signal,f.fetch);assert.equal(retried.requestId,record.requestId);assert.equal(retried.docId,record.docId);assert.equal(f.sent.length,0);assert.equal(f.calls.filter(call=>call.method==='POST').length,2);cases.push({name:'local save '+company.code,members:2,records:1,querylessPreserved:true,hubActions:0});
});

test('save rejects changed full body/member/company echo and keeps original receipt after missing local ACK',async()=>{
  for(const kind of ['member','receipt','account','lost-ack']){
    const f=await fixture(SINGLE_COMPANIES[0],{beforeSaveReply:async(record,fixture)=>{if(kind==='member')record.members[1].optionId='other';if(kind==='receipt')record.receipt.qvtRequestId='other';if(kind==='account')fixture.actor={...fixture.actor,company:SINGLE_COMPANIES[1]};if(kind==='lost-ack')throw Error('Synthetic local save response lost');}}),attempt={packet:f.packet,observation:f.observation()},before=canonical(attempt);
    await assert.rejects(f.client.saveProductReceiptObservation(attempt,new AbortController().signal,f.fetch));assert.equal(f.calls.filter(call=>call.method==='POST').length,1);assert.equal(f.sent.length,0);assert.equal(canonical(attempt),before);
  }
  const mismatched=await fixture(),observation=mismatched.observation();observation.requestId='other-original-request';await assert.rejects(mismatched.client.saveProductReceiptObservation({packet:mismatched.packet,observation},new AbortController().signal,mismatched.fetch));assert.equal(mismatched.calls.filter(call=>call.method==='POST').length,0);assert.equal(mismatched.sent.length,0);
});

test('terminal transport metadata is copied away before strict local receipt save; unknown extras and tampered facts still reject',async()=>{
  for(const metadata of [{duplicate:true},{recovered:true},{error:{code:'READBACK_FAILED',message:'이전 접수 증거를 유지한 조회 오류'}},{duplicate:false,recovered:true,error:{code:'CHECKPOINT_CONFLICT',message:'더 최신 보관 결과를 유지합니다.'}}]){
    const f=await fixture(SINGLE_COMPANIES[0],{verified:true}),session=await f.session();f.bridge=async()=>({...f.observation('FINISHED'),...metadata});
    const observation=await f.client.runProductDocument(session,'observe',new AbortController().signal),before=canonical(observation);
    const saved=await f.client.saveProductReceiptObservation({packet:f.packet,observation},new AbortController().signal,f.fetch);assert.equal(saved.receipt.state,'accepted');assert.equal(saved.members.length,2);assert.equal(saved.registered,false);
    const posts=f.calls.filter(call=>call.method==='POST');assert.equal(posts.length,1);assert.equal(Object.hasOwn(posts[0].body.observation,'duplicate'),false);assert.equal(Object.hasOwn(posts[0].body.observation,'recovered'),false);assert.equal(Object.hasOwn(posts[0].body.observation,'error'),false);assert.equal(canonical(observation),before);assert.equal(f.sent.length,2);
  }
  for(const patch of [value=>value.unknown='unsupported',value=>value.duplicate='true',value=>value.recovered='true',value=>value.error={code:'X',message:'diagnostic',unknown:true},value=>{value.recovered=true;value.receipt.qvtRequestId='tampered';}]){
    const f=await fixture(),observation=f.observation();patch(observation);await assert.rejects(f.client.saveProductReceiptObservation({packet:f.packet,observation},new AbortController().signal,f.fetch));assert.equal(f.calls.filter(call=>call.method==='POST').length,0);assert.equal(f.sent.length,0);
  }
});


function legalAuditReply(f){return{format:'yoofam-unexpected-legal-audit-v1',requestId:f.packet.requestId,docId:2347603,identityDigest:f.context.identityDigest,packetDigest:f.context.packetDigest,originalBodySha256:f.context.originalBodySha256,preparedBodySha256:f.context.bodySha256,sourcePlanSha256:f.context.identity.fingerprint,checkpointSequence:24,target:{tabId:90,windowId:f.context.identity.windowId},observedAt:f.clock.now,imageCount:4,legalCount:1,bodyMatchesExpected:true,schemaBindingComplete:false,rawBodySha256:'1'.repeat(64),normalizedBodySha256:f.context.bodySha256,fileSetSha256:'2'.repeat(64),byteSetSha256:'3'.repeat(64),legalSetSha256:'4'.repeat(64),legalEntries:[{index:0,kind:'certificate',descriptorSha256:'5'.repeat(64),association:'unknown',schemaIndex:null,pairedImageDescriptorMatch:false,expectedLabelReferences:0}],legalEntriesTruncated:false,differences:[],differenceCount:0,differencesTruncated:false,readOnly:true,remoteWrites:false,checkpointWrites:false,canResume:false,canDelete:false,registered:false,historicalAckRecovered:false};}
test('audit client requires its explicit capability and returns a frozen correlated read-only report without adopting draft state',async()=>{
 const f=await fixture(),old=await f.session();await assert.rejects(f.client.auditUnexpectedLegal(old,new AbortController().signal),error=>error.code==='UNEXPECTED_LEGAL_AUDIT_UNAVAILABLE'&&!error.uncertain);assert.equal(f.sent.length,1);
 f.bridge=async()=>({...f.preview(),draftPreparationAvailable:true,unexpectedLegalAuditAvailable:true});const session=await f.session(),before=plain(session);f.bridge=async payload=>{assert.equal(payload.action,'auditUnexpectedLegal');return legalAuditReply(f);};
 const report=await f.client.auditUnexpectedLegal(session,new AbortController().signal);assert.equal(report.docId,2347603);assert.equal(report.canResume,false);assert.equal(report.canDelete,false);assert.ok(Object.isFrozen(report));assert.ok(Object.isFrozen(report.legalEntries));assert.deepEqual(plain(session),before);assert.equal(f.calls.length,0);assert.equal(f.listeners.size,0);assert.equal(f.timers.size,0);assert.deepEqual(f.sent.map(row=>row.payload.action),['preview','preview','auditUnexpectedLegal']);
});
test('audit client accepts optional bounded leaf states and rejects raw values or malformed paths without granting mutation capabilities',async()=>{
 const f=await fixture();f.bridge=async()=>({...f.preview(),draftPreparationAvailable:true,unexpectedLegalAuditAvailable:true});const session=await f.session(),before=plain(session);
 const leaf={format:'yoofam-saved-body-leaf-differences-v1',visited:8,truncated:false,rows:[{path:['jsonDocument',0,'imagePage','agreeLabelContact'],expectedType:'boolean',actualType:'boolean',expectedValueKind:'present',actualValueKind:'present',expectedPrimitive:true,actualPrimitive:false}]};
 const report=()=>({...legalAuditReply(f),bodyMatchesExpected:false,normalizedBodySha256:'8'.repeat(64),differences:[{documentIndex:0,schemaIndex:null,path:'imagePage',expectedType:'object',actualType:'object',expectedValueKind:'not-applicable',actualValueKind:'not-applicable'}],differenceCount:1,bodyLeafDifferences:plain(leaf)});
 f.bridge=async()=>report();const read=await f.client.auditUnexpectedLegal(session,new AbortController().signal);
 assert.deepEqual(plain(read.bodyLeafDifferences),leaf);assert.ok(Object.isFrozen(read.bodyLeafDifferences.rows[0].path));assert.equal(read.canResume,false);assert.equal(read.canDelete,false);assert.equal(read.remoteWrites,false);assert.equal(read.checkpointWrites,false);
 for(const change of [value=>{value.format='unknown';},value=>{value.rows[0].actualValue='PRIVATE_ORIGINAL';},value=>{value.rows[0].path=['https://private.invalid/file.jpg'];},value=>{value.rows[0].path=['jsonDocument',0,'imagePage','fileName'];},value=>{value.rows[0].actualPrimitive='PRIVATE_VALUE';},value=>{value.rows=Array.from({length:81},()=>value.rows[0]);},value=>{value.visited=4097;}]){
  f.bridge=async()=>{const value=report();change(value.bodyLeafDifferences);return value;};
  await assert.rejects(f.client.auditUnexpectedLegal(session,new AbortController().signal),error=>error.code==='UNEXPECTED_LEGAL_AUDIT_REPLY'&&!error.uncertain&&!error.message.includes('PRIVATE'));
 }
 assert.deepEqual(plain(session),before);assert.equal(f.calls.length,0);assert.ok(f.sent.every(row=>['preview','auditUnexpectedLegal'].includes(row.payload.action)));assert.equal(f.listeners.size,0);assert.equal(f.timers.size,0);
});
test('audit client rejects cross-source or mutation-capable reports while retaining exact bounded bridge failure phase',async()=>{
 const f=await fixture();f.bridge=async()=>({...f.preview(),draftPreparationAvailable:true,unexpectedLegalAuditAvailable:true});const session=await f.session();
 for(const change of [report=>report.requestId='other-request',report=>report.packetDigest='9'.repeat(64),report=>report.canDelete=true,report=>report.checkpointWrites=true,report=>report.legalEntries[0].fileName='PRIVATE',report=>report.bodyMatchesExpected=false]){
  f.bridge=async()=>{const report=legalAuditReply(f);change(report);return report;};await assert.rejects(f.client.auditUnexpectedLegal(session,new AbortController().signal),error=>error.code==='UNEXPECTED_LEGAL_AUDIT_REPLY'&&!error.uncertain);
 }
 f.bridge=async()=>{throw Object.assign(Error('읽기 전용 감사를 중단했습니다. 단계: image-bytes / byte-sha.'),{code:'UNEXPECTED_LEGAL_AUDIT_READ'});};await assert.rejects(f.client.auditUnexpectedLegal(session,new AbortController().signal),error=>error.code==='UNEXPECTED_LEGAL_AUDIT_READ'&&error.message.includes('image-bytes / byte-sha')&&!error.uncertain);
 assert.equal(f.calls.length,0);assert.equal(f.listeners.size,0);assert.equal(f.timers.size,0);
});

test('audit preserves typed schema/execution phases but replaces unknown bridge exceptions with read-only failures',async()=>{
 const f=await fixture();f.bridge=async()=>({...f.preview(),draftPreparationAvailable:true,unexpectedLegalAuditAvailable:true});const session=await f.session(),before=plain(session);
 const message='읽기 전용 인증서 스키마 조회를 중단했습니다. 단계: legal-documents / http-503. 문서·파일·본문을 변경하지 않았습니다.';
 for(const code of ['UNEXPECTED_LEGAL_AUDIT_SCHEMA_READ','UNEXPECTED_LEGAL_AUDIT_SCHEMA_EXECUTION','UNEXPECTED_LEGAL_AUDIT_EXECUTION','UNEXPECTED_LEGAL_AUDIT_REPORT']){
  f.bridge=async()=>{throw Object.assign(Error(message),{code});};
  await assert.rejects(f.client.auditUnexpectedLegal(session,new AbortController().signal),error=>error.code===code&&error.message===message&&error.uncertain===false);
 }
 for(const code of ['ADAPTER_FAILURE',undefined,'PRIVATE_CODE_SHOULD_NOT_DISPLAY']){
  f.bridge=async()=>{throw Object.assign(Error('PRIVATE_RAW_BROWSER_FAILURE'),{code});};
  await assert.rejects(f.client.auditUnexpectedLegal(session,new AbortController().signal),error=>error.uncertain===false&&!error.message.includes('PRIVATE')&&error.code===(code==='ADAPTER_FAILURE'?code:code===undefined?'PRODUCT_DOCUMENT_BRIDGE':'UNEXPECTED_LEGAL_AUDIT_READ_FAILED'));
 }
 const hidden=f.client.unexpectedLegalAuditReadError(Error('PRIVATE_RUNTIME_EXCEPTION'));assert.equal(hidden.code,'UNEXPECTED_LEGAL_AUDIT_READ_FAILED');assert.doesNotMatch(hidden.message,/PRIVATE/);
 assert.deepEqual(plain(session),before);assert.equal(f.calls.length,0);assert.equal(f.listeners.size,0);assert.equal(f.timers.size,0);assert.ok(f.sent.every(row=>['preview','auditUnexpectedLegal'].includes(row.payload.action)));
});

test('audit keeps its original 180-second deadline and cancellation remains a single read without retry or uncertain mutation state',async()=>{
 for(const mode of ['timeout','abort']){
  const f=await fixture();f.bridge=async()=>({...f.preview(),draftPreparationAvailable:true,unexpectedLegalAuditAvailable:true});const session=await f.session(),before=plain(session),controller=new AbortController();f.bridge=async()=>undefined;
  const pending=f.client.auditUnexpectedLegal(session,controller.signal);await f.wait(()=>f.sent.length===2);
  assert.equal([...f.timers.values()][0].due-f.clock.now,180000);f.advance(90000);assert.equal(f.sent.length,2);assert.equal(f.listeners.size,1);
  if(mode==='abort')controller.abort();else f.advance(90001);
  await assert.rejects(pending,error=>error.uncertain===false&&error.code===(mode==='abort'?'UNEXPECTED_LEGAL_AUDIT_CANCELLED':'PRODUCT_DOCUMENT_ACK_MISSING')&&error.message.includes('읽기 전용')&&!error.message.includes('저장 결과를 조회'));
  f.advance(1000000);assert.deepEqual(f.sent.map(row=>row.payload.action),['preview','auditUnexpectedLegal']);assert.equal(f.listeners.size,0);assert.equal(f.timers.size,0);assert.equal(f.calls.length,0);assert.deepEqual(plain(session),before);
 }
});
