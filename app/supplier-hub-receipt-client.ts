import { QuotationResultSourceChanged } from '@/app/quotation-result-source';
import { validateSupplierHubResultForSource, type SupplierHubResult } from '@/app/supplier-hub-handoff';
import type { SupplierHubReceipt } from '@/app/supplier-hub-receipt';

type Source={productId:string;profileId:string;categoryId:string;fingerprint:string;filename:string;company:{code:string;name:string};includedOptions:number};
export class SupplierHubReceiptUnavailable extends Error {}
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
  let response:Response;
  try{
    response=await fetch(`/api/products/${encodeURIComponent(source.productId)}/supplier-hub-receipt?fingerprint=${source.fingerprint}`,{signal,cache:'no-store'});
  }catch(cause){
    if(signal.aborted)throw cause;
    throw new SupplierHubReceiptUnavailable('서버의 전송 기록을 읽지 못했습니다. 기존 Chrome 전송 기록을 확인합니다.');
  }
  if(!signal.aborted&&(response.status===408||response.status===429||response.status>=500)){
    const failure=await response.clone().json().catch(()=>null) as {code?:string}|null;
    if(failure?.code!=='AUTH_REQUIRED')
      throw new SupplierHubReceiptUnavailable('서버의 전송 기록 조회가 일시적으로 실패했습니다. 기존 Chrome 전송 기록을 확인합니다.');
  }
  const body=await receiptResponse(response,signal);
  if(body?.receipt===null)return null;
  const receipt=body?.receipt as SupplierHubReceipt;
  if(!receipt||receipt.schemaVersion!==1||receipt.evidence!=='chrome-observation'||receipt.profileId!==source.profileId
    ||receipt.categoryId!==source.categoryId||receipt.fingerprint!==source.fingerprint)throw new Error('현재 견적서의 보관된 결과인지 확인하지 못했습니다.');
  validateSupplierHubResultForSource(receipt.result,source);
  return receipt.result;
}
