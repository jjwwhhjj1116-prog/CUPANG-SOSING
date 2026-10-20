import { NextResponse } from 'next/server';
import { env } from 'cloudflare:workers';
import { getChatGPTUser, getWorkspaceOwnerId } from '@/app/chatgpt-auth';
import { findCollectionJob } from '@/db/collection-jobs';
import { readCollectionResult, storeCollectionResult } from '@/db/collection-results';
import { collectPublicProduct } from '@/app/public-product-collector';
import { collectionProvider } from '@/app/collection-provider';
import { readBoundedJson, RequestBodyError } from '@/app/request-body';
import { parseBrowserProductCapture } from '@/app/browser-product-capture';
import { selectedPageReceiptMatches } from '@/app/selected-page-receipt';
const reply=(body:unknown,status=200)=>NextResponse.json(body,{status,headers:{'cache-control':'no-store'}});
export async function POST(request:Request,context:{params:Promise<{id:string}>}) {
 try {
  if(process.env.NODE_ENV==='production'&&!(await getChatGPTUser())?.verifiedAccess)return reply({error:'운영 인증 연결이 필요합니다.'},503);
  const owner=await getWorkspaceOwnerId();const {id}=await context.params;
  const job=await findCollectionJob(owner,id);if(!job)return reply({error:'수집 요청을 찾을 수 없습니다.'},404);
  if(job.status==='cancelled')return reply({error:'취소된 수집 요청입니다.'},409);
  const existing=await readCollectionResult(owner,id);
  let browserCapture:unknown;
  if(request.body){
   try{
    const input=await readBoundedJson(request,8*1024*1024);
    if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).length!==1||!Object.hasOwn(input,'browserCapture'))throw new RequestBodyError(400,'상품 수집 요청 형식을 확인해주세요.');
    browserCapture=(input as {browserCapture:unknown}).browserCapture;
    if(!browserCapture||typeof browserCapture!=='object'||Array.isArray(browserCapture))throw new RequestBodyError(400,'상품 수집 원문 형식을 확인해주세요.');
   }catch(error){return reply({error:error instanceof RequestBodyError?error.message:'수집 원문을 읽지 못했습니다.'},error instanceof RequestBodyError?error.status:400);}
  }
  if(request.signal.aborted)return reply({error:'취소된 수집 작업입니다.'},409);
  let captured;
  const savedPage=(browserCapture as {format?:unknown})?.format==='yoofam-saved-page-capture-v1';
  if(savedPage){
   try{captured=await (await import('@/app/owned-page-capture')).parseOwnedPageCapture(owner,browserCapture,job.source_url);}
   catch(error){return reply({error:error instanceof Error?error.message:'수집함 원문을 확인해주세요.',code:'SOURCE_CANDIDATE_INVALID'},422);}
  }
  if(existing){
   if(savedPage&&!selectedPageReceiptMatches(existing.result,captured,job.offer_id))return reply({error:'이 요청에는 다른 수집본이 이미 보관되어 있습니다. 기존 작업은 유지했습니다. 선택한 수집본과 기존 요청을 다시 확인해주세요.',code:'SOURCE_SELECTION_CONFLICT'},409);
   return reply({jobId:id,offerId:job.offer_id,receipt:existing});
  }
  let provider;
  try{provider=savedPage?{kind:'public-page' as const}:collectionProvider(env as unknown as Record<string,unknown>);}
  catch{return reply({error:'1688 상품조회 API의 서버 설정을 확인해야 합니다.',code:'SOURCE_CONFIGURATION_REQUIRED'},503);}
  if(provider.kind==='public-page'&&browserCapture!==undefined&&!savedPage){
   try{captured=parseBrowserProductCapture(browserCapture,job.source_url);}
   catch(error){return reply({error:error instanceof Error?error.message:'상품 원문을 확인하지 못했습니다.',code:'SOURCE_CANDIDATE_INVALID'},422);}
  }
  let result;try{
   if(provider.kind==='alibaba-api'){
    const {collectAlibabaProduct}=await import('@/app/alibaba-product-collector');
    result=await collectAlibabaProduct(job.source_url,provider.credentials,{signal:request.signal});
   }else result=captured??await collectPublicProduct(job.source_url,{signal:request.signal});
  }
  catch(cause){return reply({error:cause instanceof Error?cause.message:'상품 페이지를 읽지 못했습니다.',code:provider.kind==='alibaba-api'?'SOURCE_PROVIDER_FAILED':'SOURCE_NOT_COLLECTED'},422);}
  if(result.offerId!==job.offer_id)return reply({error:'요청 상품번호가 일치하지 않습니다.'},409);
  if(request.signal.aborted)return reply({error:'취소된 수집 작업입니다.'},409);
  const saved=await storeCollectionResult(owner,id,result);
  if(saved.status!=='stored')return reply({error:'원문이 변경되었거나 요청이 취소되었습니다. 기존 내용은 유지됩니다.'},409);
  if(savedPage&&!selectedPageReceiptMatches(saved.result,captured,job.offer_id))return reply({error:'저장 확인 중 수집 원문의 보완본이 변경되었습니다. 기존 작업을 유지했으니 선택한 수집본과 저장 결과를 다시 확인해주세요.',code:'SOURCE_SELECTION_CONFLICT'},409);
  return reply({jobId:id,offerId:job.offer_id,receipt:{result:saved.result,receivedAt:saved.receivedAt}});
 }catch{return reply({error:'수집 결과 저장 여부를 확인하지 못했습니다. 다시 시도해주세요.'},503);}
}
