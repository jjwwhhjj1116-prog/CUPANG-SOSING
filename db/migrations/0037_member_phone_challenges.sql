CREATE TABLE IF NOT EXISTS member_phone_challenges (
 id TEXT PRIMARY KEY, purpose TEXT NOT NULL CHECK(purpose IN ('enroll','find-id','reset-password')),
 member_id TEXT REFERENCES members(id), phone_number TEXT NOT NULL, credential_version INTEGER NOT NULL,
 code_hash TEXT NOT NULL, state TEXT NOT NULL CHECK(state IN ('sending','active','verified','consumed','failed')),
 attempts INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL,
 reset_token_hash TEXT, reset_expires_at INTEGER, verified_at INTEGER
);
CREATE INDEX IF NOT EXISTS member_phone_challenges_expiry ON member_phone_challenges(expires_at);
CREATE TABLE IF NOT EXISTS member_phone_send_locks (key_hash TEXT PRIMARY KEY, next_send_at INTEGER NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS member_verified_phone_unique ON members(phone_number) WHERE phone_verified_at IS NOT NULL AND phone_number<>'';
CREATE TABLE IF NOT EXISTS member_sms_settings (id TEXT PRIMARY KEY CHECK(id='solapi'), ciphertext TEXT NOT NULL, nonce TEXT NOT NULL, updated_by TEXT NOT NULL REFERENCES members(id), updated_at TEXT NOT NULL);
