import {env} from 'cloudflare:workers';
import {getChatGPTUser,getWorkspaceOwnerId} from '@/app/chatgpt-auth';
import {approvedSupplierHubCompany} from '@/app/supplier-hub-company';
import {findProduct} from '@/db/queries';
import {readProductContent} from '@/db/product-content';
import {readProductOptions} from '@/db/product-options';
import {readSeoRetrySource,type SeoRetrySourceGuard} from '@/db/translation-jobs';
import {seoGenerationConfiguration,seoGenerationReviewProof,validateSeoGenerationMemo,SeoGenerationError,type SeoGenerationSecrets,type SeoGenerationMemo} from '@/app/seo-generation';
import {savedRegistrationSettings} from '@/app/workspace-settings';
import {validateTranslationSource,type TranslationJob} from '@/app/automation/translation';
import {collectedTranslationAttributes} from '@/app/collected-translation-attributes';

export const seoGenerationSettings=()=>seoGenerationConfiguration(env as SeoGenerationSecrets);
export async function seoGenerationAuthorization(){
 const user=await getChatGPTUser(),owner=await getWorkspaceOwnerId(),company=approvedSupplierHubCompany(user?.membership);
 if(!user?.verifiedAccess||user.userId!==owner||user.membership?.id!==owner||user.membership.status!=='approved'||!['admin','member'].includes(user.membership.role)||!company)
  throw new SeoGenerationError('SEO_GENERATION_AUTH','승인된 회원으로 로그인해주세요.',403);
 return {owner,company,member:{id:owner,email:user.membership.email,role:user.membership.role,companyCode:company.code,companyName:company.name}};
}
export async function seoGenerationAuthorized(auth:Awaited<ReturnType<typeof seoGenerationAuthorization>>){
 const latest=await seoGenerationAuthorization();return JSON.stringify(latest)===JSON.stringify(auth);
}
export async function seoGenerationSource(auth:Awaited<ReturnType<typeof seoGenerationAuthorization>>,id:string){
 const product=await findProduct(auth.owner,id,true);if(!product)throw new SeoGenerationError('SEO_GENERATION_NOT_FOUND','상품을 찾을 수 없습니다.',404);
 const [content,options,original]=await Promise.all([readProductContent(auth.owner,id),readProductOptions(auth.owner,id),readSeoRetrySource(auth.owner,id,product.source_url,auth.company)]);
 const captured={...original,source:validateTranslationSource({...original.source,attributes:collectedTranslationAttributes(JSON.parse(original.guard.resultPayload).attributes??[])})};
 const parsed=JSON.parse(captured.guard.contextPayload),settings=savedRegistrationSettings(parsed.settings);
 const memo:SeoGenerationMemo=validateSeoGenerationMemo({brand:settings.brand,features:captured.source.guidance?.features??'',keywords:captured.source.guidance?.keywords??''});
 const current=await findProduct(auth.owner,id,true),checked=await readSeoRetrySource(auth.owner,id,product.source_url,auth.company);
 if(!current||JSON.stringify(current)!==JSON.stringify(product)||JSON.stringify(captured.guard)!==JSON.stringify(checked.guard)||!await seoGenerationAuthorized(auth))
  throw new SeoGenerationError('SEO_GENERATION_CHANGED','상품·원문·로그인 회사가 변경되었습니다. 현재 저장본을 다시 확인해주세요.');
 return {product,content,options,captured,memo};
}
export function currentSeoGenerationJob(job:TranslationJob,saved:Awaited<ReturnType<typeof seoGenerationSource>>,auth:Awaited<ReturnType<typeof seoGenerationAuthorization>>):SeoRetrySourceGuard{
 const proof=seoGenerationReviewProof(job.review);
 if(!proof||job.productId!==saved.product.id||job.productVersion!==saved.product.updated_at||job.contentRevision!==saved.content.revision||proof.optionRevision!==saved.options.revision
  ||proof.sourceFingerprint!==saved.captured.sourceFingerprint||JSON.stringify(proof.company)!==JSON.stringify(auth.company)||JSON.stringify(job.review.source)!==JSON.stringify(saved.captured.source))
  throw new SeoGenerationError('SEO_GENERATION_CHANGED','SEO 생성 이후 상품·옵션·원문·회사가 변경되었습니다. 기존 이력을 유지하고 현재 저장본을 확인해주세요.');
 return saved.captured.guard;
}
