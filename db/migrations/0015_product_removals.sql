CREATE TABLE IF NOT EXISTS product_removals (
  product_id TEXT PRIMARY KEY REFERENCES products(id), owner_id TEXT NOT NULL,
  removed_at TEXT NOT NULL, product_version TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_product_removals_owner_removed ON product_removals(owner_id, removed_at);
