import {amendmentCopy,amendmentSame,validateNativeDraftDetailAmendmentRequest,validateNativeDraftDetailAmendmentObservation,
 type NativeDraftDetailAmendmentRequest,type NativeDraftDetailAmendmentObservation,type NativeDraftDetailAmendmentDescriptor} from '../extensions/supplier-hub/native-draft-detail-amendment.mjs';
import {createProductDocumentPacket} from '../extensions/supplier-hub/product-document.mjs';
import {readSingleCatalogContext} from '@/app/supplier-hub-single-client';
import {ProductDocumentBridgeError,validatePreparedProductDocumentState,type ProductDocumentSession,type PreparedDocumentAction} from '@/app/supplier-hub-product-client';
import {exchange} from '@/app/supplier-hub-handoff';
import {assertNativeDraftDetailAmendmentCurrent} from '@/app/native-draft-detail-amendment-pending';
import {readProductDocumentPending} from '@/app/supplier-hub-product-pending';
import type {SupplierHubProductDocumentReview} from '@/app/supplier-hub-product-document';

const origins=['https://sourceflow.jjwwhhjj1116.workers.dev','http://localhost:3000','http://127.0.0.1:3000'];
const readonly=(action:NativeDraftDetailAmendmentRequest['action'])=>['inspect','preview','recover','observe'].includes(action);
export async function assertNativeDraftDetailAmendmentCapability(signal:AbortSignal):Promise<void>{
 const info=await exchange('PING',null,signal);
 if(info.nativeDraftDetailAmendment!==true||typeof info.version!=='string'||!/^\d+\.\d+\.\d+$/.test(info.version)||info.version.localeCompare('2.1.88','en',{numeric:true})<0)
  throw new ProductDocumentBridgeError('저장 문서 수정을 지원하는 확장 2.1.88 이상을 적용하고 앱을 새로고침해주세요.',false,'AMENDMENT_UNAVAILABLE');
}
/** A single correlated command. Uncertain responses retain the operation UUID;
 * this client never retries or turns a recovery read into an apply. */
