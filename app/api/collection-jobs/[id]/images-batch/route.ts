import {NextResponse} from 'next/server';
import {env} from 'cloudflare:workers';
import {getChatGPTUser,getWorkspaceOwnerId} from '@/app/chatgpt-auth';
import {readBoundedJson,RequestBodyError} from '@/app/request-body';
import {findCollectionJob} from '@/db/collection-jobs';
import {findCollectionProduct} from '@/db/collection-products';
import {readCollectionResult} from '@/db/collection-results';
import {readCollectionImage} from '@/db/collection-images';
import {downloadCollectionImage} from '@/app/collection-image';
import {storeCollectedImage} from '@/app/collection-image-store';

const reply=(body:unknown,status=200)=>NextResponse.json(body,{status,headers:{'cache-control':'no-store'}});

/** Three bounded downloads overlap, then guarded DB commits run in source order.
 * Intake files stay in the library; this endpoint cannot select stage images. */
export async function POST(request:Request,context:{params:Promise<{id:string}>}){
 try{
  if(process.env.NODE_ENV==='production'&&!(await getChatGPTUser())?.verifiedAccess)return reply({error:'운영 인증이 필요합니다.'},503);
  if(request.headers.get('origin')&&request.headers.get('origin')!==new URL(request.url).origin)return reply({error:'같은 사이트에서 요청해주세요.'},400);
  const body=await readBoundedJson(request,1024) as {indices:number[]};
  if(!body||typeof body!=='object'||Object.keys(body).some(key=>key!=='indices')||!Array.isArray(body.indices)||!body.indices.length||body.indices.length>3||new Set(body.indices).size!==body.indices.length||body.indices.some(index=>!Number.isInteger(index)||index<0||index>=200))return reply({error:'서로 다른 원본 이미지 번호를 1~3개 선택해주세요.'},400);
  const owner=await getWorkspaceOwnerId(),{id}=await context.params;
  const job=await findCollectionJob(owner,id);
  if(!job)return reply({error:'수집 요청을 찾을 수 없습니다.'},404);
  const link=await findCollectionProduct(owner,id);
  if(!link||job.status==='cancelled')return reply({error:'상품 반영을 먼저 완료해주세요.'},409);
  const receipt=await readCollectionResult(owner,id);
  if(!receipt||body.indices.some(index=>!receipt.result.images[index]))return reply({error:'수신한 이미지 주소가 없습니다.'},404);
  if(!env.FILES)return reply({error:'이미지 저장소 연결이 필요합니다.'},503);
  const indices=[...body.indices].sort((left,right)=>left-right);
  // Convert each rejection into data immediately. No detached promise can
  // leak a failure, and completed imports never cause another CDN download.
  const downloads=await Promise.all(indices.map(async index=>{
   if(await readCollectionImage(owner,id,index))return null;
   const image=receipt.result.images[index];
   try{return {value:await downloadCollectionImage(image.url,owner,undefined,image.role)};}
   catch{return {failed:true as const};}
  }));
  const results=[];
  for(let position=0;position<indices.length;position++){
   const downloaded=downloads[position];
   const response=await storeCollectedImage(owner,id,indices[position],false,downloaded?async()=>{
    if('failed' in downloaded)throw Error('원본 다운로드 실패');
    return downloaded.value;
   }:undefined);
   results.push({index:indices[position],status:response.status,...await response.json() as Record<string,unknown>});
   // Keep later replies explicit, but a cancelled job never starts another
   // object write. The shared store rechecks cancellation and manual edits.
  }
  return reply({results});
 }catch(error){
  return reply({error:error instanceof RequestBodyError?error.message:'이미지 묶음 저장 결과를 확인하지 못했습니다. 다시 실행하면 완료된 파일은 재사용합니다.'},error instanceof RequestBodyError?error.status:503);
 }
}
