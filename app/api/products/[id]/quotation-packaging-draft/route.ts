import {env} from 'cloudflare:workers';
import {getChatGPTUser,getWorkspaceOwnerId} from '@/app/chatgpt-auth';
import {approvedSupplierHubCompany} from '@/app/supplier-hub-company';
import {readBoundedJson,RequestBodyError} from '@/app/request-body';
import {stableQuotationFieldsView,QuotationFieldsSnapshotError} from '@/app/quotation-fields-snapshot';
import {readCollectionResult} from '@/db/collection-results';
import {findProduct} from '@/db/queries';
import {readProductContent} from '@/db/product-content';
import {reserveQuotationAiRequest} from '@/db/quotation-ai-jobs';
import {fingerprint} from '@/app/automation/model';
import {parsePackagingDraftRequest,buildQuotationPackagingDraftPlan,completeQuotationPackagingDraft,executeQuotationPackagingDraft,
 packagingDraftConfigured,packagingDraftNeedsAi,PackagingDraftError,type PackagingDraftEnvironment,type PackagingDraftFacts} from '@/app/quotation-packaging-draft';

type Context={params:Promise<{id:string}>};
const reply=(body:unknown,status=200)=>Response.json(body,{status,headers:{'cache-control':'no-store','x-content-type-options':'nosniff'}});
const changed=()=>new PackagingDraftError('PACKAGING_DRAFT_SOURCE_CHANGED','회사·옵션·판매 구성 또는 견적 입력이 바뀌었습니다. 기존 입력을 유지하고 최신 자료에서 다시 확인해주세요.',409);
async function authorization(){
 const owner=await getWorkspaceOwnerId();
 // Keep the fresh membership read last: an owner lookup may outlive a company change.
 const user=await getChatGPTUser(),company=user?.verifiedAccess?approvedSupplierHubCompany(user.membership):null;
 if(!company||!user?.membership||user.userId!==owner||user.membership.id!==owner||!['admin','member'].includes(user.membership.role))throw new PackagingDraftError('PACKAGING_DRAFT_AUTH','승인된 회원 계정으로 로그인해주세요.',403);
 return{owner,company,member:{id:user.membership.id,email:user.membership.email,role:user.membership.role}};
}
async function snapshot(auth:Awaited<ReturnType<typeof authorization>>,id:string,profileId:string|null,scope:{optionId:string|null;applyToAllOptions:boolean}){
 const saved=await stableQuotationFieldsView(auth.owner,id,profileId),captured=saved.source.collection?.snapshot;
 const [product,content,receipt]=await Promise.all([findProduct(auth.owner,id),readProductContent(auth.owner,id),captured?.linked?readCollectionResult(auth.owner,captured.id):Promise.resolve(null)]);
 if(!product||product.updated_at!==saved.view.productVersion||content.revision!==saved.view.contentRevision||!saved.view.categoryContext.categoryId
  ||!saved.view.categoryContext.profileId||receipt&&receipt.result.offerId!==saved.source.collection?.offerId)throw changed();
 const rawFacts:PackagingDraftFacts=receipt?{title:receipt.result.title,description:receipt.result.description,attributes:receipt.result.attributes??[]}
  :{title:product.title,description:content.seo.description.value,attributes:content.categoryAttributes?.values.map(pair=>({name:pair.name,value:pair.value}))??[]};
 const facts:PackagingDraftFacts={title:rawFacts.title.slice(0,500),description:rawFacts.description.slice(0,3500),attributes:rawFacts.attributes.slice(0,20).map(pair=>({name:pair.name.slice(0,100),value:pair.value.slice(0,200)}))};
 const plan=buildQuotationPackagingDraftPlan(saved.view,saved.options,facts,scope);
 return{saved,plan,signature:await fingerprint({auth,source:saved.source,plan,rawFacts})};
}
export async function POST(request:Request,context:Context){
 try{
  if(request.headers.get('origin')&&request.headers.get('origin')!==new URL(request.url).origin||request.headers.get('sec-fetch-site')==='cross-site')return reply({error:'같은 견적 편집 화면에서 실행해주세요.'},403);
  const body=parsePackagingDraftRequest(await readBoundedJson(request,4096)),auth=await authorization(),{id}=await context.params;
  if(!/^[A-Za-z0-9_-]{1,80}$/u.test(id))throw new PackagingDraftError('PACKAGING_DRAFT_INVALID','상품 식별값을 확인해주세요.');
  const scope={optionId:body.optionId,applyToAllOptions:body.applyToAllOptions},initial=await snapshot(auth,id,body.profileId,scope);
  if(initial.saved.view.revision!==body.expectedRevision||initial.saved.view.inputFingerprint!==body.expectedInputFingerprint)throw changed();
  const assertCurrent=async()=>{request.signal.throwIfAborted();if(JSON.stringify(await authorization())!==JSON.stringify(auth))throw changed();
   const latest=await snapshot(auth,id,body.profileId,scope);if(latest.signature!==initial.signature||JSON.stringify(await authorization())!==JSON.stringify(auth))throw changed();request.signal.throwIfAborted();};
  const settings=env as PackagingDraftEnvironment;let result;
  if(!packagingDraftNeedsAi(initial.plan))result=completeQuotationPackagingDraft(initial.plan);
  else if(!packagingDraftConfigured(settings))result=completeQuotationPackagingDraft(initial.plan,null,0,'무료 AI 연결을 확인하지 못해 포장 추정값을 작성하지 않았습니다. 기존 입력을 유지했습니다.');
  else{
   await assertCurrent();
   if(!await reserveQuotationAiRequest())result=completeQuotationPackagingDraft(initial.plan,null,0,'오늘의 무료 AI 공유 한도에 도달해 포장 추정값을 작성하지 않았습니다. 기존 입력을 유지하고 추가 호출하지 않았습니다.');
   else{
    await assertCurrent();
    try{result=await executeQuotationPackagingDraft(initial.plan,settings.AI!,request.signal);}
    catch(error){request.signal.throwIfAborted();result=completeQuotationPackagingDraft(initial.plan,null,1,error instanceof PackagingDraftError?error.message:'AI 응답을 확인하지 못해 포장 추정값을 작성하지 않았습니다. 기존 입력을 유지하고 추가 호출하지 않았습니다.');}
   }
  }
  await assertCurrent();return reply(result);
 }catch(error){if(error instanceof PackagingDraftError)return reply({error:error.message,code:error.code},error.status);
  if(error instanceof RequestBodyError||error instanceof QuotationFieldsSnapshotError)return reply({error:error.message},error.status);
  return reply({error:'포장 초안을 확인하지 못했습니다. 원문과 기존 입력은 유지됩니다. 자동 재요청하지 않았습니다.'},503);}
}
