CREATE TABLE IF NOT EXISTS detail_family_apply_operations (
 owner_id TEXT NOT NULL, request_id TEXT NOT NULL, source_product_id TEXT NOT NULL REFERENCES products(id),
 family_id TEXT NOT NULL, profile_id TEXT, attempt_id TEXT NOT NULL,
 request_payload TEXT NOT NULL CHECK(json_valid(request_payload)), before_payload TEXT NOT NULL CHECK(json_valid(before_payload)),
 after_payload TEXT NOT NULL CHECK(json_valid(after_payload)), receipt_payload TEXT NOT NULL CHECK(json_valid(receipt_payload)),
 committed_at TEXT NOT NULL, PRIMARY KEY(owner_id,request_id),
 CHECK(length(CAST(request_payload AS BLOB))+length(CAST(before_payload AS BLOB))+length(CAST(after_payload AS BLOB))+length(CAST(receipt_payload AS BLOB))<=2097152)
);
