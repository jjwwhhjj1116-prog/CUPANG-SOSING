// Stay in the same reviewed Hub tab. Navigation is never registration evidence.
export async function openSupplierHubRegistrationStatus(tabId) {
 const target='https://supplier.coupang.com/qvt/wims';
 const current=async()=>{
  const [tab]=await chrome.tabs.query({active:true,currentWindow:true});
  if(tab?.id!==tabId||!tab.url)throw Error('선택한 Supplier Hub 탭이 변경되었습니다. 해당 탭에서 다시 실행해주세요.');
  const url=new URL(tab.url);
  if(url.origin!=='https://supplier.coupang.com'||!['/qvt/registration','/qvt/wims'].includes(url.pathname))throw Error('Supplier Hub 등록 화면을 확인해주세요.');
  return tab;
 };
 const tab=await current();
 if(new URL(tab.url).pathname==='/qvt/registration')await chrome.tabs.update(tabId,{url:target});
 for(let attempt=0;attempt<20;attempt++){
  const active=await current();
  if(new URL(active.url).pathname==='/qvt/wims'&&active.status==='complete'){
   const [execution]=await chrome.scripting.executeScript({target:{tabId},func:registrationSearchReady});
   if(execution?.result===true){await current();return;}
  }
  await new Promise(resolve=>setTimeout(resolve,250));
 }
 throw Error('상품 등록 상태 화면이 아직 준비되지 않았습니다. 로딩 후 다시 검색해주세요.');
}

function registrationSearchReady(){
 if(location.origin!=='https://supplier.coupang.com'||location.pathname!=='/qvt/wims')return false;
 const visible=element=>element.getClientRects().length>0;
 const inputs=Array.from(document.querySelectorAll('input[id="quotationFile"][name="quotationFile"][type="text"]')).filter(visible);
 const labels=Array.from(document.querySelectorAll('label[for="quotationFile"]')).filter(visible);
 return inputs.length===1&&!inputs[0].disabled&&!inputs[0].readOnly&&labels.length===1&&(labels[0].innerText||'').trim()==='견적서 ID';
}
