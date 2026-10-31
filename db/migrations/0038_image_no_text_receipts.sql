CREATE TABLE IF NOT EXISTS image_no_text_receipts (
 owner_id TEXT NOT NULL,product_id TEXT NOT NULL,request_id TEXT NOT NULL,request_fingerprint TEXT NOT NULL,source_scope TEXT NOT NULL,
 source_key TEXT NOT NULL,member_email TEXT NOT NULL,member_role TEXT NOT NULL,proof TEXT NOT NULL,
 PRIMARY KEY(owner_id,product_id,request_id),
 FOREIGN KEY(owner_id,product_id,request_id) REFERENCES image_vision_requests(owner_id,product_id,request_id)
);
