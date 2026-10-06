import {readAppSupplierHubStoredReceipt} from './receipt-recovery.mjs';
import {verifyAppQuotationSource} from './source-check.mjs';
import {verifySupplierHubCompany} from './company.mjs';
import {isHubRegistrationTab} from './app-request.mjs';
import {waitForSupplierHubPage,supplierHubUploadReady} from './hub-tab.mjs';
import {isStoredReceiptResult,isRecoverableSupplierHubResult,resultKey,transferRecord} from './handoff-store.mjs';

const activeWindows=new Set();
const companies={A01526306:'유앤채',A01464742:'와이홉'};
const sameIdentity=(left,right)=>Boolean(left&&right&&['origin','productId','categoryId','fingerprint'].every(key=>left[key]===right[key]));
const sameSource=(left,right)=>Boolean(sameIdentity(left,right)&&left.company?.code===right.company?.code&&left.company?.name===right.company?.name
  &&left.includedOptions===right.includedOptions&&left.profileId===right.profileId&&left.filename===right.filename);

/** This binding grants only a result read. It contains no upload/validation
 * permission and never replaces the original transmission or attachment. */
export function isRecoveredValidationBinding(value,identity){
  return Boolean(sameIdentity(value,identity)&&value.purpose==='validation-status'&&value.registered===false
    &&value.filename===`YOOFAM-${identity.fingerprint}.xlsx`&&/^\w[\w-]{0,99}$/.test(value.profileId||'')
    &&Number.isSafeInteger(value.includedOptions)&&value.includedOptions>=1&&value.includedOptions<=200
    &&Object.hasOwn(companies,value.company?.code)&&companies[value.company.code]===value.company.name
    &&Number.isSafeInteger(value.recoveredAt)&&value.recoveredAt>0&&value.recoveredAt<=Date.now()+60000
    &&value.validationResume===undefined&&value.attachmentNames===undefined);
}

export async function verifyRecoveredValidationSource(identity,record,sender,api=chrome){
  if(!isRecoveredValidationBinding(record,identity))throw Error('원래 견적서의 읽기 전용 검증 조회 기록을 확인하지 못했습니다.');
  const app=await api.tabs.get(sender.tab.id);if(app?.pendingUrl)throw Error('원래 앱 탭이 이동 중입니다. 같은 창에서 결과를 다시 확인해주세요.');
  await verifyAppQuotationSource(identity,record,{appTabId:sender.tab.id,windowId:sender.tab.windowId},api);
  if((await api.tabs.get(sender.tab.id))?.pendingUrl)throw Error('결과 조회 중 원래 앱 탭이 이동했습니다. 결과를 저장하지 않았습니다.');
}

/** Recover a pending file observation after its original upload tab is closed.
 * Only the authenticated app's exact stored receipt is a recovery basis. The
 * source fingerprint binds the owned option IDs as well as their included count.
 * No other Chrome window/profile, existing form navigation, upload or validation
 * request is part of this operation. */
