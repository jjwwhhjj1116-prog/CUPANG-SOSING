import {productDocumentIdentity,createProductDocumentReceiver,createProductDocumentStore} from './product-document-receiver.mjs';
import {createProductDocumentBrowserAdapter} from './product-document-adapter.mjs';
import {SingleDocumentError} from './single-document.mjs';

// Enable only after the owned full document, staged terms, readback and native
// receipt have been verified live. A page cannot override this release gate.
export const PRODUCT_DOCUMENT_LIVE_VERIFIED=false;
let receiver;
export async function dispatchProductDocument(message,sender){
  if(!message||message.type!=='YOOFAM_PRODUCT_DOCUMENT_REQUEST'||!['preview','start','resume','recover','confirm','observe'].includes(message.action)
    ||Object.keys(message).some(key=>!['type','action','packet','confirmation'].includes(key))
    ||(message.action==='confirm')!==Object.hasOwn(message,'confirmation'))throw new SingleDocumentError('PRODUCT_ACTION','전체 상품 견적 작업을 확인해주세요.');
  const context=await productDocumentIdentity(message.packet,sender,{allowExpired:!['preview','start'].includes(message.action)});
  if(message.action==='preview')return {format:context.packet.format,requestId:message.packet.requestId,identity:context.identity,
    fingerprint:context.packet.fingerprint,productId:context.packet.productId,members:context.identity.members,
    identityDigest:context.identityDigest,packetDigest:context.packetDigest,reviewDigest:message.packet.review.reviewDigest,
    preparedBodySha256:context.bodySha256,originalBodySha256:context.originalBodySha256,
    liveVerified:PRODUCT_DOCUMENT_LIVE_VERIFIED,remoteWrites:false,registered:false};
  if(!PRODUCT_DOCUMENT_LIVE_VERIFIED)throw new SingleDocumentError('PRODUCT_LIVE_CONTRACT_UNVERIFIED','전체 상품 견적의 실제 접수 연결을 검수 중입니다. 현재 상품은 전송하지 않았습니다.');
  receiver??=createProductDocumentReceiver({adapter:createProductDocumentBrowserAdapter(),store:createProductDocumentStore()});
  return message.action==='confirm'?receiver.confirm(message.packet,sender,message.confirmation):receiver[message.action](message.packet,sender);
}
