// Member tables are installed by migration, never during login.
// Keep these explicit declarations checked against the installation SQL.
export const memberSchema0 = `CREATE TABLE IF NOT EXISTS members (
 id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE COLLATE NOCASE, password_hash TEXT NOT NULL,
 role TEXT NOT NULL CHECK(role IN ('admin','member')), status TEXT NOT NULL CHECK(status IN ('pending','approved','rejected','suspended')),
 company_code TEXT NOT NULL DEFAULT '', company_name TEXT NOT NULL DEFAULT '',
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL, reviewed_by TEXT
)`;
export const memberSchema1 = `CREATE UNIQUE INDEX IF NOT EXISTS one_member_admin ON members(role) WHERE role='admin'`;
export const memberSchema2 = `CREATE TABLE IF NOT EXISTS member_sessions (
 token_hash TEXT PRIMARY KEY, member_id TEXT NOT NULL REFERENCES members(id), expires_at INTEGER NOT NULL
)`;
export const memberSchema3 = `CREATE INDEX IF NOT EXISTS member_sessions_expiry ON member_sessions(expires_at)`;
export const memberSchema4 = `CREATE TABLE IF NOT EXISTS member_rate_limits (key TEXT PRIMARY KEY, attempts INTEGER NOT NULL, expires_at INTEGER NOT NULL)`;
export const memberSchema5 = `CREATE TABLE IF NOT EXISTS member_audit (id TEXT PRIMARY KEY, actor_id TEXT NOT NULL, member_id TEXT NOT NULL, action TEXT NOT NULL, created_at TEXT NOT NULL)`;
