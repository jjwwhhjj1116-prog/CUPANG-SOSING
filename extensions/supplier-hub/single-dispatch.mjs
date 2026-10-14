import {singleDocumentIdentity,createSingleDocumentReceiver,createSingleDocumentStore,SingleDocumentError} from './single-document.mjs';
import {createSingleDocumentBrowserAdapter} from './single-document-adapter.mjs';
// Current Hub rows lack exact docId; readback and receipt remain unverified.
// This release gate is deliberately not a packet field.
export const SINGLE_DOCUMENT_LIVE_VERIFIED=false;
let receiver;
export async function dispatchSingleDocument(message,sender){
  if(!message||!['preview','start','resume','recover','confirm','observe'].includes(message.action)
    ||Object.keys(message).some(key=>!['type','action','packet','confirmation'].includes(key)))throw new SingleDocumentError('SINGLE_ACTION','개별 견적서 작업을 확인해주세요.');
  const context=await singleDocumentIdentity(message.packet,sender);
  if(message.action==='preview')return {format:context.packet.format,fingerprint:context.packet.fingerprint,productId:context.packet.productId,
    optionId:context.packet.optionId,identityDigest:context.identityDigest,preparedBodySha256:context.bodySha256,originalBodySha256:context.originalBodySha256,
    liveVerified:SINGLE_DOCUMENT_LIVE_VERIFIED,remoteWrites:false,registered:false};
  if(!SINGLE_DOCUMENT_LIVE_VERIFIED)throw new SingleDocumentError('SINGLE_LIVE_CONTRACT_UNVERIFIED','개별 등록 문서의 실제 접수 연결을 검수 중입니다. 현재 상품은 전송하지 않았습니다.');
  receiver??=createSingleDocumentReceiver({adapter:createSingleDocumentBrowserAdapter(),store:createSingleDocumentStore()});
  return message.action==='confirm'?receiver.confirm(message.packet,sender,message.confirmation):receiver[message.action](message.packet,sender);
}
