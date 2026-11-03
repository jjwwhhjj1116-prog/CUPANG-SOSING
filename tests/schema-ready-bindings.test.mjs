import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const timestamp = '2026-11-04T00:00:00.000Z';
const specs = [
  { name: 'content', file: 'product-content', method: 'readProductContent', ddl: 1, ownerIndex: 0 },
  { name: 'options', file: 'product-options', method: 'readProductOptions', ddl: 1, ownerIndex: 0 },
  { name: 'profiles', file: 'category-profiles', method: 'getCategoryProfile', ddl: 3, ownerIndex: 0 },
  { name: 'labels', file: 'product-labels', method: 'readProductLabels', ddl: 2, ownerIndex: 1 },
];
function load(env) {
  const modules = new Map();
  const unused = new Set(['@/db/registration-stage-status', '@/db/image-no-text-receipts', '@/app/free-image-edit-review', '@/db/quotation-fields']);
  function require(name) {
    if (name === 'cloudflare:workers') return { env };
    if (unused.has(name)) return {};
    assert.ok(name.startsWith('@/'), `Unexpected dependency: ${name}`);
    if (modules.has(name)) return modules.get(name);
    const exports = {}; modules.set(name, exports);
    const filename = name.slice(2) + '.ts';
    vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../' + filename, import.meta.url), 'utf8'),
      { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
    { exports, require, Error, TextEncoder, URL, structuredClone }, { filename });
    return exports;
  }
  return require;
}
function database(spec, onSetup = async () => {}) {
  const setups = [], reads = [], rows = new Map();
  const setup = async statements => { setups.push(Array.from(statements, statement => statement.sql)); await onSetup(setups.length); return []; };
  const db = {
    prepare(sql) {
      let args = [];
      const statement = { sql: sql.replace(/\s+/gu, ' ').trim(), bind(...values) { args = values; return statement; },
        async run() { return setup([statement]); },
        async first() {
          reads.push({ sql: statement.sql, args });
          assert.match(statement.sql, /\bowner_id=\?/u);
          assert.equal(args[spec.ownerIndex === 0 ? 1 : 0], 'product');
          return structuredClone(rows.get(args[spec.ownerIndex]) ?? null);
        },
      };
      return statement;
    },
    async batch(statements) { return setup(statements); },
  };
  return { db, setups, reads, rows };
}
function storedRow(spec, require, revision) {
  let state;
  if (spec.name === 'content') state = require('@/app/product-content').emptyProductContent('product');
  else if (spec.name === 'options') state = require('@/app/product-options').emptyProductOptions('product');
  else if (spec.name === 'labels') state = { schemaVersion: 1, productId: 'product', overrides: { common: {}, options: {} } };
  else state = { name: `Profile ${revision}`, categoryId: '', categoryPath: ['Saved', 'Category'], template: null, mappings: [] };
  return { id: 'product', revision, updated_at: timestamp, created_at: timestamp, payload: JSON.stringify({ ...state, ...(spec.name === 'profiles' ? {} : { revision, updatedAt: timestamp }) }) };
}

for (const spec of specs) {
  test(`${spec.name}: completed DDL setup is binding-local while rows, owner filters and validation stay fresh`, async () => {
    const h = database(spec), env = { DB: h.db }, require = load(env), store = require('@/db/' + spec.file);
    const read = owner => store[spec.method](owner, 'product');
    const empty = await read('owner'); assert.ok(empty === null || empty.revision === 0);
    h.rows.set('owner', storedRow(spec, require, 1)); assert.equal((await read('owner')).revision, 1);
    h.rows.set('owner', storedRow(spec, require, 2)); assert.equal((await read('owner')).revision, 2);
    const foreign = await read('other'); assert.ok(foreign === null || foreign.revision === 0);
    const invalid = storedRow(spec, require, 3), state = JSON.parse(invalid.payload);
    if (spec.name === 'profiles') state.name = ''; else state.productId = 'another-product';
    h.rows.set('owner', { ...invalid, payload: JSON.stringify(state) });
    await assert.rejects(read('owner'));
    assert.equal(h.setups.length, 1); assert.equal(h.setups[0].length, spec.ddl);
    assert.ok(h.setups[0].every(sql => /^CREATE (?:TABLE|INDEX) IF NOT EXISTS /u.test(sql)));
    assert.deepEqual(h.reads.map(row => row.args[spec.ownerIndex]), ['owner', 'owner', 'owner', 'other', 'owner']);
  });

  test(`${spec.name}: a failed setup retries fully and only completed success is remembered`, async () => {
    const failure = Error('D1 setup failed'), h = database(spec, async attempt => { if (attempt === 1) throw failure; });
    const store = load({ DB: h.db })('@/db/' + spec.file), read = () => store[spec.method]('owner', 'product');
    await assert.rejects(read(), error => error === failure); assert.equal(h.reads.length, 0);
    await read(); await read(); assert.equal(h.setups.length, 2);
    assert.ok(h.setups.every(statements => statements.length === spec.ddl)); assert.equal(h.reads.length, 2);
  });

  test(`${spec.name}: separate bindings and fresh module isolates initialize independently`, async () => {
    const first = database(spec), second = database(spec), env = { DB: first.db }, store = load(env)('@/db/' + spec.file);
    const read = () => store[spec.method]('owner', 'product');
    await read(); env.DB = second.db; await read(); await read(); env.DB = first.db; await read();
    assert.equal(first.setups.length, 1); assert.equal(second.setups.length, 1);
    await load(env)('@/db/' + spec.file)[spec.method]('owner', 'product'); assert.equal(first.setups.length, 2);
  });

  test(`${spec.name}: concurrent requests keep pending setup I/O local and a late failure cannot clear success`, async () => {
    const pending = [], h = database(spec, () => new Promise((resolve, reject) => pending.push({ resolve, reject })));
    const store = load({ DB: h.db })('@/db/' + spec.file), read = () => store[spec.method]('owner', 'product');
    const first = read(), second = read(); assert.equal(pending.length, 2);
    const failure = Error('second request failed'), rejected = assert.rejects(second, error => error === failure);
    pending[0].resolve(); await first; pending[1].reject(failure); await rejected;
    const third = read(); pending[2]?.resolve(); await third; assert.equal(h.setups.length, 2);
  });
}
