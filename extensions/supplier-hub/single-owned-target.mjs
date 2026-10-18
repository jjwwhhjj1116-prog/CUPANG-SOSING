import {SINGLE_DOCUMENT_ORIGIN,SingleDocumentError} from './single-document.mjs';

const fail=()=>{throw new SingleDocumentError('TAB_CHANGED','이 전송에서 만든 Supplier Hub 탭을 같은 Chrome 창에 열어두세요. 기존 탭은 사용하지 않았습니다.');};
export function assertSingleOwnedTarget(target,binding){
  if(!target||!Number.isSafeInteger(target.tabId)||target.tabId<0||target.tabId===binding.identity.appTabId
    ||target.windowId!==binding.identity.windowId||target.origin!==SINGLE_DOCUMENT_ORIGIN
    ||target.requestId!==binding.requestId||target.packetDigest!==binding.packetDigest)fail();
}

/** Called only after the receiver commits target-requested. Never queries,
 * reuses, activates or closes any existing browser tab. Persist the returned
 * identity before waiting for login/company checks; a lost create ACK is not
 * permission to create another tab. */
export async function createSingleOwnedTarget(api,binding){
  const created=await api.tabs.create({windowId:binding.identity.windowId,url:SINGLE_DOCUMENT_ORIGIN+'/dashboard/KR',active:false});
  const target={tabId:created?.id,windowId:created?.windowId,origin:SINGLE_DOCUMENT_ORIGIN,requestId:binding.requestId,packetDigest:binding.packetDigest};
  assertSingleOwnedTarget(target,binding);return target;
}

export async function waitSingleOwnedTarget(api,target,binding){
  assertSingleOwnedTarget(target,binding);
  for(let attempt=0;attempt<80;attempt++){
    let tab;try{tab=await api.tabs.get(target.tabId);}catch{fail();}
    if(!tab||tab.id!==target.tabId||tab.windowId!==target.windowId)fail();
    let url;try{url=new URL(tab.pendingUrl||tab.url);}catch{fail();}
    if(url.origin!==SINGLE_DOCUMENT_ORIGIN||url.pathname!=='/dashboard/KR'||url.username||url.password||url.search||url.hash)fail();
    if(tab.status==='complete'&&!tab.pendingUrl)return tab;
    await new Promise(resolve=>setTimeout(resolve,100));
  }
  fail();
}
