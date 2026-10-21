import { env } from 'cloudflare:workers';
import { ensureDatabase, findProduct } from '@/db/queries';
import { prepareProductRegistration, prepareProductRegistrationOptions } from '@/db/product-registration';
import { readProductOptions } from '@/db/product-options';
import { readProductContent } from '@/db/product-content';
import { verifyWorkspaceBannerFiles } from '@/db/workspace-banners';
import { prepareCollectionProduct } from '@/app/collection-product';
import type { CollectionJob } from '@/app/sourcing';
import type { CollectionResult } from '@/app/collection-result';
import { collectionProductSchema } from '@/db/collection-jobs';
import { effectiveCollectionPayload, readCollectionResult } from '@/db/collection-results';
import type { SourceCaptureSelection } from '@/app/source-capture-selection';
import type { SupplierHubCompany } from '@/app/supplier-hub-company';
import { prepareNewProductLabels } from '@/db/product-label-initialization';
import { issueCollectedPageOptionBindings } from '@/app/collected-page-option-binding';
/** The HTTP handler resolves the owned selection; clients cannot supply the
 * approved company or replacement receipt through this internal proof. */
export type ExpectedCollectionSource={capture:Readonly<SourceCaptureSelection>;receivedAt:string;company:SupplierHubCompany};
export class CollectionSourceSelectionError extends Error{
 constructor(){super('선택한 수집 원문 또는 검토 버전이 변경되었습니다. 기존 작업은 유지했으니 수집본을 다시 확인해주세요.');}
}
const selectedSourceCondition=` AND j.source_url=? AND j.offer_id=? AND r.received_at=? AND EXISTS(
 SELECT 1 FROM (SELECT owner_id,id,company_code,company_name,offer_id,fingerprint,revision,payload FROM source_inbox
 UNION ALL SELECT owner_id,id,company_code,company_name,offer_id,fingerprint,revision,payload FROM source_inbox_captures) selected
 WHERE selected.owner_id=j.owner_id AND selected.id=? AND selected.company_code=? AND selected.company_name=?
 AND selected.offer_id=j.offer_id AND selected.fingerprint=? AND selected.revision=? AND json_extract(selected.payload,'$.sourceUrl')=j.source_url)`;
const selectedSourceArguments=(job:CollectionJob,proof:ExpectedCollectionSource)=>[proof.capture.sourceUrl,job.offer_id,proof.receivedAt,
 proof.capture.captureId,proof.company.code,proof.company.name,proof.capture.fingerprint,proof.capture.revision];
