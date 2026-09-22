import { env } from 'cloudflare:workers';
import type { ImageEditJob, ImageEditResult } from '@/app/automation/image-edit';
import { defaultSettings } from '@/app/workspace-settings';

type Row = { id: string; product_id: string; product_version: string; content_revision: number; product_image_keys: string;
  status: ImageEditJob['status']; review: string; result: string | null; error: string | null;
  created_at: string; approved_at: string | null; started_at: string | null; finished_at: string | null; request_fingerprint: string };
async function database() {
  if (!env.DB) throw new Error('D1 unavailable');
  await env.DB.batch([env.DB.prepare(`CREATE TABLE IF NOT EXISTS image_jobs (
    id TEXT PRIMARY KEY,owner_id TEXT NOT NULL,product_id TEXT NOT NULL,idempotency_key TEXT NOT NULL,
    request_fingerprint TEXT NOT NULL,product_version TEXT NOT NULL,content_revision INTEGER NOT NULL,product_image_keys TEXT NOT NULL,
    status TEXT NOT NULL,review_fingerprint TEXT NOT NULL,review TEXT NOT NULL,expires_at TEXT NOT NULL,
    result TEXT,error TEXT,claim_token TEXT,created_at TEXT NOT NULL,approved_at TEXT,started_at TEXT,finished_at TEXT,
    UNIQUE(owner_id,product_id,idempotency_key),FOREIGN KEY(product_id) REFERENCES products(id)
  )`), env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_image_jobs_owner_product ON image_jobs(owner_id,product_id,created_at)'),
  env.DB.prepare('CREATE TABLE IF NOT EXISTS workspace_settings(owner_id TEXT PRIMARY KEY,payload TEXT NOT NULL,updated_at TEXT NOT NULL)')]);
  return env.DB;
}
const imageSettingsKeys = ['translateImages', 'removeBackground', 'addCopyright', 'translationPrompt'] as const;
// Compare only settings that participate in this reviewed image recipe. The
// same D1 statement guards the claim, so a concurrent settings save cannot
// spend using an unreviewed configuration after the route's earlier read.
function settingsGuard(owner: string, review: string) {
  return imageSettingsKeys.map(key => {
    const fallback = typeof defaultSettings[key] === 'boolean' ? Number(defaultSettings[key]) : "''";
    return `AND COALESCE((SELECT json_extract(payload,'$.${key}') FROM workspace_settings WHERE owner_id=${owner}),${fallback})=json_extract(${review},'$.settingsSnapshot.${key}')`;
  }).join('\n');
}
function job(row: Row): ImageEditJob {
  return { id: row.id, productId: row.product_id, productVersion: row.product_version, contentRevision: row.content_revision,
    status: row.status, review: JSON.parse(row.review), result: row.result ? JSON.parse(row.result) : null, error: row.error ? JSON.parse(row.error) : null,
    createdAt: row.created_at, approvedAt: row.approved_at, startedAt: row.started_at, finishedAt: row.finished_at };
}
export async function listImageJobs(owner: string, productId: string) {
  const db = await database(); const result = await db.prepare('SELECT * FROM image_jobs WHERE owner_id=? AND product_id=? ORDER BY created_at DESC,id DESC LIMIT 20').bind(owner, productId).all<Row>();
  return result.results.map(job);
}
export async function getImageJob(owner: string, productId: string, id: string) {
  const db = await database(); const row = await db.prepare('SELECT * FROM image_jobs WHERE owner_id=? AND product_id=? AND id=?').bind(owner, productId, id).first<Row>();
  return row ? job(row) : null;
}
export async function createImageJob(owner: string, value: ImageEditJob, imageKeys: string, key: string, requestFingerprint: string) {
  const db = await database();
  const row = await db.prepare(`INSERT INTO image_jobs(id,owner_id,product_id,idempotency_key,request_fingerprint,product_version,content_revision,product_image_keys,
    status,review_fingerprint,review,expires_at,created_at)
    SELECT ?,?,?,?,?,?,?,?,'prepared',?,?,?,? WHERE EXISTS(SELECT 1 FROM products WHERE id=? AND owner_id=? AND updated_at=? AND image_keys=?)
    AND COALESCE((SELECT revision FROM product_content WHERE product_id=? AND owner_id=?),0)=?
    ${settingsGuard('?', '?')}
    ON CONFLICT(owner_id,product_id,idempotency_key) DO NOTHING RETURNING *`)
    .bind(value.id, owner, value.productId, key, requestFingerprint, value.productVersion, value.contentRevision, imageKeys,
      value.review.fingerprint, JSON.stringify(value.review), value.review.expiresAt, value.createdAt,
      value.productId, owner, value.productVersion, imageKeys, value.productId, owner, value.contentRevision,
      ...imageSettingsKeys.flatMap(() => [owner, JSON.stringify(value.review)])).first<Row>();
  if (row) return { job: job(row), replayed: false, conflict: false };
  const previous = await db.prepare('SELECT * FROM image_jobs WHERE owner_id=? AND product_id=? AND idempotency_key=?').bind(owner, value.productId, key).first<Row>();
  return previous ? { job: job(previous), replayed: true, conflict: previous.request_fingerprint !== requestFingerprint } : null;
}
const unchanged = `AND EXISTS(SELECT 1 FROM products WHERE id=image_jobs.product_id AND owner_id=image_jobs.owner_id
  AND updated_at=image_jobs.product_version AND image_keys=image_jobs.product_image_keys AND json_array_length(image_keys)<50)
  AND COALESCE((SELECT revision FROM product_content WHERE product_id=image_jobs.product_id AND owner_id=image_jobs.owner_id),0)=content_revision
  ${settingsGuard('image_jobs.owner_id', 'image_jobs.review')}`;
