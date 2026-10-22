import {env} from 'cloudflare:workers';
import {normalizeQuerySourceCapture,querySourceFingerprint,type QuerySourceCapture,type QuerySourceCaptureSummary} from '@/app/query-source-capture';
import {supplierHubCompany,type SupplierHubCompany} from '@/app/supplier-hub-company';

export const querySourceCaptureSchema=`CREATE TABLE IF NOT EXISTS query_source_captures (
 owner_id TEXT NOT NULL,id TEXT NOT NULL,company_code TEXT NOT NULL,company_name TEXT NOT NULL,
 offer_id TEXT NOT NULL,fingerprint TEXT NOT NULL,payload TEXT NOT NULL CHECK(json_valid(payload)),
 capture_version INTEGER NOT NULL CHECK(capture_version>=1),revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>=1),
 received_at TEXT NOT NULL,archived_at TEXT,
 PRIMARY KEY(owner_id,id),UNIQUE(owner_id,fingerprint),UNIQUE(owner_id,offer_id,capture_version)
)`;
export const QUERY_SOURCE_CAPTURE_ACTIVE_LIMIT=40,QUERY_SOURCE_CAPTURE_RETENTION_LIMIT=200;
export class QuerySourceCaptureConflict extends Error{}
async function database(){if(!env.DB)throw Error('D1 unavailable');await env.DB.prepare(querySourceCaptureSchema).run();return env.DB;}
type Row={owner_id:string;id:string;company_code:string;company_name:string;offer_id:string;fingerprint:string;payload:string;capture_version:number;revision:number;received_at:string;archived_at:string|null};
type SummaryRow=Omit<Row,'payload'>&{source_url:string;title:string;option_count:number;thumbnail_url:string|null};
const columns='owner_id,id,company_code,company_name,offer_id,fingerprint,capture_version,revision,received_at,archived_at';
function metadata(row:Omit<Row,'payload'>){return {id:row.id,ownerId:row.owner_id,company:{code:row.company_code,name:row.company_name},fingerprint:row.fingerprint,captureVersion:row.capture_version,revision:row.revision,receivedAt:row.received_at,archivedAt:row.archived_at};}
function decode(row:Row):QuerySourceCapture{return {...metadata(row),snapshot:normalizeQuerySourceCapture(JSON.parse(row.payload),row.offer_id)};}
function identity(owner:string,id?:string){if(typeof owner!=='string'||!owner.trim()||owner.length>300||/[\u0000-\u001f]/.test(owner)||id!==undefined&&!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id))throw new QuerySourceCaptureConflict('수집 원문의 소유자와 요청 ID를 확인해주세요.');}
function companyScope(company:SupplierHubCompany){const valid=supplierHubCompany(company?.code,company?.name);if(!valid||valid.code!==company.code||valid.name!==company.name)throw new QuerySourceCaptureConflict('승인된 수집 회사를 확인해주세요.');return valid;}

/** List bounded summaries only; 40 full 512KiB receipts must not enter the list
 * response or server-rendered component payload. */
export async function listQuerySourceCaptures(owner:string,company:SupplierHubCompany,{archived=false}:{archived?:boolean}={}):Promise<QuerySourceCaptureSummary[]>{
 identity(owner);companyScope(company);const db=await database();
 const rows=await db.prepare(`SELECT ${columns},json_extract(payload,'$.sourceUrl') AS source_url,json_extract(payload,'$.title') AS title,
  json_array_length(payload,'$.options') AS option_count,
  COALESCE((SELECT json_extract(value,'$.url') FROM json_each(payload,'$.images') WHERE json_extract(value,'$.role')='main' LIMIT 1),json_extract(payload,'$.images[0].url')) AS thumbnail_url
  FROM query_source_captures WHERE owner_id=? AND company_code=? AND company_name=? AND archived_at IS ${archived?'NOT ':''}NULL ORDER BY received_at DESC,capture_version DESC,id DESC LIMIT ${archived?200:40}`).bind(owner,company.code,company.name).all<SummaryRow>();
 return rows.results.map(row=>({...metadata(row),sourceUrl:row.source_url,offerId:row.offer_id,title:row.title,optionCount:row.option_count,thumbnailUrl:row.thumbnail_url}));
}
export async function readQuerySourceCapture(owner:string,id:string,company?:SupplierHubCompany):Promise<QuerySourceCapture|null>{
 identity(owner,id);if(company)companyScope(company);const db=await database();
 const query=db.prepare(`SELECT * FROM query_source_captures WHERE owner_id=? AND id=?${company?' AND company_code=? AND company_name=?':''}`);
 const row=await (company?query.bind(owner,id,company.code,company.name):query.bind(owner,id)).first<Row>();return row?decode(row):null;
}
/** The only caller supplies a fresh server-query result. Both normalization
 * and its digest are rechecked here; an API must never accept raw client JSON. */
