-- SourceFlow runtime schema baseline. Safe for a new database or the legacy
-- products/workspace_settings schema: existing tables, rows and indexes remain.
-- Do not apply to a local or remote D1 database without the required approval.
-- Runtime CREATE IF NOT EXISTS statements remain in place for compatibility.
-- Validate without opening any real database: node scripts/check-db-schema.mjs

-- db/queries.ts (legacy product/settings columns are deliberately unchanged)
CREATE TABLE IF NOT EXISTS products (
  id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, source_url TEXT NOT NULL,
  title TEXT NOT NULL, source_price_cny REAL NOT NULL, exchange_rate REAL NOT NULL,
  supply_margin REAL NOT NULL, coupang_margin REAL NOT NULL, supply_price INTEGER NOT NULL,
  sale_price INTEGER NOT NULL, msrp INTEGER NOT NULL, options_count INTEGER NOT NULL DEFAULT 1,
  seo_status TEXT NOT NULL DEFAULT '대기', image_status TEXT NOT NULL DEFAULT '대기',
  quote_status TEXT NOT NULL DEFAULT '대기', registration_status TEXT NOT NULL DEFAULT '수집완료',
  supplier_hub_status TEXT NOT NULL DEFAULT '미전송', image_keys TEXT NOT NULL DEFAULT '[]',
  goal_stage TEXT NOT NULL DEFAULT 'price', created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_products_owner_updated ON products(owner_id, updated_at);
CREATE INDEX IF NOT EXISTS idx_products_owner_status ON products(owner_id, registration_status);
CREATE TABLE IF NOT EXISTS workspace_settings (
  owner_id TEXT PRIMARY KEY, payload TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS product_price_policy (
  product_id TEXT PRIMARY KEY REFERENCES products(id), payload TEXT NOT NULL
);

-- db/collection-jobs.ts
CREATE TABLE IF NOT EXISTS collection_jobs (
  id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, offer_id TEXT NOT NULL,
  source_url TEXT NOT NULL, goal TEXT NOT NULL CHECK(goal IN ('collect','price','work','transmit')),
  status TEXT NOT NULL CHECK(status IN ('awaiting_connector','cancelled')),
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_collection_active_offer
  ON collection_jobs(owner_id, offer_id) WHERE status = 'awaiting_connector';
CREATE INDEX IF NOT EXISTS idx_collection_owner_time ON collection_jobs(owner_id, created_at);
CREATE TABLE IF NOT EXISTS collection_context (
  job_id TEXT PRIMARY KEY REFERENCES collection_jobs(id), payload TEXT NOT NULL
);

-- db/category-profiles.ts
CREATE TABLE IF NOT EXISTS category_profiles (
  id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, payload TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1 CHECK(revision > 0),
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_category_profiles_owner ON category_profiles(owner_id, updated_at);

-- db/product-content.ts and db/product-options.ts
CREATE TABLE IF NOT EXISTS product_content (
  product_id TEXT PRIMARY KEY REFERENCES products(id), owner_id TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK(revision > 0), payload TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS product_options (
  product_id TEXT PRIMARY KEY REFERENCES products(id), owner_id TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK(revision > 0), payload TEXT NOT NULL, updated_at TEXT NOT NULL
);

-- db/automation.ts
CREATE TABLE IF NOT EXISTS product_automation (
  product_id TEXT NOT NULL, owner_id TEXT NOT NULL, revision INTEGER NOT NULL,
  product_version TEXT NOT NULL, payload TEXT NOT NULL, updated_at TEXT NOT NULL,
  PRIMARY KEY (product_id, owner_id), FOREIGN KEY (product_id) REFERENCES products(id)
);
CREATE TABLE IF NOT EXISTS product_automation_receipts (
  product_id TEXT NOT NULL, owner_id TEXT NOT NULL, idempotency_key TEXT NOT NULL,
  request_fingerprint TEXT NOT NULL, response TEXT NOT NULL, revision INTEGER NOT NULL,
  created_at TEXT NOT NULL, PRIMARY KEY (product_id, owner_id, idempotency_key)
);
CREATE TABLE IF NOT EXISTS product_automation_history (
  product_id TEXT NOT NULL, owner_id TEXT NOT NULL, revision INTEGER NOT NULL,
  action TEXT NOT NULL, payload TEXT NOT NULL, created_at TEXT NOT NULL,
  PRIMARY KEY (product_id, owner_id, revision)
);

-- db/translation-jobs.ts
CREATE TABLE IF NOT EXISTS translation_jobs (
  id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, product_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL, request_fingerprint TEXT NOT NULL,
  product_version TEXT NOT NULL, content_revision INTEGER NOT NULL,
  status TEXT NOT NULL, review_fingerprint TEXT NOT NULL, review TEXT NOT NULL,
  expires_at TEXT NOT NULL, result TEXT, error TEXT, claim_token TEXT,
  created_at TEXT NOT NULL, approved_at TEXT, started_at TEXT, finished_at TEXT,
  UNIQUE(owner_id,product_id,idempotency_key), FOREIGN KEY(product_id) REFERENCES products(id)
);
CREATE INDEX IF NOT EXISTS idx_translation_owner_product ON translation_jobs(owner_id,product_id,created_at);

-- db/image-jobs.ts
CREATE TABLE IF NOT EXISTS image_jobs (
  id TEXT PRIMARY KEY,owner_id TEXT NOT NULL,product_id TEXT NOT NULL,idempotency_key TEXT NOT NULL,
  request_fingerprint TEXT NOT NULL,product_version TEXT NOT NULL,content_revision INTEGER NOT NULL,product_image_keys TEXT NOT NULL,
  status TEXT NOT NULL,review_fingerprint TEXT NOT NULL,review TEXT NOT NULL,expires_at TEXT NOT NULL,
  result TEXT,error TEXT,claim_token TEXT,created_at TEXT NOT NULL,approved_at TEXT,started_at TEXT,finished_at TEXT,
  UNIQUE(owner_id,product_id,idempotency_key),FOREIGN KEY(product_id) REFERENCES products(id)
);
CREATE INDEX IF NOT EXISTS idx_image_jobs_owner_product ON image_jobs(owner_id,product_id,created_at);
