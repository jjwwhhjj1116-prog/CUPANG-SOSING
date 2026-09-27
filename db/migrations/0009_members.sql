CREATE TABLE IF NOT EXISTS members (
 id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE COLLATE NOCASE, password_hash TEXT NOT NULL,
 role TEXT NOT NULL CHECK(role IN ('admin','member')), status TEXT NOT NULL CHECK(status IN ('pending','approved','rejected','suspended')),
 company_code TEXT NOT NULL DEFAULT '', company_name TEXT NOT NULL DEFAULT '',
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL, reviewed_by TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS one_member_admin ON members(role) WHERE role='admin';
CREATE TABLE IF NOT EXISTS member_sessions (
 token_hash TEXT PRIMARY KEY, member_id TEXT NOT NULL REFERENCES members(id), expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS member_sessions_expiry ON member_sessions(expires_at);
CREATE TABLE IF NOT EXISTS member_rate_limits (key TEXT PRIMARY KEY, attempts INTEGER NOT NULL, expires_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS member_audit (id TEXT PRIMARY KEY, actor_id TEXT NOT NULL, member_id TEXT NOT NULL, action TEXT NOT NULL, created_at TEXT NOT NULL);
