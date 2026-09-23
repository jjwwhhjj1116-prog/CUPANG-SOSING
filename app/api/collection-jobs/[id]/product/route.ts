import { NextResponse } from 'next/server';
import { getChatGPTUser,getWorkspaceOwnerId } from '@/app/chatgpt-auth';
import { findCollectionJob } from '@/db/collection-jobs';
import { readCollectionResult } from '@/db/collection-results';
import { findCollectionProduct,promoteCollection } from '@/db/collection-products';
import { prepareCollectionProduct } from '@/app/collection-product';
const reply=(body:unknown,status=200)=>NextResponse.json(body,{status,headers:{'cache-control':'no-store'}});
export async function POST(_:Request,context:{params:Promise<{id:string}>}){
 try{
 if(process.env.NODE_ENV==='production'&&!(await getChatGPTUser())?.verifiedAccess)return reply({error:'운영 인증 연결이 필요합니다.'},503);
 const owner=await getWorkspaceOwnerId();const {id}=await context.params;const job=await findCollectionJob(owner,id);
 if(!job)return reply({error:'수집 요청을 찾을 수 없습니다.'},404);
 const previous=await findCollectionProduct(owner,id);if(previous)return reply({productId:previous.product_id,reused:true,executionStarted:false});
 if(job.status==='cancelled')return reply({error:'취소된 수집 요청입니다.'},409);
 const receipt=await readCollectionResult(owner,id);if(!receipt)return reply({error:'수집 결과가 아직 없습니다.'},409);
 try{prepareCollectionProduct(owner,job,receipt.result,'validation',new Date().toISOString());}catch(cause){return reply({error:cause instanceof Error?cause.message:'원문을 확인해주세요.'},400);}
 const product=await promoteCollection(owner,job,receipt.result);
 return reply({productId:product.product_id,executionStarted:false,message:'상품·옵션·가격 원문 반영 완료. 번역·이미지 다운로드·등록 전송은 실행되지 않았습니다.'});
 }catch{return reply({error:'상품 반영 결과를 확인하지 못했습니다. 다시 시도해도 같은 요청의 상품은 중복 생성되지 않습니다.'},503);}
}
