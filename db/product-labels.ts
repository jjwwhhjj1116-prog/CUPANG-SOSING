import { env } from 'cloudflare:workers';
import { emptyProductLabelOverrides, PRODUCT_LABEL_STORAGE_LIMIT, validateProductLabelOverrides, type ProductLabelOverrides, type ProductLabelsState } from '@/app/product-label';
import { sourceGuard, type QuotationSourceGuard } from '@/db/quotation-fields';

export const productLabelsSchema = `CREATE TABLE IF NOT EXISTS product_labels (
  product_id TEXT PRIMARY KEY REFERENCES products(id) ON DELETE CASCADE, owner_id TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK(revision > 0), payload TEXT NOT NULL, updated_at TEXT NOT NULL
)`;
export type ProductLabelSourceGuard = QuotationSourceGuard & { quotationRevision: number };
type Row = { revision: number; payload: string; updated_at: string };
async function database() {
  if (!env.DB) throw Error('D1 unavailable');
  await env.DB.batch([env.DB.prepare(productLabelsSchema), env.DB.prepare('CREATE INDEX IF NOT EXISTS product_labels_owner ON product_labels(owner_id,product_id)')]);
  return env.DB;
}
export async function readProductLabels(owner: string, productId: string): Promise<ProductLabelsState> {
  const db = await database();
  const row = await db.prepare('SELECT revision,payload,updated_at FROM product_labels WHERE product_id=? AND owner_id=?').bind(productId, owner).first<Row>();
  if (!row) return { schemaVersion: 1, productId, revision: 0, overrides: emptyProductLabelOverrides(), updatedAt: null };
  if (new TextEncoder().encode(row.payload).length > PRODUCT_LABEL_STORAGE_LIMIT) throw Error('Product labels exceed storage limit');
  const state = JSON.parse(row.payload) as ProductLabelsState;
  if (state.schemaVersion !== 1 || state.productId !== productId || state.revision !== row.revision || state.updatedAt !== row.updated_at || !Number.isSafeInteger(state.revision) || state.revision < 1 || !Number.isFinite(Date.parse(state.updatedAt!))) throw Error('Invalid product labels');
  return { ...state, overrides: validateProductLabelOverrides(state.overrides) };
}
function guardedSource(owner: string, productId: string, source: ProductLabelSourceGuard) {
  const guard = sourceGuard(owner, productId, source);
  // Zero means an actually absent row, never a row owned by another account.
  guard.sql += ` AND NOT EXISTS(SELECT 1 FROM product_removals WHERE product_id=p.id AND owner_id=p.owner_id)
    AND ((?=0 AND NOT EXISTS(SELECT 1 FROM product_quotation_fields WHERE product_id=p.id))
    OR EXISTS(SELECT 1 FROM product_quotation_fields WHERE product_id=p.id AND owner_id=p.owner_id AND revision=?))
    AND (?<>0 OR NOT EXISTS(SELECT 1 FROM product_content WHERE product_id=p.id AND owner_id<>p.owner_id))
    AND (?<>0 OR NOT EXISTS(SELECT 1 FROM product_options WHERE product_id=p.id AND owner_id<>p.owner_id))`;
  guard.args.push(source.quotationRevision, source.quotationRevision, source.contentRevision, source.optionRevision);
  return guard;
}
const revisionGuard = `((?=0 AND NOT EXISTS(SELECT 1 FROM product_labels WHERE product_id=p.id))
  OR EXISTS(SELECT 1 FROM product_labels WHERE product_id=p.id AND owner_id=p.owner_id AND revision=?))`;
export async function productLabelsSourcesCurrent(owner: string, productId: string, source: ProductLabelSourceGuard, revision: number) {
  const db = await database(), guard = guardedSource(owner, productId, source);
  return Boolean(await db.prepare(`SELECT p.id FROM products p WHERE ${guard.sql} AND ${revisionGuard}`).bind(...guard.args, revision, revision).first());
}

/** The source proof and both clocks are checked inside one D1 transaction.
 * Label storage never writes product content, options, category wires or quotes. */
export async function saveProductLabels(owner: string, productId: string, overrides: ProductLabelOverrides, expectedRevision: number, source: ProductLabelSourceGuard): Promise<ProductLabelsState | null> {
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0 || !Number.isSafeInteger(source.quotationRevision) || source.quotationRevision < 0 || !Number.isFinite(Date.parse(source.productVersion))) throw Error('Invalid product label revision');
  const db = await database(), guard = guardedSource(owner, productId, source);
  const updatedAt = new Date(Math.max(Date.now(), Date.parse(source.productVersion) + 1)).toISOString();
  const state: ProductLabelsState = { schemaVersion: 1, productId, revision: expectedRevision + 1, overrides: validateProductLabelOverrides(overrides), updatedAt };
  const payload = JSON.stringify(state);
  if (new TextEncoder().encode(payload).length > PRODUCT_LABEL_STORAGE_LIMIT) throw Error('Product labels exceed storage limit');
  const result = await db.batch<{ payload: string; revision: number; id: string }>([
    db.prepare(`INSERT INTO product_labels(product_id,owner_id,revision,payload,updated_at)
      SELECT p.id,p.owner_id,?,?,? FROM products p WHERE ${guard.sql} AND ${revisionGuard}
      ON CONFLICT(product_id) DO UPDATE SET revision=excluded.revision,payload=excluded.payload,updated_at=excluded.updated_at
      WHERE product_labels.owner_id=excluded.owner_id AND product_labels.revision=? RETURNING payload,revision`)
      .bind(state.revision, payload, updatedAt, ...guard.args, expectedRevision, expectedRevision, expectedRevision),
    db.prepare(`UPDATE products SET quote_status='대기',updated_at=? WHERE changes()=1
      AND id IN (SELECT p.id FROM products p WHERE ${guard.sql})
      AND EXISTS(SELECT 1 FROM product_labels WHERE product_id=products.id AND owner_id=products.owner_id AND revision=? AND payload=?) RETURNING id`)
      .bind(updatedAt, ...guard.args, state.revision, payload),
  ]);
  if (!result[0]?.results?.[0]) return null;
  if (!result[1]?.results?.[0]?.id) throw Error('Product label clock acknowledgement was incomplete');
  return state;
}
