CREATE TABLE IF NOT EXISTS source_inbox_title_runs (
 owner_id TEXT NOT NULL,capture_id TEXT NOT NULL,fingerprint TEXT NOT NULL,source_revision INTEGER NOT NULL,
 provider_signature TEXT NOT NULL,provider TEXT NOT NULL,model TEXT,attempts INTEGER NOT NULL,
 status TEXT NOT NULL,retryable INTEGER NOT NULL,updated_at TEXT NOT NULL,
 PRIMARY KEY(owner_id,capture_id,fingerprint,source_revision,provider_signature)
);
