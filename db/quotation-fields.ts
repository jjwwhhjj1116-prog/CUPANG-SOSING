import { env } from 'cloudflare:workers';
import { emptyQuotationOverrides, type QuotationOverrides } from '@/app/quotation-schema';
import { collectionSchema, collectionProductSchema } from '@/db/collection-jobs';

export const quotationFieldsSchema = `CREATE TABLE IF NOT EXISTS product_quotation_fields (
  product_id TEXT PRIMARY KEY REFERENCES products(id), owner_id TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK(revision > 0), payload TEXT NOT NULL, updated_at TEXT NOT NULL
)`;
export type QuotationFieldsState = { schemaVersion: 1; productId: string; revision: number; overrides: QuotationOverrides; updatedAt: string | null };
export type QuotationCollectionSource = { id: string; payload: string; updatedAt: string; linked?: boolean };
export type QuotationSourceGuard = {
  productVersion: string; imageKeys: string; pricingPolicy: string | null;
  contentRevision: number; optionRevision: number; settingsPayload: string | null;
  profile: { id: string; revision: number } | null;
  collection: { offerId: string; snapshot: QuotationCollectionSource | null } | null;
};
type Row = { payload: string; revision: number };
async function database() {
  if (!env.DB) throw new Error('D1 unavailable');
  await env.DB.batch([env.DB.prepare(quotationFieldsSchema), env.DB.prepare(collectionSchema), env.DB.prepare(collectionProductSchema),
    env.DB.prepare('CREATE TABLE IF NOT EXISTS collection_context (job_id TEXT PRIMARY KEY REFERENCES collection_jobs(id), payload TEXT NOT NULL)')]);
  return env.DB;
}
export async function readQuotationFields(owner: string, productId: string): Promise<QuotationFieldsState> {
  const db = await database();
  const row = await db.prepare('SELECT payload,revision FROM product_quotation_fields WHERE owner_id=? AND product_id=?').bind(owner, productId).first<Row>();
  if (!row) return { schemaVersion: 1, productId, revision: 0, overrides: emptyQuotationOverrides(), updatedAt: null };
  const state = JSON.parse(row.payload) as QuotationFieldsState;
  if (state.schemaVersion !== 1 || state.productId !== productId || state.revision !== row.revision || !state.overrides || !state.overrides.common || !state.overrides.options) throw new Error('Invalid quotation fields');
  return state;
}
export async function readQuotationCollectionSource(owner: string, offerId: string, productId?: string): Promise<QuotationCollectionSource | null> {
  const db = await database();
  if (productId) {
    const link = await db.prepare('SELECT job_id FROM collection_products WHERE owner_id=? AND product_id=?').bind(owner,productId).first<{job_id:string}>();
    if (link) {
      const captured = await db.prepare(`SELECT j.id,c.payload,j.updated_at FROM collection_jobs j JOIN collection_context c ON c.job_id=j.id
        WHERE j.owner_id=? AND j.offer_id=? AND j.id=? AND j.status='awaiting_connector'`).bind(owner,offerId,link.job_id).first<{id:string;payload:string;updated_at:string}>();
      if (!captured) throw new Error('상품에 연결된 카테고리 원문을 확인하지 못했습니다.');
      return {id:captured.id,payload:captured.payload,updatedAt:captured.updated_at,linked:true};
    }
  }
  const row = await db.prepare(`SELECT j.id,c.payload,j.updated_at FROM collection_jobs j JOIN collection_context c ON c.job_id=j.id
    WHERE j.owner_id=? AND j.offer_id=? AND j.status='awaiting_connector' ORDER BY j.created_at DESC,j.id DESC LIMIT 1`)
    .bind(owner, offerId).first<{ id: string; payload: string; updated_at: string }>();
  return row ? { id: row.id, payload: row.payload, updatedAt: row.updated_at } : null;
}
function sourceGuard(owner: string, productId: string, source: QuotationSourceGuard) {
  const conditions = [
    'p.id=? AND p.owner_id=? AND p.updated_at=? AND p.image_keys=?',
    '(SELECT payload FROM product_price_policy WHERE product_id=p.id) IS ?',
    'COALESCE((SELECT revision FROM product_content WHERE product_id=p.id AND owner_id=p.owner_id),0)=?',
    'COALESCE((SELECT revision FROM product_options WHERE product_id=p.id AND owner_id=p.owner_id),0)=?',
    '(SELECT payload FROM workspace_settings WHERE owner_id=p.owner_id) IS ?',
  ];
  const args: (string | number | null)[] = [productId, owner, source.productVersion, source.imageKeys, source.pricingPolicy, source.contentRevision, source.optionRevision, source.settingsPayload];
  if (source.profile) {
    conditions.push('EXISTS(SELECT 1 FROM category_profiles WHERE owner_id=p.owner_id AND id=? AND revision=?)');
    args.push(source.profile.id, source.profile.revision);
  }
  if (source.collection) {
    if (source.collection.snapshot?.linked) {
      conditions.push('EXISTS(SELECT 1 FROM collection_products cp WHERE cp.product_id=p.id AND cp.owner_id=p.owner_id AND cp.job_id=?)');
      args.push(source.collection.snapshot.id);
    } else {
      conditions.push('NOT EXISTS(SELECT 1 FROM collection_products cp WHERE cp.product_id=p.id AND cp.owner_id=p.owner_id)');
    }
    if (source.collection.snapshot) {
      conditions.push(`EXISTS(SELECT 1 FROM collection_jobs j JOIN collection_context c ON c.job_id=j.id
        WHERE j.owner_id=p.owner_id AND j.offer_id=? AND j.status='awaiting_connector' AND j.id=? AND j.updated_at=? AND c.payload=?)`);
      args.push(source.collection.offerId, source.collection.snapshot.id, source.collection.snapshot.updatedAt, source.collection.snapshot.payload);
    } else {
      conditions.push(`NOT EXISTS(SELECT 1 FROM collection_jobs j JOIN collection_context c ON c.job_id=j.id
        WHERE j.owner_id=p.owner_id AND j.offer_id=? AND j.status='awaiting_connector')`);
      args.push(source.collection.offerId);
    }
  }
  return { sql: conditions.join(' AND '), args };
}
export async function quotationSourcesCurrent(owner: string, productId: string, source: QuotationSourceGuard) {
  const db = await database(); const guard = sourceGuard(owner, productId, source);
  return Boolean(await db.prepare(`SELECT p.id FROM products p WHERE ${guard.sql}`).bind(...guard.args).first());
}

