-- Editor-only selected-option detail documents; final product/quote data stay separate.
CREATE TABLE IF NOT EXISTS product_detail_workspaces (
 owner_id TEXT NOT NULL, product_id TEXT NOT NULL REFERENCES products(id), category_scope TEXT NOT NULL, option_id TEXT NOT NULL,
 revision INTEGER NOT NULL CHECK(revision > 0), request_id TEXT NOT NULL, payload TEXT NOT NULL CHECK(json_valid(payload)), updated_at TEXT NOT NULL,
 PRIMARY KEY(owner_id,product_id,category_scope,option_id), CHECK(length(CAST(payload AS BLOB))<=524288)
);
