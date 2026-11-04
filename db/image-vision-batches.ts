import {env} from 'cloudflare:workers';
import type {FreeImageVisionAttempt} from '@/app/free-image-vision-error';
import type {claimImageVisionRequest} from '@/db/image-vision-requests';

export type ImageVisionBatchScope=Parameters<typeof claimImageVisionRequest>[0];
export type ImageVisionBatchActor=Pick<ImageVisionBatchScope,'owner'|'productId'|'company'|'member'|'model'>;
export const imageVisionBatchesSchema=`CREATE TABLE IF NOT EXISTS image_vision_batches (
 owner_id TEXT NOT NULL, product_id TEXT NOT NULL REFERENCES products(id), request_id TEXT NOT NULL,
 company_code TEXT NOT NULL, company_name TEXT NOT NULL, member_email TEXT NOT NULL, member_role TEXT NOT NULL, model TEXT NOT NULL,
 request_fingerprint TEXT NOT NULL, source_scope TEXT NOT NULL, attempt TEXT NOT NULL,
 provider_request_id TEXT, status TEXT NOT NULL CHECK(status IN ('running','uncertain')),
 failure TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
 PRIMARY KEY(owner_id,product_id,request_id)
)`;
export type ImageVisionBatchRow={request_id:string;request_fingerprint:string;source_scope:string;attempt:string;provider_request_id:string|null;
 status:'running'|'completed'|'failed'|'uncertain';result:string|null;failure:string|null};
const ready=new WeakSet<object>();
const membership="EXISTS(SELECT 1 FROM members m WHERE m.id=? AND lower(trim(m.email))=? AND m.role=? AND m.status='approved' AND m.company_code=? AND m.company_name=?)";
const args=(s:ImageVisionBatchActor)=>[s.owner,s.productId,s.company.code,s.company.name,s.member.email,s.member.role,s.model];
const memberArgs=(s:ImageVisionBatchActor)=>[s.owner,s.member.email,s.member.role,s.company.code,s.company.name];
async function database(){const db=env.DB;if(!db)throw Error('Image Vision batch store unavailable');if(!ready.has(db)){await db.batch([db.prepare(imageVisionBatchesSchema)]);ready.add(db);}return db;}
// The original claim owns terminal results. Joining it also recovers a lost
// batch-update acknowledgement without mutating anything during a status GET.
const select=`SELECT b.request_id,b.request_fingerprint,b.source_scope,b.attempt,b.provider_request_id,
 CASE WHEN r.status IN ('completed','failed') THEN r.status WHEN r.status='uncertain' OR b.status='uncertain' THEN 'uncertain' ELSE 'running' END AS status,
 r.result,CASE WHEN r.status IN ('completed','failed') THEN r.failure ELSE COALESCE(b.failure,r.failure) END AS failure
 FROM image_vision_batches b JOIN image_vision_requests r ON r.owner_id=b.owner_id AND r.product_id=b.product_id AND r.request_id=b.request_id
 AND r.company_code=b.company_code AND r.company_name=b.company_name AND r.model=b.model AND r.request_fingerprint=b.request_fingerprint AND r.source_scope=b.source_scope
 WHERE b.owner_id=? AND b.product_id=? AND b.company_code=? AND b.company_name=? AND b.member_email=? AND b.member_role=? AND b.model=?`;