/** All option/common overrides are committed together; automatic values never overwrite them. */
export async function saveQuotationFields(owner: string, productId: string, overrides: QuotationOverrides, expectedRevision: number, source: QuotationSourceGuard): Promise<QuotationFieldsState | null> {
  const db = await database(); const guard = sourceGuard(owner, productId, source);
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) throw new Error('Invalid quotation revision');
  const updatedAt = new Date(Math.max(Date.now(), Date.parse(source.productVersion) + 1)).toISOString();
  const state: QuotationFieldsState = { schemaVersion: 1, productId, revision: expectedRevision + 1, overrides, updatedAt };
  const payload = JSON.stringify(state);
  if (new TextEncoder().encode(payload).length > 512 * 1024) throw new Error('Quotation overrides exceed storage limit');
  const result = await db.batch<Row>([
    db.prepare(`INSERT INTO product_quotation_fields(product_id,owner_id,revision,payload,updated_at)
      SELECT p.id,p.owner_id,?,?,? FROM products p WHERE ${guard.sql}
      AND (?=0 OR EXISTS(SELECT 1 FROM product_quotation_fields WHERE product_id=p.id AND owner_id=p.owner_id AND revision=?))
      ON CONFLICT(product_id) DO UPDATE SET revision=excluded.revision,payload=excluded.payload,updated_at=excluded.updated_at
        WHERE product_quotation_fields.owner_id=excluded.owner_id AND product_quotation_fields.revision=?
      RETURNING payload,revision`).bind(state.revision, payload, updatedAt, ...guard.args, expectedRevision, expectedRevision, expectedRevision),
    db.prepare(`UPDATE products SET quote_status='대기',updated_at=?
      WHERE id=? AND owner_id=? AND updated_at=? AND changes()=1
      AND EXISTS(SELECT 1 FROM product_quotation_fields WHERE product_id=? AND owner_id=? AND revision=?)`)
      .bind(updatedAt, productId, owner, source.productVersion, productId, owner, state.revision),
  ]);
  return result[0].results[0] ? state : null;
}
