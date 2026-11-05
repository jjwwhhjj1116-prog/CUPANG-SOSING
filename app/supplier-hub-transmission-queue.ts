import {readSupplierHubProductSubmissionView} from '@/app/supplier-hub-legal-edit-scope';
import {readCurrentNativeAssetSource,reviewCurrentNativeSupplierHubProductDocument} from '@/app/supplier-hub-native-product-document';
import {previewProductDocument,readNativeReceiptHistory,type ProductDocumentSession} from '@/app/supplier-hub-product-client';
import {createProductDocumentPacket} from '../extensions/supplier-hub/product-document.mjs';
import {getSupplierHubProductHistory} from '@/app/supplier-hub-handoff';
import {readProductDocumentPending,readProductDocumentRejections,assertProductDocumentPending} from '@/app/supplier-hub-product-pending';
import {readNativeDraftDetailAmendmentPending} from '@/app/native-draft-detail-amendment-pending';
import {validateSupplierHubTransmissionHistory} from '@/app/supplier-hub-transmission-history';
import {parseStoredProductReceipt,productReceiptCanonical,type ProductReceiptRecord} from '@/app/supplier-hub-product-receipt';
import {supplierHubCompany} from '@/app/supplier-hub-company';
import type {SupplierHubProductDocumentReview} from '@/app/supplier-hub-product-document';

export type TransmissionQueueTarget={id:string;title:string;expectedCategoryId?:string};
export type TransmissionQueueCandidate={productId:string;title:string;review:SupplierHubProductDocumentReview;session:ProductDocumentSession};
const same=(left:unknown,right:unknown)=>productReceiptCanonical(left)===productReceiptCanonical(right);
const fail=():never=>{throw Error('현재 회원·상품·원래 요청의 견적 전송 자료를 다시 확인해주세요.');};
const scope=(candidate:TransmissionQueueCandidate)=>({productId:candidate.productId,...(candidate.review.identity.requestedProfileId?{profileId:candidate.review.identity.requestedProfileId}:{})});

export function transmissionQueueAttributes(candidates:readonly TransmissionQueueCandidate[]){
 if(!candidates.length||candidates.length>100||new Set(candidates.map(row=>row.productId)).size!==candidates.length||new Set(candidates.map(row=>row.session.packet.requestId)).size!==candidates.length)fail();
 const first=candidates[0].review.identity;
 const bindings=candidates.map(({productId,review,session})=>{
  const identity=review.identity,preview=session.preview;
  if(!supplierHubCompany(identity.company.code,identity.company.name)||identity.ownerId!==first.ownerId||!same(identity.company,first.company)||productId!==identity.productId
   ||!same(session.packet.review,review)||preview.productId!==productId||preview.reviewDigest!==review.reviewDigest||preview.fingerprint!==identity.fingerprint
   ||preview.requestId!==session.packet.requestId||preview.packetDigest!==session.packetDigest||preview.originalBodySha256!==review.originalBodySha256||preview.preparedBodySha256!==review.preparedBodySha256
   ||preview.identity.ownerId!==identity.ownerId||preview.identity.productId!==productId||!same(preview.identity.company,identity.company)||!same(preview.members,review.members)
   ||preview.draftPreparationAvailable!==true||preview.preparedLifecycleAvailable!==true)fail();
  return{ownerId:identity.ownerId,productId,companyCode:identity.company.code,packetDigest:session.packetDigest,requestId:session.packet.requestId,identityDigest:preview.identityDigest,bodySha256:review.originalBodySha256,preparedBodySha256:review.preparedBodySha256};
 });
 return{'data-supplier-hub-registration-batch':'v1','data-supplier-hub-registration-items':JSON.stringify(bindings)};
}

/** A queued result may advance only after the existing writer confirmed it. */
function receiptForCandidate(candidate:TransmissionQueueCandidate,value:unknown):ProductReceiptRecord|null{
 try{const record=parseStoredProductReceipt(value),{review,session}=candidate;
  if(record.productId!==candidate.productId||record.requestId!==session.packet.requestId
   ||record.identityDigest!==session.preview.identityDigest||record.packetDigest!==session.packetDigest||!same(record.identity,session.preview.identity)
   ||record.originalBodySha256!==review.originalBodySha256||record.preparedBodySha256!==review.preparedBodySha256||!same(record.members,review.members))return null;
  return record;
 }catch{return null;}
}
export function transmissionQueueReceipt(candidate:TransmissionQueueCandidate,value:unknown):ProductReceiptRecord|null{
 const record=receiptForCandidate(candidate,value);return record&&['accepted','rejected'].includes(record.receipt.state)?record:null;
}