export async function recoverSupplierHubValidationTab(identity,sender,api=chrome,store=transferRecord){
  const windowId=sender.tab.windowId,binding={appTabId:sender.tab.id,windowId};
  if(activeWindows.has(windowId))throw Error('이 Chrome 창의 검증 결과 조회 화면을 복구 중입니다. 잠시 후 다시 확인해주세요.');
  activeWindows.add(windowId);
  try{
    if((await api.tabs.get(sender.tab.id))?.pendingUrl)throw Error('원래 앱 탭이 이동 중입니다. 같은 창에서 결과를 다시 확인해주세요.');
    const saved=await readAppSupplierHubStoredReceipt(identity,binding,api);
    if(!saved||saved.state!=='validation-pending'||!isStoredReceiptResult(identity,saved))throw Error('보관된 파일 검증 중 기록이 없습니다. 원래 Supplier Hub 화면에서 결과를 확인해주세요.');
    const key=resultKey(identity),initialResult=await store('get',key);
    const validLocal=value=>value===undefined||value===null||(isStoredReceiptResult(identity,value)||isRecoverableSupplierHubResult(identity,value))
      &&value.company.code===saved.company.code&&value.company.name===saved.company.name&&value.includedOptions===saved.includedOptions
      &&(value.profileId===undefined||value.profileId===saved.profileId)
      &&value.state!=='validation-rejected'&&(!value.quotationId||!saved.quotationId||value.quotationId===saved.quotationId);
    if(!validLocal(initialResult))throw Error('Chrome 결과와 보관된 검증 기록의 회사·견적서·옵션이 다릅니다.');
    const tabs=(await api.tabs.query({windowId,url:'https://supplier.coupang.com/qvt/registration*'})).filter(tab=>!tab.pendingUrl&&isHubRegistrationTab(tab,windowId));
    const matches=[];
    for(const tab of tabs){
      const attempt=await store('get',`attempt:${tab.id}`);
      if(!sameIdentity(attempt,identity))continue;
      if(!isRecoveredValidationBinding(attempt,identity)||!sameSource(attempt,saved))throw Error('같은 견적서의 원래 조회 탭을 확인하지 못했습니다. 기존 탭을 유지하고 결과를 확인해주세요.');
      matches.push({tab,attempt});
    }
    if(matches.length>1)throw Error('같은 견적서의 결과 조회 탭이 여러 개입니다. 조회할 탭을 하나 남겨주세요.');
    let tab=matches[0]?.tab,record=matches[0]?.attempt;
    if(!tab){
      await verifyAppQuotationSource(identity,saved,binding,api);
      tab=await api.tabs.create({windowId,url:'https://supplier.coupang.com/qvt/registration',active:false});
      if(!Number.isSafeInteger(tab?.id)||tab.id<0||tab.windowId!==windowId)throw Error('같은 Chrome 창에 검증 결과 조회 탭을 준비하지 못했습니다.');
      await waitForSupplierHubPage(tab.id,windowId,'/qvt/registration',supplierHubUploadReady,api);
      record={...identity,company:{...saved.company},includedOptions:saved.includedOptions,profileId:saved.profileId,
        filename:saved.filename,purpose:'validation-status',registered:false,recoveredAt:Date.now()};
    }
    const checkTab=async()=>{const current=await api.tabs.get(tab.id);if(current?.id!==tab.id||current.pendingUrl||!isHubRegistrationTab(current,windowId))throw Error('검증 결과 조회 탭의 창·로그인·화면이 변경되었습니다.');};
    await checkTab();
    const [company]=await api.scripting.executeScript({target:{tabId:tab.id},func:verifySupplierHubCompany,args:[saved.company]});
    if(company?.result?.code!==saved.company.code)throw Error('보관된 견적서와 현재 Supplier Hub 회사코드가 다릅니다.');
    await checkTab();await verifyRecoveredValidationSource(identity,record,sender,api);
    const currentReceipt=await readAppSupplierHubStoredReceipt(identity,binding,api);
    if(!currentReceipt||currentReceipt.state!=='validation-pending'||!sameSource(currentReceipt,saved))throw Error('복구 중 보관된 견적서 결과가 변경되었습니다. 다시 결과를 확인해주세요.');
    await checkTab();
    if(JSON.stringify(await store('get',key))!==JSON.stringify(initialResult))throw Error('복구 중 더 최신 전송 결과가 저장되었습니다. 기존 결과를 유지했습니다.');
    if(!matches.length&&!await store('claim',`attempt:${tab.id}`,record))throw Error('복구 중 조회 탭에 다른 견적서가 연결되었습니다. 기존 작업을 유지했습니다.');
    const current=await store('get',`attempt:${tab.id}`);
    if(!isRecoveredValidationBinding(current,identity)||!sameSource(current,record))throw Error('복구한 조회 탭의 견적서 연결이 변경되었습니다.');
    return {tabId:tab.id,identity:current};
  }finally{activeWindows.delete(windowId);}
}
