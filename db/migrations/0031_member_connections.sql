CREATE TABLE IF NOT EXISTS member_connections (
 owner_id TEXT NOT NULL,profile_id TEXT NOT NULL,company_code TEXT NOT NULL,company_name TEXT NOT NULL,
 service TEXT NOT NULL CHECK(service IN ('supplier-hub','1688')),alias TEXT NOT NULL,login_id TEXT NOT NULL,
 enabled INTEGER NOT NULL CHECK(enabled IN (0,1)),revision INTEGER NOT NULL CHECK(revision>=1),
 encryption_version INTEGER NOT NULL CHECK(encryption_version=1),password_nonce TEXT NOT NULL,password_ciphertext TEXT NOT NULL,
 created_at TEXT NOT NULL,updated_at TEXT NOT NULL,PRIMARY KEY(owner_id,profile_id)
);
