-- Additive declarations already used by product-management runtime code.
-- Reapplication keeps every existing product, history and purchase row.
CREATE TABLE IF NOT EXISTS managed_product_history (
 owner_id TEXT NOT NULL,company_code TEXT NOT NULL,sku_id TEXT NOT NULL,
 title TEXT NOT NULL,source_payload TEXT NOT NULL,source_name TEXT NOT NULL,source_sha256 TEXT NOT NULL,source_row INTEGER NOT NULL,
 first_imported_at TEXT NOT NULL,imported_at TEXT NOT NULL,payload TEXT NOT NULL,
 product_id_latest_at INTEGER,price_latest_at INTEGER,other_sellers INTEGER NOT NULL,source_import_price TEXT,source_import_value REAL,source_no_import INTEGER,
 PRIMARY KEY(owner_id,company_code,sku_id),FOREIGN KEY(owner_id,company_code,sku_id) REFERENCES managed_products(owner_id,company_code,sku_id)
);
CREATE TABLE IF NOT EXISTS managed_purchase_info (
 owner_id TEXT NOT NULL,company_code TEXT NOT NULL,sku_id TEXT NOT NULL,
 revision INTEGER NOT NULL CHECK(revision>0),payload TEXT NOT NULL,updated_at TEXT NOT NULL,
 PRIMARY KEY(owner_id,company_code,sku_id),
 FOREIGN KEY(owner_id,company_code,sku_id) REFERENCES managed_products(owner_id,company_code,sku_id)
);
