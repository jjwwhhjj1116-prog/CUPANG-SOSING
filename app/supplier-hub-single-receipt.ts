import type {SingleDocumentPacket} from '@/app/supplier-hub-single-client';
import {receiptRejectionDetailsValid,type RejectionDetails} from '../extensions/supplier-hub/rejection-details.mjs';

type Company={code:string;name:string};
type Source=SingleDocumentPacket['source'];
export type NativeSingleReceipt={state:'pending'|'accepted'|'rejected';docId:string|number;company:Company;identityDigest:string;preparedBodySha256:string;
  observedAt:number;receiptId:string|number;qvtRequestId:string|number;sourceStatus:'SUBMITTED'|'FINISHED'|'REJECTED';evidence:'document-receipt';registered:false;rejectionDetails?:RejectionDetails};
export type SingleReceiptIdentity={origin:string;appTabId:number;windowId:number;ownerId:string;accountContext:string;company:Company;productId:string;
  profileId:string;optionId:string;categoryId:string;fingerprint:string;schemaSha256:string;source:Source};
export type SingleReceiptRecord={format:'yoofam-single-receipt-v1';evidence:'chrome-observation';productId:string;profileId:string;optionId:string;categoryId:string;
  fingerprint:string;schemaSha256:string;source:Source;company:Company;requestId:string;docId:string|number;identity:SingleReceiptIdentity;identityDigest:string;
  packetDigest:string;preparedBodySha256:string;originalBodySha256:string;receipt:NativeSingleReceipt;registered:false;recordedAt:string};
export type SingleReceiptObservation=Omit<SingleReceiptRecord,'recordedAt'>;
export type SingleReceiptSummary={format:'yoofam-single-receipt-summary-v1';evidence:'chrome-observation';registered:false;label:string;company:Company;
  fingerprint:string;categoryId:string;observedAt:number;createdAt:string;optionCount:number;optionId:string;docId:string|number;qvtRequestId:string|number;
  state:NativeSingleReceipt['state'];sourceStatus:NativeSingleReceipt['sourceStatus']};
export class SingleReceiptError extends Error{constructor(message:string,public status=409,public code='SINGLE_RECEIPT'){super(message);this.name='SingleReceiptError';}}
function fail(message='개별 문서 접수 결과의 원래 연결값을 확인해주세요.'):never{throw new SingleReceiptError(message);}
const HASH=/^[a-f0-9]{64}$/,ID=/^\w[\w-]{0,99}$/;
const STATES:Record<string,NativeSingleReceipt['state']>={SUBMITTED:'pending',FINISHED:'accepted',REJECTED:'rejected'};
const LABELS={pending:'개별 문서 등록 요청 진행중',accepted:'개별 문서 등록 파일 완료 확인',rejected:'개별 문서 등록 파일 반려'};
const COMPANIES:Record<string,string>={A01526306:'유앤채',A01464742:'와이홉'};
const object=(value:unknown):value is Record<string,unknown>=>Boolean(value&&typeof value==='object'&&!Array.isArray(value))
  &&Reflect.ownKeys(value as object).every(key=>typeof key==='string')&&Object.values(Object.getOwnPropertyDescriptors(value)).every(field=>Object.hasOwn(field,'value'));
