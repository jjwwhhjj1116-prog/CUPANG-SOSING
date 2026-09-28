import {prepareAttachments} from './package.mjs';
import {attachToSupplierHub} from './attach.mjs';
import {pendingPackage,transferRecord} from './handoff-store.mjs';
const picker=document.querySelector('#package'),button=document.querySelector('#attach'),status=document.querySelector('#status'),summary=document.querySelector('#summary');
let prepared=null,sequence=0,pendingFingerprint=null,pendingExpires=0;
let packageIdentity=null;
async function loadPending(){
  const version=sequence;
  try{
    const saved=await pendingPackage('get');if(!saved||version!==sequence)return;
    if(!Number.isFinite(saved.createdAt)||Date.now()-saved.createdAt>15*60*1000){await pendingPackage('delete',saved.fingerprint);status.textContent='준비한 견적서가 만료되었습니다. 앱에서 다시 준비해주세요.';return;}
    const result=await prepareAttachments(Uint8Array.from(atob(saved.base64),c=>c.charCodeAt(0)));
    if(result.productId!==saved.productId||result.categoryId!==saved.categoryId||result.quotation[0].name!==`YOOFAM-${saved.fingerprint}.xlsx`)throw Error('앱에서 검토한 견적서와 파일이 일치하지 않습니다.');
    if(version!==sequence)return;
    prepared=result;pendingFingerprint=saved.fingerprint;pendingExpires=saved.createdAt+15*60*1000;
    packageIdentity={origin:saved.origin,productId:saved.productId,categoryId:saved.categoryId,fingerprint:saved.fingerprint};
    summary.textContent=`앱에서 준비한 상품 ${saved.productId}\n카테고리 ${result.categoryId}\nExcel 1개 · 상품 이미지 ${result.productImages.length}개 · 라벨 ${result.labelImages.length}개`;
    button.disabled=false;status.textContent='현재 Supplier Hub 회사 계정과 파일 목록을 확인한 뒤 전달하세요.';
  }catch(error){if(version===sequence)status.textContent=error.message;}
}
void loadPending();
const validateButton=document.querySelector('#validate');
const resultButton=document.querySelector('#result');
const registrationButton=document.querySelector('#registration-result');
registrationButton.addEventListener('click',async()=>{
  if(registrationButton.disabled||picker.disabled)return;
  ++sequence;registrationButton.disabled=true;picker.disabled=true;button.disabled=true;validateButton.disabled=true;resultButton.disabled=true;
  try{
    const [tab]=await chrome.tabs.query({active:true,currentWindow:true});
    if(!tab?.id||!tab.url||new URL(tab.url).origin!=='https://supplier.coupang.com'||new URL(tab.url).pathname!=='/qvt/wims')throw Error('파일을 전달한 같은 탭에서 상품 등록 상태 확인 화면을 열어주세요.');
    const response=await chrome.runtime.sendMessage({type:'YOOFAM_OBSERVE_RESULT',tabId:tab.id,kind:'registration'});
    if(!response?.ok)throw Error(response?.error||'결과 조회 응답이 없습니다. 앱에서 저장된 결과를 확인해주세요.');
    const result=response.result;
    status.textContent=`견적서 ID: ${result.quotationId}\n현재 페이지에서 ${result.rows.length}개 확인\n`+result.rows.map(row=>`${row.title}: ${row.status} · ${row.stage} · SKU ${row.skuId||'미표시'}`).join('\n')+'\n현재 페이지의 결과이며 전체 옵션의 등록 완료를 뜻하지 않습니다.';
  }catch(error){status.textContent=error.message;}
  finally{registrationButton.disabled=false;picker.disabled=false;button.disabled=!prepared;validateButton.disabled=false;resultButton.disabled=false;}
});
resultButton.addEventListener('click',async()=>{
  if(resultButton.disabled||validateButton.disabled||picker.disabled)return;
  ++sequence;resultButton.disabled=true;validateButton.disabled=true;button.disabled=true;picker.disabled=true;
  try{
    const [tab]=await chrome.tabs.query({active:true,currentWindow:true});
    if(!tab?.id||!tab.url||new URL(tab.url).origin!=='https://supplier.coupang.com'||new URL(tab.url).pathname!=='/qvt/registration')throw Error('현재 창의 Supplier Hub 대량 상품 등록 탭에서 실행해주세요.');
    const response=await chrome.runtime.sendMessage({type:'YOOFAM_OBSERVE_RESULT',tabId:tab.id,kind:'validation'});
    if(!response?.ok)throw Error(response?.error||'결과 조회 응답이 없습니다. 앱에서 저장된 결과를 확인해주세요.');
    const result=response.result;
    status.textContent=result.state==='not-found'?'전달한 견적서의 결과가 아직 목록에 없습니다. Supplier Hub 안내에 따르면 검증은 최대 2시간 걸릴 수 있습니다.':`견적서: ${result.filename}\n검증 상태: ${result.status}\n견적서 ID: ${result.quotationId||'아직 표시되지 않음'}\n${result.detail}\n검증 완료 후에도 상품별 등록 상태를 별도로 확인해야 합니다.`;
  }catch(error){status.textContent=error.message;}
  finally{resultButton.disabled=false;validateButton.disabled=false;picker.disabled=false;button.disabled=!prepared;}
});
validateButton.addEventListener('click',async()=>{
  if(validateButton.disabled)return;
  ++sequence; // Ignore an in-flight package read while validation owns the popup.
  validateButton.disabled=true;button.disabled=true;picker.disabled=true;
  try{
    const [tab]=await chrome.tabs.query({active:true,currentWindow:true});
    if(!tab?.id||!tab.url||new URL(tab.url).origin!=='https://supplier.coupang.com'||new URL(tab.url).pathname!=='/qvt/registration')throw Error('현재 창의 Supplier Hub 대량 상품 등록 탭에서 실행해주세요.');
    const response=await chrome.runtime.sendMessage({type:'YOOFAM_VALIDATE_PACKAGE',tabId:tab.id,reviewedAgreements:{priceData:document.querySelector('#agree-price').checked===true,labelBusinessContact:document.querySelector('#agree-contact').checked===true,legalDocumentsNotApplicable:document.querySelector('#legal-not-applicable').checked===true}});
    if(!response?.ok)throw Error(response?.error||'검증 요청 응답이 없습니다. Supplier Hub에서 진행 상태를 확인해주세요.');
    if(response.result?.state!=='validation-requested')throw Error('검증 요청 결과를 확인하지 못했습니다. Supplier Hub에서 진행 상태를 확인해주세요.');
    status.textContent='파일 검증을 요청했습니다. Supplier Hub의 검증 진행상태에서 결과를 확인해주세요. 최종 등록은 아직 실행하지 않았습니다.';
  }catch(error){status.textContent=error.message;}
  finally{validateButton.disabled=false;picker.disabled=false;button.disabled=!prepared;}
});
picker.addEventListener('change',async()=>{
  document.querySelector('#agree-price').checked=false;document.querySelector('#agree-contact').checked=false;document.querySelector('#legal-not-applicable').checked=false;
  const version=++sequence;prepared=null;pendingFingerprint=null;packageIdentity=null;button.disabled=true;summary.textContent='';
  try{
    const file=picker.files[0];if(!file)return;if(file.size>30*1024*1024)throw Error('ZIP 파일은 30MB 이하여야 합니다.');
    const result=await prepareAttachments(new Uint8Array(await file.arrayBuffer()));if(version!==sequence)return;
    prepared=result;summary.textContent=`카테고리 ${result.categoryId}\nExcel 1개 · 상품 이미지 ${result.productImages.length}개 · 라벨 ${result.labelImages.length}개`;button.disabled=false;
    status.textContent='파일 내용과 현재 Supplier Hub 회사 계정을 확인한 뒤 전달하세요.';
  }catch(error){if(version===sequence)status.textContent=error.message;}
});
button.addEventListener('click',async()=>{
  if(!prepared||button.disabled)return;button.disabled=true;picker.disabled=true;validateButton.disabled=true;
  try{
    const [tab]=await chrome.tabs.query({active:true,currentWindow:true});
    if(!tab?.id||!tab.url||new URL(tab.url).origin!=='https://supplier.coupang.com'||new URL(tab.url).pathname!=='/qvt/registration')throw Error('현재 창의 Supplier Hub 대량 상품 등록 탭에서 실행해주세요.');
    let result;
    // The worker consumes, dispatches and records app identity independently of popup lifetime.
    if(pendingFingerprint){
      if(Date.now()>pendingExpires)throw Error('준비한 견적서가 만료되었습니다. 앱에서 다시 준비해주세요.');
      const response=await chrome.runtime.sendMessage({type:'YOOFAM_DISPATCH_PACKAGE',tabId:tab.id,fingerprint:pendingFingerprint});
      if(!response?.ok)throw Error(response?.error||'전달 결과 응답이 없습니다. Supplier Hub 첨부 목록과 검증 결과를 확인해주세요.');
      result=response.result;
    }else{
      const [execution]=await chrome.scripting.executeScript({target:{tabId:tab.id},func:attachToSupplierHub,args:[prepared]});
      result=execution?.result;
      if(result?.state==='dispatched')await transferRecord('put',`attempt:${tab.id}`,packageIdentity);
    }
    if(!result||!['dispatched','partial'].includes(result.state))throw Error('전달 결과를 확인하지 못했습니다. 중복 실행 전에 Supplier Hub 첨부 목록을 확인해주세요.');
    status.textContent=(result.state==='partial'?`일부 전달 후 중단: ${result.error}`:'파일 입력으로 전달했습니다.')+'\nSupplier Hub의 업로드 성공·실패 표시를 확인해주세요. 검증 및 최종 등록은 아직 실행하지 않았습니다.';
  }catch(error){status.textContent=error.message;}
  finally{prepared=null;picker.value='';picker.disabled=false;validateButton.disabled=false;}
});

