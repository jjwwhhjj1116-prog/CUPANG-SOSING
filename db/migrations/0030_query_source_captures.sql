-- Keep complete server-query evidence independent of page-capture snapshots.
-- Recapture adds an immutable version; no existing operational table is edited.
CREATE TABLE IF NOT EXISTS query_source_captures (
 owner_id TEXT NOT NULL,id TEXT NOT NULL,company_code TEXT NOT NULL,company_name TEXT NOT NULL,
 offer_id TEXT NOT NULL,fingerprint TEXT NOT NULL,payload TEXT NOT NULL CHECK(json_valid(payload)),
 capture_version INTEGER NOT NULL CHECK(capture_version>=1),revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>=1),
 received_at TEXT NOT NULL,archived_at TEXT,
 PRIMARY KEY(owner_id,id),UNIQUE(owner_id,fingerprint),UNIQUE(owner_id,offer_id,capture_version)
);
