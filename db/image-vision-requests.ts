import {env} from 'cloudflare:workers';
import type {ImageTextVisionResult} from '@/app/image-text-vision';
export const imageVisionRequestsSchema=`CREATE TABLE IF NOT EXISTS image_vision_requests (
 owner_id TEXT NOT NULL, product_id TEXT NOT NULL REFERENCES products(id), request_id TEXT NOT NULL,
 company_code TEXT NOT NULL, company_name TEXT NOT NULL, model TEXT NOT NULL,
 request_fingerprint TEXT NOT NULL, source_scope TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('running','completed','failed','uncertain')),
 result TEXT, failure TEXT, provider_requests INTEGER CHECK(provider_requests IN (0,1)), created_at TEXT NOT NULL, finished_at TEXT,
 PRIMARY KEY(owner_id,product_id,request_id)
)`;
const activeIndex="CREATE UNIQUE INDEX IF NOT EXISTS image_vision_requests_active ON image_vision_requests(owner_id,product_id,source_scope) WHERE status IN ('running','uncertain')";
type Scope={owner:string;productId:string;requestId:string;company:{code:string;name:string};member:{email:string;role:string};model:string;fingerprint:string;sourceScope:string;productVersion:string;contentRevision:number};
type Row={status:'running'|'completed'|'failed'|'uncertain';request_fingerprint:string;result:string|null;failure:string|null};
const ready=new WeakSet<object>();
async function database(){const db=env.DB;if(!db)throw Error('Image Vision store unavailable');if(!ready.has(db)){await db.batch([db.prepare(imageVisionRequestsSchema),db.prepare(activeIndex)]);ready.add(db);}return db;}
const membership="EXISTS(SELECT 1 FROM members m WHERE m.id=? AND lower(trim(m.email))=? AND m.role=? AND m.status='approved' AND m.company_code=? AND m.company_name=?)";
const memberArgs=(scope:Scope)=>[scope.owner,scope.member.email,scope.member.role,scope.company.code,scope.company.name];
async function record(db:Awaited<ReturnType<typeof database>>,scope:Scope){return db.prepare('SELECT status,request_fingerprint,result,failure FROM image_vision_requests WHERE owner_id=? AND product_id=? AND request_id=? AND company_code=? AND company_name=? AND model=?')
 .bind(scope.owner,scope.productId,scope.requestId,scope.company.code,scope.company.name,scope.model).first<Row>();}
/** A historical observation never initializes storage, claims a request or
 * changes an uncertain row. Full original source/config fingerprints bind it. */
export async function readImageVisionRequest(scope:Scope):Promise<Row|null>{
 const db=env.DB;if(!db)throw Error('Image Vision store unavailable');
 return db.prepare(`SELECT status,request_fingerprint,result,failure FROM image_vision_requests r WHERE r.owner_id=? AND r.product_id=? AND r.request_id=?
 AND r.company_code=? AND r.company_name=? AND r.model=? AND r.request_fingerprint=? AND r.source_scope=? AND ${membership}
 AND EXISTS(SELECT 1 FROM products p WHERE p.id=r.product_id AND p.owner_id=r.owner_id)`)
 .bind(scope.owner,scope.productId,scope.requestId,scope.company.code,scope.company.name,scope.model,scope.fingerprint,scope.sourceScope,...memberArgs(scope)).first<Row>();
}
/** Claim precedes inference. Source bytes stay in R2; only bounded proposals live here. */
export async function claimImageVisionRequest(scope:Scope){
 const db=await database();
 const row=await db.prepare(`INSERT INTO image_vision_requests(owner_id,product_id,request_id,company_code,company_name,model,request_fingerprint,source_scope,status,created_at)
 SELECT ?,?,?,?,?,?,?,?,'running',? FROM products p WHERE p.id=? AND p.owner_id=? AND p.updated_at=?
 AND COALESCE((SELECT revision FROM product_content c WHERE c.product_id=p.id AND c.owner_id=p.owner_id),0)=? AND ${membership}
 AND NOT EXISTS(SELECT 1 FROM image_vision_requests r WHERE r.owner_id=p.owner_id AND r.product_id=p.id AND r.source_scope=? AND r.status IN ('running','uncertain'))
 ON CONFLICT(owner_id,product_id,request_id) DO NOTHING RETURNING status,request_fingerprint,result,failure`)
 .bind(scope.owner,scope.productId,scope.requestId,scope.company.code,scope.company.name,scope.model,scope.fingerprint,scope.sourceScope,new Date().toISOString(),scope.productId,scope.owner,scope.productVersion,scope.contentRevision,...memberArgs(scope),scope.sourceScope).first<Row>();
 return{claimed:!!row,record:row??await record(db,scope)};
}
/** A new request owns its claim before inspecting a completed artifact. No
 * running/uncertain operation can be bypassed by borrowing an earlier result. */
