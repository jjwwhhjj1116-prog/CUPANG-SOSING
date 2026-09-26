import type { CollectionJob } from '@/app/sourcing';
import { validateCollectionReceiptResponse } from '@/app/collection-receipt-response';
import { importReceivedJobs } from '@/app/collection-batch';
import type { CollectionImportOutcome } from '@/app/collection-import';

/** A user-initiated fetch produces an editable draft only, never a Hub submission. */
export async function collectIntakeProduct(job:CollectionJob,options:{signal:AbortSignal;fetcher:typeof fetch;onJob:(job:CollectionJob)=>void;onProgress:(message:string)=>void}) {
 if(options.signal.aborted)return;
 if(job.product_id){options.onJob(job);return '기존 상품 열기 · 저장된 수정값 유지';}
 options.onProgress('상품 페이지에서 정보 가져오는 중');
 const response=await options.fetcher(`/api/collection-jobs/${encodeURIComponent(job.id)}/collect`,{method:'POST',signal:options.signal});
 const body=await response.json() as {error?:string;receipt?:{receivedAt?:unknown}};
 if(!response.ok)throw Error(body?.error||'상품 정보를 가져오지 못했습니다.');
 const result=validateCollectionReceiptResponse(body,job.id,job.offer_id);
 if(!result)throw Error('수집 원문을 확인하지 못했습니다.');
 const receivedAt=body.receipt?.receivedAt;
 if(typeof receivedAt!=='string'||!Number.isFinite(Date.parse(receivedAt)))throw Error('원문 저장 시각을 확인하지 못했습니다.');
 const received={...job,received_at:receivedAt};
 if(options.signal.aborted)return;
 options.onJob(received);
 const outcomes:CollectionImportOutcome[]=[];
 await importReceivedJobs([received],{fetcher:(url,init)=>options.fetcher(url,{...init,signal:options.signal}),shouldStop:()=>options.signal.aborted,
  onProgress:(_id,message)=>options.onProgress(message),onResult:(_id,outcome)=>{outcomes.push(outcome);if(outcome.productId)options.onJob({...received,product_id:outcome.productId});}});
 if(options.signal.aborted)return;
 const outcome=outcomes[0];
 if(!outcome||outcome.status!=='completed'||!outcome.productId)throw Error(outcome?.error||'상품 반영을 완료하지 못했습니다. 원문은 보존됩니다.');
 return ['상품 초안 저장됨 · 옵션·이미지·견적서를 확인하고 수정해주세요.',...(outcome.warnings??[])].join(' ');
}
