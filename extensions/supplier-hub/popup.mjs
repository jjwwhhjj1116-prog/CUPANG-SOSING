import {prepareAttachments} from './package.mjs';
import {attachToSupplierHub} from './attach.mjs';
import {pendingPackage} from './handoff-store.mjs';
import {requestSupplierHubValidation} from './validate.mjs';
const picker=document.querySelector('#package'),button=document.querySelector('#attach'),status=document.querySelector('#status'),summary=document.querySelector('#summary');
let prepared=null,sequence=0,pendingFingerprint=null,pendingExpires=0;
async function loadPending(){
  const version=sequence;
  try{
    const saved=await pendingPackage('get');if(!saved||version!==sequence)return;
    if(!Number.isFinite(saved.createdAt)||Date.now()-saved.createdAt>15*60*1000){await pendingPackage('delete',saved.fingerprint);status.textContent='준비한 견적서가 만료되었습니다. 앱에서 다시 준비해주세요.';return;}
    const result=await prepareAttachments(Uint8Array.from(atob(saved.base64),c=>c.charCodeAt(0)));
    if(result.categoryId!==saved.categoryId||result.quotation[0].name!==`YOOFAM-${saved.fingerprint}.xlsx`)throw Error('앱에서 검토한 견적서와 파일이 일치하지 않습니다.');
    if(version!==sequence)return;
    prepared=result;pendingFingerprint=saved.fingerprint;pendingExpires=saved.createdAt+15*60*1000;
    summary.textContent=`앱에서 준비한 상품 ${saved.productId}\n카테고리 ${result.categoryId}\nExcel 1개 · 상품 이미지 ${result.productImages.length}개 · 라벨 ${result.labelImages.length}개`;
    button.disabled=false;status.textContent='현재 Supplier Hub 회사 계정과 파일 목록을 확인한 뒤 전달하세요.';
  }catch(error){if(version===sequence)status.textContent=error.message;}
}
void loadPending();
const validateButton=document.querySelector('#validate');
validateButton.addEventListener('click',async()=>{
  if(validateButton.disabled)return;
  ++sequence; // Ignore an in-flight package read while validation owns the popup.
  validateButton.disabled=true;button.disabled=true;picker.disabled=true;
  try{
    const [tab]=await chrome.tabs.query({active:true,currentWindow:true});
    if(!tab?.id||!tab.url||new URL(tab.url).origin!=='https://supplier.coupang.com'||new URL(tab.url).pathname!=='/qvt/registration')throw Error('현재 창의 Supplier Hub 대량 상품 등록 탭에서 실행해주세요.');
    const [execution]=await chrome.scripting.executeScript({target:{tabId:tab.id},func:requestSupplierHubValidation});
    if(execution?.result?.state!=='validation-requested')throw Error('검증 요청 결과를 확인하지 못했습니다. Supplier Hub에서 진행 상태를 확인해주세요.');
    status.textContent='파일 검증을 요청했습니다. Supplier Hub의 검증 진행상태에서 결과를 확인해주세요. 최종 등록은 아직 실행하지 않았습니다.';
  }catch(error){status.textContent=error.message;}
  finally{validateButton.disabled=false;picker.disabled=false;button.disabled=!prepared;}
});
picker.addEventListener('change',async()=>{
  const version=++sequence;prepared=null;pendingFingerprint=null;button.disabled=true;summary.textContent='';
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
    // Consume before dispatch: a closed popup or lost response must not silently replay uploads.
    if(pendingFingerprint){
      if(Date.now()>pendingExpires)throw Error('준비한 견적서가 만료되었습니다. 앱에서 다시 준비해주세요.');
      if(!await pendingPackage('delete',pendingFingerprint))throw Error('다른 견적서가 준비되었거나 이미 전달을 시도했습니다. 확장을 다시 열어주세요.');
    }
    const [execution]=await chrome.scripting.executeScript({target:{tabId:tab.id},func:attachToSupplierHub,args:[prepared]});
    const result=execution?.result;
    if(!result||!['dispatched','partial'].includes(result.state))throw Error('전달 결과를 확인하지 못했습니다. 중복 실행 전에 Supplier Hub 첨부 목록을 확인해주세요.');
    status.textContent=(result.state==='partial'?`일부 전달 후 중단: ${result.error}`:'파일 입력으로 전달했습니다.')+'\nSupplier Hub의 업로드 성공·실패 표시를 확인해주세요. 검증 및 최종 등록은 아직 실행하지 않았습니다.';
  }catch(error){status.textContent=error.message;}
  finally{prepared=null;picker.value='';picker.disabled=false;validateButton.disabled=false;}
});
