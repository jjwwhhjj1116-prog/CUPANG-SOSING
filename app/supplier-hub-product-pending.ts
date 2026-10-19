import type {SupplierHubProductDocumentReview} from '@/app/supplier-hub-product-document';
import type {ProductDocumentSession,ProductDocumentState,ProductValidationRejection} from '@/app/supplier-hub-product-client';
import type {NativeReceiptRecord} from '@/app/supplier-hub-product-receipt';

const FORMAT='yoofam-product-document-pending-v1',HASH=/^[a-f0-9]{64}$/,ID=/^\w[\w-]{0,99}$/,UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const ORIGINS=['https://sourceflow.jjwwhhjj1116.workers.dev','http://localhost:3000','http://127.0.0.1:3000'];
export type ProductDocumentPending={format:typeof FORMAT;origin:string;ownerId:string;companyCode:string;companyName:string;productId:string;
 requestId:string;createdAt:number;reviewDigest:string;originalBodySha256:string;preparedBodySha256:string;identityDigest:string;appTabId:number;windowId:number};
type ProductReceiptRejection={evidence:'document-receipt';sourceStatus:'REJECTED';state:'rejected';qvtRequestId:string|number;observedAt:number};
export type ProductDocumentRejection={pending:ProductDocumentPending;docId:string|number}&({validationRejection:ProductValidationRejection}|{receiptRejection:ProductReceiptRejection});
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
function parsePending(value:unknown,review:SupplierHubProductDocumentReview):ProductDocumentPending{
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).length!==keys.length||!keys.every(key=>Object.hasOwn(value,key)))return fail();
 const item=value as ProductDocumentPending,{ownerId,company,productId}=review.identity;
 if(item.format!==FORMAT||item.origin!==window.location.origin||item.ownerId!==ownerId||item.productId!==productId||item.companyCode!==company.code||item.companyName!==company.name
  ||!UUID.test(item.requestId)||!Number.isSafeInteger(item.createdAt)||item.createdAt<=0||item.createdAt>Date.now()+5000
  ||![item.reviewDigest,item.originalBodySha256,item.preparedBodySha256,item.identityDigest].every(value=>typeof value==='string'&&HASH.test(value))
  ||![item.appTabId,item.windowId].every(value=>Number.isSafeInteger(value)&&value>=0))return fail();
 return Object.freeze(Object.fromEntries(keys.map(key=>[key,item[key as keyof ProductDocumentPending]]))) as ProductDocumentPending;
}
export function readProductDocumentPending(review:SupplierHubProductDocumentReview):ProductDocumentPending|null{
 const raw=storage().getItem(productDocumentPendingKey(review));if(raw===null)return null;
 if(raw.length>4096)return fail();let value:unknown;try{value=JSON.parse(raw);}catch{return fail();}return parsePending(value,review);
}
export function productDocumentRejectionKey(review:SupplierHubProductDocumentReview){return productDocumentPendingKey(review).replace('yoofam-product-document-pending:','yoofam-product-document-rejections:');}
const proofKeys=['evidence','operationId','step','validatedSteps','checkpointSequence','rejectedAt','submitted','consented'];
function rejectionProof(value:unknown,pending:ProductDocumentPending):value is ProductValidationRejection{
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).length!==proofKeys.length||!proofKeys.every(key=>Object.hasOwn(value,key)))return false;
 const proof=value as ProductValidationRejection;
 return proof.evidence==='document-validation-rejection'&&[2,3,4,5].includes(proof.step)&&proof.operationId===pending.requestId+':validate:'+proof.step
  &&JSON.stringify(proof.validatedSteps)===JSON.stringify([2,3,4,5].slice(0,proof.step-2))&&Number.isSafeInteger(proof.checkpointSequence)&&proof.checkpointSequence>=1
  &&Number.isSafeInteger(proof.rejectedAt)&&proof.rejectedAt>=pending.createdAt&&proof.rejectedAt<=Date.now()+5000&&proof.submitted===false&&proof.consented===false;
}
const documentId=(value:unknown)=>typeof value==='number'&&Number.isSafeInteger(value)&&value>0||typeof value==='string'&&value===value.trim()&&value.length>0&&value.length<=200&&!/[\u0000-\u001f]|\.\.\.|…/.test(value);
function receiptRejectionProof(value:unknown,pending:ProductDocumentPending):value is ProductReceiptRejection{
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).length!==5||!['evidence','sourceStatus','state','qvtRequestId','observedAt'].every(key=>Object.hasOwn(value,key)))return false;
 const proof=value as ProductReceiptRejection;return proof.evidence==='document-receipt'&&proof.sourceStatus==='REJECTED'&&proof.state==='rejected'&&documentId(proof.qvtRequestId)
  &&Number.isSafeInteger(proof.observedAt)&&proof.observedAt>=pending.createdAt&&proof.observedAt<=Date.now()+5000;
}
/** Every immutable native rejection stays covered, including A→B→A edits.
 * Never evict an old identity; a full or corrupt ledger fails closed. */
