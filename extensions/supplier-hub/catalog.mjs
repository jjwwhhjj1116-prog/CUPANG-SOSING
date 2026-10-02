import {HANDOFF_ORIGINS} from './handoff-store.mjs';
import {isSupplierHubTab} from './hub-tab.mjs';
import {verifySupplierHubCompany} from './company.mjs';
import {readSupplierHubCategoryBranch} from './catalog-page.mjs';

const catalogPath=path=>['/qvt/registration','/qvt/wims','/sr/registration'].includes(path)||/^\/sr\/registration\/step\/(startPage|productPage|imagePage|legalPage|logisticsPage)$/.test(path);
const catalogTab=(tab,windowId)=>{try{const path=new URL(tab.url).pathname;return catalogPath(path)&&!tab.pendingUrl&&isSupplierHubTab(tab,windowId,path);}catch{return false;}};

export async function readAppSupplierHubCatalog(message,sender,api=chrome){
  let origin;try{origin=new URL(sender?.url).origin;}catch{throw Error('앱 출처를 확인하지 못했습니다.');}
  const windowId=sender?.tab?.windowId,appTabId=sender?.tab?.id;
  if(message?.type!=='YOOFAM_READ_CATEGORY_BRANCH'||sender.frameId!==0||!HANDOFF_ORIGINS.includes(origin)
    ||!Number.isSafeInteger(windowId)||windowId<0||!Number.isSafeInteger(appTabId)||appTabId<0
    ||!Array.isArray(message.trail)||message.trail.length>10||message.trail.some(node=>!node||typeof node.categoryId!=='string'||!/^[1-9]\d{0,19}$/.test(node.categoryId)||typeof node.name!=='string'||!node.name.trim()||node.name.length>240||node.isLeaf!==false)
    ||new Set(message.trail.map(node=>node.categoryId)).size!==message.trail.length)throw Error('허용된 앱에서 카테고리를 선택해주세요.');
  const trail=message.trail.map(node=>({categoryId:node.categoryId,name:node.name,isLeaf:false}));
  const readContext=async()=>{
    const tab=await api.tabs.get(appTabId);
    if(tab?.windowId!==windowId||tab.pendingUrl||new URL(tab.url).origin!==origin)throw Error('원래 상품추가 앱 탭이 변경되었습니다.');
    const context=await api.tabs.sendMessage(appTabId,{type:'YOOFAM_READ_CATALOG_CONTEXT'},{frameId:0});
    if(context?.ok!==true||typeof context.ownerId!=='string'||!/^\w[\w-]{0,99}$/.test(context.ownerId)||!Object.hasOwn({A01526306:'유앤채',A01464742:'와이홉'},context.company?.code)
      ||({A01526306:'유앤채',A01464742:'와이홉'})[context.company?.code]!==context.company?.name)throw Error('로그인 회원의 승인된 Supplier Hub 회사정보가 필요합니다.');
    return context;
  };
  const context=await readContext();
  const tabs=(await api.tabs.query({windowId,url:['https://supplier.coupang.com/qvt/registration*','https://supplier.coupang.com/qvt/wims*','https://supplier.coupang.com/sr/registration*']}))
    .filter(tab=>catalogTab(tab,windowId));
  const tab=tabs.find(tab=>tab.active)||tabs.find(tab=>isSupplierHubTab(tab,windowId,'/qvt/registration'))||tabs[0];
  if(!tab)throw Error('앱과 같은 Chrome 창에 로그인된 Supplier Hub 등록 또는 견적 조회 탭을 열어두세요.');
  const checkTab=async()=>{const current=await api.tabs.get(tab.id);if(current.pendingUrl||!isSupplierHubTab(current,windowId,new URL(tab.url).pathname))throw Error('카테고리를 읽던 Supplier Hub 탭이 변경되었습니다.');};
  await checkTab();
  const [company]=await api.scripting.executeScript({target:{tabId:tab.id},func:verifySupplierHubCompany,args:[context.company,'catalog']});
  if(company?.result?.code!==context.company.code)throw Error('회원 회사와 Supplier Hub 회사코드가 다릅니다.');
  await checkTab();
  const [execution]=await api.scripting.executeScript({target:{tabId:tab.id},func:readSupplierHubCategoryBranch,args:[trail,context.company]});
  await checkTab();const latest=await readContext();
  if(latest.ownerId!==context.ownerId||latest.company.code!==context.company.code||latest.company.name!==context.company.name)throw Error('카테고리를 읽는 동안 앱 회원 또는 회사정보가 변경되었습니다.');
  const result=execution?.result;
  if(result?.source!=='supplier-hub-category-api'||result.company?.code!==context.company.code||result.company?.name!==context.company.name||JSON.stringify(result.trail)!==JSON.stringify(trail))throw Error('선택한 회사·상위 경로의 카테고리 결과인지 확인하지 못했습니다.');
  return {...result,ownerId:context.ownerId};
}
