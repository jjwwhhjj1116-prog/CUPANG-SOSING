import type {SupplierHubProductDocumentReview} from '@/app/supplier-hub-product-document';
import {parseStoredSingleReceipt,singleReceiptCanonical,singleReceiptSummary,isSingleReceiptSummary,SingleReceiptError,
  type NativeSingleReceipt,type SingleReceiptRecord,type SingleReceiptSummary} from '@/app/supplier-hub-single-receipt';

type Company=NativeSingleReceipt['company'];
type Source=SingleReceiptRecord['source'];
export type ProductReceiptMember={optionId:string;optionLabel:string;documentIndex:number};
export type ProductReceiptIdentity={origin:string;appTabId:number;windowId:number;ownerId:string;accountContext:string;company:Company;productId:string;
  profileId:string|null;requestedProfileId:string|null;categoryId:string;fingerprint:string;inputFingerprint:string;schemaSha256:string;source:Source;members:ProductReceiptMember[]};
export type ProductReceiptRecord={format:'yoofam-product-document-receipt-v1';recordType:'product-document';evidence:'chrome-observation';productId:string;
  profileId:string|null;requestedProfileId:string|null;categoryId:string;fingerprint:string;inputFingerprint:string;schemaSha256:string;source:Source;
  company:Company;members:ProductReceiptMember[];requestId:string;docId:string|number;identity:ProductReceiptIdentity;identityDigest:string;packetDigest:string;
  preparedBodySha256:string;originalBodySha256:string;receipt:NativeSingleReceipt;registered:false;recordedAt:string};
export type ProductReceiptObservation=Omit<ProductReceiptRecord,'recordedAt'>;
export type ProductReceiptSummary={format:'yoofam-product-document-receipt-summary-v1';recordType:'product-document';evidence:'chrome-observation';registered:false;
  label:string;company:Company;fingerprint:string;categoryId:string;observedAt:number;createdAt:string;optionCount:number;members:ProductReceiptMember[];
  docId:string|number;qvtRequestId:string|number;state:NativeSingleReceipt['state'];sourceStatus:NativeSingleReceipt['sourceStatus']};
export type NativeReceiptRecord=SingleReceiptRecord|ProductReceiptRecord;
export type NativeReceiptSummary=SingleReceiptSummary|ProductReceiptSummary;
const HASH=/^[a-f0-9]{64}$/,ID=/^\w[\w-]{0,99}$/,REQUEST_ID=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const LABELS={pending:'전체 상품 문서 등록 요청 진행중',accepted:'전체 상품 문서 등록 파일 완료 확인',rejected:'전체 상품 문서 등록 파일 반려'};
const STATES:Record<string,NativeSingleReceipt['state']>={SUBMITTED:'pending',FINISHED:'accepted',REJECTED:'rejected'};
function fail(message='전체 상품 문서 접수 결과의 원래 연결값을 확인해주세요.'):never{throw new SingleReceiptError(message,409,'PRODUCT_DOCUMENT_RECEIPT');}
const object=(value:unknown):value is Record<string,unknown>=>Boolean(value&&typeof value==='object'&&!Array.isArray(value));
const exact=(value:unknown,keys:string[]):value is Record<string,unknown>=>object(value)&&Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));
const id=(value:unknown):value is string=>typeof value==='string'&&ID.test(value);
const hash=(value:unknown):value is string=>typeof value==='string'&&HASH.test(value);
const identifier=(value:unknown):value is string|number=>typeof value==='string'&&value===value.trim()&&value.length>0&&value.length<=200&&!/[\u0000-\u001f]|\.\.\.|…/.test(value)||Number.isSafeInteger(value)&&Number(value)>0;
const revision=(value:unknown)=>Number.isSafeInteger(value)&&Number(value)>=0;
const iso=(value:unknown):value is string=>typeof value==='string'&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString()===value;
const company=(value:unknown):value is Company=>exact(value,['code','name'])&&(value.code==='A01526306'&&value.name==='유앤채'||value.code==='A01464742'&&value.name==='와이홉');
/** Inspect descriptors before reading caller values, including cross-realm
 * plain JSON used by the app/extension boundary. Never invoke accessors. */
