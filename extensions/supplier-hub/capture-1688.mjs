import {HANDOFF_ORIGINS} from './handoff-store.mjs';

export function validateCaptureRequest(message,sender){
  let origin,source;
  try{origin=new URL(sender?.url).origin;source=new URL(message?.sourceUrl);}catch{throw Error('앱 주소 또는 1688 상품 주소를 확인하지 못했습니다.');}
  if(!sender?.tab?.id||!Number.isInteger(sender.tab.windowId)||sender.frameId!==0||!HANDOFF_ORIGINS.includes(origin))throw Error('허용된 앱 탭에서만 상품을 가져올 수 있습니다.');
  if(message?.type!=='YOOFAM_CAPTURE_1688'||source.protocol!=='https:'||source.hostname!=='detail.1688.com'||source.port||source.username||source.password||source.search||source.hash||!/^\/offer\/[1-9]\d{0,29}\.html$/.test(source.pathname))throw Error('정확한 1688 상품 URL을 확인해주세요.');
  return {sourceUrl:source.href,windowId:sender.tab.windowId};
}

export function readProductJsonLd(){
  const scripts=[];let size=0;
  for(const element of document.querySelectorAll('script')){
    if(element.getAttribute('type')?.trim().toLowerCase()!=='application/ld+json')continue;
    const value=element.textContent||'';
    size+=value.length;
    if(scripts.length>=30||size>1500000)throw Error('상품 구조화 데이터가 수집 한도를 초과했습니다.');
    if(value.trim())scripts.push(value);
  }
  return {pageUrl:location.href,scripts};
}

function waitForComplete(api,tabId,timeoutMs=20000){
  return new Promise((resolve,reject)=>{
    const cleanup=()=>{clearTimeout(timer);api.tabs.onUpdated.removeListener(update);api.tabs.onRemoved.removeListener(removed);};
    const update=(id,change)=>{if(id===tabId&&change.status==='complete'){cleanup();resolve();}};
    const removed=id=>{if(id===tabId){cleanup();reject(Error('1688 상품 탭이 닫혔습니다.'));}};
    const timer=setTimeout(()=>{cleanup();reject(Error('1688 상품 페이지 로딩 시간이 초과되었습니다.'));},timeoutMs);
    api.tabs.onUpdated.addListener(update);api.tabs.onRemoved.addListener(removed);
    api.tabs.get(tabId).then(tab=>{if(tab.status==='complete'){cleanup();resolve();}}).catch(error=>{cleanup();reject(error);});
  });
}

export async function capture1688Product(message,sender,api=chrome){
  const {sourceUrl,windowId}=validateCaptureRequest(message,sender);
  const existing=(await api.tabs.query({windowId})).find(tab=>tab.url?.split(/[?#]/,1)[0]===sourceUrl);
  const tab=existing??await api.tabs.create({windowId,url:sourceUrl,active:false});
  if(!Number.isInteger(tab.id))throw Error('1688 상품 탭을 확인하지 못했습니다.');
  let captured=false;
  try{
    await waitForComplete(api,tab.id);
    const values=await api.scripting.executeScript({target:{tabId:tab.id},func:readProductJsonLd});
    const page=values?.[0]?.result;
    if(!page||typeof page.pageUrl!=='string'||page.pageUrl.split(/[?#]/,1)[0]!==sourceUrl)throw Error('1688 상품 페이지 대신 로그인·확인 페이지가 열렸습니다.');
    if(!Array.isArray(page.scripts)||!page.scripts.length)throw Error('1688 상품 페이지에서 옵션·가격 구조화 데이터를 찾지 못했습니다.');
    captured=true;return {ok:true,sourceUrl,scripts:page.scripts};
  }finally{
    // Leave a login/check page visible in the same profile on failure.
    if(!existing&&captured)await api.tabs.remove(tab.id).catch(()=>{});
  }
}