const searchButton=document.querySelector('#registration-search');
searchButton.addEventListener('click',async()=>{
 if(searchButton.disabled||picker.disabled)return;
 ++sequence;searchButton.disabled=true;picker.disabled=true;button.disabled=true;validateButton.disabled=true;resultButton.disabled=true;registrationButton.disabled=true;
 try{
  const [tab]=await chrome.tabs.query({active:true,currentWindow:true});
  if(!tab?.id||!tab.url||new URL(tab.url).origin!=='https://supplier.coupang.com'||!['/qvt/registration','/qvt/wims'].includes(new URL(tab.url).pathname))throw Error('파일을 전달한 같은 Supplier Hub 탭에서 실행해주세요.');
  const response=await chrome.runtime.sendMessage({type:'YOOFAM_OBSERVE_RESULT',tabId:tab.id,kind:'registration-search'});
  if(!response?.ok||response.result?.state!=='search-requested')throw Error(response?.error||'검색 요청 결과를 확인하지 못했습니다.');
  status.textContent='검증 완료된 견적서 ID로 검색했습니다. 날짜 등 기존 검색조건은 유지됩니다. 화면 로딩이 끝나면 상품별 등록 상태 확인을 눌러주세요.';
 }catch(error){status.textContent=error.message;}
 finally{searchButton.disabled=false;picker.disabled=false;button.disabled=!prepared;validateButton.disabled=false;resultButton.disabled=false;registrationButton.disabled=false;}
});
