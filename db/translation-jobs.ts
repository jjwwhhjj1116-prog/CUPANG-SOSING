import { env } from 'cloudflare:workers';
import type { TranslationJob, TranslationResult } from '@/app/automation/translation';
import { validateTranslationSource } from '@/app/automation/translation';
import { validateCategoryProfile } from '@/app/category-profiles';
import { collectionSourceReference, parseCollectionRequest } from '@/app/sourcing';
import type { SupplierHubCompany } from '@/app/supplier-hub-company';
import { fingerprint } from '@/app/automation/model';

export type SeoRetrySourceGuard = { jobId:string; offerId:string; jobUpdatedAt:string; contextPayload:string; resultPayload:string };
async function seoSourceGuard(source:SeoRetrySourceGuard|undefined) {
  if(!source)return {sql:'',args:[]};
  const {effectiveCollectionPayload}=await import('@/db/collection-results');
  return {sql:`AND EXISTS(SELECT 1 FROM collection_products cp JOIN collection_jobs j ON j.id=cp.job_id
    JOIN collection_context c ON c.job_id=j.id JOIN collection_results r ON r.job_id=j.id
    WHERE cp.product_id=translation_jobs.product_id AND cp.owner_id=translation_jobs.owner_id
      AND j.owner_id=cp.owner_id AND r.owner_id=cp.owner_id AND j.id=? AND j.offer_id=? AND j.status='awaiting_connector'
      AND j.updated_at=? AND c.payload=? AND ${effectiveCollectionPayload}=?)`,
    args:[source.jobId,source.offerId,source.jobUpdatedAt,source.contextPayload,source.resultPayload]};
}

/** One exact current collection tuple; it can be guarded again inside SQLite. */
export async function readSeoRetrySource(owner:string,productId:string,sourceUrl:string,company:SupplierHubCompany) {
  const db=await database();
  const {effectiveCollectionPayload}=await import('@/db/collection-results');
  const row=await db.prepare(`SELECT j.id,j.offer_id,j.updated_at,c.payload AS context_payload,${effectiveCollectionPayload} AS result_payload
    FROM collection_products cp JOIN collection_jobs j ON j.id=cp.job_id JOIN collection_context c ON c.job_id=j.id
    JOIN collection_results r ON r.job_id=j.id WHERE cp.product_id=? AND cp.owner_id=?
    AND j.owner_id=cp.owner_id AND r.owner_id=cp.owner_id AND j.status='awaiting_connector'`)
    .bind(productId,owner).first<{id:string;offer_id:string;updated_at:string;context_payload:string;result_payload:string}>();
  if(!row)throw Error('상품에 연결된 현재 수집 원문을 찾지 못했습니다.');
  const captured=JSON.parse(row.context_payload),receipt=JSON.parse(row.result_payload),category=validateCategoryProfile(captured.category);
  const offer=parseCollectionRequest({urls:[sourceUrl]})[0];
  if(offer.offerId!==row.offer_id||receipt.offerId!==offer.offerId||parseCollectionRequest({urls:[receipt.sourceUrl]})[0].offerId!==offer.offerId
    || category.hubSchema && (category.hubSchema.company.code!==company.code||category.hubSchema.company.name!==company.name))throw Error('상품·수집 카테고리·승인 회사가 일치하지 않습니다.');
  const source=validateTranslationSource({title:receipt.title,description:receipt.description,attributes:[],provenance:'manual',
    reference:collectionSourceReference(row.id,receipt.sourceUrl),category:{id:category.categoryId,path:category.categoryPath},
    guidance:{features:captured.features,keywords:captured.keywords}});
  const guard={jobId:row.id,offerId:row.offer_id,jobUpdatedAt:row.updated_at,contextPayload:row.context_payload,resultPayload:row.result_payload};
  return {source,guard,sourceFingerprint:await fingerprint({owner,productId,sourceUrl,company,guard})};
}

