import {amendmentCopy as copy,amendmentSame as same,amendmentDigest as digest,amendmentFail as fail} from './native-draft-detail-amendment.mjs';
import {createProductDocumentPacket} from './product-document.mjs';
import {productDocumentIdentity,createProductDocumentStore} from './product-document-receiver.mjs';
import {readPreparedDocumentPreviewCheckpoint,createSupplierHubDocumentReceiver,validateSingleStepResponse} from './single-document.mjs';
import {createSupplierHubDocumentBrowserAdapter,normalizeNativeDocumentReadback} from './single-document-adapter.mjs';
import {readAppDocumentSource,currentSourceAppTab} from './product-document-source.mjs';
import {resolveProductSourceContext} from './product-source-context.mjs';
import {nativeDraftDetailAmendmentPage} from './native-draft-detail-amendment-page.mjs';
import {verifySupplierHubCompany} from './company.mjs';
const lifecycleReceivers=new Map();

/** Real Chrome boundary; all source reads remain in the manifest-installed
 * authenticated app reader. No new host permission or page-provided authority. */
export function createNativeDraftDetailAmendmentBrowserAdapter({api=globalThis.chrome,parentStore=createProductDocumentStore(),now=Date.now,activeKeys}={}){
 let caller;const opened=[];
 const input=context=>({identity:context.identity,bodySha256:context.originalBodySha256,preparedBodySha256:context.bodySha256,packetDigest:context.packetDigest,requestId:context.packet.requestId,docId:null});
 const binding=(context,sessionId)=>({identity:copy(context.identity),identityDigest:context.identityDigest,packetDigest:context.packetDigest,preparedBodySha256:context.bodySha256,originalBodySha256:context.originalBodySha256,nativeAssetSourcePlanSha256:context.identity.fingerprint,sessionId,requestId:context.packet.requestId});
 async function authenticate(scope,sender){
  const url=new URL(sender?.url);if(sender?.frameId!==0||!Number.isSafeInteger(sender.tab?.id)||!Number.isSafeInteger(sender.tab.windowId)||scope.origin&&scope.origin!==url.origin)fail('DRAFT_DETAIL_AMENDMENT_SENDER');
  const response=await api.tabs.sendMessage(sender.tab.id,{type:'YOOFAM_READ_PRESERVED_PRODUCT_DOCUMENT_SCOPE',expected:{origin:url.origin,target:{requestId:scope.requestId??'00000000-0000-4000-8000-000000000000',docId:scope.docId??1,productId:scope.productId,company:scope.company}}},{frameId:0});
  if(response?.ok!==true||response.scope?.ownerId!==scope.ownerId||!same(response.scope.company,scope.company))fail('DRAFT_DETAIL_AMENDMENT_SCOPE');caller=copy(sender);
 }
 async function parentContext(packet){return resolveProductSourceContext(await productDocumentIdentity(packet,caller,{allowExpired:true}),{api,store:parentStore});}
 async function source(packet,context){
  await currentSourceAppTab(api,context.identity,context.sourceAppTabId);const result=await readAppDocumentSource(api,context.identity,{...input(context),action:'amendment'},'native',context.sourceAppTabId);await currentSourceAppTab(api,context.identity,context.sourceAppTabId);
  if(result.current!==true||!same(result.identity,context.identity)||!result.amendmentSource||result.sourcePlan?.sourcePlanSha256!==packet.review.identity.fingerprint)fail('DRAFT_DETAIL_AMENDMENT_SOURCE');
  return{review:copy(packet.review),nativePlan:copy(result.sourcePlan),quotationView:copy(result.amendmentSource.quotationView),settings:copy(result.amendmentSource.settings)};
 }
 async function page(record,action,extra={}){
  const parent=record.parentSnapshot??record.checkpoint,context=await parentContext(record.parentPacket??record.packet),target=parent.ownedTarget;
  if(!target||target.packetDigest!==context.packetDigest||target.requestId!==context.packet.requestId)fail('DRAFT_DETAIL_AMENDMENT_TARGET');
  const before=await api.tabs.get(target.tabId),url=new URL(before.url);if(before.windowId!==context.identity.windowId||before.pendingUrl||before.status!=='complete'||url.origin!=='https://supplier.coupang.com')fail('DRAFT_DETAIL_AMENDMENT_TARGET');
  const [company]=await api.scripting.executeScript({target:{tabId:target.tabId,frameIds:[0]},func:verifySupplierHubCompany,args:[context.identity.company,'catalog']});
  if(company?.frameId!==0||company.result?.code!==context.identity.company.code||typeof company.documentId!=='string')fail('DRAFT_DETAIL_AMENDMENT_TARGET');
  const [reply]=await api.scripting.executeScript({target:{tabId:target.tabId,documentIds:[company.documentId]},func:nativeDraftDetailAmendmentPage,args:[JSON.stringify({action,amendmentId:record.amendmentId,parentBinding:binding(context,parent.sessionId),docId:parent.docId,...(record.parentRemote?.parentRecord?{parentRecord:record.parentRemote.parentRecord}:{}),...extra})]});
  const after=await api.tabs.get(target.tabId);if(reply?.error||reply?.frameId!==0||reply.documentId!==company.documentId||after.windowId!==before.windowId||after.url!==before.url||after.pendingUrl)fail('DRAFT_DETAIL_AMENDMENT_TARGET');
  if(!reply.result||!same(reply.result.parentRecord?.binding,binding(context,parent.sessionId)))fail('DRAFT_DETAIL_AMENDMENT_PARENT_RECORD');return copy(reply.result);
 }
 async function readParent(request){
  const context=await parentContext(request.packet);await readPreparedDocumentPreviewCheckpoint(context,parentStore);const checkpoint=await parentStore.get(context.key);
  if(checkpoint?.state!=='validated'||checkpoint.preparedLifecycle||checkpoint.draftOnly!==true||String(checkpoint.docId)!==String(request.docId)||!same(checkpoint.validatedSteps,[2,3,4,5]))fail('DRAFT_DETAIL_AMENDMENT_PARENT_CHANGED');
  const current=await source(request.packet,context),temporary={checkpoint,packet:request.packet,amendmentId:request.amendmentId},remote=await page(temporary,'read'),expected=copy(context.packet.body);expected.docId=checkpoint.docId;
  if(!same(normalizeNativeDocumentReadback(remote.remote.body,expected),expected))fail('DRAFT_DETAIL_AMENDMENT_BODY_CHANGED');
  const anchor={origin:context.identity.origin,ownerId:context.identity.ownerId,company:copy(context.identity.company),productId:context.identity.productId,requestId:request.packet.requestId,docId:checkpoint.docId,parentIdentityDigest:context.identityDigest,parentPacketDigest:context.packetDigest,parentReviewDigest:request.packet.review.reviewDigest,parentSourcePlanSha256:context.identity.fingerprint,parentOriginalBodySha256:context.originalBodySha256,parentPreparedBodySha256:context.bodySha256,parentCheckpointSequence:checkpoint.sequence,parentCheckpointSha256:await digest(checkpoint)};
  return{anchor,checkpoint,source:current,remote};
 }
 async function verifyMissingParent(lookup){const parent=await parentStore.get('product-document:'+lookup.parentPacketDigest);if(!parent||parent.identityDigest!==lookup.parentIdentityDigest||parent.bodySha256!==lookup.parentPreparedBodySha256||parent.originalBodySha256!==lookup.parentOriginalBodySha256||parent.requestId!==lookup.requestId||String(parent.docId)!==String(lookup.docId)||parent.identity?.ownerId!==lookup.ownerId||parent.identity.productId!==lookup.productId||!same(parent.identity.company,lookup.company))fail('DRAFT_DETAIL_AMENDMENT_PARENT_CHANGED');}
 async function readNextSource(record,review){
  const old=await parentContext(record.parentPacket),packet=await createProductDocumentPacket(review,{requestId:record.anchor.requestId,now:now(),createdAt:now()}),sender={...caller,tab:{...caller.tab,id:old.identity.appTabId,windowId:old.identity.windowId}};
  const built=await productDocumentIdentity(packet,sender),context={...built,...(old.sourceAppTabId!==undefined?{sourceAppTabId:old.sourceAppTabId}:{})};
  if(context.laneKey!==record.laneKey)fail('DRAFT_DETAIL_AMENDMENT_SCOPE');return{packet,context,source:await source(packet,context)};
 }
 async function verifyNextSource(record){if(!same(await source(record.nextPacket,record.nextContext),record.nextSource))fail('DRAFT_DETAIL_AMENDMENT_SOURCE_CHANGED');}
 const readRemote=record=>page(record,'read');
 async function prepareDetailParts(record){
  const files=record.delta.newDetailFiles;if(files.reduce((sum,file)=>sum+file.byteLength,0)>20*1024*1024)fail('DRAFT_DETAIL_AMENDMENT_SIZE');const parts=[];
  for(const file of files){const result=await readAppDocumentSource(api,record.nextContext.identity,{...input(record.nextContext),action:'image',file},'native',record.nextContext.sourceAppTabId);if(result.file?.sha256!==file.sha256||result.file.byteLength!==file.byteLength||result.file.contentType!==file.contentType)fail('DRAFT_DETAIL_AMENDMENT_BYTES');parts.push({transportName:file.transportName,sha256:file.sha256,byteLength:file.byteLength,contentType:file.contentType,base64:result.file.base64});}
  return parts;
 }
 const upload=(record,parts)=>page(record,'upload',{parts,operationId:record.operationId,expectedRemote:record.parentRemote.remote});
 const update=record=>{const body=copy(record.nextContext.packet.body);body.docId=record.anchor.docId;return page(record,'update',{body,operationId:record.operationId,expectedRemote:record.uploadedRemote});};
 const validate=(record,step)=>page(record,'validate',{step,version:record.nextContext.packet.body.version,operationId:record.operationId,expectedRemote:record.updatedRemote});
 async function verifyUpdatedBody(record,actual){const expected=copy(record.nextContext.packet.body);expected.docId=record.anchor.docId;if(!same(normalizeNativeDocumentReadback(actual,expected),expected))fail('DRAFT_DETAIL_AMENDMENT_BODY_CHANGED');}
 async function qualifyLatest(record){
  await verifyNextSource(record);const current=await readRemote(record);await verifyUpdatedBody(record,current.remote.body);if(!same(current.remote,record.updatedRemote))fail('DRAFT_DETAIL_AMENDMENT_REMOTE_CHANGED');
  for(const step of [2,3,4,5]){const entry=current.ledger?.validation?.[step];if(entry?.state!=='observed'||entry.operationId!==record.anchor.requestId+':amend:'+record.amendmentId+':validate:'+step||validateSingleStepResponse(entry.response).valid!==true)fail('DRAFT_DETAIL_AMENDMENT_VALIDATION_UNCONFIRMED');}
  const context=record.nextContext,base=createSupplierHubDocumentBrowserAdapter({api,now,sourceAppTabId:context.sourceAppTabId,nativeDraftDetailAmendmentId:record.amendmentId,nativeAssets:{sourcePlanSha256:context.identity.fingerprint}},{wholeProduct:true});opened.push(base);
  const proof=await base.readSource({...input(context),docId:record.anchor.docId});if(proof.current!==true)fail('DRAFT_DETAIL_AMENDMENT_SOURCE_CHANGED');
  const nextBinding=binding(context,proof.sessionId),target={...copy(record.parentSnapshot.ownedTarget),packetDigest:context.packetDigest},origin={format:'yoofam-native-draft-detail-amendment-origin-v1',amendmentId:record.amendmentId,anchor:record.anchor,previewDigest:record.previewDigest};
  const derivedRecord={binding:nextBinding,docId:record.anchor.docId,baselineDocIds:copy(record.parentSnapshot.baselineDocIds),createOperationId:record.anchor.requestId+':create',state:'validated',updateOperationId:record.anchor.requestId+':amend:'+record.amendmentId+':update',validation:copy(current.ledger.validation),amendmentOrigin:origin};
  await page(record,'bind',{derivedRecord,expectedRemote:record.updatedRemote});
  const checkpoint={...copy(record.parentSnapshot),key:context.key,identity:copy(context.identity),identityDigest:context.identityDigest,packetDigest:context.packetDigest,bodySha256:context.bodySha256,originalBodySha256:context.originalBodySha256,ownedTarget:target,tab:{...copy(record.parentSnapshot.tab),packetDigest:context.packetDigest},sessionId:proof.sessionId,state:'validated',sequence:1,updatedAt:now(),validatedSteps:[2,3,4,5],stageConsents:[],challenge:null,receipt:null,amendmentOrigin:origin};
  delete checkpoint.operationId;delete checkpoint.requestedStep;
  return{checkpoint,latest:{reviewDigest:record.nextPacket.review.reviewDigest,sourcePlanSha256:context.identity.fingerprint,originalBodySha256:context.originalBodySha256,preparedBodySha256:context.bodySha256,identityDigest:context.identityDigest,packetDigest:context.packetDigest}};
 }
 async function recover(record){
  const value=await readRemote(record),ledger=value.ledger;if(!ledger)return null;
  if(record.state==='upload-requested'&&ledger.state==='files-saved'&&ledger.uploadOperationId===record.operationId&&same(ledger.expectedRemote,record.parentRemote.remote)&&same(value.remote,ledger.remote))return{state:'files-saved',needsRecovery:false,uploadedRemote:value.remote,uploadEvidence:ledger};
  if(record.state==='update-requested'&&ledger.updateOperationId===record.operationId&&ledger.updateAck===true&&['updated','validated','validation-requested'].includes(ledger.state)){await verifyUpdatedBody(record,value.remote.body);if(!same(value.remote.images,record.uploadedRemote.images)||!same(value.remote.legal,record.uploadedRemote.legal))fail('DRAFT_DETAIL_AMENDMENT_REMOTE_CHANGED');return{state:'updated',needsRecovery:false,updatedRemote:value.remote,updateEvidence:ledger};}
  if(record.state==='validation-requested'){const step=record.requestedStep,entry=ledger.validation?.[step];if(entry?.state==='observed'&&entry.operationId===record.operationId&&validateSingleStepResponse(entry.response).valid===true){await verifyUpdatedBody(record,value.remote.body);if(!same(value.remote,record.updatedRemote))fail('DRAFT_DETAIL_AMENDMENT_REMOTE_CHANGED');return{state:'updated',needsRecovery:false,validatedSteps:[...record.validatedSteps,step],validationEvidence:ledger};}}
  return null;
 }
 async function lifecycle(record,request,sender){
  await verifyNextSource(record);const context=record.nextContext,key=record.anchor.parentPacketDigest+':'+record.amendmentId;let retained=lifecycleReceivers.get(key);
  if(retained&&(!same(retained.context,context)||retained.api!==api))fail('DRAFT_DETAIL_AMENDMENT_SCOPE');
  if(!retained){if(lifecycleReceivers.size>=100)fail('DRAFT_DETAIL_AMENDMENT_LIMIT');const base=createSupplierHubDocumentBrowserAdapter({api,now,sourceAppTabId:context.sourceAppTabId,nativeDraftDetailAmendmentId:record.amendmentId,nativeAssets:{sourcePlanSha256:context.identity.fingerprint}},{wholeProduct:true});
  const qualified={...base,qualifyPreparedDraft:async()=>{const remote=await readRemote(record);await verifyUpdatedBody(record,remote.remote.body);if(!same(remote.remote,record.updatedRemote))fail('DRAFT_DETAIL_AMENDMENT_REMOTE_CHANGED');return{readOnly:true,docId:record.anchor.docId,company:context.identity.company,identityDigest:context.identityDigest,packetDigest:context.packetDigest,sourcePlanSha256:context.identity.fingerprint,metadataObserved:true,checkedAt:now()};}};
  const receiver=createSupplierHubDocumentReceiver({adapter:qualified,store:parentStore,activeKeys},{format:context.packet.format,draftOnly:true,nativeLifecycle:true,identity:async packet=>{if(!same(packet,record.nextPacket))fail('DRAFT_DETAIL_AMENDMENT_SCOPE');return context;}});retained={context,api,receiver};lifecycleReceivers.set(key,retained);}
  const method={review:'reviewPreparedDraft',confirm:'confirmPreparedDraft',observe:'observePreparedDraft',recover:'recoverPreparedDraft'}[request.action],before=await parentStore.get(context.key),result=await retained.receiver[method](record.nextPacket,sender,request.confirmation),after=await parentStore.get(context.key);
  return{lifecycle:result,submitDispatched:request.action==='confirm'&&before?.submitRequestedAt===undefined&&after?.submitRequestedAt!==undefined};
 }
 return{authenticate,readParent,verifyMissingParent,readNextSource,verifyNextSource,readRemote,prepareDetailParts,upload,update,validate,verifyUpdatedBody,qualifyLatest,recover,lifecycle,dispose(){for(const adapter of opened)adapter.dispose();}};
}
