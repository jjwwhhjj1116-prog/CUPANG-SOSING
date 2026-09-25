CREATE TABLE IF NOT EXISTS intake_drafts (
  owner_id TEXT PRIMARY KEY, revision INTEGER NOT NULL CHECK(revision > 0),
  payload TEXT NOT NULL, updated_at TEXT NOT NULL
);
