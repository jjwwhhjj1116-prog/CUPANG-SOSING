import {env} from 'cloudflare:workers';
import {sourceGuard,type QuotationSourceGuard} from '@/db/quotation-fields';
import {matchesWorkspaceAccount,type WorkspaceMember} from '@/app/workspace-members';
import {parseStoredSingleReceipt,singleReceiptCanonical,SingleReceiptError,type SingleReceiptObservation,type SingleReceiptRecord} from '@/app/supplier-hub-single-receipt';
import {parseStoredNativeReceipt,nativeReceiptSummary,type NativeReceiptRecord,type NativeReceiptSummary,type ProductReceiptObservation,type ProductReceiptRecord} from '@/app/supplier-hub-product-receipt';

export type SingleReceiptMember=Pick<WorkspaceMember,'id'|'email'|'role'|'companyCode'|'companyName'>;
export const singleReceiptSchema=`CREATE TABLE IF NOT EXISTS supplier_hub_single_receipts (
  owner_id TEXT NOT NULL, product_id TEXT NOT NULL REFERENCES products(id), request_id TEXT NOT NULL,
  observed_at INTEGER NOT NULL, payload TEXT NOT NULL, created_at TEXT NOT NULL,
  PRIMARY KEY(owner_id,product_id,request_id)
)`;
export async function ensureSingleReceiptDatabase(){if(!env.DB)throw new SingleReceiptError('개별 문서 접수 DB 연결이 필요합니다.',503);await env.DB.prepare(singleReceiptSchema).run();return env.DB;}
type Row={owner_id:string;product_id:string;request_id:string;observed_at:number;payload:string;created_at:string};
const timestamp=(value:string)=>Number.isFinite(Date.parse(value))&&new Date(value).toISOString()===value;
function parsedRow(row:Row,owner:string,productId:string){
  const record=parseStoredNativeReceipt(row.payload);
  if(row.owner_id!==owner||row.product_id!==productId||record.productId!==productId||record.identity.ownerId!==owner||record.requestId!==row.request_id
    ||record.receipt.observedAt!==row.observed_at||!timestamp(row.created_at)||Date.parse(row.created_at)>Date.parse(record.recordedAt))
    throw new SingleReceiptError('개별 접수 이력의 회원·문서·저장 시각 연결이 다릅니다.');
  return record;
}
function memberGuard(owner:string,member:SingleReceiptMember|undefined,record:NativeReceiptRecord){
  if(!member||member.id!==owner||member.companyCode!==record.company.code||member.companyName!==record.company.name||!matchesWorkspaceAccount(member))return {sql:'0',args:[] as string[]};
  return {sql:"EXISTS(SELECT 1 FROM members m WHERE m.id=p.owner_id AND m.id=? AND m.email=? AND m.role=? AND m.status='approved' AND m.company_code=? AND m.company_name=?)",
    args:[member.id,member.email,member.role,member.companyCode,member.companyName]};
}
// The remaining canonical JSON includes exact native number/string ID types,
// request/option/source/body/identity digests and immutable company binding.
const immutable=(column:string)=>`json_remove(${column},'$.recordedAt','$.receipt.observedAt','$.receipt.state','$.receipt.sourceStatus','$.receipt.rejectionDetails')`;
/** Atomically retain a Chrome receipt without mutating any product/input.
 * A current approved member, exact source and quotation revision are required
 * inside BOTH the write and the idempotent fallback read. */
