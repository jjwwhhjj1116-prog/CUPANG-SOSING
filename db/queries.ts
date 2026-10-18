import { env } from 'cloudflare:workers';
import type { PricePolicy } from '@/app/pricing';
import type { QuotationFieldsState, QuotationSourceGuard } from '@/db/quotation-fields';
import { productRegistrationCounterSchema, productRegistrationSchema, productRegistrationOptionsSchema, prepareProductRegistration, withRegistrationNumber } from '@/db/product-registration';

export type ProductRecord = {
  id: string; owner_id: string; source_url: string; title: string;
  source_price_cny: number; exchange_rate: number; supply_margin: number;
  coupang_margin: number; supply_price: number; sale_price: number; msrp: number;
  options_count: number; seo_status: string; image_status: string; quote_status: string;
  registration_status: string; supplier_hub_status: string; image_keys: string;
  goal_stage: string; created_at: string; updated_at: string;
  pricing_policy?: string | null;
  registration_number?: string;
};
export type RemovedProductRecord = ProductRecord & {removed_at:string};

function database() {
  if (!env.DB) throw new Error('D1 binding DB is unavailable.');
  return env.DB;
}

// Remember completed schema setup only. Pending request I/O and failed attempts
// must stay local to their request; product and settings reads are never cached.
const schemaReadyBindings = new WeakSet<D1Database>();

