-- Display metadata for newly created YOOFAM products only. Existing products
-- and UUID identities are untouched; no data backfill or vendor allocator claim.
CREATE TABLE IF NOT EXISTS product_registration_counters (
  owner_id TEXT NOT NULL, registration_day TEXT NOT NULL,
  last_sequence INTEGER NOT NULL CHECK(last_sequence BETWEEN 1 AND 999),
  PRIMARY KEY(owner_id, registration_day)
);
CREATE TABLE IF NOT EXISTS product_registration_numbers (
  product_id TEXT PRIMARY KEY REFERENCES products(id), owner_id TEXT NOT NULL,
  registration_day TEXT NOT NULL, sequence INTEGER NOT NULL CHECK(sequence BETWEEN 1 AND 999),
  registration_number TEXT NOT NULL CHECK(
    registration_day GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
    AND length(registration_number)=12
    AND registration_number=replace(substr(registration_day,3),'-','') || printf('%03d',sequence) || '001'
  ), created_at TEXT NOT NULL,
  UNIQUE(owner_id, registration_day, sequence), UNIQUE(owner_id, registration_number),
  FOREIGN KEY(owner_id, registration_day) REFERENCES product_registration_counters(owner_id, registration_day)
);
CREATE TABLE IF NOT EXISTS product_registration_options (
  product_id TEXT NOT NULL REFERENCES product_registration_numbers(product_id), owner_id TEXT NOT NULL,
  option_id TEXT NOT NULL, sequence INTEGER NOT NULL CHECK(sequence BETWEEN 1 AND 999),
  PRIMARY KEY(product_id, option_id), UNIQUE(product_id, sequence)
);
