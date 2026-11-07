import {HANDOFF_ORIGINS} from './handoff-store.mjs';
import {createProductDocumentStore} from './product-document-receiver.mjs';
import {historicalProductReceiptSourceFromNativePlan,reconcilePreservedProductReceipt,validateHistoricalProductReceiptTarget} from './preserved-product-receipt.mjs';
import {historicalProductReceiptReadPage} from './preserved-product-receipt-page.mjs';

const canonical=value=>value===null||typeof value!=='object'?JSON.stringify(value):Array.isArray(value)?'['+value.map(canonical).join(',')+']':'{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonical(value[key])).join(',')+'}';
const same=(a,b)=>canonical(a)===canonical(b),copy=value=>structuredClone(value);
const fail=(code,message)=>{const error=new Error(message);error.code=code;throw error;};
export function historicalReceiptDocumentPage(){return {origin:location.origin,pathname:location.pathname};}
async function receiptTabInventory(api){
  const tabs=await api.tabs.query({});
  if(!Array.isArray(tabs)||tabs.length>10000||tabs.some(tab=>!Number.isSafeInteger(tab?.id)||tab.id<0||!Number.isSafeInteger(tab.windowId)||tab.windowId<0)||new Set(tabs.map(tab=>tab.id)).size!==tabs.length)
    fail('HISTORICAL_RECEIPT_HUB_TAB','원래 Hub 탭의 부재를 전체 탭 목록에서 확인하지 못했습니다.');
  return tabs;
}
function assertReplacementWindow(anchor,tabs,windowId,appTabId){
  if(tabs.some(tab=>tab.windowId===anchor.identity.windowId||tab.id===anchor.identity.appTabId||tab.id===anchor.ownedTarget.tabId)
    ||!tabs.some(tab=>tab.id===appTabId&&tab.windowId===windowId))
    fail('HISTORICAL_RECEIPT_HUB_TAB','원래 작업 창이나 탭이 남아 있거나 현재 앱 창을 확인할 수 없습니다.');
}
/** Use an already-open Hub tab. A different app window is eligible only after
 * the original window's tabs and both original tab IDs have disappeared. */
