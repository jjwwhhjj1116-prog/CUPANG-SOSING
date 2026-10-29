import {env} from 'cloudflare:workers';
import {fingerprint} from '@/app/automation/model';
import type {TranslationJob} from '@/app/automation/translation';
import {readBoundedJson,RequestBodyError} from '@/app/request-body';
import {seoGenerationSettings,seoGenerationAuthorization,seoGenerationAuthorized,seoGenerationSource,currentSeoGenerationJob} from '@/app/seo-generation-server';
import {prepareSeoGenerationReview,seoGenerationReviewProof,verifySeoGenerationReview,validateSeoGenerationMemo,validateSeoGenerationDraft,executeSeoGeneration,SeoGenerationError,type SeoGenerationSecrets} from '@/app/seo-generation';
import {listTranslationJobs,getTranslationJob,findSeoGenerationTranslation,createSeoGenerationTranslation,approveTranslationJob,claimTranslationJob,finishTranslationJob} from '@/db/translation-jobs';
import {reserveQuotationAiRequest} from '@/db/quotation-ai-jobs';
import {integratedTranslationPlan} from '@/app/translation-integrated-adoption';
import {applyContentPatch} from '@/app/product-content';
import {applySeoDocumentTitlePolicy} from '@/app/seo-title-document';
import {applyExplicitSeoQuotationDefaults} from '@/app/explicit-seo-quotation-defaults';
import {saveIntegratedTranslation} from '@/db/translation-adoption';