export function productReceiptCanonical(value:unknown):string{
  const seen=new Set<object>();let nodes=0;
  const native=(value:object,name:string)=>{const constructor=Object.getOwnPropertyDescriptor(value,'constructor')?.value;return typeof constructor==='function'&&constructor.name===name&&/\{\s*\[native code\]\s*\}/.test(Function.prototype.toString.call(constructor));};
  const walk=(item:unknown,depth:number)=>{
    if(++nodes>100000||depth>30)fail('전체 상품 접수 자료의 처리 범위를 초과했습니다.');
    if(item===null||typeof item==='string'||typeof item==='boolean'||typeof item==='number'&&Number.isFinite(item))return;
    if(!item||typeof item!=='object'||seen.has(item))fail();
    const descriptors=Object.getOwnPropertyDescriptors(item),keys=Reflect.ownKeys(item),prototype=Object.getPrototypeOf(item);
    if(keys.some(key=>typeof key!=='string')||Object.values(descriptors).some(field=>!Object.hasOwn(field,'value')))fail();
    if(Array.isArray(item)){
      const parent=prototype&&Object.getPrototypeOf(prototype);
      if(!prototype||!native(prototype,'Array')||!parent||Object.getPrototypeOf(parent)!==null||!native(parent,'Object')||keys.length!==item.length+1||Object.keys(item).length!==item.length||Object.keys(item).some((key,index)=>key!==String(index)))fail();
    }else{
      if(prototype!==null&&(Object.getPrototypeOf(prototype)!==null||!native(prototype,'Object')))fail();
      if((keys as string[]).some(key=>!descriptors[key].enumerable||['__proto__','prototype','constructor','authorization','cookie','setcookie','password','accesstoken','refreshtoken','clientsecret','apikey','secret','privatekey','credentials','sessiontoken'].includes(key.replace(/[-_]/g,'').toLowerCase())))fail('인증 자료는 접수 결과에 보관할 수 없습니다.');
    }
    seen.add(item);for(const key of keys)if(key!=='length')walk(descriptors[key as string].value,depth+1);seen.delete(item);
  };
  walk(value,0);return singleReceiptCanonical(value);
}
const copy=<T,>(value:T):T=>JSON.parse(productReceiptCanonical(value)) as T;
const same=(left:unknown,right:unknown)=>productReceiptCanonical(left)===productReceiptCanonical(right);
const digest=async(value:unknown)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(productReceiptCanonical(value)))),byte=>byte.toString(16).padStart(2,'0')).join('');
function originValid(value:unknown):value is string{try{if(typeof value!=='string')return false;const url=new URL(value);return ['http:','https:'].includes(url.protocol)&&url.origin===value&&!url.username&&!url.password;}catch{return false;}}
function sourceValid(value:unknown):value is Source{return exact(value,['productVersion','contentRevision','optionRevision','quotationRevision','profileRevision'])
  &&typeof value.productVersion==='string'&&Number.isFinite(Date.parse(value.productVersion))&&['contentRevision','optionRevision','quotationRevision'].every(key=>revision(value[key]))&&(value.profileRevision===null||revision(value.profileRevision));}
function membersValid(value:unknown):value is ProductReceiptMember[]{return Array.isArray(value)&&value.length>0&&value.length<=200
  &&value.every((item,index)=>exact(item,['optionId','optionLabel','documentIndex'])&&id(item.optionId)&&typeof item.optionLabel==='string'&&item.optionLabel.length<=2000&&item.documentIndex===index)
  &&new Set(value.map(item=>item.optionId)).size===value.length;}
const LOGICAL=['ownerId','accountContext','company','productId','profileId','requestedProfileId','categoryId','fingerprint','inputFingerprint','schemaSha256','source','members'];
function identityValid(value:unknown):value is ProductReceiptIdentity{return exact(value,['origin','appTabId','windowId',...LOGICAL])&&originValid(value.origin)
  &&Number.isSafeInteger(value.appTabId)&&Number(value.appTabId)>=0&&Number.isSafeInteger(value.windowId)&&Number(value.windowId)>=0
  &&id(value.ownerId)&&id(value.productId)&&(value.profileId===null||id(value.profileId))&&(value.requestedProfileId===null||id(value.requestedProfileId)&&value.requestedProfileId===value.profileId)
  &&typeof value.categoryId==='string'&&/^\d{1,20}$/.test(value.categoryId)&&value.categoryId!=='0'&&company(value.company)&&sourceValid(value.source)&&membersValid(value.members)
  &&['accountContext','fingerprint','inputFingerprint','schemaSha256'].every(key=>hash(value[key]))&&(value.profileId!==null||value.source.profileRevision===null);}
