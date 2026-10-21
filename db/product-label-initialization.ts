import { couplusProductLabelStructure, emptyProductLabelOverrides, type ProductLabelsState } from '@/app/product-label';

// Kept independent of queries/quotation storage so product creation can share
// this existing schema without introducing a runtime import cycle.
export const productLabelsSchema = `CREATE TABLE IF NOT EXISTS product_labels (
  product_id TEXT PRIMARY KEY REFERENCES products(id) ON DELETE CASCADE, owner_id TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK(revision > 0), payload TEXT NOT NULL, updated_at TEXT NOT NULL
)`;

/** Append immediately after the INSERT of a genuinely fresh product UUID.
 * Cloned/split products retain their source structure instead. Missing rows on
 * historical products continue to mean the unchanged legacy generation. */
export function prepareNewProductLabels(db: D1Database, owner: string, productId: string, createdAt: string) {
  if (typeof owner !== 'string' || !owner || !/^\w[\w-]{0,99}$/.test(productId) || !Number.isFinite(Date.parse(createdAt)))
    throw Error('Invalid new product label identity.');
  const state: ProductLabelsState = { schemaVersion: 1, productId, revision: 1, overrides: emptyProductLabelOverrides(),
    structure: couplusProductLabelStructure(), updatedAt: createdAt };
  const payload = JSON.stringify(state);
  return [
    db.prepare(`INSERT INTO product_labels(product_id,owner_id,revision,payload,updated_at)
      SELECT p.id,p.owner_id,1,?,? FROM products p WHERE p.id=? AND p.owner_id=? AND p.created_at=? AND p.updated_at=? AND changes()=1
      RETURNING product_id`).bind(payload, createdAt, productId, owner, createdAt, createdAt),
    // A skipped companion INSERT must abort the same creation transaction. A
    // stale no-op with an existing sidecar cannot update that historical row.
    db.prepare(`UPDATE products AS p SET title=CASE WHEN p.owner_id=? AND p.created_at=? AND p.updated_at=?
      AND EXISTS(SELECT 1 FROM product_labels l WHERE l.product_id=p.id AND l.owner_id=p.owner_id AND l.revision=1 AND l.payload=? AND l.updated_at=?)
      THEN title ELSE NULL END WHERE p.id=?
      AND (changes()=1 OR NOT EXISTS(SELECT 1 FROM product_labels l WHERE l.product_id=p.id)) RETURNING id`)
      .bind(owner, createdAt, createdAt, payload, createdAt, productId),
  ];
}
