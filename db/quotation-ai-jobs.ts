import { env } from 'cloudflare:workers';
import { sourceGuard, type QuotationSourceGuard } from '@/db/quotation-fields';
import type { SupplierHubCompany } from '@/app/supplier-hub-company';
import type { buildQuotationAiPlan, executeQuotationAi } from '@/app/quotation-ai';
import type {QuotationTextExecution} from '@/app/quotation-text-execution';

export type QuotationAiPlan = ReturnType<typeof buildQuotationAiPlan>;
export type QuotationAiResult = Awaited<ReturnType<typeof executeQuotationAi>>;
export type QuotationAiReview = {
  fingerprint: string; quotationRevision: number; profileId: string | null;
  source: QuotationSourceGuard; company: SupplierHubCompany;
  member: { id: string; email: string; role: string };
  scope: { optionId: string | null; applyToAllOptions: boolean }; plan: QuotationAiPlan;
  executionPolicy?:QuotationTextExecution;
};
export type QuotationAiJob = {
  id: string; productId: string; status: 'prepared' | 'running' | 'completed' | 'failed' | 'uncertain';
  requestFingerprint: string; review: QuotationAiReview; result: QuotationAiResult | null;
  error: { code: string; message: string; uncertain: boolean } | null;
  createdAt: string; startedAt: string | null; finishedAt: string | null;
};
type Row = { id: string; product_id: string; status: QuotationAiJob['status']; request_fingerprint: string;
  review: string; result: string | null; error: string | null; created_at: string; started_at: string | null; finished_at: string | null };
