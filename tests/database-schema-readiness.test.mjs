import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const source = fs.readFileSync(new URL('../db/queries.ts', import.meta.url), 'utf8');
const output = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

function load(env) {
  const exports = {};
  const registration = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../db/product-registration.ts', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, {exports:registration});
  vm.runInNewContext(output, {
    exports,
    require: name => {
      if (name === '@/db/product-registration') return registration;
      assert.equal(name, 'cloudflare:workers');
      return { env };
    },
  }, { filename: 'db/queries.ts' });
  return exports;
}

const normalize = sql => sql.replace(/\s+/g, ' ').trim();
const expectedDDL = [
  `CREATE TABLE IF NOT EXISTS products (
    id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, source_url TEXT NOT NULL,
    title TEXT NOT NULL, source_price_cny REAL NOT NULL, exchange_rate REAL NOT NULL,
    supply_margin REAL NOT NULL, coupang_margin REAL NOT NULL, supply_price INTEGER NOT NULL,
    sale_price INTEGER NOT NULL, msrp INTEGER NOT NULL, options_count INTEGER NOT NULL DEFAULT 1,
    seo_status TEXT NOT NULL DEFAULT '대기', image_status TEXT NOT NULL DEFAULT '대기',
    quote_status TEXT NOT NULL DEFAULT '대기', registration_status TEXT NOT NULL DEFAULT '수집완료',
    supplier_hub_status TEXT NOT NULL DEFAULT '미전송', image_keys TEXT NOT NULL DEFAULT '[]',
    goal_stage TEXT NOT NULL DEFAULT 'price', created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  )`,
  'CREATE INDEX IF NOT EXISTS idx_products_owner_updated ON products(owner_id, updated_at)',
  'CREATE INDEX IF NOT EXISTS idx_products_owner_status ON products(owner_id, registration_status)',
  `CREATE TABLE IF NOT EXISTS product_removals (
    product_id TEXT PRIMARY KEY REFERENCES products(id), owner_id TEXT NOT NULL,
    removed_at TEXT NOT NULL, product_version TEXT NOT NULL
  )`,
  'CREATE INDEX IF NOT EXISTS idx_product_removals_owner_removed ON product_removals(owner_id, removed_at)',
  `CREATE TABLE IF NOT EXISTS workspace_settings (
    owner_id TEXT PRIMARY KEY, payload TEXT NOT NULL, updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS product_price_policy (
    product_id TEXT PRIMARY KEY REFERENCES products(id), payload TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS product_registration_counters (
    owner_id TEXT NOT NULL, registration_day TEXT NOT NULL,
    last_sequence INTEGER NOT NULL CHECK(last_sequence BETWEEN 1 AND 999),
    PRIMARY KEY(owner_id, registration_day)
  )`,
  `CREATE TABLE IF NOT EXISTS product_registration_numbers (
    product_id TEXT PRIMARY KEY REFERENCES products(id), owner_id TEXT NOT NULL,
    registration_day TEXT NOT NULL, sequence INTEGER NOT NULL CHECK(sequence BETWEEN 1 AND 999),
    registration_number TEXT NOT NULL CHECK(
      registration_day GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
      AND length(registration_number)=12
      AND registration_number=replace(substr(registration_day,3),'-','') || printf('%03d',sequence) || '001'
    ), created_at TEXT NOT NULL,
    UNIQUE(owner_id, registration_day, sequence), UNIQUE(owner_id, registration_number),
    FOREIGN KEY(owner_id, registration_day) REFERENCES product_registration_counters(owner_id, registration_day)
  )`,
  `CREATE TABLE IF NOT EXISTS product_registration_options (
    product_id TEXT NOT NULL REFERENCES product_registration_numbers(product_id), owner_id TEXT NOT NULL,
    option_id TEXT NOT NULL, sequence INTEGER NOT NULL CHECK(sequence BETWEEN 1 AND 999),
    PRIMARY KEY(product_id, option_id), UNIQUE(product_id, sequence)
  )`,
].map(normalize);

