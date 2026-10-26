import {readAppDocumentSource,currentSourceAppTab} from './product-document-source.mjs';
import {nativeAssetUploadPlanSha256,validateNativeAssetUploadDescriptors} from './native-asset-multipart.mjs';
import {nativeAssetRecoveryPage} from './native-asset-recovery-page.mjs';
import {singleDocumentOwnedRecordPage} from './single-document-adapter.mjs';
import {assertSingleOwnedTarget} from './single-owned-target.mjs';
import {SingleDocumentError} from './single-document.mjs';
const canon=value=>value===null||typeof value!=='object'?JSON.stringify(value):Array.isArray(value)?'['+value.map(canon).join(',')+']':'{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canon(value[key])).join(',')+'}';
const copy=value=>structuredClone(value),same=(a,b)=>canon(a)===canon(b);
const digest=async value=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(canon(value)))),byte=>byte.toString(16).padStart(2,'0')).join('');
const fail=()=>{throw new SingleDocumentError('NATIVE_ASSET_RECOVERY_UNCONFIRMED','원래 새 문서·회원·원본 파일의 업로드 결과를 읽기로 확인하지 못했습니다. 미확정 요청을 유지했습니다.');};

/** Add a diagnostic read to an existing recover operation. A positive file
 * list is intentionally not an update ACK: no ledger checkpoint is promoted,
 * no multipart request is repeated and the receiver remains update-requested. */
