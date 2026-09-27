import {prepareAttachments} from './package.mjs';
import {attachToSupplierHub} from './attach.mjs';
const picker=document.querySelector('#package'),button=document.querySelector('#attach'),status=document.querySelector('#status'),summary=document.querySelector('#summary');
let prepared=null,sequence=0;
picker.addEventListener('change',async()=>{
  const version=++sequence;prepared=null;button.disabled=true;summary.textContent='';
  try{
    const file=picker.files[0];if(!file)return;if(file.size>30*1024*1024)throw Error('ZIP 파일은 30MB 이하여야 합니다.');
    const result=await prepareAttachments(new Uint8Array(await file.arrayBuffer()));if(version!==sequence)return;
    prepared=result;summary.textContent=`카테고리 ${result.categoryId}\nExcel 1개 · 상품 이미지 ${result.productImages.length}개 · 라벨 ${result.labelImages.length}개`;button.disabled=false;
    status.textContent='파일 내용과 현재 Supplier Hub 회사 계정을 확인한 뒤 전달하세요.';
  }catch(error){if(version===sequence)status.textContent=error.message;}
});
button.addEventListener('click',async()=>{
  if(!prepared||button.disabled)return;button.disabled=true;picker.disabled=true;
  try{
    const [tab]=await chrome.tabs.query({active:true,currentWindow:true});
    if(!tab?.id||!tab.url||new URL(tab.url).origin!=='https://supplier.coupang.com'||new URL(tab.url).pathname!=='/qvt/registration')throw Error('현재 창의 Supplier Hub 대량 상품 등록 탭에서 실행해주세요.');
    const [execution]=await chrome.scripting.executeScript({target:{tabId:tab.id},func:attachToSupplierHub,args:[prepared]});
    const result=execution?.result;
    if(!result||!['dispatched','partial'].includes(result.state))throw Error('전달 결과를 확인하지 못했습니다. 중복 실행 전에 Supplier Hub 첨부 목록을 확인해주세요.');
    status.textContent=(result.state==='partial'?`일부 전달 후 중단: ${result.error}`:'파일 입력으로 전달했습니다.')+'\nSupplier Hub의 업로드 성공·실패 표시를 확인해주세요. 검증 및 최종 등록은 아직 실행하지 않았습니다.';
  }catch(error){status.textContent=error.message;}
  finally{prepared=null;picker.value='';picker.disabled=false;}
});
