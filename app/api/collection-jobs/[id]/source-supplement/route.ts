import { NextResponse } from 'next/server';
import { getChatGPTUser, getWorkspaceOwnerId } from '@/app/chatgpt-auth';
import { findCollectionJob } from '@/db/collection-jobs';
import { readCollectionResult } from '@/db/collection-results';
import { findCollectionProduct } from '@/db/collection-products';
import { findProduct } from '@/db/queries';
import { storeCollectionSupplement } from '@/db/collection-source-supplements';
import { parseBrowserProductCapture } from '@/app/browser-product-capture';
import { canSupplementCollection, supplementCollectionSource } from '@/app/collection-source-supplement';
import { readBoundedJson, RequestBodyError } from '@/app/request-body';
import {parseOwnedPageCapture} from '@/app/owned-page-capture';
import {readSourceInbox} from '@/db/source-inbox';
import {approvedSupplierHubCompany} from '@/app/supplier-hub-company';
import {verifyCapturedCollectionCompany} from '@/app/collection-company';
const reply=(body:unknown,status=200)=>NextResponse.json(body,{status,headers:{'cache-control':'no-store'}});
export async function POST(request:Request,context:{params:Promise<{id:string}>}) {
 try {
  if(process.env.NODE_ENV==='production'&&!(await getChatGPTUser())?.verifiedAccess)return reply({error:'운영 인증 연결이 필요합니다.'},503);
  if(request.headers.get('origin')&&request.headers.get('origin')!==new URL(request.url).origin)return reply({error:'같은 사이트에서 요청해주세요.'},400);
  const owner=await getWorkspaceOwnerId(),{id}=await context.params,job=await findCollectionJob(owner,id);
  if(!job)return reply({error:'수집 요청을 찾을 수 없습니다.'},404);
  if(job.status==='cancelled')return reply({error:'취소된 수집 요청입니다.'},409);
  const existing=await readCollectionResult(owner,id);
  if(!existing)return reply({error:'보완할 기존 원문이 없습니다.'},409);
  // A lost acknowledgement reuses the same append-only supplement.
  if(existing.result.provider==='chrome-public-mobile-supplement-v1')return reply({jobId:id,offerId:job.offer_id,receipt:existing});
  if(!canSupplementCollection(existing.result))return reply({error:'상세 원문을 이미 받은 상품입니다. 기존 원문은 유지됩니다.'},409);
  const body=await readBoundedJson(request,8*1024*1024) as {capture?:unknown;expectedProductVersion?:unknown};
  if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).some(key=>!['capture','expectedProductVersion'].includes(key)))return reply({error:'보완 요청을 확인해주세요.'},400);
  const link=await findCollectionProduct(owner,id),product=link?await findProduct(owner,link.product_id):null;
  if(link&&(!product||product.source_url!==job.source_url||product.updated_at!==body.expectedProductVersion)
    ||!link&&body.expectedProductVersion!==undefined)return reply({error:'상품이 변경되었습니다. 최신 상품을 다시 열어주세요.'},409);
  let captured,merged;
  try{
   const owned=(body.capture as {format?:unknown})?.format==='yoofam-saved-page-capture-v1';
   if(owned){
    captured=await parseOwnedPageCapture(owner,body.capture,job.source_url);
    const pointer=body.capture as {captureId:string;fingerprint:string;revision:number},item=await readSourceInbox(owner,pointer.captureId);
    const user=await getChatGPTUser(),company=user?.verifiedAccess&&user.userId===owner?approvedSupplierHubCompany(user.membership):null;
    const currentJob=await findCollectionJob(owner,id),recorded=currentJob&&verifyCapturedCollectionCompany(currentJob.context,company);
    if(!recorded||JSON.stringify(currentJob?.context)!==JSON.stringify(job.context)||!item||item.archivedAt||item.ownerId!==owner||item.company.code!==recorded.code||item.company.name!==recorded.name
      ||item.fingerprint!==pointer.fingerprint||item.revision!==pointer.revision||item.snapshot.sourceUrl!==job.source_url)throw Error('수집본과 상품의 원래 회원·회사·버전이 일치하지 않습니다.');
   }else captured=parseBrowserProductCapture(body.capture,job.source_url);
   merged=supplementCollectionSource(existing.result,captured,owned?'owned-page':'legacy-mobile');
  }
  catch(error){return reply({error:error instanceof Error?error.message:'상세 원문을 확인하지 못했습니다.'},422);}
  if(request.signal.aborted)return reply({error:'취소된 보완 요청입니다. 저장 상태를 다시 확인해주세요.'},409);
  const receipt=await storeCollectionSupplement(owner,id,existing.result,captured,merged,product);
  if(!receipt)return reply({error:'원문이나 상품이 변경되었습니다. 저장된 입력은 유지됩니다.'},409);
  return reply({jobId:id,offerId:job.offer_id,receipt});
 }catch(error){return reply({error:error instanceof RequestBodyError?error.message:'상세 원문 보완 상태를 확인하지 못했습니다. 다시 조회해주세요.'},error instanceof RequestBodyError?error.status:503);}
}