async function assertNoLegacyTransmission(productId:string,categoryId:string,fingerprint:string,signal:AbortSignal,fetcher:typeof fetch){
 const local=await getSupplierHubProductHistory({productId,categoryId,fingerprint},signal);
 if(local.blocked||local.records.length)throw Error('Chrome에 원래 전송 이력이 있습니다. 개별 상품에서 같은 문서의 결과를 확인해주세요.');
 const path='/api/products/'+encodeURIComponent(productId)+'/supplier-hub-receipt?mode=history',response=await fetcher(path,{method:'GET',cache:'no-store',credentials:'same-origin',redirect:'error',signal});
 if(!response.ok||response.redirected||!response.headers.get('content-type')?.includes('application/json')||response.url&&response.url!==window.location.origin+path)fail();
 const legacy=validateSupplierHubTransmissionHistory((await response.json() as {history?:unknown}|null)?.history,productId);signal.throwIfAborted();
 if(legacy.receipts.length)throw Error('이전 파일 전송 이력이 있어 순차 전송에서 제외했습니다. 원래 접수 결과를 확인해주세요.');
}

async function currentReview(target:TransmissionQueueTarget,profileId:string|undefined,signal:AbortSignal,fetcher:typeof fetch){
 const source={productId:target.id,...(profileId?{profileId}:{}),expectedCategoryId:target.expectedCategoryId},quotationView=await readSupplierHubProductSubmissionView(source,signal,fetcher);
 const input={...source,quotationView,signal,fetcher},sourcePlan=await readCurrentNativeAssetSource(input);
 return reviewCurrentNativeSupplierHubProductDocument({...input,sourcePlan});
}
export async function refreshTransmissionQueueCandidate(candidate:TransmissionQueueCandidate,signal:AbortSignal,fetcher:typeof fetch=fetch){
 const review=await currentReview({id:candidate.productId,title:candidate.title,expectedCategoryId:candidate.review.identity.categoryId},scope(candidate).profileId,signal,fetcher);
 if(!same(review,candidate.review))throw Error('대기 중인 상품·분류·견적 또는 첨부가 변경됐습니다. 새로 전송하지 않고 원래 요청을 유지합니다.');
 const records=await readNativeReceiptHistory({productId:candidate.productId},signal,fetcher);
 if(records.some(record=>!receiptForCandidate(candidate,record)))throw Error('대기 중 다른 전송 이력이 생겼습니다. 새 문서를 만들지 않고 원래 결과를 확인해주세요.');
 await assertNoLegacyTransmission(candidate.productId,review.identity.categoryId,review.identity.inputFingerprint,signal,fetcher);
 const pending=readProductDocumentPending(review);if(pending)assertProductDocumentPending(review,pending,candidate.session);
 if(readNativeDraftDetailAmendmentPending(review))throw Error('원래 문서의 수정 요청이 있습니다. 새 전송 없이 결과를 확인해주세요.');
 return review;
}

/** Compile/preview only; no Hub create, upload, agreement or submit is sent. */
export async function prepareTransmissionQueueCandidate(target:TransmissionQueueTarget,profileId:string|undefined,signal:AbortSignal,fetcher:typeof fetch=fetch):Promise<TransmissionQueueCandidate>{
 const view=await readSupplierHubProductSubmissionView({productId:target.id,profileId,expectedCategoryId:target.expectedCategoryId},signal,fetcher);
 const nativeHistory=await readNativeReceiptHistory({productId:target.id},signal,fetcher);
 if(nativeHistory.length)throw Error('이미 전송 이력이 있는 상품입니다. 순차 전송에서 제외하고 원래 문서의 결과를 확인해주세요.');
 await assertNoLegacyTransmission(target.id,view.categoryContext.categoryId!,view.inputFingerprint,signal,fetcher);
 const input={productId:target.id,profileId,quotationView:view,signal,fetcher},sourcePlan=await readCurrentNativeAssetSource(input),review=await reviewCurrentNativeSupplierHubProductDocument({...input,sourcePlan});
 const unreserved=()=>{signal.throwIfAborted();if(readProductDocumentRejections(review).length||readProductDocumentPending(review)||readNativeDraftDetailAmendmentPending(review))throw Error('이 상품에 원래 문서 요청이 있습니다. 새 전송 없이 개별 상품에서 이어서 확인해주세요.');};
 unreserved();const packet=await createProductDocumentPacket(review),session=await previewProductDocument(packet,signal);unreserved();
 const candidate={productId:target.id,title:target.title,review,session};transmissionQueueAttributes([candidate]);
 await refreshTransmissionQueueCandidate(candidate,signal,fetcher);unreserved();return Object.freeze(candidate);
}