export const quotationAiJobsSchema = `CREATE TABLE IF NOT EXISTS quotation_ai_jobs (
  id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, product_id TEXT NOT NULL REFERENCES products(id),
  idempotency_key TEXT NOT NULL, request_fingerprint TEXT NOT NULL, review TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('prepared','running','completed','failed','uncertain')),
  result TEXT, error TEXT, claim_token TEXT, created_at TEXT NOT NULL, started_at TEXT, finished_at TEXT,
  UNIQUE(owner_id, product_id, idempotency_key)
)`;
async function database() {
  if (!env.DB) throw Error('Quotation AI store unavailable');
  await env.DB.batch([env.DB.prepare(quotationAiJobsSchema),
    env.DB.prepare('CREATE INDEX IF NOT EXISTS quotation_ai_jobs_owner ON quotation_ai_jobs(owner_id,product_id,created_at)'),
    env.DB.prepare("CREATE UNIQUE INDEX IF NOT EXISTS quotation_ai_jobs_running ON quotation_ai_jobs(owner_id,product_id) WHERE status IN ('running','uncertain')"),
    env.DB.prepare('CREATE TABLE IF NOT EXISTS quotation_ai_daily (day TEXT PRIMARY KEY, requests INTEGER NOT NULL CHECK(requests>=0))')]);
  return env.DB;
}
function decode(row: Row): QuotationAiJob {
  return { id: row.id, productId: row.product_id, status: row.status, requestFingerprint: row.request_fingerprint,
    review: JSON.parse(row.review), result: row.result ? JSON.parse(row.result) : null, error: row.error ? JSON.parse(row.error) : null,
    createdAt: row.created_at, startedAt: row.started_at, finishedAt: row.finished_at };
}
export async function findQuotationAiJob(owner: string, productId: string, key: string, byId = false) {
  const db = await database();
  const row = await db.prepare(`SELECT * FROM quotation_ai_jobs WHERE owner_id=? AND product_id=? AND ${byId ? 'id' : 'idempotency_key'}=?`)
    .bind(owner, productId, key).first<Row>();
  return row ? decode(row) : null;
}
export async function listQuotationAiJobs(owner: string, productId: string) {
  const db = await database();
  const rows = await db.prepare('SELECT * FROM quotation_ai_jobs WHERE owner_id=? AND product_id=? ORDER BY created_at DESC,id DESC LIMIT 10')
    .bind(owner, productId).all<Row>();
  return rows.results.map(decode);
}
function membershipGuard(owner: string, review: QuotationAiReview) {
  if ((env as { YOOFAM_AUTH_ENABLED?: string }).YOOFAM_AUTH_ENABLED !== 'true') return { sql: '', args: [] as string[] };
  return { sql: ` AND EXISTS(SELECT 1 FROM members m WHERE m.id=? AND m.id=p.owner_id
    AND lower(trim(m.email))=? AND m.role=? AND m.status='approved' AND m.company_code=? AND m.company_name=?)`,
    args: [owner, review.member.email.toLowerCase().trim(), review.member.role, review.company.code, review.company.name] };
}
export async function createQuotationAiJob(owner: string, productId: string, key: string, requestFingerprint: string, review: QuotationAiReview) {
  const db = await database(), guard = sourceGuard(owner, productId, review.source), membership = membershipGuard(owner, review);
  const payload = JSON.stringify(review);
  if (new TextEncoder().encode(payload).length > 256 * 1024) throw Error('Quotation AI review too large');
  const id = crypto.randomUUID(), now = new Date().toISOString();
  await db.prepare(`INSERT OR IGNORE INTO quotation_ai_jobs(id,owner_id,product_id,idempotency_key,request_fingerprint,review,status,created_at)
    SELECT ?,p.owner_id,p.id,?,?,?,'prepared',? FROM products p WHERE ${guard.sql}
    AND COALESCE((SELECT revision FROM product_quotation_fields q WHERE q.product_id=p.id AND q.owner_id=p.owner_id),0)=?${membership.sql}`)
    .bind(id, key, requestFingerprint, payload, now, ...guard.args, review.quotationRevision, ...membership.args).run();
  return findQuotationAiJob(owner, productId, key);
}
export async function claimQuotationAiJob(owner: string, productId: string, job: QuotationAiJob) {
  const db = await database(), guard = sourceGuard(owner, productId, job.review.source), membership = membershipGuard(owner, job.review);
  const claimToken = crypto.randomUUID(), now = new Date().toISOString();
  const row = await db.prepare(`UPDATE quotation_ai_jobs SET status='running',claim_token=?,started_at=?
    WHERE owner_id=? AND product_id=? AND id=? AND status='prepared' AND review=? AND request_fingerprint=?
    AND NOT EXISTS(SELECT 1 FROM quotation_ai_jobs x WHERE x.owner_id=? AND x.product_id=? AND x.status IN ('running','uncertain'))
    AND EXISTS(SELECT 1 FROM products p WHERE ${guard.sql}
      AND COALESCE((SELECT revision FROM product_quotation_fields q WHERE q.product_id=p.id AND q.owner_id=p.owner_id),0)=?${membership.sql})
    RETURNING *`).bind(claimToken, now, owner, productId, job.id, JSON.stringify(job.review), job.requestFingerprint,
      owner, productId, ...guard.args, job.review.quotationRevision, ...membership.args).first<Row>();
  return row ? { job: decode(row), claimToken } : null;
}
/** Only the claimant can finish; source edits are proposals, never product writes. */
export async function finishQuotationAiJob(owner: string, productId: string, id: string, claimToken: string,
  value: { status: 'completed' | 'failed' | 'uncertain'; result?: QuotationAiResult; error?: QuotationAiJob['error'] }) {
  const db = await database(), result = value.result ? JSON.stringify(value.result) : null;
  if (result && new TextEncoder().encode(result).length > 256 * 1024) throw Error('Quotation AI result too large');
  const row = await db.prepare(`UPDATE quotation_ai_jobs SET status=?,result=?,error=?,finished_at=?
    WHERE owner_id=? AND product_id=? AND id=? AND status='running' AND claim_token=? RETURNING *`)
    .bind(value.status, result, value.error ? JSON.stringify(value.error) : null, new Date().toISOString(), owner, productId, id, claimToken).first<Row>();
  return row ? decode(row) : null;
}
export async function closeUncertainQuotationAiJob(owner: string, productId: string, job: QuotationAiJob) {
  const db = await database(), membership = membershipGuard(owner, job.review);
  const cutoff = new Date(Date.now() - 5 * 60_000).toISOString();
  const row = await db.prepare(`UPDATE quotation_ai_jobs SET status='failed',finished_at=?
    WHERE owner_id=? AND product_id=? AND id=? AND review=?
    AND (status='uncertain' OR status='running' AND started_at<?)
    AND EXISTS(SELECT 1 FROM products p WHERE p.id=? AND p.owner_id=?${membership.sql}) RETURNING *`)
    .bind(new Date().toISOString(), owner, productId, job.id, JSON.stringify(job.review), cutoff, productId, owner, ...membership.args).first<Row>();
  return row ? decode(row) : null;
}
/** Account-wide local cap; a free-plan provider refusal never triggers another provider. */
export async function reserveQuotationAiRequest(limit = 40) {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 40) throw Error('Invalid quotation AI daily cap');
  const db = await database(), day = new Date().toISOString().slice(0, 10);
  const row = await db.prepare(`INSERT INTO quotation_ai_daily(day,requests) VALUES(?,1)
    ON CONFLICT(day) DO UPDATE SET requests=requests+1 WHERE requests<? RETURNING requests`)
    .bind(day, limit).first<{ requests: number }>();
  return Boolean(row && row.requests <= limit);
}
