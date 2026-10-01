import { validateRegistrationResult, validateSupplierHubResultForSource, type SupplierHubResult, type SupplierHubRegistrationRow, type SupplierHubRegistration } from '@/app/supplier-hub-handoff';

export type SupplierHubReceipt = {
  schemaVersion:1; evidence:'chrome-observation'; profileId:string; categoryId:string;
  fingerprint:string; productVersion:string; recordedAt:string; result:SupplierHubResult;
};
export type SupplierHubReceiptSummary = {
  label:string; company:{code:string;name:string}; quotationId:string|null;
  fingerprint:string; categoryId:string; observedAt:number; includedOptions:number; issuedSkus:number;
};
type ReceiptSource={filename:string;company:{code:string;name:string};includedOptions:number};

/** Chrome observations are receipts, never a server assertion of final approval. */
export function validateSupplierHubReceiptResult(value:unknown, source:ReceiptSource):SupplierHubResult {
  const result=value as SupplierHubResult;
  if(!Number.isSafeInteger(source.includedOptions)||source.includedOptions<1||source.includedOptions>200
    ||!result||!['validation-pending','validation-complete','validation-rejected'].includes(result.state)
    ||result.registered!==false||!Number.isSafeInteger(result.observedAt)||result.observedAt<=0||result.observedAt>Date.now()+60000
    ||['submittedAt','status','detail','quotationId'].some(key=>result[key as keyof SupplierHubResult]!==undefined
      &&(typeof result[key as keyof SupplierHubResult]!=='string'||String(result[key as keyof SupplierHubResult]).length>20000)))
    throw new Error('Supplier Hub에서 관찰한 견적서 결과를 확인해주세요.');
  validateSupplierHubResultForSource(result,source);
  if(result.state==='validation-complete'&&(typeof result.quotationId!=='string'||!result.quotationId
    ||result.quotationId!==result.quotationId.trim()||result.quotationId.length>200))throw new Error('접수된 견적서 ID를 확인해주세요.');
  if(result.registration!==undefined){
    if(result.state!=='validation-complete')throw new Error('상품별 결과에는 견적서 파일 검증 완료가 필요합니다.');
    validateRegistrationResult(result.registration,result.quotationId);
    if(!Number.isSafeInteger(result.registration.observedAt))throw new Error('상품별 조회 시각을 확인해주세요.');
    const skus=issuedSkuIds(result);
    if(new Set(skus).size!==skus.length)throw new Error('같은 SKU ID가 중복된 결과는 보관할 수 없습니다.');
  }
  let registration:SupplierHubRegistration|undefined;
  if(result.registration){
    const current=result.registration;
    const fields=['title','submittedAt','category','barcode','sourceQuotation','skuId','status','stage'] as const;
    const base={quotationId:current.quotationId,registered:false as const,observedAt:current.observedAt,includedOptions:source.includedOptions,
      rows:current.rows.map(row=>Object.fromEntries(fields.map(field=>[field,row[field]])) as SupplierHubRegistrationRow)};
    registration=current.scope==='queried-pages'?{...base,scope:'queried-pages',pagesRead:current.pagesRead,hasMore:current.hasMore}:{...base,scope:'visible-page'};
  }
  // Store only the result contract, not arbitrary client-supplied extra fields.
  return {state:result.state,filename:result.filename,company:{...source.company},includedOptions:source.includedOptions,
    observedAt:result.observedAt,registered:false,
    ...Object.fromEntries(['submittedAt','status','detail','quotationId'].filter(key=>result[key as keyof SupplierHubResult]!==undefined).map(key=>[key,result[key as keyof SupplierHubResult]])),
    ...(registration?{registration}:{})};
}
export function parseStoredSupplierHubReceipt(payload:string):SupplierHubReceipt {
  const receipt=JSON.parse(payload) as SupplierHubReceipt;
  const company=receipt?.result?.company;
  const allowed:Record<string,string>={A01464742:'와이홉',A01526306:'유앤채'};
  if(!receipt||receipt.schemaVersion!==1||receipt.evidence!=='chrome-observation'
    ||typeof receipt.profileId!=='string'||!/^[a-zA-Z0-9_-]{1,100}$/.test(receipt.profileId)
    ||typeof receipt.categoryId!=='string'||!receipt.categoryId||receipt.categoryId.length>100
    ||typeof receipt.fingerprint!=='string'||!/^[a-f0-9]{64}$/.test(receipt.fingerprint)
    ||typeof receipt.productVersion!=='string'||!Number.isFinite(Date.parse(receipt.productVersion))
    ||typeof receipt.recordedAt!=='string'||!Number.isFinite(Date.parse(receipt.recordedAt))
    ||!company||!Object.hasOwn(allowed,company.code)||company.name!==allowed[company.code])throw new Error('보관된 전송 결과를 확인해주세요.');
  validateSupplierHubReceiptResult(receipt.result,{filename:`YOOFAM-${receipt.fingerprint}.xlsx`,company,includedOptions:receipt.result.includedOptions!});
  return receipt;
}
export function supplierHubReceiptObservationTime(result:SupplierHubResult) {
  // File-only refreshes may carry a cached SKU lookup. Keep that lookup's own time.
  return result.registration?.observedAt??result.observedAt;
}
export function supplierHubReceiptOrder(result:SupplierHubResult){
  const summary=receiptStatus(result);
  return summary.label.includes('반려')?1000:summary.label==='SKU ID 확인'?500:result.registration?10+summary.issuedSkus:result.state==='validation-complete'?1:0;
}
function issuedSkuIds(result:SupplierHubResult) {
  return (result.registration?.rows??[]).map(row=>row.skuId.trim()).filter(value=>value&&!/\.\.\.|…/.test(value)&&!/^(?:-|—|n\/a|미표시|해당사항없음)$/i.test(value));
}
function receiptStatus(result:SupplierHubResult){
  const rows=result.registration?.rows??[],issuedSkus=issuedSkuIds(result).length;
  const rejected=rows.some(row=>/반려|거절|실패/.test(row.status+' '+row.stage));
  const allSkus=rows.length===result.includedOptions&&issuedSkus===result.includedOptions
    &&!(result.registration?.scope==='queried-pages'&&result.registration.hasMore===true);
  return {label:result.state==='validation-rejected'?'파일 반려':rejected?'상품 반려':allSkus?'SKU ID 확인':result.state==='validation-complete'?'견적서 접수':'파일 검증 중',issuedSkus};
}
export function supplierHubReceiptSummary(receipt:SupplierHubReceipt):SupplierHubReceiptSummary {
  const result=receipt.result;
  return {...receiptStatus(result),
    company:result.company!,quotationId:result.quotationId??null,fingerprint:receipt.fingerprint,categoryId:receipt.categoryId,
    observedAt:supplierHubReceiptObservationTime(result),includedOptions:result.includedOptions!};
}
