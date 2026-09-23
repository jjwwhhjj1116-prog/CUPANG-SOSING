import { NextResponse } from 'next/server';
import { getChatGPTUser,getWorkspaceOwnerId } from '@/app/chatgpt-auth';
import { findProduct } from '@/db/queries';
import { findProductCollection } from '@/db/collection-products';
import { readCollectionResult } from '@/db/collection-results';
import { parseCollectionRequest } from '@/app/sourcing';
const reply=(body:unknown,status=200)=>NextResponse.json(body,{status,headers:{'cache-control':'no-store'}});
export async function GET(_:Request,context:{params:Promise<{id:string}>}){
 if(process.env.NODE_ENV==='production'&&!(await getChatGPTUser())?.verifiedAccess)return reply({error:'운영 인증이 필요합니다.'},503);
 try{
  const owner=await getWorkspaceOwnerId();const {id}=await context.params;const product=await findProduct(owner,id);
  if(!product)return reply({error:'상품을 찾을 수 없습니다.'},404);
  const link=await findProductCollection(owner,id);
  if(!link)return reply({error:'이 상품에 연결된 수집 원문이 없습니다. 직접 입력을 사용할 수 있습니다.'},404);
  const receipt=await readCollectionResult(owner,link.job_id);
  if(!receipt)return reply({error:'연결된 수집 원문이 없습니다. 수집 기록을 확인해주세요.'},409);
  const offer=parseCollectionRequest({urls:[product.source_url]})[0];
  if(offer.offerId!==receipt.result.offerId)return reply({error:'상품과 수집 원문의 상품번호가 다릅니다.'},409);
  return reply({title:receipt.result.title,description:receipt.result.description,jobId:link.job_id,sourceUrl:receipt.result.sourceUrl,provider:receipt.result.provider,collectedAt:receipt.result.collectedAt,
   productVersion:product.updated_at,scope:'title-description',message:'상품명·설명 원문입니다. 옵션별 번역과 이미지 번역은 포함하지 않습니다.'});
 }catch{return reply({error:'수집 원문을 읽지 못했습니다. 다시 시도해주세요.'},503);}
}