export async function completedImageVisionResult(scope:Scope){
 const db=await database();
 return db.prepare(`SELECT request_id,request_fingerprint,result FROM image_vision_requests WHERE owner_id=? AND product_id=? AND company_code=? AND company_name=? AND model=? AND source_scope=? AND status='completed' AND request_id<>? AND ${membership} ORDER BY finished_at DESC,created_at DESC,request_id DESC LIMIT 1`)
  .bind(scope.owner,scope.productId,scope.company.code,scope.company.name,scope.model,scope.sourceScope,scope.requestId,...memberArgs(scope)).first<{request_id:string;request_fingerprint:string;result:string|null}>();
}
export async function finishImageVisionRequest(scope:Scope,value:({status:'completed';result:ImageTextVisionResult}|{status:'failed'|'uncertain';failure:string})&{requests:0|1}){
 const db=await database(),result='result'in value?JSON.stringify(value.result):null;
 if(result&&new TextEncoder().encode(result).length>96*1024)throw Error('Image Vision result too large');
 const failure='failure'in value?value.failure:null;
 if(failure!==null&&!/^[A-Z_]{1,32}$/.test(failure))throw Error('Invalid Image Vision failure');
 if(value.requests!==0&&value.requests!==1)throw Error('Invalid Image Vision request count');
 const row=await db.prepare(`UPDATE image_vision_requests SET status=?,result=?,failure=?,provider_requests=?,finished_at=? WHERE owner_id=? AND product_id=? AND request_id=? AND company_code=? AND company_name=? AND model=? AND request_fingerprint=? AND source_scope=? AND status='running' AND ${membership} RETURNING status`)
 .bind(value.status,result,failure,value.requests,new Date().toISOString(),scope.owner,scope.productId,scope.requestId,scope.company.code,scope.company.name,scope.model,scope.fingerprint,scope.sourceScope,...memberArgs(scope)).first();
 if(!row)throw Error('Image Vision request changed');
}
/** Only a retained promise from this original provider invocation may finish
 * its existing claim. Terminal rows and all source/product content stay put. */
export async function finishLateImageVisionRequest(scope:Scope,value:{status:'completed';result:ImageTextVisionResult}|{status:'failed';failure:string}){
 const db=env.DB;if(!db)throw Error('Image Vision store unavailable');
 if(value.status!=='completed'&&value.status!=='failed'||value.status==='failed'&&(!('failure'in value)||typeof value.failure!=='string')
   ||value.status==='completed'&&(!('result'in value)||!value.result||typeof value.result!=='object'))throw Error('Invalid late Image Vision observation');
 const result='result'in value?JSON.stringify(value.result):null,failure='failure'in value?value.failure:null;
 if(result&&(new TextEncoder().encode(result).length>96*1024||value.status!=='completed'||!('result'in value)||value.result.requests!==1||value.result.model!==scope.model))throw Error('Invalid late Image Vision result');
 if(failure!==null&&!/^[A-Z_]{1,32}$/.test(failure))throw Error('Invalid late Image Vision failure');
 const row=await db.prepare(`UPDATE image_vision_requests SET status=?,result=?,failure=?,provider_requests=1,finished_at=?
 WHERE owner_id=? AND product_id=? AND request_id=? AND company_code=? AND company_name=? AND model=? AND request_fingerprint=? AND source_scope=?
 AND ((status='running' AND provider_requests IS NULL) OR (status='uncertain' AND provider_requests=1)) AND ${membership}
 AND EXISTS(SELECT 1 FROM products p WHERE p.id=image_vision_requests.product_id AND p.owner_id=image_vision_requests.owner_id) RETURNING status`)
 .bind(value.status,result,failure,new Date().toISOString(),scope.owner,scope.productId,scope.requestId,scope.company.code,scope.company.name,scope.model,scope.fingerprint,scope.sourceScope,...memberArgs(scope)).first();
 return!!row;
}
