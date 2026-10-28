import {readAppDocumentSource,currentSourceAppTab} from './product-document-source.mjs';
import {nativeAssetUploadPlanSha256,validateNativeAssetUploadDescriptors} from './native-asset-multipart.mjs';
import {nativeAssetRecoveryPage,decodeNativeAssetRecoveryResult,nativeAssetRecoveryErrorCode} from './native-asset-recovery-page.mjs';
import {singleDocumentOwnedRecordPage,decodeSingleOwnedRecordResult} from './single-document-adapter.mjs';
import {assertSingleOwnedTarget} from './single-owned-target.mjs';
import {SingleDocumentError} from './single-document.mjs';
const canon=value=>value===null||typeof value!=='object'?JSON.stringify(value):Array.isArray(value)?'['+value.map(canon).join(',')+']':'{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canon(value[key])).join(',')+'}';
const copy=value=>structuredClone(value),same=(a,b)=>canon(a)===canon(b);
const digest=async value=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(canon(value)))),byte=>byte.toString(16).padStart(2,'0')).join('');
const fail=(phase='scope',fields=[])=>{throw new SingleDocumentError('NATIVE_ASSET_RECOVERY_UNCONFIRMED','원래 새 문서·회원·원본 파일의 업로드 결과를 읽기로 확인하지 못했습니다. 미확정 요청을 유지했습니다. 확인 단계: '+phase+(fields.length?' · 항목: '+fields.join(', '):''));};
// Report only known page errors. Chrome may return a page exception in the
// execution result or reject the promise; never disclose arbitrary text.
const pageErrorLabel=error=>{
 const known=new Map([
  ['원본 파일 조회 자료가 너무 큽니다.','input-too-large'],
  ['이 요청의 원본 업로드 목록을 읽기로 확인하지 못했습니다. 미확정 상태를 유지했습니다.','page-guard'],
  ['조회 중 원래 업로드 요청 기록이 변경됐습니다. 미확정 상태를 유지했습니다.','record-changed'],
  ['원래 새 문서의 완료된 파일 업로드 기록이 없습니다.','missing-upload-record'],
  ['보관된 원본 파일명·길이·SHA가 현재 원본 계획과 다릅니다.','source-file-mismatch'],
  ['원래 문서의 파일 목록 배열을 확인하지 못했습니다.','file-list'],
  ['현재 파일 목록이 원래 확인한 업로드 응답과 다릅니다.','file-list-mismatch'],
  ['요청하지 않은 파일이 원래 새 문서에 있어 미확정 상태를 유지했습니다.','unexpected-file']
 ]);
 const message=typeof error==='string'?error:typeof error?.message==='string'?error.message:'';return known.get(message)||'unrecognized';
};

/** Add a diagnostic read to an existing recover operation. A positive file
 * list is intentionally not an update ACK: no ledger checkpoint is promoted,
 * no multipart request is repeated and the receiver remains update-requested. */
