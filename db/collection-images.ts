import {env} from 'cloudflare:workers';
import type {ProductRecord} from '@/db/queries';
import type {ProductContent} from '@/app/product-content';
import {attachCollectedImage,attachCollectedOptionImage} from '@/app/collection-image';
import {readProductOptions} from '@/db/product-options';
import {collectionProductSchema} from '@/db/collection-jobs';
import {isOwnedImageKey} from '@/app/image-files';
import {collectionResultSchema} from '@/db/collection-results';
import type {ProductOptions} from '@/app/product-options';
export class CollectionImageCancelledError extends Error {
 constructor(){super('취소된 수집 요청입니다. 이미지를 상품에 반영하지 않았습니다.');}
}
export const collectionImagesSchema=`CREATE TABLE IF NOT EXISTS collection_images (
 job_id TEXT NOT NULL REFERENCES collection_jobs(id), image_index INTEGER NOT NULL,
 owner_id TEXT NOT NULL, product_id TEXT NOT NULL REFERENCES products(id),
 object_key TEXT NOT NULL, operation_id TEXT NOT NULL, created_at TEXT NOT NULL,
 PRIMARY KEY(job_id,image_index)
)`;
async function database(){if(!env.DB)throw new Error('D1 unavailable');await env.DB.prepare(collectionImagesSchema).run();return env.DB;}
export async function readCollectionImage(owner:string,jobId:string,index:number){const db=await database();return db.prepare('SELECT object_key,product_id FROM collection_images WHERE owner_id=? AND job_id=? AND image_index=?').bind(owner,jobId,index).first<{object_key:string;product_id:string}>();}

/** The list preview comes from this product's persisted intake, never a banner
 * or another receipt with the same URL. Reading it does not choose stage assets. */
export async function readRegistrationSourceImages(owner:string,products:readonly Pick<ProductRecord,'id'|'image_keys'>[]):Promise<Record<string,string>> {
 const snapshots=new Map<string,Set<string>>();
 for(const product of products){
  try{
   const keys:unknown=JSON.parse(product.image_keys);
   if(Array.isArray(keys))snapshots.set(product.id,new Set(keys.filter((key):key is string=>isOwnedImageKey(owner,key))));
  }catch{/* A damaged product must not hide previews for other products. */}
 }
 const ids=[...snapshots].filter(([,keys])=>keys.size>0).map(([id])=>id);
 if(!ids.length)return {};
 const db=await database();await db.prepare(collectionProductSchema).run();
 const images:Record<string,string>={};
 // D1's 100-binding limit includes the owner. Rank in SQL to return at most
 // one source image per product, even when its library has many originals.
 for(let offset=0;offset<ids.length;offset+=80){
  const chunk=ids.slice(offset,offset+80);
  const rows=await db.prepare(`WITH ranked AS (
   SELECT ci.product_id,ci.object_key,ROW_NUMBER() OVER (
    PARTITION BY ci.product_id ORDER BY ci.image_index,ci.created_at,ci.object_key
   ) AS position
   FROM collection_products cp
   JOIN products p ON p.id=cp.product_id AND p.owner_id=cp.owner_id
   JOIN collection_jobs j ON j.id=cp.job_id AND j.owner_id=cp.owner_id
   JOIN collection_images ci ON ci.job_id=cp.job_id AND ci.product_id=p.id AND ci.owner_id=p.owner_id
   WHERE cp.owner_id=? AND cp.product_id IN (${chunk.map(()=>'?').join(',')})
   AND ci.image_index>=0 AND ci.object_key<>''
   AND EXISTS(SELECT 1 FROM json_each(CASE WHEN json_valid(p.image_keys) THEN p.image_keys ELSE '[]' END) WHERE value=ci.object_key)
  ) SELECT product_id,object_key FROM ranked WHERE position=1`).bind(owner,...chunk).all<{product_id:string;object_key:string}>();
  for(const row of rows.results){
   // The list and this query can straddle an edit; never expose a key missing
   // from the product snapshot actually returned to the client.
   if(snapshots.get(row.product_id)?.has(row.object_key))images[row.product_id]=row.object_key;
  }
 }
 return images;
}

