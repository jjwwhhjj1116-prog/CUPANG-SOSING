-- Explicit reviewed option families and immutable split recovery records.
CREATE TABLE IF NOT EXISTS product_option_split_operations (
 owner_id TEXT NOT NULL, request_id TEXT NOT NULL, source_product_id TEXT NOT NULL REFERENCES products(id),
 family_id TEXT NOT NULL, root_product_id TEXT NOT NULL REFERENCES products(id), profile_id TEXT, attempt_id TEXT NOT NULL,
 request_payload TEXT NOT NULL CHECK(json_valid(request_payload)), before_payload TEXT NOT NULL CHECK(json_valid(before_payload)),
 after_payload TEXT NOT NULL CHECK(json_valid(after_payload)), receipt_payload TEXT NOT NULL CHECK(json_valid(receipt_payload)),
 committed_at TEXT NOT NULL, PRIMARY KEY(owner_id,request_id)
);
CREATE TABLE IF NOT EXISTS product_option_split_members (
 owner_id TEXT NOT NULL, product_id TEXT NOT NULL REFERENCES products(id), family_id TEXT NOT NULL,
 root_product_id TEXT NOT NULL REFERENCES products(id), parent_product_id TEXT REFERENCES products(id),
 operation_request_id TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY(owner_id,product_id),
 FOREIGN KEY(owner_id,operation_request_id) REFERENCES product_option_split_operations(owner_id,request_id)
);
