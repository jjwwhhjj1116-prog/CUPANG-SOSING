import {requestSupplierHubValidation} from './validate.mjs';

const activeTabs=new Set();
/** Keep an explicitly requested validation alive independently of the popup. */
export async function dispatchSupplierHubValidation(message,sender){
  if(sender?.id!==chrome.runtime.id||sender?.url!==chrome.runtime.getURL('popup.html')||sender.tab)throw Error('확장 화면에서 검증을 요청해주세요.');
  if(!Number.isSafeInteger(message.tabId)||message.tabId<0)throw Error('검증할 탭을 확인해주세요.');
  if(activeTabs.has(message.tabId))throw Error('이 탭의 검증 요청을 처리 중입니다.');
  activeTabs.add(message.tabId);
  try{
    const [tab]=await chrome.tabs.query({active:true,currentWindow:true});
    if(tab?.id!==message.tabId||!tab.url||new URL(tab.url).origin!=='https://supplier.coupang.com'||new URL(tab.url).pathname!=='/qvt/registration')throw Error('현재 창의 Supplier Hub 대량 상품 등록 탭에서 실행해주세요.');
    const [execution]=await chrome.scripting.executeScript({target:{tabId:tab.id},func:requestSupplierHubValidation,args:[message.reviewedAgreements??{}]});
    const result=execution?.result;
    if(result?.state!=='validation-requested'||result.validated!==false||result.registered!==false)throw Error('검증 요청 결과를 확인하지 못했습니다. Supplier Hub에서 진행 상태를 확인해주세요.');
    return result;
  }finally{activeTabs.delete(message.tabId);}
}
