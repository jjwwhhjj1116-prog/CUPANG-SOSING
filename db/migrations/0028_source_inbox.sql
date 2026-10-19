CREATE TABLE IF NOT EXISTS source_inbox (
 owner_id TEXT NOT NULL,id TEXT NOT NULL,company_code TEXT NOT NULL,company_name TEXT NOT NULL,
 offer_id TEXT NOT NULL,fingerprint TEXT NOT NULL,payload TEXT NOT NULL,review_payload TEXT,
 revision INTEGER NOT NULL DEFAULT 1,received_at TEXT NOT NULL,archived_at TEXT,
 PRIMARY KEY(owner_id,id),UNIQUE(owner_id,offer_id)
);
