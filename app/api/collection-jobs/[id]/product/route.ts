import { NextResponse } from 'next/server';
import { getChatGPTUser,getWorkspaceOwnerId } from '@/app/chatgpt-auth';
import { findCollectionJob } from '@/db/collection-jobs';
import { readCollectionResult } from '@/db/collection-results';
import { CollectionSourceSelectionError,findCollectionProduct,promoteCollection,type ExpectedCollectionSource } from '@/db/collection-products';
import { prepareCollectionProduct } from '@/app/collection-product';
import { findProduct } from '@/db/queries';
import { approvedSupplierHubCompany } from '@/app/supplier-hub-company';
import { CollectionCompanyError, verifyCapturedCollectionCompany } from '@/app/collection-company';
import {readBoundedJson,RequestBodyError} from '@/app/request-body';
import {validateSourceCaptureSelection,type SourceCaptureSelection} from '@/app/source-capture-selection';
import {selectedPageReceiptMatches} from '@/app/selected-page-receipt';
const reply=(body:unknown,status=200)=>NextResponse.json(body,{status,headers:{'cache-control':'no-store'}});
export async function POST(request:Request,context:{params:Promise<{id:string}>}){
 try{
 if(process.env.NODE_ENV==='production'&&!(await getChatGPTUser())?.verifiedAccess)return reply({error:'운영 인증 연결이 필요합니다.'},503);
 let selection:{capture:Readonly<SourceCaptureSelection>;receivedAt:string}|undefined;
 if(request.body){
  try{
   const input=await readBoundedJson(request,4096);
   if(!input||typeof input!=='object'||Array.isArray(input))throw Error('선택한 수집본의 상품 반영 요청을 확인해주세요.');
   const ordinary=Object.keys(input).length===1&&'action'in input&&input.action==='promote';
   if(!ordinary){
   if(Object.keys(input).length!==1||!Object.hasOwn(input,'expectedSource'))throw Error('선택한 수집본의 상품 반영 요청을 확인해주세요.');
   const proof=(input as {expectedSource:unknown}).expectedSource;
   if(!proof||typeof proof!=='object'||Array.isArray(proof)||Object.keys(proof).length!==2||!Object.hasOwn(proof,'capture')||!Object.hasOwn(proof,'receivedAt'))throw Error('선택한 수집본과 원문 저장 시각을 함께 확인해주세요.');
   const value=proof as {capture:unknown;receivedAt:unknown};
   if(typeof value.receivedAt!=='string'||value.receivedAt.length>40||!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/.test(value.receivedAt)||!Number.isFinite(Date.parse(value.receivedAt)))throw Error('원문 저장 시각을 확인해주세요.');
   selection={capture:validateSourceCaptureSelection(value.capture),receivedAt:value.receivedAt};
   }
  }catch(error){return reply({error:error instanceof Error?error.message:'선택한 수집본을 확인해주세요.'},error instanceof RequestBodyError?error.status:400);}
 }
 const owner=await getWorkspaceOwnerId();const {id}=await context.params;const job=await findCollectionJob(owner,id);
 if(!job)return reply({error:'수집 요청을 찾을 수 없습니다.'},404);
 const user=await getChatGPTUser();
 const company=user?.verifiedAccess&&user.userId===owner?approvedSupplierHubCompany(user.membership):null;
 const capturedCompany=verifyCapturedCollectionCompany(job.context,company);
 if(selection?.capture.format==='yoofam-saved-query-capture-v1'&&(!company||!capturedCompany))return reply({error:'수집 요청 당시의 회사를 확인하지 못했습니다. 기존 작업은 유지됩니다.',code:'SOURCE_SELECTION_CONFLICT'},409);
 if(selection?.capture.format==='yoofam-saved-query-capture-v1'&&(job.product_id||await findCollectionProduct(owner,id)))return reply({error:'이미 상품이 연결된 요청입니다. 기존 상품과 편집값은 유지했습니다.',code:'SOURCE_SELECTION_EXISTING_PRODUCT'},409);
 const previous=selection?null:await findCollectionProduct(owner,id);if(previous){
  if(!await findProduct(owner,previous.product_id,true))return reply({error:'삭제된 상품의 수집 요청입니다. 상품 추가에서 같은 URL로 새 초안을 만들거나 삭제된 상품을 복원해주세요.',code:'COLLECTION_PRODUCT_REMOVED'},409);
  return reply({productId:previous.product_id,reused:true,executionStarted:false});
 }
 if(job.status==='cancelled')return reply({error:'취소된 수집 요청입니다.'},409);
 const receipt=await readCollectionResult(owner,id);if(!receipt)return reply({error:'수집 결과가 아직 없습니다.'},409);
 let expectedSource:ExpectedCollectionSource|undefined;
 if(selection){
  try{
   if(!company||selection.receivedAt!==receipt.receivedAt)throw new CollectionSourceSelectionError();
   const capture=validateSourceCaptureSelection(selection.capture,job.source_url);
   const selected=capture.format==='yoofam-saved-query-capture-v1'?await (await import('@/app/owned-source-capture')).parseOwnedSourceCapture(owner,capture,job.source_url):await (await import('@/app/owned-page-capture')).parseOwnedPageCapture(owner,capture,job.source_url);
   if(!selectedPageReceiptMatches(receipt.result,selected,job.offer_id))throw new CollectionSourceSelectionError();
   expectedSource={capture,receivedAt:selection.receivedAt,company};
  }catch{return reply({error:new CollectionSourceSelectionError().message,code:'SOURCE_SELECTION_CONFLICT'},409);}
 }
 try{prepareCollectionProduct(owner,job,receipt.result,'validation',new Date().toISOString());}catch(cause){return reply({error:cause instanceof Error?cause.message:'원문을 확인해주세요.'},400);}
 const product=await promoteCollection(owner,job,receipt.result,expectedSource);
 return reply({productId:product.product_id,reused:product.reused,executionStarted:false,message:'상품·옵션·가격 원문 반영 완료. 번역·이미지 다운로드·등록 전송은 실행되지 않았습니다.'});
 }catch(error){
  if(error instanceof CollectionSourceSelectionError)return reply({error:error.message,code:'SOURCE_SELECTION_CONFLICT'},409);
  if(error instanceof CollectionCompanyError)return reply({error:error.message,code:error.code},409);
  return reply({error:'상품 반영 결과를 확인하지 못했습니다. 다시 시도해도 같은 요청의 상품은 중복 생성되지 않습니다.'},503);
 }
}