export function readProductDocumentRejections(review:SupplierHubProductDocumentReview):ProductDocumentRejection[]{
 const raw=storage().getItem(productDocumentRejectionKey(review));if(raw===null)return [];
 if(raw.length>65536)return fail();let value:unknown;try{value=JSON.parse(raw);}catch{return fail();}
 if(!Array.isArray(value)||value.length===0||value.length>32)return fail();const seen=new Set<string>();
 return Object.freeze(value.map(item=>{
  if(!item||typeof item!=='object'||Array.isArray(item)||Object.keys(item).length!==3||!['pending','docId'].every(key=>Object.hasOwn(item,key)))return fail();
  const pending=parsePending(item.pending,review),validation=Object.hasOwn(item,'validationRejection'),proof=validation?item.validationRejection:item.receiptRejection;
  if(!documentId(item.docId)||!(validation?rejectionProof(proof,pending):receiptRejectionProof(proof,pending)))return fail();
  const identity=JSON.stringify([pending.reviewDigest,pending.originalBodySha256,pending.preparedBodySha256]);if(seen.has(identity))return fail();seen.add(identity);
  if(validation)Object.freeze(proof.validatedSteps);Object.freeze(proof);return Object.freeze({pending,docId:item.docId,...(validation?{validationRejection:proof}:{receiptRejection:proof})});
 })) as unknown as ProductDocumentRejection[];
}
export function assertProductDocumentNotRejected(review:SupplierHubProductDocumentReview){
 if(readProductDocumentRejections(review).some(record=>productDocumentPendingCurrent(record.pending,review)))throw Error('같은 저장값의 문서는 이미 반려되었습니다. 상품·견적서를 수정한 뒤 전체 전송 자료를 다시 확인해주세요.');
}
function rememberRejection(review:SupplierHubProductDocumentReview,record:ProductDocumentRejection){
 const records=readProductDocumentRejections(review),existing=records.find(item=>productDocumentPendingCurrent(item.pending,record.pending));
 const refreshedReceipt=existing&&'receiptRejection' in existing&&'receiptRejection' in record&&same(existing.pending,record.pending)&&existing.docId===record.docId
  &&existing.receiptRejection.evidence===record.receiptRejection.evidence&&existing.receiptRejection.sourceStatus===record.receiptRejection.sourceStatus&&existing.receiptRejection.state===record.receiptRejection.state
  &&existing.receiptRejection.qvtRequestId===record.receiptRejection.qvtRequestId&&record.receiptRejection.observedAt>=existing.receiptRejection.observedAt;
 if(existing&&JSON.stringify(existing)!==JSON.stringify(record)&&!refreshedReceipt||!existing&&records.length>=32)return fail();
 const next=existing?records:[...records,record],key=productDocumentRejectionKey(review);
 storage().setItem(key,JSON.stringify(next));if(JSON.stringify(readProductDocumentRejections(review))!==JSON.stringify(next))return fail();
}
export function productDocumentPendingCurrent(value:ProductDocumentPending,review:Pick<SupplierHubProductDocumentReview,'reviewDigest'|'originalBodySha256'|'preparedBodySha256'>){
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
 return locked(review,signal,()=>{assertProductDocumentNotRejected(review);const previous=readProductDocumentPending(review);if(previous&&!same(previous,value))return fail();
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
 const receipt=record.receipt;
 if(!pendingProductRejection(expected,record)||!documentId(record.docId)||receipt.docId!==record.docId||receipt.evidence!=='document-receipt'||receipt.registered!==false||receipt.receiptId!==receipt.qvtRequestId
  ||receipt.identityDigest!==expected.identityDigest||receipt.preparedBodySha256!==expected.preparedBodySha256||record.identity.origin!==expected.origin||record.identity.appTabId!==expected.appTabId||record.identity.windowId!==expected.windowId)return fail();
 const proof:ProductReceiptRejection={evidence:receipt.evidence,sourceStatus:'REJECTED',state:'rejected',qvtRequestId:receipt.qvtRequestId,observedAt:receipt.observedAt};if(!receiptRejectionProof(proof,expected))return fail();
 return locked(review,signal,()=>{if(!canRemove())return false;if(!same(readProductDocumentPending(review),expected))return fail();rememberRejection(review,{pending:expected,docId:record.docId,receiptRejection:proof});
  if(signal.aborted)return false;if(!same(readProductDocumentPending(review),expected))return fail();storage().removeItem(productDocumentPendingKey(review));if(readProductDocumentPending(review)!==null)return fail();return true;});
}
/** A freshly recovered, committed pre-submit rejection can release only its
 * original reservation. The extension checkpoint remains immutable; a stale
 * ACK, transport error or bare state label never authorizes another document. */
export async function clearValidationRejectedProductDocumentPending(review:SupplierHubProductDocumentReview,expected:ProductDocumentPending,session:ProductDocumentSession,observation:ProductDocumentState,signal:AbortSignal,canRemove:()=>Promise<boolean>){
 const proof=observation.validationRejection,identity=observation.identity;
 if(observation.format!=='yoofam-supplier-hub-product-document-v1'||observation.state!=='validation-rejected'||observation.recovered!==true||observation.needsRecovery!==false
  ||observation.registered!==false||observation.success!==false||observation.error!==undefined||observation.receipt!==undefined||observation.challenge!==undefined||!documentId(observation.docId)
  ||observation.requestId!==expected.requestId||observation.requestId!==session.packet.requestId||observation.identityDigest!==expected.identityDigest||observation.identityDigest!==session.preview.identityDigest
  ||observation.packetDigest!==session.packetDigest||observation.packetDigest!==session.preview.packetDigest||observation.originalBodySha256!==expected.originalBodySha256||observation.preparedBodySha256!==expected.preparedBodySha256
  ||identity.origin!==expected.origin||identity.ownerId!==expected.ownerId||identity.productId!==expected.productId||identity.appTabId!==expected.appTabId||identity.windowId!==expected.windowId
  ||!identity.company||typeof identity.company!=='object'||(identity.company as {code?:unknown}).code!==expected.companyCode||(identity.company as {name?:unknown}).name!==expected.companyName
  ||!rejectionProof(proof,expected))return fail();
 assertProductDocumentPending(review,expected,session);
 return locked(review,signal,async()=>{if(!await canRemove()||signal.aborted)return false;assertProductDocumentPending(review,expected,session);
  rememberRejection(review,{pending:expected,docId:observation.docId!,validationRejection:proof});
  if(signal.aborted)return false;assertProductDocumentPending(review,expected,session);
  storage().removeItem(productDocumentPendingKey(review));if(readProductDocumentPending(review)!==null)return fail();return true;});
}
