import {NextResponse} from 'next/server';
import {getChatGPTUser,getWorkspaceOwnerId} from '@/app/chatgpt-auth';
import {approvedSupplierHubCompany} from '@/app/supplier-hub-company';
import {findProduct} from '@/db/queries';
import {loadSinglePackage} from '@/app/exports/single-package';
import {singlePackagePacket,type SinglePackageView} from '@/app/supplier-hub-single-client';
import {validateSingleReceiptObservation,SingleReceiptError} from '@/app/supplier-hub-single-receipt';
import {readSingleReceiptHistory,saveSingleReceipt} from '@/db/supplier-hub-single-receipts';
import {readBoundedJson,RequestBodyError} from '@/app/request-body';
import {SingleAssetError} from '@/app/supplier-hub-single-assets';
import {SingleProjectionError} from '@/app/supplier-hub-single-projection';
import {QuotationExportError} from '@/app/exports/quotation-source';
import {AttachmentError} from '@/app/exports/attachments';
import {PublicDetailError} from '@/app/quotation-public-detail';

type Context={params:Promise<{id:string}>};
const idPattern=/^[a-zA-Z0-9_-]{1,100}$/;
const json=(body:unknown,status=200)=>NextResponse.json(body,{status,headers:{'cache-control':'no-store','x-content-type-options':'nosniff'}});
async function authorization(){
  const user=await getChatGPTUser();
  if(!user?.verifiedAccess)throw new SingleAssetError('로그인을 확인해주세요.','AUTH_REQUIRED',503);
  const owner=await getWorkspaceOwnerId(),company=approvedSupplierHubCompany(user.membership),member=user.membership;
  if(user.userId!==owner||!member||member.id!==owner||!['admin','member'].includes(member.role)||!company)
    throw new SingleAssetError('승인된 회원 회사의 전송 이력만 확인할 수 있습니다.','SINGLE_ACCOUNT',409);
  return {owner,company,member:{id:member.id,email:member.email,role:member.role,companyCode:member.companyCode,companyName:member.companyName}};
}
function failure(error:unknown){
  if(error instanceof SingleReceiptError||error instanceof SingleAssetError||error instanceof SingleProjectionError)
    return json({error:error.message,code:error.code},error.status);
  if(error instanceof QuotationExportError||error instanceof AttachmentError||error instanceof PublicDetailError||error instanceof RequestBodyError)
    return json({error:error.message},error.status);
  return json({error:'전송 결과 저장 여부를 확인하지 못했습니다. 다시 전송하지 말고 보관된 결과를 조회해주세요.'},503);
}
/** Only stores the authenticated Chrome observation. It never visits a seller,
 * calls Supplier Hub, acknowledges terms, or reports an unobserved SKU. */
export async function GET(request:Request,context:Context){
  if(request.method!=='GET')return new Response(null,{status:405,headers:{allow:'GET'}});
  try{
    const query=new URL(request.url).searchParams,profileId=query.get('profileId'),{id}=await context.params;
    if(!idPattern.test(id)||[...query.keys()].some(key=>key!=='profileId')||query.getAll('profileId').length>1||profileId!==null&&!idPattern.test(profileId))
      return json({error:'상품·카테고리 식별값을 확인해주세요.'},400);
    const {owner,company}=await authorization();
    if(!await findProduct(owner,id))return json({error:'상품을 찾을 수 없습니다.'},404);
    const receipts=await readSingleReceiptHistory(owner,id);
    if(receipts.some(row=>row.company.code!==company.code||row.company.name!==company.name))return json({error:'전송 당시 회사와 현재 승인 회사가 다릅니다.'},409);
    const current=await authorization();
    if(current.owner!==owner||current.company.code!==company.code||current.company.name!==company.name)return json({error:'전송 이력 조회 중 회원 회사가 변경됐습니다.'},409);
    return json({format:'yoofam-single-receipt-history-v1',productId:id,receipts:profileId?receipts.filter(row=>row.profileId===profileId):receipts});
  }catch(error){return failure(error);}
}
export async function POST(request:Request,context:Context){
  if(request.method!=='POST')return new Response(null,{status:405,headers:{allow:'POST'}});
  try{
    const url=new URL(request.url),{id}=await context.params;
    if(!idPattern.test(id)||url.searchParams.size)return json({error:'상품 식별값을 확인해주세요.'},400);
    if(request.headers.get('sec-fetch-site')==='cross-site'||request.headers.has('origin')&&request.headers.get('origin')!==url.origin)
      return json({error:'같은 앱에서 확인 결과를 저장해주세요.'},403);
    const value=await readBoundedJson(request,128*1024);
    if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).length!==3||!['profileId','optionId','observation'].every(key=>Object.hasOwn(value,key)))
      return json({error:'현재 옵션의 확인 결과로 저장해주세요.'},400);
    const body=value as {profileId:unknown;optionId:unknown;observation:unknown};
    if(typeof body.profileId!=='string'||!idPattern.test(body.profileId)||typeof body.optionId!=='string'||!idPattern.test(body.optionId))
      return json({error:'카테고리·옵션 식별값을 확인해주세요.'},400);
    const {owner,company,member}=await authorization();
    const active=async()=>{
      if(request.signal.aborted)throw new SingleAssetError('확인 결과 저장 요청이 취소됐습니다.','SINGLE_ABORTED',409);
      const current=await authorization();
      if(current.owner!==owner||JSON.stringify(current.company)!==JSON.stringify(company)||JSON.stringify(current.member)!==JSON.stringify(member))
        throw new SingleAssetError('확인 결과 저장 중 승인 회원정보가 변경됐습니다.','SINGLE_ACCOUNT_CHANGED',409);
    };
    await active();
    const {view,saved,guard}=await loadSinglePackage(owner,id,body.profileId,company,active);
    if(!view.prepared||!view.review.canPrepare)return json({error:'원래 준비된 이미지·견적 자료가 변경됐습니다. 기존 전송 결과를 다시 전송하지 말고 확인해주세요.'},409);
    if(view.options.filter(row=>row.optionId===body.optionId).length!==1)return json({error:'현재 초안에 포함된 옵션의 결과만 저장할 수 있습니다.'},409);
    const packet=await singlePackagePacket(view as unknown as SinglePackageView,owner,body.optionId);
    const requestId=body.observation&&typeof body.observation==='object'&&!Array.isArray(body.observation)?(body.observation as Record<string,unknown>).requestId:undefined;
    const receipt=await validateSingleReceiptObservation(body.observation,{...packet,requestId:requestId as string},url.origin);
    await guard();
    const stored=await saveSingleReceipt(owner,id,receipt,saved.source,saved.state.revision,member);
    if(!stored)return json({error:'저장한 상품·전송 기록·회사 정보가 변경됐습니다. 다시 전송하지 말고 보관된 결과를 확인해주세요.'},409);
    return json({receipt:stored});
  }catch(error){return failure(error);}
}
