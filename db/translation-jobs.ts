import { env } from 'cloudflare:workers';
import type { TranslationJob, TranslationResult } from '@/app/automation/translation';

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
  const existing = await db.prepare('SELECT * FROM translation_jobs WHERE owner_id=? AND product_id=? AND idempotency_key=?').bind(ownerId, value.productId, key).first<Row>();
  return existing ? { job: job(existing), replayed: true, conflict: existing.request_fingerprint !== requestFingerprint } : null;
}

export async function approveTranslationJob(ownerId: string, productId: string, id: string, reviewFingerprint: string, now: string) {
  const db = await database();
  const row = await db.prepare(`UPDATE translation_jobs SET status='approved',approved_at=?
    WHERE owner_id=? AND product_id=? AND id=? AND status='prepared' AND review_fingerprint=? AND expires_at>?
    AND EXISTS(SELECT 1 FROM products WHERE id=translation_jobs.product_id AND owner_id=translation_jobs.owner_id AND updated_at=translation_jobs.product_version)
    AND COALESCE((SELECT revision FROM product_content WHERE product_id=translation_jobs.product_id AND owner_id=translation_jobs.owner_id),0)=content_revision
    RETURNING *`).bind(now, ownerId, productId, id, reviewFingerprint, now).first<Row>();
  return row ? job(row) : null;
}

export async function claimTranslationJob(ownerId: string, productId: string, id: string, reviewFingerprint: string, claim: string, now: string) {
  const db = await database();
  const row = await db.prepare(`UPDATE translation_jobs SET status='running',started_at=?,claim_token=?
    WHERE owner_id=? AND product_id=? AND id=? AND status='approved' AND review_fingerprint=? AND expires_at>?
    AND EXISTS(SELECT 1 FROM products WHERE id=translation_jobs.product_id AND owner_id=translation_jobs.owner_id AND updated_at=translation_jobs.product_version)
    AND COALESCE((SELECT revision FROM product_content WHERE product_id=translation_jobs.product_id AND owner_id=translation_jobs.owner_id),0)=content_revision
    RETURNING *`).bind(now, claim, ownerId, productId, id, reviewFingerprint, now).first<Row>();
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
