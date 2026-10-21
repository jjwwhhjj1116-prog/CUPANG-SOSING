import {validateProductDocumentPacket,PRODUCT_DOCUMENT_PREVIEW_ACK_TIMEOUT,type ProductDocumentPacket} from '../extensions/supplier-hub/product-document.mjs';
import {productReceiptCanonical,parseStoredNativeReceipt,parseStoredProductReceipt,validateProductReceiptObservation,
  type NativeReceiptRecord,type ProductReceiptRecord,type ProductReceiptIdentity} from '@/app/supplier-hub-product-receipt';
import {readSingleCatalogContext,validateSingleConsentChallenge,type SingleDocumentState,type SingleDocumentAction,type SingleConfirmation} from '@/app/supplier-hub-single-client';
import type {SupplierHubCompany} from '@/app/supplier-hub-company';

const FORMAT='yoofam-supplier-hub-product-document-v1',HASH=/^[a-f0-9]{64}$/,ID=/^\w[\w-]{0,99}$/;
const ORIGINS=['https://sourceflow.jjwwhhjj1116.workers.dev','http://localhost:3000','http://127.0.0.1:3000'];
const object=(value:unknown):value is Record<string,unknown>=>Boolean(value&&typeof value==='object'&&!Array.isArray(value));
const exact=(value:unknown,keys:string[],optional:string[]=[]):value is Record<string,unknown>=>object(value)&&keys.every(key=>Object.hasOwn(value,key))&&Object.keys(value).every(key=>keys.includes(key)||optional.includes(key));
const identifier=(value:unknown)=>typeof value==='number'&&Number.isSafeInteger(value)&&value>0||typeof value==='string'&&value===value.trim()&&value.length>0&&value.length<=200&&!/[\u0000-\u001f]|\.\.\.|…/.test(value);
const same=(left:unknown,right:unknown)=>productReceiptCanonical(left)===productReceiptCanonical(right);
const copy=<T,>(value:T):T=>JSON.parse(productReceiptCanonical(value)) as T;
const digest=async(value:unknown)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(productReceiptCanonical(value)))),byte=>byte.toString(16).padStart(2,'0')).join('');
function freeze<T>(value:T):T{if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;}
export class ProductDocumentBridgeError extends Error{constructor(message:string,public uncertain:boolean,public code='PRODUCT_DOCUMENT_BRIDGE'){super(message);this.name='ProductDocumentBridgeError';}}
export type ProductDocumentPreview={format:string;requestId:string;identity:ProductReceiptIdentity;identityDigest:string;packetDigest:string;productId:string;fingerprint:string;
  members:ProductReceiptIdentity['members'];reviewDigest:string;preparedBodySha256:string;originalBodySha256:string;liveVerified:boolean;remoteWrites:false;registered:false;draftPreparationAvailable?:boolean};
export type ProductDocumentSession={packet:ProductDocumentPacket;preview:ProductDocumentPreview;packetDigest:string;origin:string};
export type ProductValidationRejection={evidence:'document-validation-rejection';operationId:string;step:number;validatedSteps:number[];checkpointSequence:number;rejectedAt:number;submitted:false;consented:false};
export type ProductDraftProof={evidence:'document-draft-preparation';validatedSteps:number[];checkpointSequence:number;observedAt:number;submitted:false;consented:false};
export type ProductDocumentState=SingleDocumentState&{duplicate?:boolean;recovered?:boolean;validationRejection?:ProductValidationRejection;draftOnly?:true;draftProof?:ProductDraftProof};
export type ProductDraftAction='prepareDraft'|'recoverDraft';
export type ProductReceiptSaveAttempt={packet:ProductDocumentPacket;observation:ProductDocumentState};
type Scope={productId:string;profileId?:string};
type Actor={ownerId:string;company:SupplierHubCompany};

