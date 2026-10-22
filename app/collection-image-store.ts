import { imageDimensionMetadata } from '@/app/image-dimensions';
import {NextResponse} from 'next/server';
import {env} from 'cloudflare:workers';
import {findCollectionJob} from '@/db/collection-jobs';
import {findCollectionProduct} from '@/db/collection-products';
import {readCollectionResult} from '@/db/collection-results';
import {findProduct} from '@/db/queries';
import {readProductContent} from '@/db/product-content';
import {readProductOptions} from '@/db/product-options';
import {readCollectionImage,saveCollectionImage,CollectionImageCancelledError} from '@/db/collection-images';
import {productImageKeys} from '@/app/product-content';
import {MAX_IMAGE_BYTES, PRODUCT_IMAGE_POOL_LIMIT } from '@/app/image-files';
import {downloadCollectionImage,collectedImageWarnings} from '@/app/collection-image';
import {collectionCommonImageCandidate} from '@/app/collection-gallery';
import {getChatGPTUser} from '@/app/chatgpt-auth';
import {approvedSupplierHubCompany} from '@/app/supplier-hub-company';
import {CollectionCompanyError,verifyCapturedCollectionCompany} from '@/app/collection-company';
import type {CollectionImageWriteFence} from '@/db/collection-images';
const reply=(body:unknown,status=200)=>NextResponse.json(body,{status,headers:{'cache-control':'no-store'}});

/** Keep the captured company and actor fixed across downloads and storage. A
 * genuinely unscoped legacy receipt keeps its existing owner-only contract. */
export async function assertCollectedImageScope(owner:string,id:string,expected?:CollectionImageWriteFence):Promise<CollectionImageWriteFence>{
 const job=await findCollectionJob(owner,id);
 if(!job||job.status==='cancelled')throw new CollectionImageCancelledError();
 if(!env.DB)throw Error('D1 unavailable');
 const raw=await env.DB.prepare('SELECT c.payload FROM collection_jobs j LEFT JOIN collection_context c ON c.job_id=j.id WHERE j.id=? AND j.owner_id=?').bind(id,owner).first<{payload:string|null}>();
 if(!raw)throw new CollectionImageCancelledError();
 let context:unknown=null;
 try{context=raw.payload===null?null:JSON.parse(raw.payload);}catch{throw new CollectionCompanyError('수집 당시 회사 자료를 확인하지 못했습니다. 다시 확인해주세요.','COLLECTION_COMPANY_INVALID');}
 if(JSON.stringify(context)!==JSON.stringify(job.context??null))throw new CollectionCompanyError('수집 자료가 변경되었습니다. 다시 확인해주세요.','COLLECTION_COMPANY_MISMATCH');
 // Older development fixtures have no authenticated user; production never
 // falls back to a demo actor, even for an unscoped legacy receipt.
 const user=typeof getChatGPTUser==='function'?await getChatGPTUser():null;
 const required=process.env.NODE_ENV==='production'||(env as {YOOFAM_AUTH_ENABLED?:string}).YOOFAM_AUTH_ENABLED==='true';
 if((required&&!user?.verifiedAccess)||(user&&user.userId!==owner))throw new CollectionCompanyError('로그인 계정이 변경되었습니다. 현재 계정에서 다시 확인해주세요.','COLLECTION_COMPANY_MISMATCH');
 const company=user?.verifiedAccess?approvedSupplierHubCompany(user.membership):null;
 verifyCapturedCollectionCompany(context,company);
 const member=user?.verifiedAccess?user.membership:undefined;
 const actor=member&&member.status==='approved'&&company?{email:member.email.trim().toLowerCase(),role:member.role,companyCode:company.code,companyName:company.name}:null;
 if((env as {YOOFAM_AUTH_ENABLED?:string}).YOOFAM_AUTH_ENABLED==='true'&&!actor)throw new CollectionCompanyError('승인된 회사 로그인을 확인해주세요.','COLLECTION_COMPANY_MISMATCH');
 const fence:CollectionImageWriteFence={ownerId:owner,jobId:id,contextPayload:raw.payload,company,actor};
 if(expected&&JSON.stringify(fence)!==JSON.stringify(expected))throw new CollectionCompanyError('로그인 회사 또는 수집 자료가 변경되었습니다. 다시 확인해주세요.','COLLECTION_COMPANY_MISMATCH');
 return fence;
}

