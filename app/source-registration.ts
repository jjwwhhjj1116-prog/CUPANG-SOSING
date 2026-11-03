import type {SourceInboxItem} from '@/app/source-inbox';
import {sourceInboxDisplayTitle} from '@/app/source-inbox-title';
import type {QuerySourceCaptureSummary} from '@/app/query-source-capture';
import {supplierHubCompany,type SupplierHubCompany} from '@/app/supplier-hub-company';
import {sameSourceArchiveReference,type SourceArchiveReference} from '@/app/source-inbox-archive-client';
import {querySourceCaptureSelection,sourceCaptureSelection,sameSourceCaptureSelection} from '@/app/source-capture-selection';
import type {CollectionJob} from '@/app/sourcing';

export type QuerySourceRegistrationReference=SourceArchiveReference&{kind:'query'};
export type RegistrationSourceReference=SourceArchiveReference|QuerySourceRegistrationReference;
export const isQuerySourceReference=(value:RegistrationSourceReference):value is QuerySourceRegistrationReference=>'kind' in value&&value.kind==='query';
export const sameRegistrationSourceReference=(first:RegistrationSourceReference,second:RegistrationSourceReference|null|undefined)=>!!second&&isQuerySourceReference(first)===isQuerySourceReference(second)&&sameSourceArchiveReference(first,second);
export function querySourceRegistrationReference(item:QuerySourceCaptureSummary,ownerId?:string,company?:SupplierHubCompany|null):QuerySourceRegistrationReference|null{
 if(!ownerId||!company||!supplierHubCompany(company.code,company.name)||item.ownerId!==ownerId||item.company?.code!==company.code||item.company.name!==company.name||item.archivedAt!==null)return null;
 try{querySourceCaptureSelection(item);}catch{return null;}
 return{kind:'query',ownerId,company:{...company},id:item.id,fingerprint:item.fingerprint,sourceUrl:item.sourceUrl,revision:item.revision};
}
/** Bounded summaries retain their server-query identity and never impersonate PageSource. */
export function validateQueryRegistrationSummary(value:unknown,ownerId:string,company:SupplierHubCompany):QuerySourceCaptureSummary{
 const item=value as QuerySourceCaptureSummary;
 if(!item||typeof item!=='object'||Array.isArray(item)||!querySourceRegistrationReference(item,ownerId,company)
  ||!Number.isSafeInteger(item.captureVersion)||item.captureVersion<1||typeof item.receivedAt!=='string'||!Number.isFinite(Date.parse(item.receivedAt))
  ||typeof item.title!=='string'||!item.title.trim()||item.title.length>500||!Number.isSafeInteger(item.optionCount)||item.optionCount<1||item.optionCount>200
  ||typeof item.offerId!=='string'||new URL(item.sourceUrl).pathname!==`/offer/${item.offerId}.html`
  ||item.thumbnailUrl!==null&&(typeof item.thumbnailUrl!=='string'||!/^https:\/\/(?:[A-Za-z0-9-]+\.)*alicdn\.com\//u.test(item.thumbnailUrl)))throw Error('현재 회원·회사의 서버 수집본 정보를 확인하지 못했습니다.');
 return{id:item.id,ownerId,company:{...company},fingerprint:item.fingerprint,revision:item.revision,captureVersion:item.captureVersion,receivedAt:item.receivedAt,archivedAt:null,
  sourceUrl:item.sourceUrl,offerId:item.offerId,title:item.title,optionCount:item.optionCount,thumbnailUrl:item.thumbnailUrl};
}

export function sameSourceUrl(first:string,second:string){
 try{const a=new URL(first),b=new URL(second);return a.origin===b.origin&&a.pathname===b.pathname;}catch{return false;}
}
/** Hide only the immutable capture already represented by a currently listed product. */
export function sourceRegistrationHasProduct(item:SourceInboxItem|QuerySourceCaptureSummary,products:readonly {id:string;owner_id?:string;source_url:string}[],jobs:readonly CollectionJob[],ownerId?:string,company?:SupplierHubCompany|null):boolean{
 if(!ownerId||!company||!supplierHubCompany(company.code,company.name)||item.ownerId!==ownerId||item.company?.code!==company.code||item.company.name!==company.name||item.archivedAt!==null)return false;
 let selected;
 try{selected='snapshot' in item?sourceCaptureSelection(item):querySourceCaptureSelection(item);}catch{return false;}
 return jobs.some(job=>{
  const origin=job.context?.forkedFrom,capture=origin?.sourceCapture;
  if(job.status!=='awaiting_connector'||!job.product_id||origin?.kind!=='stored-source-new-draft-v1'||origin.requestId!==job.id
   ||job.context?.company?.code!==company.code||job.context.company.name!==company.name||job.source_url!==selected.sourceUrl
   ||capture?.captureId!==selected.captureId||capture.format!==selected.format||!sameSourceCaptureSelection(capture,selected))return false;
  return products.some(product=>product.id===job.product_id&&product.owner_id===ownerId&&product.source_url===selected.sourceUrl);
 });
}
/** A captured page is a list entry, not a priced/registered product. */
export function sourceRegistrationRows(items:SourceInboxItem[]){
 // A URL alone never identifies a consumed capture; archive remains explicit.
 return items.filter(item=>!item.archivedAt).map(item=>({
  id:`source:${item.id}`,source_capture:item,title:sourceInboxDisplayTitle(item),
  source_url:item.snapshot.sourceUrl,created_at:item.receivedAt,image_keys:'[]',
  options_count:(item.reviewed??item.snapshot).options.length,registration_status:'카테고리 대기',
  seo_status:'대기',quote_status:'대기',supply_price:null,sale_price:null,
 }));
}
export type SourceRegistration=ReturnType<typeof sourceRegistrationRows>[number];
export function querySourceRegistrationRows(items:QuerySourceCaptureSummary[]){
 return items.filter(item=>!item.archivedAt).map(item=>({id:`query:${item.id}`,query_source_capture:item,title:item.title,source_url:item.sourceUrl,created_at:item.receivedAt,image_keys:'[]',options_count:item.optionCount,
  registration_status:'카테고리 대기',seo_status:'대기',quote_status:'대기',supply_price:null,sale_price:null}));
}
export type QuerySourceRegistration=ReturnType<typeof querySourceRegistrationRows>[number];