type Row = { id: string; product_id: string; product_version: string; content_revision: number;
  status: TranslationJob['status']; review: string; result: string | null; error: string | null;
  created_at: string; approved_at: string | null; started_at: string | null; finished_at: string | null;
  request_fingerprint: string };

async function database() {
  if (!env.DB) throw new Error('D1 is unavailable');
  await env.DB.batch([
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS translation_jobs (
      id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, product_id TEXT NOT NULL,
      idempotency_key TEXT NOT NULL, request_fingerprint TEXT NOT NULL,
      product_version TEXT NOT NULL, content_revision INTEGER NOT NULL,
      status TEXT NOT NULL, review_fingerprint TEXT NOT NULL, review TEXT NOT NULL,
      expires_at TEXT NOT NULL, result TEXT, error TEXT, claim_token TEXT,
      created_at TEXT NOT NULL, approved_at TEXT, started_at TEXT, finished_at TEXT,
      UNIQUE(owner_id,product_id,idempotency_key), FOREIGN KEY(product_id) REFERENCES products(id)
    )`),
    env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_translation_owner_product ON translation_jobs(owner_id,product_id,created_at)'),
  ]);
  return env.DB;
}
function job(row: Row): TranslationJob {
  return { id: row.id, productId: row.product_id, productVersion: row.product_version, contentRevision: row.content_revision,
    status: row.status, review: JSON.parse(row.review), result: row.result ? JSON.parse(row.result) : null,
    error: row.error ? JSON.parse(row.error) : null, createdAt: row.created_at, approvedAt: row.approved_at,
    startedAt: row.started_at, finishedAt: row.finished_at };
}
export async function listTranslationJobs(ownerId: string, productId: string) {
  const db = await database();
  const result = await db.prepare('SELECT * FROM translation_jobs WHERE owner_id=? AND product_id=? ORDER BY created_at DESC,id DESC LIMIT 20').bind(ownerId, productId).all<Row>();
  return result.results.map(job);
}
export async function getTranslationJob(ownerId: string, productId: string, id: string) {
  const db = await database();
  const row = await db.prepare('SELECT * FROM translation_jobs WHERE owner_id=? AND product_id=? AND id=?').bind(ownerId, productId, id).first<Row>();
  return row ? job(row) : null;
}

/** Exact user-started retry lookup; a lost acknowledgement never needs a new nonce. */
export async function findOptionsRetryTranslation(ownerId: string, productId: string, retryKey: string) {
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(retryKey)) throw Error('Invalid options retry key');
  const db = await database();
  const row = await db.prepare('SELECT * FROM translation_jobs WHERE owner_id=? AND product_id=? AND idempotency_key=?')
    .bind(ownerId, productId, 'options-retry-' + retryKey).first<Row>();
  return row ? job(row) : null;
}
export async function findSeoRetryTranslation(ownerId:string,productId:string,retryKey:string) {
  if(!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(retryKey))throw Error('Invalid SEO retry key');
  const db=await database();const row=await db.prepare('SELECT * FROM translation_jobs WHERE owner_id=? AND product_id=? AND idempotency_key=?')
    .bind(ownerId,productId,'seo-retry-'+retryKey).first<Row>();return row?job(row):null;
}

export async function createSeoRetryTranslation(ownerId:string,value:TranslationJob,retryKey:string,requestFingerprint:string,optionRevision:number,source:SeoRetrySourceGuard) {
  if(!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(retryKey)||!Number.isSafeInteger(optionRevision)||optionRevision<0)throw Error('Invalid SEO retry scope');
  const db=await database();
  const {effectiveCollectionPayload}=await import('@/db/collection-results');
  const row=await db.prepare(`INSERT INTO translation_jobs(id,owner_id,product_id,idempotency_key,request_fingerprint,
    product_version,content_revision,status,review_fingerprint,review,expires_at,created_at)
    SELECT ?,?,?,?,?,?,?,'prepared',?,?,?,? WHERE EXISTS(SELECT 1 FROM products WHERE id=? AND owner_id=? AND updated_at=?)
    AND NOT EXISTS(SELECT 1 FROM product_removals WHERE product_id=? AND owner_id=?)
    AND COALESCE((SELECT revision FROM product_content WHERE product_id=? AND owner_id=?),0)=?
    AND COALESCE((SELECT revision FROM product_options WHERE product_id=? AND owner_id=?),0)=?
    AND NOT EXISTS(SELECT 1 FROM translation_jobs WHERE owner_id=? AND product_id=? AND status IN ('running','uncertain'))
    AND EXISTS(SELECT 1 FROM collection_products cp JOIN collection_jobs j ON j.id=cp.job_id JOIN collection_context c ON c.job_id=j.id
      JOIN collection_results r ON r.job_id=j.id WHERE cp.product_id=? AND cp.owner_id=? AND j.owner_id=cp.owner_id AND r.owner_id=cp.owner_id
      AND j.id=? AND j.offer_id=? AND j.status='awaiting_connector' AND j.updated_at=? AND c.payload=? AND ${effectiveCollectionPayload}=?)
    ON CONFLICT(owner_id,product_id,idempotency_key) DO NOTHING RETURNING *`)
    .bind(value.id,ownerId,value.productId,'seo-retry-'+retryKey,requestFingerprint,value.productVersion,value.contentRevision,
      value.review.fingerprint,JSON.stringify(value.review),value.review.expiresAt,value.createdAt,value.productId,ownerId,value.productVersion,
      value.productId,ownerId,value.productId,ownerId,value.contentRevision,value.productId,ownerId,optionRevision,ownerId,value.productId,
      value.productId,ownerId,source.jobId,source.offerId,source.jobUpdatedAt,source.contextPayload,source.resultPayload).first<Row>();
  if(row)return {job:job(row),replayed:false,conflict:false};
  const previous=await db.prepare('SELECT * FROM translation_jobs WHERE owner_id=? AND product_id=? AND idempotency_key=?')
    .bind(ownerId,value.productId,'seo-retry-'+retryKey).first<Row>();
  return previous?{job:job(previous),replayed:true,conflict:previous.request_fingerprint!==requestFingerprint}:null;
}

export async function hasUnsettledTranslation(ownerId: string, productId: string) {
  const db = await database();
  return !!await db.prepare("SELECT id FROM translation_jobs WHERE owner_id=? AND product_id=? AND status IN ('running','uncertain') LIMIT 1")
    .bind(ownerId, productId).first();
}

/** Create only. Failed/partial originals, approvals and results are never reset. */
export async function createOptionsRetryTranslation(ownerId: string, value: TranslationJob, retryKey: string, requestFingerprint: string, optionRevision: number) {
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(retryKey)) throw Error('Invalid options retry key');
  if (!Number.isSafeInteger(optionRevision) || optionRevision < 0) throw Error('Invalid options retry revision');
  const db = await database();
  const row = await db.prepare(`INSERT INTO translation_jobs(id,owner_id,product_id,idempotency_key,request_fingerprint,
    product_version,content_revision,status,review_fingerprint,review,expires_at,created_at)
    SELECT ?,?,?,?,?,?,?,'prepared',?,?,?,?
    WHERE EXISTS(SELECT 1 FROM products WHERE id=? AND owner_id=? AND updated_at=?)
    AND NOT EXISTS(SELECT 1 FROM product_removals WHERE product_id=? AND owner_id=?)
    AND COALESCE((SELECT revision FROM product_content WHERE product_id=? AND owner_id=?),0)=?
    AND COALESCE((SELECT revision FROM product_options WHERE product_id=? AND owner_id=?),0)=?
    AND NOT EXISTS(SELECT 1 FROM translation_jobs WHERE owner_id=? AND product_id=? AND status IN ('running','uncertain'))
    ON CONFLICT(owner_id,product_id,idempotency_key) DO NOTHING RETURNING *`)
    .bind(value.id, ownerId, value.productId, 'options-retry-' + retryKey, requestFingerprint, value.productVersion, value.contentRevision,
      value.review.fingerprint, JSON.stringify(value.review), value.review.expiresAt, value.createdAt,
      value.productId, ownerId, value.productVersion, value.productId, ownerId, value.productId, ownerId, value.contentRevision,
      value.productId, ownerId, optionRevision, ownerId, value.productId).first<Row>();
  if (row) return { job: job(row), replayed: false, conflict: false };
  const existing = await db.prepare('SELECT * FROM translation_jobs WHERE owner_id=? AND product_id=? AND idempotency_key=?')
    .bind(ownerId, value.productId, 'options-retry-' + retryKey).first<Row>();
  return existing ? { job: job(existing), replayed: true, conflict: existing.request_fingerprint !== requestFingerprint } : null;
}
export async function createTranslationJob(ownerId: string, value: TranslationJob, key: string, requestFingerprint: string) {
  const db = await database();
  const row = await db.prepare(`INSERT INTO translation_jobs(id,owner_id,product_id,idempotency_key,request_fingerprint,
    product_version,content_revision,status,review_fingerprint,review,expires_at,created_at)
    SELECT ?,?,?,?,?,?,?,'prepared',?,?,?,? WHERE EXISTS (SELECT 1 FROM products WHERE id=? AND owner_id=? AND updated_at=?)
    AND COALESCE((SELECT revision FROM product_content WHERE product_id=? AND owner_id=?),0)=?
    ON CONFLICT(owner_id,product_id,idempotency_key) DO NOTHING RETURNING *`)
    .bind(value.id, ownerId, value.productId, key, requestFingerprint, value.productVersion, value.contentRevision,
      value.review.fingerprint, JSON.stringify(value.review), value.review.expiresAt, value.createdAt,
      value.productId, ownerId, value.productVersion, value.productId, ownerId, value.contentRevision).first<Row>();
  if (row) return { job: job(row), replayed: false, conflict: false };
  // Resume an expired, never-started automatic draft without creating a second
  // job. Exact source/config/version identity and atomic state guards are required.
  if (key === 'intake-auto-v1' || key.startsWith('intake-options-')) {
    const renewed = await db.prepare(`UPDATE translation_jobs
      SET status='prepared',review_fingerprint=?,review=?,expires_at=?,approved_at=NULL
      WHERE owner_id=? AND product_id=? AND idempotency_key=? AND request_fingerprint=?
      AND status IN ('prepared','approved') AND expires_at<=? AND started_at IS NULL
      AND claim_token IS NULL AND result IS NULL AND error IS NULL
      AND product_version=? AND content_revision=?
      AND EXISTS(SELECT 1 FROM products WHERE id=translation_jobs.product_id AND owner_id=translation_jobs.owner_id AND updated_at=translation_jobs.product_version)
      AND COALESCE((SELECT revision FROM product_content WHERE product_id=translation_jobs.product_id AND owner_id=translation_jobs.owner_id),0)=content_revision
      RETURNING *`).bind(value.review.fingerprint, JSON.stringify(value.review), value.review.expiresAt,
        ownerId, value.productId, key, requestFingerprint, value.createdAt, value.productVersion, value.contentRevision).first<Row>();
    if (renewed) return { job: job(renewed), replayed: true, conflict: false };
  }
  const existing = await db.prepare('SELECT * FROM translation_jobs WHERE owner_id=? AND product_id=? AND idempotency_key=?').bind(ownerId, value.productId, key).first<Row>();
  if (existing && /^intake-options-[a-f0-9]{64}$/.test(key) && existing.request_fingerprint !== requestFingerprint) {
    const previous = job(existing);
    if (['prepared','approved'].includes(previous.status) && !previous.startedAt && !previous.result && !previous.error && previous.productVersion !== value.productVersion) {
      return await refreshUnstartedIntake(ownerId, previous, value, requestFingerprint, key);
    }
  }
  return existing ? { job: job(existing), replayed: true, conflict: existing.request_fingerprint !== requestFingerprint } : null;
}

/** Replace stale preparation only: no executed generation or old approval survives. */
export async function refreshUnstartedIntake(ownerId:string, previous:TranslationJob, value:TranslationJob, requestFingerprint:string, key = 'intake-auto-v1') {
  if((key !== 'intake-auto-v1' && !/^intake-options-[a-f0-9]{64}$/.test(key)) || previous.productId!==value.productId || previous.productVersion===value.productVersion)return null;
  const db=await database();
  const row=await db.prepare(`UPDATE translation_jobs SET request_fingerprint=?,product_version=?,content_revision=?,
    status='prepared',review_fingerprint=?,review=?,expires_at=?,approved_at=NULL
    WHERE owner_id=? AND product_id=? AND id=? AND idempotency_key=?
    AND product_version=? AND content_revision=? AND review_fingerprint=?
    AND status IN ('prepared','approved') AND started_at IS NULL AND claim_token IS NULL AND result IS NULL AND error IS NULL
    AND EXISTS(SELECT 1 FROM products WHERE id=translation_jobs.product_id AND owner_id=translation_jobs.owner_id AND updated_at=?)
    AND COALESCE((SELECT revision FROM product_content WHERE product_id=translation_jobs.product_id AND owner_id=translation_jobs.owner_id),0)=?
    RETURNING *`).bind(requestFingerprint,value.productVersion,value.contentRevision,value.review.fingerprint,JSON.stringify(value.review),value.review.expiresAt,
      ownerId,value.productId,previous.id,key,previous.productVersion,previous.contentRevision,previous.review.fingerprint,value.productVersion,value.contentRevision).first<Row>();
  return row?{job:job(row),replayed:true,conflict:false}:null;
}

export async function approveTranslationJob(ownerId: string, productId: string, id: string, reviewFingerprint: string, now: string, optionRevision?: number,seoSource?:SeoRetrySourceGuard) {
  const db = await database();
  if (optionRevision !== undefined && (!Number.isSafeInteger(optionRevision) || optionRevision < 0)) throw Error('Invalid options retry revision');
  const retryGuard = optionRevision === undefined ? '' : `AND COALESCE((SELECT revision FROM product_options WHERE product_id=translation_jobs.product_id AND owner_id=translation_jobs.owner_id),0)=?
    AND NOT EXISTS(SELECT 1 FROM product_removals WHERE product_id=translation_jobs.product_id AND owner_id=translation_jobs.owner_id)
    AND NOT EXISTS(SELECT 1 FROM translation_jobs other WHERE other.owner_id=translation_jobs.owner_id AND other.product_id=translation_jobs.product_id
      AND other.id<>translation_jobs.id AND other.status IN ('running','uncertain'))`;
  const sourceGuard=await seoSourceGuard(seoSource);
  const row = await db.prepare(`UPDATE translation_jobs SET status='approved',approved_at=?
    WHERE owner_id=? AND product_id=? AND id=? AND status='prepared' AND review_fingerprint=? AND expires_at>?
    AND EXISTS(SELECT 1 FROM products WHERE id=translation_jobs.product_id AND owner_id=translation_jobs.owner_id AND updated_at=translation_jobs.product_version)
    AND COALESCE((SELECT revision FROM product_content WHERE product_id=translation_jobs.product_id AND owner_id=translation_jobs.owner_id),0)=content_revision
    ${retryGuard}
    ${sourceGuard.sql}
    RETURNING *`).bind(now, ownerId, productId, id, reviewFingerprint, now, ...(optionRevision === undefined ? [] : [optionRevision]),...sourceGuard.args).first<Row>();
  return row ? job(row) : null;
}

export async function claimTranslationJob(ownerId: string, productId: string, id: string, reviewFingerprint: string, claim: string, now: string, optionRevision?: number,seoSource?:SeoRetrySourceGuard) {
  const db = await database();
  if (optionRevision !== undefined && (!Number.isSafeInteger(optionRevision) || optionRevision < 0)) throw Error('Invalid options retry revision');
  const retryGuard = optionRevision === undefined ? '' : `AND COALESCE((SELECT revision FROM product_options WHERE product_id=translation_jobs.product_id AND owner_id=translation_jobs.owner_id),0)=?
    AND NOT EXISTS(SELECT 1 FROM product_removals WHERE product_id=translation_jobs.product_id AND owner_id=translation_jobs.owner_id)`;
  const sourceGuard=await seoSourceGuard(seoSource);
  const row = await db.prepare(`UPDATE translation_jobs SET status='running',started_at=?,claim_token=?
    WHERE owner_id=? AND product_id=? AND id=? AND status='approved' AND review_fingerprint=? AND expires_at>?
    AND EXISTS(SELECT 1 FROM products WHERE id=translation_jobs.product_id AND owner_id=translation_jobs.owner_id AND updated_at=translation_jobs.product_version)
    AND COALESCE((SELECT revision FROM product_content WHERE product_id=translation_jobs.product_id AND owner_id=translation_jobs.owner_id),0)=content_revision
    AND NOT EXISTS(SELECT 1 FROM translation_jobs other WHERE other.owner_id=translation_jobs.owner_id AND other.product_id=translation_jobs.product_id
      AND other.id<>translation_jobs.id AND other.status IN ('running','uncertain')
      AND (translation_jobs.idempotency_key LIKE 'options-retry-%' OR other.idempotency_key LIKE 'options-retry-%'
        OR translation_jobs.idempotency_key LIKE 'seo-retry-%' OR other.idempotency_key LIKE 'seo-retry-%'))
    ${retryGuard}
    ${sourceGuard.sql}
    RETURNING *`).bind(now, claim, ownerId, productId, id, reviewFingerprint, now, ...(optionRevision === undefined ? [] : [optionRevision]),...sourceGuard.args).first<Row>();
  return row ? job(row) : null;
}

export async function finishTranslationJob(ownerId: string, productId: string, id: string, claim: string, result: TranslationResult | null, error: TranslationJob['error'], now: string) {
  const db = await database();
  const status = result ? 'completed' : error?.code === 'PROVIDER_OUTCOME_UNCERTAIN' ? 'uncertain' : 'failed';
  const row = await db.prepare(`UPDATE translation_jobs SET status=?,result=?,error=?,finished_at=?
    WHERE owner_id=? AND product_id=? AND id=? AND status='running' AND claim_token=? RETURNING *`)
    .bind(status, result ? JSON.stringify(result) : null, error ? JSON.stringify(error) : null, now, ownerId, productId, id, claim).first<Row>();
  return row ? job(row) : null;
}

/** One intake generation per product, independent of later edit revisions. */
export async function findIntakeTranslation(ownerId:string,productId:string) {
 const db=await database();
 const existing=await db.prepare('SELECT * FROM translation_jobs WHERE owner_id=? AND product_id=? AND idempotency_key=?').bind(ownerId,productId,'intake-auto-v1').first<Row>();
 return existing?job(existing):null;
}

/** Exact immutable option batch lookup, scoped to its owner and product. */
export async function findIntakeOptionsTranslation(ownerId:string,productId:string,attributesFingerprint:string) {
 if(!/^[a-f0-9]{64}$/.test(attributesFingerprint))throw Error('Invalid option batch fingerprint');
 const db=await database();
 const existing=await db.prepare('SELECT * FROM translation_jobs WHERE owner_id=? AND product_id=? AND idempotency_key=?').bind(ownerId,productId,'intake-options-'+attributesFingerprint).first<Row>();
 return existing?job(existing):null;
}