function recordValid(value:unknown,stored:boolean,now:number):value is ProductReceiptRecord{
  const keys=['format','recordType','evidence','productId','profileId','requestedProfileId','categoryId','fingerprint','inputFingerprint','schemaSha256','source','company','members','requestId','docId','identity','identityDigest','packetDigest','preparedBodySha256','originalBodySha256','receipt','registered'];
  if(!exact(value,stored?[...keys,'recordedAt']:keys)||value.format!=='yoofam-product-document-receipt-v1'||value.recordType!=='product-document'||value.evidence!=='chrome-observation'||value.registered!==false
    ||!identityValid(value.identity)||typeof value.requestId!=='string'||!REQUEST_ID.test(value.requestId)||!identifier(value.docId)||!['identityDigest','packetDigest','preparedBodySha256','originalBodySha256'].every(key=>hash(value[key]))
    ||stored&&(!iso(value.recordedAt)||Date.parse(value.recordedAt)>now+5000))return false;
  const identity=value.identity;
  if(LOGICAL.filter(key=>!['ownerId','accountContext'].includes(key)).some(key=>!same(value[key],identity[key as keyof ProductReceiptIdentity])))return false;
  const receipt=value.receipt;
  return exact(receipt,['state','docId','company','identityDigest','preparedBodySha256','observedAt','receiptId','qvtRequestId','sourceStatus','evidence','registered'])
    &&typeof receipt.sourceStatus==='string'&&Object.hasOwn(STATES,receipt.sourceStatus)&&receipt.state===STATES[receipt.sourceStatus]&&receipt.docId===value.docId
    &&same(receipt.company,value.company)&&receipt.identityDigest===value.identityDigest&&receipt.preparedBodySha256===value.preparedBodySha256
    &&Number.isSafeInteger(receipt.observedAt)&&Number(receipt.observedAt)>0&&Number(receipt.observedAt)<=now+5000&&identifier(receipt.receiptId)&&receipt.receiptId===receipt.qvtRequestId
    &&receipt.evidence==='document-receipt'&&receipt.registered===false&&(!stored||Date.parse(value.recordedAt as string)>=Number(receipt.observedAt)-5000);
}
/** The authenticated server recomputes the complete current package. A raw
 * browser receipt cannot substitute for its exact ordered member/body identity.
 * This retains Chrome observation evidence only, never independently observed
 * Supplier Hub acceptance, issued SKUs or final approval. */
