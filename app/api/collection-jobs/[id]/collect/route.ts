import { NextResponse } from 'next/server';
import { getChatGPTUser, getWorkspaceOwnerId } from '@/app/chatgpt-auth';
import { findCollectionJob } from '@/db/collection-jobs';
import { readCollectionResult, storeCollectionResult } from '@/db/collection-results';
import { collectPublicProduct } from '@/app/public-product-collector';
const reply=(body:unknown,status=200)=>NextResponse.json(body,{status,headers:{'cache-control':'no-store'}});
export async function POST(request:Request,context:{params:Promise<{id:string}>}) {
 try {
  if(process.env.NODE_ENV==='production'&&!(await getChatGPTUser())?.verifiedAccess)return reply({error:'운영 인증 연결이 필요합니다.'},503);
  const owner=await getWorkspaceOwnerId();const {id}=await context.params;
  const job=await findCollectionJob(owner,id);if(!job)return reply({error:'수집 요청을 찾을 수 없습니다.'},404);
  if(job.status==='cancelled')return reply({error:'취소된 수집 요청입니다.'},409);
  const existing=await readCollectionResult(owner,id);
  if(existing)return reply({jobId:id,offerId:job.offer_id,receipt:existing});
  let result;try{result=await collectPublicProduct(job.source_url,{signal:request.signal});}
  catch(cause){return reply({error:cause instanceof Error?cause.message:'상품 페이지를 읽지 못했습니다.',code:'SOURCE_NOT_COLLECTED'},422);}
  if(result.offerId!==job.offer_id)return reply({error:'요청 상품번호가 일치하지 않습니다.'},409);
  const saved=await storeCollectionResult(owner,id,result);
  if(saved.status!=='stored')return reply({error:'원문이 변경되었거나 요청이 취소되었습니다. 기존 내용은 유지됩니다.'},409);
  return reply({jobId:id,offerId:job.offer_id,receipt:{result:saved.result,receivedAt:saved.receivedAt}});
 }catch{return reply({error:'수집 결과 저장 여부를 확인하지 못했습니다. 다시 시도해주세요.'},503);}
}
