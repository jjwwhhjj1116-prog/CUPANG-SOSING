import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { assertAdditiveBootstrap, checkDatabaseSchema, ddlFromSource, memoryDatabase, readBootstrap, runtimeDDL, schemaSnapshot } from '../scripts/check-db-schema.mjs';

const bootstrap = readBootstrap();
const legacy = fs.readFileSync(new URL('../drizzle/0000_spooky_wendell_rand.sql', import.meta.url), 'utf8');
const owner = 'local-demo'; const productId = 'synthetic-product'; const now = '2026-09-22T00:00:00.000Z';
const json = JSON.stringify({ text: '한글 · 원본 보존', result: 'review only', revision: 2 });
function seedLegacy(db) {
  db.prepare(`INSERT INTO products(id,owner_id,source_url,title,source_price_cny,exchange_rate,supply_margin,coupang_margin,
    supply_price,sale_price,msrp,image_keys,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(productId, owner, 'https://example.invalid/synthetic', '기존 상품 유지', 12.5, 190, 30, 25, 4500, 6000, 9000, '["local-demo/original.png"]', now, now);
  db.prepare('INSERT INTO workspace_settings(owner_id,payload,updated_at) VALUES (?,?,?)').run(owner, json, now);
}
function tableData(db) {
  return db.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all()
    .map(({ name }) => ({ name, rows: db.prepare(`SELECT * FROM "${name.replaceAll('"', '""')}" ORDER BY rowid`).all().map(row => ({ ...row })) }));
}
function seedCompanions(db) {
  db.prepare('INSERT INTO product_price_policy(product_id,payload) VALUES (?,?)').run(productId, json);
  db.prepare('INSERT INTO collection_jobs(id,owner_id,offer_id,source_url,goal,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)')
    .run('synthetic-job', owner, 'synthetic-offer', 'https://example.invalid/synthetic', 'work', 'awaiting_connector', now, now);
  db.prepare('INSERT INTO collection_context(job_id,payload) VALUES (?,?)').run('synthetic-job', json);
  db.prepare('INSERT INTO category_profiles(id,owner_id,payload,revision,created_at,updated_at) VALUES (?,?,?,?,?,?)').run('synthetic-category', owner, json, 2, now, now);
  for (const table of ['product_content', 'product_options']) db.prepare(`INSERT INTO ${table}(product_id,owner_id,revision,payload,updated_at) VALUES (?,?,?,?,?)`).run(productId, owner, 2, json, now);
  db.prepare('INSERT INTO product_automation(product_id,owner_id,revision,product_version,payload,updated_at) VALUES (?,?,?,?,?,?)').run(productId, owner, 7, now, json, now);
  db.prepare('INSERT INTO product_automation_receipts(product_id,owner_id,idempotency_key,request_fingerprint,response,revision,created_at) VALUES (?,?,?,?,?,?,?)').run(productId, owner, 'synthetic-receipt', 'synthetic-fingerprint', json, 7, now);
  db.prepare('INSERT INTO product_automation_history(product_id,owner_id,revision,action,payload,created_at) VALUES (?,?,?,?,?,?)').run(productId, owner, 7, 'prepare', json, now);
  db.prepare(`INSERT INTO translation_jobs(id,owner_id,product_id,idempotency_key,request_fingerprint,product_version,content_revision,
    status,review_fingerprint,review,expires_at,result,error,claim_token,created_at,approved_at,started_at,finished_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run('synthetic-translation', owner, productId, 'paid-translation', 'synthetic-fingerprint', now, 2,
    'uncertain', 'synthetic-review', json, now, null, '{"code":"PROVIDER_OUTCOME_UNCERTAIN"}', 'claimed-once', now, now, now, now);
  db.prepare(`INSERT INTO image_jobs(id,owner_id,product_id,idempotency_key,request_fingerprint,product_version,content_revision,product_image_keys,
    status,review_fingerprint,review,expires_at,result,error,claim_token,created_at,approved_at,started_at,finished_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run('synthetic-image', owner, productId, 'paid-image', 'synthetic-fingerprint', now, 2, '["local-demo/original.png"]',
    'running', 'synthetic-review', json, now, null, null, 'claimed-once', now, now, now, null);
}

test('checked-in bootstrap matches every runtime table, constraint, column and named index on fresh SQLite', () => {
  const result = checkDatabaseSchema();
  assert.equal(result.tables, 13); assert.equal(result.indexes, 7); assert.equal(result.runtimeModules, 8);
});

test('legacy Drizzle schema upgrade preserves product/settings rows, defaults, PK declarations and indexes', () => {
  const db = memoryDatabase();
  try {
    db.exec(legacy); seedLegacy(db);
    const previousSchema = schemaSnapshot(db); const previousData = tableData(db);
    db.exec(bootstrap);
    const schema = schemaSnapshot(db); const data = tableData(db);
    for (const previous of previousSchema) assert.deepEqual(schema.find(value => value.name === previous.name), previous);
    for (const previous of previousData) assert.deepEqual(data.find(value => value.name === previous.name), previous);
    // Drizzle's explicit PK NOT NULL is stricter than the historical runtime
    // declaration. Keep the existing definition instead of rebuilding the table.
    assert.equal(db.prepare('PRAGMA table_info(products)').all().find(value => value.name === 'id').notnull, 1);
    assert.equal(db.prepare('PRAGMA table_info(workspace_settings)').all().find(value => value.name === 'owner_id').notnull, 1);
    assert.equal(db.prepare('SELECT options_count,seo_status,goal_stage,supplier_hub_status FROM products').get().supplier_hub_status, '미전송');
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
    assert.equal(schema.filter(value => value.type === 'table').length, 13);
  } finally { db.close(); }
});

test('reapplying bootstrap preserves every current table including uncertain/running paid jobs and idempotency receipts', () => {
  const db = memoryDatabase();
  try {
    // A database may already contain all runtime-created tables before the first
    // tracked migration is applied. None of its rows should be reinitialized.
    for (const statement of runtimeDDL()) db.exec(statement.sql);
    seedLegacy(db); seedCompanions(db);
    const before = tableData(db); const schema = schemaSnapshot(db);
    assert.equal(before.length, 13); assert.ok(before.every(table => table.rows.length === 1));
    db.exec(bootstrap); db.exec(bootstrap);
    assert.deepEqual(tableData(db), before); assert.deepEqual(schemaSnapshot(db), schema);
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
    assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
  } finally { db.close(); }
});

test('bootstrap enforces foreign keys, revision checks, active-offer uniqueness and owner-scoped idempotency keys', () => {
  const db = memoryDatabase();
  try {
    db.exec(bootstrap); seedLegacy(db); seedCompanions(db);
    assert.throws(() => db.prepare('INSERT INTO product_price_policy(product_id,payload) VALUES (?,?)').run('missing-product', json), /FOREIGN KEY/);
    assert.throws(() => db.prepare('INSERT INTO collection_context(job_id,payload) VALUES (?,?)').run('missing-job', json), /FOREIGN KEY/);
    for (const table of ['product_content', 'product_options', 'category_profiles']) assert.throws(() => db.exec(`UPDATE ${table} SET revision=0`), /CHECK/);
    const insert = db.prepare('INSERT INTO collection_jobs(id,owner_id,offer_id,source_url,goal,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)');
    assert.throws(() => insert.run('duplicate', owner, 'synthetic-offer', 'synthetic', 'work', 'awaiting_connector', now, now), /UNIQUE/);
    insert.run('cancelled-copy', owner, 'synthetic-offer', 'synthetic', 'work', 'cancelled', now, now);
    insert.run('another-owner', 'other', 'synthetic-offer', 'synthetic', 'work', 'awaiting_connector', now, now);
    assert.throws(() => insert.run('bad-status', owner, 'other-offer', 'synthetic', 'work', 'collected', now, now), /CHECK/);
    for (const table of ['image_jobs', 'translation_jobs']) {
      const names = db.prepare(`PRAGMA table_info(${table})`).all().map(value => value.name);
      const source = db.prepare(`SELECT * FROM ${table}`).get();
      const copy = db.prepare(`INSERT INTO ${table}(${names.join(',')}) VALUES (${names.map(() => '?').join(',')})`);
      assert.throws(() => copy.run(...names.map(name => name === 'id' ? 'duplicate' : source[name])), /UNIQUE/);
      copy.run(...names.map(name => name === 'id' ? 'other-owner' : name === 'owner_id' ? 'other' : source[name]));
      assert.throws(() => copy.run(...names.map(name => name === 'id' ? 'orphan' : name === 'product_id' ? 'missing-product' : source[name])), /FOREIGN KEY/);
    }
  } finally { db.close(); }
});

test('schema checker detects missing indexes, changed CHECK/default/unique definitions and destructive bootstrap statements', () => {
  for (const changed of [
    bootstrap.replace('CREATE INDEX IF NOT EXISTS idx_products_owner_updated ON products(owner_id, updated_at);', ''),
    bootstrap.replace('CHECK(revision > 0)', 'CHECK(revision >= 0)'),
    bootstrap.replace("DEFAULT 'price'", "DEFAULT 'transmit'"),
    bootstrap.replace('UNIQUE(owner_id,product_id,idempotency_key), FOREIGN KEY', 'FOREIGN KEY'),
  ]) assert.throws(() => checkDatabaseSchema(changed), /differs from runtime DDL/);
  assert.throws(() => assertAdditiveBootstrap(`${bootstrap}\nDELETE FROM products;`), /only create missing/);
  assert.throws(() => assertAdditiveBootstrap('DROP TABLE products;'), /only create missing/);
  assert.throws(() => assertAdditiveBootstrap('CREATE TABLE unguarded (id TEXT);'), /only create missing/);
});

test('runtime DDL discovery reads literal TypeScript and rejects dynamic or destructive schema changes', () => {
  assert.equal(ddlFromSource('const schema = `CREATE TABLE IF NOT EXISTS fixture (id TEXT)`;').length, 1);
  assert.equal(ddlFromSource('// CREATE TABLE IF NOT EXISTS comment_only (id TEXT)\nconst unrelated = "not a schema";').length, 0);
  assert.throws(() => ddlFromSource('db.prepare(`CREATE TABLE IF NOT EXISTS ${table} (id TEXT)`);'), /dynamic DDL/);
  assert.throws(() => ddlFromSource('db.prepare("ALTER TABLE products ADD COLUMN fixture TEXT");'), /unsupported runtime DDL/);
});
