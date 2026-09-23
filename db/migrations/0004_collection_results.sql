CREATE TABLE IF NOT EXISTS collection_results (
 job_id TEXT PRIMARY KEY REFERENCES collection_jobs(id), owner_id TEXT NOT NULL,
 payload TEXT NOT NULL, received_at TEXT NOT NULL
);
