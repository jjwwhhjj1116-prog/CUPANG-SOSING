-- Bound owner/offer lookup without restoring uniqueness on historical jobs.
CREATE INDEX IF NOT EXISTS idx_collection_owner_offer_status_created
  ON collection_jobs(owner_id, offer_id, status, created_at DESC, id DESC);
