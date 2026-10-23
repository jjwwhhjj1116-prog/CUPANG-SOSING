import {env} from 'cloudflare:workers';
import {validatePageSource,type PageSource} from '@/extensions/supplier-hub/page-source.mjs';
import {sourceInboxStatus,sourceInboxWarnings,type SourceInboxItem} from '@/app/source-inbox';
import type {SupplierHubCompany} from '@/app/supplier-hub-company';
export const sourceInboxSchema=`CREATE TABLE IF NOT EXISTS source_inbox (
 owner_id TEXT NOT NULL,id TEXT NOT NULL,company_code TEXT NOT NULL,company_name TEXT NOT NULL,
 offer_id TEXT NOT NULL,fingerprint TEXT NOT NULL,payload TEXT NOT NULL,review_payload TEXT,
 revision INTEGER NOT NULL DEFAULT 1,received_at TEXT NOT NULL,archived_at TEXT,
 PRIMARY KEY(owner_id,id),UNIQUE(owner_id,offer_id)
)`;
/** The original table stays unchanged. Each explicit recapture has a new,
 * immutable source ID; its separate review/archive revisions remain editable. */
export const sourceInboxCaptureSchema=`CREATE TABLE IF NOT EXISTS source_inbox_captures (
 owner_id TEXT NOT NULL,id TEXT NOT NULL,origin_id TEXT NOT NULL,
 company_code TEXT NOT NULL,company_name TEXT NOT NULL,offer_id TEXT NOT NULL,
 fingerprint TEXT NOT NULL,payload TEXT NOT NULL,review_payload TEXT,
 capture_version INTEGER NOT NULL CHECK(capture_version>=2),revision INTEGER NOT NULL DEFAULT 1,
 received_at TEXT NOT NULL,archived_at TEXT,
 PRIMARY KEY(owner_id,id),UNIQUE(owner_id,origin_id,capture_version),UNIQUE(owner_id,fingerprint),
 FOREIGN KEY(owner_id,origin_id) REFERENCES source_inbox(owner_id,id)
)`;
export const SOURCE_INBOX_ACTIVE_LIMIT=40,SOURCE_INBOX_RETENTION_LIMIT=200;
export class SourceInboxConflict extends Error{}
async function database(){if(!env.DB)throw Error('D1 unavailable');await env.DB.prepare(sourceInboxSchema).run();await env.DB.prepare(sourceInboxCaptureSchema).run();return env.DB;}
type Row={owner_id:string;id:string;company_code:string;company_name:string;offer_id:string;fingerprint:string;payload:string;review_payload:string|null;revision:number;received_at:string;archived_at:string|null;origin_id?:string;capture_version?:number};
const columns='owner_id,id,company_code,company_name,offer_id,fingerprint,payload,review_payload,revision,received_at,archived_at';
const allRows=`SELECT ${columns},id AS origin_id,1 AS capture_version FROM source_inbox UNION ALL SELECT ${columns},origin_id,capture_version FROM source_inbox_captures`;
const count=(owner:string,active=false)=>`(SELECT count(*) FROM source_inbox WHERE owner_id=${owner}${active?' AND archived_at IS NULL':''})+(SELECT count(*) FROM source_inbox_captures WHERE owner_id=${owner}${active?' AND archived_at IS NULL':''})`;
function decode(row:Row):SourceInboxItem{const snapshot=validatePageSource(JSON.parse(row.payload)),reviewed=row.review_payload?validatePageSource(JSON.parse(row.review_payload)):null;return {id:row.id,ownerId:row.owner_id,company:{code:row.company_code,name:row.company_name},fingerprint:row.fingerprint,snapshot,reviewed,revision:row.revision,receivedAt:row.received_at,archivedAt:row.archived_at,captureOriginId:row.origin_id??row.id,captureVersion:row.capture_version??1,issues:sourceInboxStatus(snapshot,reviewed),warnings:sourceInboxWarnings(snapshot,reviewed)};}
export async function listSourceInbox(owner:string,company:SupplierHubCompany){const db=await database();const result=await db.prepare(`SELECT * FROM (${allRows}) WHERE owner_id=? AND company_code=? AND company_name=? AND archived_at IS NULL ORDER BY received_at DESC,capture_version DESC,id DESC LIMIT 40`).bind(owner,company.code,company.name).all<Row>();return result.results.map(decode);}
export async function readSourceInbox(owner:string,id:string){const db=await database(),rows=await db.prepare(`SELECT * FROM (${allRows}) WHERE owner_id=? AND id=? LIMIT 2`).bind(owner,id).all<Row>();if(rows.results.length>1)throw new SourceInboxConflict('수집 요청 ID가 중복되었습니다. 원문을 변경하지 않았습니다.');return rows.results[0]?decode(rows.results[0]):null;}
/** URL-only intake chooses the latest explicit capture version. It never
 * changes an already pinned capture ID or a stored collection-job receipt. */
