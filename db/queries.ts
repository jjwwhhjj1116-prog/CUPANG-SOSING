import { env } from 'cloudflare:workers';

export type ProductRecord = {
  id: string; owner_id: string; source_url: string; title: string;
  source_price_cny: number; exchange_rate: number; supply_margin: number;
  coupang_margin: number; supply_price: number; sale_price: number; msrp: number;
  options_count: number; seo_status: string; image_status: string; quote_status: string;
  registration_status: string; supplier_hub_status: string; image_keys: string;
  goal_stage: string; created_at: string; updated_at: string;
};

function database() {
  if (!env.DB) throw new Error('D1 binding DB is unavailable.');
  return env.DB;
}

export async function ensureDatabase() {
  const db = database();
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
    db.prepare(`CREATE TABLE IF NOT EXISTS workspace_settings (
      owner_id TEXT PRIMARY KEY, payload TEXT NOT NULL, updated_at TEXT NOT NULL
    )`),
  ]);
  await db.prepare('PRAGMA optimize').run();
}

export async function listProducts(ownerId: string) {
  await ensureDatabase();
  const result = await database().prepare(
    'SELECT * FROM products WHERE owner_id = ? ORDER BY updated_at DESC LIMIT 200',
  ).bind(ownerId).all<ProductRecord>();
  return result.results;
}

export async function insertProduct(product: ProductRecord) {
  await ensureDatabase();
  await database().prepare(`INSERT INTO products (
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
    ).run();
  return product;
}

export async function updateProduct(ownerId: string, id: string, updates: Record<string, string | number>) {
  await ensureDatabase();
  const allowed = new Set([
    'title', 'source_price_cny', 'exchange_rate', 'supply_margin', 'coupang_margin',
    'supply_price', 'sale_price', 'msrp', 'options_count', 'seo_status', 'image_status',
    'quote_status', 'registration_status', 'supplier_hub_status', 'image_keys', 'goal_stage',
  ]);
  const entries = Object.entries(updates).filter(([key]) => allowed.has(key));
  if (!entries.length) return null;
  entries.push(['updated_at', new Date().toISOString()]);
  const setters = entries.map(([key]) => `${key} = ?`).join(', ');
  await database().prepare(`UPDATE products SET ${setters} WHERE id = ? AND owner_id = ?`)
    .bind(...entries.map(([, value]) => value), id, ownerId).run();
  return database().prepare('SELECT * FROM products WHERE id = ? AND owner_id = ?')
    .bind(id, ownerId).first<ProductRecord>();
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
