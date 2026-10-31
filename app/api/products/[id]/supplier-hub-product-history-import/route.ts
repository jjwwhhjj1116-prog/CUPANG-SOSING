import {NextResponse} from 'next/server';
import {getChatGPTUser,getWorkspaceOwnerId} from '@/app/chatgpt-auth';
import {approvedSupplierHubCompany} from '@/app/supplier-hub-company';
import {loadSinglePackage} from '@/app/exports/single-package';
import {historicalProductReceiptImport} from '@/app/historical-product-receipt-import';
import {saveProductReceipt} from '@/db/supplier-hub-single-receipts';
import {readBoundedJson,RequestBodyError} from '@/app/request-body';
import {SingleReceiptError} from '@/app/supplier-hub-single-receipt';
import {SingleAssetError} from '@/app/supplier-hub-single-assets';
import {QuotationExportError} from '@/app/exports/quotation-source';

const reply=(value:unknown,status=200)=>NextResponse.json(value,{status,headers:{'cache-control':'no-store','x-content-type-options':'nosniff'}});
async function scope(){
 const user=await getChatGPTUser(),owner=await getWorkspaceOwnerId(),member=user?.membership,company=approvedSupplierHubCompany(member);
 if(!user?.verifiedAccess||user.userId!==owner||!member||member.id!==owner||!['admin','member'].includes(member.role)||!company)
  throw new SingleReceiptError('승인된 회원·회사의 원래 접수 결과만 연결할 수 있습니다.',409,'HISTORICAL_RECEIPT_ACCOUNT');
 return{owner,company,member:{id:member.id,email:member.email,role:member.role,companyCode:member.companyCode,companyName:member.companyName}};
}
/** The only write is an idempotent local receipt row. This route has no Hub
 * fetch, draft creation, file upload, agreement, body update or submit port. */
export async function POST(request:Request,context:{params:Promise<{id:string}>}){
 try{
  const url=new URL(request.url),{id}=await context.params;
  if(!/^\w[\w-]{0,99}$/.test(id)||url.search)return reply({error:'원래 상품 식별값으로 요청해주세요.'},400);
  if(request.headers.get('origin')!==url.origin||request.headers.get('sec-fetch-site')==='cross-site')return reply({error:'같은 앱의 접수 확인 화면에서 요청해주세요.'},403);
  const input=await readBoundedJson(request,256*1024);
  if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).length!==2||!Object.hasOwn(input,'action')||!Object.hasOwn(input,'candidate')||(input as {action:unknown}).action!=='import-history')return reply({error:'원래 요청의 접수 조회 결과가 필요합니다.'},400);
  const candidate=(input as {candidate:unknown}).candidate;
  const raw=candidate&&typeof candidate==='object'&&!Array.isArray(candidate)?candidate as Record<string,unknown>:null;
  const anchor=raw?.anchor&&typeof raw.anchor==='object'&&!Array.isArray(raw.anchor)?raw.anchor as Record<string,unknown>:null;
  const identity=anchor?.identity&&typeof anchor.identity==='object'&&!Array.isArray(anchor.identity)?anchor.identity as Record<string,unknown>:null;
  const profileId=identity?.requestedProfileId;
  if(profileId!==null&&(typeof profileId!=='string'||!/^\w[\w-]{0,99}$/.test(profileId)))return reply({error:'원래 카테고리 요청 범위를 확인해주세요.'},400);
  const original=await scope(),active=async()=>{
   if(request.signal.aborted||JSON.stringify(await scope())!==JSON.stringify(original))throw new SingleReceiptError('접수 연결 중 회원·회사가 변경되었습니다.',409,'HISTORICAL_RECEIPT_CHANGED');
  };
  await active();
  const loaded=await loadSinglePackage(original.owner,id,profileId,original.company,active,false,undefined,true,{nativeReadOnly:true});
  const plan=loaded.view.nativeAssetSourcePlan;
  if(!plan)return reply({error:'원래 상품과 견적서 연결을 확인하지 못했습니다.'},409);
  const observation=await historicalProductReceiptImport(candidate,{origin:url.origin,ownerId:original.owner,productId:id,company:original.company,plan});
  await loaded.nativeAssetSourceGuard();await active();
  const receipt=await saveProductReceipt(original.owner,id,observation,loaded.saved.source,loaded.saved.state.revision,original.member);
  await active();
  if(!receipt)return reply({error:'상품·회원 또는 보관된 접수 기록이 변경됐습니다. 재전송 없이 결과를 다시 조회해주세요.'},409);
  return reply({format:'yoofam-historical-product-receipt-import-v1',receipt,remoteWrites:false,canResume:false});
 }catch(error){
  if(error instanceof SingleReceiptError||error instanceof SingleAssetError)return reply({error:error.message,code:error.code},error.status);
  if(error instanceof RequestBodyError||error instanceof QuotationExportError)return reply({error:error.message},error.status);
  if(error&&typeof error==='object'&&'code'in error&&typeof error.code==='string'&&/^HISTORICAL_RECEIPT_[A-Z_]+$/.test(error.code))return reply({error:'원래 요청·문서·접수 응답을 확인하지 못했습니다. 다시 전송하지 않았습니다.',code:error.code},409);
  return reply({error:'과거 접수 연결 결과를 확인하지 못했습니다. 새 문서를 만들거나 다시 전송하지 않았습니다.'},503);
 }
}
