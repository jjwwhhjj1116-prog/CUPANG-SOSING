CREATE TABLE IF NOT EXISTS managed_store_settings (
 owner_id TEXT NOT NULL REFERENCES members(id),company_code TEXT NOT NULL,company_name TEXT NOT NULL,
 revision INTEGER NOT NULL CHECK(revision>0),payload TEXT NOT NULL,updated_at TEXT NOT NULL,
 PRIMARY KEY(owner_id,company_code)
);
