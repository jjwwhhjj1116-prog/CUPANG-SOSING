import { imageDimensionMetadata } from '@/app/image-dimensions';
import {NextResponse} from 'next/server';
import {env} from 'cloudflare:workers';
import {getChatGPTUser,getWorkspaceOwnerId} from '@/app/chatgpt-auth';
import {readBoundedJson,RequestBodyError} from '@/app/request-body';
import {findCollectionJob} from '@/db/collection-jobs';
import {findCollectionProduct} from '@/db/collection-products';
import {readCollectionResult} from '@/db/collection-results';
import {findProduct} from '@/db/queries';
import {readProductContent} from '@/db/product-content';
import {readProductOptions} from '@/db/product-options';
import {readCollectionImage,saveCollectionImage} from '@/db/collection-images';
import {productImageKeys} from '@/app/product-content';
import {MAX_IMAGE_BYTES} from '@/app/image-files';
import {downloadCollectionImage,collectedImageWarnings} from '@/app/collection-image';
const reply=(body:unknown,status=200)=>NextResponse.json(body,{status,headers:{'cache-control':'no-store'}});
export async function POST(request:Request,context:{params:Promise<{id:string}>}){
 try{
  if(process.env.NODE_ENV==='production'&&!(await getChatGPTUser())?.verifiedAccess)return reply({error:'운영 인증이 필요합니다.'},503);
  if(request.headers.get('origin')&&request.headers.get('origin')!==new URL(request.url).origin)return reply({error:'같은 사이트에서 요청해주세요.'},400);
  const body=await readBoundedJson(request,1024) as {index:number};
  if(!body||typeof body!=='object'||Object.keys(body).some(k=>k!=='index')||!Number.isInteger(body.index)||body.index<0||body.index>=200)return reply({error:'이미지 번호를 확인해주세요.'},400);
  const owner=await getWorkspaceOwnerId();const {id}=await context.params;const job=await findCollectionJob(owner,id);
  if(!job)return reply({error:'수집 요청을 찾을 수 없습니다.'},404);
  const link=await findCollectionProduct(owner,id);if(!link||job.status==='cancelled')return reply({error:'상품 반영을 먼저 완료해주세요.'},409);
  const receipt=await readCollectionResult(owner,id);const image=receipt?.result.images[body.index];if(!image)return reply({error:'수신한 이미지 주소가 없습니다.'},404);
  const previous=await readCollectionImage(owner,id,body.index);
  const product=await findProduct(owner,link.product_id);if(!product)return reply({error:'상품을 찾을 수 없습니다.'},404);
  const skus=(receipt?.result.options??[]).filter(option=>option.imageIndex===body.index).map(option=>option.sku);
  const warnings=async(key:string)=>collectedImageWarnings(await readProductContent(owner,product.id),await readProductOptions(owner,product.id),skus,key,image.role);
  if(previous){
   if(previous.product_id!==product.id||!productImageKeys(product.image_keys).includes(previous.object_key))return reply({error:'이 원본은 상품 이미지에서 제외되었습니다. 기존 편집을 보존하기 위해 자동 복원하지 않습니다. 선택을 해제해주세요.',code:'IMAGE_DETACHED'},409);
   if(!env.FILES)return reply({error:'이미지 저장소 연결이 필요합니다.'},503);
   const stored=await env.FILES.head(previous.object_key);
   if(!stored||stored.size<1||stored.size>MAX_IMAGE_BYTES)return reply({error:'이전에 저장한 원본 파일을 확인할 수 없습니다. 이미지 자료를 점검해주세요.',code:'IMAGE_UNAVAILABLE'},409);
   return reply({key:previous.object_key,reused:true,warnings:await warnings(previous.object_key)});
  }
  const current=await readProductContent(owner,product.id);
  if(JSON.parse(product.image_keys).length>=50)return reply({error:'상품 이미지 50개 제한입니다. 이미지를 정리해주세요.'},409);
  if(!env.FILES)return reply({error:'이미지 저장소 연결이 필요합니다.'},503);
  const downloaded=await downloadCollectionImage(image.url,owner);
  const stored=await env.FILES.put(downloaded.key,downloaded.bytes,{httpMetadata:{contentType:downloaded.contentType},customMetadata:{imageValidation:'header-v1',provenance:'collected',...imageDimensionMetadata(downloaded.bytes)}});
  if(!stored)throw new Error('이미지 저장 확인 실패');
  const saved=await saveCollectionImage(owner,id,body.index,downloaded.key,image.role,product,current,skus);
  return reply({key:saved.object_key,warnings:await warnings(saved.object_key),message:'원본 이미지를 저장했습니다. 번역·가공은 실행하지 않았습니다.'});
 }catch(error){return reply({error:error instanceof RequestBodyError?error.message:'이미지 반영을 완료하지 못했습니다. 다시 시도해도 완료된 이미지는 중복 반영되지 않습니다.'},error instanceof RequestBodyError?error.status:503);}
}
