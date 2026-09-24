import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { DatabaseSync } from 'node:sqlite';
import ts from 'typescript';

function fixture() {
  const sqlite = new DatabaseSync(':memory:');
  const migration = fs.readFileSync(new URL('../db/migrations/0007_quotation_attribute_rules.sql', import.meta.url), 'utf8');
  sqlite.exec(migration); sqlite.exec(migration);
  const state = { owner: 'alice', verified: true, reads: 0 };
  const DB = { prepare(sql) { state.reads++; return { bind(...args) { return { async first() { return sqlite.prepare(sql).get(...args) ?? null; } }; } }; } };
  const cache = new Map();
  function load(file) {
    if (cache.has(file)) return cache.get(file);
    const exports = {};
    const code = ts.transpileModule(fs.readFileSync(new URL(`../${file}.ts`, import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    vm.runInNewContext(code, { exports, Error, TextEncoder, TextDecoder, Uint8Array, URL, Response, structuredClone, process: { env: { NODE_ENV: 'production' } }, require(name) {
      if (name === 'next/server') return { NextResponse: Response };
      if (name === 'cloudflare:workers') return { env: { DB } };
      if (name === '@/app/chatgpt-auth') return { getChatGPTUser: async () => ({ verifiedAccess: state.verified }), getWorkspaceOwnerId: async () => state.owner };
      if (name.startsWith('@/')) return load(name.slice(2));
      throw Error(name);
    } });
    cache.set(file, exports); return exports;
  }
  const api = load('app/api/quotation-attribute-rules/route');
  const field = load('app/quotation-schema').getQuotationSchema('80719').fields.find(item => item.id === 'noticeMaterial');
  const rules = { format: 'sourceflow-attribute-rules-v1', categoryId: '80719', rules: [{ sourceName: '상품속성: 材质', fieldId: field.id, fieldSignature: JSON.stringify(field) }] };
  const get = () => api.GET(new Request('https://example.test/api/quotation-attribute-rules?categoryId=80719'));
  const put = (body) => api.PUT(new Request('https://example.test/api/quotation-attribute-rules', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }));
  return { state, sqlite, rules, get, put, db: load('db/quotation-attribute-rules') };
}

test('saved category rules isolate owners and reject stale creation/update without overwriting', async () => {
  const f = fixture();
  try {
    assert.equal((await (await f.get()).json()).revision, 0);
    const response = await f.put({ rules: { ...f.rules, productValue: 'must not persist' }, expectedRevision: 0 });
    assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'no-store');
    const first = await response.json(); assert.equal(first.revision, 1); assert.equal(first.rules.productValue, undefined);
    assert.equal((await f.put({ rules: f.rules, expectedRevision: 0 })).status, 409);
    assert.equal((await f.put({ rules: f.rules, expectedRevision: 1 })).status, 200);
    assert.equal((await f.put({ rules: f.rules, expectedRevision: 1 })).status, 409);
    assert.equal((await (await f.get()).json()).revision, 2);
    f.state.owner = 'bob'; assert.equal((await (await f.get()).json()).rules, null);
    assert.equal((await f.put({ rules: f.rules, expectedRevision: 1 })).status, 409);
    assert.equal((await f.put({ rules: f.rules, expectedRevision: 0 })).status, 200);
  } finally { f.sqlite.close(); }
});

test('production authentication precedes storage; invalid rules cannot be persisted', async () => {
  const f = fixture();
  try {
    f.state.verified = false;
    assert.equal((await f.get()).status, 503); assert.equal((await f.put({})).status, 503); assert.equal(f.state.reads, 0);
    f.state.verified = true;
    for (const body of [
      { rules: f.rules },
      { rules: f.rules, expectedRevision: -1 },
      { rules: { ...f.rules, categoryId: '../80719' }, expectedRevision: 0 },
      { rules: { ...f.rules, rules: [{ ...f.rules.rules[0], fieldSignature: '{}' }] }, expectedRevision: 0 },
      { rules: { ...f.rules, rules: [{ ...f.rules.rules[0], fieldId: 'categoryId' }] }, expectedRevision: 0 },
      { rules: { ...f.rules, rules: [f.rules.rules[0], f.rules.rules[0]] }, expectedRevision: 0 },
    ]) assert.equal((await f.put(body)).status, 400);
    assert.equal((await f.put({ huge: 'x'.repeat(70000) })).status, 413);
    assert.equal(f.state.reads, 0);
  } finally { f.sqlite.close(); }
});

test('SQL enforces per-owner category capacity atomically while allowing existing updates', async () => {
  const f = fixture();
  try {
    for (let i = 0; i < 100; i++) assert.equal((await f.db.saveAttributeRules('alice', { ...f.rules, categoryId: String(i) }, 0)).revision, 1);
    assert.equal(await f.db.saveAttributeRules('alice', f.rules, 0), null);
    assert.equal((await f.db.saveAttributeRules('alice', { ...f.rules, categoryId: '0' }, 1)).revision, 2);
    assert.equal((await f.db.saveAttributeRules('bob', f.rules, 0)).revision, 1);
  } finally { f.sqlite.close(); }
});