type Context={params:Promise<{id:string}>};
const uuid=(value:unknown):value is string=>typeof value==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/u.test(value);
const hash=(value:unknown):value is string=>typeof value==='string'&&/^[a-f0-9]{64}$/u.test(value);
const exact=(value:Record<string,unknown>,keys:string)=>Object.keys(value).sort().join(',')===keys;
const json=(value:unknown,status=200)=>Response.json(value,{status,headers:{'cache-control':'no-store'}});
const changed=()=>new SeoGenerationError('SEO_GENERATION_CHANGED','상품·원문·옵션 또는 승인 회사가 변경되었습니다. 현재 저장본을 확인해주세요.');
const errorReply=(error:unknown)=>json({error:error instanceof SeoGenerationError||error instanceof RequestBodyError?error.message:'SEO 생성 상태를 확인하지 못했습니다. 같은 요청의 저장 상태를 조회해주세요.',code:error instanceof SeoGenerationError?error.code:'SEO_GENERATION_UNAVAILABLE'},error instanceof SeoGenerationError||error instanceof RequestBodyError?error.status:503);
async function readContext(context:Context){const {id}=await context.params;if(!/^[\w-]{1,100}$/u.test(id))throw changed();const auth=await seoGenerationAuthorization(),saved=await seoGenerationSource(auth,id);return {id,auth,saved};}
function validJob(job:TranslationJob|null,company:{code:string;name:string}):job is TranslationJob{
 if(!job)return false;const proof=seoGenerationReviewProof(job.review);return !!proof&&proof.company.code===company.code&&proof.company.name===company.name;
}
async function sourceCurrent(auth:Awaited<ReturnType<typeof seoGenerationAuthorization>>,id:string,job:TranslationJob){
 try{const saved=await seoGenerationSource(auth,id);currentSeoGenerationJob(job,saved,auth);return true;}catch{return false;}
}
export async function GET(request:Request,context:Context){
 try{
  const {id,auth,saved}=await readContext(context),query=new URL(request.url).searchParams;
  if([...query.keys()].some(key=>!['idempotencyKey','jobId'].includes(key))||[...query.keys()].length>1||query.has('idempotencyKey')&&!uuid(query.get('idempotencyKey'))||query.has('jobId')&&!uuid(query.get('jobId')))throw changed();
  const values=query.has('idempotencyKey')?[await findSeoGenerationTranslation(auth.owner,id,query.get('idempotencyKey')!)]:query.has('jobId')?[await getTranslationJob(auth.owner,id,query.get('jobId')!)]:await listTranslationJobs(auth.owner,id);
  const jobs=values.filter((job):job is TranslationJob=>validJob(job,auth.company));
  return json({purpose:'seo-generation',productId:id,company:auth.company,productVersion:saved.product.updated_at,contentRevision:saved.content.revision,optionRevision:saved.options.revision,sourceFingerprint:saved.captured.sourceFingerprint,
   source:saved.captured.source,memo:saved.memo,configuration:seoGenerationSettings(),jobs,...(query.has('idempotencyKey')?{idempotencyKey:query.get('idempotencyKey')}:{}),
   sourceCurrent:jobs.length===1?await sourceCurrent(auth,id,jobs[0]):null});
 }catch(error){return errorReply(error);}
}
export async function POST(request:Request,context:Context){
 let active:{id:string;auth:Awaited<ReturnType<typeof seoGenerationAuthorization>>;job:TranslationJob;claim:string}|null=null;
 try{
  if(request.headers.get('origin')&&request.headers.get('origin')!==new URL(request.url).origin)throw new SeoGenerationError('SEO_GENERATION_ORIGIN','같은 사이트에서 요청해주세요.',403);
  const body=await readBoundedJson(request,16*1024) as Record<string,unknown>;
  if(!body||typeof body!=='object'||Array.isArray(body)||!['prepare','approve','execute','preview','apply'].includes(String(body.action)))throw changed();
  const {id,auth,saved}=await readContext(context),configuration=seoGenerationSettings();
  const reply=async(job:TranslationJob,status=200)=>json({purpose:'seo-generation',productId:id,company:auth.company,productVersion:saved.product.updated_at,sourceCurrent:await sourceCurrent(auth,id,job),job},status);
  if(body.action==='prepare'){
   if(!exact(body,'action,expectedContentRevision,expectedOptionRevision,expectedSourceFingerprint,expectedVersion,idempotencyKey,memo')||!uuid(body.idempotencyKey)||!hash(body.expectedSourceFingerprint))throw changed();
   const memo=validateSeoGenerationMemo(body.memo);
   if(body.expectedVersion!==saved.product.updated_at||body.expectedContentRevision!==saved.content.revision||body.expectedOptionRevision!==saved.options.revision||body.expectedSourceFingerprint!==saved.captured.sourceFingerprint)throw changed();
   if(!configuration.configured)throw new SeoGenerationError('SEO_GENERATION_NOT_CONFIGURED',configuration.issues.join(' '),503);
   const previous=await findSeoGenerationTranslation(auth.owner,id,body.idempotencyKey);
   if(previous){if(!validJob(previous,auth.company)||JSON.stringify(previous.review.seoGeneration?.memo)!==JSON.stringify(memo))throw changed();currentSeoGenerationJob(previous,saved,auth);return reply(previous);}
   const review=await prepareSeoGenerationReview(saved.captured.source,{purpose:'seo-generation',version:1,sourceFingerprint:saved.captured.sourceFingerprint,optionRevision:saved.options.revision,company:auth.company,memo},configuration);
   const job:TranslationJob={id:crypto.randomUUID(),productId:id,productVersion:saved.product.updated_at,contentRevision:saved.content.revision,status:'prepared',review,result:null,error:null,createdAt:new Date().toISOString(),approvedAt:null,startedAt:null,finishedAt:null};
   const requestFingerprint=await fingerprint({purpose:'seo-generation',productId:id,productVersion:job.productVersion,contentRevision:job.contentRevision,source:review.source,proof:review.seoGeneration,model:review.model,maxOutputTokens:review.maxOutputTokens});
   const result=await createSeoGenerationTranslation(auth.owner,job,body.idempotencyKey,requestFingerprint,saved.options.revision,saved.captured.guard);
   if(!result||result.conflict||!validJob(result.job,auth.company)||!await seoGenerationAuthorized(auth))throw changed();return reply(result.job,result.replayed?200:201);
  }
  if(!uuid(body.jobId))throw changed();const job=await getTranslationJob(auth.owner,id,body.jobId);
  if(!validJob(job,auth.company))throw new SeoGenerationError('SEO_GENERATION_NOT_FOUND','이 회사의 SEO 생성 요청을 찾을 수 없습니다.',404);
  await verifySeoGenerationReview(job.review);const source=currentSeoGenerationJob(job,saved,auth);
  if(body.action==='preview'||body.action==='apply'){
   if(!exact(body,body.action==='apply'?'action,expectedVersion,fingerprint,jobId,linkQuotationSeoDefaults':'action,expectedVersion,jobId,linkQuotationSeoDefaults')||body.expectedVersion!==saved.product.updated_at||body.linkQuotationSeoDefaults!==true||body.action==='apply'&&!hash(body.fingerprint)
    ||job.status!=='completed'||!job.result||job.result.model!==job.review.model)throw changed();
   validateSeoGenerationDraft(job.result.draft,job.review);
   const plan=integratedTranslationPlan(saved.content,saved.options,job,saved.product.updated_at,'all',undefined,undefined,true);
   if(plan.reviewedOptions.length||plan.categoryAttributes||job.result.draft.attributes.length)throw changed();
   const digest=await fingerprint({purpose:'seo-generation',product:saved.product,content:saved.content,options:saved.options,job,plan,source,member:auth.member});
   const preview={purpose:'seo-generation',scope:'all',productId:id,productVersion:saved.product.updated_at,contentRevision:saved.content.revision,optionRevision:saved.options.revision,fingerprint:digest,preview:plan.preview,skipped:plan.skipped};
   if(body.action==='preview')return json(preview);
   if(body.fingerprint!==digest)throw changed();if(!plan.preview.length)throw new SeoGenerationError('SEO_GENERATION_NO_CHANGES','새로 적용할 SEO 항목이 없습니다. 직접 수정한 값은 유지했습니다.');
   const now=new Date(Math.max(Date.now(),Date.parse(saved.product.updated_at)+1)).toISOString(),content=applyContentPatch(saved.content,plan.patch??{},now);
   for(const key of ['title','keywords','description'] as const)if(plan.patch?.seo?.[key]!==undefined)content.seo[key].provenance='generated';
   applySeoDocumentTitlePolicy(content,plan.patch?.seo);applyExplicitSeoQuotationDefaults(content,plan.patch?.seo);
   const options={...structuredClone(saved.options),revision:saved.options.revision+1,updatedAt:now};
   if(!await seoGenerationAuthorized(auth)||!await saveIntegratedTranslation(auth.owner,content,options,{productVersion:saved.product.updated_at,imageKeys:saved.product.image_keys,contentRevision:saved.content.revision,optionRevision:saved.options.revision,jobId:job.id,jobProductVersion:job.productVersion,jobContentRevision:job.contentRevision,seoSource:source,member:auth.member}))throw changed();
   return json({purpose:'seo-generation',scope:'all',productId:id,productVersion:now,contentRevision:content.revision,optionRevision:options.revision,applied:plan.preview.length});
  }
  if(!exact(body,body.action==='approve'?'action,confirmPaid,jobId,reviewFingerprint':'action,jobId'))throw changed();
  if(!configuration.configured)throw new SeoGenerationError('SEO_GENERATION_NOT_CONFIGURED',configuration.issues.join(' '),503);
  if(['completed','failed','running','uncertain'].includes(job.status))return reply(job);
  if(body.action==='approve'){
   if(body.confirmPaid!==true||body.reviewFingerprint!==job.review.fingerprint)throw changed();
   const approved=job.status==='approved'?job:await approveTranslationJob(auth.owner,id,job.id,job.review.fingerprint,new Date().toISOString(),saved.options.revision,source);
   if(!approved||!await seoGenerationAuthorized(auth))throw changed();return reply(approved);
  }
  if(job.status!=='approved')throw changed();
  const claim=crypto.randomUUID(),claimed=await claimTranslationJob(auth.owner,id,job.id,job.review.fingerprint,claim,new Date().toISOString(),saved.options.revision,source);
  if(!claimed)throw changed();active={id,auth,job:claimed,claim};
  const result=await executeSeoGeneration(claimed.review,async(model,input)=>{
   if(model!==configuration.model||!seoGenerationSettings().configured||!await sourceCurrent(auth,id,claimed))throw changed();
   if(!await reserveQuotationAiRequest())throw new SeoGenerationError('SEO_GENERATION_LIMIT','오늘의 무료 AI 공유 요청 한도에 도달했습니다. 자동 재시도하지 않았습니다.',429);
   return (env as SeoGenerationSecrets).AI!.run(model,input);
  });
  const completed=await finishTranslationJob(auth.owner,id,job.id,claim,result,null,new Date().toISOString());if(!completed)throw new SeoGenerationError('PROVIDER_OUTCOME_UNCERTAIN','SEO 실행 결과 저장을 확인하지 못했습니다. 같은 작업을 조회해주세요.',503,true);
  active=null;return reply(completed);
 }catch(error){
  if(active){const failure={code:error instanceof SeoGenerationError?error.code:'PROVIDER_OUTCOME_UNCERTAIN',message:error instanceof SeoGenerationError?error.message:'SEO 생성 결과를 확인하지 못했습니다.',mayHaveBeenCharged:false};
   try{await finishTranslationJob(active.auth.owner,active.id,active.job.id,active.claim,null,failure,new Date().toISOString());}catch{/* The durable running row still blocks a second execution. */}}
  return errorReply(error);
 }
}
