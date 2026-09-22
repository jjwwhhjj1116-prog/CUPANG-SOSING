-- Additive indexes for history pagination and owner-scoped request context.
-- This migration neither rewrites nor removes any historical records.
CREATE INDEX IF NOT EXISTS idx_products_owner_created_id ON products(owner_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_collection_owner_created_id ON collection_jobs(owner_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_collection_owner_source_created ON collection_jobs(owner_id, source_url, created_at DESC, id DESC);
