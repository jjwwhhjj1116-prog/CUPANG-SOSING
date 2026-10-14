-- Native registration-file observations remain separate from bulk XLSX receipts.
-- Additive only: no editable product, member or previous receipt is changed.
CREATE TABLE IF NOT EXISTS supplier_hub_single_receipts (
  owner_id TEXT NOT NULL, product_id TEXT NOT NULL REFERENCES products(id), request_id TEXT NOT NULL,
  observed_at INTEGER NOT NULL, payload TEXT NOT NULL, created_at TEXT NOT NULL,
  PRIMARY KEY(owner_id,product_id,request_id)
);