export async function runNativeDraftDetailAmendment(input:NativeDraftDetailAmendmentRequest,signal:AbortSignal):Promise<NativeDraftDetailAmendmentObservation>{
 const request=validateNativeDraftDetailAmendmentRequest(input),origin=window.location.origin,mutating=!readonly(request.action);
 if(!origins.includes(origin))throw new ProductDocumentBridgeError('원래 앱에서 저장 문서 수정을 확인해주세요.',false,'AMENDMENT_ORIGIN');
 const identity='packet'in request?request.packet.review.identity:'anchor'in request?request.anchor:request.lookup;
 if('origin'in identity&&identity.origin!==origin)throw new ProductDocumentBridgeError('원래 앱의 수정 요청을 확인해주세요.',false,'AMENDMENT_ORIGIN');
 const actor=async()=>{signal.throwIfAborted();const current=await readSingleCatalogContext(signal);if(window.location.origin!==origin||current.ownerId!==identity.ownerId||!amendmentSame(current.company,identity.company))throw Error('문서 수정 중 회원·회사가 변경되었습니다.');};
 try{await actor();}catch{throw new ProductDocumentBridgeError('현재 회원·회사의 저장 문서 수정 범위를 확인해주세요.',false,'AMENDMENT_SOURCE_CHANGED');}
 const value=await new Promise<unknown>((resolve,reject)=>{
  if(signal.aborted){reject(new ProductDocumentBridgeError('문서 수정 확인을 취소했습니다.',false));return;}
  const requestId=crypto.randomUUID(),cleanup=()=>{clearTimeout(timer);window.removeEventListener('message',receive);signal.removeEventListener('abort',abort);};
  const abort=()=>{cleanup();reject(new ProductDocumentBridgeError('응답 확인을 취소했습니다. 같은 수정 기록으로 결과를 조회해주세요.',mutating,'AMENDMENT_ACK_MISSING'));};
  const receive=(event:MessageEvent)=>{
   if(event.source!==window||event.origin!==origin||event.data?.channel!=='YOOFAM_HUB_HANDOFF_RESULT'||event.data.requestId!==requestId)return;
   cleanup();const envelope=event.data.result;
   if(!envelope||typeof envelope!=='object'||envelope.ok!==true||!Object.hasOwn(envelope,'result')){
    reject(new ProductDocumentBridgeError(typeof envelope?.error==='string'?envelope.error:'확장의 저장 문서 수정 응답을 확인하지 못했습니다.',mutating,typeof envelope?.code==='string'?envelope.code:'AMENDMENT_BRIDGE'));return;
   }
   try{resolve(amendmentCopy(envelope.result));}catch{reject(new ProductDocumentBridgeError('저장 문서 수정 응답 형식을 확인하지 못했습니다.',mutating,'AMENDMENT_REPLY'));}
  };
  const timer=setTimeout(()=>{cleanup();reject(new ProductDocumentBridgeError('저장 문서 수정 응답이 없습니다. 새 요청 없이 같은 기록의 결과를 조회해주세요.',mutating,'AMENDMENT_ACK_MISSING'));},request.action==='apply'?480000:180000);
  window.addEventListener('message',receive);signal.addEventListener('abort',abort,{once:true});
  try{window.postMessage({channel:'YOOFAM_HUB_HANDOFF',requestId,type:'PRODUCT_DOCUMENT_DETAIL_AMENDMENT',payload:request},origin);}
  catch{cleanup();reject(new ProductDocumentBridgeError('확장 전달 결과를 확인하지 못했습니다. 같은 수정 기록을 조회해주세요.',mutating,'AMENDMENT_ACK_MISSING'));}
 });
 try{const observation=validateNativeDraftDetailAmendmentObservation(value,request);await actor();signal.throwIfAborted();return observation;}
 catch{throw new ProductDocumentBridgeError('원래 문서·수정 UUID·최신 본문과 응답의 연결을 확인하지 못했습니다. 같은 기록을 조회해주세요.',mutating,'AMENDMENT_REPLY');}
}

/** Validate child lifecycle facts with the unchanged prepared-document parser.
 * No ordinary parent command is dispatched and no parent reservation is altered. */
export async function nativeDraftDetailAmendmentLifecycle(review:SupplierHubProductDocumentReview,descriptor:NativeDraftDetailAmendmentDescriptor,observation:NativeDraftDetailAmendmentObservation,action:PreparedDocumentAction,signal:AbortSignal){
 assertNativeDraftDetailAmendmentCurrent(descriptor,observation,review);
 const value='lifecycle'in observation?observation.lifecycle:undefined,latest=observation.latest,parent=readProductDocumentPending(review);
 if(!value||!latest||!parent||value.identity.appTabId!==parent.appTabId||value.identity.windowId!==parent.windowId||value.docId!==descriptor.anchor.docId||value.identityDigest!==latest.identityDigest||value.packetDigest!==latest.packetDigest)throw Error('최신 수정 문서의 등록 검증 연결을 확인해주세요.');
 // The identity is untrusted until the strict parser immediately below verifies it.
 const packet=await createProductDocumentPacket(review,{requestId:descriptor.anchor.requestId}),session:ProductDocumentSession={packet,origin:descriptor.anchor.origin,packetDigest:latest.packetDigest,preview:{format:'yoofam-supplier-hub-product-document-v1',requestId:packet.requestId,identity:value.identity as ProductDocumentSession['preview']['identity'],identityDigest:latest.identityDigest,packetDigest:latest.packetDigest,productId:review.identity.productId,fingerprint:review.identity.fingerprint,members:review.members,reviewDigest:review.reviewDigest,preparedBodySha256:review.preparedBodySha256,originalBodySha256:review.originalBodySha256,liveVerified:false,remoteWrites:false,registered:false,preparedLifecycleAvailable:true}};
 const state=await validatePreparedProductDocumentState(value,session,action,signal);signal.throwIfAborted();assertNativeDraftDetailAmendmentCurrent(descriptor,observation,review);
 return{session,state};
}
