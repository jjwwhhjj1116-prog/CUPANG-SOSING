// A new tab always belongs to the app's existing Chrome window; no new browser/profile.
export function isSupplierHubTab(tab,windowId,path){
  if(!Number.isSafeInteger(tab?.id)||tab.id<0||tab.windowId!==windowId||typeof tab.url!=='string')return false;
  try{const url=new URL(tab.url);return !url.username&&!url.password&&url.origin==='https://supplier.coupang.com'&&url.pathname===path;}catch{return false;}
}
export async function waitForSupplierHubPage(tabId,windowId,path,ready,api=chrome){
  const target=`https://supplier.coupang.com${path}`;
  for(let attempt=0;attempt<40;attempt++){
    const tab=await api.tabs.get(tabId);
    if(tab?.id!==tabId||tab.windowId!==windowId)throw Error('Supplier Hub 탭이 다른 Chrome 창으로 이동되었습니다.');
    const loading=tab.status!=='complete'&&tab.pendingUrl===target&&(!tab.url||tab.url==='about:blank');
    if(!loading&&!isSupplierHubTab(tab,windowId,path))throw Error('Supplier Hub 화면이 변경되었습니다. 해당 창의 로그인 상태를 확인해주세요.');
    if(isSupplierHubTab(tab,windowId,path)&&tab.status==='complete'){
      const [execution]=await api.scripting.executeScript({target:{tabId},func:ready});
      if(execution?.result===true){
        if(!isSupplierHubTab(await api.tabs.get(tabId),windowId,path))throw Error('Supplier Hub 화면이 변경되었습니다.');
        return;
      }
    }
    await new Promise(resolve=>setTimeout(resolve,250));
  }
  throw Error('Supplier Hub 화면이 아직 준비되지 않았습니다. 로딩 후 다시 확인해주세요.');
}
export function supplierHubUploadReady(){
  if(location.origin!=='https://supplier.coupang.com'||location.pathname!=='/qvt/registration')return false;
  const text=document.body.innerText||'';
  return /Company Code:\s*A\d+\b/.test(text)&&['작성이 완료된 견적서 Excel 파일을 업로드하십시오.','상품 이미지를 업로드하십시오.','제품 필수 표시사항을 업로드하십시오.'].every(title=>text.includes(title))&&document.querySelectorAll('input[type="file"]').length>=3;
}
export function supplierHubStatusReady(){
  if(location.origin!=='https://supplier.coupang.com'||location.pathname!=='/qvt/wims')return false;
  const visible=element=>element.getClientRects().length>0;
  const inputs=Array.from(document.querySelectorAll('input[id="quotationFile"][name="quotationFile"][type="text"]')).filter(visible);
  const labels=Array.from(document.querySelectorAll('label[for="quotationFile"]')).filter(visible);
  return /Company Code:\s*A\d+\b/.test(document.body.innerText||'')&&inputs.length===1&&!inputs[0].disabled&&!inputs[0].readOnly&&labels.length===1&&(labels[0].innerText||'').trim()==='견적서 ID';
}
