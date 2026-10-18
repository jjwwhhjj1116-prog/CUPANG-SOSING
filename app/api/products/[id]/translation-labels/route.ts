import {env} from 'cloudflare:workers';
import {NextResponse} from 'next/server';
import {getChatGPTUser,getWorkspaceOwnerId} from '@/app/chatgpt-auth';
import {approvedSupplierHubCompany} from '@/app/supplier-hub-company';
import {verifyCapturedCollectionCompany} from '@/app/collection-company';
import {findProductCollection} from '@/db/collection-products';
import {findCollectionJob} from '@/db/collection-jobs';
import {readCollectionResult} from '@/db/collection-results';
import {getTranslationJob} from '@/db/translation-jobs';
import {readProductLabels} from '@/db/product-labels';
import {readQuotationExportSource,QuotationExportError} from '@/app/exports/quotation-source';
import {intakeSupplierSourceMatches} from '@/app/intake-supplier-source';
import {applyContentPatch} from '@/app/product-content';
import {fingerprint} from '@/app/automation/model';
import {readBoundedJson,RequestBodyError} from '@/app/request-body';
import {TranslationLabelReuseError,translationLabelReuseView,translationLabelReusePlan} from '@/app/translation-label-reuse';
import {saveTranslationLabelReuse,type TranslationLabelReuseGuard} from '@/db/translation-label-reuse';
type Context={params:Promise<{id:string}>};
const json=(body:unknown,status=200)=>NextResponse.json(body,{status,headers:{'cache-control':'no-store'}});
const changed=()=>new TranslationLabelReuseError('상품·회사·수집 원문·번역 또는 표시사항 저장값이 변경되었습니다. 현재 저장본을 다시 확인해주세요.');
async function auth(){const user=await getChatGPTUser(),owner=await getWorkspaceOwnerId(),company=approvedSupplierHubCompany(user?.membership);if(!user?.verifiedAccess||user.userId!==owner||user.membership?.id!==owner||!company||!['admin','member'].includes(user.membership.role)||typeof user.membership.email!=='string')throw new TranslationLabelReuseError('승인된 회원으로 로그인해주세요.',403);return{owner,company,member:{id:owner,email:user.membership.email,role:user.membership.role,companyCode:company.code,companyName:company.name}};}
function query(request:Request){const params=new URL(request.url).searchParams,jobId=params.get('jobId'),profileId=params.get('profileId');if([...params.keys()].some(key=>!['jobId','profileId'].includes(key)||params.getAll(key).length!==1)||!jobId||!/^[A-Za-z0-9_-]{1,100}$/u.test(jobId)||profileId!==null&&!/^[A-Za-z0-9_-]{1,100}$/u.test(profileId))throw new TranslationLabelReuseError('번역과 카테고리 식별값을 확인해주세요.',400);return{jobId,profileId};}
async function snapshot(identity:Awaited<ReturnType<typeof auth>>,id:string,selection:ReturnType<typeof query>){
 if(!/^[A-Za-z0-9_-]{1,100}$/u.test(id))throw changed();
 const {owner,company}=identity,saved=await readQuotationExportSource(owner,id,selection.profileId),job=await getTranslationJob(owner,id,selection.jobId),link=await findProductCollection(owner,id);
 if(!saved.company||JSON.stringify(saved.company)!==JSON.stringify(company)||!job||!link)throw changed();
 const collection=await findCollectionJob(owner,link.job_id),receipt=await readCollectionResult(owner,link.job_id);if(!collection||collection.product_id!==id||collection.status!=='awaiting_connector'||!receipt||!verifyCapturedCollectionCompany(collection.context,company)||!intakeSupplierSourceMatches(job.review.source,receipt.result,collection))throw changed();
 const labels=await readProductLabels(owner,id),db=env.DB!;
 const raw=async(table:string)=>await db.prepare(`SELECT payload FROM ${table} WHERE product_id=? AND owner_id=?`).bind(id,owner).first<{payload:string}>();
 const [content,options,quotation,labelRow,profile,jobRow]=await Promise.all([raw('product_content'),raw('product_options'),raw('product_quotation_fields'),raw('product_labels'),saved.source.profile?db.prepare('SELECT payload FROM category_profiles WHERE id=? AND owner_id=?').bind(saved.source.profile.id,owner).first<{payload:string}>():null,db.prepare('SELECT review,result,product_version,content_revision FROM translation_jobs WHERE id=? AND product_id=? AND owner_id=?').bind(job.id,id,owner).first<{review:string;result:string;product_version:string;content_revision:number}>()]);
 if(!jobRow?.result)throw changed();
 const guard:TranslationLabelReuseGuard={source:saved.source,member:identity.member,contentPayload:content?.payload??null,optionPayload:options?.payload??null,quotationPayload:quotation?.payload??null,labelsPayload:labelRow?.payload??null,profilePayload:profile?.payload??null,collectionId:collection.id,receiptPayload:JSON.stringify(receipt.result),job:{id:job.id,review:jobRow.review,result:jobRow.result,productVersion:jobRow.product_version,contentRevision:jobRow.content_revision}};
 const inputFingerprint=await fingerprint({saved,labels,guard}),view=translationLabelReuseView({job,content:saved.content,labels,productVersion:saved.product.updated_at,categoryId:saved.categoryContext.categoryId!,categoryPath:saved.categoryContext.categoryPath,inputFingerprint});
 return{view,guard,saved};
}
function failure(error:unknown){if(error instanceof TranslationLabelReuseError||error instanceof RequestBodyError||error instanceof QuotationExportError)return json({error:error.message,...(error instanceof TranslationLabelReuseError?{code:error.code}:{})},error.status);return json({error:'저장된 속성 번역의 표시사항 연결을 확인하지 못했습니다. 기존 값은 유지됩니다.'},503);}
export async function GET(request:Request,context:Context){try{const identity=await auth(),{id}=await context.params;return json((await snapshot(identity,id,query(request))).view);}catch(error){return failure(error);}}
export async function POST(request:Request,context:Context){try{
 if(request.headers.get('origin')&&request.headers.get('origin')!==new URL(request.url).origin)throw new TranslationLabelReuseError('같은 웹페이지에서 표시사항을 저장해주세요.',403);
 const identity=await auth(),{id}=await context.params,selection=query(request),body=await readBoundedJson(request,8192) as Record<string,unknown>;
 if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).length!==4||!['expectedProductVersion','expectedContentRevision','expectedInputFingerprint','mappings'].every(key=>Object.hasOwn(body,key)))throw new TranslationLabelReuseError('표시사항 저장 버전과 선택 항목을 확인해주세요.',400);
 const current=await snapshot(identity,id,selection);if(body.expectedProductVersion!==current.view.productVersion||body.expectedContentRevision!==current.view.contentRevision||body.expectedInputFingerprint!==current.view.inputFingerprint)throw changed();
 const plan=translationLabelReusePlan(current.view,body.mappings),now=new Date(Math.max(Date.now(),Date.parse(current.view.productVersion)+1)).toISOString(),next=applyContentPatch(current.saved.content,{label:plan.label},now);
 if(!await saveTranslationLabelReuse(identity.owner,next,current.guard))throw changed();return json({view:(await snapshot(identity,id,selection)).view,applied:plan.applied});
}catch(error){return failure(error);}}
