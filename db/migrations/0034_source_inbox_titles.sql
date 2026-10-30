CREATE TABLE IF NOT EXISTS source_inbox_titles (
 owner_id TEXT NOT NULL,capture_id TEXT NOT NULL,company_code TEXT NOT NULL,company_name TEXT NOT NULL,
 fingerprint TEXT NOT NULL,source_revision INTEGER NOT NULL,source_title TEXT NOT NULL,
 status TEXT NOT NULL,translated_title TEXT,error TEXT,attempts INTEGER NOT NULL,retryable INTEGER NOT NULL,updated_at TEXT NOT NULL,
 PRIMARY KEY(owner_id,capture_id)
);
