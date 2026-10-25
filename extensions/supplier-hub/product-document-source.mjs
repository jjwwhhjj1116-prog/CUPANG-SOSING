const resources={'catalog-context':'/api/supplier-hub/catalog-context','native-assets':'/api/products/:id/native-assets','single-package':'/api/products/:id/supplier-hub-single-package','receipt-history':'/api/products/:id/supplier-hub-receipt','product-receipt':'/api/products/:id/supplier-hub-product-receipt','legal-documents':'/api/products/:id/legal-documents'};
const messages={SOURCE_READ_TIMEOUT:'현재 전송 원본 조회 시간이 초과됐습니다.',SOURCE_READ_NETWORK:'현재 전송 원본 서버에 연결하지 못했습니다.',SOURCE_READ_RESPONSE:'현재 전송 원본의 JSON·파일 응답을 확인하지 못했습니다.',SOURCE_CONTRACT_MISMATCH:'현재 원본 계획이 검토한 전송 자료와 다릅니다.',SOURCE_CHANGED:'현재 회원·회사·저장한 견적서가 준비한 자료와 다릅니다.',SOURCE_BRIDGE_UNAVAILABLE:'앱의 전송 원본 확인 기능에 연결하지 못했습니다. 확장을 새로고침한 뒤 앱 페이지를 다시 열어주세요.'};
/** Only bounded machine facts cross the source bridge. Never expose a server
 * body, exception text, account, product ID, private key or request URL. */
export function normalizeSourceReadFailure(value){
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(key=>!['code','resource','status'].includes(key))||typeof value.code!=='string'||!(Object.hasOwn(messages,value.code)||value.code==='SOURCE_READ_HTTP')
  ||value.resource!==undefined&&!Object.hasOwn(resources,value.resource)||value.code==='SOURCE_READ_HTTP'&&(!Number.isSafeInteger(value.status)||value.status<300||value.status>599)||value.code!=='SOURCE_READ_HTTP'&&value.status!==undefined)return null;
 return{code:value.code,...(value.resource?{resource:value.resource}:{}),...(value.status!==undefined?{status:value.status}:{})};
}
export function sourceReadError(value){
 const failure=normalizeSourceReadFailure(value)??{code:'SOURCE_CHANGED'},detail=[failure.resource?'GET '+resources[failure.resource]:null,failure.status?'HTTP '+failure.status:null].filter(Boolean).join(', ');
 const error=new Error((failure.code==='SOURCE_READ_HTTP'?'현재 전송 원본 조회 요청이 실패했습니다.':messages[failure.code])+(detail?' ('+detail+')':'')+' 현재 자료 확인을 중단했습니다.');
 error.code=failure.code;error.sourceFailure=failure;return error;
}
export async function currentSourceAppTab(api,identity,sourceAppTabId){
 const id=sourceAppTabId??identity.appTabId;
 if(!Number.isSafeInteger(identity.appTabId)||identity.appTabId<0||!Number.isSafeInteger(identity.windowId)||identity.windowId<0||!Number.isSafeInteger(id)||id<0)throw sourceReadError({code:'SOURCE_CHANGED'});
 if(id!==identity.appTabId){
  const tabs=await api.tabs.query({});
  if(!Array.isArray(tabs)||tabs.some(tab=>tab.id===identity.appTabId))throw sourceReadError({code:'SOURCE_CHANGED'});
 }
 const tab=await api.tabs.get(id),url=new URL(tab.url);
 if(tab.id!==id||tab.windowId!==identity.windowId||tab.pendingUrl||url.origin!==identity.origin||url.username||url.password)throw sourceReadError({code:'SOURCE_CHANGED'});
 return tab;
}
export async function readAppDocumentSource(api,identity,input,kind='native',sourceAppTabId){
 if(sourceAppTabId!==undefined)await currentSourceAppTab(api,identity,sourceAppTabId);
 let response;try{response=await api.tabs.sendMessage(sourceAppTabId??identity.appTabId,{type:kind==='native'?'YOOFAM_READ_NATIVE_PRODUCT_DOCUMENT_SOURCE':'YOOFAM_READ_LEGACY_PRODUCT_DOCUMENT_SOURCE',expected:structuredClone(input)},{frameId:0});}
 catch{throw sourceReadError({code:'SOURCE_BRIDGE_UNAVAILABLE'});}
 if(response?.ok!==true){if(!response||typeof response!=='object')throw sourceReadError({code:'SOURCE_BRIDGE_UNAVAILABLE'});throw sourceReadError(response.sourceFailure);}
 if(!response.result||typeof response.result!=='object'||Array.isArray(response.result))throw sourceReadError({code:'SOURCE_READ_RESPONSE'});
 if(sourceAppTabId!==undefined)await currentSourceAppTab(api,identity,sourceAppTabId);
 return response.result;
}
