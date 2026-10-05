CREATE TABLE IF NOT EXISTS managed_products (
 owner_id TEXT NOT NULL, company_code TEXT NOT NULL, sku_id TEXT NOT NULL,
 title TEXT NOT NULL, source_payload TEXT NOT NULL, source_name TEXT NOT NULL,
 source_sha256 TEXT NOT NULL, source_row INTEGER NOT NULL,
 first_imported_at TEXT NOT NULL, imported_at TEXT NOT NULL,
 PRIMARY KEY(owner_id,company_code,sku_id)
);