function mockDatabase(onBatch = async () => expectedDDL.map(() => ({ success: true }))) {
  const prepared = [];
  const batches = [];
  const db = {
    prepare(sql) {
      const normalized = normalize(sql);
      assert.doesNotMatch(normalized, /\bPRAGMA\b/i);
      const statement = { sql: normalized, run: () => assert.fail('Bootstrap must use the DDL batch only') };
      prepared.push(statement);
      return statement;
    },
    async batch(statements) {
      // Copy into this realm so the assertions compare values across VM contexts.
      batches.push(Array.from(statements, statement => statement.sql));
      return onBatch(batches.length);
    },
  };
  return { db, prepared, batches };
}

test('first bootstrap uses ten additive table/index statements without online optimize or product backfill', async () => {
  const h = mockDatabase();
  await load({ DB: h.db }).ensureDatabase();
  assert.deepEqual(h.batches, [expectedDDL]);
  assert.equal(h.prepared.length, 10);
});

test('a completed bootstrap skips DDL on subsequent calls for the same binding', async () => {
  const h = mockDatabase();
  const store = load({ DB: h.db });
  await store.ensureDatabase();
  await store.ensureDatabase();
  await store.ensureDatabase();
  assert.equal(h.batches.length, 1);
  assert.equal(h.prepared.length, 10);
});

test('a failed bootstrap propagates the error and retries before remembering success', async () => {
  const failure = new Error('D1 daily read quota exceeded');
  const h = mockDatabase(async attempt => {
    if (attempt === 1) throw failure;
    return expectedDDL.map(() => ({ success: true }));
  });
  const store = load({ DB: h.db });
  await assert.rejects(store.ensureDatabase(), error => error === failure);
  await store.ensureDatabase();
  await store.ensureDatabase();
  assert.deepEqual(h.batches, [expectedDDL, expectedDDL]);
  assert.equal(h.prepared.length, 20);
});

test('different D1 binding objects bootstrap independently within an isolate', async () => {
  const first = mockDatabase();
  const second = mockDatabase();
  const env = { DB: first.db };
  const store = load(env);
  await store.ensureDatabase();
  env.DB = second.db;
  await store.ensureDatabase();
  await store.ensureDatabase();
  env.DB = first.db;
  await store.ensureDatabase();
  assert.deepEqual(first.batches, [expectedDDL]);
  assert.deepEqual(second.batches, [expectedDDL]);
});

test('concurrent requests keep their own pending bootstrap I/O until one succeeds', async () => {
  const pending = [];
  const h = mockDatabase(() => new Promise((resolve, reject) => pending.push({ resolve, reject })));
  const store = load({ DB: h.db });
  const first = store.ensureDatabase();
  const second = store.ensureDatabase();
  assert.equal(pending.length, 2);
  assert.deepEqual(h.batches, [expectedDDL, expectedDDL]);
  const failure = new Error('second request failed');
  const rejected = assert.rejects(second, error => error === failure);
  pending[1].reject(failure);
  await rejected;
  // The still-pending first request does not suppress a new request's bootstrap.
  const third = store.ensureDatabase();
  assert.equal(pending.length, 3);
  pending[0].resolve(expectedDDL.map(() => ({ success: true })));
  await first;
  await store.ensureDatabase();
  assert.equal(pending.length, 3);
  pending[2].resolve(expectedDDL.map(() => ({ success: true })));
  await third;
});

test('a fresh isolate performs its necessary first bootstrap for an already-seen binding', async () => {
  const h = mockDatabase();
  await load({ DB: h.db }).ensureDatabase();
  await load({ DB: h.db }).ensureDatabase();
  assert.deepEqual(h.batches, [expectedDDL, expectedDDL]);
});

test('a missing D1 binding still fails without marking any schema ready', async () => {
  const env = {};
  const store = load(env);
  await assert.rejects(store.ensureDatabase(), /D1 binding DB is unavailable/);
  const h = mockDatabase();
  env.DB = h.db;
  await store.ensureDatabase();
  assert.deepEqual(h.batches, [expectedDDL]);
});
