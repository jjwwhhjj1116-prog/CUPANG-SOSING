import {NextResponse} from 'next/server';
import {getChatGPTUser,getWorkspaceOwnerId} from '@/app/chatgpt-auth';
import {approvedSupplierHubCompany} from '@/app/supplier-hub-company';
import {loadSinglePackage} from '@/app/exports/single-package';
import {imageFileType,MAX_IMAGE_BYTES} from '@/app/image-files';
import {SingleAssetError} from '@/app/supplier-hub-single-assets';
import {SingleProjectionError} from '@/app/supplier-hub-single-projection';
import {QuotationExportError} from '@/app/exports/quotation-source';
import {AttachmentError} from '@/app/exports/attachments';
type Context={params:Promise<{id:string}>};
const reply=(value:unknown,status=200)=>NextResponse.json(value,{status,headers:{'cache-control':'private, no-store','x-content-type-options':'nosniff'}});
const changed=():never=>{throw new SingleAssetError('원본을 확인하는 동안 회원 회사·상품·견적서·파일이 변경됐습니다. 최신 자료를 다시 확인해주세요.','NATIVE_ASSET_SOURCE_CHANGED');};

/** Authenticated source-plan and exact current private bytes only. No target
 * document, public image, native upload, agreement or receipt is created here. */
export async function GET(request:Request,context:Context){
 try{
  const url=new URL(request.url),params=url.searchParams,profileId=params.get('profileId'),key=params.get('key'),expected=params.get('sourcePlanSha256');
  if([...params.keys()].some(name=>!['profileId','key','sourcePlanSha256'].includes(name))||['profileId','key','sourcePlanSha256'].some(name=>params.getAll(name).length>1)
   ||profileId!==null&&!/^\w[\w-]{0,99}$/.test(profileId)||((key===null)!==(expected===null))||expected!==null&&!/^[a-f0-9]{64}$/.test(expected))return reply({error:'현재 원본 파일 계획·프로필 식별값으로 요청해주세요.',code:'NATIVE_ASSET_REQUEST'},400);
  const user=await getChatGPTUser();if(!user?.verifiedAccess)return reply({error:'로그인 후 현재 상품 원본을 확인해주세요.',code:'AUTH_REQUIRED'},503);
  const owner=await getWorkspaceOwnerId(),company=approvedSupplierHubCompany(user.membership),member={id:user.membership?.id,email:user.membership?.email,role:user.membership?.role},{id}=await context.params;
  if(!/^\w[\w-]{0,99}$/.test(id))return reply({error:'상품 식별값을 확인해주세요.',code:'NATIVE_ASSET_PRODUCT'},400);
  if(user.userId!==owner||member.id!==owner||!['admin','member'].includes(member.role??'')||!company)return reply({error:'승인된 현재 회원 회사의 상품만 확인할 수 있습니다.',code:'NATIVE_ASSET_ACCOUNT'},409);
  const active=async()=>{
   if(request.signal.aborted)throw new SingleAssetError('원본 파일 조회를 취소했습니다.','NATIVE_ASSET_ABORTED');
   const current=await getChatGPTUser(),next=approvedSupplierHubCompany(current?.membership);
   if(!current?.verifiedAccess||current.userId!==owner||current.membership?.id!==member.id||current.membership?.email!==member.email||current.membership?.role!==member.role||!next||next.code!==company.code||next.name!==company.name)changed();
  };
  await active();
  const loaded=await loadSinglePackage(owner,id,profileId,company,active,false,undefined,true),plan=loaded.view.nativeAssetSourcePlan;
  if(!plan||plan.format!=='yoofam-native-asset-source-plan-v1'||plan.registered!==false||plan.remoteWrites!==false||plan.submissionReady!==false||plan.transportReady!==false)throw new SingleAssetError('현재 네이티브 원본 파일 계획을 확인하지 못했습니다.','NATIVE_ASSET_PLAN',503);
  if(key===null){await loaded.nativeAssetSourceGuard();await active();return reply(plan);}
  if(!plan.metadataValid||!plan.sourcePlanSha256||plan.sourcePlanSha256!==expected||!plan.identity||plan.identity.ownerId!==owner||plan.identity.productId!==id||plan.identity.company.code!==company.code||plan.identity.company.name!==company.name)
   return reply({error:'검토한 원본 계획이 현재 상품·회사·저장값과 다릅니다.',code:'NATIVE_ASSET_PLAN_CHANGED'},409);
  const files=plan.images.filter(file=>file.key===key),asset=loaded.nativeAssetSourceAssets.find(file=>file.key===key);
  if(!files.length||!asset||files.some(file=>file.sha256!==files[0].sha256||file.byteLength!==files[0].byteLength||file.contentType!==files[0].contentType))return reply({error:'현재 상품의 원본 계획에 포함된 파일만 조회할 수 있습니다.',code:'NATIVE_ASSET_KEY'},404);
  await loaded.nativeAssetSourceGuard();await active();
  const file=files[0],bytes=new Uint8Array(asset.data);
  if(!bytes.length||bytes.length>MAX_IMAGE_BYTES||bytes.length!==file.byteLength)changed();
  try{if(imageFileType(bytes).contentType!==file.contentType)changed();}catch{changed();}
  const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),byte=>byte.toString(16).padStart(2,'0')).join('');if(hash!==file.sha256)changed();
  await loaded.nativeAssetSourceGuard();await active();
  const encodedName=encodeURIComponent(file.originalName).replace(/[!'()*]/g,character=>'%'+character.charCodeAt(0).toString(16).toUpperCase());
  return new Response(bytes.buffer,{headers:{'content-type':file.contentType,'content-length':String(bytes.length),'content-disposition':`attachment; filename="yoofam-native-original.${file.contentType==='image/png'?'png':'jpg'}"; filename*=UTF-8''${encodedName}`,
   'cache-control':'private, no-store','x-content-type-options':'nosniff','content-security-policy':"default-src 'none'; sandbox",'x-yoofam-source-plan-sha256':plan.sourcePlanSha256,'x-yoofam-file-sha256':hash}});
 }catch(error){
  if(error instanceof SingleAssetError||error instanceof SingleProjectionError)return reply({error:error.message,code:error.code},error.status);
  if(error instanceof QuotationExportError||error instanceof AttachmentError)return reply({error:error.message},error.status);
  return reply({error:'현재 저장된 원본 파일·상품 연결을 확인하지 못했습니다.',code:'NATIVE_ASSET_SOURCE_UNAVAILABLE'},503);
 }
}
