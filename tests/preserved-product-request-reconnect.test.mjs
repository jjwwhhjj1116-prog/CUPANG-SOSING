import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { webcrypto, createHash } from 'node:crypto';
import { createProductDocumentPacket } from '../extensions/supplier-hub/product-document.mjs';
import { productDocumentIdentity } from '../extensions/supplier-hub/product-document-receiver.mjs';
import * as inspectionParser from '../extensions/supplier-hub/preserved-product-checkpoint.mjs';
import { singlePacket, SINGLE_SENDER } from './helpers/supplier-hub-single-document.mjs';

const copy=value=>structuredClone(value),canon=value=>value===null||typeof value!=='object'?JSON.stringify(value):Array.isArray(value)?'['+value.map(canon).join(',')+']':'{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canon(value[key])).join(',')+'}';
const digest=value=>createHash('sha256').update(canon(value)).digest('hex');
function compile(file,dependencies={},globals={}){
 const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../'+file,import.meta.url),'utf8'),{fileName:file,compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,
  {exports,Error,Date,TextEncoder,TextDecoder,crypto:webcrypto,Object,AbortController,...globals,require:name=>{if(Object.hasOwn(dependencies,name))return dependencies[name];throw Error('Forbidden dependency '+name);}});return exports;
}
async function fixture(){
 const single=singlePacket(),body=copy(single.body),identity={ownerId:single.ownerId,company:copy(single.company),productId:'e2f8037c-294e-45a8-b06d-58cc5909683c',profileId:single.profileId,requestedProfileId:single.profileId,
  categoryId:single.categoryId,fingerprint:single.fingerprint,inputFingerprint:'d'.repeat(64),schemaSha256:single.schemaSha256,source:{...single.source,profileId:single.profileId}};
 const review={format:'yoofam-supplier-hub-product-document-v1',type:'YOOFAM_PRODUCT_DOCUMENT_REVIEW',identity,members:[{optionId:single.optionId,optionLabel:'원래 옵션',documentIndex:0}],body,registered:false,remoteWrites:false,submissionReady:false};
 const deferred=copy(body);for(const document of deferred.jsonDocument)for(const key of ['msrpAgree','labelContactAgreed'])document.imagePage[key]=false;
 review.originalBodySha256=digest(body);review.preparedBodySha256=digest(deferred);review.reviewDigest=digest({format:review.format,type:review.type,identity,members:review.members,originalBodySha256:review.originalBodySha256,preparedBodySha256:review.preparedBodySha256});
 const target={requestId:'f29491bd-1882-456a-8a63-eec8586db6c6',productId:identity.productId,docId:2347603,company:copy(identity.company)},packet=await createProductDocumentPacket(review,{requestId:target.requestId});
 const context=await productDocumentIdentity(packet,SINGLE_SENDER),data=new Map(),writes=[],actions=[],inspections=[],refreshes=[],locks=[],controller=new AbortController();let tail=Promise.resolve();
 const f={review,target,context,data,writes,actions,inspections,refreshes,locks,controller,alive:true,latest:copy(review),beforeInspect:null,beforePreview:null,beforeRecover:null,beforeRefresh:null,beforeLock:null,onWrite:null,previewPatch:null,observationPatch:null};
 const win={location:{origin:context.identity.origin},localStorage:{getItem:key=>data.get(key)??null,setItem(key,value){writes.push(['set',key]);data.set(key,value);f.onWrite?.();},removeItem(key){writes.push(['remove',key]);data.delete(key);}},navigator:{locks:{request(key,options,run){locks.push(key);const result=tail.then(async()=>{if(options.signal.aborted)throw Error('aborted lock');await f.beforeLock?.();return run();});tail=result.catch(()=>{});return result;}}}};
 const pending=compile('app/supplier-hub-product-pending.ts',{}, {window:win});
 const document=compile('app/supplier-hub-product-document.ts',{'@/app/supplier-hub-single-client':{},'@/app/supplier-hub-company':{}});
 f.checkpoint={state:'updated',sequence:12,updatedAt:Date.now()-1000,requestId:target.requestId,docId:target.docId,identityDigest:context.identityDigest,packetDigest:context.packetDigest,
  originalBodySha256:review.originalBodySha256,preparedBodySha256:review.preparedBodySha256,sourcePlanSha256:identity.fingerprint,profileId:identity.profileId,categoryId:identity.categoryId,
  source:copy(context.identity.source),membersCount:1,validatedSteps:[],draftOnly:true,preparedLifecycle:false,operationId:target.requestId+':update',requestedStep:null,submitRequestedAt:null,
  savedAppTabId:context.identity.appTabId,savedWindowId:context.identity.windowId,savedHubTabId:71,laneMatched:true,durableBodyAvailable:false,durableSourcePlanAvailable:false};
 f.report=()=>({format:'yoofam-preserved-product-checkpoint-inspection-v1',target:copy(target),status:'found',found:true,scanned:1,complete:true,readOnly:true,remoteWrites:false,checkpointWrites:false,registered:false,canResume:false,
  checkpoint:copy(f.checkpoint),diagnostic:{code:'found',message:'기존 요청의 보관 기록을 읽었습니다. 본문·파일을 복원하거나 전송하지 않았습니다. 계속 실행할 수 있는 원본 문맥은 아직 확인하지 않았습니다.'},pendingDiagnostic:{status:'absent',requestId:null,createdAt:null,sameRequest:null,message:'absent'}});
 const inspect={inspectPreservedProductRequest:async(selected,ownerId,signal)=>{inspections.push({target:copy(selected),ownerId});assert.equal(signal,controller.signal);await f.beforeInspect?.(inspections.length);return f.report();}};
 f.session=async next=>{
  const c=await productDocumentIdentity(next,SINGLE_SENDER);return {packet:next,preview:{format:review.format,requestId:next.requestId,identity:copy(c.identity),identityDigest:c.identityDigest,packetDigest:c.packetDigest,
   productId:identity.productId,fingerprint:identity.fingerprint,members:copy(review.members),reviewDigest:review.reviewDigest,preparedBodySha256:review.preparedBodySha256,originalBodySha256:review.originalBodySha256,
   liveVerified:false,draftPreparationAvailable:true,preparedLifecycleAvailable:true,remoteWrites:false,registered:false,...copy(f.previewPatch??{})},packetDigest:c.packetDigest,origin:context.identity.origin};
 };
 const client={previewProductDocument:async(next,signal)=>{actions.push('preview');assert.equal(signal,controller.signal);await f.beforePreview?.();return f.session(next);},
  runProductDocumentDraft:async(session,action,signal)=>{actions.push(action);assert.equal(action,'recoverDraft');assert.equal(signal,controller.signal);await f.beforeRecover?.();const c=f.checkpoint,promoted=c.state==='updated'&&c.validatedSteps.length===4;
   return {format:review.format,requestId:target.requestId,identity:copy(session.preview.identity),identityDigest:session.preview.identityDigest,packetDigest:session.packetDigest,
    originalBodySha256:review.originalBodySha256,preparedBodySha256:review.preparedBodySha256,state:promoted?'validated':c.state,docId:c.docId,registered:false,success:false,needsRecovery:false,recovered:true,draftOnly:true,
    draftProof:{evidence:'document-draft-preparation',validatedSteps:copy(c.validatedSteps),checkpointSequence:c.sequence+(promoted?1:0),observedAt:promoted?Date.now():c.updatedAt,submitted:false,consented:false},...copy(f.observationPatch??{})};}};
 const helpers=compile('app/preserved-product-request-reconnect.ts',{'@/app/preserved-product-request-client':inspect,'@/app/supplier-hub-product-document':document,'@/app/supplier-hub-product-client':client,
  '@/app/supplier-hub-product-pending':pending,'../extensions/supplier-hub/product-document.mjs':{createProductDocumentPacket},'../extensions/supplier-hub/preserved-product-checkpoint.mjs':inspectionParser});
 f.pending=pending;f.key=pending.productDocumentPendingKey(review);f.run=()=>helpers.reconnectPreservedProductDraft({review,target,signal:controller.signal,isCurrent:()=>f.alive,refresh:async signal=>{assert.equal(signal,controller.signal);refreshes.push('current server review');await f.beforeRefresh?.(refreshes.length);return copy(f.latest);}});
 f.seed=(patch={})=>{const value={format:'yoofam-product-document-pending-v1',origin:context.identity.origin,ownerId:identity.ownerId,companyCode:identity.company.code,companyName:identity.company.name,
  productId:identity.productId,requestId:target.requestId,createdAt:Date.now()-10000,reviewDigest:review.reviewDigest,originalBodySha256:review.originalBodySha256,preparedBodySha256:review.preparedBodySha256,
  identityDigest:context.identityDigest,appTabId:context.identity.appTabId,windowId:context.identity.windowId,...patch};data.set(f.key,JSON.stringify(value));return value;};
 return f;
}

