import {productDocumentIdentity,createProductDocumentReceiver,createProductDocumentStore} from './product-document-receiver.mjs';
import {createVerifiedProductDocumentBrowserAdapter} from './product-document-adapter.mjs';
import {SingleDocumentError} from './single-document.mjs';
import {PRODUCT_DOCUMENT_PREFLIGHT_TIMEOUT} from './product-document.mjs';

// Enable only after the owned full document, staged terms, readback and native
// receipt have been verified live. A page cannot override this release gate.
export const PRODUCT_DOCUMENT_LIVE_VERIFIED=false;
const receivers=new Map();
const canonical=value=>value===null||typeof value!=='object'?JSON.stringify(value):Array.isArray(value)?'['+value.map(canonical).join(',')+']':'{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonical(value[key])).join(',')+'}';
export async function dispatchProductDocument(message,sender){
  if(!message||message.type!=='YOOFAM_PRODUCT_DOCUMENT_REQUEST'||!['preview','start','resume','recover','confirm','observe'].includes(message.action)
    ||Object.keys(message).some(key=>!['type','action','packet','confirmation'].includes(key))
    ||(message.action==='confirm')!==Object.hasOwn(message,'confirmation'))throw new SingleDocumentError('PRODUCT_ACTION','전체 상품 견적 작업을 확인해주세요.');
  const context=await productDocumentIdentity(message.packet,sender,{allowExpired:!['preview','start'].includes(message.action)});
  if(message.action==='preview'){
    const reviewDigest=message.packet.review.reviewDigest,deadlineAt=Date.now()+PRODUCT_DOCUMENT_PREFLIGHT_TIMEOUT,timeoutError=()=>new SingleDocumentError('PRODUCT_SOURCE_PREFLIGHT_TIMEOUT','현재 회원·회사·견적 원본 확인 시간이 초과됐습니다. 상품은 전송하지 않았습니다.');
    let selected,stopped=false,timer;
    const deadline=new Promise((_,reject)=>{timer=setTimeout(()=>{stopped=true;reject(timeoutError());},PRODUCT_DOCUMENT_PREFLIGHT_TIMEOUT);});
    const operation=(async()=>{
      const current=await createVerifiedProductDocumentBrowserAdapter(context);
      if(stopped||Date.now()>=deadlineAt){current.adapter.dispose();throw timeoutError();}selected=current;
      const proof=await selected.adapter.readSource({identity:context.identity,bodySha256:context.originalBodySha256,preparedBodySha256:context.bodySha256,
        packetDigest:context.packetDigest,requestId:context.packet.requestId,docId:null});
      if(stopped||Date.now()>=deadlineAt)throw timeoutError();
      if(!proof||typeof proof!=='object'||Array.isArray(proof)||proof.current!==true||proof.submissionReady!==true||proof.priorDocumentClear!==true
        ||canonical(proof.identity)!==canonical(context.identity)||proof.bodySha256!==context.originalBodySha256
        ||typeof proof.sessionId!=='string'||!/^\w[\w-]{0,99}$/.test(proof.sessionId))throw new SingleDocumentError('SOURCE_CHANGED','현재 회원·회사·저장한 견적서가 준비한 자료와 다릅니다.');
      return {format:context.packet.format,requestId:context.packet.requestId,identity:context.identity,
        fingerprint:context.packet.fingerprint,productId:context.packet.productId,members:context.identity.members,
        identityDigest:context.identityDigest,packetDigest:context.packetDigest,reviewDigest,
        preparedBodySha256:context.bodySha256,originalBodySha256:context.originalBodySha256,
        liveVerified:PRODUCT_DOCUMENT_LIVE_VERIFIED,remoteWrites:false,registered:false};
    })();
    try{return await Promise.race([operation,deadline]);}finally{stopped=true;clearTimeout(timer);selected?.adapter.dispose();}
  }
  if(!PRODUCT_DOCUMENT_LIVE_VERIFIED)throw new SingleDocumentError('PRODUCT_LIVE_CONTRACT_UNVERIFIED','전체 상품 견적의 실제 접수 연결을 검수 중입니다. 현재 상품은 전송하지 않았습니다.');
  const selected=await createVerifiedProductDocumentBrowserAdapter(context),key=selected.nativeAssets?'native:'+selected.sourcePlanSha256:'legacy';
  let receiver=receivers.get(key);
  if(!receiver){if(receivers.size>=100)throw new SingleDocumentError('PRODUCT_RECEIVER_LIMIT','이 브라우저의 전송 확인 범위를 초과했습니다. 기존 응답을 확인해주세요.');receiver=createProductDocumentReceiver({adapter:selected.adapter,store:createProductDocumentStore()});receivers.set(key,receiver);}
  return message.action==='confirm'?receiver.confirm(message.packet,sender,message.confirmation):receiver[message.action](message.packet,sender);
}