const exact=(value:unknown,keys:string[],optional:string[]=[]):value is Record<string,unknown>=>object(value)&&keys.every(key=>Object.hasOwn(value,key))&&Object.keys(value).every(key=>keys.includes(key)||optional.includes(key));
const identifier=(value:unknown):value is string|number=>typeof value==='string'&&value===value.trim()&&value.length>0&&value.length<=200&&!/[\u0000-\u001f]|\.\.\.|…/.test(value)||Number.isSafeInteger(value)&&Number(value)>0;
const id=(value:unknown):value is string=>typeof value==='string'&&ID.test(value);
const hash=(value:unknown):value is string=>typeof value==='string'&&HASH.test(value);
const revision=(value:unknown)=>Number.isSafeInteger(value)&&Number(value)>=0;
const iso=(value:unknown):value is string=>typeof value==='string'&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString()===value;
const company=(value:unknown):value is Company=>exact(value,['code','name'])&&typeof value.code==='string'&&Object.hasOwn(COMPANIES,value.code)&&COMPANIES[value.code]===value.name;
function originValid(value:unknown):value is string{try{if(typeof value!=='string')return false;const url=new URL(value);return ['https:','http:'].includes(url.protocol)&&url.origin===value&&!url.username&&!url.password;}catch{return false;}}
function sourceValid(value:unknown):value is Source{return exact(value,['productVersion','contentRevision','optionRevision','quotationRevision','profileRevision'])
  &&typeof value.productVersion==='string'&&Number.isFinite(Date.parse(value.productVersion))&&['contentRevision','optionRevision','quotationRevision'].every(key=>revision(value[key]))
  &&(value.profileRevision===null||revision(value.profileRevision));}
/** Same sorted-key JSON/hash bytes as the Single client. No credentials or
 * unknown object types can be retained in a Chrome observation. */
export function singleReceiptCanonical(value:unknown):string{
  let count=0;const seen=new Set<object>();
  const visit=(item:unknown,depth:number):string=>{
    if(++count>100000||depth>30)fail('개별 문서 접수 자료의 처리 범위를 초과했습니다.');
    if(item===null||typeof item==='string'||typeof item==='boolean'||typeof item==='number'&&Number.isFinite(item))return JSON.stringify(item);
    if(!item||typeof item!=='object'||seen.has(item))fail();seen.add(item);let text:string;
    if(Array.isArray(item)){
      if(Reflect.ownKeys(item).length!==item.length+1||Object.keys(item).some((key,index)=>key!==String(index))||Object.keys(item).length!==item.length
        ||Object.values(Object.getOwnPropertyDescriptors(item)).some(field=>!Object.hasOwn(field,'value')))fail();
      text='['+item.map(child=>visit(child,depth+1)).join(',')+']';
    }else{
      if(!object(item))fail();const keys=Object.keys(item).sort();
      if(keys.some(key=>['__proto__','prototype','constructor','authorization','cookie','password','accessToken','refreshToken'].includes(key)))fail('인증 자료는 접수 결과에 보관할 수 없습니다.');
      text='{'+keys.map(key=>JSON.stringify(key)+':'+visit(item[key],depth+1)).join(',')+'}';
    }seen.delete(item);return text;
  };
  const result=visit(value,0);if(new TextEncoder().encode(result).length>6*1024*1024)fail('접수 자료가 6MB를 초과했습니다.');return result;
}
const same=(left:unknown,right:unknown)=>singleReceiptCanonical(left)===singleReceiptCanonical(right);
const copy=<T,>(value:T):T=>JSON.parse(singleReceiptCanonical(value)) as T;
const digest=async(value:unknown)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(singleReceiptCanonical(value)))),byte=>byte.toString(16).padStart(2,'0')).join('');
const LOGICAL=['ownerId','accountContext','company','productId','profileId','optionId','categoryId','fingerprint','schemaSha256','source'];
function identityValid(value:unknown):value is SingleReceiptIdentity{
  return exact(value,['origin','appTabId','windowId',...LOGICAL])&&originValid(value.origin)&&Number.isSafeInteger(value.appTabId)&&Number(value.appTabId)>=0
    &&Number.isSafeInteger(value.windowId)&&Number(value.windowId)>=0&&['ownerId','productId','profileId','optionId'].every(key=>id(value[key]))
    &&typeof value.categoryId==='string'&&/^\d{1,20}$/.test(value.categoryId)&&value.categoryId!=='0'&&['accountContext','fingerprint','schemaSha256'].every(key=>hash(value[key]))&&company(value.company)&&sourceValid(value.source);
}
function receiptValid(value:unknown,record:Omit<SingleReceiptObservation,'receipt'>,now:number):value is NativeSingleReceipt{
  return exact(value,['state','docId','company','identityDigest','preparedBodySha256','observedAt','receiptId','qvtRequestId','sourceStatus','evidence','registered'],['rejectionDetails'])
    &&receiptRejectionDetailsValid(value)
    &&typeof value.sourceStatus==='string'&&Object.hasOwn(STATES,value.sourceStatus)&&value.state===STATES[value.sourceStatus]&&value.docId===record.docId
    &&same(value.company,record.company)&&value.identityDigest===record.identityDigest&&value.preparedBodySha256===record.preparedBodySha256
    &&Number.isSafeInteger(value.observedAt)&&Number(value.observedAt)>0&&Number(value.observedAt)<=now+5000&&identifier(value.receiptId)&&value.receiptId===value.qvtRequestId
    &&value.evidence==='document-receipt'&&value.registered===false;
}
function recordValid(value:unknown,stored:boolean,now:number):value is SingleReceiptRecord{
  const keys=['format','evidence','productId','profileId','optionId','categoryId','fingerprint','schemaSha256','source','company','requestId','docId','identity','identityDigest','packetDigest','preparedBodySha256','originalBodySha256','receipt','registered'];
  if(!exact(value,stored?[...keys,'recordedAt']:keys))return false;const identity=value.identity;
  if(value.format!=='yoofam-single-receipt-v1'||value.evidence!=='chrome-observation'||value.registered!==false
    ||!identityValid(identity)||!id(value.requestId)||!identifier(value.docId)||!['identityDigest','packetDigest','preparedBodySha256','originalBodySha256'].every(key=>hash(value[key]))
    ||LOGICAL.filter(key=>!['ownerId','accountContext'].includes(key)).some(key=>!same(value[key],identity[key as keyof SingleReceiptIdentity]))
    ||stored&&(!iso(value.recordedAt)||Date.parse(value.recordedAt)>now+5000))return false;
  return receiptValid(value.receipt,value as unknown as SingleReceiptObservation,now)
    &&(!stored||Date.parse(value.recordedAt as string)>=value.receipt.observedAt-5000);
}
/** Validate one native receipt against a server-recomputed CURRENT package.
 * Chrome-supplied tab identifiers remain Chrome observations; the server does
 * not claim that it independently executed Supplier Hub or confirmed a SKU. */