/** Re-read the draft for each commit. Prefetch is internal and can only use the immutable receipt. */
export async function storeCollectedImage(owner:string,id:string,index:number,assignToStage=true,download?:()=>Promise<Awaited<ReturnType<typeof downloadCollectionImage>>>,expectedScope?:CollectionImageWriteFence){
 try{
  const job=await findCollectionJob(owner,id);
  if(!job)return reply({error:'수집 요청을 찾을 수 없습니다.'},404);
  const link=await findCollectionProduct(owner,id);if(!link||job.status==='cancelled')return reply({error:'상품 반영을 먼저 완료해주세요.'},409);
  const receipt=await readCollectionResult(owner,id);const image=receipt?.result.images[index];if(!image)return reply({error:'수신한 이미지 주소가 없습니다.'},404);
  const scope=await assertCollectedImageScope(owner,id,expectedScope);
  const previous=await readCollectionImage(owner,id,index);
  const product=await findProduct(owner,link.product_id);if(!product)return reply({error:'상품을 찾을 수 없습니다.'},404);
  // Product-level defaults use the common main image. A missing remote SKU is
  // not an unmatched actual SKU and must not create a permanent import warning.
  const skus=(receipt?.result.options??[]).filter(option=>option.imageIndex===index&&option.sku!=='').map(option=>option.sku);
  const commonStageAllowed=collectionCommonImageCandidate(receipt!.result,index);
  const warnings=async(key:string)=>collectedImageWarnings(await readProductContent(owner,product.id),await readProductOptions(owner,product.id),skus,key,image.role,assignToStage,commonStageAllowed);
  if(previous){
   if(previous.product_id!==product.id||!productImageKeys(product.image_keys).includes(previous.object_key))return reply({error:'이 원본은 상품 이미지에서 제외되었습니다. 기존 편집을 보존하기 위해 자동 복원하지 않습니다. 선택을 해제해주세요.',code:'IMAGE_DETACHED'},409);
   if(!env.FILES)return reply({error:'이미지 저장소 연결이 필요합니다.'},503);
   const stored=await env.FILES.head(previous.object_key);
   if(!stored||stored.size<1||stored.size>MAX_IMAGE_BYTES)return reply({error:'이전에 저장한 원본 파일을 확인할 수 없습니다. 이미지 자료를 점검해주세요.',code:'IMAGE_UNAVAILABLE'},409);
   const report=await warnings(previous.object_key);
   await assertCollectedImageScope(owner,id,scope);
   return reply({key:previous.object_key,reused:true,warnings:report});
  }
  const current=await readProductContent(owner,product.id);
  if(JSON.parse(product.image_keys).length>=PRODUCT_IMAGE_POOL_LIMIT)return reply({error:`상품 이미지 ${PRODUCT_IMAGE_POOL_LIMIT}개 제한입니다. 이미지를 정리해주세요.`},409);
  if(!env.FILES)return reply({error:'이미지 저장소 연결이 필요합니다.'},503);
  await assertCollectedImageScope(owner,id,scope);
  let downloaded;
  try{downloaded=download ? await download() : await downloadCollectionImage(image.url,owner,undefined,image.role);}
  catch{return reply({code:'IMAGE_DOWNLOAD_FAILED',error:'이 원본 이미지의 다운로드 또는 이미지 형식 확인에 실패했습니다. 다른 이미지 저장 후 다시 시도할 수 있습니다.'},502);}
  const latestJob=await findCollectionJob(owner,id);
  if(!latestJob || latestJob.status==='cancelled')return reply({code:'COLLECTION_CANCELLED',error:'취소된 수집 요청입니다. 내려받은 이미지를 상품에 반영하지 않았습니다.'},409);
  await assertCollectedImageScope(owner,id,scope);
  const stored=await env.FILES.put(downloaded.key,downloaded.bytes,{httpMetadata:{contentType:downloaded.contentType},customMetadata:{imageValidation:'header-v1',provenance:'collected',...imageDimensionMetadata(downloaded.bytes)}});
  if(!stored)throw new Error('이미지 저장 확인 실패');
  await assertCollectedImageScope(owner,id,scope);
  const saved=await saveCollectionImage(owner,id,index,downloaded.key,image.role,product,current,skus,assignToStage,commonStageAllowed,scope);
  const report=await warnings(saved.object_key);
  await assertCollectedImageScope(owner,id,scope);
  return reply({key:saved.object_key,warnings:report,message:'원본 이미지를 저장했습니다. 번역·가공은 실행하지 않았습니다.'});
 }catch(error){
  if(error instanceof CollectionImageCancelledError)return reply({code:'COLLECTION_CANCELLED',error:error.message},409);
  if(error instanceof CollectionCompanyError)return reply({code:error.code,error:error.message},409);
  return reply({error:'이미지 반영을 완료하지 못했습니다. 다시 시도해도 완료된 이미지는 중복 반영되지 않습니다.'},503);
 }
}
