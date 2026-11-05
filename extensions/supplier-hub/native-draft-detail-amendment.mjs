import {HANDOFF_ORIGINS} from './handoff-store.mjs';
import {productDocumentCanonical} from './product-document.mjs';

export const NATIVE_DRAFT_DETAIL_AMENDMENT_FORMAT='yoofam-native-draft-detail-amendment-v1';
export class NativeDraftDetailAmendmentError extends Error{constructor(code,message='같은 저장 문서의 상세 수정 범위와 원래 요청을 확인해주세요.'){super(message);this.name='NativeDraftDetailAmendmentError';this.code=code;}}
export const amendmentFail=(code,message)=>{throw new NativeDraftDetailAmendmentError(code,message);};
export const amendmentCanonical=productDocumentCanonical;
export const amendmentCopy=value=>JSON.parse(amendmentCanonical(value));
export const amendmentSame=(a,b)=>amendmentCanonical(a)===amendmentCanonical(b);
export const amendmentDigest=async value=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(amendmentCanonical(value)))),byte=>byte.toString(16).padStart(2,'0')).join('');
const freeze=value=>{if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;};
const object=value=>!!value&&typeof value==='object'&&!Array.isArray(value),exact=(value,keys,optional=[])=>object(value)&&keys.every(key=>Object.hasOwn(value,key))&&Object.keys(value).every(key=>keys.includes(key)||optional.includes(key));
const HASH=/^[a-f0-9]{64}$/,UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/,ID=/^\w[\w-]{0,99}$/;
const companies={A01464742:'와이홉',A01526306:'유앤채'},integer=value=>Number.isSafeInteger(value)&&value>=0,documentId=value=>typeof value==='number'?Number.isSafeInteger(value)&&value>0:typeof value==='string'&&/^[1-9]\d{0,29}$/.test(value);
const hashes=['parentIdentityDigest','parentPacketDigest','parentReviewDigest','parentSourcePlanSha256','parentOriginalBodySha256','parentPreparedBodySha256'];
const lookupKeys=['origin','ownerId','company','productId','requestId','docId',...hashes],anchorKeys=[...lookupKeys,'parentCheckpointSequence','parentCheckpointSha256'];
const bad=()=>amendmentFail('DRAFT_DETAIL_AMENDMENT_INPUT');
function checkLookup(value){
 if(!exact(value,lookupKeys)||!HANDOFF_ORIGINS.includes(value.origin)||!ID.test(value.ownerId||'')||!ID.test(value.productId||'')||!UUID.test(value.requestId||'')||!documentId(value.docId)
  ||!exact(value.company,['code','name'])||!Object.hasOwn(companies,value.company.code)||companies[value.company.code]!==value.company.name||hashes.some(key=>!HASH.test(value[key]||'')))bad();
}
export function validateNativeDraftDetailAmendmentAnchor(value){
 const parsed=amendmentCopy(value);if(!exact(parsed,anchorKeys)||!integer(parsed.parentCheckpointSequence)||parsed.parentCheckpointSequence<1||!HASH.test(parsed.parentCheckpointSha256||''))bad();
 checkLookup(Object.fromEntries(lookupKeys.map(key=>[key,parsed[key]])));return freeze(parsed);
}
function review(value){
 if(!exact(value,['format','type','identity','members','body','originalBodySha256','preparedBodySha256','reviewDigest','registered','remoteWrites','submissionReady'])
  ||value.format!=='yoofam-supplier-hub-product-document-v1'||value.type!=='YOOFAM_PRODUCT_DOCUMENT_REVIEW'||!object(value.identity)||!object(value.body)||!Array.isArray(value.members)||!value.members.length||value.members.length>200
  ||!['reviewDigest','originalBodySha256','preparedBodySha256'].every(key=>HASH.test(value[key]||''))||value.registered!==false||value.remoteWrites!==false||value.submissionReady!==false)bad();
}
/** Shape only. The receiver independently validates every packet/review hash,
 * durable parent, authenticated source and actual remote document before use. */