test('reconnection requires native preview and read recovery before claiming only the exact original web reservation',async()=>{
 const f=await fixture(),before=copy(f.review),result=await f.run();
 assert.deepEqual(f.actions,['preview','recoverDraft']);assert.equal(f.inspections.length,2);assert.ok(f.inspections.every(item=>item.target.requestId===f.target.requestId));
 assert.equal(result.session.packet.requestId,f.target.requestId);assert.equal(result.observation.docId,2347603);assert.equal(result.observation.state,'updated');assert.equal(result.pending.requestId,f.target.requestId);
 assert.equal(result.session.preview.liveVerified,false);assert.equal(f.data.size,1);assert.equal(f.writes.length,1);assert.equal(f.writes[0][0],'set');assert.equal(f.locks.length,1);assert.deepEqual(f.review,before);
 assert.doesNotThrow(()=>f.pending.assertProductDocumentPending(f.review,result.pending,result.session));
 assert.doesNotMatch([...f.data.values()][0],/jsonDocument|imageUrl|approvedKeys|password/);
});

test('an already validated draft and read-only updated-to-validated checkpoint promotion are accepted without validation dispatch',async()=>{
 for(const state of ['updated','validated']){const f=await fixture();f.checkpoint.state=state;f.checkpoint.validatedSteps=[2,3,4,5];const result=await f.run();assert.equal(result.observation.state,'validated');assert.deepEqual(f.actions,['preview','recoverDraft']);assert.equal(f.writes.length,1);}
});

