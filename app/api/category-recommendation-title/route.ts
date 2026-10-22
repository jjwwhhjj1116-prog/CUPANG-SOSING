import {getChatGPTUser,getWorkspaceOwnerId} from '@/app/chatgpt-auth';
import {approvedSupplierHubCompany} from '@/app/supplier-hub-company';
import {readBoundedJson,RequestBodyError} from '@/app/request-body';
import {translateGoogleFree,type GoogleFreeTranslationFailure} from '@/app/automation/google-free-translation';
import type {CategoryTitleAiEnvironment} from '@/app/category-title-workers-recovery';
const reply=(body:unknown,status=200)=>Response.json(body,{status,headers:{'cache-control':'no-store'}});
export async function POST(request:Request){
 try{
  const user=await getChatGPTUser(),company=user?.verifiedAccess?approvedSupplierHubCompany(user.membership):null;
  if(!company)return reply({error:'승인된 회사 계정으로 로그인해주세요.'},401);
  const ownerId=await getWorkspaceOwnerId(),body=await readBoundedJson(request,4096) as {expectedOwnerId?:unknown;productName?:unknown};
  if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).some(key=>!['expectedOwnerId','productName'].includes(key))||typeof body.productName!=='string'||!body.productName.trim()||body.productName.length>500||/[\u0000-\u001f\u007f]/.test(body.productName))return reply({error:'추천할 상품명은 500자 이하로 입력해주세요.'},400);
  if(body.expectedOwnerId!==ownerId)return reply({error:'로그인 회원이 변경되었습니다.'},409);
  const scopeCurrent=async()=>{
   request.signal.throwIfAborted();
   const current=await getChatGPTUser(),latest=current?.verifiedAccess?approvedSupplierHubCompany(current.membership):null;
   return await getWorkspaceOwnerId()===ownerId&&latest?.code===company.code&&latest?.name===company.name;
  };
  const changed=()=>reply({error:'상품명을 확인하는 동안 로그인 회사가 변경되었습니다.'},409);
  const productName=body.productName.trim();let queryProductName=productName;
  let translationProvider:'workers-ai'|undefined;
  if(/\p{Script=Han}/u.test(productName)){
   let certainGoogle429=false;
   const translated=await translateGoogleFree(productName,{targetLanguage:'ko',maxCharacters:500,timeoutSeconds:10,signal:request.signal,
    onFailure:(failure:GoogleFreeTranslationFailure)=>{certainGoogle429=failure.reason==='http'&&failure.status===429;}});
   if(!translated&&certainGoogle429){
    if(!await scopeCurrent())return changed();
    const [{env},{reserveQuotationAiRequest},recovery]=await Promise.all([
     import('cloudflare:workers'),import('@/db/quotation-ai-jobs'),import('@/app/category-title-workers-recovery'),
    ]);
    if(!recovery.categoryTitleRecoveryConfigured(env as CategoryTitleAiEnvironment))return reply({error:'무료 상품명 번역 설정을 확인해주세요. 원문은 유지됩니다.',code:'CATEGORY_TITLE_RECOVERY_NOT_CONFIGURED'},503);
    if(!await scopeCurrent())return changed();
    if(!await reserveQuotationAiRequest())return reply({error:'오늘의 무료 AI 공유 요청 한도에 도달했습니다. 원문은 유지됩니다.',code:'CATEGORY_TITLE_RECOVERY_LIMIT'},429);
    if(!await scopeCurrent())return changed();
    try{queryProductName=await recovery.recoverCategoryTitle(productName,env as CategoryTitleAiEnvironment,request.signal);translationProvider='workers-ai';}
    catch(error){if(!await scopeCurrent())return changed();if(error instanceof recovery.CategoryTitleRecoveryError)return reply({error:error.message,code:error.code},error.status);throw error;}
   }else{
    if(!translated||!translated.translatedText.trim()||translated.translatedText.length>500||/[\u0000-\u001f\u007f]/.test(translated.translatedText))return reply({error:'카테고리 추천용 상품명 번역을 완료하지 못했습니다. 한국어 상품명으로 입력해주세요.'},502);
    queryProductName=translated.translatedText.trim();
   }
  }
  if(!await scopeCurrent())return changed();
  return reply({ownerId,company,productName,queryProductName,...(translationProvider?{translationProvider,caution:'Google 번역 요청 제한으로 무료 AI가 상품명만 한국어로 번역했습니다. 추천 카테고리를 확인해주세요.'}:{})});
 }catch(error){return reply({error:error instanceof RequestBodyError?error.message:'추천용 상품명을 확인하지 못했습니다.'},error instanceof RequestBodyError?error.status:503);}
}
