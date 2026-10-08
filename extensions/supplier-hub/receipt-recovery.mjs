import {HANDOFF_ORIGINS,isAcceptedResult,isStoredReceiptResult,resultKey,transferRecord} from './handoff-store.mjs';
import {verifyAppQuotationSource} from './source-check.mjs';
import {assertProductNotTransmitted} from './product-history.mjs';

// Read only the authenticated app's matching receipt. Old SKU rows are not
// fresh Hub evidence and must never be copied into a new lookup result.
export async function readAppSupplierHubReceipt(identity,binding,api=chrome){
  return readReceipt(identity,binding,api,true);
}
export async function readAppSupplierHubStoredReceipt(identity,binding,api=chrome){
  return readReceipt(identity,binding,api,false);
}
export async function readAppHistoricalSupplierHubReceipt(identity,binding,api=chrome,acceptedOnly=false){return readReceipt(identity,binding,api,acceptedOnly,true);}
export async function verifyHistoricalSupplierHubReceipt(identity,record,binding,api=chrome){
  const saved=await readAppHistoricalSupplierHubReceipt(identity,binding,api);
  if(!saved||!['profileId','filename','includedOptions','receiptProductVersion'].every(key=>saved[key]===record[key])
    ||saved.company.code!==record.company?.code||saved.company.name!==record.company?.name||saved.quotationId&&record.quotationId&&saved.quotationId!==record.quotationId)throw Error('원래 보관된 견적서의 회사·파일·옵션이 변경되었습니다.');
  return true;
}
async function readReceipt(identity,binding,api,acceptedOnly,historical=false){
  if(!HANDOFF_ORIGINS.includes(identity?.origin)||!/^\w[\w-]{0,99}$/.test(identity.productId||'')
    ||!/^\d{1,20}$/.test(identity.categoryId||'')||!/^[a-f0-9]{64}$/.test(identity.fingerprint||'')
    ||!Number.isSafeInteger(binding?.appTabId)||binding.appTabId<0||!Number.isSafeInteger(binding.windowId)||binding.windowId<0)
    throw Error('접수 결과를 조회할 앱과 견적서를 확인해주세요.');
  const current=async()=>{
    const tab=await api.tabs.get(binding.appTabId);let url;
    try{url=new URL(tab?.url);}catch{throw Error('견적서를 조회한 앱 탭을 같은 Chrome 창에 열어두세요.');}
    if(tab.id!==binding.appTabId||tab.windowId!==binding.windowId||tab.pendingUrl||url.origin!==identity.origin||url.username||url.password)
      throw Error('견적서를 조회한 앱 탭 또는 Chrome 창이 변경되었습니다.');
  };
  await current();
  const expected={origin:identity.origin,productId:identity.productId,categoryId:identity.categoryId,fingerprint:identity.fingerprint};
  const reply=await api.tabs.sendMessage(binding.appTabId,{type:historical?'YOOFAM_READ_HISTORICAL_TRANSMISSION_RECEIPT':acceptedOnly?'YOOFAM_READ_QUOTATION_RECEIPT':'YOOFAM_READ_TRANSMISSION_RECEIPT',expected},{frameId:0});
  await current();
  if(reply?.ok!==true||!Object.keys(expected).every(field=>reply[field]===expected[field])
    ||!Number.isFinite(reply.checkedAt)||reply.checkedAt<=0||Math.abs(Date.now()-reply.checkedAt)>60000)
    throw Error('앱에 보관된 접수 결과를 확인하지 못했습니다.');
  if(reply.receipt===null)return null;
  const receipt=reply.receipt,result={...receipt?.result,...identity};
  if(receipt?.schemaVersion!==1||receipt.evidence!=='chrome-observation'||!/^\w[\w-]{0,99}$/.test(receipt.profileId||'')
    ||receipt.categoryId!==identity.categoryId||receipt.fingerprint!==identity.fingerprint||!isStoredReceiptResult(identity,result)
    ||(acceptedOnly&&!isAcceptedResult(identity,result))||(historical&&!Number.isFinite(Date.parse(receipt.productVersion))))
    throw Error('완료된 파일 검증 결과와 접수 ID를 확인하지 못했습니다.');
  const saved={...identity,profileId:receipt.profileId,company:{code:result.company.code,name:result.company.name},
    includedOptions:result.includedOptions,filename:result.filename,state:result.state,registered:false,observedAt:result.observedAt,receiptRecovered:true,
    ...(historical?{historicalReceipt:true,receiptProductVersion:receipt.productVersion}:{}),
    ...Object.fromEntries(['submittedAt','status','detail','quotationId'].filter(field=>result[field]!==undefined).map(field=>[field,result[field]]))};
  if(!historical)await verifyAppQuotationSource(identity,saved,binding,api);
  return saved;
}

// A missing local claim is not proof that another Chrome profile has never
// submitted this draft. Check the app before touching or consuming Hub inputs.
export async function assertAppSupplierHubNotSubmitted(identity,prepared,binding,api=chrome,store=transferRecord){
  let saved;
  try{
    await assertProductNotTransmitted(identity,binding,api,(origin,productId)=>store('history',`history:${origin}:${productId}`));
    saved=await readAppSupplierHubStoredReceipt(identity,binding,api);
    if(saved&&(!['profileId','includedOptions'].every(field=>saved[field]===prepared[field])
      ||saved.company.code!==prepared.company?.code||saved.company.name!==prepared.company?.name))throw Error('준비한 견적서와 보관된 전송 기록이 다릅니다.');
    if(saved)await store('claim',resultKey(identity),saved);
  }catch(cause){
    if(cause?.code==='SUPPLIER_HUB_ALREADY_SUBMITTED')throw cause;
    const error=new Error('서버 전송 기록을 확인하지 못해 파일을 첨부하지 않았습니다. 접수 결과를 다시 확인해주세요.',{cause});
    error.code='SUPPLIER_HUB_RECEIPT_UNCONFIRMED';throw error;
  }
  if(saved){const error=new Error('이 견적서는 서버에 전송 기록이 있습니다. 검증 결과를 조회해주세요. 다시 첨부하지 않습니다.');error.code='SUPPLIER_HUB_ALREADY_SUBMITTED';throw error;}
  return true;
}
