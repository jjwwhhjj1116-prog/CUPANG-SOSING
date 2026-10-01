import {HANDOFF_ORIGINS,isAcceptedResult} from './handoff-store.mjs';
import {verifyAppQuotationSource} from './source-check.mjs';

// Recover only the authenticated app's accepted receipt. Old SKU rows are not
// fresh Hub evidence and must never be copied into a new lookup result.
export async function readAppSupplierHubReceipt(identity,binding,api=chrome){
  if(!HANDOFF_ORIGINS.includes(identity?.origin)||!/^\w[\w-]{0,99}$/.test(identity.productId||'')
    ||!/^\d{1,20}$/.test(identity.categoryId||'')||!/^[a-f0-9]{64}$/.test(identity.fingerprint||'')
    ||!Number.isSafeInteger(binding?.appTabId)||binding.appTabId<0||!Number.isSafeInteger(binding.windowId)||binding.windowId<0)
    throw Error('접수 결과를 조회할 앱과 견적서를 확인해주세요.');
  const current=async()=>{
    const tab=await api.tabs.get(binding.appTabId);let url;
    try{url=new URL(tab?.url);}catch{throw Error('견적서를 조회한 앱 탭을 같은 Chrome 창에 열어두세요.');}
    if(tab.id!==binding.appTabId||tab.windowId!==binding.windowId||url.origin!==identity.origin||url.username||url.password)
      throw Error('견적서를 조회한 앱 탭 또는 Chrome 창이 변경되었습니다.');
  };
  await current();
  const expected={origin:identity.origin,productId:identity.productId,categoryId:identity.categoryId,fingerprint:identity.fingerprint};
  const reply=await api.tabs.sendMessage(binding.appTabId,{type:'YOOFAM_READ_QUOTATION_RECEIPT',expected},{frameId:0});
  await current();
  if(reply?.ok!==true||!Object.keys(expected).every(field=>reply[field]===expected[field])
    ||!Number.isFinite(reply.checkedAt)||reply.checkedAt<=0||Math.abs(Date.now()-reply.checkedAt)>60000)
    throw Error('앱에 보관된 접수 결과를 확인하지 못했습니다.');
  if(reply.receipt===null)return null;
  const receipt=reply.receipt,result={...receipt?.result,...identity};
  if(receipt?.schemaVersion!==1||receipt.evidence!=='chrome-observation'||!/^\w[\w-]{0,99}$/.test(receipt.profileId||'')
    ||receipt.categoryId!==identity.categoryId||receipt.fingerprint!==identity.fingerprint||!isAcceptedResult(identity,result)
    ||!Number.isSafeInteger(result.observedAt)||result.observedAt<=0||result.observedAt>Date.now()+60000)
    throw Error('완료된 파일 검증 결과와 접수 ID를 확인하지 못했습니다.');
  const saved={...identity,profileId:receipt.profileId,company:{code:result.company.code,name:result.company.name},
    includedOptions:result.includedOptions,filename:result.filename,quotationId:result.quotationId,state:'validation-complete',
    registered:false,observedAt:result.observedAt,receiptRecovered:true};
  await verifyAppQuotationSource(identity,saved,binding,api);
  return saved;
}
