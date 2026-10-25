import {HANDOFF_ORIGINS} from './handoff-store.mjs';
import {validateProductDocumentPacket} from './product-document.mjs';
import {createSupplierHubDocumentReceiver,createSingleDocumentStore,SingleDocumentError} from './single-document.mjs';

export const PRODUCT_DOCUMENT_RECEIVER_FORMAT='yoofam-supplier-hub-product-document-v1';
const canonical=value=>value===null||typeof value!=='object'?JSON.stringify(value):Array.isArray(value)?'['+value.map(canonical).join(',')+']':'{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonical(value[key])).join(',')+'}';
const digest=async value=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(canonical(value)))),byte=>byte.toString(16).padStart(2,'0')).join('');
const copy=value=>JSON.parse(canonical(value));
function freeze(value){if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;}
const fail=()=>{throw new SingleDocumentError('SENDER','허용된 앱의 원래 전체 상품 견적 요청을 확인해주세요.');};

/** Bind a validated whole-product request to its actual top-level app sender.
 * No action, Hub call, persistence, consent or receipt inference occurs here.
 * The browser-bound identity is deliberately distinct from the pure review.
 */
export async function productDocumentIdentity(packet,sender,options={}){
  let origin;try{const url=new URL(sender?.url);if(url.username||url.password)fail();origin=url.origin;}catch{fail();}
  if(!HANDOFF_ORIGINS.includes(origin)||sender?.frameId!==0||!Number.isSafeInteger(sender?.tab?.id)||sender.tab.id<0||!Number.isSafeInteger(sender.tab.windowId)||sender.tab.windowId<0)fail();
  const now=options.now??Date.now();let validated;
  try{validated=await validateProductDocumentPacket(packet,{now});}catch(error){
    // Only an exact already-checkpointed non-start operation may outlive its
    // initial preview TTL. The core still requires that immutable checkpoint
    // before recovery/resume/observe and repeats current source guards.
    const createdAt=packet&&typeof packet==='object'?Object.getOwnPropertyDescriptor(packet,'createdAt')?.value:undefined;
    if(options.allowExpired!==true||error?.code!=='EXPIRED'||!Number.isSafeInteger(now)||now<=0||!Number.isSafeInteger(createdAt)||createdAt<=0||createdAt>now)throw error;
    validated=await validateProductDocumentPacket(packet,{now:createdAt});
  }
  const review=validated.packet.review,scope=review.identity;
  // Account-context digest matches the app's established JSON-array byte
  // protocol, rather than hashing an encoded string as canonical JSON twice.
  const bytes=new TextEncoder().encode(JSON.stringify(['sourceflow-managed-product-account-v1',scope.ownerId,scope.company.code,scope.company.name]));
  const account=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),byte=>byte.toString(16).padStart(2,'0')).join('');
  const source=Object.fromEntries(['productVersion','contentRevision','optionRevision','quotationRevision','profileRevision'].map(key=>[key,scope.source[key]]));
  const identity={origin,appTabId:sender.tab.id,windowId:sender.tab.windowId,ownerId:scope.ownerId,accountContext:account,company:copy(scope.company),
    productId:scope.productId,profileId:scope.profileId,requestedProfileId:scope.requestedProfileId,categoryId:scope.categoryId,fingerprint:scope.fingerprint,
    inputFingerprint:scope.inputFingerprint,schemaSha256:scope.schemaSha256,source,members:copy(review.members)};
  const identityDigest=await digest(identity),bodySha256=review.preparedBodySha256,originalBodySha256=review.originalBodySha256;
  const logical={...identity};delete logical.appTabId;delete logical.windowId;
  const packetDigest=await digest({identity:logical,bodySha256,originalBodySha256});
  // The same product cannot open another document merely by editing category,
  // profile, included members, labels or ordering after an uncertain write.
  // Those facts stay in the packet identity; the durable reservation is wider.
  const lane=Object.fromEntries(['origin','ownerId','accountContext','company','productId'].map(key=>[key,identity[key]]));
  const laneKey='product-document-lane:'+await digest(lane);
  const value={type:validated.packet.type,format:PRODUCT_DOCUMENT_RECEIVER_FORMAT,requestId:validated.packet.requestId,...identity,body:copy(validated.preparedBody),originalBody:copy(review.body)};
  // Keep the receiver context immutable and never attach a scalar optionId.
  return freeze({packet:value,identity,identityDigest,bodySha256,originalBodySha256,packetDigest,laneKey,key:'product-document:'+packetDigest});
}

export function createProductDocumentReceiver(options){
  return createSupplierHubDocumentReceiver(options,{format:PRODUCT_DOCUMENT_RECEIVER_FORMAT,
    identity:(packet,sender,action)=>productDocumentIdentity(packet,sender,{now:options.now?.()??Date.now(),allowExpired:action!=='start'})});
}

/** A separately trusted native preparation and qualified-owned-draft lifecycle.
 * Its durable origin cannot enter the ordinary submission receiver or vice versa. */
export function createProductDocumentDraftReceiver(options){
  if(options.resolveSourceContext!==undefined&&typeof options.resolveSourceContext!=='function')throw new TypeError('A trusted source-context resolver is required.');
  return createSupplierHubDocumentReceiver(options,{format:PRODUCT_DOCUMENT_RECEIVER_FORMAT,draftOnly:true,nativeLifecycle:true,
    identity:async(packet,sender,action)=>{
      const context=await productDocumentIdentity(packet,sender,{now:options.now?.()??Date.now(),allowExpired:!['prepareDraft','reviewPreparedDraft'].includes(action)});
      return options.resolveSourceContext?options.resolveSourceContext(context):context;
    }});
}

export const createProductDocumentStore=createSingleDocumentStore;
