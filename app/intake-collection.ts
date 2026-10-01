import type { CollectionJob } from '@/app/sourcing';
import { validateCollectionReceiptResponse } from '@/app/collection-receipt-response';
import { importReceivedJobs } from '@/app/collection-batch';
import type { CollectionImportOutcome } from '@/app/collection-import';
import { prepareIntakeSeoOutcome } from '@/app/intake-seo';
import type { BrowserProductCapture } from '@/app/browser-product-bridge';

/** A user-initiated fetch produces an editable draft only, never a Hub submission. */
export async function collectIntakeProduct(job:CollectionJob,options:{signal:AbortSignal;fetcher:typeof fetch;onJob:(job:CollectionJob)=>void;onProgress:(message:string)=>void;captureFromBrowser?:(sourceUrl:string,signal:AbortSignal)=>Promise<BrowserProductCapture>}) {
 if(options.signal.aborted)return;
 // A durable server write can finish after its view closes. It remains
 // recoverable, but must not publish into a reopened or newly edited queue.
 const reportJob=(value:CollectionJob)=>{if(!options.signal.aborted)options.onJob(value);};
 const reportProgress=(message:string)=>{if(!options.signal.aborted)options.onProgress(message);};
 if(job.status==='cancelled')throw Error('취소된 수집 요청입니다.');
 // A product can already exist even though image import failed. Resume from
 // the immutable receipt; never treat a product ID alone as completed import.
 if(job.product_id&&!job.received_at){reportJob(job);return '기존 상품 열기 · 저장된 수정값 유지';}
 let received=job;
 if(!job.received_at){
  reportProgress('상품 페이지에서 정보 가져오는 중');
  let response=await options.fetcher(`/api/collection-jobs/${encodeURIComponent(job.id)}/collect`,{method:'POST',signal:options.signal});
  let body=await response.json() as {error?:string;code?:string;receipt?:{receivedAt?:unknown}};
  if(!response.ok&&body.code==='SOURCE_NOT_COLLECTED'&&options.captureFromBrowser&&!options.signal.aborted){
   reportProgress('현재 Chrome에서 1688 상품 원문 확인 중');
   const captured=await options.captureFromBrowser(job.source_url,options.signal);
   if(options.signal.aborted)return;
   response=await options.fetcher(`/api/collection-jobs/${encodeURIComponent(job.id)}/browser-capture`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(captured),signal:options.signal});
   body=await response.json() as typeof body;
  }
  if(options.signal.aborted)return;
  if(!response.ok)throw Error(body?.error||'상품 정보를 가져오지 못했습니다.');
  const result=validateCollectionReceiptResponse(body,job.id,job.offer_id);
  if(!result)throw Error('수집 원문을 확인하지 못했습니다.');
  const receivedAt=body.receipt?.receivedAt;
  if(typeof receivedAt!=='string'||!Number.isFinite(Date.parse(receivedAt)))throw Error('원문 저장 시각을 확인하지 못했습니다.');
  received={...job,received_at:receivedAt};
 } else if(!Number.isFinite(Date.parse(job.received_at)))throw Error('원문 저장 시각을 확인하지 못했습니다.');
 if(options.signal.aborted)return;
 reportJob(received);
 const outcomes:CollectionImportOutcome[]=[];
 let seo:Awaited<ReturnType<typeof prepareIntakeSeoOutcome>>|undefined;
 const prepareDraft=async(productId:string)=>{
  if(options.signal.aborted)return;
  reportJob({...received,product_id:productId});
  if(job.goal==='collect'||seo)return;
  reportProgress('저장 원문으로 SEO·옵션 초안 작성 중');
  seo=await prepareIntakeSeoOutcome(productId,options.fetcher,options.signal);
 };
 await importReceivedJobs([received],{assignToStage:false,reservedImageSlots:1,onProductSaved:(_id,productId)=>prepareDraft(productId),fetcher:(url,init)=>options.fetcher(url,{...init,signal:options.signal}),shouldStop:()=>options.signal.aborted,
  onProgress:(_id,message)=>reportProgress(message),onResult:(_id,outcome)=>{outcomes.push(outcome);if(outcome.productId)reportJob({...received,product_id:outcome.productId});}});
 if(options.signal.aborted)return;
 const outcome=outcomes[0];
 if(!outcome||!outcome.productId)throw Error(outcome?.error||'상품 반영을 완료하지 못했습니다. 원문은 보존됩니다.');
 if(outcome.status==='stopped')return;
 // The add-only choice ends at source import, including on resume. It must
 // not depend on AI configuration or prepare a generation request.
 if(job.goal==='collect'){
  if(outcome.status!=='completed')throw Error([outcome.error||'이미지 반영을 완료하지 못했습니다. 원문은 보존됩니다.',...(outcome.warnings??[])].filter(Boolean).join(' '));
  return ['상품 추가 완료 · 옵션·가격을 확인한 뒤 다음 단계를 진행해주세요.',...(outcome.warnings??[])].filter(Boolean).join(' ');
 }

 // Image storage can fail after the product transaction commits. Source-based
 // SEO preparation does not depend on image downloads; retain both outcomes.
 await prepareDraft(outcome.productId);
 const draft=seo!;
 if(options.signal.aborted)return;
 if(outcome.status!=='completed' || !draft.completed)throw Error([outcome.status!=='completed'?(outcome.error||'이미지 반영을 완료하지 못했습니다. 원문은 보존됩니다.'):'',draft.message,...(outcome.warnings??[])].filter(Boolean).join(' '));
 return ['상품 초안 저장됨 · 옵션·이미지·견적서를 확인하고 수정해주세요.',draft.message,...(outcome.warnings??[])].filter(Boolean).join(' ');
}
