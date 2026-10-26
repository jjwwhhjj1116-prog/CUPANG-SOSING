import {productDocumentIdentity,createProductDocumentReceiver,createProductDocumentDraftReceiver,createProductDocumentStore} from './product-document-receiver.mjs';
import {createVerifiedProductDocumentBrowserAdapter} from './product-document-adapter.mjs';
import {SingleDocumentError,readPreparedDocumentPreviewCheckpoint} from './single-document.mjs';
import {PRODUCT_DOCUMENT_PREFLIGHT_TIMEOUT} from './product-document.mjs';
import {resolveProductSourceContext} from './product-source-context.mjs';

// Enable only after the owned full document, staged terms, readback and native
// receipt have been verified live. A page cannot override this release gate.
export const PRODUCT_DOCUMENT_LIVE_VERIFIED=false;
const receivers=new Map();
const canonical=value=>value===null||typeof value!=='object'?JSON.stringify(value):Array.isArray(value)?'['+value.map(canonical).join(',')+']':'{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonical(value[key])).join(',')+'}';
export async function dispatchProductDocument(message,sender){
  if(!message||message.type!=='YOOFAM_PRODUCT_DOCUMENT_REQUEST'||!['preview','prepareDraft','recoverDraft','retryCreateDraft','resumeCreateRetryDraft','recoverClosedTarget','repairExistingDraft','reviewPreparedDraft','confirmPreparedDraft','recoverPreparedDraft','observePreparedDraft','start','resume','recover','confirm','observe'].includes(message.action)
    ||Object.keys(message).some(key=>!['type','action','packet','confirmation'].includes(key))
    ||(['confirm','confirmPreparedDraft'].includes(message.action))!==Object.hasOwn(message,'confirmation'))throw new SingleDocumentError('PRODUCT_ACTION','전체 상품 견적 작업을 확인해주세요.');
  let context=await productDocumentIdentity(message.packet,sender,{allowExpired:!['preview','start','prepareDraft','reviewPreparedDraft','retryCreateDraft','resumeCreateRetryDraft','recoverClosedTarget','repairExistingDraft'].includes(message.action)});
  if(['prepareDraft','recoverDraft','retryCreateDraft','resumeCreateRetryDraft','recoverClosedTarget','repairExistingDraft','reviewPreparedDraft','confirmPreparedDraft','recoverPreparedDraft','observePreparedDraft'].includes(message.action))context=await resolveProductSourceContext(context);
  if(message.action==='preview'){
    const reviewDigest=message.packet.review.reviewDigest,deadlineAt=Date.now()+PRODUCT_DOCUMENT_PREFLIGHT_TIMEOUT,timeoutError=()=>new SingleDocumentError('PRODUCT_SOURCE_PREFLIGHT_TIMEOUT','현재 회원·회사·견적 원본 확인 시간이 초과됐습니다. 상품은 전송하지 않았습니다.');
    let selected,stopped=false,timer;
    const deadline=new Promise((_,reject)=>{timer=setTimeout(()=>{stopped=true;reject(timeoutError());},PRODUCT_DOCUMENT_PREFLIGHT_TIMEOUT);});
    const operation=(async()=>{
      context=await resolveProductSourceContext(context);
      if(stopped||Date.now()>=deadlineAt)throw timeoutError();
      const current=await createVerifiedProductDocumentBrowserAdapter(context);
      if(stopped||Date.now()>=deadlineAt){current.adapter.dispose();throw timeoutError();}selected=current;
      const prior=selected.nativeAssets===true?await readPreparedDocumentPreviewCheckpoint(context,createProductDocumentStore()):null;
      if(stopped||Date.now()>=deadlineAt)throw timeoutError();
      const proof=await selected.adapter.readSource({identity:context.identity,bodySha256:context.originalBodySha256,preparedBodySha256:context.bodySha256,
        packetDigest:context.packetDigest,requestId:context.packet.requestId,docId:prior?.docId??null,...(prior?.submitRequestedAt!==undefined?{receiptRecovery:{sessionId:prior.sessionId,submitRequestedAt:prior.submitRequestedAt}}:{})});
      if(stopped||Date.now()>=deadlineAt)throw timeoutError();
      if(!proof||typeof proof!=='object'||Array.isArray(proof)||proof.current!==true||proof.submissionReady!==true||proof.priorDocumentClear!==true
        ||canonical(proof.identity)!==canonical(context.identity)||proof.bodySha256!==context.originalBodySha256
        ||typeof proof.sessionId!=='string'||!/^\w[\w-]{0,99}$/.test(proof.sessionId)||prior&&prior.submitRequestedAt===undefined&&proof.sessionId!==prior.sessionId)throw new SingleDocumentError('SOURCE_CHANGED','현재 회원·회사·저장한 견적서가 준비한 자료와 다릅니다.');
      return {format:context.packet.format,requestId:context.packet.requestId,identity:context.identity,
        fingerprint:context.packet.fingerprint,productId:context.packet.productId,members:context.identity.members,
        identityDigest:context.identityDigest,packetDigest:context.packetDigest,reviewDigest,
        preparedBodySha256:context.bodySha256,originalBodySha256:context.originalBodySha256,
        liveVerified:PRODUCT_DOCUMENT_LIVE_VERIFIED,draftPreparationAvailable:selected.nativeAssets===true,preparedLifecycleAvailable:selected.nativeAssets===true,createRetryAvailable:selected.nativeAssets===true,createRetryContinuationAvailable:selected.nativeAssets===true,existingDocumentRepairAvailable:selected.nativeAssets===true,remoteWrites:false,registered:false};
    })();
    try{return await Promise.race([operation,deadline]);}finally{stopped=true;clearTimeout(timer);selected?.adapter.dispose();}
  }
  if(['prepareDraft','recoverDraft','retryCreateDraft','resumeCreateRetryDraft','recoverClosedTarget','repairExistingDraft','reviewPreparedDraft','confirmPreparedDraft','recoverPreparedDraft','observePreparedDraft'].includes(message.action)){
    const selected=await createVerifiedProductDocumentBrowserAdapter(context);
    if(selected.nativeAssets!==true){selected.adapter.dispose();throw new SingleDocumentError('PRODUCT_DRAFT_NATIVE_SOURCE_REQUIRED','현재 상품의 원본 파일·회사·저장 견적을 확인한 뒤 새 초안을 준비해주세요.');}
    if(['recoverDraft','recoverClosedTarget','recoverPreparedDraft','observePreparedDraft'].includes(message.action)){
      // A completed submit needs a fresh read, never the expired mutation watch.
      // Pre-submit stage recovery still retains its original live adapter.
      const store=createProductDocumentStore();let prior,fresh=false;
      try{prior=await readPreparedDocumentPreviewCheckpoint(context,store);
        if(message.action==='recoverDraft'||message.action==='recoverClosedTarget'||prior?.submitRequestedAt!==undefined){fresh=true;const receiver=createProductDocumentDraftReceiver({adapter:selected.adapter,store,resolveSourceContext:base=>resolveProductSourceContext(base,{store})});return await receiver[message.action](message.packet,sender);}
      }catch(error){if(!fresh)selected.adapter.dispose();throw error;}
      finally{if(fresh)selected.adapter.dispose();}
    }
    const key='native-draft:'+selected.sourcePlanSha256+':source:'+(context.sourceAppTabId??context.identity.appTabId);let receiver=receivers.get(key);
    if(!receiver){if(receivers.size>=100){selected.adapter.dispose();throw new SingleDocumentError('PRODUCT_RECEIVER_LIMIT','이 브라우저의 새 초안 확인 범위를 초과했습니다. 기존 요청을 먼저 확인해주세요.');}
      const store=createProductDocumentStore();receiver=createProductDocumentDraftReceiver({adapter:selected.adapter,store,resolveSourceContext:base=>resolveProductSourceContext(base,{store})});receivers.set(key,receiver);
    }else selected.adapter.dispose();
    return message.action==='confirmPreparedDraft'?receiver.confirmPreparedDraft(message.packet,sender,message.confirmation):receiver[message.action](message.packet,sender);
  }
  if(!PRODUCT_DOCUMENT_LIVE_VERIFIED)throw new SingleDocumentError('PRODUCT_LIVE_CONTRACT_UNVERIFIED','전체 상품 견적의 실제 접수 연결을 검수 중입니다. 현재 상품은 전송하지 않았습니다.');
  const selected=await createVerifiedProductDocumentBrowserAdapter(context),key=selected.nativeAssets?'native:'+selected.sourcePlanSha256:'legacy';
  let receiver=receivers.get(key);
  if(!receiver){if(receivers.size>=100)throw new SingleDocumentError('PRODUCT_RECEIVER_LIMIT','이 브라우저의 전송 확인 범위를 초과했습니다. 기존 응답을 확인해주세요.');receiver=createProductDocumentReceiver({adapter:selected.adapter,store:createProductDocumentStore()});receivers.set(key,receiver);}
  return message.action==='confirm'?receiver.confirm(message.packet,sender,message.confirmation):receiver[message.action](message.packet,sender);
}
