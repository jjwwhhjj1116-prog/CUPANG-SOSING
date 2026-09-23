import {env} from 'cloudflare:workers';
import type {ProductRecord} from '@/db/queries';
import type {ProductContent} from '@/app/product-content';
import {attachCollectedImage} from '@/app/collection-image';
export const collectionImagesSchema=`CREATE TABLE IF NOT EXISTS collection_images (
 job_id TEXT NOT NULL REFERENCES collection_jobs(id), image_index INTEGER NOT NULL,
 owner_id TEXT NOT NULL, product_id TEXT NOT NULL REFERENCES products(id),
 object_key TEXT NOT NULL, operation_id TEXT NOT NULL, created_at TEXT NOT NULL,
 PRIMARY KEY(job_id,image_index)
)`;
async function database(){if(!env.DB)throw new Error('D1 unavailable');await env.DB.prepare(collectionImagesSchema).run();return env.DB;}
export async function readCollectionImage(owner:string,jobId:string,index:number){const db=await database();return db.prepare('SELECT object_key,product_id FROM collection_images WHERE owner_id=? AND job_id=? AND image_index=?').bind(owner,jobId,index).first<{object_key:string;product_id:string}>();}
export async function saveCollectionImage(owner:string,jobId:string,index:number,key:string,role:'main'|'additional'|'detail',product:ProductRecord,current:ProductContent){
 const db=await database();const operation=crypto.randomUUID();const now=new Date(Math.max(Date.now(),Date.parse(product.updated_at)+1)).toISOString();
 const next=attachCollectedImage(current,JSON.parse(product.image_keys),key,role,now);
 const guard='EXISTS(SELECT 1 FROM collection_images WHERE operation_id=? AND owner_id=? AND product_id=?)';
 await db.batch([
  db.prepare(`INSERT INTO collection_images(job_id,image_index,owner_id,product_id,object_key,operation_id,created_at)
   SELECT ?,?,p.owner_id,p.id,?,?,? FROM products p JOIN collection_products cp ON cp.product_id=p.id AND cp.owner_id=p.owner_id
   WHERE p.id=? AND p.owner_id=? AND cp.job_id=? AND p.updated_at=? AND p.image_keys=?
   AND COALESCE((SELECT revision FROM product_content WHERE product_id=p.id AND owner_id=p.owner_id),0)=?
   ON CONFLICT(job_id,image_index) DO NOTHING`).bind(jobId,index,key,operation,now,product.id,owner,jobId,product.updated_at,product.image_keys,current.revision),
  db.prepare(`INSERT INTO product_content(product_id,owner_id,revision,payload,updated_at)
   SELECT ?,?,?,?,? WHERE ${guard}
   ON CONFLICT(product_id) DO UPDATE SET revision=excluded.revision,payload=excluded.payload,updated_at=excluded.updated_at`)
   .bind(product.id,owner,next.content.revision,JSON.stringify(next.content),now,operation,owner,product.id),
  db.prepare(`UPDATE products SET image_keys=?,quote_status='대기',updated_at=? WHERE id=? AND owner_id=? AND ${guard}`)
   .bind(JSON.stringify(next.keys),now,product.id,owner,operation,owner,product.id),
 ]);
 const saved=await readCollectionImage(owner,jobId,index);if(!saved)throw new Error('상품이 변경됐습니다. 다시 시도하면 기존 편집을 보존해 반영합니다.');return saved;
}
