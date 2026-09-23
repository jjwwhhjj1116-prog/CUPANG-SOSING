import { env } from 'cloudflare:workers';
import { ensureDatabase } from '@/db/queries';
import { readProductOptions } from '@/db/product-options';
import { readProductContent } from '@/db/product-content';
import { prepareCollectionProduct } from '@/app/collection-product';
import type { CollectionJob } from '@/app/sourcing';
import type { CollectionResult } from '@/app/collection-result';
import { collectionProductSchema } from '@/db/collection-jobs';
export async function findCollectionProduct(owner:string,jobId:string){
 if(!env.DB)throw new Error('D1 unavailable');await env.DB.prepare(collectionProductSchema).run();
 return env.DB.prepare('SELECT product_id FROM collection_products WHERE job_id=? AND owner_id=?').bind(jobId,owner).first<{product_id:string}>();
}
export async function promoteCollection(owner:string,job:CollectionJob,receipt:CollectionResult){
 await ensureDatabase();const existing=await findCollectionProduct(owner,job.id);if(existing)return existing;
 const id=crypto.randomUUID();const now=new Date().toISOString();const prepared=prepareCollectionProduct(owner,job,receipt,id,now);
 await readProductOptions(owner,id);await readProductContent(owner,id);
 const db=env.DB;const entries=Object.entries(prepared.product);
 // A single D1 batch transaction: cancellation, duplicate attempts and failures cannot leave partial products.
 await db.batch([
  db.prepare(`INSERT INTO products(${entries.map(([key])=>key).join(',')})
   SELECT ${entries.map(()=>'?').join(',')} FROM collection_jobs j JOIN collection_results r ON r.job_id=j.id JOIN collection_context c ON c.job_id=j.id
   WHERE j.id=? AND j.owner_id=? AND r.owner_id=? AND j.status='awaiting_connector' AND r.payload=? AND c.payload=?
   AND NOT EXISTS(SELECT 1 FROM collection_products WHERE job_id=j.id)`)
   .bind(...entries.map(([,value])=>value),job.id,owner,owner,JSON.stringify(receipt),JSON.stringify(job.context)),
  db.prepare('INSERT INTO product_price_policy(product_id,payload) SELECT id,? FROM products WHERE id=? AND owner_id=?').bind(JSON.stringify(prepared.policy),id,owner),
  db.prepare('INSERT INTO product_options(product_id,owner_id,revision,payload,updated_at) SELECT id,owner_id,1,?,? FROM products WHERE id=? AND owner_id=?').bind(JSON.stringify(prepared.options),now,id,owner),
  db.prepare('INSERT INTO product_content(product_id,owner_id,revision,payload,updated_at) SELECT id,owner_id,1,?,? FROM products WHERE id=? AND owner_id=?').bind(JSON.stringify(prepared.content),now,id,owner),
  db.prepare('INSERT INTO collection_products(job_id,owner_id,product_id,created_at) SELECT ?,owner_id,id,? FROM products WHERE id=? AND owner_id=?').bind(job.id,now,id,owner),
 ]);
 const saved=await findCollectionProduct(owner,job.id);if(!saved)throw new Error('수집 요청이나 원문이 변경되어 상품 반영을 중단했습니다.');return saved;
}

/** Exact product link only; never select another receipt just because the URL matches. */
export async function findProductCollection(owner:string,productId:string){
 if(!env.DB)throw new Error('D1 unavailable');await env.DB.prepare(collectionProductSchema).run();
 return env.DB.prepare('SELECT job_id FROM collection_products WHERE product_id=? AND owner_id=?').bind(productId,owner).first<{job_id:string}>();
}
