import {SINGLE_DOCUMENT_ORIGIN,SingleDocumentError} from './single-document.mjs';

const reasons={
  'target-binding':'원래 요청과 전용 탭의 연결 정보가 다릅니다.',
  'tab-get-unconfirmed':'전용 탭의 현재 상태 조회에 실패했습니다. 닫힘 여부를 확정하지 않았습니다.',
  'window-changed':'전용 탭의 Chrome 창 연결이 변경되었습니다.',
  'url-invalid':'전용 탭의 주소 형식을 확인하지 못했습니다.',
  'origin-changed':'전용 탭의 Supplier Hub 도메인 연결이 변경되었습니다.',
  'path-changed':'전용 탭이 원래 대시보드 경로에서 이동했습니다.',
  'load-timeout':'전용 탭의 대시보드 로딩 대기 시간이 초과됐습니다.',
};
const fail=(reason='target-binding')=>{throw Object.assign(new SingleDocumentError('TAB_CHANGED','이 전송에서 만든 Supplier Hub 탭을 같은 Chrome 창에 열어두세요. 기존 탭은 사용하지 않았습니다. 확인 사유: '+reason+' · '+reasons[reason]),{reason});};
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
    let tab;try{tab=await api.tabs.get(target.tabId);}catch{fail('tab-get-unconfirmed');}
    if(!tab||tab.id!==target.tabId)fail();
    if(tab.windowId!==target.windowId)fail('window-changed');
    let url;try{url=new URL(tab.pendingUrl||tab.url);}catch{fail('url-invalid');}
    if(url.origin!==SINGLE_DOCUMENT_ORIGIN||url.username||url.password)fail('origin-changed');
    if(url.pathname!=='/dashboard/KR'||url.search||url.hash)fail('path-changed');
    if(tab.status==='complete'&&!tab.pendingUrl)return tab;
    await new Promise(resolve=>setTimeout(resolve,100));
  }
  fail('load-timeout');
}
