CREATE TABLE IF NOT EXISTS collection_products (
 job_id TEXT PRIMARY KEY REFERENCES collection_jobs(id), owner_id TEXT NOT NULL,
 product_id TEXT NOT NULL UNIQUE REFERENCES products(id), created_at TEXT NOT NULL
);