export function withNativeProductAssetRecovery(adapter,{api,nativeSha,now=Date.now,sourceAppTabId}){
 const sources=new Map();
 const readSource=async input=>{const result=await adapter.readSource(input);if(result?.current===true&&input?.identity?.fingerprint===nativeSha)sources.set(canon(input.identity),{input:copy(input),sessionId:result.sessionId});else sources.delete(canon(input.identity));return result;};
 const inspectNativeAssets=async input=>{
  const source=sources.get(canon(input?.identity));
  if(!source||input.operation!=='update'||input.requestId!==source.input.requestId||input.operationId!==source.input.requestId+':update'
   ||input.identityDigest!==await digest(input.identity)||input.identity.fingerprint!==nativeSha||!same(input.expectedBody?.docId,input.docId))fail('request-scope');
  const reviewed=copy(input.expectedBody);reviewed.docId=null;if(await digest(reviewed)!==source.input.preparedBodySha256)fail('review-body');
  const current=async()=>{
   if(typeof adapter.readNativeSourceSnapshot==='function'){
    const fresh=await adapter.readNativeSourceSnapshot(source.input),proof=fresh?.proof,plan=fresh?.sourcePlan;
    if(proof?.current!==true||proof.sessionId!==source.sessionId||!same(proof.identity,input.identity)||proof.bodySha256!==source.input.bodySha256)fail('source-session');
    if(plan?.sourcePlanSha256!==nativeSha||plan.identity?.ownerId!==input.identity.ownerId||plan.identity?.productId!==input.identity.productId||!same(plan.identity?.company,input.identity.company)
     ||plan.originalBodySha256!==source.input.bodySha256||plan.preparedBodySha256!==source.input.preparedBodySha256)fail('source-plan');
    return plan;
   }
   const proof=await adapter.readSource(source.input);if(proof?.current!==true||proof.sessionId!==source.sessionId)fail('source-session');
   await currentSourceAppTab(api,input.identity,sourceAppTabId);
   const execution={frameId:0,result:await readAppDocumentSource(api,input.identity,source.input,'native',sourceAppTabId)};
   await currentSourceAppTab(api,input.identity,sourceAppTabId);
   if(execution?.frameId!==0||execution?.result?.current!==true||execution.result.sourcePlan?.sourcePlanSha256!==nativeSha||!same(execution.result.identity,input.identity)
    ||execution.result.bodySha256!==source.input.bodySha256||execution.result.preparedBodySha256!==source.input.preparedBodySha256)fail('source-plan');return execution.result.sourcePlan;
  };
  const sourcePlan=await current(),binding={identity:copy(input.identity),identityDigest:input.identityDigest,packetDigest:source.input.packetDigest,
   preparedBodySha256:source.input.preparedBodySha256,originalBodySha256:source.input.bodySha256,sessionId:source.sessionId,requestId:source.input.requestId,nativeAssetSourcePlanSha256:nativeSha};
  assertSingleOwnedTarget(input.tab,binding);
  const tabCurrent=async()=>{const tab=await api.tabs.get(input.tab.tabId),url=new URL(tab.url);if(tab.id!==input.tab.tabId||tab.windowId!==input.identity.windowId||tab.pendingUrl||tab.status!=='complete'
   ||url.origin!=='https://supplier.coupang.com'||url.pathname!=='/dashboard/KR'||url.username||url.password||url.search||url.hash)fail('owned-tab');};
  await tabCurrent();
  const [before]=await api.scripting.executeScript({target:{tabId:input.tab.tabId,frameIds:[0]},func:singleDocumentOwnedRecordPage,args:[JSON.stringify(binding)]});
  const record=decodeSingleOwnedRecordResult(before?.result),recordIssues=[];
  if(before?.frameId!==0)recordIssues.push('frame');if(typeof before?.documentId!=='string')recordIssues.push('document-id');if(!record)recordIssues.push('record');
  if(record){
   if(!same(record.binding,binding))recordIssues.push('binding',...Object.keys(binding).filter(key=>!same(record.binding?.[key]??null,binding[key]??null)).map(key=>'binding.'+key));
   if(!same(record.docId,input.docId))recordIssues.push('doc-id');if(record.state!=='created')recordIssues.push('state');if(record.updateOperationId!==undefined)recordIssues.push('update-requested');
   if(!same(record.baselineDocIds,input.baselineDocIds))recordIssues.push('baseline');if(record.baselineDocIds?.some(id=>String(id)===String(input.docId)))recordIssues.push('baseline-contains-document');
  }
  if(recordIssues.length)fail('record-before',recordIssues);
  const target={docId:record.docId,requestId:binding.requestId,packetDigest:binding.packetDigest,preparedBodySha256:binding.preparedBodySha256,
   createOperationId:record.createOperationId,baselineDocIds:copy(record.baselineDocIds)};
  const plan={format:'yoofam-native-asset-upload-plan-v1',identity:copy(sourcePlan.identity),identityDigest:sourcePlan.identityDigest,target,
   images:copy(sourcePlan.images),nativeLegalAttachmentPlan:sourcePlan.nativeLegalAttachmentPlan?copy(sourcePlan.nativeLegalAttachmentPlan):null,planSha256:null,
   registered:false,remoteWrites:false,submissionReady:false,transportReady:false};
  plan.planSha256=await nativeAssetUploadPlanSha256(plan);
  await tabCurrent();let readback;try{[readback]=await api.scripting.executeScript({target:{tabId:input.tab.tabId,documentIds:[before.documentId]},func:nativeAssetRecoveryPage,args:[JSON.stringify({binding,target,plan})]});}
  catch(error){fail('observation-execution',['rejected',pageErrorLabel(error)]);}
  await tabCurrent();if(readback?.error!==undefined&&readback.error!==null)fail('observation-execution',['page-error',pageErrorLabel(readback.error)]);
  if(readback?.frameId!==0||readback.documentId!==before.documentId)fail('observation-frame');
  const [after]=await api.scripting.executeScript({target:{tabId:input.tab.tabId,documentIds:[before.documentId]},func:singleDocumentOwnedRecordPage,args:[JSON.stringify(binding)]});
  if(after?.frameId!==0||after.documentId!==before.documentId)fail('record-after-frame');
  if(!same(decodeSingleOwnedRecordResult(after.result),record))fail('record-after');if(!same(await current(),sourcePlan))fail('source-after');
  const observation=decodeNativeAssetRecoveryResult(readback.result);
  if(!observation){const value=readback.result,type=value===null?'null':Array.isArray(value)?'array':typeof value;fail('observation-json',['type-'+type,...(typeof value==='string'?['length-'+value.length]:[])]);}
  const pageError=nativeAssetRecoveryErrorCode(observation);if(pageError)fail('observation-page',[pageError.stage,pageError.code]);
  const keys=['format','requestId','docId','packetDigest','identityDigest','sourcePlanSha256','planSha256','groups','observedAt','readOnly','ledgerMutated','unresolved','canContinue','remoteWrites','actualUploadVerified','remoteBytesVerified','registered'];
  if(!observation||Object.keys(observation).length!==keys.length||Object.keys(observation).some(key=>!keys.includes(key))||observation.format!=='yoofam-native-asset-recovery-observation-v1'||observation.requestId!==binding.requestId||!same(observation.docId,target.docId)
   ||observation.packetDigest!==binding.packetDigest||observation.identityDigest!==binding.identityDigest||observation.sourcePlanSha256!==nativeSha||observation.planSha256!==plan.planSha256
   ||!Array.isArray(observation.groups)||observation.groups.length>11||!Number.isSafeInteger(observation.observedAt)||Math.abs(now()-observation.observedAt)>60000
   ||observation.readOnly!==true||observation.ledgerMutated!==false||observation.unresolved!==true||observation.canContinue!==false
   ||['remoteWrites','actualUploadVerified','remoteBytesVerified','registered'].some(key=>observation[key]!==false)){
   const fields=[];if(!observation||typeof observation!=='object')fields.push('observation');else{
    if(Object.keys(observation).length!==keys.length||Object.keys(observation).some(key=>!keys.includes(key)))fields.push('shape');
    if(observation.format!=='yoofam-native-asset-recovery-observation-v1')fields.push('format');
    for(const [key,value]of Object.entries({requestId:binding.requestId,docId:target.docId,packetDigest:binding.packetDigest,identityDigest:binding.identityDigest,sourcePlanSha256:nativeSha,planSha256:plan.planSha256,readOnly:true,ledgerMutated:false,unresolved:true,canContinue:false,remoteWrites:false,actualUploadVerified:false,remoteBytesVerified:false,registered:false}))if(!same(observation[key]??null,value))fields.push(key);
    if(!Array.isArray(observation.groups)||observation.groups.length>11)fields.push('groups');if(!Number.isSafeInteger(observation.observedAt)||Math.abs(now()-observation.observedAt)>60000)fields.push('observed-at');
   }fail('observation-envelope',fields);
  }
  const expectedGroups=[...['MAIN','ADDITIONAL','SIZECHART','LABEL','DETAIL'].filter(type=>plan.images.some(file=>file.imageType===type)).map(type=>({key:'image:'+type,kind:'image',files:plan.images.filter(file=>file.imageType===type)})),
   ...(plan.nativeLegalAttachmentPlan?.groups??[]).map(group=>({key:'legal:'+group.nativeType,kind:'legal',files:plan.nativeLegalAttachmentPlan.files.filter(file=>file.nativeType===group.nativeType)}))];
  if(observation.groups.length!==expectedGroups.length)fail('group-count');
  for(let index=0;index<expectedGroups.length;index++){const expected=expectedGroups[index],group=observation.groups[index],prior=record.nativeAssets.groups[expected.key];
   if(!group||Object.keys(group).sort().join(',')!=='expectedFiles,groupKey,listedFiles,operationId,remoteByteLengthVerified,remoteBytesVerified,remoteContentTypeVerified,requestState,state'
    ||group.groupKey!==expected.key||group.operationId!==(prior?.operationId??null)||group.requestState!==(prior?.state??'not-requested')||!Array.isArray(group.listedFiles)
    ||group.listedFiles.length>expected.files.length||['remoteByteLengthVerified','remoteContentTypeVerified','remoteBytesVerified'].some(key=>group[key]!==false)
    ||!same(group.expectedFiles,expected.files.map(file=>({transportName:file.transportName,sha256:file.sha256,byteLength:file.byteLength,contentType:file.contentType}))))fail('group-metadata',['group-'+index]);
   const state=prior?.state==='observed'?'metadata-current':group.listedFiles.length===expected.files.length?'listed-unconfirmed':group.listedFiles.length?'partial-unconfirmed':prior?'not-observed':'not-requested';
   if(group.state!==state||!prior&&group.listedFiles.length||prior?.state==='observed'&&!same(group.listedFiles,prior.ack.slice().sort((a,b)=>String(a.imageName??a.fileName).localeCompare(String(b.imageName??b.fileName)))))fail('group-observation',['group-'+index]);
   if(group.listedFiles.length){const name=expected.kind==='image'?'imageName':'fileName',subset=expected.files.filter(file=>group.listedFiles.some(row=>row[name]===file.transportName));
    const normalized=validateNativeAssetUploadDescriptors(group.listedFiles,{kind:expected.kind,expectedFiles:subset}).descriptors;
    if(!same(normalized,group.listedFiles))fail('group-descriptors',['group-'+index]);}
  }
  return copy(observation);
 };
 const recoverWrite=async input=>{
  const result=await adapter.recoverWrite(input);if(result!==null||input.operation!=='update')return result;
  const observation=await inspectNativeAssets(input),listed=observation.groups.reduce((count,group)=>count+group.listedFiles.length,0),total=observation.groups.reduce((count,group)=>count+group.expectedFiles.length,0);
  const error=new SingleDocumentError('NATIVE_ASSET_RECOVERY_READ_ONLY',`원래 문서의 파일 목록 ${listed}/${total}개를 조회했습니다. 원격 파일의 용량·형식·원본 바이트와 문서 저장 결과는 미확정입니다. 같은 요청을 보관했습니다.`);
  error.observation=observation;throw error;
 };
 const inspectRepairContinuation=async input=>{
  if(typeof adapter.inspectExistingRepairContinuation!=='function'||input.repair?.attempt!==2)fail('continuation-scope');
  const assets=await inspectNativeAssets(input);
  if(!assets.groups.some(group=>group.requestState==='observed')||input.allowComplete!==true&&!assets.groups.some(group=>group.requestState==='not-requested')
   ||assets.groups.some(group=>!['observed','not-requested'].includes(group.requestState)||group.state!==(group.requestState==='observed'?'metadata-current':'not-requested')))fail('continuation-group-state');
  const inspection=await adapter.inspectExistingRepairContinuation(input);
  return{format:'yoofam-approved-repair-continuation-v1',inspection,assets};
 };
 return Object.freeze({...adapter,readSource,recoverWrite,inspectNativeAssets,inspectRepairContinuation});
}