export function validateNativeDraftDetailAmendmentRequest(value){
 const parsed=amendmentCopy(value);if(!UUID.test(parsed?.amendmentId||''))bad();
 if(parsed.action==='begin'){
  if(!exact(parsed,['action','amendmentId','packet','docId'])||!documentId(parsed.docId)||!exact(parsed.packet,['type','version','requestId','createdAt','review'])||parsed.packet.type!=='YOOFAM_PRODUCT_DOCUMENT_REQUEST'||parsed.packet.version!==1||!UUID.test(parsed.packet.requestId||'')||!integer(parsed.packet.createdAt)||parsed.packet.createdAt<1)bad();review(parsed.packet.review);
 }else if(parsed.action==='inspect'&&Object.hasOwn(parsed,'lookup')){if(!exact(parsed,['action','amendmentId','lookup']))bad();checkLookup(parsed.lookup);}
 else{
  const extra=parsed.action==='preview'?['nextReview']:parsed.action==='apply'?['nextReview','previewDigest']:parsed.action==='confirm'?['confirmation']:[];
  if(!['inspect','preview','apply','recover','review','confirm','observe'].includes(parsed.action)||!exact(parsed,['action','amendmentId','anchor',...extra]))bad();validateNativeDraftDetailAmendmentAnchor(parsed.anchor);
  if(extra.includes('nextReview'))review(parsed.nextReview);if(parsed.action==='apply'&&!HASH.test(parsed.previewDigest||''))bad();
  if(parsed.action==='confirm'&&(!object(parsed.confirmation)||parsed.confirmation.userInitiated!==true||!HASH.test(parsed.confirmation.challengeId||'')||!integer(parsed.confirmation.confirmedAt)||!Array.isArray(parsed.confirmation.approvedKeys)))bad();
 }
 return freeze(parsed);
}
const states=['not-found','editing','previewed','upload-requested','files-saved','update-requested','updated','validation-requested','validated','submission','pending','accepted','rejected','registered','blocked'];
const latestKeys=['reviewDigest','sourcePlanSha256','originalBodySha256','preparedBodySha256','identityDigest','packetDigest'];
export function validateNativeDraftDetailAmendmentObservation(value,expectedRequest){
 const parsed=amendmentCopy(value),request=expectedRequest===undefined?null:validateNativeDraftDetailAmendmentRequest(expectedRequest);
 if(!exact(parsed,['format','amendmentId','anchor','state','sequence','observedAt','previewDigest','latest','validatedSteps','needsRecovery','capabilities','execution','readOnly','registered'],['lifecycle','error'])
  ||parsed.format!==NATIVE_DRAFT_DETAIL_AMENDMENT_FORMAT||!UUID.test(parsed.amendmentId||'')||request&&parsed.amendmentId!==request.amendmentId||!states.includes(parsed.state)||!integer(parsed.sequence)||!integer(parsed.observedAt)||parsed.observedAt<1||parsed.observedAt>Date.now()+5000
  ||parsed.previewDigest!==null&&!HASH.test(parsed.previewDigest)||parsed.latest!==null&&(!exact(parsed.latest,latestKeys)||latestKeys.some(key=>!HASH.test(parsed.latest[key]||'')))
  ||!Array.isArray(parsed.validatedSteps)||parsed.validatedSteps.length>4||!amendmentSame(parsed.validatedSteps,[2,3,4,5].slice(0,parsed.validatedSteps.length))||typeof parsed.needsRecovery!=='boolean'||typeof parsed.readOnly!=='boolean'||parsed.registered!==false
  ||!exact(parsed.capabilities,['appendDetail'])||typeof parsed.capabilities.appendDetail!=='boolean'||!exact(parsed.execution,['create','upload','update','validate','submit'])||parsed.execution.create!==0
  ||!['upload','update','validate','submit'].every(key=>integer(parsed.execution[key])&&parsed.execution[key]<=(key==='validate'?4:1)))bad();
 if(parsed.state==='not-found'){
  if(parsed.anchor!==null||parsed.sequence!==0||parsed.latest!==null||parsed.previewDigest!==null||parsed.validatedSteps.length||parsed.needsRecovery||parsed.capabilities.appendDetail||parsed.lifecycle||request&&!(request.action==='inspect'&&request.lookup))bad();
 }else{validateNativeDraftDetailAmendmentAnchor(parsed.anchor);if(parsed.sequence<1||request?.anchor&&!amendmentSame(request.anchor,parsed.anchor)||request?.lookup&&!amendmentSame(request.lookup,Object.fromEntries(lookupKeys.map(key=>[key,parsed.anchor[key]]))))bad();}
 if(request&&['begin','inspect','preview','recover','observe'].includes(request.action)&&(!parsed.readOnly||Object.values(parsed.execution).some(Boolean)))bad();
 if(request?.action==='begin'&&(parsed.anchor?.requestId!==request.packet.requestId||String(parsed.anchor.docId)!==String(request.docId)||parsed.anchor.productId!==request.packet.review.identity.productId||parsed.anchor.ownerId!==request.packet.review.identity.ownerId||!amendmentSame(parsed.anchor.company,request.packet.review.identity.company)))bad();
 if(request?.nextReview&&parsed.latest&&(!amendmentSame(Object.fromEntries(['reviewDigest','originalBodySha256','preparedBodySha256'].map(key=>[key,parsed.latest[key]])),Object.fromEntries(['reviewDigest','originalBodySha256','preparedBodySha256'].map(key=>[key,request.nextReview[key]])))||parsed.latest.sourcePlanSha256!==request.nextReview.identity.fingerprint))bad();
 if(parsed.error&&(!exact(parsed.error,['code','message'])||!/^\w[\w_]{0,99}$/.test(parsed.error.code||'')||typeof parsed.error.message!=='string'||!parsed.error.message.length||parsed.error.message.length>2000))bad();
 if(parsed.lifecycle&&(!object(parsed.lifecycle)||!parsed.latest||parsed.lifecycle.requestId!==parsed.anchor?.requestId||String(parsed.lifecycle.docId)!==String(parsed.anchor?.docId)||parsed.lifecycle.identityDigest!==parsed.latest.identityDigest||parsed.lifecycle.packetDigest!==parsed.latest.packetDigest||parsed.lifecycle.originalBodySha256!==parsed.latest.originalBodySha256||parsed.lifecycle.preparedBodySha256!==parsed.latest.preparedBodySha256))bad();
 return freeze(parsed);
}