export async function findSourceInbox(owner:string,offer:string){const db=await database(),row=await db.prepare(`SELECT * FROM (${allRows}) WHERE owner_id=? AND offer_id=? ORDER BY capture_version DESC LIMIT 1`).bind(owner,offer).first<Row>();return row?decode(row):null;}
export async function storeSourceInbox(owner:string,company:SupplierHubCompany,id:string,fingerprint:string,snapshot:PageSource):Promise<{item:SourceInboxItem;duplicate:boolean}|null>{
 const db=await database(),payload=JSON.stringify(snapshot),now=new Date().toISOString();
 const valid=(item:SourceInboxItem)=>{if(item.company.code!==company.code||item.company.name!==company.name||item.snapshot.offerId!==snapshot.offerId||item.fingerprint!==fingerprint||JSON.stringify(item.snapshot)!==payload)throw new SourceInboxConflict('같은 수집 요청 ID에 다른 원문 또는 회사가 있습니다. 기존 원문은 유지됩니다.');return item;};
 const prior=await readSourceInbox(owner,id);if(prior)return {item:valid(prior),duplicate:true};
 const duplicate=async()=>{const row=await db.prepare(`SELECT * FROM (${allRows}) WHERE owner_id=? AND fingerprint=? LIMIT 1`).bind(owner,fingerprint).first<Row>();return row?valid(decode(row)):null;};
 const same=await duplicate();if(same)return {item:same,duplicate:true};
 await db.prepare(`INSERT INTO source_inbox(owner_id,id,company_code,company_name,offer_id,fingerprint,payload,received_at)
  SELECT ?,?,?,?,?,?,?,? WHERE ${count('?',true)}<40 AND ${count('?')}<200
   AND NOT EXISTS(SELECT 1 FROM source_inbox_captures WHERE owner_id=? AND id=?) ON CONFLICT DO NOTHING`)
  .bind(owner,id,company.code,company.name,snapshot.offerId,fingerprint,payload,now,owner,owner,owner,owner,owner,id).run();
 const first=await readSourceInbox(owner,id);if(first)return {item:valid(first),duplicate:false};
 // A concurrent first capture may have established the immutable origin.
 const base=await db.prepare('SELECT * FROM source_inbox WHERE owner_id=? AND offer_id=?').bind(owner,snapshot.offerId).first<Row>();
 if(base){
  if(base.company_code!==company.code||base.company_name!==company.name)throw new SourceInboxConflict('같은 상품의 원래 수집 회사와 현재 회사가 다릅니다.');
  await db.prepare(`INSERT INTO source_inbox_captures(owner_id,id,origin_id,company_code,company_name,offer_id,fingerprint,payload,capture_version,received_at)
   SELECT b.owner_id,?,b.id,b.company_code,b.company_name,b.offer_id,?,?,
    COALESCE((SELECT max(capture_version) FROM source_inbox_captures WHERE owner_id=b.owner_id AND origin_id=b.id),1)+1,?
   FROM source_inbox b WHERE b.owner_id=? AND b.id=? AND b.offer_id=? AND b.company_code=? AND b.company_name=?
    AND ${count('b.owner_id',true)}<40 AND ${count('b.owner_id')}<200
    AND NOT EXISTS(SELECT 1 FROM source_inbox WHERE owner_id=b.owner_id AND (id=? OR fingerprint=?))
   ON CONFLICT DO NOTHING`).bind(id,fingerprint,payload,now,owner,base.id,snapshot.offerId,company.code,company.name,id,fingerprint).run();
 }
 const captured=await readSourceInbox(owner,id);if(captured)return {item:valid(captured),duplicate:false};
 const concurrent=await duplicate();return concurrent?{item:concurrent,duplicate:true}:null;
}
const table=(item:SourceInboxItem)=>item.captureVersion===1?'source_inbox':'source_inbox_captures';
export async function reviewSourceInbox(owner:string,id:string,expectedRevision:number,reviewed:PageSource){const db=await database(),item=await readSourceInbox(owner,id);if(!item)return null;const row=await db.prepare(`UPDATE ${table(item)} SET review_payload=?,revision=revision+1 WHERE owner_id=? AND id=? AND revision=? RETURNING *`).bind(JSON.stringify(reviewed),owner,id,expectedRevision).first<Row>();return row?decode(row):null;}
export type SourceInboxArchiveFence={item:SourceInboxItem;member:{id:string;email:string;role:'admin'|'member'}};
/** Excluding a row retains its immutable original and reviews. A browser-bound
 * archive additionally fences the exact selected version and current member. */
export async function archiveSourceInbox(owner:string,id:string,expectedRevision:number,fence?:SourceInboxArchiveFence){
 const db=await database(),item=fence?.item??await readSourceInbox(owner,id);
 if(!item||item.ownerId!==owner||item.id!==id||item.revision!==expectedRevision||item.archivedAt||fence&&fence.member.id!==owner)return null;
 const member=fence?{sql:" AND EXISTS(SELECT 1 FROM members m WHERE m.id=? AND m.status='approved' AND lower(trim(m.email))=? AND m.role=? AND m.company_code=? AND m.company_name=?)",args:[owner,fence.member.email.trim().toLowerCase(),fence.member.role,item.company.code,item.company.name]}:{sql:'',args:[]};
 const row=await db.prepare(`UPDATE ${table(item)} SET archived_at=?,revision=revision+1 WHERE owner_id=? AND id=? AND revision=? AND archived_at IS NULL
  AND company_code=? AND company_name=? AND offer_id=? AND fingerprint=? AND payload=? AND review_payload IS ? AND received_at=?${member.sql} RETURNING *`)
  .bind(new Date().toISOString(),owner,id,expectedRevision,item.company.code,item.company.name,item.snapshot.offerId,item.fingerprint,JSON.stringify(item.snapshot),item.reviewed?JSON.stringify(item.reviewed):null,item.receivedAt,...member.args).first<Row>();
 return row?decode(row):null;
}
export async function restoreSourceInbox(owner:string,id:string,expectedRevision?:number){const db=await database(),item=await readSourceInbox(owner,id);if(!item)return null;if(!item.archivedAt)return item;
 const row=await db.prepare(`UPDATE ${table(item)} SET archived_at=NULL,revision=revision+1 WHERE owner_id=? AND id=? AND revision=? AND archived_at IS NOT NULL AND ${count('?',true)}<40 RETURNING *`).bind(owner,id,expectedRevision??item.revision,owner,owner).first<Row>();return row?decode(row):null;}
