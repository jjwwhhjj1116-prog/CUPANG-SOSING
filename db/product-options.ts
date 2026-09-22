import { env } from 'cloudflare:workers';
import { emptyProductOptions, type ProductOptions } from '@/app/product-options';

type Row = { payload: string; revision: number };
async function database() {
  if (!env.DB) throw new Error('D1 binding DB is unavailable.');
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS product_options (
    product_id TEXT PRIMARY KEY REFERENCES products(id), owner_id TEXT NOT NULL,
    revision INTEGER NOT NULL CHECK(revision > 0), payload TEXT NOT NULL, updated_at TEXT NOT NULL
  )`).run();
  return env.DB;
}
export async function readProductOptions(ownerId: string, productId: string): Promise<ProductOptions> {
  const db = await database();
  const row = await db.prepare('SELECT payload,revision FROM product_options WHERE owner_id=? AND product_id=?').bind(ownerId, productId).first<Row>();
  if (!row) return emptyProductOptions(productId);
  const options: ProductOptions = JSON.parse(row.payload);
  if (options.schemaVersion !== 1 || options.productId !== productId || options.revision !== row.revision) throw new Error('Invalid saved options');
  return options;
}
export async function saveProductOptions(ownerId: string, options: ProductOptions, expectedRevision: number, expectedProductVersion: string): Promise<ProductOptions | null> {
  const db = await database();
  if (options.revision !== expectedRevision + 1 || !options.updatedAt) throw new Error('Invalid options revision');
  const result = await db.batch<Row>([
    db.prepare(`INSERT INTO product_options(product_id,owner_id,revision,payload,updated_at)
      SELECT id,owner_id,?,?,? FROM products WHERE id=? AND owner_id=? AND updated_at=?
        AND (?=0 OR EXISTS(SELECT 1 FROM product_options WHERE product_id=? AND owner_id=? AND revision=?))
      ON CONFLICT(product_id) DO UPDATE SET revision=excluded.revision,payload=excluded.payload,updated_at=excluded.updated_at
        WHERE product_options.owner_id=excluded.owner_id AND product_options.revision=?
      RETURNING payload,revision`).bind(options.revision, JSON.stringify(options), options.updatedAt, options.productId, ownerId, expectedProductVersion,
      expectedRevision, options.productId, ownerId, expectedRevision, expectedRevision),
    db.prepare(`UPDATE products SET quote_status='대기', options_count=?, updated_at=?
      WHERE id=? AND owner_id=? AND updated_at=? AND changes()=1
      AND EXISTS(SELECT 1 FROM product_options WHERE product_id=? AND owner_id=? AND revision=?)`)
      .bind(options.rows.filter(row => row.included).length, options.updatedAt, options.productId, ownerId, expectedProductVersion, options.productId, ownerId, options.revision),
  ]);
  return result[0].results[0] ? options : null;
}
