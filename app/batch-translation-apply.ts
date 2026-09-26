import type { BatchTranslationTarget } from '@/app/batch-translation';

export type BatchTranslationPlan = { productId:string; productVersion:string; contentRevision:number; optionRevision:number; fingerprint:string; preview:{name:string;before:string;after:string}[]; skipped:string[] };
export type ReviewedTranslation = { target:BatchTranslationTarget; plan:BatchTranslationPlan };
const record=(value:unknown):Record<string,unknown>=>value&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:{};
async function request(target:BatchTranslationTarget,action:'preview'|'apply',fetcher:typeof fetch,plan?:BatchTranslationPlan){
 if(!target.jobId)throw Error('완료 번역이 없습니다.');
 const response=await fetcher(`/api/products/${encodeURIComponent(target.productId)}/translation-apply`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action,jobId:target.jobId,expectedVersion:target.version,...(plan?{fingerprint:plan.fingerprint}:{})})});
 const result=record(await response.json());
 if(!response.ok)throw Error(typeof result.error==='string'?result.error:'번역 적용 응답을 확인하지 못했습니다. 저장본을 다시 조회해주세요.');
 if((result.scope??'all')!=='all'||result.productId!==target.productId)throw Error('번역 적용 대상 응답이 일치하지 않습니다.');
 return result;
}
export async function previewBatchTranslation(target:BatchTranslationTarget,fetcher:typeof fetch):Promise<ReviewedTranslation>{
 const result=await request(target,'preview',fetcher);
 if(result.productVersion!==target.version||typeof result.fingerprint!=='string'||!/^[a-f0-9]{64}$/.test(result.fingerprint)
  ||![result.contentRevision,result.optionRevision].every(value=>typeof value==='number'&&Number.isSafeInteger(value)&&value>=0)
  ||!Array.isArray(result.skipped)||!result.skipped.every(value=>typeof value==='string')
  ||!Array.isArray(result.preview)||!result.preview.every(value=>{const row=record(value);return ['name','before','after'].every(key=>typeof row[key]==='string');}))throw Error('미리보기 응답이 올바르지 않습니다.');
 return {target:{...target},plan:result as BatchTranslationPlan};
}
/** Save exactly the reviewed plans, serially. Never retry an uncertain write. */
export async function applyBatchTranslations(items:readonly ReviewedTranslation[],options:{fetcher:typeof fetch;shouldStop:()=>boolean;onSaved:(productId:string,applied:number)=>void}){
 if(new Set(items.map(item=>item.target.productId)).size!==items.length)throw Error('중복 상품을 제외하고 다시 검토해주세요.');
 const snapshot=structuredClone(items);
 for(const item of snapshot){
  if(item.plan.productId!==item.target.productId||item.plan.productVersion!==item.target.version)throw Error('검토한 상품과 저장 대상이 다릅니다.');
 }
 const saved:string[]=[];
 for(const {target,plan} of snapshot){
  if(options.shouldStop())return {status:'stopped' as const,saved};
  if(!plan.preview.length)continue;
  try{
   const result=await request(target,'apply',options.fetcher,plan);
   if(typeof result.productVersion!=='string'||!Number.isFinite(Date.parse(result.productVersion))||!Number.isFinite(Date.parse(target.version))
    ||Date.parse(result.productVersion)<=Date.parse(target.version)||result.contentRevision!==plan.contentRevision+1||result.optionRevision!==plan.optionRevision+1||result.applied!==plan.preview.length)throw Error('저장 응답이 검토 내용과 다릅니다. 저장본을 다시 조회해주세요. 자동 재저장하지 않았습니다.');
   saved.push(target.productId);options.onSaved(target.productId,plan.preview.length);
  }catch(error){return {status:'failed' as const,saved,failedProductId:target.productId,error:error instanceof Error?error.message:'저장 여부를 다시 조회해주세요.'};}
 }
 return {status:'completed' as const,saved};
}