export async function ensureDatabase() {
  const db = database();
  if (schemaReadyBindings.has(db)) return;
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS products (
      id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, source_url TEXT NOT NULL,
      title TEXT NOT NULL, source_price_cny REAL NOT NULL, exchange_rate REAL NOT NULL,
      supply_margin REAL NOT NULL, coupang_margin REAL NOT NULL, supply_price INTEGER NOT NULL,
      sale_price INTEGER NOT NULL, msrp INTEGER NOT NULL, options_count INTEGER NOT NULL DEFAULT 1,
      seo_status TEXT NOT NULL DEFAULT '대기', image_status TEXT NOT NULL DEFAULT '대기',
      quote_status TEXT NOT NULL DEFAULT '대기', registration_status TEXT NOT NULL DEFAULT '수집완료',
      supplier_hub_status TEXT NOT NULL DEFAULT '미전송', image_keys TEXT NOT NULL DEFAULT '[]',
      goal_stage TEXT NOT NULL DEFAULT 'price', created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    )`),
    db.prepare('CREATE INDEX IF NOT EXISTS idx_products_owner_updated ON products(owner_id, updated_at)'),
    db.prepare('CREATE INDEX IF NOT EXISTS idx_products_owner_status ON products(owner_id, registration_status)'),
    db.prepare(`CREATE TABLE IF NOT EXISTS product_removals (
      product_id TEXT PRIMARY KEY REFERENCES products(id), owner_id TEXT NOT NULL,
      removed_at TEXT NOT NULL, product_version TEXT NOT NULL
    )`),
    db.prepare('CREATE INDEX IF NOT EXISTS idx_product_removals_owner_removed ON product_removals(owner_id, removed_at)'),
    db.prepare(`CREATE TABLE IF NOT EXISTS workspace_settings (
      owner_id TEXT PRIMARY KEY, payload TEXT NOT NULL, updated_at TEXT NOT NULL
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS product_price_policy (
      product_id TEXT PRIMARY KEY REFERENCES products(id), payload TEXT NOT NULL
    )`),
    db.prepare(productRegistrationCounterSchema),
    db.prepare(productRegistrationSchema),
    db.prepare(productRegistrationOptionsSchema),
  ]);
  schemaReadyBindings.add(db);
}

export async function listProducts(ownerId: string, removed: 'exclude' | 'only' = 'exclude') {
  await ensureDatabase();
  const result = await database().prepare(
    removed === 'only'
      ? `SELECT p.*, (SELECT payload FROM product_price_policy WHERE product_id=p.id) AS pricing_policy, r.removed_at,
          (SELECT registration_number FROM product_registration_numbers n WHERE n.product_id=p.id AND n.owner_id=p.owner_id) AS registration_number
          FROM products p INNER JOIN product_removals r ON r.product_id=p.id AND r.owner_id=p.owner_id
          WHERE p.owner_id=? ORDER BY r.removed_at DESC, p.updated_at DESC LIMIT 200`
      : `SELECT p.*, (SELECT payload FROM product_price_policy WHERE product_id=p.id) AS pricing_policy,
          (SELECT registration_number FROM product_registration_numbers n WHERE n.product_id=p.id AND n.owner_id=p.owner_id) AS registration_number
          FROM products p WHERE p.owner_id=? AND NOT EXISTS (
            SELECT 1 FROM product_removals r WHERE r.product_id=p.id AND r.owner_id=p.owner_id
          ) ORDER BY p.updated_at DESC LIMIT 200`,
  ).bind(ownerId).all<ProductRecord | RemovedProductRecord>();
  return result.results.map(withRegistrationNumber);
}

export async function insertProduct(product: ProductRecord, policy?: PricePolicy) {
  await ensureDatabase();
  const insert = database().prepare(`INSERT INTO products (
    id, owner_id, source_url, title, source_price_cny, exchange_rate,
    supply_margin, coupang_margin, supply_price, sale_price, msrp, options_count,
    seo_status, image_status, quote_status, registration_status,
    supplier_hub_status, image_keys, goal_stage, created_at, updated_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(
      product.id, product.owner_id, product.source_url, product.title,
      product.source_price_cny, product.exchange_rate, product.supply_margin,
      product.coupang_margin, product.supply_price, product.sale_price, product.msrp,
      product.options_count, product.seo_status, product.image_status, product.quote_status,
      product.registration_status, product.supplier_hub_status, product.image_keys,
      product.goal_stage, product.created_at, product.updated_at,
    );
  // Keep the policy with the initial price, including disabled minimum margin
  // and rounding. A later workspace change must not recalculate this draft.
  const db = database(), payload = policy ? JSON.stringify(policy) : undefined;
  const result = await db.batch<{registration_number:string}>([insert,
    ...(payload === undefined ? [] : [db.prepare('INSERT INTO product_price_policy(product_id,payload) VALUES(?,?)').bind(product.id,payload)]),
    ...prepareProductRegistration(db, product.owner_id, product.id, product.created_at),
  ]);
  return {...product, ...(payload === undefined ? {} : {pricing_policy:payload}), registration_number:result[result.length-1].results[0].registration_number};
}

export async function updateProduct(ownerId: string, id: string, updates: Record<string, string | number>, expectedVersion?: string) {
  await ensureDatabase();
  const allowed = new Set([
    'title', 'source_price_cny', 'exchange_rate', 'supply_margin', 'coupang_margin',
    'supply_price', 'sale_price', 'msrp', 'options_count', 'seo_status', 'image_status',
    'quote_status', 'registration_status', 'supplier_hub_status', 'image_keys', 'goal_stage',
  ]);
  const entries = Object.entries(updates).filter(([key]) => allowed.has(key));
  if (!entries.length) return null;
  const setters = entries.map(([key]) => `${key} = ?`).join(', ');
  const now = new Date().toISOString();
  // Advance the version inside the same SQL mutation, including same-millisecond
  // legacy title edits or a server clock behind the stored version.
  const saved = await database().prepare(`UPDATE products SET ${setters}, updated_at = CASE
      WHEN updated_at >= ? THEN strftime('%Y-%m-%dT%H:%M:%fZ', updated_at, '+0.001 seconds') ELSE ? END
    WHERE id = ? AND owner_id = ?${expectedVersion === undefined ? '' : ' AND updated_at = ?'}
    RETURNING *, (SELECT payload FROM product_price_policy WHERE product_id = products.id) AS pricing_policy,
      (SELECT registration_number FROM product_registration_numbers n WHERE n.product_id=products.id AND n.owner_id=products.owner_id) AS registration_number`)
    .bind(...entries.map(([, value]) => value), now, now, id, ownerId, ...(expectedVersion === undefined ? [] : [expectedVersion]))
    .first<ProductRecord>();
  return saved ? withRegistrationNumber(saved) : null;
}

export async function getSettings(ownerId: string) {
  await ensureDatabase();
  return database().prepare('SELECT payload FROM workspace_settings WHERE owner_id = ?')
    .bind(ownerId).first<{ payload: string }>();
}

export async function saveSettings(ownerId: string, payload: string) {
  await ensureDatabase();
  const now = new Date().toISOString();
  await database().prepare(`INSERT INTO workspace_settings (owner_id, payload, updated_at)
    VALUES (?, ?, ?) ON CONFLICT(owner_id) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at`)
    .bind(ownerId, payload, now).run();
}

export async function findProduct(ownerId: string, id: string, activeOnly = false) {
  await ensureDatabase();
  const saved = await database().prepare('SELECT p.*, (SELECT payload FROM product_price_policy WHERE product_id=p.id) AS pricing_policy, (SELECT registration_number FROM product_registration_numbers n WHERE n.product_id=p.id AND n.owner_id=p.owner_id) AS registration_number FROM products p WHERE owner_id = ? AND id = ?'
    +(activeOnly?' AND NOT EXISTS(SELECT 1 FROM product_removals r WHERE r.product_id=p.id AND r.owner_id=p.owner_id)':''))
    .bind(ownerId, id).first<ProductRecord>();
  return saved ? withRegistrationNumber(saved) : null;
}

export type ProductPriceQuotationSnapshot={state:QuotationFieldsState;payload:string|null};
export type ProductPriceQuotationCommit={source:QuotationSourceGuard;before:ProductPriceQuotationSnapshot;state:QuotationFieldsState;writeQuote?:boolean};
/** Optional legacy probe: it neither creates the quotation schema nor rewrites
 * an old document merely because its product policy is being saved. */
export async function readProductPriceQuotationSnapshot(ownerId:string,id:string):Promise<ProductPriceQuotationSnapshot|null>{
  const db=database();
  if(!await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='product_quotation_fields'").first())return null;
  const row=await db.prepare('SELECT payload,revision FROM product_quotation_fields WHERE owner_id=? AND product_id=?').bind(ownerId,id).first<{payload:string;revision:number}>();
  if(!row)return{state:{schemaVersion:1,productId:id,revision:0,overrides:{common:{},options:{}},updatedAt:null},payload:null};
  const state=JSON.parse(row.payload) as QuotationFieldsState;
  if(state.schemaVersion!==1||state.productId!==id||state.revision!==row.revision||!state.overrides?.common||!state.overrides.options)throw Error('Invalid quotation price snapshot');
  return{state,payload:row.payload};
}

export async function applyProductPrice(ownerId: string, id: string, expectedVersion: string, values: {
  exchangeRate: number; supplyMargin: number; coupangMargin: number; supplyPrice: number; salePrice: number; msrp: number;
}, policy: PricePolicy, quotation?:ProductPriceQuotationCommit) {
  await ensureDatabase();
  // A second editor must reload instead of overwriting a more recent price.
  const version = new Date(Math.max(Date.now(), Date.parse(expectedVersion) + 1)).toISOString();
  const payload = JSON.stringify(policy);
  if(quotation){
    const {sourceGuard}=await import('@/db/quotation-fields');
    if(quotation.source.productVersion!==expectedVersion||quotation.before.state.productId!==id||quotation.state.productId!==id
      ||quotation.state.revision!==quotation.before.state.revision||!Number.isSafeInteger(quotation.before.state.revision)||quotation.before.state.revision<0
      ||(quotation.before.payload===null)!==(quotation.before.state.revision===0))throw Error('Invalid price quotation commit');
    const previous=quotation.before,state={...quotation.state,revision:previous.state.revision+1,updatedAt:version},quotePayload=JSON.stringify(state);
    if(new TextEncoder().encode(quotePayload).length>512*1024)throw Error('견적서 가격 자료가 저장 한도를 초과했습니다.');
    const guard=sourceGuard(ownerId,id,quotation.source),db=database();
    const before=`((? IS NULL AND NOT EXISTS(SELECT 1 FROM product_quotation_fields q WHERE q.product_id=p.id))
      OR EXISTS(SELECT 1 FROM product_quotation_fields q WHERE q.product_id=p.id AND q.owner_id=p.owner_id AND q.revision=? AND q.payload=?))`;
    const beforeArgs=[previous.payload,previous.state.revision,previous.payload];
    const first=db.prepare(`UPDATE products AS p SET exchange_rate=?,supply_margin=?,coupang_margin=?,supply_price=?,sale_price=?,msrp=?,quote_status='대기',updated_at=?
        WHERE ${guard.sql} AND ${before} RETURNING *,
        (SELECT registration_number FROM product_registration_numbers n WHERE n.product_id=products.id AND n.owner_id=products.owner_id) AS registration_number`)
        .bind(values.exchangeRate,values.supplyMargin,values.coupangMargin,values.supplyPrice,values.salePrice,values.msrp,version,...guard.args,...beforeArgs);
    const policyWrite=db.prepare(`INSERT INTO product_price_policy(product_id,payload) SELECT id,? FROM products WHERE owner_id=? AND id=? AND updated_at=? AND changes()=1
        ON CONFLICT(product_id) DO UPDATE SET payload=excluded.payload RETURNING product_id,payload`).bind(payload,ownerId,id,version);
    if(quotation.writeQuote===false){
      if(JSON.stringify(quotation.state)!==JSON.stringify(previous.state))throw Error('Invalid unchanged price quotation commit');
      const result=await db.batch<ProductRecord>([first,policyWrite,
        db.prepare(`UPDATE products AS p SET title=CASE WHEN changes()=1 AND EXISTS(SELECT 1 FROM product_price_policy pp WHERE pp.product_id=p.id AND pp.payload=?)
            AND ${before} THEN title ELSE NULL END WHERE p.id=? AND p.owner_id=? AND p.updated_at=? RETURNING id`)
          .bind(payload,...beforeArgs,id,ownerId,version),
      ]);
      const applied=Boolean(result[0].results[0]);
      if(result.slice(1).some(item=>Boolean(item.results[0])!==applied))throw Error('Incomplete guarded price commit acknowledgement');
      const saved=result[0].results[0];return saved?{...withRegistrationNumber(saved),pricing_policy:payload}:null;
    }
    const result=await db.batch<ProductRecord>([
      first,policyWrite,
      db.prepare(`INSERT INTO product_quotation_fields(product_id,owner_id,revision,payload,updated_at)
        SELECT p.id,p.owner_id,CASE WHEN changes()=1 AND ${before} AND EXISTS(SELECT 1 FROM product_price_policy pp WHERE pp.product_id=p.id AND pp.payload=?) THEN ? ELSE 0 END,?,?
        FROM products p WHERE p.id=? AND p.owner_id=? AND p.updated_at=?
        ON CONFLICT(product_id) DO UPDATE SET revision=excluded.revision,payload=excluded.payload,updated_at=excluded.updated_at RETURNING *`)
        .bind(...beforeArgs,payload,state.revision,quotePayload,version,id,ownerId,version),
      // A different table/event and its existing NOT NULL constraint make an
      // ignored policy/quotation companion roll back inside the transaction.
      db.prepare(`UPDATE products AS p SET title=CASE WHEN changes()=1 AND EXISTS(SELECT 1 FROM product_price_policy pp WHERE pp.product_id=p.id AND pp.payload=?)
          AND EXISTS(SELECT 1 FROM product_quotation_fields q WHERE q.product_id=p.id AND q.owner_id=p.owner_id AND q.revision=? AND q.payload=? AND q.updated_at=?) THEN title ELSE NULL END
        WHERE p.id=? AND p.owner_id=? AND p.updated_at=? RETURNING id`)
        .bind(payload,state.revision,quotePayload,version,id,ownerId,version),
    ]);
    const applied=Boolean(result[0].results[0]);
    if(result.slice(1).some(item=>Boolean(item.results[0])!==applied))throw Error('Incomplete price quotation commit acknowledgement');
    const saved=result[0].results[0];return saved?{...withRegistrationNumber(saved),pricing_policy:payload}:null;
  }
  const result = await database().batch<ProductRecord>([database().prepare(`UPDATE products SET exchange_rate=?, supply_margin=?, coupang_margin=?,
    supply_price=?, sale_price=?, msrp=?, quote_status='대기', updated_at=?
    WHERE owner_id=? AND id=? AND updated_at=?
      AND NOT EXISTS(SELECT 1 FROM product_removals r WHERE r.product_id=products.id AND r.owner_id=products.owner_id) RETURNING *,
        (SELECT registration_number FROM product_registration_numbers n WHERE n.product_id=products.id AND n.owner_id=products.owner_id) AS registration_number`)
    .bind(values.exchangeRate, values.supplyMargin, values.coupangMargin, values.supplyPrice, values.salePrice, values.msrp,
      version, ownerId, id, expectedVersion),
    database().prepare(`INSERT INTO product_price_policy(product_id, payload)
      SELECT id, ? FROM products WHERE owner_id=? AND id=? AND updated_at=? AND changes()=1
      ON CONFLICT(product_id) DO UPDATE SET payload=excluded.payload`).bind(payload,ownerId,id,version),
  ]);
  const saved = result[0].results[0];
  return saved ? { ...withRegistrationNumber(saved), pricing_policy: payload } : null;
}
