CREATE TABLE IF NOT EXISTS managed_import_prices (
 owner_id TEXT NOT NULL, company_code TEXT NOT NULL, sku_id TEXT NOT NULL, import_date TEXT NOT NULL,
 price TEXT NOT NULL, revision INTEGER NOT NULL CHECK(revision>0), source_name TEXT NOT NULL, source_sha256 TEXT NOT NULL,
 source_row INTEGER NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
 PRIMARY KEY(owner_id,company_code,sku_id,import_date),
 FOREIGN KEY(owner_id,company_code,sku_id) REFERENCES managed_products(owner_id,company_code,sku_id)
);