export async function validateProductReceiptObservation(observation:unknown,review:SupplierHubProductDocumentReview,origin:string,now=Date.now()):Promise<ProductReceiptObservation>{
  productReceiptCanonical(observation);productReceiptCanonical(review);
  const keys=['format','requestId','identity','identityDigest','packetDigest','preparedBodySha256','originalBodySha256','state','docId','registered','success','needsRecovery','receipt'];
  if(!exact(observation,keys)||review?.format!=='yoofam-supplier-hub-product-document-v1'||review.type!=='YOOFAM_PRODUCT_DOCUMENT_REVIEW'
    ||review.registered!==false||review.remoteWrites!==false||review.submissionReady!==false||observation.format!==review.format||typeof observation.requestId!=='string'||!REQUEST_ID.test(observation.requestId)||!identityValid(observation.identity)
    ||!originValid(origin)||!Number.isSafeInteger(now)||now<=0||!identifier(observation.docId)||observation.registered!==false||observation.success!==false||observation.needsRecovery!==false)fail();
  const source={productVersion:review.identity.source.productVersion,contentRevision:review.identity.source.contentRevision,optionRevision:review.identity.source.optionRevision,
    quotationRevision:review.identity.source.quotationRevision,profileRevision:review.identity.source.profileRevision};
  const logical={origin,ownerId:review.identity.ownerId,accountContext:await digest(['sourceflow-managed-product-account-v1',review.identity.ownerId,review.identity.company.code,review.identity.company.name]),
    company:review.identity.company,productId:review.identity.productId,profileId:review.identity.profileId,requestedProfileId:review.identity.requestedProfileId,categoryId:review.identity.categoryId,
    fingerprint:review.identity.fingerprint,inputFingerprint:review.identity.inputFingerprint,schemaSha256:review.identity.schemaSha256,source,members:review.members};
  const identity={...logical,appTabId:observation.identity.appTabId,windowId:observation.identity.windowId};
  if(!same(identity,observation.identity)||!membersValid(review.members)||!Array.isArray(review.body?.jsonDocument)||review.body.jsonDocument.length!==review.members.length)fail();
  const originalBodySha256=await digest(review.body),deferred=copy(review.body);
  for(const document of deferred.jsonDocument){if(!object(document))fail();const image=document.imagePage;if(object(image))for(const key of ['msrpAgree','labelContactAgreed'])if(Object.hasOwn(image,key)){if(typeof image[key]!=='boolean')fail();image[key]=false;}}
  const preparedBodySha256=await digest(deferred),identityDigest=await digest(identity),packetDigest=await digest({identity:logical,bodySha256:preparedBodySha256,originalBodySha256});
  if(review.reviewDigest!==await digest({format:review.format,type:review.type,identity:review.identity,members:review.members,originalBodySha256,preparedBodySha256})
    ||review.originalBodySha256!==originalBodySha256||review.preparedBodySha256!==preparedBodySha256||observation.originalBodySha256!==originalBodySha256
    ||observation.preparedBodySha256!==preparedBodySha256||observation.identityDigest!==identityDigest||observation.packetDigest!==packetDigest)fail();
  const record={format:'yoofam-product-document-receipt-v1' as const,recordType:'product-document' as const,evidence:'chrome-observation' as const,productId:logical.productId,
    profileId:logical.profileId,requestedProfileId:logical.requestedProfileId,categoryId:logical.categoryId,fingerprint:logical.fingerprint,inputFingerprint:logical.inputFingerprint,
    schemaSha256:logical.schemaSha256,source,company:copy(logical.company),members:copy(review.members),requestId:observation.requestId,docId:observation.docId,
    identity:copy(identity),identityDigest,packetDigest,preparedBodySha256,originalBodySha256,receipt:copy(observation.receipt),registered:false as const};
  if(!recordValid(record,false,now)||record.receipt.state!==observation.state)fail();return copy(record) as ProductReceiptObservation;
}
export function parseStoredProductReceipt(payload:string|unknown):ProductReceiptRecord{
  let value:unknown;try{if(typeof payload==='string'&&new TextEncoder().encode(payload).length>6*1024*1024)fail();value=typeof payload==='string'?JSON.parse(payload):payload;productReceiptCanonical(value);}catch{fail('보관된 전체 상품 문서 접수 자료를 확인해주세요.');}
  if(!recordValid(value,true,Date.now()))fail('보관된 전체 상품 문서 접수 연결값이 다릅니다.');return copy(value);
}
export function productReceiptSummary(record:ProductReceiptRecord,createdAt=record.recordedAt):ProductReceiptSummary{
  const value=parseStoredProductReceipt(record);if(!iso(createdAt))fail();return {format:'yoofam-product-document-receipt-summary-v1',recordType:'product-document',evidence:'chrome-observation',registered:false,
    label:LABELS[value.receipt.state],company:copy(value.company),fingerprint:value.fingerprint,categoryId:value.categoryId,observedAt:value.receipt.observedAt,createdAt,optionCount:value.members.length,
    members:copy(value.members),docId:value.docId,qvtRequestId:value.receipt.qvtRequestId,state:value.receipt.state,sourceStatus:value.receipt.sourceStatus};
}
export function isProductReceiptSummary(value:unknown):value is ProductReceiptSummary{
  try{productReceiptCanonical(value);}catch{return false;}
  return exact(value,['format','recordType','evidence','registered','label','company','fingerprint','categoryId','observedAt','createdAt','optionCount','members','docId','qvtRequestId','state','sourceStatus'])
    &&value.format==='yoofam-product-document-receipt-summary-v1'&&value.recordType==='product-document'&&value.evidence==='chrome-observation'&&value.registered===false
    &&typeof value.sourceStatus==='string'&&Object.hasOwn(STATES,value.sourceStatus)&&value.state===STATES[value.sourceStatus]&&value.label===LABELS[value.state as NativeSingleReceipt['state']]
    &&company(value.company)&&hash(value.fingerprint)&&typeof value.categoryId==='string'&&/^\d{1,20}$/.test(value.categoryId)&&value.categoryId!=='0'
    &&Number.isSafeInteger(value.observedAt)&&Number(value.observedAt)>0&&Number(value.observedAt)<=Date.now()+5000&&iso(value.createdAt)&&Date.parse(value.createdAt)<=Date.now()+5000
    &&membersValid(value.members)&&value.optionCount===value.members.length&&identifier(value.docId)&&identifier(value.qvtRequestId);
}
export function parseStoredNativeReceipt(payload:string|unknown):NativeReceiptRecord{
  let value:unknown;try{if(typeof payload==='string'&&new TextEncoder().encode(payload).length>6*1024*1024)fail();value=typeof payload==='string'?JSON.parse(payload):payload;productReceiptCanonical(value);}catch{fail('보관된 문서 접수 자료를 확인해주세요.');}
  if(!object(value))fail();if(value.format==='yoofam-single-receipt-v1')return parseStoredSingleReceipt(value);
  if(value.format==='yoofam-product-document-receipt-v1')return parseStoredProductReceipt(value);return fail('알 수 없는 문서 접수 형식입니다.');
}
export function nativeReceiptSummary(record:NativeReceiptRecord,createdAt=record.recordedAt,legacyOptionCount=1):NativeReceiptSummary{
  return record.format==='yoofam-product-document-receipt-v1'?productReceiptSummary(record,createdAt):singleReceiptSummary(record,createdAt,legacyOptionCount);
}
export function isNativeReceiptSummary(value:unknown):value is NativeReceiptSummary{try{productReceiptCanonical(value);}catch{return false;}return isSingleReceiptSummary(value)||isProductReceiptSummary(value);}
