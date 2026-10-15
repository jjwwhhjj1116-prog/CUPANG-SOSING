import { env } from 'cloudflare:workers';
import { emptyProductOptions, type ProductOptions } from '@/app/product-options';
import {prepareProductRegistrationOptions} from '@/db/product-registration';

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
        AND NOT EXISTS(SELECT 1 FROM product_removals r WHERE r.product_id=products.id AND r.owner_id=products.owner_id)
        AND (?=0 OR EXISTS(SELECT 1 FROM product_options WHERE product_id=? AND owner_id=? AND revision=?))
      ON CONFLICT(product_id) DO UPDATE SET revision=excluded.revision,payload=excluded.payload,updated_at=excluded.updated_at
        WHERE product_options.owner_id=excluded.owner_id AND product_options.revision=?
      RETURNING payload,revision`).bind(options.revision, JSON.stringify(options), options.updatedAt, options.productId, ownerId, expectedProductVersion,
      expectedRevision, options.productId, ownerId, expectedRevision, expectedRevision),
    db.prepare(`UPDATE products SET quote_status='대기', options_count=?, updated_at=?
      WHERE id=? AND owner_id=? AND updated_at=? AND changes()=1
      AND EXISTS(SELECT 1 FROM product_options WHERE product_id=? AND owner_id=? AND revision=?)`)
      .bind(options.rows.filter(row => row.included).length, options.updatedAt, options.productId, ownerId, expectedProductVersion, options.productId, ownerId, options.revision),
    prepareProductRegistrationOptions(db,ownerId,options.productId,options.rows.map(row=>row.id),options.updatedAt,{revision:options.revision,payload:JSON.stringify(options)}),
  ]);
  return result[0].results[0] ? options : null;
}

/** Response-only display enrichment; neither reads nor legacy option edits
 * allocate numbers. Removed UUID mappings remain stored, outside the payload. */
export async function readOptionRegistrationNumbers(ownerId:string,product:{id:string;registration_number?:string},options:ProductOptions):Promise<Record<string,string>|undefined>{
  if(!product.registration_number)return undefined;
  const db=await database();
  const saved=await db.prepare(`SELECT m.option_id,substr(n.registration_number,1,9)||printf('%03d',m.sequence) AS registration_number
    FROM product_registration_numbers n JOIN product_registration_options m ON m.product_id=n.product_id AND m.owner_id=n.owner_id
    JOIN json_each(?) current ON current.value=m.option_id
    WHERE n.product_id=? AND n.owner_id=? AND n.registration_number=?`)
    .bind(JSON.stringify(options.rows.map(row=>row.id)),product.id,ownerId,product.registration_number)
    .all<{option_id:string;registration_number:string}>();
  return Object.fromEntries(saved.results.map(row=>[row.option_id,row.registration_number]));
}