export async function readHistoricalProductReceiptInTab(anchor,{api=globalThis.chrome,windowId=anchor.identity.windowId,appTabId=anchor.identity.appTabId}={}){
  const originalTabId=anchor.ownedTarget.tabId;
  const replacement=windowId!==anchor.identity.windowId;
  const eligible=tab=>{try{const url=new URL(tab.url);return tab.windowId===windowId&&!tab.pendingUrl&&url.origin==='https://supplier.coupang.com'&&!url.username&&!url.password
    &&(['/dashboard/KR','/qvt/registration','/qvt/wims','/sr/registration'].includes(url.pathname)||/^\/sr\/registration\/step\/(startPage|productPage|imagePage|legalPage|logisticsPage)$/.test(url.pathname));}catch{return false;}};
  let selected,missing=false;
  try{selected=await api.tabs.get(originalTabId);}catch{
    const tabs=await receiptTabInventory(api);if(tabs.some(tab=>tab.id===originalTabId))fail('HISTORICAL_RECEIPT_HUB_TAB','원래 Hub 탭이 남아 있어 다른 탭으로 대체하지 않았습니다.');
    if(replacement)assertReplacementWindow(anchor,tabs,windowId,appTabId);
    selected=tabs.filter(eligible).sort((left,right)=>left.id-right.id)[0];missing=true;
    if(!selected)fail('HISTORICAL_RECEIPT_HUB_TAB','현재 앱 창에 이미 열린 Supplier Hub 읽기 탭이 없습니다.');
  }
  if(!eligible(selected)||!missing&&(replacement||selected.id!==originalTabId))fail('HISTORICAL_RECEIPT_HUB_TAB','원래 회사의 Hub 탭·창이 변경되었습니다.');
  const tabId=selected.id;
  const current=async()=>{const tab=await api.tabs.get(tabId);
    if(tab.id!==tabId||!eligible(tab))fail('HISTORICAL_RECEIPT_HUB_TAB','원래 회사의 Hub 탭·창이 변경되었습니다.');
    if(missing){
      const tabs=await receiptTabInventory(api);
      if(replacement)assertReplacementWindow(anchor,tabs,windowId,appTabId);
      else if(tabs.some(value=>value.id===originalTabId))fail('HISTORICAL_RECEIPT_HUB_TAB','접수 조회 중 원래 Hub 탭이 다시 확인되어 대체 조회를 중단했습니다.');
    }
    return {url:tab.url,windowId:tab.windowId};};
  const before=await current(),probe=await api.scripting.executeScript({target:{tabId,frameIds:[0]},func:historicalReceiptDocumentPage,args:[]});
  if(!Array.isArray(probe)||probe.length!==1||probe[0].frameId!==0||typeof probe[0].documentId!=='string'||!probe[0].documentId||probe[0].result?.origin!=='https://supplier.coupang.com')fail('HISTORICAL_RECEIPT_HUB_TAB','원래 Hub 브라우저 문서를 확인하지 못했습니다.');
  const selection=replacement?'replacement-window-tab':missing?'existing-same-window-tab':'original-owned-tab';
  const browser={tabId,windowId:before.windowId,documentId:probe[0].documentId,selection,originalTabId,originalTabAbsent:missing};
  const reply=await api.scripting.executeScript({target:{tabId,documentIds:[browser.documentId]},func:historicalProductReceiptReadPage,args:[{anchor:copy(anchor),browser}]});
  if(!same(before,await current())||!Array.isArray(reply)||reply.length!==1||reply[0].frameId!==0||reply[0].documentId!==browser.documentId||reply[0].result?.provenance?.documentId!==browser.documentId||!same(reply[0].result?.provenance?.observedTab,browser))
    fail('HISTORICAL_RECEIPT_HUB_TAB','접수 조회 중 원래 Hub 브라우저 문서가 변경되었습니다.');
  return reply[0].result;
}
/** Dedicated read-only command; no ordinary document adapter is constructed. */
export async function dispatchHistoricalProductReceipt(message,sender,{api=globalThis.chrome,store=createProductDocumentStore()}={}){
  if(!message||Object.keys(message).sort().join(',')!=='action,target,type'||message.type!=='YOOFAM_RECONCILE_PRESERVED_PRODUCT_RECEIPT'||message.action!=='reconcile')fail('HISTORICAL_RECEIPT_INPUT','과거 접수 조회의 정확한 범위를 확인해주세요.');
  const target=validateHistoricalProductReceiptTarget(message.target);let origin;try{const url=new URL(sender.url);if(url.username||url.password)throw Error();origin=url.origin;}catch{fail('HISTORICAL_RECEIPT_SENDER','현재 앱에서 원래 문서의 접수를 확인해주세요.');}
  if(sender.id!==api.runtime.id||sender.frameId!==0||!HANDOFF_ORIGINS.includes(origin)||!Number.isSafeInteger(sender.tab?.id)||!Number.isSafeInteger(sender.tab?.windowId))fail('HISTORICAL_RECEIPT_SENDER','현재 앱의 확장 연결에서만 과거 접수를 확인할 수 있습니다.');
  const appCurrent=async()=>{const tab=await api.tabs.get(sender.tab.id);let url;try{url=new URL(tab.url);}catch{fail('HISTORICAL_RECEIPT_SCOPE','현재 앱 탭이 변경되었습니다.');}
    if(tab.id!==sender.tab.id||tab.windowId!==sender.tab.windowId||tab.pendingUrl||url.origin!==origin||url.username||url.password)fail('HISTORICAL_RECEIPT_SCOPE','조회 중 현재 앱 탭·창이 변경되었습니다.');};
  const inspectionTarget=Object.fromEntries(Object.entries(target).filter(([key])=>key!=='qvtRequestId'));
  let scope,checkpoint;
  const readScope=async()=>{await appCurrent();const reply=await api.tabs.sendMessage(sender.tab.id,{type:'YOOFAM_READ_PRESERVED_PRODUCT_DOCUMENT_SCOPE',expected:{origin,target:inspectionTarget}},{frameId:0});await appCurrent();
    if(reply?.ok!==true||!reply.scope||!same(reply.scope.target,inspectionTarget))fail('HISTORICAL_RECEIPT_SCOPE','현재 승인 회원·회사의 원래 요청 연결을 확인하지 못했습니다.');
    const value={origin,ownerId:reply.scope.ownerId,company:reply.scope.company};if(scope&&!same(value,scope))fail('HISTORICAL_RECEIPT_SCOPE','조회 중 승인 회원·회사가 변경되었습니다.');scope=value;return value;};
  const readCheckpoint=async()=>{const scan=await store.inspectProductRequest({...scope,productId:target.productId,requestId:target.requestId,docId:target.docId});
    if(scan?.available!==true||scan.complete!==true||!Array.isArray(scan.matches)||scan.matches.length!==1||scan.matches[0].lane?.key!==scan.matches[0].key||scan.matches[0].checkpoint?.key!==scan.matches[0].key)fail('HISTORICAL_RECEIPT_CHECKPOINT','원래 요청의 유일한 확장 보관 기록을 확인하지 못했습니다.');
    checkpoint=scan.matches[0].checkpoint;return checkpoint;};
  const readCurrentSource=async()=>{await appCurrent();const reply=await api.tabs.sendMessage(sender.tab.id,{type:'YOOFAM_READ_HISTORICAL_PRODUCT_RECEIPT_SOURCE',expected:{origin,target,requestedProfileId:checkpoint.identity.requestedProfileId}},{frameId:0});await appCurrent();
    if(reply?.ok!==true||!same(reply.scope,scope))fail('HISTORICAL_RECEIPT_SOURCE','현재 원래 상품의 저장 버전·회원 범위를 확인하지 못했습니다.');
    return historicalProductReceiptSourceFromNativePlan({plan:reply.plan,requestedProfileId:checkpoint.identity.requestedProfileId,productName:reply.productName,categoryPath:reply.categoryPath});};
  const windowId=sender.tab.windowId,appTabId=sender.tab.id;
  const result=await reconcilePreservedProductReceipt({target},{readScope,readCheckpoint,readCurrentSource,readHubReceipt:async anchor=>{
    await appCurrent();return readHistoricalProductReceiptInTab(anchor,{api,windowId,appTabId});
  }});
  if(result.provenance.observedTab.selection==='replacement-window-tab'){
    await appCurrent();
    assertReplacementWindow(result.anchor,await receiptTabInventory(api),windowId,appTabId);
  }
  return result;
}
