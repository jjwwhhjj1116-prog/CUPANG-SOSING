import {validateAppHubRequest} from './app-request.mjs';
import {isSupplierHubTab,waitForSupplierHubPage,supplierHubStatusReady} from './hub-tab.mjs';
import {transferRecord,resultKey,isAcceptedResult,isRecoverableSupplierHubResult,canPromoteSupplierHubReceipt} from './handoff-store.mjs';
import {readAppSupplierHubReceipt,readAppHistoricalSupplierHubReceipt,verifyHistoricalSupplierHubReceipt} from './receipt-recovery.mjs';
import {verifyAppQuotationSource} from './source-check.mjs';
import {verifySupplierHubCompany} from './company.mjs';
import {searchSupplierHubRegistration} from './registration-search.mjs';
import {readSupplierHubRegistration} from './registration-result.mjs';
import {collectSupplierHubRegistrationPages} from './registration-pages.mjs';
import {isRecoveredValidationBinding} from './validation-recovery.mjs';

const activeWindows=new Set();
export async function refreshSupplierHubRegistration(message,sender,api=chrome,store=transferRecord){
  const identity=validateAppHubRequest(message,sender,'YOOFAM_REFRESH_REGISTRATION'),windowId=sender.tab.windowId;
  if(activeWindows.has(windowId))throw Error('이 Chrome 창에서 상품별 상태를 조회 중입니다.');
  activeWindows.add(windowId);
  try{
    const key=resultKey(identity),local=await store('get',key),binding={appTabId:sender.tab.id,windowId};
    if(message.historical!==undefined&&message.historical!==true)throw Error('원래 전송 조회 선택을 확인해주세요.');
    const historical=message.historical===true;
    const readReceipt=()=>historical?readAppHistoricalSupplierHubReceipt(identity,binding,api,true):readAppSupplierHubReceipt(identity,binding,api);
    const original=historical?await readReceipt():null;
    if(historical&&!original)throw Error('원래 서버 접수 기록이 없습니다. 기존 Chrome 확장에서 결과를 확인해주세요.');
    const recovering=local!==undefined&&local!==null&&!isAcceptedResult(identity,local)&&isRecoverableSupplierHubResult(identity,local);
    if(local!==undefined&&local!==null&&!isAcceptedResult(identity,local)&&!recovering)
      throw Error('이 견적서의 파일 검증 완료 결과와 견적서 ID를 먼저 불러와주세요.');
    let restored=!local||recovering?original??await readReceipt():null,saved=recovering?restored:local||restored;
    if(historical&&saved){if(!['quotationId','filename','includedOptions'].every(field=>saved[field]===original[field])||saved.company.code!==original.company.code||saved.company.name!==original.company.name)throw Error('원래 접수 기록과 Chrome 결과가 다릅니다.');saved={...saved,historicalReceipt:true,receiptProductVersion:original.receiptProductVersion,profileId:original.profileId};}
    if(!saved)throw Error('이 견적서의 파일 검증 완료 결과와 견적서 ID를 먼저 불러와주세요.');
    if(recovering&&!canPromoteSupplierHubReceipt(identity,local,saved))throw Error('보관된 접수 결과와 이전 검증 기록의 회사·옵션·견적서가 다릅니다.');
    const tabs=(await api.tabs.query({windowId,url:['https://supplier.coupang.com/qvt/registration*','https://supplier.coupang.com/qvt/wims*']}))
      .filter(tab=>['/qvt/registration','/qvt/wims'].some(path=>isSupplierHubTab(tab,windowId,path)));
    const source=[],status=[];let recoveredValidationSource=false;
    for(const tab of tabs){
      const attempt=await store('get',`attempt:${tab.id}`);
      if(!attempt||!['origin','productId','categoryId','fingerprint'].every(field=>attempt[field]===identity[field]))continue;
      if(attempt.company?.code!==saved.company?.code||attempt.company?.name!==saved.company?.name||attempt.includedOptions!==saved.includedOptions)throw Error('전송 기록과 검증 결과의 회사·옵션 수가 다릅니다.');
      if(attempt.purpose==='registration-status'&&attempt.quotationId===saved.quotationId&&isSupplierHubTab(tab,windowId,'/qvt/wims'))status.push(tab);
      else if(attempt.purpose==='validation-status'){
        if(!isSupplierHubTab(tab,windowId,'/qvt/registration')||!isRecoveredValidationBinding(attempt,identity)
          ||attempt.profileId!==saved.profileId||attempt.filename!==saved.filename)throw Error('복구한 검증 조회 탭과 접수 결과의 원래 견적서가 다릅니다.');
        source.push(tab);recoveredValidationSource=true;
      }
      else if(!attempt.purpose)source.push(tab);
    }
    if(status.length>1||(!status.length&&source.length>1))throw Error('같은 Chrome 창에서 해당 견적서를 전송한 Supplier Hub 탭을 확인하지 못했습니다.');
    if(!status.length&&!source.length){
      restored||=await readReceipt();
      if(!restored||!['quotationId','filename','includedOptions'].every(field=>restored[field]===saved[field])
        ||restored.company.code!==saved.company.code||restored.company.name!==saved.company.name)
        throw Error('Chrome 전송 기록과 앱에 보관된 접수 결과가 다릅니다.');
      saved={...saved,profileId:restored.profileId,receiptRecovered:true};
    }
    const tab=status[0]||source[0];
    let tabId=tab?.id;
    const checkSource=()=>historical?verifyHistoricalSupplierHubReceipt(identity,saved,binding,api):saved.receiptRecovered||recoveredValidationSource||isRecoveredValidationBinding(saved,identity)?verifyAppQuotationSource(identity,saved,binding,api):Promise.resolve(true);
    const checkCompany=async(path)=>{
      if(!isSupplierHubTab(await api.tabs.get(tabId),windowId,path))throw Error('Supplier Hub 조회 탭의 창 또는 화면이 변경되었습니다.');
      const [execution]=await api.scripting.executeScript({target:{tabId},func:verifySupplierHubCompany,args:[saved.company]});
      if(execution?.result?.code!==saved.company?.code)throw Error('견적서 회사와 현재 Supplier Hub 회사코드가 다릅니다.');
      if(!isSupplierHubTab(await api.tabs.get(tabId),windowId,path))throw Error('Supplier Hub 조회 탭의 창 또는 화면이 변경되었습니다.');
    };
    const createStatusTab=async()=>{
      const fresh=await api.tabs.create({windowId,url:'https://supplier.coupang.com/qvt/wims',active:false});
      if(!Number.isSafeInteger(fresh?.id)||fresh.id<0||fresh.windowId!==windowId)throw Error('같은 Chrome 창에 견적서 조회 탭을 준비하지 못했습니다.');
      tabId=fresh.id;
      await waitForSupplierHubPage(tabId,windowId,'/qvt/wims',supplierHubStatusReady,api);
      await checkCompany('/qvt/wims');
    };
    if(tab)await checkCompany(new URL(tab.url).pathname);
    await checkSource();
    // With the original tab closed, an authenticated exact receipt and source
    // suffice to reopen a read-only status page in this same Chrome window.
    // Its live login/company must still match before claiming or searching.
    if(!tab)await createStatusTab();
    if(!local||recovering){
      if(!await store(recovering?'promote':'claim',key,recovering?{expected:local,accepted:saved}:saved)){
        const concurrent=await store('get',key);
        if(!isAcceptedResult(identity,concurrent)||!['quotationId','filename','includedOptions'].every(field=>concurrent[field]===saved[field])
          ||concurrent.company.code!==saved.company.code||concurrent.company.name!==saved.company.name)
          throw Error('접수 결과 복구 중 다른 견적서 결과가 저장되었습니다.');
      }
    }
    if(!status.length){
      if(tab)await createStatusTab();
      await store('put',`attempt:${tabId}`,{...identity,company:saved.company,includedOptions:saved.includedOptions,purpose:'registration-status',quotationId:saved.quotationId});
    }
    await checkCompany('/qvt/wims');
    await checkSource();
    const observationBase=await store('get',key);
    if(!isAcceptedResult(identity,observationBase)||observationBase.quotationId!==saved.quotationId||observationBase.filename!==saved.filename
      ||observationBase.company.code!==saved.company.code||observationBase.company.name!==saved.company.name||observationBase.includedOptions!==saved.includedOptions)
      throw Error('상품별 조회를 시작하기 전에 견적서 검증 결과가 변경되었습니다.');
    const [searched]=await api.scripting.executeScript({target:{tabId},func:searchSupplierHubRegistration,args:[saved.quotationId,true]});
    if(searched?.result?.state!=='search-complete'||searched.result.quotationId!==saved.quotationId||searched.result.registered!==false)throw Error('견적서 ID 검색 결과를 확인하지 못했습니다.');
    const checkCurrent=async()=>{
      await checkCompany('/qvt/wims');
      await checkSource();
      const current=await store('get',key);
      if(!isAcceptedResult(identity,current)||current.quotationId!==saved.quotationId||current.filename!==saved.filename||current.company?.code!==saved.company?.code||current.company?.name!==saved.company?.name
        ||current.includedOptions!==saved.includedOptions||!['origin','productId','categoryId','fingerprint'].every(field=>current[field]===identity[field])
        ||JSON.stringify(current)!==JSON.stringify(observationBase))throw Error('조회 중 견적서 검증 결과가 변경되었습니다. 결과를 저장하지 않았습니다.');
    };
    const readPage=async(advanceFrom)=>{
      const [execution]=await api.scripting.executeScript({target:{tabId},func:readSupplierHubRegistration,args:[saved.quotationId,{company:saved.company,...(advanceFrom?{advanceFrom}:{})}]});
      return execution?.result;
    };
    const result=await collectSupplierHubRegistrationPages(saved.quotationId,saved.includedOptions,{check:checkCurrent,read:()=>readPage(),advance:readPage});
    await checkCurrent();
    const registration={...result,includedOptions:saved.includedOptions,observedAt:Date.now()};
    const record={...observationBase,...(saved.receiptRecovered?{profileId:saved.profileId,receiptRecovered:true}:{}),registration};
    if(!await store('register',key,{expected:observationBase,observation:record}))throw Error('조회 중 더 최신 상품별 결과가 저장되었습니다. 기존 결과를 유지했습니다.');
    return record;
  }finally{activeWindows.delete(windowId);}
}
