import type {TranslationJob} from '@/app/automation/translation';

export type WorkersSeoRecoveryRequest={productId:string;productVersion:string;failedJobId:string;idempotencyKey:string};
export function newWorkersSeoRecoveryRequest(productId:string,productVersion:string,failedJobId:string):WorkersSeoRecoveryRequest{
 return {productId,productVersion,failedJobId,idempotencyKey:crypto.randomUUID()};
}

/** Preparing this separate review never approves, runs, or applies a model
 * request. Retain the same input on a lost acknowledgement. */
export async function prepareWorkersSeoRecovery(input:WorkersSeoRecoveryRequest,options:{signal:AbortSignal;contentRevision:number;fetcher:typeof fetch}):Promise<TranslationJob>{
 if(options.signal.aborted)throw Error('요청을 중단했습니다.');
 const fetcher=options.fetcher;
 const response=await fetcher(`/api/products/${encodeURIComponent(input.productId)}/translation`,{
  method:'POST',signal:options.signal,headers:{'content-type':'application/json'},
  body:JSON.stringify({action:'prepare-collected-workers',expectedVersion:input.productVersion,idempotencyKey:input.idempotencyKey,failedJobId:input.failedJobId}),
 });
 const value=await response.json() as {job?:TranslationJob;workersRecoveryReview?:boolean;error?:string};
 if(options.signal.aborted)throw Error('요청을 중단했습니다.');
 if(!response.ok)throw Error(value.error??'서버 AI 요청의 저장 상태를 확인하지 못했습니다. 같은 요청을 다시 확인해주세요.');
 const job=value.job,proof=job?.review?.workersRecovery;
 if(value.workersRecoveryReview!==true||!job||job.productId!==input.productId||job.productVersion!==input.productVersion
  ||job.contentRevision!==options.contentRevision||job.review.destination!=='Cloudflare Workers AI'
  ||typeof job.id!=='string'||!job.id||!['prepared','approved','running','completed','failed','uncertain'].includes(job.status)
  ||!proof||proof.failedJobId!==input.failedJobId||proof.scope!=='collected'||proof.version!==5||proof.model!=='@cf/qwen/qwen3-30b-a3b-fp8'
  ||typeof job.review.fingerprint!=='string'||!/^[a-f0-9]{64}$/u.test(job.review.fingerprint))
  throw Error('응답이 현재 상품의 서버 AI 검토 요청과 일치하지 않습니다. 생성 이력을 다시 확인해주세요.');
 return job;
}