async function proof(packet:ProductDocumentPacket,origin:string,allowExpired=false){
  productReceiptCanonical(packet);
  await validateProductDocumentPacket(packet,{now:allowExpired&&packet.createdAt<=Date.now()?packet.createdAt:Date.now()});
  const review=packet.review,scope=review.identity,source=Object.fromEntries(['productVersion','contentRevision','optionRevision','quotationRevision','profileRevision'].map(key=>[key,scope.source[key as keyof typeof scope.source]]));
  const logical={origin,ownerId:scope.ownerId,accountContext:await digest(['sourceflow-managed-product-account-v1',scope.ownerId,scope.company.code,scope.company.name]),company:scope.company,
    productId:scope.productId,profileId:scope.profileId,requestedProfileId:scope.requestedProfileId,categoryId:scope.categoryId,fingerprint:scope.fingerprint,inputFingerprint:scope.inputFingerprint,schemaSha256:scope.schemaSha256,source,members:review.members};
  return {logical,originalBodySha256:review.originalBodySha256,preparedBodySha256:review.preparedBodySha256,
    packetDigest:await digest({identity:logical,bodySha256:review.preparedBodySha256,originalBodySha256:review.originalBodySha256})};
}
async function verifyIdentity(identity:unknown,expected:Awaited<ReturnType<typeof proof>>,identityDigest:unknown){
  if(!exact(identity,['appTabId','windowId',...Object.keys(expected.logical)])||!Number.isSafeInteger(identity.appTabId)||Number(identity.appTabId)<0||!Number.isSafeInteger(identity.windowId)||Number(identity.windowId)<0
    ||!same(Object.fromEntries(Object.entries(identity).filter(([key])=>!['appTabId','windowId'].includes(key))),expected.logical)||await digest(identity)!==identityDigest)throw Error('전체 옵션·회원 회사·본문의 연결값이 다릅니다.');
}