const approval=` AND ${membership} AND EXISTS(SELECT 1 FROM products p WHERE p.id=b.product_id AND p.owner_id=b.owner_id)`;
async function read(actor:ImageVisionBatchActor,filter:string,values:unknown[]){
 const db=env.DB;if(!db)throw Error('Image Vision batch store unavailable');
 try{return await db.prepare(select+filter+approval+' ORDER BY b.created_at DESC,b.request_id DESC LIMIT 1').bind(...args(actor),...values,...memberArgs(actor)).first<ImageVisionBatchRow>();}
 catch(error){if(error instanceof Error&&/no such table: (?:image_vision_batches|image_vision_requests)\b/i.test(error.message))return null;throw error;}
}
/** Historical reads never initialize storage, claim, poll or inspect R2. */
export async function readImageVisionBatch(actor:ImageVisionBatchActor,requestId:string){return read(actor,' AND b.request_id=?',[requestId]);}
export async function findPendingImageVisionBatch(actor:ImageVisionBatchActor,sourceScope:string){return read(actor," AND b.source_scope=? AND r.status IN ('running','uncertain')",[sourceScope]);}
/** Persist the immutable descriptor after admission and before invoking AI. */
export async function storeImageVisionBatch(scope:ImageVisionBatchScope,attempt:FreeImageVisionAttempt){
 const descriptor=JSON.stringify(attempt);
 if(attempt.requestId!==scope.requestId||new TextEncoder().encode(descriptor).length>48*1024)throw Error('Invalid Image Vision batch descriptor');
 const db=await database(),now=new Date().toISOString();
 const row=await db.prepare(`INSERT INTO image_vision_batches(owner_id,product_id,request_id,company_code,company_name,member_email,member_role,model,request_fingerprint,source_scope,attempt,status,created_at,updated_at)
 SELECT ?,?,?,?,?,?,?,?,?,?,?,'running',?,? FROM image_vision_requests r WHERE r.owner_id=? AND r.product_id=? AND r.request_id=?
 AND r.company_code=? AND r.company_name=? AND r.model=? AND r.request_fingerprint=? AND r.source_scope=? AND r.status='running' AND r.provider_requests IS NULL
 AND ${membership} ON CONFLICT(owner_id,product_id,request_id) DO NOTHING RETURNING request_id`)
 .bind(...args(scope).slice(0,2),scope.requestId,...args(scope).slice(2),scope.fingerprint,scope.sourceScope,descriptor,now,now,
 scope.owner,scope.productId,scope.requestId,scope.company.code,scope.company.name,scope.model,scope.fingerprint,scope.sourceScope,...memberArgs(scope)).first();
 if(!row)throw Error('Image Vision batch descriptor changed');
}
export async function saveImageVisionBatchProvider(scope:ImageVisionBatchScope,providerRequestId:string){
 if(typeof providerRequestId!=='string'||!/^[A-Za-z0-9_-]{1,200}$/.test(providerRequestId))throw Error('Invalid Image Vision provider request');
 const db=await database();
 const row=await db.prepare(`UPDATE image_vision_batches SET provider_request_id=?,updated_at=? WHERE owner_id=? AND product_id=? AND request_id=?
 AND company_code=? AND company_name=? AND member_email=? AND member_role=? AND model=? AND request_fingerprint=? AND source_scope=?
 AND provider_request_id IS NULL AND ${membership} RETURNING request_id`)
 .bind(providerRequestId,new Date().toISOString(),scope.owner,scope.productId,scope.requestId,...args(scope).slice(2),scope.fingerprint,scope.sourceScope,...memberArgs(scope)).first();
 if(!row)throw Error('Image Vision provider request changed');
}
/** Transport uncertainty never erases a positively acknowledged provider ID. */
export async function markImageVisionBatchUncertain(scope:ImageVisionBatchScope,failure:string){
 if(!/^[A-Z_]{1,32}$/.test(failure))throw Error('Invalid Image Vision batch failure');
 const db=env.DB;if(!db)throw Error('Image Vision batch store unavailable');
 await db.prepare(`UPDATE image_vision_batches SET status='uncertain',failure=?,updated_at=? WHERE owner_id=? AND product_id=? AND request_id=?
 AND company_code=? AND company_name=? AND member_email=? AND member_role=? AND model=? AND request_fingerprint=? AND source_scope=? AND ${membership}
 AND EXISTS(SELECT 1 FROM image_vision_requests r WHERE r.owner_id=image_vision_batches.owner_id AND r.product_id=image_vision_batches.product_id AND r.request_id=image_vision_batches.request_id AND r.status IN ('running','uncertain'))`)
 .bind(failure,new Date().toISOString(),scope.owner,scope.productId,scope.requestId,...args(scope).slice(2),scope.fingerprint,scope.sourceScope,...memberArgs(scope)).run();
}
