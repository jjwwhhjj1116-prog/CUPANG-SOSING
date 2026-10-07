import { env } from 'cloudflare:workers';
import { collectionResultSchema } from '@/db/collection-results';
import type { CollectionJob, CollectionRequest, CollectionContext } from '@/app/sourcing';
import { SUPPLIER_HUB_COMPANIES, supplierHubCompany } from '@/app/supplier-hub-company';

// Separate intake from products: without a provider response there is no product,
// price, option count, or successful collection to persist.
export const collectionSchema = `CREATE TABLE IF NOT EXISTS collection_jobs (
  id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, offer_id TEXT NOT NULL,
  source_url TEXT NOT NULL, goal TEXT NOT NULL CHECK(goal IN ('collect','price','work','transmit')),
  status TEXT NOT NULL CHECK(status IN ('awaiting_connector','cancelled')),
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
)`;
// The offer claim is disposable deduplication metadata. Historical jobs remain
// unchanged when a removed product is sourced again or later restored.
export const collectionOfferClaimSchema = `CREATE TABLE IF NOT EXISTS collection_offer_claims (
  owner_id TEXT NOT NULL, offer_id TEXT NOT NULL,
  job_id TEXT NOT NULL UNIQUE REFERENCES collection_jobs(id),
  PRIMARY KEY(owner_id, offer_id)
)`;
export const retireLegacyOfferIndex = 'DROP INDEX IF EXISTS idx_collection_active_offer';
export const collectionProductSchema=`CREATE TABLE IF NOT EXISTS collection_products (
 job_id TEXT PRIMARY KEY REFERENCES collection_jobs(id), owner_id TEXT NOT NULL,
 product_id TEXT NOT NULL UNIQUE REFERENCES products(id), created_at TEXT NOT NULL
)`;

const columns = 'id, offer_id, source_url, goal, status, created_at, updated_at';
const selectColumns = `${columns}, (SELECT payload FROM collection_context WHERE job_id=collection_jobs.id) AS context_json, (SELECT product_id FROM collection_products WHERE job_id=collection_jobs.id) AS product_id, (SELECT received_at FROM collection_results WHERE job_id=collection_jobs.id AND owner_id=collection_jobs.owner_id) AS received_at`;
type JobRow = CollectionJob & { context_json?: string | null };
function withContext(row: JobRow): CollectionJob {
  const { context_json, ...job } = row;
  return { ...job, context: context_json ? JSON.parse(context_json) : null };
}