export async function validateSingleReceiptObservation(observation:unknown,packet:SingleDocumentPacket,origin:string,now=Date.now()):Promise<SingleReceiptObservation>{
  singleReceiptCanonical(observation);singleReceiptCanonical(packet);
  const keys=['format','requestId','identity','identityDigest','packetDigest','preparedBodySha256','originalBodySha256','state','docId','registered','success','needsRecovery','receipt'];
  if(!exact(observation,keys)||!Number.isSafeInteger(now)||now<=0||!originValid(origin)||packet?.format!=='yoofam-supplier-hub-single-document-v1'
    ||packet.type!=='YOOFAM_SINGLE_DOCUMENT_TRANSPORT'||observation.format!==packet.format||!id(packet.requestId)||observation.requestId!==packet.requestId||!identityValid(observation.identity)
    ||!identifier(observation.docId)||observation.registered!==false||observation.success!==false||observation.needsRecovery!==false)fail();
  const logical={origin,...Object.fromEntries(LOGICAL.map(key=>[key,packet[key as keyof SingleDocumentPacket]]))};
  const identity={...logical,appTabId:observation.identity.appTabId,windowId:observation.identity.windowId};
  if(!same(observation.identity,identity)||packet.accountContext!==await digest(['sourceflow-managed-product-account-v1',packet.ownerId,packet.company.code,packet.company.name]))fail();
  // accountContext uses JSON.stringify of an ordered primitive array, equal
  // to the client's canonical encoding for this particular value.
  const originalBodySha256=await digest(packet.body),body=copy(packet.body),image=body.jsonDocument?.[0]?.imagePage;
  if(object(image))for(const key of ['msrpAgree','labelContactAgreed'])if(Object.hasOwn(image,key))image[key]=false;
  const preparedBodySha256=await digest(body),identityDigest=await digest(identity),packetDigest=await digest({identity:logical,bodySha256:preparedBodySha256,originalBodySha256});
  if(observation.identityDigest!==identityDigest||observation.packetDigest!==packetDigest||observation.preparedBodySha256!==preparedBodySha256||observation.originalBodySha256!==originalBodySha256)fail();
  const record={format:'yoofam-single-receipt-v1' as const,evidence:'chrome-observation' as const,productId:packet.productId,profileId:packet.profileId,optionId:packet.optionId,
    categoryId:packet.categoryId,fingerprint:packet.fingerprint,schemaSha256:packet.schemaSha256,source:copy(packet.source),company:copy(packet.company),requestId:packet.requestId,docId:observation.docId,
    identity:copy(identity) as SingleReceiptIdentity,identityDigest,packetDigest,preparedBodySha256,originalBodySha256,receipt:copy(observation.receipt),registered:false as const};
  if(!recordValid(record,false,now)||record.receipt.state!==observation.state)fail();return copy(record) as SingleReceiptObservation;
}
export function parseStoredSingleReceipt(payload:string|unknown):SingleReceiptRecord{
  let value:unknown;try{if(typeof payload==='string'&&new TextEncoder().encode(payload).length>6*1024*1024)fail();value=typeof payload==='string'?JSON.parse(payload):payload;singleReceiptCanonical(value);}catch{fail('보관된 개별 문서 접수 자료를 확인해주세요.');}
  if(!recordValid(value,true,Date.now()))fail('보관된 개별 문서 접수 연결값이 다릅니다.');return copy(value);
}
export function singleReceiptSummary(record:SingleReceiptRecord,createdAt:string=record.recordedAt,optionCount=1):SingleReceiptSummary{
  const value=parseStoredSingleReceipt(record);if(!iso(createdAt)||!Number.isSafeInteger(optionCount)||optionCount<1||optionCount>200)fail();
  return {format:'yoofam-single-receipt-summary-v1',evidence:'chrome-observation',registered:false,label:LABELS[value.receipt.state],company:copy(value.company),fingerprint:value.fingerprint,
    categoryId:value.categoryId,observedAt:value.receipt.observedAt,createdAt,optionCount,optionId:value.optionId,docId:value.docId,qvtRequestId:value.receipt.qvtRequestId,state:value.receipt.state,sourceStatus:value.receipt.sourceStatus};
}
export function isSingleReceiptSummary(value:unknown):value is SingleReceiptSummary{
  return exact(value,['format','evidence','registered','label','company','fingerprint','categoryId','observedAt','createdAt','optionCount','optionId','docId','qvtRequestId','state','sourceStatus'])
    &&value.format==='yoofam-single-receipt-summary-v1'&&value.evidence==='chrome-observation'&&value.registered===false&&typeof value.sourceStatus==='string'
    &&Object.hasOwn(STATES,value.sourceStatus)&&value.state===STATES[value.sourceStatus]&&value.label===LABELS[value.state as NativeSingleReceipt['state']]
    &&company(value.company)&&hash(value.fingerprint)&&typeof value.categoryId==='string'&&/^\d{1,20}$/.test(value.categoryId)&&value.categoryId!=='0'
    &&Number.isSafeInteger(value.observedAt)&&Number(value.observedAt)>0&&Number(value.observedAt)<=Date.now()+5000&&iso(value.createdAt)&&Date.parse(value.createdAt)<=Date.now()+5000
    &&Number.isSafeInteger(value.optionCount)&&Number(value.optionCount)>0&&Number(value.optionCount)<=200
    &&id(value.optionId)&&identifier(value.docId)&&identifier(value.qvtRequestId);
}