export function withNativeProductAssetRecovery(adapter,{api,nativeSha,now=Date.now,sourceAppTabId}){
 const sources=new Map();
 const readSource=async input=>{const result=await adapter.readSource(input);if(result?.current===true&&input?.identity?.fingerprint===nativeSha)sources.set(canon(input.identity),{input:copy(input),sessionId:result.sessionId});else sources.delete(canon(input.identity));return result;};
 const inspectNativeAssets=async input=>{
  const source=sources.get(canon(input?.identity));
  if(!source||input.operation!=='update'||input.requestId!==source.input.requestId||input.operationId!==source.input.requestId+':update'
   ||input.identityDigest!==await digest(input.identity)||input.identity.fingerprint!==nativeSha||!same(input.expectedBody?.docId,input.docId))fail();
  const reviewed=copy(input.expectedBody);reviewed.docId=null;if(await digest(reviewed)!==source.input.preparedBodySha256)fail();
  const current=async()=>{const proof=await adapter.readSource(source.input);if(proof?.current!==true||proof.sessionId!==source.sessionId)fail();
   await currentSourceAppTab(api,input.identity,sourceAppTabId);
   const execution={frameId:0,result:await readAppDocumentSource(api,input.identity,source.input,'native',sourceAppTabId)};
   await currentSourceAppTab(api,input.identity,sourceAppTabId);
   if(execution?.frameId!==0||execution?.result?.current!==true||execution.result.sourcePlan?.sourcePlanSha256!==nativeSha||!same(execution.result.identity,input.identity)
    ||execution.result.bodySha256!==source.input.bodySha256||execution.result.preparedBodySha256!==source.input.preparedBodySha256)fail();return execution.result.sourcePlan;
  };
  const sourcePlan=await current(),binding={identity:copy(input.identity),identityDigest:input.identityDigest,packetDigest:source.input.packetDigest,
   preparedBodySha256:source.input.preparedBodySha256,originalBodySha256:source.input.bodySha256,sessionId:source.sessionId,requestId:source.input.requestId,nativeAssetSourcePlanSha256:nativeSha};
  assertSingleOwnedTarget(input.tab,binding);
  const tabCurrent=async()=>{const tab=await api.tabs.get(input.tab.tabId),url=new URL(tab.url);if(tab.id!==input.tab.tabId||tab.windowId!==input.identity.windowId||tab.pendingUrl||tab.status!=='complete'
   ||url.origin!=='https://supplier.coupang.com'||url.pathname!=='/dashboard/KR'||url.username||url.password||url.search||url.hash)fail();};
  await tabCurrent();
  const [before]=await api.scripting.executeScript({target:{tabId:input.tab.tabId,frameIds:[0]},func:singleDocumentOwnedRecordPage,args:[JSON.stringify(binding)]});
  const record=before?.result;if(before?.frameId!==0||typeof before?.documentId!=='string'||!record||!same(record.binding,binding)||!same(record.docId,input.docId)
   ||record.state!=='created'||record.updateOperationId!==undefined||!same(record.baselineDocIds,input.baselineDocIds)||record.baselineDocIds.some(id=>String(id)===String(input.docId)))fail();
  const target={docId:record.docId,requestId:binding.requestId,packetDigest:binding.packetDigest,preparedBodySha256:binding.preparedBodySha256,
   createOperationId:record.createOperationId,baselineDocIds:copy(record.baselineDocIds)};
  const plan={format:'yoofam-native-asset-upload-plan-v1',identity:copy(sourcePlan.identity),identityDigest:sourcePlan.identityDigest,target,
   images:copy(sourcePlan.images),nativeLegalAttachmentPlan:sourcePlan.nativeLegalAttachmentPlan?copy(sourcePlan.nativeLegalAttachmentPlan):null,planSha256:null,
   registered:false,remoteWrites:false,submissionReady:false,transportReady:false};
  plan.planSha256=await nativeAssetUploadPlanSha256(plan);
  await tabCurrent();const [readback]=await api.scripting.executeScript({target:{tabId:input.tab.tabId,documentIds:[before.documentId]},func:nativeAssetRecoveryPage,args:[JSON.stringify({binding,target,plan})]});
  await tabCurrent();if(readback?.frameId!==0||readback.documentId!==before.documentId)fail();
  const [after]=await api.scripting.executeScript({target:{tabId:input.tab.tabId,documentIds:[before.documentId]},func:singleDocumentOwnedRecordPage,args:[JSON.stringify(binding)]});
  if(after?.frameId!==0||after.documentId!==before.documentId||!same(after.result,record)||!same(await current(),sourcePlan))fail();
  const observation=readback.result;
  const keys=['format','requestId','docId','packetDigest','identityDigest','sourcePlanSha256','planSha256','groups','observedAt','readOnly','ledgerMutated','unresolved','canContinue','remoteWrites','actualUploadVerified','remoteBytesVerified','registered'];
  if(!observation||Object.keys(observation).length!==keys.length||Object.keys(observation).some(key=>!keys.includes(key))||observation.format!=='yoofam-native-asset-recovery-observation-v1'||observation.requestId!==binding.requestId||!same(observation.docId,target.docId)
   ||observation.packetDigest!==binding.packetDigest||observation.identityDigest!==binding.identityDigest||observation.sourcePlanSha256!==nativeSha||observation.planSha256!==plan.planSha256
   ||!Array.isArray(observation.groups)||observation.groups.length>11||!Number.isSafeInteger(observation.observedAt)||Math.abs(now()-observation.observedAt)>60000
   ||observation.readOnly!==true||observation.ledgerMutated!==false||observation.unresolved!==true||observation.canContinue!==false
   ||['remoteWrites','actualUploadVerified','remoteBytesVerified','registered'].some(key=>observation[key]!==false))fail();
  const expectedGroups=[...['MAIN','ADDITIONAL','SIZECHART','LABEL','DETAIL'].filter(type=>plan.images.some(file=>file.imageType===type)).map(type=>({key:'image:'+type,kind:'image',files:plan.images.filter(file=>file.imageType===type)})),
   ...(plan.nativeLegalAttachmentPlan?.groups??[]).map(group=>({key:'legal:'+group.nativeType,kind:'legal',files:plan.nativeLegalAttachmentPlan.files.filter(file=>file.nativeType===group.nativeType)}))];
  if(observation.groups.length!==expectedGroups.length)fail();
  for(let index=0;index<expectedGroups.length;index++){const expected=expectedGroups[index],group=observation.groups[index],prior=record.nativeAssets.groups[expected.key];
   if(!group||Object.keys(group).sort().join(',')!=='expectedFiles,groupKey,listedFiles,operationId,remoteByteLengthVerified,remoteBytesVerified,remoteContentTypeVerified,requestState,state'
    ||group.groupKey!==expected.key||group.operationId!==(prior?.operationId??null)||group.requestState!==(prior?.state??'not-requested')||!Array.isArray(group.listedFiles)
    ||group.listedFiles.length>expected.files.length||['remoteByteLengthVerified','remoteContentTypeVerified','remoteBytesVerified'].some(key=>group[key]!==false)
    ||!same(group.expectedFiles,expected.files.map(file=>({transportName:file.transportName,sha256:file.sha256,byteLength:file.byteLength,contentType:file.contentType}))))fail();
   const state=prior?.state==='observed'?'metadata-current':group.listedFiles.length===expected.files.length?'listed-unconfirmed':group.listedFiles.length?'partial-unconfirmed':prior?'not-observed':'not-requested';
   if(group.state!==state||!prior&&group.listedFiles.length||prior?.state==='observed'&&!same(group.listedFiles,prior.ack.slice().sort((a,b)=>String(a.imageName??a.fileName).localeCompare(String(b.imageName??b.fileName)))))fail();
   if(group.listedFiles.length){const name=expected.kind==='image'?'imageName':'fileName',subset=expected.files.filter(file=>group.listedFiles.some(row=>row[name]===file.transportName));
    const normalized=validateNativeAssetUploadDescriptors(group.listedFiles,{kind:expected.kind,expectedFiles:subset}).descriptors;
    if(!same(normalized,group.listedFiles))fail();}
  }
  return copy(observation);
 };
 const recoverWrite=async input=>{
  const result=await adapter.recoverWrite(input);if(result!==null||input.operation!=='update')return result;
  const observation=await inspectNativeAssets(input),listed=observation.groups.reduce((count,group)=>count+group.listedFiles.length,0),total=observation.groups.reduce((count,group)=>count+group.expectedFiles.length,0);
  const error=new SingleDocumentError('NATIVE_ASSET_RECOVERY_READ_ONLY',`원래 문서의 파일 목록 ${listed}/${total}개를 조회했습니다. 원격 파일의 용량·형식·원본 바이트와 문서 저장 결과는 미확정입니다. 같은 요청을 보관했습니다.`);
  error.observation=observation;throw error;
 };
 return Object.freeze({...adapter,readSource,recoverWrite,inspectNativeAssets});
}