test('existing exact, different, corrupt or rejected web reservations never get overwritten',async()=>{
 for(const kind of ['same','different','corrupt','rejected']){
  const f=await fixture();if(kind==='corrupt')f.data.set(f.key,'{broken');else if(kind==='rejected')f.data.set(f.pending.productDocumentRejectionKey(f.review),'{broken');else f.seed(kind==='different'?{requestId:'00000000-0000-4000-8000-000000000734'}:{});
  const before=[...f.data.entries()];await assert.rejects(f.run());assert.deepEqual([...f.data.entries()],before);assert.equal(f.writes.length,0);assert.equal(f.actions.length,0);assert.equal(f.inspections.length,0);
 }
});

test('unsupported inspection, missing/ambiguous checkpoint and non-saved modes cannot preview or reserve',async()=>{
 for(const kind of ['unsupported','not-found','ambiguous','created','update-requested','validation-requested','lifecycle','submit','other-doc','other-request']){
  const f=await fixture();
  if(kind==='unsupported')f.beforeInspect=()=>{throw Error('현재 Chrome 확장 2.1.59은 원래 전송 기록 조회를 지원하지 않습니다.');};
  else if(kind==='not-found'||kind==='ambiguous'){const report=f.report;f.report=()=>({...report(),status:kind,found:kind==='ambiguous',checkpoint:null,diagnostic:{code:kind,message:kind==='not-found'?'이 확장 보관함에서 같은 회원·회사·상품의 요청을 찾지 못했습니다. 새 요청을 만들지 않았습니다.':'같은 범위의 요청번호에 여러 기록이 있습니다. 하나를 임의로 선택하지 않았습니다.'}});}
  else if(kind==='lifecycle')f.checkpoint.preparedLifecycle=true;
  else if(kind==='submit')f.checkpoint.submitRequestedAt=f.checkpoint.updatedAt;
  else if(kind==='other-doc')f.checkpoint.docId=2347604;
  else if(kind==='other-request')f.checkpoint.requestId='00000000-0000-4000-8000-000000000734';
  else f.checkpoint.state=kind;
  await assert.rejects(f.run());assert.equal(f.actions.length,0);assert.equal(f.writes.length,0);assert.equal(f.data.size,0);
 }
});