/** SKU source previews stay separate from options.rows[].imageKey. */
export async function readOptionSourceImages(owner:string,product:Pick<ProductRecord,'id'|'image_keys'>,options:ProductOptions):Promise<Record<string,string>> {
 if(options.productId!==product.id||!options.rows.length)return {};
 let keys:unknown;try{keys=JSON.parse(product.image_keys);}catch{return {};}
 if(!Array.isArray(keys))return {};
 const owned=new Set(keys.filter((key):key is string=>isOwnedImageKey(owner,key)));
 if(!owned.size)return {};
 const db=await database();await db.batch([db.prepare(collectionProductSchema),db.prepare(collectionResultSchema)]);
 const rows=await db.prepare(`SELECT json_extract(CASE WHEN original.type='object' THEN original.value ELSE '{}' END,'$.sku') AS sku,ci.object_key
  FROM collection_products cp
  JOIN products p ON p.id=cp.product_id AND p.owner_id=cp.owner_id
  JOIN collection_jobs j ON j.id=cp.job_id AND j.owner_id=cp.owner_id
  JOIN collection_results cr ON cr.job_id=cp.job_id AND cr.owner_id=cp.owner_id
  JOIN json_each(CASE WHEN json_valid(cr.payload) THEN json_extract(cr.payload,'$.options') ELSE '[]' END) original
  JOIN collection_images ci ON ci.job_id=cp.job_id AND ci.product_id=p.id AND ci.owner_id=p.owner_id
   AND ci.image_index=json_extract(CASE WHEN original.type='object' THEN original.value ELSE '{}' END,'$.imageIndex')
  WHERE cp.owner_id=? AND cp.product_id=?
  AND json_extract(CASE WHEN json_valid(cr.payload) THEN cr.payload ELSE '{}' END,'$.schemaVersion')=1
  AND json_extract(CASE WHEN json_valid(cr.payload) THEN cr.payload ELSE '{}' END,'$.offerId')=j.offer_id
  AND json_type(CASE WHEN json_valid(cr.payload) THEN cr.payload ELSE '{}' END,'$.options')='array'
  AND json_array_length(CASE WHEN json_valid(cr.payload) THEN cr.payload ELSE '{}' END,'$.options') BETWEEN 1 AND 200
  AND json_type(CASE WHEN json_valid(cr.payload) THEN cr.payload ELSE '{}' END,'$.images')='array'
  AND json_type(CASE WHEN original.type='object' THEN original.value ELSE '{}' END,'$.imageIndex')='integer' AND ci.image_index>=0
  AND ci.image_index<json_array_length(CASE WHEN json_valid(cr.payload) THEN cr.payload ELSE '{}' END,'$.images')
  AND EXISTS(SELECT 1 FROM json_each(CASE WHEN json_valid(p.image_keys) THEN p.image_keys ELSE '[]' END) WHERE value=ci.object_key)
  LIMIT 201`)
  .bind(owner,product.id).all<{sku:unknown;object_key:string}>();
 if(rows.results.length>200)return {};
 const sources=new Map<string,string|null>();
 for(const row of rows.results){
  if(typeof row.sku!=='string'||!row.sku||!owned.has(row.object_key))continue;
  // Duplicate captured SKUs are ambiguous, including repeats of one image.
  sources.set(row.sku,sources.has(row.sku)?null:row.object_key);
 }
 const images:Record<string,string>={};
 const counts=new Map<string,number>();for(const option of options.rows)counts.set(option.supplierSku,(counts.get(option.supplierSku)??0)+1);
 for(const option of options.rows){const key=sources.get(option.supplierSku);if(key&&counts.get(option.supplierSku)===1)images[option.id]=key;}
 return images;
}
export async function saveCollectionImage(owner:string,jobId:string,index:number,key:string,role:'main'|'additional'|'detail',product:ProductRecord,current:ProductContent,skus:readonly string[]=[],assignToStage = true){
 const db=await database();const operation=crypto.randomUUID();const now=new Date(Math.max(Date.now(),Date.parse(product.updated_at)+1)).toISOString();
 const next=attachCollectedImage(current,JSON.parse(product.image_keys),key,role,now,assignToStage);
 const options=await readProductOptions(owner,product.id);
 // Intake originals belong to the image library. Choosing a source file is a
 // separate step-three action, not evidence of a finished quotation image.
 const nextOptions=assignToStage?attachCollectedOptionImage(options,skus,key,now):options;
 const guard='EXISTS(SELECT 1 FROM collection_images WHERE operation_id=? AND owner_id=? AND product_id=?)';
 await db.batch([
  db.prepare(`INSERT INTO collection_images(job_id,image_index,owner_id,product_id,object_key,operation_id,created_at)
   SELECT ?,?,p.owner_id,p.id,?,?,? FROM products p JOIN collection_products cp ON cp.product_id=p.id AND cp.owner_id=p.owner_id
   WHERE p.id=? AND p.owner_id=? AND cp.job_id=? AND p.updated_at=? AND p.image_keys=?
   AND EXISTS(SELECT 1 FROM collection_jobs j WHERE j.id=cp.job_id AND j.owner_id=p.owner_id AND j.status='awaiting_connector')
   AND COALESCE((SELECT revision FROM product_content WHERE product_id=p.id AND owner_id=p.owner_id),0)=?
   AND COALESCE((SELECT revision FROM product_options WHERE product_id=p.id AND owner_id=p.owner_id),0)=?
   ON CONFLICT(job_id,image_index) DO NOTHING`).bind(jobId,index,key,operation,now,product.id,owner,jobId,product.updated_at,product.image_keys,current.revision,options.revision),
  db.prepare(`INSERT INTO product_content(product_id,owner_id,revision,payload,updated_at)
   SELECT ?,?,?,?,? WHERE ${guard}
   ON CONFLICT(product_id) DO UPDATE SET revision=excluded.revision,payload=excluded.payload,updated_at=excluded.updated_at`)
   .bind(product.id,owner,next.content.revision,JSON.stringify(next.content),now,operation,owner,product.id),
  ...(nextOptions.revision!==options.revision?[db.prepare(`UPDATE product_options SET revision=?,payload=?,updated_at=? WHERE product_id=? AND owner_id=? AND revision=? AND ${guard}`)
   .bind(nextOptions.revision,JSON.stringify(nextOptions),now,product.id,owner,options.revision,operation,owner,product.id)]:[]),
  db.prepare(`UPDATE products SET image_keys=?,quote_status='대기',updated_at=? WHERE id=? AND owner_id=? AND ${guard}`)
   .bind(JSON.stringify(next.keys),now,product.id,owner,operation,owner,product.id),
 ]);
 const saved=await readCollectionImage(owner,jobId,index);
 if(!saved){
  const job=await db.prepare('SELECT status FROM collection_jobs WHERE id=? AND owner_id=?').bind(jobId,owner).first<{status:string}>();
  if(job?.status==='cancelled')throw new CollectionImageCancelledError();
  throw new Error('상품이 변경됐습니다. 다시 시도하면 기존 편집을 보존해 반영합니다.');
 }
 return saved;
}

export async function listCollectionImageIndices(owner:string,jobId:string,productId:string):Promise<number[]> {
 const db=await database();
 const result=await db.prepare(`SELECT ci.image_index FROM collection_images ci JOIN products p ON p.id=ci.product_id AND p.owner_id=ci.owner_id WHERE ci.owner_id=? AND ci.job_id=? AND ci.product_id=? AND EXISTS(SELECT 1 FROM json_each(p.image_keys) WHERE value=ci.object_key) ORDER BY ci.image_index`).bind(owner,jobId,productId).all<{image_index:number}>();
 return result.results.map(row=>row.image_index);
}

export async function listDisconnectedCollectionImageIndices(owner:string,jobId:string,productId:string):Promise<number[]> {
 const db=await database();
 const result=await db.prepare('SELECT ci.image_index FROM collection_images ci JOIN products p ON p.id=ci.product_id AND p.owner_id=ci.owner_id WHERE ci.owner_id=? AND ci.job_id=? AND ci.product_id=? AND NOT EXISTS(SELECT 1 FROM json_each(p.image_keys) WHERE value=ci.object_key) ORDER BY ci.image_index').bind(owner,jobId,productId).all<{image_index:number}>();
 return result.results.map(row=>row.image_index);
}
