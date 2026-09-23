CREATE TABLE IF NOT EXISTS collection_images (
 job_id TEXT NOT NULL REFERENCES collection_jobs(id), image_index INTEGER NOT NULL,
 owner_id TEXT NOT NULL, product_id TEXT NOT NULL REFERENCES products(id),
 object_key TEXT NOT NULL, operation_id TEXT NOT NULL, created_at TEXT NOT NULL,
 PRIMARY KEY(job_id,image_index)
);
