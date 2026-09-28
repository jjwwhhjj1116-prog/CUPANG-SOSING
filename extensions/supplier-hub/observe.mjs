import {searchSupplierHubRegistration} from './registration-search.mjs';
import {openSupplierHubRegistrationStatus} from './registration-navigation.mjs';
import {transferRecord,resultKey} from './handoff-store.mjs';
import {readSupplierHubValidation} from './result.mjs';
import {readSupplierHubRegistration} from './registration-result.mjs';
import {verifySupplierHubCompany} from './company.mjs';

const activeTabs=new Set();
export async function observeSupplierHubResult(message,sender){
  if(sender?.id!==chrome.runtime.id||sender?.url!==chrome.runtime.getURL('popup.html')||sender.tab)throw Error('확장 화면에서 결과를 확인해주세요.');
  if(!['validation','registration','registration-search'].includes(message.kind)||!Number.isSafeInteger(message.tabId)||message.tabId<0)throw Error('결과 조회 요청을 확인해주세요.');
  if(activeTabs.has(message.tabId))throw Error('이 탭의 결과를 확인 중입니다. 잠시 후 다시 확인해주세요.');
  activeTabs.add(message.tabId);
  try{
    const [tab]=await chrome.tabs.query({active:true,currentWindow:true});
    const path=message.kind!=='validation'?'/qvt/wims':'/qvt/registration';
    const allowedPaths=message.kind==='registration-search'?['/qvt/registration','/qvt/wims']:[path];
    if(tab?.id!==message.tabId||!tab.url||new URL(tab.url).origin!=='https://supplier.coupang.com'||!allowedPaths.includes(new URL(tab.url).pathname))throw Error('현재 창의 해당 Supplier Hub 결과 화면에서 실행해주세요.');
    const identity=await transferRecord('get',`attempt:${tab.id}`);
    // Legacy app attempts cannot infer their company from the current login.
    if(identity&&!identity.company)throw Error('전송 기록에 회사정보가 없습니다. 기존 견적서는 Supplier Hub에서 직접 확인해주세요.');
    const checkCompany=async()=>{
      const [execution]=await chrome.scripting.executeScript({target:{tabId:tab.id},func:verifySupplierHubCompany,args:identity?[identity.company]:[]});
      const code=execution?.result?.code;
      if(!code||(identity&&code!==identity.company.code))throw Error('전송한 회사와 현재 Supplier Hub 회사코드가 일치하지 않습니다.');
      return code;
    };
    const companyCode=await checkCompany();
    if(message.kind!=='validation'){
      if(!identity)throw Error('이 탭에서 전달한 상품 정보가 없습니다.');
      const key=resultKey(identity),saved=await transferRecord('get',key);
      if(saved?.company?.code!==identity.company.code||saved?.company?.name!==identity.company.name)throw Error('검증 결과의 회사정보가 일치하지 않습니다.');
      if(saved?.state!=='validation-complete'||!saved.quotationId||saved.filename!==`YOOFAM-${identity.fingerprint}.xlsx`)throw Error('먼저 대량 상품 등록 화면에서 해당 파일의 검증 완료 결과와 견적서 ID를 확인해주세요.');
      if(message.kind==='registration-search'){
        await openSupplierHubRegistrationStatus(tab.id);
        await checkCompany();
        const [execution]=await chrome.scripting.executeScript({target:{tabId:tab.id},func:searchSupplierHubRegistration,args:[saved.quotationId]});
        const result=execution?.result;
        if(result?.state!=='search-requested'||result.quotationId!==saved.quotationId||result.registered!==false)throw Error('검색 요청 결과를 확인하지 못했습니다. Supplier Hub 화면을 확인해주세요.');
        return result;
      }
      const [execution]=await chrome.scripting.executeScript({target:{tabId:tab.id},func:readSupplierHubRegistration,args:[saved.quotationId]});
      const result=execution?.result;
      if(!result||result.quotationId!==saved.quotationId||result.scope!=='visible-page'||result.registered!==false||!Array.isArray(result.rows))throw Error('상품별 결과를 확인하지 못했습니다.');
      await checkCompany();
      await transferRecord('put',key,{...saved,registration:{...result,observedAt:Date.now()}});
      return result;
    }
    const expectedFilename=identity&&/^[a-f0-9]{64}$/.test(identity.fingerprint)?`YOOFAM-${identity.fingerprint}.xlsx`:undefined;
    const [execution]=await chrome.scripting.executeScript({target:{tabId:tab.id},func:readSupplierHubValidation,args:expectedFilename?[expectedFilename]:[]});
    const result=execution?.result;
    if(!result||result.registered!==false||!['not-found','validation-complete','validation-rejected','validation-pending'].includes(result.state))throw Error('검증 결과를 확인하지 못했습니다.');
    if(await checkCompany()!==companyCode)throw Error('조회 중 Supplier Hub 회사가 변경되었습니다. 결과를 저장하지 않았습니다.');
    if(identity&&result.filename===`YOOFAM-${identity.fingerprint}.xlsx`){
      const key=resultKey(identity),previous=await transferRecord('get',key);
      // Refreshing file validation does not refresh or erase a matching SKU observation.
      // A different quotation or a non-complete validation must not inherit old rows.
      const keepRegistration=result.state==='validation-complete'&&previous?.state==='validation-complete'
        &&['origin','productId','categoryId','fingerprint'].every(field=>previous[field]===identity[field])
        &&previous.company?.code===identity.company.code&&previous.company?.name===identity.company.name
        &&previous.filename===result.filename&&typeof result.quotationId==='string'&&Boolean(result.quotationId.trim())
        &&previous.quotationId===result.quotationId&&previous.registration?.quotationId===result.quotationId;
      await transferRecord('put',key,{...identity,...result,company:identity.company,observedAt:Date.now(),...(keepRegistration?{registration:previous.registration}:{})});
    }
    return result;
  }finally{activeTabs.delete(message.tabId);}
}