export async function storeQuerySourceCapture(owner:string,company:SupplierHubCompany,id:string,fingerprint:string,source:unknown):Promise<{item:QuerySourceCapture;duplicate:boolean}|null>{
 identity(owner,id);companyScope(company);const snapshot=normalizeQuerySourceCapture(source),digest=await querySourceFingerprint(snapshot);
 if(fingerprint!==digest)throw new QuerySourceCaptureConflict('수집 원문 지문이 다릅니다. 원문을 저장하지 않았습니다.');
 const db=await database(),payload=JSON.stringify(snapshot),now=new Date().toISOString();
 const valid=(item:QuerySourceCapture)=>{if(item.company.code!==company.code||item.company.name!==company.name||item.fingerprint!==digest||JSON.stringify(item.snapshot)!==payload)throw new QuerySourceCaptureConflict('같은 수집 요청에 다른 원문 또는 회사가 있습니다. 기존 원문은 유지됩니다.');return item;};
 const previous=await readQuerySourceCapture(owner,id);if(previous)return {item:valid(previous),duplicate:true};
 const duplicate=async()=>{const row=await db.prepare('SELECT * FROM query_source_captures WHERE owner_id=? AND fingerprint=?').bind(owner,digest).first<Row>();return row?valid(decode(row)):null;};
 const same=await duplicate();if(same)return {item:same,duplicate:true};
 await db.prepare(`INSERT INTO query_source_captures(owner_id,id,company_code,company_name,offer_id,fingerprint,payload,capture_version,received_at)
  SELECT ?,?,?,?,?,?,?,COALESCE((SELECT max(capture_version) FROM query_source_captures WHERE owner_id=? AND offer_id=?),0)+1,?
  WHERE (SELECT count(*) FROM query_source_captures WHERE owner_id=? AND archived_at IS NULL)<40
   AND (SELECT count(*) FROM query_source_captures WHERE owner_id=?)<200 ON CONFLICT DO NOTHING`)
  .bind(owner,id,company.code,company.name,snapshot.offerId,digest,payload,owner,snapshot.offerId,now,owner,owner).run();
 const inserted=await readQuerySourceCapture(owner,id);if(inserted)return {item:valid(inserted),duplicate:false};
 const concurrent=await duplicate();return concurrent?{item:concurrent,duplicate:true}:null;
}
/** Archive changes only this row's visibility/revision; source bytes and all
 * product, source-inbox, review and submission records remain untouched. */
export async function archiveQuerySourceCapture(owner:string,id:string,expectedRevision:number,company?:SupplierHubCompany):Promise<QuerySourceCapture|null>{
 identity(owner,id);if(company)companyScope(company);if(!Number.isSafeInteger(expectedRevision)||expectedRevision<1)throw new QuerySourceCaptureConflict('수집 원문 버전을 확인해주세요.');
 const db=await database(),query=db.prepare(`UPDATE query_source_captures SET archived_at=?,revision=revision+1 WHERE owner_id=? AND id=? AND revision=? AND archived_at IS NULL${company?' AND company_code=? AND company_name=?':''} RETURNING *`);
 const args:[string,string,string,number]=[new Date().toISOString(),owner,id,expectedRevision];const row=await(company?query.bind(...args,company.code,company.name):query.bind(...args)).first<Row>();return row?decode(row):null;
}
/** Restore only an exact archived version when the owner's active capacity is
 * available. No source bytes or existing selections are changed in place. */
export async function restoreQuerySourceCapture(owner:string,id:string,expectedRevision:number,company?:SupplierHubCompany):Promise<QuerySourceCapture|null>{
 identity(owner,id);if(company)companyScope(company);if(!Number.isSafeInteger(expectedRevision)||expectedRevision<1)throw new QuerySourceCaptureConflict('수집 원문 버전을 확인해주세요.');
 const db=await database(),query=db.prepare(`UPDATE query_source_captures SET archived_at=NULL,revision=revision+1 WHERE owner_id=? AND id=? AND revision=? AND archived_at IS NOT NULL${company?' AND company_code=? AND company_name=?':''}
  AND (SELECT count(*) FROM query_source_captures WHERE owner_id=? AND archived_at IS NULL)<40 RETURNING *`);
 const row=await(company?query.bind(owner,id,expectedRevision,company.code,company.name,owner):query.bind(owner,id,expectedRevision,owner)).first<Row>();return row?decode(row):null;
}