/** One app click, one extension call. A missing ACK is never retried here. */
export function productDocumentExchange(action:'preview'|SingleDocumentAction|ProductDraftAction,packet:ProductDocumentPacket,signal:AbortSignal,confirmation?:SingleConfirmation):Promise<unknown>{
  return new Promise((resolve,reject)=>{
    if(signal.aborted){reject(new ProductDocumentBridgeError('전체 상품 견적 작업을 취소했습니다.',false));return;}
    productReceiptCanonical(packet);
    if(!['preview','start','resume','recover','confirm','observe','prepareDraft','recoverDraft'].includes(action)||action==='confirm'&&!confirmation||action!=='confirm'&&confirmation){reject(new ProductDocumentBridgeError('현재 전체 상품 문서의 동의 동작을 확인해주세요.',false));return;}
    if(confirmation)productReceiptCanonical(confirmation);
    const requestId=crypto.randomUUID(),mutating=!['preview','observe','recover','recoverDraft'].includes(action);
    const cleanup=()=>{clearTimeout(timer);window.removeEventListener('message',receive);signal.removeEventListener('abort',abort);};
    const abort=()=>{cleanup();reject(new ProductDocumentBridgeError('응답 확인을 취소했습니다. 같은 요청을 다시 보내지 말고 저장 결과를 조회해주세요.',mutating));};
    const receive=(event:MessageEvent)=>{
      if(event.source!==window||event.origin!==window.location.origin||event.data?.channel!=='YOOFAM_HUB_HANDOFF_RESULT'||event.data.requestId!==requestId)return;
      cleanup();const envelope=event.data.result;
      if(!object(envelope)||envelope.ok!==true||!Object.hasOwn(envelope,'result'))reject(new ProductDocumentBridgeError(typeof envelope?.error==='string'?envelope.error:'전체 상품 견적 응답을 확인하지 못했습니다.',mutating,typeof envelope?.code==='string'?envelope.code:'PRODUCT_DOCUMENT_BRIDGE'));
      else{try{resolve(copy(envelope.result));}catch{reject(new ProductDocumentBridgeError('전체 상품 견적 응답의 JSON 형식·크기를 확인해주세요.',mutating));}}
    };
    const timer=setTimeout(()=>{cleanup();reject(new ProductDocumentBridgeError('전체 상품 문서 응답이 없습니다. 같은 요청을 다시 전송하지 말고 저장 결과를 조회해주세요.',mutating,'PRODUCT_DOCUMENT_ACK_MISSING'));},action==='confirm'||action==='prepareDraft'?120000:action==='preview'?PRODUCT_DOCUMENT_PREVIEW_ACK_TIMEOUT:60000);
    window.addEventListener('message',receive);signal.addEventListener('abort',abort,{once:true});
    try{window.postMessage({channel:'YOOFAM_HUB_HANDOFF',requestId,type:'PRODUCT_DOCUMENT',payload:{action,packet,...(confirmation?{confirmation}:{})}},window.location.origin);}
    catch{cleanup();reject(new ProductDocumentBridgeError('확장 전달 응답을 확인하지 못했습니다. 원래 저장 결과를 조회해주세요.',mutating));}
  });
}
export async function previewProductDocument(packet:ProductDocumentPacket,signal:AbortSignal):Promise<ProductDocumentSession>{
  const origin=window.location.origin;if(!ORIGINS.includes(origin))throw new ProductDocumentBridgeError('허용된 앱에서 전체 상품 견적 자료를 확인해주세요.',false);
  const expected=await proof(packet,origin);if(signal.aborted)throw new ProductDocumentBridgeError('전체 상품 견적 확인을 취소했습니다.',false);
  const result=await productDocumentExchange('preview',packet,signal);
  try{
    if(signal.aborted||!exact(result,['format','requestId','identity','identityDigest','packetDigest','productId','fingerprint','members','reviewDigest','preparedBodySha256','originalBodySha256','liveVerified','remoteWrites','registered'],['draftPreparationAvailable'])
      ||result.format!==FORMAT||result.requestId!==packet.requestId||result.productId!==packet.review.identity.productId||result.fingerprint!==packet.review.identity.fingerprint
      ||!same(result.members,packet.review.members)||result.reviewDigest!==packet.review.reviewDigest||result.originalBodySha256!==expected.originalBodySha256||result.preparedBodySha256!==expected.preparedBodySha256
      ||result.packetDigest!==expected.packetDigest||!HASH.test(String(result.identityDigest))||typeof result.liveVerified!=='boolean'||result.remoteWrites!==false||result.registered!==false
      ||result.draftPreparationAvailable!==undefined&&typeof result.draftPreparationAvailable!=='boolean')throw Error();
    await verifyIdentity(result.identity,expected,result.identityDigest);
    if(signal.aborted)throw Error();return freeze({packet:copy(packet),preview:copy(result) as unknown as ProductDocumentPreview,packetDigest:expected.packetDigest,origin});
  }catch{throw new ProductDocumentBridgeError('확장에 전달한 전체 옵션·회사·본문 식별값이 다릅니다.',false,'PRODUCT_DOCUMENT_REPLY_IDENTITY');}
}
export async function runProductDocument(session:ProductDocumentSession,action:SingleDocumentAction,signal:AbortSignal,confirmation?:SingleConfirmation):Promise<ProductDocumentState>{
  if(session.preview.liveVerified!==true)throw new ProductDocumentBridgeError('전체 상품 문서의 실제 접수 연결을 검수 중입니다. 현재 상품은 전송하지 않았습니다.',false,'PRODUCT_DOCUMENT_LIVE_CONTRACT_UNVERIFIED');
  if(window.location.origin!==session.origin||!ORIGINS.includes(session.origin))throw new ProductDocumentBridgeError('원래 앱에서 전체 상품 견적 요청을 확인해주세요.',false);
  const expected=await proof(session.packet,session.origin,action!=='start'),mutating=!['recover','observe'].includes(action);
  const fail=():never=>{throw new ProductDocumentBridgeError('전체 상품 응답의 회원·문서·본문 연결을 확인하지 못했습니다. 원래 저장 결과를 조회해주세요.',mutating,'PRODUCT_DOCUMENT_REPLY_IDENTITY');};
  // Recheck a captured session before sending; caller-supplied member changes
  // cannot be hidden by retaining an old preview token.
  try{if(session.preview.packetDigest!==expected.packetDigest||session.packetDigest!==expected.packetDigest||session.preview.requestId!==session.packet.requestId||!same(session.preview.members,session.packet.review.members))fail();await verifyIdentity(session.preview.identity,expected,session.preview.identityDigest);}catch{fail();}
  if(signal.aborted)throw new ProductDocumentBridgeError('전체 상품 견적 작업을 취소했습니다.',false);
  const value=await productDocumentExchange(action,session.packet,signal,confirmation);
  try{
    if(!exact(value,['format','requestId','identity','identityDigest','packetDigest','originalBodySha256','preparedBodySha256','state','docId','registered','success','needsRecovery'],['challenge','error','receipt','duplicate','recovered','validationRejection']))return fail();
    if(signal.aborted||value.format!==FORMAT||value.requestId!==session.packet.requestId||value.identityDigest!==session.preview.identityDigest||value.packetDigest!==expected.packetDigest
      ||value.originalBodySha256!==expected.originalBodySha256||value.preparedBodySha256!==expected.preparedBodySha256||value.registered!==false||value.success!==false||typeof value.needsRecovery!=='boolean'
      ||!['prepared','target-requested','target-created','create-requested','created','update-requested','updated','validation-requested','validated','validation-rejected','navigation-requested','awaiting-stage-consent','stage-consent-requested','awaiting-consent','consent-requested','submit-requested','pending','accepted','rejected'].includes(String(value.state))
      ||value.docId!==null&&!identifier(value.docId)||value.duplicate!==undefined&&typeof value.duplicate!=='boolean'||value.recovered!==undefined&&typeof value.recovered!=='boolean')fail();
    await verifyIdentity(value.identity,expected,value.identityDigest);const result=copy(value) as unknown as ProductDocumentState;
    const beforeCreate=['prepared','target-requested','target-created','create-requested'].includes(result.state);
    if(beforeCreate?result.docId!==null:!identifier(result.docId))fail();
    if(['awaiting-stage-consent','awaiting-consent'].includes(result.state))result.challenge=validateSingleConsentChallenge(result.challenge,session,result.state,result.docId);
    else if(result.challenge!==undefined)fail();
    if(result.state==='validation-rejected'){
      const rejection=result.validationRejection;
      if(!exact(rejection,['evidence','operationId','step','validatedSteps','checkpointSequence','rejectedAt','submitted','consented'])||rejection.evidence!=='document-validation-rejection'
        ||![2,3,4,5].includes(Number(rejection.step))||!Number.isSafeInteger(rejection.step)||rejection.operationId!==result.requestId+':validate:'+rejection.step
        ||!Array.isArray(rejection.validatedSteps)||!same(rejection.validatedSteps,[2,3,4,5].slice(0,Number(rejection.step)-2))
        ||!Number.isSafeInteger(rejection.checkpointSequence)||Number(rejection.checkpointSequence)<1||!Number.isSafeInteger(rejection.rejectedAt)||Number(rejection.rejectedAt)<=0||Number(rejection.rejectedAt)>Date.now()+5000
        ||rejection.submitted!==false||rejection.consented!==false||result.needsRecovery!==false)fail();
    }else if(result.validationRejection!==undefined)fail();
    if(['pending','accepted','rejected'].includes(result.state)){
      if(result.needsRecovery!==false)fail();const observation=Object.fromEntries(Object.entries(result).filter(([key])=>!['error','duplicate','recovered'].includes(key)));
      await validateProductReceiptObservation(observation,session.packet.review,session.origin);
    }else if(result.receipt!==undefined)fail();
    if(result.error!==undefined&&(!exact(result.error,['code','message'])||typeof result.error.code!=='string'||result.error.code.length>100||typeof result.error.message!=='string'||result.error.message.length>2000))fail();
    if(signal.aborted)fail();return freeze(result);
  }catch{return fail();}
}

