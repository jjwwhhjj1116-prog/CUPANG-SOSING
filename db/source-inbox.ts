import {env} from 'cloudflare:workers';
import {validatePageSource,type PageSource} from '@/extensions/supplier-hub/page-source.mjs';
import {sourceInboxStatus,type SourceInboxItem} from '@/app/source-inbox';
import type {SupplierHubCompany} from '@/app/supplier-hub-company';
export const sourceInboxSchema=`CREATE TABLE IF NOT EXISTS source_inbox (
 owner_id TEXT NOT NULL,id TEXT NOT NULL,company_code TEXT NOT NULL,company_name TEXT NOT NULL,
 offer_id TEXT NOT NULL,fingerprint TEXT NOT NULL,payload TEXT NOT NULL,review_payload TEXT,
 revision INTEGER NOT NULL DEFAULT 1,received_at TEXT NOT NULL,archived_at TEXT,
 PRIMARY KEY(owner_id,id),UNIQUE(owner_id,offer_id)
)`;
async function database(){if(!env.DB)throw Error('D1 unavailable');await env.DB.prepare(sourceInboxSchema).run();return env.DB;}
type Row={owner_id:string;id:string;company_code:string;company_name:string;offer_id:string;fingerprint:string;payload:string;review_payload:string|null;revision:number;received_at:string;archived_at:string|null};
function decode(row:Row):SourceInboxItem{const snapshot=validatePageSource(JSON.parse(row.payload)),reviewed=row.review_payload?validatePageSource(JSON.parse(row.review_payload)):null;return {id:row.id,ownerId:row.owner_id,company:{code:row.company_code,name:row.company_name},fingerprint:row.fingerprint,snapshot,reviewed,revision:row.revision,receivedAt:row.received_at,archivedAt:row.archived_at,issues:sourceInboxStatus(snapshot,reviewed)};}
export async function listSourceInbox(owner:string,company:SupplierHubCompany){const db=await database();const result=await db.prepare('SELECT * FROM source_inbox WHERE owner_id=? AND company_code=? AND company_name=? AND archived_at IS NULL ORDER BY received_at DESC LIMIT 40').bind(owner,company.code,company.name).all<Row>();return result.results.map(decode);}
export async function readSourceInbox(owner:string,id:string){const db=await database(),row=await db.prepare('SELECT * FROM source_inbox WHERE owner_id=? AND id=?').bind(owner,id).first<Row>();return row?decode(row):null;}
export async function findSourceInbox(owner:string,offer:string){const db=await database(),row=await db.prepare('SELECT * FROM source_inbox WHERE owner_id=? AND offer_id=?').bind(owner,offer).first<Row>();return row?decode(row):null;}
export async function storeSourceInbox(owner:string,company:SupplierHubCompany,id:string,fingerprint:string,snapshot:PageSource){
 const db=await database();
 await db.prepare('INSERT INTO source_inbox(owner_id,id,company_code,company_name,offer_id,fingerprint,payload,received_at) SELECT ?,?,?,?,?,?,?,? WHERE (SELECT count(*) FROM source_inbox WHERE owner_id=? AND archived_at IS NULL)<40 ON CONFLICT DO NOTHING').bind(owner,id,company.code,company.name,snapshot.offerId,fingerprint,JSON.stringify(snapshot),new Date().toISOString(),owner).run();
 return readSourceInbox(owner,id);
}
export async function reviewSourceInbox(owner:string,id:string,expectedRevision:number,reviewed:PageSource){const db=await database();const row=await db.prepare('UPDATE source_inbox SET review_payload=?,revision=revision+1 WHERE owner_id=? AND id=? AND revision=? RETURNING *').bind(JSON.stringify(reviewed),owner,id,expectedRevision).first<Row>();return row?decode(row):null;}
export async function archiveSourceInbox(owner:string,id:string,expectedRevision:number){const db=await database();const row=await db.prepare('UPDATE source_inbox SET archived_at=?,revision=revision+1 WHERE owner_id=? AND id=? AND revision=? AND archived_at IS NULL RETURNING *').bind(new Date().toISOString(),owner,id,expectedRevision).first<Row>();return row?decode(row):null;}
export async function restoreSourceInbox(owner:string,id:string){const db=await database();const row=await db.prepare('UPDATE source_inbox SET archived_at=NULL,revision=revision+1 WHERE owner_id=? AND id=? AND archived_at IS NOT NULL AND (SELECT count(*) FROM source_inbox WHERE owner_id=? AND archived_at IS NULL)<40 RETURNING *').bind(owner,id,owner).first<Row>();return row?decode(row):null;}
