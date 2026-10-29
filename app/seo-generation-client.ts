import {WORKERS_TEXT_MODEL,WORKERS_QWEN_MODEL,validateTranslationSource,type TranslationJob,type TranslationSource} from '@/app/automation/translation';
import {seoGenerationReviewProof,validateSeoGenerationMemo,validateSeoGenerationDraft,type SeoGenerationMemo,type SeoGenerationConfiguration} from '@/app/seo-generation';
import {supplierHubCompany,type SupplierHubCompany} from '@/app/supplier-hub-company';
import {translationReviewExpired} from '@/app/reviewed-translation';

export type {SeoGenerationConfiguration};
export type SeoGenerationContext={purpose:'seo-generation';productId:string;productVersion:string;contentRevision:number;optionRevision:number;sourceFingerprint:string;company:SupplierHubCompany;source:TranslationSource;memo:SeoGenerationMemo;configuration:SeoGenerationConfiguration;jobs:TranslationJob[];sourceCurrent?:boolean|null;idempotencyKey?:string};
export type SeoGenerationDraftState={schemaVersion:2;purpose:'seo-generation';productId:string;productVersion:string;contentRevision:number;optionRevision:number;sourceFingerprint:string;company:SupplierHubCompany;source:TranslationSource;memo:SeoGenerationMemo;configuration:SeoGenerationConfiguration;idempotencyKey:string;jobId:string|null;reviewFingerprint:string|null;prepareSubmitted:boolean;approvalSubmitted:boolean;executeSubmitted:boolean};
export type SeoGenerationDraftControls={signal:AbortSignal;fetcher:typeof fetch;onState:(state:SeoGenerationDraftState)=>void;onJob?:(job:TranslationJob)=>void;isContextCurrent?:()=>boolean;confirmAi?:boolean};
export type SeoGenerationDraftOutcome={job:TranslationJob|null;closed:boolean;needsReview:true;partial:boolean;label:'Workers AI SEO 생성 초안';message:string};
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/u,HASH=/^[a-f0-9]{64}$/u;
const object=(value:unknown):value is Record<string,unknown>=>Boolean(value&&typeof value==='object'&&!Array.isArray(value));
const exact=(value:unknown,keys:string):value is Record<string,unknown>=>object(value)&&Object.keys(value).sort().join(',')===keys;
const canonical=(value:unknown):string=>value===null||typeof value!=='object'?JSON.stringify(value):Array.isArray(value)?'['+value.map(canonical).join(',')+']':'{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonical((value as Record<string,unknown>)[key])).join(',')+'}';
const same=(left:unknown,right:unknown)=>canonical(left)===canonical(right);
const validVersion=(value:unknown):value is string=>typeof value==='string'&&value.length<=100&&Number.isFinite(Date.parse(value));
const revision=(value:unknown)=>Number.isSafeInteger(value)&&Number(value)>=0;
const inFlight=new Set<string>();

