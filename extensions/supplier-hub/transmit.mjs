import {validateHandoff,transferRecord} from './handoff-store.mjs';
import {validateAppHubRequest,isHubRegistrationTab} from './app-request.mjs';
import {prepareAttachments} from './package.mjs';
import {verifySupplierHubCompany} from './company.mjs';
import {attachToSupplierHub} from './attach.mjs';
import {requestSupplierHubValidation} from './validate.mjs';
import {waitForSupplierHubPage,supplierHubUploadReady} from './hub-tab.mjs';
import {verifyAppQuotationSource} from './source-check.mjs';

const activeWindows=new Set();
export async function transmitSupplierHubPackage(message,sender,api=chrome,store=transferRecord){
  const identity=validateAppHubRequest(message,sender,'YOOFAM_TRANSMIT_PACKAGE');
  const reviewed=message.reviewedAgreements;
  const choices=['priceData','labelBusinessContact','legalDocumentsNotApplicable'];
  if(!reviewed||typeof reviewed!=='object'||Array.isArray(reviewed)
    ||Object.keys(reviewed).length!==choices.length||choices.some(key=>reviewed[key]!==true))
    throw Error('가격 정보·라벨 연락처 동의와 법적 서류 해당없음 선택을 확인해주세요. 법적 서류가 필요한 상품은 Supplier Hub에서 서류를 함께 첨부해야 합니다.');
  const packageValue=validateHandoff({...message,type:'YOOFAM_PREPARE_PACKAGE'},sender);
  const windowId=sender.tab.windowId;
  if(activeWindows.has(windowId))throw Error('이 Chrome 창에서 다른 견적서를 전송 중입니다.');
  activeWindows.add(windowId);
  try{
    const prepared=await prepareAttachments(Uint8Array.from(atob(packageValue.base64),c=>c.charCodeAt(0)));
    if(prepared.productId!==identity.productId||prepared.categoryId!==identity.categoryId
      ||prepared.quotation[0]?.name!==`YOOFAM-${identity.fingerprint}.xlsx`)throw Error('검토한 상품·카테고리와 첨부 견적서가 다릅니다.');
    const sourceCheck=()=>verifyAppQuotationSource(identity,prepared,{appTabId:sender.tab.id,windowId},api);
    await sourceCheck();
    const key=`transmission:${identity.origin}:${identity.productId}:${identity.categoryId}:${identity.fingerprint}`;
    if(await store('get',key))throw Error('이 견적서는 이미 전송을 시도했습니다. 검증 결과를 확인해주세요. 자동으로 다시 첨부하지 않습니다.');
    const tabs=(await api.tabs.query({windowId})).filter(tab=>isHubRegistrationTab(tab,windowId));
    const unused=[],owned=[];
    for(const tab of tabs){
      const attempt=await store('get',`attempt:${tab.id}`);
      if(!attempt)unused.push(tab);
      else if(attempt.origin===identity.origin&&attempt.company?.code===prepared.company.code&&attempt.company?.name===prepared.company.name)owned.push(tab);
    }
    if(unused.length>1||(!unused.length&&!owned.length))throw Error('앱과 같은 Chrome 창의 Supplier Hub 대량 상품 등록 탭을 확인해주세요. 작업 중인 탭이 여러 개면 사용할 탭을 하나 남겨주세요.');
    let tabId=(unused[0]||owned[0]).id;
    const current=async()=>{const tab=await api.tabs.get(tabId);if(!isHubRegistrationTab(tab,windowId))throw Error('Supplier Hub 탭이 이동되거나 등록 화면이 변경되었습니다.');};
    const companyCheck=async()=>{
      await current();
      const [execution]=await api.scripting.executeScript({target:{tabId},func:verifySupplierHubCompany,args:[prepared.company]});
      if(execution?.result?.code!==prepared.company.code)throw Error('회원 회사와 Supplier Hub 회사코드가 일치하지 않습니다.');
      await current();
    };
    await companyCheck();
    let preflight;
    if(unused.length)[preflight]=await api.scripting.executeScript({target:{tabId},func:attachToSupplierHub,args:[prepared,true]});
    if(!unused.length||preflight?.result?.state==='occupied'){
      // Preserve the original file inputs, agreements and validation history.
      await companyCheck();
      const fresh=await api.tabs.create({windowId,url:'https://supplier.coupang.com/qvt/registration',active:false});
      if(!Number.isSafeInteger(fresh?.id)||fresh.id<0||fresh.windowId!==windowId)throw Error('같은 Chrome 창에 새 등록 탭을 준비하지 못했습니다.');
      tabId=fresh.id;
      await waitForSupplierHubPage(tabId,windowId,'/qvt/registration',supplierHubUploadReady,api);
      await companyCheck();
      [preflight]=await api.scripting.executeScript({target:{tabId},func:attachToSupplierHub,args:[prepared,true]});
    }
    if(preflight?.result?.state!=='ready'||preflight.result.registered!==false)throw Error('Supplier Hub 첨부 화면을 확인하지 못했습니다.');
    await current();
    await sourceCheck();
    const record={...identity,company:prepared.company,includedOptions:prepared.includedOptions,tabId,windowId,startedAt:Date.now(),state:'started',registered:false};
    // Atomic persisted claim survives a closed app tab or a restarted worker.
    if(!await store('claim',key,record))throw Error('이 견적서는 이미 전송을 시도했습니다. 검증 결과를 확인해주세요. 자동으로 다시 첨부하지 않습니다.');
    let attached=false;
    try{
      await current();
      const [execution]=await api.scripting.executeScript({target:{tabId},func:attachToSupplierHub,args:[prepared]});
      const result=execution?.result;
      if(!result||!['dispatched','partial'].includes(result.state)||result.registered!==false)throw Error('파일 전달 결과를 확인하지 못했습니다. Supplier Hub 첨부 목록을 확인해주세요.');
      if(result.state==='partial'){
        const outcome={state:'partial',registered:false,error:result.error||'첨부 일부만 전달했습니다. Supplier Hub에서 파일을 확인해주세요.'};
        await store('put',key,{...record,...outcome});return outcome;
      }
      attached=true;
      await store('put',`attempt:${tabId}`,{...identity,company:prepared.company,includedOptions:prepared.includedOptions});
      await store('put',key,{...record,state:'attached'});
      await companyCheck();
      const names=[...prepared.quotation,...prepared.productImages,...prepared.labelImages].map(file=>file.name);
      const [ready]=await api.scripting.executeScript({target:{tabId},func:waitForSupplierHubAttachments,args:[names,prepared.company]});
      if(ready?.result!==true)throw Error('파일 업로드 완료를 확인하지 못했습니다. Supplier Hub 첨부 목록을 확인해주세요.');
      await companyCheck();
      await sourceCheck();
      const [validation]=await api.scripting.executeScript({target:{tabId},func:requestSupplierHubValidation,args:[reviewed,true]});
      const outcome=validation?.result;
      if(outcome?.state!=='validation-requested'||outcome.validated!==false||outcome.registered!==false)throw Error('파일 검증 요청 결과를 확인하지 못했습니다. Supplier Hub 진행상태를 확인해주세요.');
      await store('put',key,{...record,...outcome});return outcome;
    }catch(error){
      const outcome={state:attached?'attached':'unconfirmed',registered:false,error:String(error?.message||error)};
      await store('put',key,{...record,...outcome});return outcome;
    }
  }finally{activeWindows.delete(windowId);}
}

