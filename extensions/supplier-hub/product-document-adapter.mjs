import {createSupplierHubDocumentBrowserAdapter} from './single-document-adapter.mjs';
import {nativeProductDocumentAppSourcePage} from './native-product-assets.mjs';

/** Same owned-tab adapter and native operations, with a trusted full-product
 * source verifier. Packet fields cannot select a looser adapter contract. */
export function createProductDocumentBrowserAdapter(options={}){
  return createSupplierHubDocumentBrowserAdapter(options,{wholeProduct:true});
}

/** Select native construction only after the current authenticated app source
 * independently proves the reviewed filename body. Packet fields alone never
 * select it. A fallback still runs the unchanged strict legacy source proof. */
export async function createVerifiedProductDocumentBrowserAdapter(context,{api=globalThis.chrome,now=Date.now}={}){
 const identity=context?.identity,input={identity,bodySha256:context?.originalBodySha256,preparedBodySha256:context?.bodySha256,packetDigest:context?.packetDigest,requestId:context?.packet?.requestId,docId:null};
 const current=async()=>{const tab=await api.tabs.get(identity.appTabId),url=new URL(tab.url);if(tab.id!==identity.appTabId||tab.windowId!==identity.windowId||tab.pendingUrl||url.origin!==identity.origin||url.username||url.password)throw Error('원래 앱의 승인된 창을 확인해주세요.');};
 try{
  await current();const [reply]=await api.scripting.executeScript({target:{tabId:identity.appTabId,frameIds:[0]},func:nativeProductDocumentAppSourcePage,args:[input]});await current();
  if(reply?.frameId!==undefined&&reply.frameId!==0||reply?.result?.current!==true||reply.result.sourcePlan?.sourcePlanSha256!==identity.fingerprint||reply.result.bodySha256!==input.bodySha256||reply.result.preparedBodySha256!==input.preparedBodySha256)throw Error('현재 네이티브 원본 계획을 확인하지 못했습니다.');
  return{adapter:createProductDocumentBrowserAdapter({api,now,nativeAssets:{sourcePlanSha256:identity.fingerprint}}),nativeAssets:true,sourcePlanSha256:identity.fingerprint};
 }catch{return{adapter:createProductDocumentBrowserAdapter({api,now}),nativeAssets:false,sourcePlanSha256:null};}
}
