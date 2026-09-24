CREATE TABLE IF NOT EXISTS quotation_attribute_rules (
  owner_id TEXT NOT NULL,
  category_id TEXT NOT NULL,
  payload TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK(revision > 0),
  updated_at TEXT NOT NULL,
  PRIMARY KEY(owner_id, category_id)
);
