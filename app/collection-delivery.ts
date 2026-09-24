import { COLLECTION_RESULT_LIMIT, validateCollectionResult } from '@/app/collection-result';
import { collectionRequestWithRetry } from '@/app/collection-retry';
import { recommendCollectionImages, validateCollectionCapacity } from '@/app/collection-capacity';
import { collectionImageSelection, runCollectionImport, type CollectionImportOutcome, type CollectionImportProgress } from '@/app/collection-import';

export type CollectionDeliveryOutcome = CollectionImportOutcome & { receiptConfirmed: boolean };
/** Connector integration entry point. Uses the workspace's existing authenticated
 * requests; it does not collect a page, grant access, translate or submit to Hub.
 */
export async function deliverCollectionResult(jobId:string,offerId:string,input:unknown,options:{
 imageIndices?:readonly number[];fetcher?:typeof fetch;shouldStop?:()=>boolean;
 retryAttempts?:number;retryWait?:(milliseconds:number)=>Promise<void>;onRetry?:(attempt:number)=>void;
 onProgress?:(progress:CollectionImportProgress|{stage:'receipt'})=>void;
}={}):Promise<CollectionDeliveryOutcome>{
 if(!jobId)throw new Error('수집 요청 번호가 필요합니다.');
 const attempts=options.retryAttempts??3;
 if(!Number.isInteger(attempts)||attempts<1||attempts>3)throw new Error('재시도 횟수는 1~3회여야 합니다.');
 const result=validateCollectionResult(input,offerId);
 // Explicit selections are validated before writing. Automatic selection needs
 // the confirmed receipt and current capacity; never truncate the source data.
 const automatic=options.imageIndices===undefined;
 let indices=collectionImageSelection(result.images.length,options.imageIndices??[]);
 const {offerId:derivedOfferId,...payload}=result;
 const body=JSON.stringify(payload);
 if(new TextEncoder().encode(body).byteLength>COLLECTION_RESULT_LIMIT)throw new Error('수집 결과는 512KB 이하여야 합니다.');
 const fetcher=options.fetcher??fetch;
 if(options.shouldStop?.())return {status:'stopped',receiptConfirmed:false,productId:null,completedImages:0};
 try{
  options.onProgress?.({stage:'receipt'});
  // The receipt endpoint accepts exact replays and rejects different source data.
  // Serialize once so a lost response never changes the original request body.
  const response=await collectionRequestWithRetry(`/api/collection-jobs/${encodeURIComponent(jobId)}/result`,{method:'POST',headers:{'content-type':'application/json'},body},
   {fetcher,attempts,wait:options.retryWait,shouldStop:options.shouldStop,onRetry:options.onRetry});
  const received=await response.json() as {error?:string;receipt?:{result?:unknown}};
  if(!response.ok)throw new Error(received.error||'수집 원문 수신에 실패했습니다.');
  const raw=received.receipt?.result;
  if(!raw||typeof raw!=='object'||Array.isArray(raw))throw new Error('수집 원문 수신 확인이 없습니다. 동일 원문으로 재시도해주세요.');
  const {offerId:confirmedOfferId,...confirmed}=raw as Record<string,unknown>;
  if(confirmedOfferId!==derivedOfferId||JSON.stringify(validateCollectionResult(confirmed,offerId))!==JSON.stringify(result))
   throw new Error('서버가 확인한 원문이 전송 원문과 다릅니다. 상품 반영을 중단했습니다.');
 }catch(cause){return {status:options.shouldStop?.()?'stopped':'failed',receiptConfirmed:false,productId:null,completedImages:0,error:cause instanceof Error?cause.message:'원문 저장 여부를 확인하지 못했습니다. 동일 원문으로 재시도해주세요.'};}
 if(options.shouldStop?.())return {status:'stopped',receiptConfirmed:true,productId:null,completedImages:0};
 if(automatic&&result.images.length){
  try{
   const response=await collectionRequestWithRetry(`/api/collection-jobs/${encodeURIComponent(jobId)}/capacity`,{cache:'no-store'},
    {fetcher,attempts,wait:options.retryWait,shouldStop:options.shouldStop,onRetry:options.onRetry});
   const body=await response.json() as {capacity?:unknown;error?:string};
   if(!response.ok)throw new Error(body.error||'이미지 저장 여유 조회 실패');
   indices=recommendCollectionImages(result,validateCollectionCapacity(body.capacity,result.images.length));
  }catch(cause){return {status:options.shouldStop?.()?'stopped':'failed',receiptConfirmed:true,productId:null,completedImages:0,error:cause instanceof Error?cause.message:'자동 이미지 선택 실패'};}
 }
 const outcome=await runCollectionImport(jobId,result.images.length,{...options,retryAttempts:attempts,fetcher,imageIndices:indices});
 const omitted=automatic?result.images.length-indices.length:0;
 const warnings=[...(omitted?[`원본 이미지 ${result.images.length}개 중 ${indices.length}개를 저장 여유에 맞춰 선택했습니다. 나머지 ${omitted}개 주소는 수집 원문에 보존되어 있습니다.`]:[]),...(outcome.warnings??[])];
 return {...outcome,receiptConfirmed:true,...(warnings.length?{warnings}: {})};
}
