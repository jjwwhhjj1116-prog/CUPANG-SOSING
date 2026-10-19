import type {SupplierHubProductDocumentReview} from '@/app/supplier-hub-product-document';
import type {ProductDocumentSession} from '@/app/supplier-hub-product-client';
import type {NativeReceiptRecord} from '@/app/supplier-hub-product-receipt';

const FORMAT='yoofam-product-document-pending-v1',HASH=/^[a-f0-9]{64}$/,ID=/^\w[\w-]{0,99}$/,UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const ORIGINS=['https://sourceflow.jjwwhhjj1116.workers.dev','http://localhost:3000','http://127.0.0.1:3000'];
export type ProductDocumentPending={format:typeof FORMAT;origin:string;ownerId:string;companyCode:string;companyName:string;productId:string;
 requestId:string;createdAt:number;reviewDigest:string;originalBodySha256:string;preparedBodySha256:string;identityDigest:string;appTabId:number;windowId:number};
const keys=['format','origin','ownerId','companyCode','companyName','productId','requestId','createdAt','reviewDigest','originalBodySha256','preparedBodySha256','identityDigest','appTabId','windowId'];
const fail=():never=>{throw Error('이 상품의 이전 전송 기록을 확인하지 못했습니다. 다시 등록하지 말고 원래 문서의 저장 결과를 확인해주세요.');};
const same=(left:ProductDocumentPending|null,right:ProductDocumentPending|null)=>JSON.stringify(left)===JSON.stringify(right);
function storage(){try{const value=window.localStorage;if(!value||typeof value.getItem!=='function'||typeof value.setItem!=='function'||typeof value.removeItem!=='function')return fail();return value;}catch{return fail();}}
export function productDocumentPendingKey(review:SupplierHubProductDocumentReview){
 const {ownerId,productId,company}=review.identity,origin=window.location.origin;
 if(!ORIGINS.includes(origin)||!ID.test(ownerId)||!ID.test(productId)||!((company.code==='A01464742'&&company.name==='와이홉')||(company.code==='A01526306'&&company.name==='유앤채')))return fail();
 return 'yoofam-product-document-pending:'+JSON.stringify([origin,ownerId,company.code,company.name,productId]);
}
/** A small operation descriptor only. No quotation body, image URL, credential
 * or agreement approval is persisted. Unknown/corrupt entries never disappear. */
export function readProductDocumentPending(review:SupplierHubProductDocumentReview):ProductDocumentPending|null{
 const raw=storage().getItem(productDocumentPendingKey(review));if(raw===null)return null;
 if(raw.length>4096)return fail();let value:unknown;try{value=JSON.parse(raw);}catch{return fail();}
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).length!==keys.length||!keys.every(key=>Object.hasOwn(value,key)))return fail();
 const item=value as ProductDocumentPending,{ownerId,company,productId}=review.identity;
 if(item.format!==FORMAT||item.origin!==window.location.origin||item.ownerId!==ownerId||item.productId!==productId||item.companyCode!==company.code||item.companyName!==company.name
  ||!UUID.test(item.requestId)||!Number.isSafeInteger(item.createdAt)||item.createdAt<=0||item.createdAt>Date.now()+5000
  ||![item.reviewDigest,item.originalBodySha256,item.preparedBodySha256,item.identityDigest].every(value=>typeof value==='string'&&HASH.test(value))
  ||![item.appTabId,item.windowId].every(value=>Number.isSafeInteger(value)&&value>=0))return fail();
 return Object.freeze(Object.fromEntries(keys.map(key=>[key,item[key as keyof ProductDocumentPending]]))) as ProductDocumentPending;
}
export function productDocumentPendingCurrent(value:ProductDocumentPending,review:SupplierHubProductDocumentReview){
 return value.reviewDigest===review.reviewDigest&&value.originalBodySha256===review.originalBodySha256&&value.preparedBodySha256===review.preparedBodySha256;
}
export function assertProductDocumentPending(review:SupplierHubProductDocumentReview,expected:ProductDocumentPending,session?:ProductDocumentSession){
 if(!same(readProductDocumentPending(review),expected)||!productDocumentPendingCurrent(expected,review)
  ||session&&(session.packet.requestId!==expected.requestId||session.preview.identityDigest!==expected.identityDigest
   ||session.preview.identity.appTabId!==expected.appTabId||session.preview.identity.windowId!==expected.windowId))return fail();
}
async function locked<T>(review:SupplierHubProductDocumentReview,signal:AbortSignal,run:()=>T):Promise<T>{
 const locks=window.navigator?.locks;if(!locks||typeof locks.request!=='function')return fail();
 return locks.request(productDocumentPendingKey(review),{mode:'exclusive',signal},()=>{if(signal.aborted)return fail();return run();});
}
/** Web Locks serializes same-origin tabs before the first mutating dispatch.
 * A failed write/readback or conflicting operation cannot authorize a start. */
export async function claimProductDocumentPending(review:SupplierHubProductDocumentReview,session:ProductDocumentSession,signal:AbortSignal):Promise<ProductDocumentPending>{
 const identity=session.preview.identity,value:ProductDocumentPending={format:FORMAT,origin:window.location.origin,ownerId:review.identity.ownerId,companyCode:review.identity.company.code,
  companyName:review.identity.company.name,productId:review.identity.productId,requestId:session.packet.requestId,createdAt:session.packet.createdAt,reviewDigest:review.reviewDigest,
  originalBodySha256:review.originalBodySha256,preparedBodySha256:review.preparedBodySha256,identityDigest:session.preview.identityDigest,appTabId:identity.appTabId,windowId:identity.windowId};
 return locked(review,signal,()=>{const previous=readProductDocumentPending(review);if(previous&&!same(previous,value))return fail();
  if(!previous)storage().setItem(productDocumentPendingKey(review),JSON.stringify(value));assertProductDocumentPending(review,value,session);return value;});
}
export function pendingProductRejection(value:ProductDocumentPending,record:NativeReceiptRecord){
 return record.format==='yoofam-product-document-receipt-v1'&&record.receipt.sourceStatus==='REJECTED'&&record.receipt.state==='rejected'
  &&record.requestId===value.requestId&&record.productId===value.productId&&record.identity.ownerId===value.ownerId&&record.company.code===value.companyCode&&record.company.name===value.companyName
  &&record.originalBodySha256===value.originalBodySha256&&record.preparedBodySha256===value.preparedBodySha256&&record.identityDigest===value.identityDigest;
}
/** Only a positively stored rejection releases this exact operation. Pending,
 * accepted, unknown or changed-source records cannot discard its reservation. */
export async function clearRejectedProductDocumentPending(review:SupplierHubProductDocumentReview,expected:ProductDocumentPending,record:NativeReceiptRecord,signal:AbortSignal,canRemove:()=>boolean=()=>true){
 if(!pendingProductRejection(expected,record))return fail();
 return locked(review,signal,()=>{if(!canRemove())return false;if(!same(readProductDocumentPending(review),expected))return fail();storage().removeItem(productDocumentPendingKey(review));if(readProductDocumentPending(review)!==null)return fail();return true;});
}
