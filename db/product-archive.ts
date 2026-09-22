import { env } from 'cloudflare:workers';
import { ensureDatabase } from '@/db/queries';
import { collectionSchema, collectionUniqueIndex } from '@/db/collection-jobs';
import { archiveOfferId, nextArchiveCursor, type ArchiveItem, type ArchivePage, type ArchiveQuery } from '@/app/product-archive';

export const archiveProductIndex = 'CREATE INDEX IF NOT EXISTS idx_products_owner_created_id ON products(owner_id, created_at DESC, id DESC)';
export const archiveRequestIndex = 'CREATE INDEX IF NOT EXISTS idx_collection_owner_created_id ON collection_jobs(owner_id, created_at DESC, id DESC)';
export const archiveRequestUrlIndex = 'CREATE INDEX IF NOT EXISTS idx_collection_owner_source_created ON collection_jobs(owner_id, source_url, created_at DESC, id DESC)';
async function database() {
  await ensureDatabase();
  if (!env.DB) throw new Error('D1 unavailable');
  await env.DB.batch([env.DB.prepare(collectionSchema), env.DB.prepare(collectionUniqueIndex),
    env.DB.prepare('CREATE TABLE IF NOT EXISTS collection_context (job_id TEXT PRIMARY KEY REFERENCES collection_jobs(id), payload TEXT NOT NULL)'),
    env.DB.prepare(archiveProductIndex), env.DB.prepare(archiveRequestIndex), env.DB.prepare(archiveRequestUrlIndex)]);
  return env.DB;
}
type ArchiveRow = { id: string; source_kind: 'product' | 'request'; title: string; source_url: string; offer_id: string | null;
  created_at: string; updated_at: string; status: string; supplier_hub_status: string | null; category_json: string | null; request_id: string | null };
function category(row: ArchiveRow): ArchiveItem['category'] {
  if (!row.category_json || !row.request_id) return null;
  try { const value = JSON.parse(row.category_json);
    if (!value || typeof value.id !== 'string' || value.id.length > 120 || !Array.isArray(value.path) || value.path.length > 10 || value.path.some((part: unknown) => typeof part !== 'string' || part.length > 120)) return null;
    return { id: value.id, path: value.path, source: row.source_kind === 'request' ? 'request-snapshot' : 'matching-request', requestId: row.request_id };
  } catch { return null; }
}

export async function listProductArchive(ownerId: string, query: ArchiveQuery): Promise<ArchivePage> {
  const db = await database();
  // Bind every value; only these fixed column aliases are composed into SQL.
  const predicate = (alias: 'p' | 'j', kind: 'product' | 'request') => {
    const args: (string | number)[] = [ownerId]; const conditions = [`${alias}.owner_id=?`];
    if (query.startUtc) { conditions.push(`${alias}.created_at>=?`); args.push(query.startUtc); }
    if (query.endUtc) { conditions.push(`${alias}.created_at<?`); args.push(query.endUtc); }
    if (query.query) { conditions.push(kind === 'product' ? `(instr(lower(p.title),lower(?))>0 OR instr(lower(p.source_url),lower(?))>0)` : `(instr(lower(j.source_url),lower(?))>0 OR instr(j.offer_id,?)>0)`); args.push(query.query, query.query); }
    if (query.cursor) { conditions.push(`(${alias}.created_at,${alias}.id,'${kind}')<(?,?,?)`); args.push(query.cursor.createdAt, query.cursor.id, query.cursor.kind); }
    return { sql: conditions.join(' AND '), args };
  };
  const products = predicate('p', 'product'); const requests = predicate('j', 'request');
  // Enrichment happens only after the bounded union page. A matching URL links
  // a request snapshot for reference; it is not asserted as product provenance.
  const result = await db.prepare(`WITH history AS (
      SELECT p.id,'product' AS source_kind,p.title,p.source_url,NULL AS offer_id,p.created_at,p.updated_at,p.registration_status AS status,p.supplier_hub_status
      FROM products p WHERE ${products.sql}
      UNION ALL
      SELECT j.id,'request' AS source_kind,'' AS title,j.source_url,j.offer_id,j.created_at,j.updated_at,j.status,NULL AS supplier_hub_status
      FROM collection_jobs j WHERE ${requests.sql}
    ), page AS (SELECT * FROM history ORDER BY created_at DESC,id DESC,source_kind DESC LIMIT ?), linked AS (
      SELECT page.*,CASE WHEN source_kind='request' THEN id ELSE (
        SELECT j.id FROM collection_jobs j WHERE j.owner_id=? AND j.source_url=substr(page.source_url,1,min(instr(page.source_url||'?','?'),instr(page.source_url||'#','#'))-1)
        ORDER BY j.created_at DESC,j.id DESC LIMIT 1) END AS request_id FROM page
    ) SELECT linked.*,CASE WHEN json_valid(c.payload) THEN json_object('id',json_extract(c.payload,'$.category.categoryId'),'path',json_extract(c.payload,'$.category.categoryPath')) ELSE NULL END AS category_json
      FROM linked LEFT JOIN collection_context c ON c.job_id=linked.request_id ORDER BY created_at DESC,id DESC,source_kind DESC`)
    .bind(...products.args, ...requests.args, query.limit + 1, ownerId).all<ArchiveRow>();
  const hasMore = result.results.length > query.limit;
  const items = result.results.slice(0, query.limit).map((row): ArchiveItem => ({ id: row.id, sourceKind: row.source_kind,
    title: row.title, sourceUrl: row.source_url, offerId: row.offer_id || archiveOfferId(row.source_url), createdAt: row.created_at,
    updatedAt: row.updated_at, status: row.status, supplierHubStatus: row.supplier_hub_status, category: category(row) }));
  return { items, nextCursor: hasMore && items.length ? await nextArchiveCursor(items[items.length - 1], query) : null,
    range: query.range, from: query.from, to: query.to, query: query.query, limit: query.limit, timeZone: 'Asia/Seoul' };
}
