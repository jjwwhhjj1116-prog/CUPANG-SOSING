import { QuotationResultSourceChanged } from '@/app/quotation-result-source';
import { validateSupplierHubResultForSource, type SupplierHubResult } from '@/app/supplier-hub-handoff';
import type { SupplierHubReceipt } from '@/app/supplier-hub-receipt';

type Source={productId:string;profileId:string;categoryId:string;fingerprint:string;filename:string;company:{code:string;name:string};includedOptions:number};
async function receiptResponse(response:Response,signal:AbortSignal){
  const body=await response.json() as Record<string,unknown>|null;
  if(signal.aborted)throw new Error('작업을 취소했습니다.');
  if(!response.ok){
    const message=typeof body?.error==='string'?body.error:'전송 결과 보관을 확인하지 못했습니다.';
    if(response.status===409)throw new QuotationResultSourceChanged(message);
    throw new Error(message);
  }
  return body;
}
export async function storeSupplierHubReceipt(source:Source,result:SupplierHubResult,signal:AbortSignal){
  const body=await receiptResponse(await fetch(`/api/products/${encodeURIComponent(source.productId)}/supplier-hub-receipt`,{
    method:'POST',signal,headers:{'content-type':'application/json'},
    body:JSON.stringify({profileId:source.profileId,categoryId:source.categoryId,fingerprint:source.fingerprint,result}),
  }),signal);
  if(body?.saved!==true||body.fingerprint!==source.fingerprint||body.registered!==false)throw new Error('전송 결과의 보관 확인값이 다릅니다.');
}
export async function readStoredSupplierHubResult(source:Source,signal:AbortSignal):Promise<SupplierHubResult|null>{
  const body=await receiptResponse(await fetch(`/api/products/${encodeURIComponent(source.productId)}/supplier-hub-receipt?fingerprint=${source.fingerprint}`,{signal,cache:'no-store'}),signal);
  if(body?.receipt===null)return null;
  const receipt=body?.receipt as SupplierHubReceipt;
  if(!receipt||receipt.schemaVersion!==1||receipt.evidence!=='chrome-observation'||receipt.profileId!==source.profileId
    ||receipt.categoryId!==source.categoryId||receipt.fingerprint!==source.fingerprint)throw new Error('현재 견적서의 보관된 결과인지 확인하지 못했습니다.');
  validateSupplierHubResultForSource(receipt.result,source);
  return receipt.result;
}
