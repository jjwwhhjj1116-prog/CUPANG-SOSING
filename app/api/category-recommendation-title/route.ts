import {getChatGPTUser,getWorkspaceOwnerId} from '@/app/chatgpt-auth';
import {approvedSupplierHubCompany} from '@/app/supplier-hub-company';
import {readBoundedJson,RequestBodyError} from '@/app/request-body';
import {translateGoogleFree} from '@/app/automation/google-free-translation';
const reply=(body:unknown,status=200)=>Response.json(body,{status,headers:{'cache-control':'no-store'}});
export async function POST(request:Request){
 try{
  const user=await getChatGPTUser(),company=user?.verifiedAccess?approvedSupplierHubCompany(user.membership):null;
  if(!company)return reply({error:'승인된 회사 계정으로 로그인해주세요.'},401);
  const ownerId=await getWorkspaceOwnerId(),body=await readBoundedJson(request,4096) as {expectedOwnerId?:unknown;productName?:unknown};
  if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).some(key=>!['expectedOwnerId','productName'].includes(key))||typeof body.productName!=='string'||!body.productName.trim()||body.productName.length>500||/[\u0000-\u001f\u007f]/.test(body.productName))return reply({error:'추천할 상품명은 500자 이하로 입력해주세요.'},400);
  if(body.expectedOwnerId!==ownerId)return reply({error:'로그인 회원이 변경되었습니다.'},409);
  const productName=body.productName.trim();let queryProductName=productName;
  if(/\p{Script=Han}/u.test(productName)){
   const translated=await translateGoogleFree(productName,{targetLanguage:'ko',maxCharacters:500,timeoutSeconds:10,signal:request.signal});
   if(!translated||!translated.translatedText.trim()||translated.translatedText.length>500||/[\u0000-\u001f\u007f]/.test(translated.translatedText))return reply({error:'카테고리 추천용 상품명 번역을 완료하지 못했습니다. 한국어 상품명으로 입력해주세요.'},502);
   queryProductName=translated.translatedText.trim();
  }
  request.signal.throwIfAborted();
  const current=await getChatGPTUser(),latest=current?.verifiedAccess?approvedSupplierHubCompany(current.membership):null;
  if(await getWorkspaceOwnerId()!==ownerId||latest?.code!==company.code||latest?.name!==company.name)return reply({error:'상품명을 확인하는 동안 로그인 회사가 변경되었습니다.'},409);
  return reply({ownerId,company,productName,queryProductName});
 }catch(error){return reply({error:error instanceof RequestBodyError?error.message:'추천용 상품명을 확인하지 못했습니다.'},error instanceof RequestBodyError?error.status:503);}
}