/** Explicitly prepare only the new draft. This capability never enables the
 * general start/resume/terms/submit transport or manufactures a receipt. */
export async function runProductDocumentDraft(session:ProductDocumentSession,action:ProductDraftAction,signal:AbortSignal):Promise<ProductDocumentState>{
  if(!['prepareDraft','recoverDraft'].includes(action)||session.preview.draftPreparationAvailable!==true)throw new ProductDocumentBridgeError('새 견적 초안 준비를 지원하는 통합 확장으로 자료를 다시 확인해주세요.',false,'PRODUCT_DOCUMENT_DRAFT_UNAVAILABLE');
  if(window.location.origin!==session.origin||!ORIGINS.includes(session.origin))throw new ProductDocumentBridgeError('원래 앱에서 새 견적 초안 요청을 확인해주세요.',false);
  const mutating=action==='prepareDraft',expected=await proof(session.packet,session.origin,!mutating);
  const fail=():never=>{throw new ProductDocumentBridgeError('새 초안 응답의 원래 회원·문서·본문 또는 제출 전 검증 기록을 확인하지 못했습니다. 같은 초안의 저장 결과를 조회해주세요.',mutating,'PRODUCT_DOCUMENT_DRAFT_REPLY_IDENTITY');};
  try{if(session.preview.packetDigest!==expected.packetDigest||session.packetDigest!==expected.packetDigest||session.preview.requestId!==session.packet.requestId||!same(session.preview.members,session.packet.review.members))fail();await verifyIdentity(session.preview.identity,expected,session.preview.identityDigest);}catch{fail();}
  if(signal.aborted)throw new ProductDocumentBridgeError('새 견적 초안 작업을 취소했습니다.',false);
  const value=await productDocumentExchange(action,session.packet,signal);
  if(exact(value,['format','requestId','state','registered','success'])&&value.format===FORMAT&&value.requestId===session.packet.requestId&&value.state==='busy'&&value.registered===false&&value.success===false)
    throw new ProductDocumentBridgeError('같은 초안을 다른 작업에서 확인 중입니다. 다시 만들지 말고 저장 결과를 조회해주세요.',mutating,'PRODUCT_DOCUMENT_DRAFT_BUSY');
  try{
    if(!exact(value,['format','requestId','identity','identityDigest','packetDigest','originalBodySha256','preparedBodySha256','state','docId','registered','success','needsRecovery','draftOnly','draftProof'],['error','duplicate','recovered','validationRejection']))return fail();
    if(signal.aborted||value.format!==FORMAT||value.requestId!==session.packet.requestId||value.identityDigest!==session.preview.identityDigest||value.packetDigest!==expected.packetDigest
      ||value.originalBodySha256!==expected.originalBodySha256||value.preparedBodySha256!==expected.preparedBodySha256||value.registered!==false||value.success!==false||value.draftOnly!==true
      ||!['prepared','target-requested','target-created','create-requested','created','update-requested','updated','validation-requested','validated','validation-rejected'].includes(String(value.state))
      ||value.needsRecovery!==['target-requested','create-requested','update-requested','validation-requested'].includes(String(value.state))
      ||value.duplicate!==undefined&&typeof value.duplicate!=='boolean'||value.recovered!==undefined&&typeof value.recovered!=='boolean'||action==='recoverDraft'&&value.recovered!==true)fail();
    await verifyIdentity(value.identity,expected,value.identityDigest);
    const beforeCreate=['prepared','target-requested','target-created','create-requested'].includes(String(value.state)),draft=value.draftProof;
    if(beforeCreate?value.docId!==null:!identifier(value.docId))fail();
    if(!exact(draft,['evidence','validatedSteps','checkpointSequence','observedAt','submitted','consented'])||!Array.isArray(draft.validatedSteps))return fail();
    if(draft.evidence!=='document-draft-preparation'||draft.validatedSteps.length>4||!same(draft.validatedSteps,[2,3,4,5].slice(0,draft.validatedSteps.length))
      ||!Number.isSafeInteger(draft.checkpointSequence)||Number(draft.checkpointSequence)<0||!Number.isSafeInteger(draft.observedAt)||Number(draft.observedAt)<=0||Number(draft.observedAt)>Date.now()+5000
      ||draft.submitted!==false||draft.consented!==false||value.state==='validated'&&(draft.validatedSteps.length!==4||Number(draft.checkpointSequence)<1)
      ||beforeCreate&&draft.validatedSteps.length!==0||value.state==='created'&&draft.validatedSteps.length!==0)fail();
    if(value.state==='validation-rejected'){
      const rejected=value.validationRejection;
      if(!exact(rejected,['evidence','operationId','step','validatedSteps','checkpointSequence','rejectedAt','submitted','consented'])||rejected.evidence!=='document-validation-rejection'
        ||![2,3,4,5].includes(Number(rejected.step))||!Number.isSafeInteger(rejected.step)||rejected.operationId!==value.requestId+':validate:'+rejected.step
        ||!same(rejected.validatedSteps,[2,3,4,5].slice(0,Number(rejected.step)-2))||!same(rejected.validatedSteps,draft.validatedSteps)
        ||rejected.checkpointSequence!==draft.checkpointSequence||rejected.rejectedAt!==draft.observedAt||Number(rejected.checkpointSequence)<1
        ||rejected.submitted!==false||rejected.consented!==false)fail();
    }else if(value.validationRejection!==undefined)fail();
    if(value.error!==undefined&&(!exact(value.error,['code','message'])||typeof value.error.code!=='string'||value.error.code.length>100||typeof value.error.message!=='string'||value.error.message.length>2000))fail();
    if(signal.aborted)fail();return freeze(copy(value) as unknown as ProductDocumentState);
  }catch{return fail();}
}

