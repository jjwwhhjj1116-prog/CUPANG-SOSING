CREATE TABLE IF NOT EXISTS quotation_ai_jobs (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  product_id TEXT NOT NULL REFERENCES products(id),
  idempotency_key TEXT NOT NULL,
  request_fingerprint TEXT NOT NULL,
  review TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('prepared','running','completed','failed','uncertain')),
  result TEXT,
  error TEXT,
  claim_token TEXT,
  created_at TEXT NOT NULL,
  started_at TEXT,
  finished_at TEXT,
  UNIQUE(owner_id, product_id, idempotency_key)
);
CREATE INDEX IF NOT EXISTS quotation_ai_jobs_owner ON quotation_ai_jobs(owner_id,product_id,created_at);
CREATE UNIQUE INDEX IF NOT EXISTS quotation_ai_jobs_running ON quotation_ai_jobs(owner_id,product_id) WHERE status IN ('running','uncertain');
CREATE TABLE IF NOT EXISTS quotation_ai_daily (day TEXT PRIMARY KEY, requests INTEGER NOT NULL CHECK(requests>=0));
