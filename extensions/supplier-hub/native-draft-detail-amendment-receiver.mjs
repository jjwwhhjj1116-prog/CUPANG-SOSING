import {amendmentCopy as copy,amendmentSame as same,amendmentDigest as digest,amendmentFail as fail,validateNativeDraftDetailAmendmentRequest,validateNativeDraftDetailAmendmentObservation,NATIVE_DRAFT_DETAIL_AMENDMENT_FORMAT as FORMAT} from './native-draft-detail-amendment.mjs';
import {validateNativeDraftDetailAmendmentDelta} from './native-draft-detail-amendment-delta.mjs';

/** No browser/global storage access here. Each actual dispatch has a durable
 * requested state first; all recovery paths are observations without writes. */
export function createNativeDraftDetailAmendmentReceiver({store,adapter,now=Date.now,validateDelta=validateNativeDraftDetailAmendmentDelta}){
 const counts=()=>({create:0,upload:0,update:0,validate:0,submit:0});
 const observation=(record,request,execution=counts(),extra={})=>validateNativeDraftDetailAmendmentObservation({format:FORMAT,amendmentId:request.amendmentId,anchor:record?.anchor??null,state:record?.state??'not-found',sequence:record?.sequence??0,observedAt:now(),previewDigest:record?.previewDigest??null,latest:record?.latest??record?.previewLatest??null,validatedSteps:record?.validatedSteps??[],needsRecovery:record?.needsRecovery??false,capabilities:{appendDetail:!!record},execution,readOnly:Object.values(execution).every(value=>value===0),registered:false,...extra},request);
 const save=async(record,change,checkpoint)=>{const next={...record,...copy(change),sequence:record.sequence+1,updatedAt:Math.max(now(),record.updatedAt)};if(!await store.compareAndSet(record,next,checkpoint))fail('DRAFT_DETAIL_AMENDMENT_CONFLICT');return next;};
 const exactRemote=(actual,expected)=>{if(!same(actual,expected))fail('DRAFT_DETAIL_AMENDMENT_REMOTE_CHANGED');};
 const prepare=async(record,request)=>{
  const next=await adapter.readNextSource(record,request.nextReview),delta=await validateDelta(record.parentSource,next.source);
  const remote=await adapter.readRemote(record);exactRemote(remote.remote,record.parentRemote.remote);
  const previewDigest=await digest({anchor:record.anchor,next:next.source,delta,remote:remote.remote});
  return{...next,delta,previewDigest};
 };
 async function run(input,sender){
  const request=validateNativeDraftDetailAmendmentRequest(input);await adapter.authenticate(request.anchor??request.lookup??request.packet.review.identity,sender);
  if(request.action==='begin'){
   const parent=await adapter.readParent(request,sender),existing=await store.read(parent.anchor,request.amendmentId);
   if(existing)return observation(existing,request);
   return observation(await store.begin(parent,request.amendmentId,request.packet),request);
  }
  let record=await store.read(request.anchor??request.lookup,request.amendmentId);
  if(!record){if(request.action==='inspect'&&request.lookup){await adapter.verifyMissingParent(request.lookup);return observation(null,request);}fail('DRAFT_DETAIL_AMENDMENT_NOT_FOUND');}
  const execution=counts();
  if(request.action==='inspect'){
   if(['editing','previewed'].includes(record.state)){const current=await adapter.readRemote(record);exactRemote(current.remote,record.parentRemote.remote);}
   return observation(record,request);
  }
  if(['review','confirm','observe'].includes(request.action)||request.action==='recover'&&record.latest){
   if(!record.latest||!['validated','submission','pending','accepted','rejected','registered'].includes(record.state)||record.needsRecovery&&!['recover','observe'].includes(request.action))fail('DRAFT_DETAIL_AMENDMENT_NOT_VALIDATED');
   const result=await adapter.lifecycle(record,request,sender),lifecycle=result.lifecycle;execution.submit=result.submitDispatched?1:0;
   const state=['pending','accepted','rejected','registered'].includes(lifecycle.state)?lifecycle.state:'submission';record=await save(record,{state,needsRecovery:lifecycle.needsRecovery===true});return observation(record,request,execution,{lifecycle});
  }
  if(request.action==='recover'){
   const recovered=await adapter.recover(record);
   // A GET may observe a body, but cannot manufacture a missing upload or
   // validation ACK. The adapter only advances positively recorded outcomes.
   if(recovered)record=await save(record,recovered);return observation(record,request);
  }
  if(request.action==='preview'){
   if(!['editing','previewed'].includes(record.state)||record.needsRecovery)fail('DRAFT_DETAIL_AMENDMENT_ALREADY_REQUESTED');
   const prepared=await prepare(record,request),context=prepared.context,review=prepared.packet.review,previewLatest={reviewDigest:review.reviewDigest,sourcePlanSha256:context.identity.fingerprint,originalBodySha256:context.originalBodySha256,preparedBodySha256:context.bodySha256,identityDigest:context.identityDigest,packetDigest:context.packetDigest};
   record=await save(record,{state:'previewed',previewDigest:prepared.previewDigest,previewLatest,nextPacket:prepared.packet,nextContext:context,nextSource:prepared.source,delta:prepared.delta});return observation(record,request);
  }
  if(record.needsRecovery||!['previewed','files-saved','updated','validated'].includes(record.state))fail('DRAFT_DETAIL_AMENDMENT_RECOVERY_REQUIRED');
  if(request.previewDigest!==record.previewDigest||!same(request.nextReview,record.nextPacket.review))fail('DRAFT_DETAIL_AMENDMENT_PREVIEW_CHANGED');
  await adapter.verifyNextSource(record);
  try{
   if(record.state==='previewed'){
    const remote=await adapter.readRemote(record);exactRemote(remote.remote,record.parentRemote.remote);
    const parts=await adapter.prepareDetailParts(record);await adapter.verifyNextSource(record);
    record=await save(record,{state:'upload-requested',needsRecovery:true,operationId:record.anchor.requestId+':amend:'+record.amendmentId+':assets:DETAIL'});
    execution.upload=parts.length?1:0;const result=await adapter.upload(record,parts);record=await save(record,{state:'files-saved',needsRecovery:false,uploadedRemote:result.remote,uploadEvidence:result.ledger});
   }
   if(record.state==='files-saved'){
    await adapter.verifyNextSource(record);const remote=await adapter.readRemote(record);exactRemote(remote.remote,record.uploadedRemote);
    record=await save(record,{state:'update-requested',needsRecovery:true,operationId:record.anchor.requestId+':amend:'+record.amendmentId+':update'});execution.update=1;
    const result=await adapter.update(record);await adapter.verifyUpdatedBody(record,result.remote.body);
    exactRemote(result.remote.images,record.uploadedRemote.images);exactRemote(result.remote.legal,record.uploadedRemote.legal);
    record=await save(record,{state:'updated',needsRecovery:false,updatedRemote:result.remote,updateEvidence:result.ledger});
   }
   while(record.validatedSteps.length<4&&['updated','validated'].includes(record.state)){
    const step=record.validatedSteps.length+2;await adapter.verifyNextSource(record);const remote=await adapter.readRemote(record);exactRemote(remote.remote,record.updatedRemote);
    record=await save(record,{state:'validation-requested',needsRecovery:true,requestedStep:step,operationId:record.anchor.requestId+':amend:'+record.amendmentId+':validate:'+step});execution.validate++;
    const result=await adapter.validate(record,step);await adapter.verifyUpdatedBody(record,result.remote.body);exactRemote(result.remote,record.updatedRemote);
    record=await save(record,{state:'updated',needsRecovery:false,validatedSteps:[...record.validatedSteps,step],validationEvidence:result.ledger});
   }
   if(record.validatedSteps.length===4&&!record.latest){
    const qualified=await adapter.qualifyLatest(record);record=await save(record,{state:'validated',latest:qualified.latest},qualified.checkpoint);
   }
  }catch(error){
   // An error after reservation retains that exact operation/UUID. No reset,
   // parent fallback or automatic second dispatch is possible.
   return observation(record,request,execution,{error:{code:error?.code??'DRAFT_DETAIL_AMENDMENT_UNCONFIRMED',message:'같은 문서의 수정 결과를 먼저 읽기로 확인해주세요.'}});
  }
  return observation(record,request,execution);
 }
 return Object.freeze({run});
}
