CREATE TABLE IF NOT EXISTS collection_source_supplements (
 job_id TEXT PRIMARY KEY REFERENCES collection_jobs(id), owner_id TEXT NOT NULL,
 base_payload TEXT NOT NULL, captured_payload TEXT NOT NULL, payload TEXT NOT NULL, received_at TEXT NOT NULL
);
