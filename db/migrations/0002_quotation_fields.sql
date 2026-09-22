-- Review-only common/option overrides. Existing tables and their rows remain unchanged.
CREATE TABLE IF NOT EXISTS product_quotation_fields (
  product_id TEXT PRIMARY KEY REFERENCES products(id), owner_id TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK(revision > 0), payload TEXT NOT NULL, updated_at TEXT NOT NULL
);
