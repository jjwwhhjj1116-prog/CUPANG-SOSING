import type { TranslationJob, TranslationReview } from '@/app/automation/translation';
import { supplierHubCompany, type SupplierHubCompany } from '@/app/supplier-hub-company';

const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const hash=/^[a-f0-9]{64}$/;
export type SeoRetryProof={retryKey:string;scope:'seo';optionRevision:number;sourceFingerprint:string;company:SupplierHubCompany};
export type SeoRetryState={productId:string;productVersion:string;retryKey:string;jobId:string|null;executeSubmitted:boolean};
export function seoRetryReviewProof(review:TranslationReview):SeoRetryProof|null{
 if(!Object.hasOwn(review,'seoRetry'))return null;
 const proof=review.seoRetry;
 if(!proof||typeof proof!=='object'||Object.keys(proof).sort().join(',')!=='company,optionRevision,retryKey,scope,sourceFingerprint'
  ||typeof proof.retryKey!=='string'||!uuid.test(proof.retryKey)||proof.scope!=='seo'||!Number.isSafeInteger(proof.optionRevision)||proof.optionRevision<0
  ||typeof proof.sourceFingerprint!=='string'||!hash.test(proof.sourceFingerprint)||!proof.company||Object.keys(proof.company).sort().join(',')!=='code,name'
  ||!supplierHubCompany(proof.company.code,proof.company.name)||review.destination!=='Google 번역'||review.model!=='google-translate-gtx'
  ||review.instructionsVersion!=='sourceflow-translation-v6'||!Array.isArray(review.source.attributes)||review.source.attributes.length||Object.hasOwn(review,'optionsRetry'))
  throw Error('SEO 재시도 원문·회사·전송 범위를 확인하지 못했습니다.');
 return proof;
}
export function newSeoRetryState(productId:string,productVersion:string):SeoRetryState{
 return {productId,productVersion,retryKey:crypto.randomUUID(),jobId:null,executeSubmitted:false};
}
export function parseSeoRetryState(value:unknown,productId:string):SeoRetryState|null{
 if(!value||typeof value!=='object'||Array.isArray(value))return null;
 const state=value as SeoRetryState;
 return Object.keys(state).sort().join(',')==='executeSubmitted,jobId,productId,productVersion,retryKey'&&state.productId===productId
  &&typeof state.productVersion==='string'&&Number.isFinite(Date.parse(state.productVersion))&&typeof state.retryKey==='string'&&uuid.test(state.retryKey)
  &&(state.jobId===null||typeof state.jobId==='string'&&uuid.test(state.jobId))&&typeof state.executeSubmitted==='boolean'
  &&(!state.executeSubmitted||state.jobId!==null)?state:null;
}
type Controls={fetcher?:typeof fetch;signal:AbortSignal;onState:(state:SeoRetryState)=>void;onJob?:(job:TranslationJob)=>void};
export type SeoRetryOutcome={job:TranslationJob;closed:boolean;message:string};
async function run(state:SeoRetryState,controls:Controls,execute:boolean):Promise<SeoRetryOutcome>{
 if(!parseSeoRetryState(state,state.productId))throw Error('SEO 재시도 정보를 확인해주세요.');
 const fetcher=controls.fetcher??fetch,base=`/api/products/${encodeURIComponent(state.productId)}`,signal=controls.signal;
 const keep=(patch:Partial<SeoRetryState>)=>{Object.assign(state,patch);controls.onState(structuredClone(state));};
 const request=async(path:string,body?:Record<string,unknown>)=>{
  const response=await fetcher(base+path,{signal,cache:'no-store',...(body?{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}:{})});
  const value=await response.json() as Record<string,unknown>;
  if(signal.aborted)throw Error('SEO 재시도 확인을 중단했습니다. 저장한 작업은 유지됩니다.');
  if(!response.ok)throw Error(typeof value.error==='string'?value.error:'SEO 재시도 상태를 확인하지 못했습니다.');return value;
 };
 const validate=(value:unknown)=>{
  const job=value as TranslationJob;
  if(!job||typeof job.id!=='string'||!uuid.test(job.id)||job.productId!==state.productId||job.productVersion!==state.productVersion
   ||state.jobId&&job.id!==state.jobId||!Number.isSafeInteger(job.contentRevision)||job.contentRevision<0
   ||!['prepared','approved','running','completed','failed','uncertain'].includes(job.status)||typeof job.review?.fingerprint!=='string'||!hash.test(job.review.fingerprint)
   ||seoRetryReviewProof(job.review)?.retryKey!==state.retryKey)throw Error('다른 상품·원문·재시도의 응답입니다. 새 실행을 만들지 않았습니다.');
  keep({jobId:job.id});controls.onJob?.(job);return job;
 };
 let current=true;
 const lookup=async()=>{
  const value=await request('/translation?seoRetryKey='+encodeURIComponent(state.retryKey));
  if(value.productId!==state.productId||value.retryKey!==state.retryKey||!Object.hasOwn(value,'job')||typeof value.productVersion!=='string'
   ||!Number.isFinite(Date.parse(value.productVersion))||!(value.sourceCurrent===null||typeof value.sourceCurrent==='boolean'))throw Error('SEO 재시도 조회가 일치하지 않습니다.');
  current=value.productVersion===state.productVersion&&value.sourceCurrent!==false;
  return value.job===null?null:validate(value.job);
 };
 const recover=async(cause:unknown)=>{if(signal.aborted)throw cause;const saved=await lookup();if(!saved)throw cause;return saved;};
 let job=await lookup();
 if(!job){
  if(execute||state.jobId||state.executeSubmitted)throw Error('저장했던 SEO 재시도를 찾지 못했습니다. 번역을 다시 호출하지 않았습니다.');
  try{job=validate((await request('/translation',{action:'prepare-seo-retry',expectedVersion:state.productVersion,retryKey:state.retryKey})).job);}
  catch(cause){job=await recover(cause);}
 }
 if(!current){return {job,closed:!['running','uncertain'].includes(job.status),message:'재시도 이후 상품·원문·카테고리 또는 회사가 변경됐습니다. 기존 이력을 유지하고 새 실행·적용은 중단했습니다.'};}
 if(['prepared','approved'].includes(job.status)&&!job.startedAt&&!job.result&&!job.error&&Date.parse(job.review.expiresAt)<=Date.now())
  return {job,closed:true,message:'SEO 재시도 검토 기한이 종료됐습니다. 기존 작업은 유지하며 다시 눌러 현재 원문을 준비할 수 있습니다.'};
 if(!execute)return {job,closed:['completed','failed'].includes(job.status),message:job.status==='prepared'?'현재 수집 원문으로 새 SEO 요청을 준비했습니다. 원문을 검토하고 승인하면 무료 번역을 실행합니다. 기존 SEO·표시사항·가격·옵션은 저장하지 않았습니다.':'같은 SEO 재시도의 저장 상태를 확인했습니다. 번역을 새로 호출하지 않았습니다.'};
 if(job.status==='prepared'){
  if(state.executeSubmitted)return {job,closed:false,message:'이전 SEO 실행 요청의 상태가 불확실합니다. 작업 조회만 했으며 번역을 다시 호출하지 않았습니다.'};
  try{job=validate((await request('/translation',{action:'approve',jobId:job.id,reviewFingerprint:job.review.fingerprint,confirmPaid:true})).job);}
  catch(cause){job=await recover(cause);}
 }
 if(job.status==='approved'&&!state.executeSubmitted&&current){
  keep({executeSubmitted:true});
  try{job=validate((await request('/translation',{action:'execute',jobId:job.id})).job);}
  catch(cause){job=await recover(cause);}
 }
 return {job,closed:['completed','failed'].includes(job.status),message:job.status==='completed'?'새 한국어 SEO 초안을 받았습니다. 결과를 확인한 뒤 원하는 항목만 적용해주세요. 직접 수정한 값과 다른 단계는 저장하지 않았습니다.':job.status==='failed'?(job.error?.message??'SEO 번역을 완료하지 못했습니다. 원문과 수정값을 유지했으며 자동 재시도하지 않았습니다.'):'같은 SEO 재시도의 실행 결과를 확인해야 합니다. 번역을 다시 호출하지 않았습니다.'};
}
export const prepareSeoTranslationRetry=(state:SeoRetryState,controls:Controls)=>run(state,controls,false);
export const executeSeoTranslationRetry=(state:SeoRetryState,controls:Controls)=>run(state,controls,true);
