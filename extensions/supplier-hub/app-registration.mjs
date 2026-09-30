import {validateAppHubRequest} from './app-request.mjs';
import {isSupplierHubTab,waitForSupplierHubPage,supplierHubStatusReady} from './hub-tab.mjs';
import {transferRecord,resultKey} from './handoff-store.mjs';
import {verifySupplierHubCompany} from './company.mjs';
import {searchSupplierHubRegistration} from './registration-search.mjs';
import {readSupplierHubRegistration} from './registration-result.mjs';

const activeWindows=new Set();
export async function refreshSupplierHubRegistration(message,sender,api=chrome,store=transferRecord){
  const identity=validateAppHubRequest(message,sender,'YOOFAM_REFRESH_REGISTRATION'),windowId=sender.tab.windowId;
  if(activeWindows.has(windowId))throw Error('이 Chrome 창에서 상품별 상태를 조회 중입니다.');
  activeWindows.add(windowId);
  try{
    const key=resultKey(identity),saved=await store('get',key);
    if(!saved||!['origin','productId','categoryId','fingerprint'].every(field=>saved[field]===identity[field])
      ||saved.filename!==`YOOFAM-${identity.fingerprint}.xlsx`||saved.state!=='validation-complete'||saved.registered!==false
      ||typeof saved.quotationId!=='string'||!saved.quotationId.trim()||saved.quotationId!==saved.quotationId.trim()||saved.quotationId.length>200
      ||!Number.isSafeInteger(saved.includedOptions)||saved.includedOptions<1||saved.includedOptions>200)
      throw Error('이 견적서의 파일 검증 완료 결과와 견적서 ID를 먼저 불러와주세요.');
    const tabs=(await api.tabs.query({windowId})).filter(tab=>['/qvt/registration','/qvt/wims'].some(path=>isSupplierHubTab(tab,windowId,path)));
    const source=[],status=[];
    for(const tab of tabs){
      const attempt=await store('get',`attempt:${tab.id}`);
      if(!attempt||!['origin','productId','categoryId','fingerprint'].every(field=>attempt[field]===identity[field]))continue;
      if(attempt.company?.code!==saved.company?.code||attempt.company?.name!==saved.company?.name||attempt.includedOptions!==saved.includedOptions)throw Error('전송 기록과 검증 결과의 회사·옵션 수가 다릅니다.');
      if(attempt.purpose==='registration-status'&&attempt.quotationId===saved.quotationId&&isSupplierHubTab(tab,windowId,'/qvt/wims'))status.push(tab);
      else if(!attempt.purpose)source.push(tab);
    }
    if(status.length>1||(!status.length&&source.length!==1))throw Error('같은 Chrome 창에서 해당 견적서를 전송한 Supplier Hub 탭을 확인하지 못했습니다.');
    const tab=status[0]||source[0];let tabId=tab.id;
    const checkCompany=async(path)=>{
      if(!isSupplierHubTab(await api.tabs.get(tabId),windowId,path))throw Error('Supplier Hub 조회 탭의 창 또는 화면이 변경되었습니다.');
      const [execution]=await api.scripting.executeScript({target:{tabId},func:verifySupplierHubCompany,args:[saved.company]});
      if(execution?.result?.code!==saved.company?.code)throw Error('견적서 회사와 현재 Supplier Hub 회사코드가 다릅니다.');
      if(!isSupplierHubTab(await api.tabs.get(tabId),windowId,path))throw Error('Supplier Hub 조회 탭의 창 또는 화면이 변경되었습니다.');
    };
    await checkCompany(new URL(tab.url).pathname);
    if(!status.length){
      const fresh=await api.tabs.create({windowId,url:'https://supplier.coupang.com/qvt/wims',active:false});
      if(!Number.isSafeInteger(fresh?.id)||fresh.id<0||fresh.windowId!==windowId)throw Error('같은 Chrome 창에 견적서 조회 탭을 준비하지 못했습니다.');
      tabId=fresh.id;
      await waitForSupplierHubPage(tabId,windowId,'/qvt/wims',supplierHubStatusReady,api);
      await checkCompany('/qvt/wims');
      await store('put',`attempt:${tabId}`,{...identity,company:saved.company,includedOptions:saved.includedOptions,purpose:'registration-status',quotationId:saved.quotationId});
    }
    await checkCompany('/qvt/wims');
    const [searched]=await api.scripting.executeScript({target:{tabId},func:searchSupplierHubRegistration,args:[saved.quotationId,true]});
    if(searched?.result?.state!=='search-complete'||searched.result.quotationId!==saved.quotationId||searched.result.registered!==false)throw Error('견적서 ID 검색 결과를 확인하지 못했습니다.');
    await checkCompany('/qvt/wims');
    const [execution]=await api.scripting.executeScript({target:{tabId},func:readSupplierHubRegistration,args:[saved.quotationId]});
    const result=execution?.result;
    const fields=['title','submittedAt','category','barcode','sourceQuotation','skuId','status','stage'];
    if(!result||result.quotationId!==saved.quotationId||result.scope!=='visible-page'||result.registered!==false||!Array.isArray(result.rows)||result.rows.length>1000
      ||result.rows.some(row=>!row||fields.some(field=>typeof row[field]!=='string'||row[field].length>20000)))throw Error('견적서 ID에 해당하는 상품별 결과를 확인하지 못했습니다.');
    await checkCompany('/qvt/wims');
    const latest=await store('get',key);
    if(!latest||latest.state!=='validation-complete'||latest.quotationId!==saved.quotationId||latest.filename!==saved.filename||latest.company?.code!==saved.company?.code||latest.company?.name!==saved.company?.name
      ||latest.includedOptions!==saved.includedOptions||!['origin','productId','categoryId','fingerprint'].every(field=>latest[field]===identity[field]))throw Error('조회 중 견적서 검증 결과가 변경되었습니다. 결과를 저장하지 않았습니다.');
    const registration={...result,includedOptions:saved.includedOptions,observedAt:Date.now()};
    const record={...latest,registration};await store('put',key,record);return record;
  }finally{activeWindows.delete(windowId);}
}
