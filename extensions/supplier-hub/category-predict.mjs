import {HANDOFF_ORIGINS} from './handoff-store.mjs';
import {isSupplierHubTab} from './hub-tab.mjs';
import {verifySupplierHubCompany} from './company.mjs';
import {getRecommendations} from './category-predict-page.mjs';

const companies={A01526306:'유앤채',A01464742:'와이홉'};
const allowedPath=path=>['/dashboard/KR','/qvt/registration','/qvt/wims','/sr/registration'].includes(path)||/^\/sr\/registration\/step\/(startPage|productPage|imagePage|legalPage|logisticsPage)$/.test(path);
const documentId=value=>typeof value==='string'&&value.trim()===value&&value.length>0&&value.length<=200;
const approvedCompany=value=>Boolean(value&&Object.hasOwn(companies,value.code)&&companies[value.code]===value.name);
const validOwner=value=>typeof value==='string'&&/^\w[\w-]{0,99}$/.test(value);

/** Recommendations are read-only suggestions. Selection and official schema verification remain separate. */
export async function readAppSupplierHubCategoryRecommendations(message,sender,api=chrome){
  return readAppSupplierHubCategoryQuery(message,sender,api,false);
}
export async function readAppSupplierHubCategorySearch(message,sender,api=chrome){
  return readAppSupplierHubCategoryQuery(message,sender,api,true);
}
async function readAppSupplierHubCategoryQuery(message,sender,api,search){
  let appUrl;try{appUrl=new URL(sender?.url);}catch{throw Error('앱 출처를 확인하지 못했습니다.');}
  const origin=appUrl.origin,windowId=sender?.tab?.windowId,appTabId=sender?.tab?.id;
  const input=search?message?.keyword:message?.productName;
  if(message?.type!==(search?'YOOFAM_SEARCH_CATEGORIES':'YOOFAM_RECOMMEND_CATEGORIES')||sender.frameId!==0||appUrl.username||appUrl.password||!HANDOFF_ORIGINS.includes(origin)
    ||!Number.isSafeInteger(windowId)||windowId<0||!Number.isSafeInteger(appTabId)||appTabId<0
    ||typeof input!=='string'||!input.trim()||input.trim().length>(search?120:500)||/[\u0000-\u001f\u007f]/.test(input)
    ||!validOwner(message.expectedOwnerId)||sender.documentId!==undefined&&!documentId(sender.documentId))throw Error(search?'허용된 앱에서 로그인 회원과 검색할 카테고리 이름을 확인해주세요.':'허용된 앱에서 로그인 회원과 추천할 상품명을 확인해주세요.');
  const productName=input.trim(),appDocumentId=sender.documentId;
  const readContext=async()=>{
    const tab=await api.tabs.get(appTabId);
    if(tab?.id!==appTabId||tab.windowId!==windowId||tab.pendingUrl||tab.url!==sender.url)throw Error('카테고리를 추천하던 앱 탭이 변경되었습니다.');
    const context=await api.tabs.sendMessage(appTabId,{type:'YOOFAM_READ_CATALOG_CONTEXT'},appDocumentId?{frameId:0,documentId:appDocumentId}:{frameId:0});
    const current=await api.tabs.get(appTabId);
    if(current?.id!==appTabId||current.windowId!==windowId||current.pendingUrl||current.url!==sender.url)throw Error('카테고리를 추천하던 앱 탭이 변경되었습니다.');
    if(context?.ok!==true||!validOwner(context.ownerId)||context.ownerId!==message.expectedOwnerId||!approvedCompany(context.company))throw Error('로그인 회원의 승인된 Supplier Hub 회사정보가 필요합니다.');
    return {ownerId:context.ownerId,company:{code:context.company.code,name:context.company.name}};
  };
  const context=await readContext();
  const tabs=(await api.tabs.query({windowId,url:['https://supplier.coupang.com/dashboard/KR*','https://supplier.coupang.com/qvt/registration*','https://supplier.coupang.com/qvt/wims*','https://supplier.coupang.com/sr/registration*']}))
    .filter(tab=>{try{return !tab.pendingUrl&&allowedPath(new URL(tab.url).pathname)&&isSupplierHubTab(tab,windowId,new URL(tab.url).pathname);}catch{return false;}});
  const tab=tabs.find(tab=>tab.active)||tabs.find(tab=>isSupplierHubTab(tab,windowId,'/qvt/registration'))||tabs[0];
  if(!tab)throw Error('앱과 같은 Chrome 창에 로그인된 Supplier Hub 대시보드 또는 등록·조회 탭을 열어두세요.');
  const checkTab=async()=>{const current=await api.tabs.get(tab.id);if(current?.id!==tab.id||current.pendingUrl||current.url!==tab.url||!isSupplierHubTab(current,windowId,new URL(tab.url).pathname))throw Error('추천을 읽던 Supplier Hub 탭이 변경되었습니다.');};
  let hubDocumentId;
  const execute=async(func,args)=>{
    await checkTab();
    const results=await api.scripting.executeScript({target:hubDocumentId?{tabId:tab.id,documentIds:[hubDocumentId]}:{tabId:tab.id,frameIds:[0]},func,args});
    if(!Array.isArray(results)||results.length!==1||!results[0]||results[0].frameId!==undefined&&results[0].frameId!==0)throw Error('추천 조회 문서를 확인하지 못했습니다.');
    const execution=results[0];
    if(execution.documentId!==undefined&&!documentId(execution.documentId)||hubDocumentId&&execution.documentId!==hubDocumentId)throw Error('추천 조회 중 Supplier Hub 문서가 변경되었습니다.');
    if(!hubDocumentId&&execution.documentId)hubDocumentId=execution.documentId;
    await checkTab();return execution.result;
  };
  const before=await execute(verifySupplierHubCompany,[context.company,'catalog']);
  if(before?.code!==context.company.code)throw Error('회원 회사와 Supplier Hub 회사코드가 다릅니다.');
  const result=await execute(getRecommendations,[productName,context.company,...(search?[true]:[])]);
  const after=await execute(verifySupplierHubCompany,[context.company,'catalog']);
  if(after?.code!==context.company.code)throw Error('추천 조회 중 Supplier Hub 회사코드가 변경되었습니다.');
  const latest=await readContext();
  if(latest.ownerId!==context.ownerId||latest.company.code!==context.company.code||latest.company.name!==context.company.name)throw Error('추천을 읽는 동안 앱 회원 또는 회사정보가 변경되었습니다.');
  await checkTab();
  const now=Date.now();
  const source=search?'supplier-hub-category-keyword-api':'supplier-hub-category-predict-api';
  if(result?.source!==source||result[search?'keyword':'productName']!==productName||result.company?.code!==context.company.code||result.company?.name!==context.company.name
    ||!Number.isSafeInteger(result.observedAt)||result.observedAt>now+30000||result.observedAt<now-30000||!Array.isArray(result.items)||result.items.length>(search?1000:3))throw Error(search?'선택한 회원·회사·검색어의 최신 카테고리 결과를 확인하지 못했습니다.':'선택한 회원·회사·상품명의 최신 카테고리 추천인지 확인하지 못했습니다.');
  const ids=new Set(),codes=new Set();
  const items=result.items.map(item=>{
    if(!item||typeof item!=='object'||Array.isArray(item)||typeof item.id!=='string'||!item.id.trim()||item.id!==item.id.trim()||item.id.length>100||/[\u0000-\u001f\u007f]/.test(item.id)||ids.has(item.id)
      ||typeof item.code!=='string'||!/^[1-9]\d{0,19}$/.test(item.code)||codes.has(item.code)||!Array.isArray(item.path)||item.path.length<1||item.path.length>10
      ||item.path.some(name=>typeof name!=='string'||!name.trim()||name!==name.trim()||name.length>240||/[>\u0000-\u001f\u007f]/.test(name))||item.label!==item.path.join(' > '))throw Error('추천 카테고리의 코드·전체 경로를 확인하지 못했습니다.');
    ids.add(item.id);codes.add(item.code);return {id:item.id,code:item.code,path:[...item.path],label:item.label};
  });
  return {source,ownerId:context.ownerId,company:{...context.company},...(search?{keyword:productName}:{productName}),observedAt:result.observedAt,items};
}
