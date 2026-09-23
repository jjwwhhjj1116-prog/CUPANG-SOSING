import { env } from 'cloudflare:workers';
import type { CollectionResult } from '@/app/collection-result';
export const collectionResultSchema=`CREATE TABLE IF NOT EXISTS collection_results (
 job_id TEXT PRIMARY KEY REFERENCES collection_jobs(id), owner_id TEXT NOT NULL,
 payload TEXT NOT NULL, received_at TEXT NOT NULL
)`;
async function database(){if(!env.DB)throw new Error('D1 unavailable');await env.DB.prepare(collectionResultSchema).run();return env.DB;}
type Row={payload:string;received_at:string};
export async function readCollectionResult(owner:string,id:string){
 const db=await database();const row=await db.prepare('SELECT payload,received_at FROM collection_results WHERE owner_id=? AND job_id=?').bind(owner,id).first<Row>();
 return row?{result:JSON.parse(row.payload) as CollectionResult,receivedAt:row.received_at}:null;
}
export async function storeCollectionResult(owner:string,id:string,result:CollectionResult){
 const db=await database();const payload=JSON.stringify(result);
 // A unique job result makes retries harmless. Never overwrite a different result.
 await db.prepare(`INSERT INTO collection_results(job_id,owner_id,payload,received_at)
 SELECT id,owner_id,?,? FROM collection_jobs WHERE id=? AND owner_id=? AND status='awaiting_connector'
 ON CONFLICT(job_id) DO NOTHING`).bind(payload,new Date().toISOString(),id,owner).run();
 const saved=await readCollectionResult(owner,id);
 if(!saved)return {status:'cancelled' as const};
 return JSON.stringify(saved.result)===payload?{status:'stored' as const,...saved}:{status:'conflict' as const};
}