test('every checkpoint/preview source, member, body, identity and packet mismatch blocks recovery and claiming',async()=>{
 const changes=[f=>f.checkpoint.source.contentRevision++,f=>f.checkpoint.membersCount++,f=>f.checkpoint.profileId='other-profile',f=>f.checkpoint.categoryId='123',
  f=>f.checkpoint.identityDigest='f'.repeat(64),f=>f.checkpoint.packetDigest='f'.repeat(64),f=>f.checkpoint.originalBodySha256='f'.repeat(64),f=>f.checkpoint.preparedBodySha256='f'.repeat(64),
  f=>f.checkpoint.sourcePlanSha256='f'.repeat(64),f=>f.checkpoint.savedAppTabId++,f=>f.checkpoint.savedWindowId++,f=>f.previewPatch={draftPreparationAvailable:false}];
 for(const change of changes){const f=await fixture();change(f);await assert.rejects(f.run());assert.deepEqual(f.actions,['preview']);assert.equal(f.inspections.length,1);assert.equal(f.writes.length,0);}
});

test('the second inspection must retain exact checkpoint sequence, state, time and original source evidence',async()=>{
 for(const change of [f=>f.checkpoint.sequence++,f=>f.checkpoint.updatedAt++,f=>f.checkpoint.savedHubTabId++,f=>f.checkpoint.validatedSteps=[2],f=>f.checkpoint.source.optionRevision++,f=>f.checkpoint.preparedLifecycle=true]){
  const f=await fixture();f.beforeInspect=index=>{if(index===2)change(f);};await assert.rejects(f.run());assert.deepEqual(f.actions,['preview']);assert.equal(f.writes.length,0);
 }
});

test('readback uncertainty, wrong doc/body/state, consent or changed sequence never authorizes a reservation',async()=>{
 for(const patch of [{needsRecovery:true},{error:{code:'READ_FAILED',message:'failed'}},{docId:2347604},{requestId:'00000000-0000-4000-8000-000000000734'},{state:'created'},
  {preparedLifecycle:true},{recovered:false},{success:true},{registered:true},{preparedBodySha256:'f'.repeat(64)},{receipt:{}},{challenge:{}},
  {draftProof:{evidence:'document-draft-preparation',validatedSteps:[],checkpointSequence:13,observedAt:Date.now(),submitted:false,consented:false}}]){
  const f=await fixture();f.observationPatch=patch;await assert.rejects(f.run());assert.deepEqual(f.actions,['preview','recoverDraft']);assert.equal(f.writes.length,0);
 }
});

test('cancellation, account/source changes and epoch ABA are checked at every asynchronous boundary',async()=>{
 for(const point of ['initial','inspection','preview','second-inspection','readback','lock']){
  const f=await fixture(),stop=()=>{f.alive=false;};
  if(point==='initial')stop();else if(point==='inspection')f.beforeInspect=stop;else if(point==='preview')f.beforePreview=stop;else if(point==='second-inspection')f.beforeInspect=index=>{if(index===2)stop();};else if(point==='readback')f.beforeRecover=stop;else f.beforeLock=stop;
  await assert.rejects(f.run());assert.equal(f.writes.length,0);assert.equal(f.data.size,0);
 }
 for(const change of [f=>f.latest.identity.ownerId='other-member',f=>f.latest.identity.company={code:'A01464742',name:'와이홉'},f=>f.latest.body.productName='edited',f=>f.latest.identity.source.quotationRevision++,f=>f.review.members[0].optionLabel='mutated']){
  const f=await fixture();f.beforePreview=()=>change(f);await assert.rejects(f.run());assert.deepEqual(f.actions,['preview']);assert.equal(f.writes.length,0);
 }
 const f=await fixture();f.beforeRecover=()=>f.controller.abort();await assert.rejects(f.run());assert.equal(f.writes.length,0);
});

test('a pending that appears while waiting for Web Locks is preserved instead of claimed or removed',async()=>{
 const f=await fixture();let competing;f.beforeLock=()=>{competing=f.seed({requestId:'00000000-0000-4000-8000-000000000734'});};
 await assert.rejects(f.run(),/이미 보관/);assert.equal(f.writes.length,0);assert.equal(f.data.get(f.key),JSON.stringify(competing));assert.deepEqual(f.actions,['preview','recoverDraft']);
});

test('cancellation or source change after the local claim leaves only the exact original reservation',async()=>{
 for(const kind of ['abort','changed-source']){const f=await fixture();f.onWrite=()=>{if(kind==='abort')f.controller.abort();else f.latest.identity.source.contentRevision++;};await assert.rejects(f.run());
  assert.equal(f.writes.length,1);assert.equal(f.writes[0][0],'set');assert.equal(f.data.size,1);assert.equal(f.pending.readProductDocumentPending(f.review).requestId,f.target.requestId);assert.deepEqual(f.actions,['preview','recoverDraft']);}
});