// Wait only for the files from this attempt. Never retry an upload or read cookies.
export async function waitForSupplierHubAttachments(names,company){
  if(!Array.isArray(names)||!names.length||names.some(name=>typeof name!=='string'))throw Error('첨부 목록을 확인해주세요.');
  for(let attempt=0;attempt<80;attempt++){
    if(location.origin!=='https://supplier.coupang.com'||location.pathname!=='/qvt/registration')throw Error('Supplier Hub 등록 화면이 변경되었습니다.');
    const codes=Array.from((document.body.innerText||'').matchAll(/Company Code:\s*(A\d+)\b/g),match=>match[1]);
    if(codes.length!==1||codes[0]!==company?.code)throw Error('업로드 중 Supplier Hub 회사가 변경되었습니다.');
    let value;try{value=JSON.parse(document.documentElement.dataset.yoofamAttachmentAttempt||'');}catch{throw Error('첨부 시도 기록이 없습니다.');}
    if(value.state!=='dispatched'||value.company?.code!==company.code||value.company?.name!==company.name
      ||!Array.isArray(value.files)||value.files.length!==names.length||value.files.some((name,index)=>name!==names[index]))throw Error('다른 파일이 첨부되었거나 검증을 이미 요청했습니다.');
    const visible=(document.body.innerText||'').split(/[\s<>"'(),;]+/);
    if(names.every(name=>visible.includes(name)))return true;
    await new Promise(resolve=>setTimeout(resolve,250));
  }
  return false;
}
