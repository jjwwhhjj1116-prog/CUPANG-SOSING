import {amendmentSame,validateNativeDraftDetailAmendmentAnchor,validateNativeDraftDetailAmendmentRequest,validateNativeDraftDetailAmendmentObservation,
 type NativeDraftDetailAmendmentAnchor,type NativeDraftDetailAmendmentDescriptor,type NativeDraftDetailAmendmentLookup,type NativeDraftDetailAmendmentReservedBegin,type NativeDraftDetailAmendmentObservation} from '../extensions/supplier-hub/native-draft-detail-amendment.mjs';
import {productDocumentPendingKey,readProductDocumentPending,type ProductDocumentPendingScope} from '@/app/supplier-hub-product-pending';
import type {SupplierHubProductDocumentReview} from '@/app/supplier-hub-product-document';

export type NativeDraftDetailAmendmentPending=NativeDraftDetailAmendmentDescriptor|NativeDraftDetailAmendmentReservedBegin;
const fail=():never=>{throw Error('원래 문서의 수정 준비 기록을 확인하지 못했습니다. 기존 전송 기록을 유지하고 같은 문서를 조회해주세요.');};
const same=amendmentSame;
const object=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);
const exact=(value:Record<string,unknown>,keys:string[])=>Object.keys(value).sort().join(',')===[...keys].sort().join(',');
const freeze=<T,>(value:T):T=>{if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;};
function storage(){try{const value=window.localStorage;if(!value||typeof value.getItem!=='function'||typeof value.setItem!=='function')return fail();return value;}catch{return fail();}}
export function nativeDraftDetailAmendmentLookup(anchor:NativeDraftDetailAmendmentAnchor):NativeDraftDetailAmendmentLookup{
 return Object.fromEntries(Object.entries(anchor).filter(([key])=>key!=='parentCheckpointSequence'&&key!=='parentCheckpointSha256')) as NativeDraftDetailAmendmentLookup;
}
function binding(value:NativeDraftDetailAmendmentPending){return 'anchor'in value?value.anchor:value.lookup;}
function scopeOf(value:NativeDraftDetailAmendmentPending):ProductDocumentPendingScope{const item=binding(value);return{identity:{ownerId:item.ownerId,company:item.company,productId:item.productId}};}
function parse(value:unknown):NativeDraftDetailAmendmentPending{
 if(!object(value)||!exact(value,['format','amendmentId',value.format==='yoofam-native-draft-detail-amendment-descriptor-v1'?'anchor':'lookup']))return fail();
 if(value.format==='yoofam-native-draft-detail-amendment-descriptor-v1'){
  const anchor=validateNativeDraftDetailAmendmentAnchor(value.anchor),request=validateNativeDraftDetailAmendmentRequest({action:'inspect',amendmentId:value.amendmentId,anchor});
  return freeze({format:value.format,amendmentId:request.amendmentId,anchor});
 }
 if(value.format!=='yoofam-native-draft-detail-amendment-begin-v1')return fail();
 const request=validateNativeDraftDetailAmendmentRequest({action:'inspect',amendmentId:value.amendmentId,lookup:value.lookup});
 if(!('lookup'in request))return fail();return freeze({format:value.format,amendmentId:request.amendmentId,lookup:request.lookup});
}
function parent(value:NativeDraftDetailAmendmentPending){
 const item=binding(value),saved=readProductDocumentPending(scopeOf(value));
 if(item.origin!==window.location.origin||!saved||saved.requestId!==item.requestId||saved.identityDigest!==item.parentIdentityDigest||saved.reviewDigest!==item.parentReviewDigest
  ||saved.originalBodySha256!==item.parentOriginalBodySha256||saved.preparedBodySha256!==item.parentPreparedBodySha256)return fail();
 return saved;
}
export function nativeDraftDetailAmendmentPendingKey(scope:ProductDocumentPendingScope){return productDocumentPendingKey(scope).replace('yoofam-product-document-pending:','yoofam-native-draft-detail-amendment:');}
/** Only a bounded lookup is persisted. The immutable parent reservation is never rewritten or removed. */
export function readNativeDraftDetailAmendmentPending(scope:ProductDocumentPendingScope):NativeDraftDetailAmendmentPending|null{
 const raw=storage().getItem(nativeDraftDetailAmendmentPendingKey(scope));if(raw===null)return null;if(raw.length>4096)return fail();
 let value:NativeDraftDetailAmendmentPending;try{value=parse(JSON.parse(raw));}catch{return fail();}
 const current=scopeOf(value);if(!same(current.identity,{ownerId:scope.identity.ownerId,company:scope.identity.company,productId:scope.identity.productId}))return fail();parent(value);return value;
}
export async function claimNativeDraftDetailAmendmentPending(input:NativeDraftDetailAmendmentPending,signal:AbortSignal):Promise<NativeDraftDetailAmendmentPending>{
 const value=parse(input),scope=scopeOf(value),locks=window.navigator?.locks;if(!locks||typeof locks.request!=='function')return fail();
 return locks.request(productDocumentPendingKey(scope),{mode:'exclusive',signal},()=>{
  signal.throwIfAborted();const original=parent(value),previous=readNativeDraftDetailAmendmentPending(scope);
  if(previous&&!same(previous,value)&&(!('lookup'in previous)||!('anchor'in value)||previous.amendmentId!==value.amendmentId||!same(previous.lookup,nativeDraftDetailAmendmentLookup(value.anchor))))return fail();
  const raw=JSON.stringify(value);if(raw.length>4096)return fail();storage().setItem(nativeDraftDetailAmendmentPendingKey(scope),raw);
  const saved=readNativeDraftDetailAmendmentPending(scope);if(!same(saved,value)||!same(parent(value),original))return fail();return saved!;
 });
}
export function assertNativeDraftDetailAmendmentCurrent(descriptor:NativeDraftDetailAmendmentDescriptor,observation:NativeDraftDetailAmendmentObservation,review?:SupplierHubProductDocumentReview){
 const current=readNativeDraftDetailAmendmentPending(scopeOf(descriptor));if(!same(current,descriptor))return fail();
 const proof=validateNativeDraftDetailAmendmentObservation(observation);
 if(!proof.anchor||!same(proof.anchor,descriptor.anchor)||proof.amendmentId!==descriptor.amendmentId)return fail();
 if(review&&(review.identity.ownerId!==descriptor.anchor.ownerId||review.identity.productId!==descriptor.anchor.productId||!same(review.identity.company,descriptor.anchor.company)
  ||proof.latest&&(proof.latest.reviewDigest!==review.reviewDigest||proof.latest.sourcePlanSha256!==review.identity.fingerprint||proof.latest.originalBodySha256!==review.originalBodySha256||proof.latest.preparedBodySha256!==review.preparedBodySha256)))return fail();
}
