import type {TranslationJob} from '@/app/automation/translation';

export const M2M_RECOVERY_MODEL='@cf/meta/m2m100-1.2b';
export const M2M_RECOVERY_STRATEGY='m2m-text-v1';
/** Historical Qwen reviews retain their own contract; only a new dedicated
 * translation review can carry this bounded per-field call budget. */
export function workersSeoRecoveryM2mBudget(proof:unknown):number|null{
 if(!proof||typeof proof!=='object'||Array.isArray(proof))return null;
 const value=proof as Record<string,unknown>;
 return value.strategy===M2M_RECOVERY_STRATEGY&&value.model===M2M_RECOVERY_MODEL&&!Object.hasOwn(value,'version')
  &&Number.isSafeInteger(value.maxCalls)&&Number(value.maxCalls)>=1&&Number(value.maxCalls)<=8?Number(value.maxCalls):null;
}
export function workersSeoRecoveryM2mLimit(settings:unknown):number|null{
 if(!settings||typeof settings!=='object'||Array.isArray(settings))return null;
 const value=settings as Record<string,unknown>;
 return value.configured===true&&value.freeOnly===true&&value.strategy===M2M_RECOVERY_STRATEGY&&value.model===M2M_RECOVERY_MODEL
  &&Number.isSafeInteger(value.maxCalls)&&Number(value.maxCalls)>=1&&Number(value.maxCalls)<=8?Number(value.maxCalls):null;
}
export type WorkersSeoRecoveryRequest={productId:string;productVersion:string;failedJobId:string;idempotencyKey:string};
export function newWorkersSeoRecoveryRequest(productId:string,productVersion:string,failedJobId:string):WorkersSeoRecoveryRequest{
 return {productId,productVersion,failedJobId,idempotencyKey:crypto.randomUUID()};
}

/** Preparing this separate review never approves, runs, or applies a model
 * request. Retain the same input on a lost acknowledgement. */
export async function prepareWorkersSeoRecovery(input:WorkersSeoRecoveryRequest,options:{signal:AbortSignal;contentRevision:number;expectedMaxCalls?:number;fetcher:typeof fetch}):Promise<TranslationJob>{
 if(options.signal.aborted)throw Error('요청을 중단했습니다.');
 if(options.expectedMaxCalls!==undefined&&(!Number.isSafeInteger(options.expectedMaxCalls)||options.expectedMaxCalls<1||options.expectedMaxCalls>8))throw Error('번역 요청의 최대 호출 범위를 확인해주세요.');
 const fetcher=options.fetcher;
 const response=await fetcher(`/api/products/${encodeURIComponent(input.productId)}/translation`,{
  method:'POST',signal:options.signal,headers:{'content-type':'application/json'},
  body:JSON.stringify({action:'prepare-collected-m2m',expectedVersion:input.productVersion,idempotencyKey:input.idempotencyKey,failedJobId:input.failedJobId}),
 });
 const value=await response.json() as {job?:TranslationJob;workersRecoveryReview?:boolean;error?:string};
 if(options.signal.aborted)throw Error('요청을 중단했습니다.');
 if(!response.ok)throw Error(value.error??'서버 AI 요청의 저장 상태를 확인하지 못했습니다. 같은 요청을 다시 확인해주세요.');
 const job=value.job,proof=job?.review?.workersRecovery,budget=workersSeoRecoveryM2mBudget(proof);
 if(value.workersRecoveryReview!==true||!job||job.productId!==input.productId||job.productVersion!==input.productVersion
  ||job.contentRevision!==options.contentRevision||job.review.destination!=='Cloudflare Workers AI'
  ||typeof job.id!=='string'||!job.id||!['prepared','approved','running','completed','failed','uncertain'].includes(job.status)
  ||!proof||proof.failedJobId!==input.failedJobId||proof.scope!=='collected'||job.review.model!==M2M_RECOVERY_MODEL||budget===null||budget>(options.expectedMaxCalls??8)
  ||typeof job.review.fingerprint!=='string'||!/^[a-f0-9]{64}$/u.test(job.review.fingerprint))
  throw Error('응답이 현재 상품의 서버 AI 검토 요청과 일치하지 않습니다. 생성 이력을 다시 확인해주세요.');
 return job;
}
