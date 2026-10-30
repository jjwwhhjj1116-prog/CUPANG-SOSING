-- Add metadata without rewriting existing member IDs, password hashes or company assignments.
ALTER TABLE members ADD COLUMN login_id TEXT COLLATE NOCASE;
ALTER TABLE members ADD COLUMN full_name TEXT NOT NULL DEFAULT '';
ALTER TABLE members ADD COLUMN phone_number TEXT NOT NULL DEFAULT '';
ALTER TABLE members ADD COLUMN phone_verified_at TEXT;
ALTER TABLE members ADD COLUMN registration_version INTEGER NOT NULL DEFAULT 0;
ALTER TABLE members ADD COLUMN credential_version INTEGER NOT NULL DEFAULT 0;
CREATE UNIQUE INDEX IF NOT EXISTS member_login_id_unique ON members(login_id) WHERE login_id IS NOT NULL;