async function saveNativeReceipt(owner:string,productId:string,observation:SingleReceiptObservation|ProductReceiptObservation,source:QuotationSourceGuard,quotationRevision:number,member?:SingleReceiptMember):Promise<NativeReceiptRecord|null>{
  if(Object.hasOwn(observation,'recordedAt'))throw new SingleReceiptError('접수 기록의 저장 시각은 서버에서 정합니다.');
  const now=new Date().toISOString(),record=parseStoredNativeReceipt({...observation,recordedAt:now});
  const profileMatches=record.format==='yoofam-single-receipt-v1'
    ?source.profile?.id===record.profileId&&source.profile.revision===record.source.profileRevision
    :source.profile?source.profile.id===record.profileId&&source.profile.revision===record.source.profileRevision
      :record.requestedProfileId===null&&record.source.profileRevision===null;
  if(record.identity.ownerId!==owner||record.productId!==productId||record.source.productVersion!==source.productVersion||record.source.contentRevision!==source.contentRevision
    ||record.source.optionRevision!==source.optionRevision||record.source.quotationRevision!==quotationRevision||!profileMatches
    ||!Number.isSafeInteger(quotationRevision)||quotationRevision<0)return null;
  const db=await ensureSingleReceiptDatabase(),guard=sourceGuard(owner,productId,source),authorization=memberGuard(owner,member,record),payload=singleReceiptCanonical(record);
  const sql=`INSERT INTO supplier_hub_single_receipts(owner_id,product_id,request_id,observed_at,payload,created_at)
    SELECT p.owner_id,p.id,?,?,?,? FROM products p WHERE ${guard.sql}
      AND COALESCE((SELECT revision FROM product_quotation_fields WHERE product_id=p.id AND owner_id=p.owner_id),0)=? AND ${authorization.sql}
      AND NOT EXISTS(SELECT 1 FROM supplier_hub_single_receipts other WHERE other.owner_id=p.owner_id
        AND (other.product_id<>p.id AND other.request_id=? OR (other.request_id<>? OR other.product_id<>p.id)
          AND (json_extract(other.payload,'$.docId') IS json_extract(?,'$.docId') AND json_type(other.payload,'$.docId')=json_type(?,'$.docId')
            OR json_extract(other.payload,'$.receipt.qvtRequestId') IS json_extract(?,'$.receipt.qvtRequestId') AND json_type(other.payload,'$.receipt.qvtRequestId')=json_type(?,'$.receipt.qvtRequestId'))))
    ON CONFLICT(owner_id,product_id,request_id) DO UPDATE SET observed_at=excluded.observed_at,payload=excluded.payload
      WHERE excluded.observed_at>supplier_hub_single_receipts.observed_at
        AND ${immutable('supplier_hub_single_receipts.payload')}=${immutable('excluded.payload')}
        AND NOT(json_extract(supplier_hub_single_receipts.payload,'$.receipt.state')='accepted' AND json_extract(excluded.payload,'$.receipt.state')='pending')
        AND NOT(json_extract(supplier_hub_single_receipts.payload,'$.receipt.state')='rejected' AND json_extract(excluded.payload,'$.receipt.state')<>'rejected')
    RETURNING owner_id,product_id,request_id,observed_at,payload,created_at`;
  const saved=await db.prepare(sql).bind(record.requestId,record.receipt.observedAt,payload,now,...guard.args,quotationRevision,...authorization.args,
    record.requestId,record.requestId,payload,payload,payload,payload).first<Row>();
  if(saved)return parsedRow(saved,owner,productId);
  // Older/equal same-identity observations return the newer stored record;
  // neither a changed immutable value nor a later state regression is a save.
  const previous=await db.prepare(`SELECT r.owner_id,r.product_id,r.request_id,r.observed_at,r.payload,r.created_at FROM products p
    JOIN supplier_hub_single_receipts r ON r.owner_id=p.owner_id AND r.product_id=p.id WHERE ${guard.sql}
      AND COALESCE((SELECT revision FROM product_quotation_fields WHERE product_id=p.id AND owner_id=p.owner_id),0)=? AND ${authorization.sql}
      AND r.request_id=? AND r.observed_at>=? AND ${immutable('r.payload')}=${immutable('?')}`)
    .bind(...guard.args,quotationRevision,...authorization.args,record.requestId,record.receipt.observedAt,payload).first<Row>();
  return previous?parsedRow(previous,owner,productId):null;
}
export async function saveSingleReceipt(owner:string,productId:string,observation:SingleReceiptObservation,source:QuotationSourceGuard,quotationRevision:number,member?:SingleReceiptMember):Promise<SingleReceiptRecord|null>{
  parseStoredSingleReceipt({...observation,recordedAt:new Date().toISOString()});
  const result=await saveNativeReceipt(owner,productId,observation,source,quotationRevision,member);
  if(result&&result.format!=='yoofam-single-receipt-v1')throw new SingleReceiptError('기존 옵션 접수 형식과 저장 결과가 다릅니다.');return result;
}
export async function saveProductReceipt(owner:string,productId:string,observation:ProductReceiptObservation,source:QuotationSourceGuard,quotationRevision:number,member?:SingleReceiptMember):Promise<ProductReceiptRecord|null>{
  const candidate=parseStoredNativeReceipt({...observation,recordedAt:new Date().toISOString()});
  if(candidate.format!=='yoofam-product-document-receipt-v1')throw new SingleReceiptError('전체 상품 문서 접수 형식을 확인해주세요.');
  const result=await saveNativeReceipt(owner,productId,observation,source,quotationRevision,member);
  if(result&&result.format!=='yoofam-product-document-receipt-v1')throw new SingleReceiptError('전체 상품 접수 형식과 저장 결과가 다릅니다.');return result;
}
async function rowsFor(owner:string,productId:string,database?:Awaited<ReturnType<typeof ensureSingleReceiptDatabase>>){
  const db=database??await ensureSingleReceiptDatabase(),rows=await db.prepare(`SELECT owner_id,product_id,request_id,observed_at,payload,created_at FROM supplier_hub_single_receipts
    WHERE owner_id=? AND product_id=? ORDER BY rowid DESC LIMIT 201`).bind(owner,productId).all<Row>();
  if(!Array.isArray(rows.results)||rows.results.length>200)throw new SingleReceiptError('상품의 전체 개별 접수 이력 조회 범위를 초과했습니다.');
  return rows.results.map(row=>({row,record:parsedRow(row,owner,productId)}));
}
export async function readNativeReceiptHistory(owner:string,productId:string):Promise<NativeReceiptRecord[]>{return (await rowsFor(owner,productId)).map(value=>value.record);}
// Validate every native row before filtering. Unknown or malformed group data
// cannot silently disappear from an otherwise successful legacy history read.
export async function readSingleReceiptHistory(owner:string,productId:string):Promise<SingleReceiptRecord[]>{return (await readNativeReceiptHistory(owner,productId)).filter((record):record is SingleReceiptRecord=>record.format==='yoofam-single-receipt-v1');}
/** Server insertion order chooses the latest transmission. Re-observing an
 * old request cannot move it ahead of a later inserted option/document. */
export async function readSingleReceiptSummaries(owner:string,products:{id:string}[]):Promise<Record<string,NativeReceiptSummary|null>>{
  const result:Record<string,NativeReceiptSummary|null>={};
  if(!products.length)return result;let db:Awaited<ReturnType<typeof ensureSingleReceiptDatabase>>;
  try{db=await ensureSingleReceiptDatabase();}catch{for(const {id}of products)result[id]=null;return result;}
  for(const {id}of products){try{
    const values=await rowsFor(owner,id,db),latest=values[0];if(!latest)continue;
    const optionCount=new Set(values.filter(value=>value.record.format==='yoofam-single-receipt-v1'&&value.record.fingerprint===latest.record.fingerprint)
      .map(value=>(value.record as SingleReceiptRecord).optionId)).size;
    result[id]=nativeReceiptSummary(latest.record,latest.row.created_at,optionCount);
  }catch{result[id]=null;}}
  return result;
}