export async function approveImageJob(owner: string, productId: string, id: string, reviewFingerprint: string, now: string) {
  const db = await database(); const row = await db.prepare(`UPDATE image_jobs SET status='approved',approved_at=?
    WHERE owner_id=? AND product_id=? AND id=? AND status='prepared' AND review_fingerprint=? AND expires_at>? ${unchanged} RETURNING *`)
    .bind(now, owner, productId, id, reviewFingerprint, now).first<Row>();
  return row ? job(row) : null;
}
export async function claimImageJob(owner: string, productId: string, id: string, reviewFingerprint: string, claim: string, now: string) {
  const db = await database(); const row = await db.prepare(`UPDATE image_jobs SET status='running',started_at=?,claim_token=?
    WHERE owner_id=? AND product_id=? AND id=? AND status='approved' AND review_fingerprint=? AND expires_at>? ${unchanged} RETURNING *`)
    .bind(now, claim, owner, productId, id, reviewFingerprint, now).first<Row>();
  return row ? job(row) : null;
}
export async function finishImageFailure(owner: string, productId: string, id: string, claim: string, error: NonNullable<ImageEditJob['error']>) {
  const db = await database(); const row = await db.prepare(`UPDATE image_jobs SET status=?,error=?,finished_at=?
    WHERE owner_id=? AND product_id=? AND id=? AND status='running' AND claim_token=? RETURNING *`)
    .bind(error.code === 'PROVIDER_OUTCOME_UNCERTAIN' ? 'uncertain' : 'failed', JSON.stringify(error), new Date().toISOString(), owner, productId, id, claim).first<Row>();
  return row ? job(row) : null;
}

/** R2 output already exists. If the product changed, retain it as a completed unassigned result for free attachment later. */
export async function finishImageSuccess(owner: string, value: ImageEditJob, claim: string, result: ImageEditResult) {
  const db = await database(); const updatedAt = new Date(Math.max(Date.now(), Date.parse(value.productVersion) + 1)).toISOString();
  const rows = await db.batch<Row>([
    db.prepare(`UPDATE products SET image_keys=json_insert(image_keys,'$[#]',?),quote_status='대기',updated_at=?
      WHERE owner_id=? AND id=? AND updated_at=? AND json_array_length(image_keys)<50
      AND NOT EXISTS(SELECT 1 FROM json_each(products.image_keys) WHERE value=?)
      AND EXISTS(SELECT 1 FROM image_jobs WHERE id=? AND owner_id=? AND product_id=products.id AND status='running' AND claim_token=? AND product_image_keys=products.image_keys)
      AND COALESCE((SELECT revision FROM product_content WHERE product_id=products.id AND owner_id=products.owner_id),0)=?`)
      .bind(result.storageKey, updatedAt, owner, value.productId, value.productVersion, result.storageKey, value.id, owner, claim, value.contentRevision),
    db.prepare(`UPDATE image_jobs SET status='completed',result=json_set(?,'$.attached',json(CASE WHEN changes()=1 THEN 'true' ELSE 'false' END)),finished_at=?
      WHERE owner_id=? AND product_id=? AND id=? AND status='running' AND claim_token=? RETURNING *`)
      .bind(JSON.stringify(result), new Date().toISOString(), owner, value.productId, value.id, claim),
  ]);
  return rows[1].results[0] ? job(rows[1].results[0]) : null;
}

/** Attaches an already generated owned result; never invokes any model. */
export async function attachImageResult(owner: string, value: ImageEditJob, expectedVersion: string, imageKeys: string) {
  if (!value.result) return null;
  const db = await database(); const updatedAt = new Date(Math.max(Date.now(), Date.parse(expectedVersion) + 1)).toISOString();
  const rows = await db.batch<Row>([
    db.prepare(`UPDATE products SET image_keys=json_insert(image_keys,'$[#]',?),quote_status='대기',updated_at=?
      WHERE owner_id=? AND id=? AND updated_at=? AND image_keys=? AND json_array_length(image_keys)<50
      AND NOT EXISTS(SELECT 1 FROM json_each(products.image_keys) WHERE value=?)
      AND EXISTS(SELECT 1 FROM image_jobs WHERE id=? AND owner_id=? AND product_id=products.id AND status='completed' AND json_extract(result,'$.storageKey')=?)`)
      .bind(value.result.storageKey, updatedAt, owner, value.productId, expectedVersion, imageKeys, value.result.storageKey, value.id, owner, value.result.storageKey),
    db.prepare(`UPDATE image_jobs SET result=json_set(result,'$.attached',json('true')) WHERE owner_id=? AND product_id=? AND id=? AND status='completed'
      AND (changes()=1 OR EXISTS(SELECT 1 FROM products,json_each(products.image_keys) WHERE products.id=image_jobs.product_id AND products.owner_id=image_jobs.owner_id AND json_each.value=json_extract(image_jobs.result,'$.storageKey'))) RETURNING *`)
      .bind(owner, value.productId, value.id),
  ]);
  return rows[1].results[0] ? job(rows[1].results[0]) : null;
}
