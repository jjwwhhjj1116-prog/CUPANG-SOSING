import { COLLECTION_RESULT_LIMIT, validateCollectionResult } from '@/app/collection-result';
import { collectionImageSelection, runCollectionImport, type CollectionImportOutcome, type CollectionImportProgress } from '@/app/collection-import';

export type CollectionDeliveryOutcome = CollectionImportOutcome & { receiptConfirmed: boolean };
/** Connector integration entry point. Uses the workspace's existing authenticated
 * requests; it does not collect a page, grant access, translate or submit to Hub.
 */
export async function deliverCollectionResult(jobId:string,offerId:string,input:unknown,options:{
 imageIndices?:readonly number[];fetcher?:typeof fetch;shouldStop?:()=>boolean;
 onProgress?:(progress:CollectionImportProgress|{stage:'receipt'})=>void;
}={}):Promise<CollectionDeliveryOutcome>{
 if(!jobId)throw new Error('수집 요청 번호가 필요합니다.');
 const result=validateCollectionResult(input,offerId);
 const indices=collectionImageSelection(result.images.length,options.imageIndices);
 const {offerId:derivedOfferId,...payload}=result;
 const body=JSON.stringify(payload);
 if(new TextEncoder().encode(body).byteLength>COLLECTION_RESULT_LIMIT)throw new Error('수집 결과는 512KB 이하여야 합니다.');
 const fetcher=options.fetcher??fetch;
 if(options.shouldStop?.())return {status:'stopped',receiptConfirmed:false,productId:null,completedImages:0};
 try{
  options.onProgress?.({stage:'receipt'});
  const response=await fetcher(`/api/collection-jobs/${encodeURIComponent(jobId)}/result`,{method:'POST',headers:{'content-type':'application/json'},body});
  const received=await response.json() as {error?:string;receipt?:{result?:unknown}};
  if(!response.ok)throw new Error(received.error||'수집 원문 수신에 실패했습니다.');
  const raw=received.receipt?.result;
  if(!raw||typeof raw!=='object'||Array.isArray(raw))throw new Error('수집 원문 수신 확인이 없습니다. 동일 원문으로 재시도해주세요.');
  const {offerId:confirmedOfferId,...confirmed}=raw as Record<string,unknown>;
  if(confirmedOfferId!==derivedOfferId||JSON.stringify(validateCollectionResult(confirmed,offerId))!==JSON.stringify(result))
   throw new Error('서버가 확인한 원문이 전송 원문과 다릅니다. 상품 반영을 중단했습니다.');
 }catch(cause){return {status:'failed',receiptConfirmed:false,productId:null,completedImages:0,error:cause instanceof Error?cause.message:'원문 저장 여부를 확인하지 못했습니다. 동일 원문으로 재시도해주세요.'};}
 const outcome=await runCollectionImport(jobId,result.images.length,{...options,fetcher,imageIndices:indices});
 return {...outcome,receiptConfirmed:true};
}
