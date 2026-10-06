CREATE TABLE IF NOT EXISTS product_labels (
  product_id TEXT PRIMARY KEY REFERENCES products(id) ON DELETE CASCADE,
  owner_id TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK(revision > 0),
  payload TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS product_labels_owner ON product_labels(owner_id, product_id);