const endpoint=(scope:Scope)=>{if(!ID.test(scope.productId)||scope.profileId!==undefined&&!ID.test(scope.profileId))throw Error('상품·카테고리 식별값을 확인해주세요.');return `/api/products/${encodeURIComponent(scope.productId)}/supplier-hub-product-receipt`;};
async function json(response:Response,path:string,signal:AbortSignal):Promise<unknown>{
  if(signal.aborted||response.redirected||response.url&&response.url!==window.location.origin+path||!/^application\/json(?:\s*;|$)/i.test(response.headers.get('content-type')??'')||!response.body)throw Error('전송 확인 결과의 현재 앱 응답을 확인해주세요.');
  const reader=response.body.getReader(),parts:Uint8Array[]=[];let size=0;const abort=()=>{void reader.cancel().catch(()=>{});};signal.addEventListener('abort',abort,{once:true});
  try{for(;;){if(signal.aborted)throw Error('전송 확인 결과 조회가 취소됐습니다.');const item=await reader.read();if(item.done)break;size+=item.value.byteLength;if(size>2*1024*1024)throw Error('전송 확인 응답 크기를 확인해주세요.');parts.push(item.value);}}
  finally{await reader.cancel().catch(()=>{});reader.releaseLock();signal.removeEventListener('abort',abort);}
  if(signal.aborted)throw Error('전송 확인 결과 조회가 취소됐습니다.');const bytes=new Uint8Array(size);let offset=0;for(const part of parts){bytes.set(part,offset);offset+=part.byteLength;}
  const value:unknown=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));if(!response.ok)throw Error(object(value)&&typeof value.error==='string'&&value.error.length<=500?value.error:'전송 확인 결과를 저장하거나 조회하지 못했습니다.');productReceiptCanonical(value);return value;
}
async function requestScope<T>(signal:AbortSignal,run:(active:AbortSignal)=>Promise<T>):Promise<T>{
  const controller=new AbortController(),abort=()=>controller.abort();if(signal.aborted)abort();signal.addEventListener('abort',abort,{once:true});const timer=setTimeout(abort,15000);
  try{if(controller.signal.aborted)throw Error('전송 확인 결과 요청을 취소했습니다.');return await run(controller.signal);}finally{clearTimeout(timer);signal.removeEventListener('abort',abort);}
}
async function actorMatches(record:NativeReceiptRecord,scope:Scope,actor:Actor){
  if(record.productId!==scope.productId||scope.profileId!==undefined&&record.profileId!==scope.profileId||record.identity.ownerId!==actor.ownerId||!same(record.company,actor.company)
    ||record.identity.accountContext!==await digest(['sourceflow-managed-product-account-v1',actor.ownerId,actor.company.code,actor.company.name]))throw new ProductDocumentBridgeError('현재 회원 회사·상품과 다른 문서 접수 결과입니다.',false,'PRODUCT_DOCUMENT_RECEIPT_ACCOUNT');
}
function sameActor(before:Actor,after:Actor){if(!same(before,after))throw new ProductDocumentBridgeError('전송 확인 중 승인 회원 회사가 변경됐습니다.',false,'PRODUCT_DOCUMENT_RECEIPT_ACCOUNT');}
export async function readNativeReceiptHistory(scope:Scope,signal:AbortSignal,request:typeof fetch=fetch):Promise<NativeReceiptRecord[]>{
  return requestScope(signal,async active=>{
    const path=endpoint(scope)+(scope.profileId?`?profileId=${encodeURIComponent(scope.profileId)}`:''),before=await readSingleCatalogContext(active,request);
    const value=await json(await request(path,{method:'GET',cache:'no-store',credentials:'same-origin',redirect:'error',signal:active}),path,active);
    if(!exact(value,['format','productId','receipts'])||value.format!=='yoofam-native-receipt-history-v1'||value.productId!==scope.productId||!Array.isArray(value.receipts)||value.receipts.length>200)throw Error('저장된 문서 접수 이력의 형식을 확인해주세요.');
    const records:NativeReceiptRecord[]=[];for(const item of value.receipts){const record=parseStoredNativeReceipt(item);await actorMatches(record,scope,before);records.push(record);}
    sameActor(before,await readSingleCatalogContext(active,request));if(active.aborted)throw Error('문서 접수 이력 조회가 취소됐습니다.');return freeze(copy(records));
  });
}
/** Save or explicitly retry only this immutable local observation. This
 * endpoint never sends a new Hub request, receipt refresh or agreement action. */
