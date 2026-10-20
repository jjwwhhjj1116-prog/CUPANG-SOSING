-- Preserve each explicit recapture without rewriting the original inbox row,
-- its manual review, collection receipts or existing product drafts.
CREATE TABLE IF NOT EXISTS source_inbox_captures (
 owner_id TEXT NOT NULL,id TEXT NOT NULL,origin_id TEXT NOT NULL,
 company_code TEXT NOT NULL,company_name TEXT NOT NULL,offer_id TEXT NOT NULL,
 fingerprint TEXT NOT NULL,payload TEXT NOT NULL,review_payload TEXT,
 capture_version INTEGER NOT NULL CHECK(capture_version>=2),revision INTEGER NOT NULL DEFAULT 1,
 received_at TEXT NOT NULL,archived_at TEXT,
 PRIMARY KEY(owner_id,id),UNIQUE(owner_id,origin_id,capture_version),UNIQUE(owner_id,fingerprint),
 FOREIGN KEY(owner_id,origin_id) REFERENCES source_inbox(owner_id,id)
);
