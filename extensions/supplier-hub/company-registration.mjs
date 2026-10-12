import {HANDOFF_ORIGINS} from './handoff-store.mjs';
import {isSupplierHubTab,waitForSupplierHubPage,supplierHubStatusReady} from './hub-tab.mjs';
import {verifySupplierHubCompany} from './company.mjs';
import {querySupplierHubCompanyRegistrations} from './company-registration-page.mjs';
const active=new Set();
export async function readAppCompanyRegistrations(message,sender,api=chrome){
 let origin;try{origin=new URL(sender?.url).origin;}catch{throw Error('앱 출처를 확인해주세요.');}
 const windowId=sender?.tab?.windowId,appTabId=sender?.tab?.id;
 if(message?.type!=='YOOFAM_QUERY_COMPANY_REGISTRATIONS'||sender.frameId!==0||!HANDOFF_ORIGINS.includes(origin)||!Number.isSafeInteger(windowId)||windowId<0||!Number.isSafeInteger(appTabId)||appTabId<0)throw Error('현재 앱의 등록상태 조회 요청을 확인해주세요.');
 const query=message.query,keys=['startDate','endDate','status','title'],date=value=>{try{return typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&new Date(value+'T00:00:00Z').toISOString().slice(0,10)===value;}catch{return false;}};
 if(!query||typeof query!=='object'||Array.isArray(query)||Object.keys(query).length!==4||!keys.every(key=>Object.hasOwn(query,key))||!date(query.startDate)||!date(query.endDate)||query.startDate>query.endDate||!['전체','상품 검수중','상품 검수 완료','상품 검수 반려'].includes(query.status)||typeof query.title!=='string'||query.title!==query.title.trim()||query.title.length>200||/[\u0000-\u001f]/.test(query.title))throw Error('등록 상태 조회 조건을 확인해주세요.');
 if(active.has(windowId))throw Error('이 Chrome 창에서 등록상태를 조회 중입니다.');active.add(windowId);let createdId;
 try{
  const context=async()=>{const tab=await api.tabs.get(appTabId);if(tab.pendingUrl||tab.windowId!==windowId||new URL(tab.url).origin!==origin)throw Error('조회한 앱 탭이 변경되었습니다.');const result=await api.tabs.sendMessage(appTabId,{type:'YOOFAM_READ_CATALOG_CONTEXT'},{frameId:0});if(result?.ok!==true||typeof result.ownerId!=='string'||!/^\w[\w-]{0,99}$/.test(result.ownerId)||({A01526306:'유앤채',A01464742:'와이홉'})[result.company?.code]!==result.company?.name)throw Error('로그인 회원의 승인된 회사정보가 필요합니다.');return result;};
  const original=await context(),paths=['/qvt/wims','/qvt/registration','/dashboard/KR'];
  const tabs=(await api.tabs.query({windowId,url:paths.map(path=>'https://supplier.coupang.com'+path+'*')})).filter(tab=>!tab.pendingUrl&&paths.some(path=>isSupplierHubTab(tab,windowId,path)));
  const hub=tabs.find(tab=>tab.active)||tabs[0];if(!hub)throw Error('앱과 같은 Chrome 창에 로그인한 Supplier Hub를 열어두세요.');
  const initial=await api.tabs.get(hub.id);if(initial.pendingUrl||!isSupplierHubTab(initial,windowId,new URL(hub.url).pathname))throw Error('로그인한 Supplier Hub 화면이 변경되었습니다.');
  const [company]=await api.scripting.executeScript({target:{tabId:hub.id},func:verifySupplierHubCompany,args:[original.company,'catalog']});if(company?.result?.code!==original.company.code)throw Error('회원과 Supplier Hub 회사코드가 다릅니다.');
  const fresh=await api.tabs.create({windowId,url:'https://supplier.coupang.com/qvt/wims',active:false});if(!Number.isSafeInteger(fresh?.id)||fresh.id<0||fresh.windowId!==windowId)throw Error('같은 Chrome 창에 조회 화면을 준비하지 못했습니다.');createdId=fresh.id;
  await waitForSupplierHubPage(createdId,windowId,'/qvt/wims',supplierHubStatusReady,api);
  const check=async()=>{const current=await context();if(current.ownerId!==original.ownerId||current.company.code!==original.company.code||current.company.name!==original.company.name)throw Error('조회 중 로그인 계정 또는 회사정보가 변경되었습니다.');const tab=await api.tabs.get(createdId);if(tab.pendingUrl||!isSupplierHubTab(tab,windowId,'/qvt/wims'))throw Error('조회 화면이 다른 창 또는 주소로 변경되었습니다.');const [company]=await api.scripting.executeScript({target:{tabId:createdId},func:verifySupplierHubCompany,args:[original.company]});if(company?.result?.code!==original.company.code)throw Error('조회 중 Supplier Hub 회사가 변경되었습니다.');};
  await check();const [execution]=await api.scripting.executeScript({target:{tabId:createdId},func:querySupplierHubCompanyRegistrations,args:[message.query,original.company]});await check();
  const result=execution?.result;if(result?.source!=='supplier-hub-company-registration-v1'||result.mutated!==false||result.scope!=='queried-pages'||result.company?.code!==original.company.code||result.company?.name!==original.company.name||!result.query||Object.keys(result.query).length!==4||!keys.every(key=>result.query[key]===query[key])||!Array.isArray(result.rows)||result.rows.length!==result.total||!Number.isSafeInteger(result.total)||result.total<0||result.total>2000||!Number.isSafeInteger(result.pagesRead)||result.pagesRead<1||result.pagesRead>200)throw Error('회원 회사의 실제 조회 결과를 확인하지 못했습니다.');
  return {...result,ownerId:original.ownerId};
 }finally{active.delete(windowId);if(createdId!==undefined){try{const tab=await api.tabs.get(createdId);if(!tab.active&&!tab.pendingUrl&&isSupplierHubTab(tab,windowId,'/qvt/wims'))await api.tabs.remove(createdId);}catch{/* A user-controlled or already closed tab is left alone. */}}}
}
