CREATE TABLE IF NOT EXISTS member_registration_consents (
 owner_id TEXT NOT NULL,company_code TEXT NOT NULL,company_name TEXT NOT NULL,connection_id TEXT NOT NULL,
 kind TEXT NOT NULL CHECK(kind IN ('price-data','label-contact')),connection_revision INTEGER NOT NULL CHECK(connection_revision>=1),
 revision INTEGER NOT NULL CHECK(revision>=1),enabled INTEGER NOT NULL CHECK(enabled IN (0,1)),
 terms_version TEXT NOT NULL,terms_sha256 TEXT NOT NULL,terms_payload TEXT NOT NULL,
 accepted_at TEXT NOT NULL,updated_at TEXT NOT NULL,actor_email TEXT NOT NULL,actor_role TEXT NOT NULL CHECK(actor_role IN ('admin','member')),
 actor_credential_version INTEGER NOT NULL CHECK(actor_credential_version>=0),PRIMARY KEY(owner_id,company_code,connection_id,kind)
);
