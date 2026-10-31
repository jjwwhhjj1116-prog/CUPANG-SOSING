import {env} from 'cloudflare:workers';
import {parseImageNoTextProof,type ImageNoTextProof} from '@/app/image-no-text-proof';
import {isVerifiedNoForeignText,parseImageTextVisionResult,type ImageTextVisionResult} from '@/app/image-text-vision';
import {imageVisionConfiguration,type ImageVisionEnvironment} from '@/app/automation/workers-image-vision';
import {isOwnedImageKey} from '@/app/image-files';
export const imageNoTextReceiptsSchema=`CREATE TABLE IF NOT EXISTS image_no_text_receipts (
 owner_id TEXT NOT NULL,product_id TEXT NOT NULL,request_id TEXT NOT NULL,request_fingerprint TEXT NOT NULL,source_scope TEXT NOT NULL,
 source_key TEXT NOT NULL,member_email TEXT NOT NULL,member_role TEXT NOT NULL,proof TEXT NOT NULL,
 PRIMARY KEY(owner_id,product_id,request_id),
 FOREIGN KEY(owner_id,product_id,request_id) REFERENCES image_vision_requests(owner_id,product_id,request_id)
)`;
export type NoTextReceiptScope={owner:string;productId:string;requestId:string;fingerprint:string;sourceScope:string;company:{code:string;name:string};member:{email:string;role:string};inspection?:Omit<ImageNoTextProof,'policy'|'productId'|'requestId'|'verifiedAt'>};
/** Called only after an existing provider ledger row completed. Neither a
 * client supplied result nor a legacy empty block array can create a receipt. */
export async function storeImageNoTextReceipt(scope:NoTextReceiptScope,result:ImageTextVisionResult){
 if(!scope.inspection||!isVerifiedNoForeignText(result)||!env.DB)return;
 const terminal=await env.DB.prepare("SELECT finished_at FROM image_vision_requests WHERE owner_id=? AND product_id=? AND request_id=? AND request_fingerprint=? AND source_scope=? AND status='completed' AND failure IS NULL")
  .bind(scope.owner,scope.productId,scope.requestId,scope.fingerprint,scope.sourceScope).first<{finished_at:string}>();
 const proof=parseImageNoTextProof({policy:result.inspection!.policy,productId:scope.productId,requestId:scope.requestId,verifiedAt:terminal?.finished_at,...scope.inspection});
 if(!proof||!isOwnedImageKey(scope.owner,proof.sourceKey)||result.model!==proof.configuration.model)throw Error('Invalid no-text receipt');
 await env.DB.prepare(imageNoTextReceiptsSchema).run();
 await env.DB.prepare(`INSERT INTO image_no_text_receipts(owner_id,product_id,request_id,request_fingerprint,source_scope,source_key,member_email,member_role,proof)
 SELECT r.owner_id,r.product_id,r.request_id,r.request_fingerprint,r.source_scope,?,?,?,? FROM image_vision_requests r
 JOIN products p ON p.id=r.product_id AND p.owner_id=r.owner_id JOIN members m ON m.id=r.owner_id
 WHERE r.owner_id=? AND r.product_id=? AND r.request_id=? AND r.request_fingerprint=? AND r.source_scope=?
 AND r.status='completed' AND r.failure IS NULL AND r.result=? AND r.company_code=? AND r.company_name=? AND r.model=?
 AND m.status='approved' AND lower(trim(m.email))=? AND m.role=? AND m.company_code=r.company_code AND m.company_name=r.company_name
 AND EXISTS(SELECT 1 FROM json_each(p.image_keys) k WHERE k.value=?)
 ON CONFLICT(owner_id,product_id,request_id) DO NOTHING`)
 .bind(proof.sourceKey,scope.member.email,scope.member.role,JSON.stringify(proof),
  scope.owner,scope.productId,scope.requestId,scope.fingerprint,scope.sourceScope,JSON.stringify(result),scope.company.code,scope.company.name,result.model,
  scope.member.email,scope.member.role,proof.sourceKey).run();
 const saved=await env.DB.prepare('SELECT proof FROM image_no_text_receipts WHERE owner_id=? AND product_id=? AND request_id=? AND request_fingerprint=? AND source_scope=?')
  .bind(scope.owner,scope.productId,scope.requestId,scope.fingerprint,scope.sourceScope).first<{proof:string}>();
 if(saved?.proof!==JSON.stringify(proof))throw Error('No-text receipt was not confirmed');
}
/** Bounded SELECT-only projection. Image keys are immutable app objects; the
 * receipt records their server-checked SHA. Reopening the actual source always
 * rechecks its bytes before this proof may skip another provider invocation. */
export async function readImageNoTextReceipts(owner:string,products:{id:string;image_keys:string}[]):Promise<Record<string,ImageNoTextProof[]>>{
 const output:Record<string,ImageNoTextProof[]>={},configuration=imageVisionConfiguration(env as ImageVisionEnvironment);if(!env.DB||!configuration.configured)return output;
 for(let start=0;start<products.length;start+=40){const chunk=products.slice(start,start+40);if(!chunk.length)continue;
  try{const rows=await env.DB.prepare(`SELECT n.product_id,n.request_id,n.source_key,n.proof,r.result,r.finished_at FROM image_no_text_receipts n
 JOIN image_vision_requests r ON r.owner_id=n.owner_id AND r.product_id=n.product_id AND r.request_id=n.request_id
 JOIN products p ON p.id=n.product_id AND p.owner_id=n.owner_id JOIN members m ON m.id=n.owner_id
 WHERE n.owner_id=? AND n.product_id IN (${chunk.map(()=>'?').join(',')}) AND n.request_fingerprint=r.request_fingerprint AND n.source_scope=r.source_scope
 AND r.status='completed' AND r.failure IS NULL AND r.provider_requests IN (0,1) AND r.model=?
 AND m.status='approved' AND lower(trim(m.email))=n.member_email AND m.role=n.member_role AND m.company_code=r.company_code AND m.company_name=r.company_name
 AND EXISTS(SELECT 1 FROM json_each(p.image_keys) k WHERE k.value=n.source_key) ORDER BY r.finished_at DESC LIMIT 8000`)
 .bind(owner,...chunk.map(product=>product.id),configuration.model).all<{product_id:string;request_id:string;source_key:string;proof:string;result:string;finished_at:string}>();
  for(const row of rows.results){try{const product=chunk.find(product=>product.id===row.product_id),proof=parseImageNoTextProof(JSON.parse(row.proof));
   if(!product||!proof||proof.productId!==product.id||proof.verifiedAt!==row.finished_at||proof.requestId!==row.request_id||proof.sourceKey!==row.source_key||!isOwnedImageKey(owner,proof.sourceKey)||!JSON.parse(product.image_keys).includes(proof.sourceKey)
    ||JSON.stringify(proof.configuration)!==JSON.stringify(configuration))continue;
   const result=parseImageTextVisionResult(JSON.parse(row.result),proof.width,proof.height);if(!isVerifiedNoForeignText(result??undefined))continue;
   const target=output[product.id]??=[];if(!target.some(item=>item.sourceKey===proof.sourceKey))target.push(proof);
  }catch{/* Invalid proof never completes a stage. */}}
  }catch{/* A pre-migration database has no no-op receipts. Never initialize on read. */}
 }
 return output;
}
