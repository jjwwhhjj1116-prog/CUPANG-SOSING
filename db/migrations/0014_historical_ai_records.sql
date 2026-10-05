CREATE TABLE IF NOT EXISTS historical_ai_records (
 owner_id TEXT NOT NULL, company_code TEXT NOT NULL, record_kind TEXT NOT NULL CHECK(record_kind IN ('registration','quotation')),
 registration_id TEXT NOT NULL, option_id TEXT NOT NULL, title TEXT NOT NULL, option_count INTEGER NOT NULL,
 source_url TEXT NOT NULL, source_status TEXT NOT NULL, source_payload TEXT NOT NULL,
 source_name TEXT NOT NULL, source_sha256 TEXT NOT NULL, source_row INTEGER NOT NULL, imported_at TEXT NOT NULL,
 PRIMARY KEY(owner_id,company_code,record_kind,registration_id,option_id)
);
