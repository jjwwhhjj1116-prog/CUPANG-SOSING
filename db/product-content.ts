import { registrationContentSummary } from '@/app/registration-content-summary';
import { env } from 'cloudflare:workers';
import { emptyProductContent, withCurrentLabelFields, type ProductContent } from '@/app/product-content';

type ContentRow = { payload: string; revision: number };
async function database() {
  if (!env.DB) throw new Error('D1 binding DB is unavailable.');
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS product_content (
    product_id TEXT PRIMARY KEY REFERENCES products(id), owner_id TEXT NOT NULL,
    revision INTEGER NOT NULL CHECK(revision > 0), payload TEXT NOT NULL, updated_at TEXT NOT NULL
  )`).run();
  return env.DB;
}

export async function readProductContent(ownerId: string, productId: string): Promise<ProductContent> {
  const db = await database();
  const row = await db.prepare('SELECT payload, revision FROM product_content WHERE owner_id=? AND product_id=?').bind(ownerId, productId).first<ContentRow>();
  if (!row) return emptyProductContent(productId);
  const content: ProductContent = JSON.parse(row.payload);
  if (content.schemaVersion !== 1 || content.productId !== productId || content.revision !== row.revision) throw new Error('Invalid stored content');
  return withCurrentLabelFields(content);
}

export async function saveProductContent(ownerId: string, content: ProductContent, expectedRevision: number, expectedImageKeys?: string): Promise<ProductContent | null> {
  const db = await database();
  if (content.revision !== expectedRevision + 1 || !content.updatedAt) throw new Error('Invalid content revision');
  // Both the insert and update compare the revision inside SQLite. The second
  // statement invalidates the quotation only if this writer changed one row.
  const result = await db.batch<ContentRow>([
    db.prepare(`INSERT INTO product_content(product_id, owner_id, revision, payload, updated_at)
      SELECT id, owner_id, ?, ?, ? FROM products WHERE id=? AND owner_id=? AND (? IS NULL OR image_keys=?)
        AND (?=0 OR EXISTS(SELECT 1 FROM product_content WHERE product_id=? AND owner_id=? AND revision=?))
      ON CONFLICT(product_id) DO UPDATE SET revision=excluded.revision, payload=excluded.payload, updated_at=excluded.updated_at
        WHERE product_content.owner_id=excluded.owner_id AND product_content.revision=?
      RETURNING payload, revision`).bind(content.revision, JSON.stringify(content), content.updatedAt, content.productId, ownerId, expectedImageKeys ?? null, expectedImageKeys ?? null,
      expectedRevision, content.productId, ownerId, expectedRevision, expectedRevision),
    db.prepare(`UPDATE products SET quote_status='대기', updated_at=CASE WHEN updated_at < ? THEN ? ELSE updated_at END
      WHERE id=? AND owner_id=? AND changes()=1
      AND EXISTS(SELECT 1 FROM product_content WHERE product_id=? AND owner_id=? AND revision=?)`)
      .bind(content.updatedAt, content.updatedAt, content.productId, ownerId, content.productId, ownerId, content.revision),
  ]);
  return result[0].results[0] ? content : null;
}

/** Batched read for the visible product listing; never query another owner's data. */
export async function readRegistrationSummaries(ownerId: string, products: {id:string;image_keys:string}[]) {
  const summaries: Record<string, import('@/app/registration-content-summary').RegistrationContentSummary | null> = {};
  if (!products.length) return summaries;
  const db = await database();
  for (let offset=0;offset<products.length;offset+=80) {
    const chunk=products.slice(offset,offset+80);
    const rows=await db.prepare(`SELECT product_id, payload, revision FROM product_content WHERE owner_id=? AND product_id IN (${chunk.map(()=>'?').join(',')})`).bind(ownerId,...chunk.map(product=>product.id)).all<{product_id:string;payload:string;revision:number}>();
    const records=new Map(rows.results.map(row=>[row.product_id,row]));
    for(const product of chunk) {
      try {
        const row=records.get(product.id);
        const content=row?JSON.parse(row.payload) as ProductContent:null;
        if(row&&content?.revision!==row.revision)throw Error('Invalid content revision');
        summaries[product.id]=registrationContentSummary(product,content);
      } catch { summaries[product.id]=null; }
    }
  }
  return summaries;
}
