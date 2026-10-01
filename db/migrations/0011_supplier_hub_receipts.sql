CREATE TABLE IF NOT EXISTS supplier_hub_receipts (
  owner_id TEXT NOT NULL, product_id TEXT NOT NULL REFERENCES products(id), fingerprint TEXT NOT NULL,
  observed_at INTEGER NOT NULL, evidence_order INTEGER NOT NULL, payload TEXT NOT NULL,
  PRIMARY KEY(owner_id,product_id,fingerprint)
);
