import {prepareAttachments} from './package.mjs';
import {attachToSupplierHub} from './attach.mjs';
import {pendingPackage,transferRecord,resultKey} from './handoff-store.mjs';
import {verifySupplierHubCompany} from './company.mjs';
import {verifyAppQuotationSource} from './source-check.mjs';
import {claimSupplierHubTransmissionWindow} from './transmission-window.mjs';

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
  const release=claimSupplierHubTransmissionWindow(tab.windowId);
  try{
    const saved=await pendingPackage('get');
    if(!saved||saved.fingerprint!==message.fingerprint)throw Error('다른 견적서가 준비되었거나 이미 전달을 시도했습니다. 앱에서 확인해주세요.');
    if(!Number.isFinite(saved.createdAt)||Date.now()-saved.createdAt>15*60*1000||saved.createdAt>Date.now()+60000)
      throw Error('준비한 견적서가 만료되었습니다. 앱에서 다시 준비해주세요.');
    const prepared=await prepareAttachments(Uint8Array.from(atob(saved.base64),c=>c.charCodeAt(0)));
    if(prepared.productId!==saved.productId||prepared.categoryId!==saved.categoryId||prepared.quotation[0]?.name!==`YOOFAM-${saved.fingerprint}.xlsx`)
      throw Error('앱에서 검토한 견적서와 파일이 일치하지 않습니다.');
    if(!Number.isSafeInteger(saved.windowId)||tab.windowId!==saved.windowId)throw Error('견적서를 준비한 앱과 같은 Chrome 창에서 전달해주세요.');
    await verifyAppQuotationSource(saved,prepared,saved);
    const [companyCheck]=await chrome.scripting.executeScript({target:{tabId:tab.id},func:verifySupplierHubCompany,args:[prepared.company]});
    if(companyCheck?.result?.code!==prepared.company.code)throw Error('Supplier Hub 회사코드를 확인하지 못했습니다.');
    const {origin,productId,categoryId,fingerprint}=saved;
    const identity={origin,productId,categoryId,fingerprint,company:prepared.company,includedOptions:prepared.includedOptions};
    const key=`transmission:${origin}:${productId}:${categoryId}:${fingerprint}`;
    if(await transferRecord('get',key))throw Error('이 견적서는 이미 전송을 시도했습니다. 검증 결과를 확인해주세요. 자동으로 다시 첨부하지 않습니다.');
    if(await transferRecord('get',resultKey(identity)))throw Error('이 견적서는 이미 접수 결과가 있습니다. 상품별 상태를 조회해주세요. 다시 첨부하지 않습니다.');
    const [preflight]=await chrome.scripting.executeScript({target:{tabId:tab.id},func:attachToSupplierHub,args:[prepared,true]});
    if(preflight?.result?.state!=='ready'||preflight.result.registered!==false)
      throw Error('기존 작업 보호를 위해 전달하지 않았습니다. 첨부가 없는 Supplier Hub 등록 화면을 확인해주세요.');
    await verifyAppQuotationSource(saved,prepared,saved);
    if(!await pendingPackage('delete',saved.fingerprint))throw Error('이미 전달을 시도했거나 준비된 파일이 변경되었습니다.');
    const record={...identity,tabId:tab.id,windowId:tab.windowId,startedAt:Date.now(),state:'started',registered:false};
    // The app and popup share one durable claim. Closing the popup, preparing
    // again or switching delivery paths cannot replay the same attachments.
    if(!await transferRecord('claim',key,record))throw Error('이 견적서는 이미 전송을 시도했습니다. 검증 결과를 확인해주세요. 자동으로 다시 첨부하지 않습니다.');
    try{
      await transferRecord('put',`attempt:${tab.id}`,identity);
      const [execution]=await chrome.scripting.executeScript({target:{tabId:tab.id},func:attachToSupplierHub,args:[prepared]});
      const result=execution?.result;
      if(!result||!['dispatched','partial'].includes(result.state)||result.registered!==false)
        throw Error('전달 결과를 확인하지 못했습니다. Supplier Hub 첨부 목록을 확인해주세요. 자동 재전송하지 않습니다.');
      await transferRecord('put',key,{...record,state:result.state==='dispatched'?'attached':'partial',...(result.error?{error:String(result.error)}:{})});
      return result;
    }catch(error){
      await transferRecord('put',key,{...record,state:'unconfirmed',error:String(error?.message||error)});
      throw error;
    }
  }finally{release();}
}
