import { env } from 'cloudflare:workers';
import { collectionResultSchema } from '@/db/collection-results';
import type { CollectionJob, CollectionRequest, CollectionContext } from '@/app/sourcing';

// Separate intake from products: without a provider response there is no product,
// price, option count, or successful collection to persist.
export const collectionSchema = `CREATE TABLE IF NOT EXISTS collection_jobs (
  id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, offer_id TEXT NOT NULL,
  source_url TEXT NOT NULL, goal TEXT NOT NULL CHECK(goal IN ('collect','price','work','transmit')),
  status TEXT NOT NULL CHECK(status IN ('awaiting_connector','cancelled')),
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
)`;
export const collectionUniqueIndex = `CREATE UNIQUE INDEX IF NOT EXISTS idx_collection_active_offer
  ON collection_jobs(owner_id, offer_id) WHERE status = 'awaiting_connector'`;
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

async function database() {
  if (!env.DB) throw new Error('D1 unavailable');
  await env.DB.batch([
    env.DB.prepare(collectionSchema), env.DB.prepare(collectionUniqueIndex), env.DB.prepare(collectionProductSchema), env.DB.prepare(collectionResultSchema),
    env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_collection_owner_time ON collection_jobs(owner_id, created_at)'),
    env.DB.prepare('CREATE TABLE IF NOT EXISTS collection_context (job_id TEXT PRIMARY KEY REFERENCES collection_jobs(id), payload TEXT NOT NULL)'),
  ]);
  return env.DB;
}

export async function listCollectionJobs(owner: string) {
  const db = await database();
  return (await db.prepare(`SELECT ${selectColumns} FROM collection_jobs WHERE owner_id = ? ORDER BY created_at DESC, id DESC LIMIT 200`)
    .bind(owner).all<JobRow>()).results.map(withContext);
}

export async function findCollectionJob(owner: string, id: string) {
  const db=await database();
  const row=await db.prepare(`SELECT ${selectColumns} FROM collection_jobs WHERE owner_id=? AND id=?`).bind(owner,id).first<JobRow>();
  return row?withContext(row):null;
}

export async function enqueueCollection(owner: string, requests: CollectionRequest[], context: CollectionContext | null = null) {
  const db = await database();
  const now = new Date().toISOString();
  // One D1 transaction. The partial unique index also handles concurrent tabs,
  // repeated clicks, tracking-query variants and a lost HTTP response.
  const statements = requests.flatMap(request => [db.prepare(`INSERT INTO collection_jobs
    (id, owner_id, offer_id, source_url, goal, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 'awaiting_connector', ?, ?)
    ON CONFLICT(owner_id, offer_id) WHERE status = 'awaiting_connector'
    DO UPDATE SET offer_id = excluded.offer_id RETURNING ${columns}`)
    .bind(crypto.randomUUID(), owner, request.offerId, request.sourceUrl, request.goal, now, now),
    db.prepare(`INSERT INTO collection_context(job_id,payload)
      SELECT id, ? FROM collection_jobs WHERE owner_id=? AND offer_id=? AND status='awaiting_connector'
      ON CONFLICT(job_id) DO NOTHING`).bind(JSON.stringify(context),owner,request.offerId),
    db.prepare(`SELECT ${selectColumns} FROM collection_jobs WHERE owner_id=? AND offer_id=? AND status='awaiting_connector'`).bind(owner,request.offerId),
  ]);
  const results = await db.batch<JobRow>(statements);
  return results.filter((_,index)=>index%3===2).map(result => {
    const job = result.results[0];
    if (!job) throw new Error('Missing persisted job');
    return withContext(job);
  });
}

export async function cancelCollection(owner: string, id: string) {
  const db = await database();
  // Cancelling again is harmless; never expose another owner's job.
  const row = await db.prepare(`UPDATE collection_jobs SET status = 'cancelled',
    updated_at = CASE WHEN status = 'cancelled' THEN updated_at ELSE ? END
    WHERE owner_id = ? AND id = ? AND status IN ('awaiting_connector','cancelled') AND NOT EXISTS(SELECT 1 FROM collection_products WHERE job_id=collection_jobs.id) RETURNING ${selectColumns}`)
    .bind(new Date().toISOString(), owner, id).first<JobRow>();
  return row ? withContext(row) : null;
}