async function assertExpectedCollectionSource(owner:string,job:CollectionJob,receipt:CollectionResult,proof:ExpectedCollectionSource){
 if(!env.DB)throw new Error('D1 unavailable');
 const current=await env.DB.prepare(`SELECT j.id FROM collection_jobs j JOIN collection_results r ON r.job_id=j.id JOIN collection_context c ON c.job_id=j.id
  WHERE j.id=? AND j.owner_id=? AND r.owner_id=? AND j.status='awaiting_connector' AND ${effectiveCollectionPayload}=? AND c.payload=?${selectedSourceCondition}`)
  .bind(job.id,owner,owner,JSON.stringify(receipt),JSON.stringify(job.context),...selectedSourceArguments(job,proof)).first();
 if(!current)throw new CollectionSourceSelectionError();
}
export async function findCollectionProduct(owner:string,jobId:string){
 if(!env.DB)throw new Error('D1 unavailable');await env.DB.prepare(collectionProductSchema).run();
 return env.DB.prepare('SELECT product_id FROM collection_products WHERE job_id=? AND owner_id=?').bind(jobId,owner).first<{product_id:string}>();
}
export async function promoteCollection(owner:string,job:CollectionJob,receipt:CollectionResult,expectedSource?:ExpectedCollectionSource){
 // Repeat the selected-source check inside storage, before any existing-product
 // ACK. The same predicate is part of the INSERT transaction below.
 if(expectedSource)await assertExpectedCollectionSource(owner,job,receipt,expectedSource);
 await ensureDatabase();const existing=await findCollectionProduct(owner,job.id);if(existing){
  if(!await findProduct(owner,existing.product_id,true))throw new Error('삭제된 상품의 수집 요청입니다. 상품 추가에서 같은 URL로 새 초안을 만들거나 삭제된 상품을 복원해주세요.');
  if(expectedSource)await assertExpectedCollectionSource(owner,job,receipt,expectedSource);
  return {...existing,reused:true};
 }
 await readCollectionResult(owner,job.id);
 const id=crypto.randomUUID();const now=new Date().toISOString();const prepared=prepareCollectionProduct(owner,job,receipt,id,now);
 await issueCollectedPageOptionBindings(owner,job,receipt,prepared.options);
 await verifyWorkspaceBannerFiles(owner, job.context!.settings, true);
 await readProductOptions(owner,id);await readProductContent(owner,id);
 const db=env.DB;const entries=Object.entries(prepared.product);
 // A single D1 batch transaction: cancellation, duplicate attempts and failures cannot leave partial products.
 await db.batch([
  db.prepare(`INSERT INTO products(${entries.map(([key])=>key).join(',')})
   SELECT ${entries.map(()=>'?').join(',')} FROM collection_jobs j JOIN collection_results r ON r.job_id=j.id JOIN collection_context c ON c.job_id=j.id
   WHERE j.id=? AND j.owner_id=? AND r.owner_id=? AND j.status='awaiting_connector' AND ${effectiveCollectionPayload}=? AND c.payload=?
   AND NOT EXISTS(SELECT 1 FROM collection_products WHERE job_id=j.id)${expectedSource?selectedSourceCondition:''}`)
   .bind(...entries.map(([,value])=>value),job.id,owner,owner,JSON.stringify(receipt),JSON.stringify(job.context),...(expectedSource?selectedSourceArguments(job,expectedSource):[])),
  ...prepareNewProductLabels(db,owner,id,now),
  ...prepareProductRegistration(db,owner,id,now),
  prepareProductRegistrationOptions(db,owner,id,prepared.options.rows.map(row=>row.id),now),
  db.prepare('INSERT INTO product_price_policy(product_id,payload) SELECT id,? FROM products WHERE id=? AND owner_id=?').bind(JSON.stringify(prepared.policy),id,owner),
  db.prepare('INSERT INTO product_options(product_id,owner_id,revision,payload,updated_at) SELECT id,owner_id,1,?,? FROM products WHERE id=? AND owner_id=?').bind(JSON.stringify(prepared.options),now,id,owner),
  db.prepare('INSERT INTO product_content(product_id,owner_id,revision,payload,updated_at) SELECT id,owner_id,1,?,? FROM products WHERE id=? AND owner_id=?').bind(JSON.stringify(prepared.content),now,id,owner),
  db.prepare('INSERT INTO collection_products(job_id,owner_id,product_id,created_at) SELECT ?,owner_id,id,? FROM products WHERE id=? AND owner_id=?').bind(job.id,now,id,owner),
 ]);
 const saved=await findCollectionProduct(owner,job.id);
 if(expectedSource)await assertExpectedCollectionSource(owner,job,receipt,expectedSource);
 if(!saved||!await findProduct(owner,saved.product_id,true)){
  if(expectedSource)throw new CollectionSourceSelectionError();
  throw new Error('수집 요청이나 상품이 변경되어 상품 반영을 중단했습니다.');
 }return {...saved,reused:saved.product_id!==id};
}

/** Exact product link only; never select another receipt just because the URL matches. */
export async function findProductCollection(owner:string,productId:string){
 if(!env.DB)throw new Error('D1 unavailable');await env.DB.prepare(collectionProductSchema).run();
 return env.DB.prepare('SELECT job_id FROM collection_products WHERE product_id=? AND owner_id=?').bind(productId,owner).first<{job_id:string}>();
}
