import {HANDOFF_ORIGINS} from './handoff-store.mjs';

// A web request can act only in the Chrome window that contains the app tab.
export function validateAppHubRequest(message,sender,type){
  let origin;try{origin=new URL(sender?.url).origin;}catch{throw Error('앱 출처를 확인하지 못했습니다.');}
  if(sender?.frameId!==0||!HANDOFF_ORIGINS.includes(origin)
    ||!Number.isSafeInteger(sender?.tab?.id)||sender.tab.id<0
    ||!Number.isSafeInteger(sender.tab.windowId)||sender.tab.windowId<0
    ||message?.type!==type||!/^\w[\w-]{0,99}$/.test(message.productId||'')
    ||!/^\d{1,20}$/.test(message.categoryId||'')||!/^[a-f0-9]{64}$/.test(message.fingerprint||''))
    throw Error('현재 앱 탭의 견적서 요청인지 확인하지 못했습니다.');
  return {origin,productId:message.productId,categoryId:message.categoryId,fingerprint:message.fingerprint};
}

export function isHubRegistrationTab(tab,windowId){
  try{const url=new URL(tab.url);return Number.isSafeInteger(tab.id)&&tab.id>=0&&tab.windowId===windowId
    &&url.origin==='https://supplier.coupang.com'&&url.pathname==='/qvt/registration'
    &&!url.username&&!url.password;}catch{return false;}
}