/** The optional paid translation destination is a separate, exact notice snapshot. */
export function parseSeoGenerationConfiguration(raw:unknown):SeoGenerationConfiguration|null{
 if(!object(raw)||!exact(Object.fromEntries(Object.entries(raw).filter(([key])=>key!=='translationConfig')),'configured,destination,freeOnly,issues,maxOutputTokens,model,notice')||typeof raw.configured!=='boolean'||raw.model!==WORKERS_TEXT_MODEL||raw.maxOutputTokens!==2048||raw.freeOnly!==true||raw.destination!=='Cloudflare Workers AI'
  ||!Array.isArray(raw.issues)||raw.issues.length>20||raw.issues.some(value=>typeof value!=='string'||value.length>2000)||typeof raw.notice!=='string'||!raw.notice.trim()||raw.notice.length>4000)return null;
 if(Object.hasOwn(raw,'translationConfig')){
  const translation=raw.translationConfig;
  if(!exact(translation,'configured,destination,freeOnly,issues,maxOutputTokens,model,notice,provider')||typeof translation.configured!=='boolean'||translation.provider!=='workers-ai'||translation.model!==WORKERS_QWEN_MODEL||translation.freeOnly!==false||translation.destination!=='Cloudflare Workers AI'
   ||!(translation.maxOutputTokens===null&&!translation.configured||Number.isSafeInteger(translation.maxOutputTokens)&&Number(translation.maxOutputTokens)>=256&&Number(translation.maxOutputTokens)<=8000)
   ||!Array.isArray(translation.issues)||translation.issues.length>20||translation.issues.some(value=>typeof value!=='string'||value.length>2000)||typeof translation.notice!=='string'||!translation.notice.trim()||translation.notice.length>4000)return null;
 }
 return structuredClone(raw) as SeoGenerationConfiguration;
}
function context(raw:unknown,productId:string):SeoGenerationContext{
 if(!object(raw)||!exact(Object.fromEntries(Object.entries(raw).filter(([key])=>!['sourceCurrent','idempotencyKey'].includes(key))),'company,configuration,contentRevision,jobs,memo,optionRevision,productId,productVersion,purpose,source,sourceFingerprint')||raw.sourceCurrent!==undefined&&raw.sourceCurrent!==null&&typeof raw.sourceCurrent!=='boolean'||raw.idempotencyKey!==undefined&&!UUID.test(String(raw.idempotencyKey))||raw.purpose!=='seo-generation'||raw.productId!==productId||!validVersion(raw.productVersion)||!revision(raw.contentRevision)||!revision(raw.optionRevision)||!HASH.test(String(raw.sourceFingerprint))
  ||!exact(raw.company,'code,name')||!supplierHubCompany(raw.company.code,raw.company.name)||!Array.isArray(raw.jobs)||raw.jobs.length>20||!parseSeoGenerationConfiguration(raw.configuration))throw Error('현재 상품의 SEO 생성 원문·회사·무료 서비스 설정을 확인하지 못했습니다.');
 const source=validateTranslationSource(raw.source);if(!source.category||!same(source,raw.source)||!same(validateSeoGenerationMemo(raw.memo),raw.memo))throw Error('SEO 생성 원문과 참고 입력의 연결을 확인하지 못했습니다.');
 return structuredClone(raw) as unknown as SeoGenerationContext;
}
async function json(response:Response):Promise<Record<string,unknown>>{
 if(response.redirected||response.type==='opaqueredirect'||response.headers.get('content-type')?.split(';',1)[0].trim().toLowerCase()!=='application/json')throw Error('SEO 생성 응답의 형식·출처를 확인하지 못했습니다.');
 const raw:unknown=await response.json();if(!object(raw))throw Error('SEO 생성 응답을 확인하지 못했습니다.');
 if(!response.ok)throw Error(typeof raw.error==='string'&&raw.error.length<=2000?raw.error:'SEO 생성 요청을 확인하지 못했습니다. 같은 요청의 상태를 조회해주세요.');return raw;
}
export async function readSeoGenerationContext(productId:string,signal:AbortSignal,fetcher:typeof fetch):Promise<SeoGenerationContext>{
 if(!/^[A-Za-z0-9_-]{1,100}$/u.test(productId))throw Error('SEO 생성 상품을 확인해주세요.');signal.throwIfAborted();
 const value=await json(await fetcher('/api/products/'+encodeURIComponent(productId)+'/seo-generation',{signal,cache:'no-store',credentials:'same-origin',redirect:'error'}));signal.throwIfAborted();return context(value,productId);
}
const stateKeys='approvalSubmitted,company,configuration,contentRevision,executeSubmitted,idempotencyKey,jobId,memo,optionRevision,prepareSubmitted,productId,productVersion,purpose,reviewFingerprint,schemaVersion,source,sourceFingerprint';
export function parseSeoGenerationDraftState(raw:unknown,productId:string):SeoGenerationDraftState|null{
 try{
  if(typeof raw==='string'){if(raw.length>96*1024||new TextEncoder().encode(raw).length>96*1024)return null;raw=JSON.parse(raw);}
  if(!exact(raw,stateKeys)||raw.schemaVersion!==2||raw.purpose!=='seo-generation'||raw.productId!==productId||!/^[A-Za-z0-9_-]{1,100}$/u.test(productId)||!validVersion(raw.productVersion)||!revision(raw.contentRevision)||!revision(raw.optionRevision)||!HASH.test(String(raw.sourceFingerprint))
   ||!exact(raw.company,'code,name')||!supplierHubCompany(raw.company.code,raw.company.name)||!parseSeoGenerationConfiguration(raw.configuration)||!same(validateSeoGenerationMemo(raw.memo),raw.memo)||!same(validateTranslationSource(raw.source),raw.source)
   ||!(raw.source as TranslationSource).category||!UUID.test(String(raw.idempotencyKey))||!(raw.jobId===null||UUID.test(String(raw.jobId)))||!(raw.reviewFingerprint===null||HASH.test(String(raw.reviewFingerprint)))
   ||(raw.jobId===null)!==(raw.reviewFingerprint===null)||![raw.prepareSubmitted,raw.approvalSubmitted,raw.executeSubmitted].every(value=>typeof value==='boolean')||raw.jobId!==null&&!raw.prepareSubmitted||raw.approvalSubmitted&&raw.jobId===null||raw.executeSubmitted&&!raw.approvalSubmitted
   ||new TextEncoder().encode(JSON.stringify(raw)).length>96*1024)return null;
  return structuredClone(raw) as SeoGenerationDraftState;
 }catch{return null;}
}
export function createSeoGenerationDraftState(view:SeoGenerationContext,memo:SeoGenerationMemo=view.memo):SeoGenerationDraftState{
 const checked=context(view,view.productId),state:SeoGenerationDraftState={schemaVersion:2,purpose:'seo-generation',productId:checked.productId,productVersion:checked.productVersion,contentRevision:checked.contentRevision,optionRevision:checked.optionRevision,sourceFingerprint:checked.sourceFingerprint,company:checked.company,source:checked.source,memo:validateSeoGenerationMemo(memo),configuration:checked.configuration,
  idempotencyKey:crypto.randomUUID(),jobId:null,reviewFingerprint:null,prepareSubmitted:false,approvalSubmitted:false,executeSubmitted:false};
 if(!parseSeoGenerationDraftState(state,state.productId))throw Error('SEO 생성 요청 범위를 확인해주세요.');return state;
}
async function advance(state:SeoGenerationDraftState,controls:SeoGenerationDraftControls,execute:boolean):Promise<SeoGenerationDraftOutcome>{
 if(!parseSeoGenerationDraftState(state,state.productId))throw Error('원래 SEO 생성 요청의 복구 정보를 확인해주세요. 새 요청을 만들지 않았습니다.');
 if(inFlight.has(state.idempotencyKey))throw Error('같은 SEO 생성 요청을 확인 중입니다. 중복 요청하지 않았습니다.');inFlight.add(state.idempotencyKey);
 const base='/api/products/'+encodeURIComponent(state.productId)+'/seo-generation';let sourceCurrent=true;
 const check=()=>{controls.signal.throwIfAborted();if(controls.isContextCurrent?.()===false)throw Error('SEO 생성 상품·참고 입력이 변경됐습니다. 원래 요청을 유지했습니다.');};
 const keep=(patch:Partial<SeoGenerationDraftState>)=>{Object.assign(state,patch);controls.onState(structuredClone(state));};
 const validate=(job:unknown):TranslationJob=>{
  if(!object(job)||!UUID.test(String(job.id))||job.productId!==state.productId||job.productVersion!==state.productVersion||job.contentRevision!==state.contentRevision||state.jobId!==null&&job.id!==state.jobId||!['prepared','approved','running','completed','failed','uncertain'].includes(String(job.status))||!object(job.review))throw Error('원래 상품의 SEO 생성 작업을 확인하지 못했습니다.');
  const value=job as unknown as TranslationJob,proof=seoGenerationReviewProof(value.review);
  if(!proof||proof.sourceFingerprint!==state.sourceFingerprint||proof.optionRevision!==state.optionRevision||!same(proof.company,state.company)||!same(proof.memo,state.memo)||!same(value.review.source,state.source)||!HASH.test(value.review.fingerprint)||state.reviewFingerprint!==null&&value.review.fingerprint!==state.reviewFingerprint||value.review.paidNotice!==state.configuration.notice)throw Error('SEO 생성 원문·브랜드·참고 입력 또는 무료 서비스의 연결이 다릅니다.');
  if(value.status==='completed'){if(!value.result||value.result.model!==WORKERS_TEXT_MODEL||value.result.provenance!=='generated'||value.result.appliedToContent!==false)throw Error('SEO 생성 결과의 모델·저장 범위가 다릅니다.');validateSeoGenerationDraft(value.result.draft,value.review);}
  else if(value.result!==null||['prepared','approved','running'].includes(value.status)&&value.error!==null)throw Error('SEO 생성 작업 상태를 확인하지 못했습니다.');
  keep({jobId:value.id,reviewFingerprint:value.review.fingerprint,...(['approved','running','completed','failed','uncertain'].includes(value.status)?{approvalSubmitted:true}:{}),...(['running','completed','failed','uncertain'].includes(value.status)?{executeSubmitted:true}:{})});controls.onJob?.(value);return value;
 };
 const lookup=async()=>{
  check();const query=state.jobId?'jobId='+encodeURIComponent(state.jobId):'idempotencyKey='+encodeURIComponent(state.idempotencyKey),view=context(await json(await controls.fetcher(base+'?'+query,{signal:controls.signal,cache:'no-store',credentials:'same-origin',redirect:'error'})),state.productId);check();
  if(state.jobId===null&&view.idempotencyKey!==state.idempotencyKey)throw Error('원래 SEO 생성 요청 키의 조회 응답이 다릅니다.');
  sourceCurrent=view.sourceCurrent!==false&&view.productVersion===state.productVersion&&view.contentRevision===state.contentRevision&&view.optionRevision===state.optionRevision&&view.sourceFingerprint===state.sourceFingerprint&&same(view.company,state.company)&&same(view.source,state.source)&&same(view.configuration,state.configuration);
  if(view.jobs.length>1)throw Error('같은 SEO 생성 요청의 조회 결과가 중복되었습니다.');return view.jobs.length?validate(view.jobs[0]):null;
 };
 const request=async(body:Record<string,unknown>)=>{
  check();const value=await json(await controls.fetcher(base,{method:'POST',signal:controls.signal,cache:'no-store',credentials:'same-origin',redirect:'error',headers:{'content-type':'application/json'},body:JSON.stringify(body)}));check();
  if(!exact(value,'company,job,productId,productVersion,purpose,sourceCurrent')||value.purpose!=='seo-generation'||value.productId!==state.productId||!same(value.company,state.company)||typeof value.sourceCurrent!=='boolean'||!validVersion(value.productVersion))throw Error('SEO 생성 응답의 상품·회사·현재 원문을 확인하지 못했습니다.');
  sourceCurrent=value.sourceCurrent&&value.productVersion===state.productVersion;return validate(value.job);
 };
 const outcome=(job:TranslationJob|null,message?:string):SeoGenerationDraftOutcome=>({job,closed:Boolean(job&&['completed','failed'].includes(job.status)),needsReview:true,partial:false,label:'Workers AI SEO 생성 초안',message:message??(job?.status==='completed'?'Cloudflare Workers AI의 상품명·검색태그·설명 초안을 받았습니다. 직접 수정한 값과 공란은 검토 적용에서 유지합니다.':job?.status==='failed'?job.error?.message||'SEO 생성이 실패했습니다. Google 번역을 AI 최적화 완료로 표시하지 않았습니다.':'같은 SEO 생성 요청의 상태만 확인했습니다. 새 AI 호출이나 상품 저장은 하지 않았습니다.')});
 const recover=async(cause:unknown)=>{check();try{return outcome(await lookup());}catch{check();throw cause;}};
 try{
  check();let job=state.jobId!==null||state.prepareSubmitted||!execute?await lookup():null;
  if(!execute)return outcome(job);
  if(state.executeSubmitted)return outcome(job);
  if(!job){if(state.prepareSubmitted)return outcome(null,'이전 SEO 준비 요청의 결과를 확인하지 못했습니다. 같은 키로 상태만 조회했으며 새 실행은 만들지 않았습니다.');
   if(!state.configuration.configured)return outcome(null,'무료 SEO 생성 서비스가 준비되지 않았습니다. Google 옵션 번역과 AI SEO 생성은 구분하여 표시합니다.');
   keep({prepareSubmitted:true});try{job=await request({action:'prepare',expectedVersion:state.productVersion,expectedContentRevision:state.contentRevision,expectedOptionRevision:state.optionRevision,expectedSourceFingerprint:state.sourceFingerprint,memo:state.memo,idempotencyKey:state.idempotencyKey});}catch(cause){return await recover(cause);}}
  if(['completed','failed','running','uncertain'].includes(job.status))return outcome(job);
  if(!sourceCurrent)return outcome(job,'상품·회사·원문 또는 무료 서비스 설정이 변경되어 SEO 생성을 실행하지 않았습니다.');
  if(translationReviewExpired(job))return outcome(job,'SEO 생성 요청의 검토 기한이 지났습니다. 새 실행은 하지 않았습니다.');
  if(controls.confirmAi!==true)return outcome(job,'Cloudflare Workers AI의 실제 전송 원문·무료 한도 안내를 확인한 뒤 같은 SEO 생성 요청을 승인해주세요.');
  if(job.status==='prepared'){if(state.approvalSubmitted)return outcome(job);keep({approvalSubmitted:true});try{job=await request({action:'approve',jobId:job.id,reviewFingerprint:job.review.fingerprint,confirmPaid:true});if(job.status!=='approved')throw Error('SEO 생성 승인 상태를 확인하지 못했습니다.');}catch(cause){return await recover(cause);}}
  check();if(!sourceCurrent||job.status!=='approved')return outcome(job);keep({executeSubmitted:true});try{return outcome(await request({action:'execute',jobId:job.id}));}catch(cause){return await recover(cause);}
 }finally{inFlight.delete(state.idempotencyKey);}
}
export const runSeoGenerationDraft=(state:SeoGenerationDraftState,controls:SeoGenerationDraftControls)=>advance(state,controls,true);
export const refreshSeoGenerationDraft=(state:SeoGenerationDraftState,controls:SeoGenerationDraftControls)=>advance(state,controls,false);
