CREATE TABLE IF NOT EXISTS image_vision_requests (
 owner_id TEXT NOT NULL, product_id TEXT NOT NULL REFERENCES products(id), request_id TEXT NOT NULL,
 company_code TEXT NOT NULL, company_name TEXT NOT NULL, model TEXT NOT NULL,
 request_fingerprint TEXT NOT NULL, source_scope TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('running','completed','failed','uncertain')),
 result TEXT, failure TEXT, provider_requests INTEGER CHECK(provider_requests IN (0,1)), created_at TEXT NOT NULL, finished_at TEXT,
 PRIMARY KEY(owner_id,product_id,request_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS image_vision_requests_active ON image_vision_requests(owner_id,product_id,source_scope) WHERE status IN ('running','uncertain');
