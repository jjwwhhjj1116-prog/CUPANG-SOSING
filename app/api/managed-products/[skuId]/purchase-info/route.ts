import {NextResponse} from 'next/server';
import {managedProductAccess} from '@/app/managed-product-access';
import {managedProductAccountContext} from '@/app/managed-products';
import {readBoundedJson,RequestBodyError} from '@/app/request-body';
import {readManagedPurchaseInfo,managedPurchaseInfoSourcesCurrent,saveManagedPurchaseInfo} from '@/db/managed-purchase-info';
import {MANAGED_PURCHASE_INFO_LIMIT,ManagedPurchaseInfoError,validateManagedPurchaseInfo,confirmManagedPurchaseInfoStatuses} from '@/app/managed-purchase-info';
type Context={params:Promise<{skuId:string}>};
const headers={'cache-control':'no-store'},json=(value:unknown,status=200)=>NextResponse.json(value,{status,headers});
const conflict=()=>new ManagedPurchaseInfoError('계정·회사·원본 상품 또는 구매정보가 변경되었습니다. 입력을 유지하고 현재 저장본을 다시 확인해주세요.',409,'MANAGED_PURCHASE_INFO_CONFLICT');
const failure=(error:unknown)=>error instanceof ManagedPurchaseInfoError?json({error:error.message,code:error.code},error.status):error instanceof RequestBodyError?json({error:error.message},error.status):json({error:'현재 회사의 구매정보 저장·조회 결과를 확인하지 못했습니다. 입력을 유지하고 다시 확인해주세요.'},503);
const digest=(value:unknown)=>typeof value==='string'&&/^[a-f0-9]{64}$/u.test(value);
async function accessCurrent(expected:string){const access=await managedProductAccess();if(!access||await managedProductAccountContext(access.ownerId,access.company)!==expected)throw conflict();return access;}
function sku(value:string){if(!/^\d{1,30}$/u.test(value))throw new ManagedPurchaseInfoError('상품 SKU를 확인해주세요.');return value;}
export async function GET(request:Request,context:Context){
 const access=await managedProductAccess();if(!access)return json({error:'로그인 회원의 승인된 회사정보가 필요합니다.'},403);
 try{const expected=new URL(request.url).searchParams.get('expectedAccountContext'),account=await managedProductAccountContext(access.ownerId,access.company);if(expected!==null&&!digest(expected))throw new ManagedPurchaseInfoError('구매정보의 계정 범위를 확인해주세요.');if(expected!==null&&expected!==account)throw conflict();
  const {skuId}=await context.params,snapshot=await readManagedPurchaseInfo(access.ownerId,access.company,sku(skuId));await accessCurrent(account);if(!await managedPurchaseInfoSourcesCurrent(access.ownerId,access.company,snapshot))throw conflict();return json(snapshot.view);
 }catch(error){return failure(error);}
}
export async function PUT(request:Request,context:Context){
 const access=await managedProductAccess();if(!access)return json({error:'로그인 회원의 승인된 회사정보가 필요합니다.'},403);
 try{if(request.headers.get('origin')&&request.headers.get('origin')!==new URL(request.url).origin)throw new ManagedPurchaseInfoError('같은 사이트에서 구매정보를 저장해주세요.');
  const body=await readBoundedJson(request,MANAGED_PURCHASE_INFO_LIMIT+10000) as Record<string,unknown>;if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).length!==4||Object.keys(body).some(key=>!['expectedAccountContext','expectedRevision','expectedInputFingerprint','purchaseInfo'].includes(key))||!digest(body.expectedAccountContext)||!digest(body.expectedInputFingerprint)||!Number.isSafeInteger(body.expectedRevision)||(body.expectedRevision as number)<0)throw new ManagedPurchaseInfoError('구매정보의 저장 버전과 변경 내용을 확인해주세요.');
  const account=await managedProductAccountContext(access.ownerId,access.company);if(account!==body.expectedAccountContext)throw conflict();const {skuId}=await context.params,snapshot=await readManagedPurchaseInfo(access.ownerId,access.company,sku(skuId));
  if(snapshot.view.revision!==body.expectedRevision||snapshot.view.inputFingerprint!==body.expectedInputFingerprint)throw conflict();const rows=validateManagedPurchaseInfo(body.purchaseInfo);confirmManagedPurchaseInfoStatuses(snapshot.view.purchaseInfo,rows);await accessCurrent(account);
  const result=await saveManagedPurchaseInfo(access.ownerId,access.company,snapshot,rows);await accessCurrent(account);const saved=await readManagedPurchaseInfo(access.ownerId,access.company,skuId);
  if(saved.view.sourceVersion!==snapshot.view.sourceVersion||saved.view.revision!==result.revision||saved.view.updatedAt!==result.updatedAt||JSON.stringify(saved.view.purchaseInfo)!==result.payload||!await managedPurchaseInfoSourcesCurrent(access.ownerId,access.company,saved))throw conflict();return json(saved.view);
 }catch(error){return failure(error);}
}
