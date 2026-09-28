import {prepareAttachments} from './package.mjs';
import {attachToSupplierHub} from './attach.mjs';
import {pendingPackage,transferRecord} from './handoff-store.mjs';
import {verifySupplierHubCompany} from './company.mjs';

// Own the app-package dispatch in the worker rather than in the disposable popup.
// This is a single user-requested attempt, never an automatic upload retry.
export async function dispatchPendingPackage(message,sender){
  if(sender?.id!==chrome.runtime.id||sender?.url!==chrome.runtime.getURL('popup.html')||sender.tab)
    throw Error('첨부 확장 화면에서 실행해주세요.');
  if(!Number.isSafeInteger(message.tabId)||message.tabId<0||!/^[a-f0-9]{64}$/.test(message.fingerprint||''))
    throw Error('전달할 탭과 견적서를 확인해주세요.');
  const [tab]=await chrome.tabs.query({active:true,currentWindow:true});
  if(tab?.id!==message.tabId||!tab.url||new URL(tab.url).origin!=='https://supplier.coupang.com'||new URL(tab.url).pathname!=='/qvt/registration')
    throw Error('현재 창의 Supplier Hub 대량 상품 등록 탭에서 실행해주세요.');
  const saved=await pendingPackage('get');
  if(!saved||saved.fingerprint!==message.fingerprint)throw Error('다른 견적서가 준비되었거나 이미 전달을 시도했습니다. 앱에서 확인해주세요.');
  if(!Number.isFinite(saved.createdAt)||Date.now()-saved.createdAt>15*60*1000||saved.createdAt>Date.now()+60000)
    throw Error('준비한 견적서가 만료되었습니다. 앱에서 다시 준비해주세요.');
  const prepared=await prepareAttachments(Uint8Array.from(atob(saved.base64),c=>c.charCodeAt(0)));
  if(prepared.productId!==saved.productId||prepared.categoryId!==saved.categoryId||prepared.quotation[0]?.name!==`YOOFAM-${saved.fingerprint}.xlsx`)
    throw Error('앱에서 검토한 견적서와 파일이 일치하지 않습니다.');
  const [companyCheck]=await chrome.scripting.executeScript({target:{tabId:tab.id},func:verifySupplierHubCompany,args:[prepared.company]});
  if(companyCheck?.result?.code!==prepared.company.code)throw Error('Supplier Hub 회사코드를 확인하지 못했습니다.');
  if(!await pendingPackage('delete',saved.fingerprint))throw Error('이미 전달을 시도했거나 준비된 파일이 변경되었습니다.');
  const [execution]=await chrome.scripting.executeScript({target:{tabId:tab.id},func:attachToSupplierHub,args:[prepared]});
  const result=execution?.result;
  if(!result||!['dispatched','partial'].includes(result.state)||result.registered!==false)
    throw Error('전달 결과를 확인하지 못했습니다. Supplier Hub 첨부 목록을 확인해주세요. 자동 재전송하지 않습니다.');
  if(result.state==='dispatched'){
    const {origin,productId,categoryId,fingerprint}=saved;
    await transferRecord('put',`attempt:${tab.id}`,{origin,productId,categoryId,fingerprint});
  }
  return result;
}
