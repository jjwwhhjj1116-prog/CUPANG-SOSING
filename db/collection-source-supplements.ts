import { env } from 'cloudflare:workers';
import { readCollectionResult } from '@/db/collection-results';
import type { CollectionResult } from '@/app/collection-result';

/** Append one verified supplement, leaving the original receipt/context and all
 * edited fields intact. Bumping a linked product invalidates old AI/quote reviews. */
export async function storeCollectionSupplement(owner: string, jobId: string, original: CollectionResult, captured: CollectionResult, merged: CollectionResult,
  product: { id: string; updated_at: string } | null) {
  if (!env.DB) throw Error('D1 unavailable');
  await readCollectionResult(owner, jobId);
  const db = env.DB, now = new Date(Math.max(Date.now(), product ? Date.parse(product.updated_at) + 1 : 0)).toISOString();
  const productGuard = product
    ? 'EXISTS(SELECT 1 FROM collection_products cp JOIN products p ON p.id=cp.product_id AND p.owner_id=cp.owner_id WHERE cp.job_id=j.id AND cp.owner_id=j.owner_id AND p.id=? AND p.updated_at=? AND p.source_url=j.source_url)'
    : 'NOT EXISTS(SELECT 1 FROM collection_products cp WHERE cp.job_id=j.id)';
  const statements = [db.prepare(`INSERT INTO collection_source_supplements(job_id,owner_id,base_payload,captured_payload,payload,received_at)
    SELECT j.id,j.owner_id,r.payload,?,?,? FROM collection_jobs j JOIN collection_results r ON r.job_id=j.id AND r.owner_id=j.owner_id
    WHERE j.id=? AND j.owner_id=? AND j.status='awaiting_connector' AND j.offer_id=? AND j.source_url=? AND r.payload=? AND ${productGuard}
    ON CONFLICT(job_id) DO NOTHING`).bind(JSON.stringify(captured), JSON.stringify(merged), now, jobId, owner, original.offerId, original.sourceUrl, JSON.stringify(original),
      ...(product ? [product.id, product.updated_at] : []))];
  if (product) statements.push(db.prepare(`UPDATE products SET updated_at=?,quote_status='대기' WHERE id=? AND owner_id=? AND updated_at=? AND changes()=1`)
    .bind(now, product.id, owner, product.updated_at));
  await db.batch(statements);
  const row = await db.prepare('SELECT payload FROM collection_source_supplements WHERE job_id=? AND owner_id=? AND base_payload=?')
    .bind(jobId, owner, JSON.stringify(original)).first<{payload: string}>();
  return row && row.payload === JSON.stringify(merged) ? readCollectionResult(owner, jobId) : null;
}