export async function saveProductReceiptObservation(attempt:ProductReceiptSaveAttempt,signal:AbortSignal,request:typeof fetch=fetch):Promise<ProductReceiptRecord>{
  return requestScope(signal,async active=>{
    const {packet}=attempt;productReceiptCanonical(attempt.observation);
    const original=attempt.observation;
    if(original.duplicate!==undefined&&typeof original.duplicate!=='boolean'||original.recovered!==undefined&&typeof original.recovered!=='boolean'
      ||original.error!==undefined&&(!exact(original.error,['code','message'])||typeof original.error.code!=='string'||original.error.code.length>100||typeof original.error.message!=='string'||original.error.message.length>2000))throw Error('원래 문서 전송의 부가 확인 정보를 확인해주세요.');
    // Transport diagnostics are not receipt facts. Strip only these documented
    // fields from a copy; unknown extras still fail the strict receipt model.
    const observation=copy(Object.fromEntries(Object.entries(original).filter(([key])=>!['error','duplicate','recovered'].includes(key)))) as unknown as ProductDocumentState;
    const scope={productId:packet.review.identity.productId},path=endpoint(scope),before=await readSingleCatalogContext(active,request);
    if(before.ownerId!==packet.review.identity.ownerId||!same(before.company,packet.review.identity.company))throw new ProductDocumentBridgeError('현재 회원 회사와 원래 문서 접수 결과가 다릅니다.',false,'PRODUCT_DOCUMENT_RECEIPT_ACCOUNT');
    if(observation.requestId!==packet.requestId)throw Error('원래 전체 상품 문서의 요청 번호로 확인 결과를 저장해주세요.');
    await validateProductReceiptObservation(observation,packet.review,window.location.origin);
    const body=productReceiptCanonical({profileId:packet.review.identity.requestedProfileId,observation});if(new TextEncoder().encode(body).byteLength>256*1024)throw Error('문서 접수 저장 요청의 크기를 확인해주세요.');
    const value=await json(await request(path,{method:'POST',headers:{'content-type':'application/json'},body,cache:'no-store',credentials:'same-origin',redirect:'error',signal:active}),path,active);
    if(!exact(value,['receipt']))throw Error('전체 상품 문서 접수 저장 응답을 확인해주세요.');const record=parseStoredProductReceipt(value.receipt);await actorMatches(record,scope,before);
    const expected=observation.receipt!,immutable=(value:unknown)=>Object.fromEntries(Object.entries(value as Record<string,unknown>).filter(([key])=>!['observedAt','state','sourceStatus','rejectionDetails'].includes(key)));
    if(record.requestId!==packet.requestId||record.docId!==observation.docId||!same(record.identity,observation.identity)||record.identityDigest!==observation.identityDigest||record.packetDigest!==observation.packetDigest
      ||record.preparedBodySha256!==observation.preparedBodySha256||record.originalBodySha256!==observation.originalBodySha256||!same(record.members,packet.review.members)||record.receipt.observedAt<expected.observedAt
      ||!same(immutable(record.receipt),immutable(expected))||record.receipt.observedAt===expected.observedAt&&(record.receipt.state!==expected.state||record.receipt.sourceStatus!==expected.sourceStatus)
      ||expected.state==='accepted'&&record.receipt.state==='pending'||expected.state==='rejected'&&record.receipt.state!=='rejected')throw Error('보관한 접수 결과와 원래 전체 상품 문서가 다릅니다.');
    sameActor(before,await readSingleCatalogContext(active,request));if(active.aborted)throw Error('문서 접수 저장 확인이 취소됐습니다.');return freeze(copy(record));
  });
}