export async function ensureCollectionDatabase() {
  if (!env.DB) throw new Error('D1 unavailable');
  await env.DB.batch([
    env.DB.prepare(collectionSchema), env.DB.prepare(collectionOfferClaimSchema), env.DB.prepare(collectionProductSchema), env.DB.prepare(collectionResultSchema),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS product_removals (
      product_id TEXT PRIMARY KEY REFERENCES products(id), owner_id TEXT NOT NULL,
      removed_at TEXT NOT NULL, product_version TEXT NOT NULL
    )`),
    env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_collection_owner_time ON collection_jobs(owner_id, created_at)'),
    env.DB.prepare('CREATE TABLE IF NOT EXISTS collection_context (job_id TEXT PRIMARY KEY REFERENCES collection_jobs(id), payload TEXT NOT NULL)'),
    env.DB.prepare(retireLegacyOfferIndex),
  ]);
  return env.DB;
}

export async function listCollectionJobs(owner: string) {
  const db = await ensureCollectionDatabase();
  return (await db.prepare(`SELECT ${selectColumns} FROM collection_jobs WHERE owner_id = ? ORDER BY created_at DESC, id DESC LIMIT 200`)
    .bind(owner).all<JobRow>()).results.map(withContext);
}

export async function findCollectionJob(owner: string, id: string) {
  const db=await ensureCollectionDatabase();
  const row=await db.prepare(`SELECT ${selectColumns} FROM collection_jobs WHERE owner_id=? AND id=?`).bind(owner,id).first<JobRow>();
  return row?withContext(row):null;
}

export async function enqueueCollection(owner: string, requests: CollectionRequest[], context: CollectionContext | null = null) {
  const db = await ensureCollectionDatabase();
  const now = new Date().toISOString();
  const company=supplierHubCompany(context?.category?.hubSchema?.company?.code,context?.category?.hubSchema?.company?.name);
  const otherCompanies=company?SUPPLIER_HUB_COMPANIES.filter(other=>other.code!==company.code||other.name!==company.name):[];
  // Only an explicitly known different company on an owned, already linked
  // product retires a claim. Missing/invalid company facts and pending drafts
  // keep their first form; historical sources themselves are never rewritten.
  const differentLinkedCompany=otherCompanies.length?`EXISTS(SELECT 1 FROM collection_products cp
    JOIN products p ON p.id=cp.product_id AND p.owner_id=cp.owner_id
    JOIN collection_context c ON c.job_id=cp.job_id
    WHERE cp.job_id=j.id AND cp.owner_id=j.owner_id AND CASE WHEN json_valid(c.payload) THEN
      json_type(c.payload,'$.category.hubSchema.company')='object'
      AND json_type(c.payload,'$.category.hubSchema.company.code')='text'
      AND json_type(c.payload,'$.category.hubSchema.company.name')='text'
      AND (${otherCompanies.map(()=>`(trim(json_extract(c.payload,'$.category.hubSchema.company.code'))=?
        AND trim(json_extract(c.payload,'$.category.hubSchema.company.name'))=?)`).join(' OR ')})
      ELSE 0 END)`:'0';
  const companyValues=otherCompanies.flatMap(other=>[other.code,other.name]);
  // Claim retirement, legacy backfill and new job/context creation happen in
  // one transaction. Removed or clearly other-company linked products release
  // their disposable offer claim; current-company drafts and retries retain it.
  const statements = requests.flatMap(request => {
    const id=crypto.randomUUID();
    return [db.prepare(`DELETE FROM collection_offer_claims
      WHERE owner_id=? AND offer_id=? AND EXISTS(SELECT 1 FROM collection_jobs j
        WHERE j.id=collection_offer_claims.job_id AND j.owner_id=collection_offer_claims.owner_id
          AND (j.status='cancelled' OR EXISTS(SELECT 1 FROM collection_products cp
            JOIN product_removals r ON r.product_id=cp.product_id AND r.owner_id=cp.owner_id
            WHERE cp.job_id=j.id AND cp.owner_id=j.owner_id) OR ${differentLinkedCompany}))`).bind(owner,request.offerId,...companyValues),
    db.prepare(`INSERT INTO collection_offer_claims(owner_id,offer_id,job_id)
      SELECT j.owner_id,j.offer_id,j.id FROM collection_jobs j
      WHERE j.owner_id=? AND j.offer_id=? AND j.status='awaiting_connector'
        AND NOT EXISTS(SELECT 1 FROM collection_products cp JOIN product_removals r
          ON r.product_id=cp.product_id AND r.owner_id=cp.owner_id
          WHERE cp.job_id=j.id AND cp.owner_id=j.owner_id)
        AND NOT (${differentLinkedCompany})
      ORDER BY j.created_at DESC,j.id DESC LIMIT 1
      ON CONFLICT(owner_id,offer_id) DO NOTHING`).bind(owner,request.offerId,...companyValues),
    db.prepare(`INSERT INTO collection_jobs
    (id, owner_id, offer_id, source_url, goal, status, created_at, updated_at)
    SELECT ?, ?, ?, ?, ?, 'awaiting_connector', ?, ?
    WHERE NOT EXISTS(SELECT 1 FROM collection_offer_claims WHERE owner_id=? AND offer_id=?)`)
    .bind(id, owner, request.offerId, request.sourceUrl, request.goal, now, now,owner,request.offerId),
    db.prepare(`INSERT INTO collection_context(job_id,payload)
      SELECT id, ? FROM collection_jobs WHERE owner_id=? AND id=?
      ON CONFLICT(job_id) DO NOTHING`).bind(JSON.stringify(context),owner,id),
    db.prepare(`INSERT INTO collection_offer_claims(owner_id,offer_id,job_id)
      SELECT owner_id,offer_id,id FROM collection_jobs WHERE owner_id=? AND id=?
      ON CONFLICT(owner_id,offer_id) DO NOTHING`).bind(owner,id),
    db.prepare(`SELECT ${selectColumns} FROM collection_jobs
      WHERE owner_id=? AND id=(SELECT job_id FROM collection_offer_claims WHERE owner_id=? AND offer_id=?)`)
      .bind(owner,owner,request.offerId),
  ];});
  const results = await db.batch<JobRow>(statements);
  return results.filter((_,index)=>index%6===5).map(result => {
    const job = result.results[0];
    if (!job) throw new Error('Missing persisted job');
    return withContext(job);
  });
}

export async function cancelCollection(owner: string, id: string) {
  const db = await ensureCollectionDatabase();
  // Cancelling again is harmless; never expose another owner's job.
  const row = await db.prepare(`UPDATE collection_jobs SET status = 'cancelled',
    updated_at = CASE WHEN status = 'cancelled' THEN updated_at ELSE ? END
    WHERE owner_id = ? AND id = ? AND status IN ('awaiting_connector','cancelled') AND NOT EXISTS(SELECT 1 FROM collection_products WHERE job_id=collection_jobs.id) RETURNING ${selectColumns}`)
    .bind(new Date().toISOString(), owner, id).first<JobRow>();
  return row ? withContext(row) : null;
}
