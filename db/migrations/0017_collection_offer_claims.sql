-- Deduplication may be released for a removed product without rewriting its
-- historical collection job, captured category/settings, receipt or product.
CREATE TABLE IF NOT EXISTS collection_offer_claims (
  owner_id TEXT NOT NULL, offer_id TEXT NOT NULL,
  job_id TEXT NOT NULL UNIQUE REFERENCES collection_jobs(id),
  PRIMARY KEY(owner_id, offer_id)
);
DROP INDEX IF EXISTS idx_collection_active_offer;
