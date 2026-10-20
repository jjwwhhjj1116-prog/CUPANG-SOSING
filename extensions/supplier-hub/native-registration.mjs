import {HANDOFF_ORIGINS} from './handoff-store.mjs';
import {isSupplierHubTab,waitForSupplierHubPage,supplierHubStatusReady} from './hub-tab.mjs';
import {verifySupplierHubCompany} from './company.mjs';
import {querySupplierHubNativeRegistrations} from './native-registration-page.mjs';
const active=new Set(),HASH=/^[a-f0-9]{64}$/,ID=/^\w[\w-]{0,99}$/,UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const same=(left,right)=>JSON.stringify(left)===JSON.stringify(right);
export async function readAppNativeRegistrations(message,sender,api=chrome){
 let origin;try{origin=new URL(sender?.url).origin;}catch{throw Error('앱 출처를 확인해주세요.');}
 const windowId=sender?.tab?.windowId,appTabId=sender?.tab?.id,keys=['type','productId','requestId','identityDigest','preparedBodySha256'];
 if(message?.type!=='YOOFAM_QUERY_NATIVE_REGISTRATIONS'||!keys.every(key=>Object.hasOwn(message,key))||Object.keys(message).some(key=>!keys.includes(key))||sender.frameId!==0||!HANDOFF_ORIGINS.includes(origin)||!Number.isSafeInteger(windowId)||windowId<0||!Number.isSafeInteger(appTabId)||appTabId<0
  ||!ID.test(message.productId||'')||!UUID.test(message.requestId||'')||!HASH.test(message.identityDigest||'')||!HASH.test(message.preparedBodySha256||''))throw Error('현재 앱의 원래 문서 접수 조회 요청을 확인해주세요.');
 if(active.has(windowId))throw Error('이 Chrome 창에서 문서 등록 파일을 조회 중입니다.');active.add(windowId);let createdId;
 try{
  const expected={origin,productId:message.productId,requestId:message.requestId,identityDigest:message.identityDigest,preparedBodySha256:message.preparedBodySha256};
  const scope=async()=>{const tab=await api.tabs.get(appTabId);if(tab.pendingUrl||tab.windowId!==windowId||new URL(tab.url).origin!==origin)throw Error('원래 앱 탭이 변경되었습니다.');const result=await api.tabs.sendMessage(appTabId,{type:'YOOFAM_READ_NATIVE_RECEIPT_SCOPE',expected},{frameId:0});
   const value=result?.scope;if(result?.ok!==true||!value||value.productId!==expected.productId||value.requestId!==expected.requestId||value.identityDigest!==expected.identityDigest||value.preparedBodySha256!==expected.preparedBodySha256||!ID.test(value.ownerId||'')||({A01526306:'유앤채',A01464742:'와이홉'})[value.company?.code]!==value.company?.name)throw Error(result?.error||'현재 승인 회원의 원래 문서 접수 기록이 필요합니다.');return value;};
  const original=await scope(),paths=['/qvt/wims','/qvt/registration','/dashboard/KR'];
  const tabs=(await api.tabs.query({windowId,url:paths.map(path=>'https://supplier.coupang.com'+path+'*')})).filter(tab=>!tab.pendingUrl&&paths.some(path=>isSupplierHubTab(tab,windowId,path)));
  const hub=tabs.find(tab=>tab.active)||tabs[0];if(!hub)throw Error('앱과 같은 Chrome 창에 로그인한 Supplier Hub를 열어두세요.');
  const initial=await api.tabs.get(hub.id);if(initial.pendingUrl||!isSupplierHubTab(initial,windowId,new URL(hub.url).pathname))throw Error('로그인한 Supplier Hub 화면이 변경되었습니다.');
  const [company]=await api.scripting.executeScript({target:{tabId:hub.id},func:verifySupplierHubCompany,args:[original.company,'catalog']});if(company?.result?.code!==original.company.code)throw Error('회원과 Supplier Hub 회사코드가 다릅니다.');
  const fresh=await api.tabs.create({windowId,url:'https://supplier.coupang.com/qvt/wims',active:false});if(!Number.isSafeInteger(fresh?.id)||fresh.id<0||fresh.windowId!==windowId)throw Error('같은 Chrome 창에 조회 화면을 준비하지 못했습니다.');createdId=fresh.id;
  await waitForSupplierHubPage(createdId,windowId,'/qvt/wims',supplierHubStatusReady,api);
  const check=async()=>{if(!same(await scope(),original))throw Error('조회 중 로그인 회원·회사·원래 문서 접수 기록이 변경되었습니다.');const tab=await api.tabs.get(createdId);if(tab.pendingUrl||!isSupplierHubTab(tab,windowId,'/qvt/wims'))throw Error('조회 화면이 다른 창 또는 주소로 변경되었습니다.');const [company]=await api.scripting.executeScript({target:{tabId:createdId},func:verifySupplierHubCompany,args:[original.company]});if(company?.result?.code!==original.company.code)throw Error('조회 중 Supplier Hub 회사가 변경되었습니다.');};
  await check();const [execution]=await api.scripting.executeScript({target:{tabId:createdId},func:querySupplierHubNativeRegistrations,args:[original]});await check();const result=execution?.result;
  if(!result||result.source!=='supplier-hub-native-registration-v1'||result.registered!==false||result.mutated!==false||result.optionMapping!=='unverified'||!['ownerId','productId','requestId','docId','qvtRequestId','categoryId','identityDigest','preparedBodySha256','membersCount'].every(key=>result[key]===original[key])||!same(result.company,original.company)||!Array.isArray(result.rows)||result.rows.length!==result.total||result.total>original.membersCount||!Number.isSafeInteger(result.pagesRead)||result.pagesRead<1||result.pagesRead>40)throw Error('원래 등록 파일과 현재 SKU 조회 결과의 연결이 다릅니다.');
  return result;
 }finally{active.delete(windowId);if(createdId!==undefined){try{const tab=await api.tabs.get(createdId);if(!tab.active&&!tab.pendingUrl&&isSupplierHubTab(tab,windowId,'/qvt/wims'))await api.tabs.remove(createdId);}catch{/* User-controlled or closed tabs remain untouched. */}}}
}
