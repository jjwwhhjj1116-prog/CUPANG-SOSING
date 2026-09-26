import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { DatabaseSync } from 'node:sqlite';

function load(file, overrides = {}, mode = 'development') {
  const output = ts.transpileModule(fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports = {};
  vm.runInNewContext(output, { exports, Response, TextDecoder, Uint8Array, process: { env: { NODE_ENV: mode } }, require(name) {
    if (name in overrides) return overrides[name];
    if (name === 'next/server') return { NextResponse: Response };
    if (name === '@/app/chatgpt-auth') return { getChatGPTUser: async () => ({ userId: 'owner' }), getWorkspaceOwnerId: async () => 'owner' };
    const modules = { '@/app/product-options': 'app/product-options.ts', '@/app/product-content': 'app/product-content.ts', '@/app/pricing': 'app/pricing.ts', '@/app/workspace-settings': 'app/workspace-settings.ts' };
    if (modules[name]) return load(modules[name], overrides, mode);
    throw Error(name);
  } });
  return exports;
}
const model = load('app/product-options.ts');
const version = '2026-09-22T00:00:00.000Z'; const nextVersion = '2026-09-22T00:00:00.001Z';
const policy = { exchangeRate: 100, supplyMargin: 0, coupangMargin: 0, minimumMargin: 0, msrpMultiple: 1, roundingUnit: 10 };
const product = { id: 'test', owner_id: 'owner', source_price_cny: 999, exchange_rate: 190, supply_margin: 40, coupang_margin: 35, pricing_policy: JSON.stringify(policy), image_keys: '["owner/image.png"]', updated_at: version };
const row = (id = 'a', values = {}) => ({ ...model.emptyOptionInput(id), originalName: '尺寸:大', supplierSku: `SKU-${id}`, unitCostCny: 10, included: true, ...values });
const payload = rows => ({ expectedRevision: 0, expectedProductVersion: version, rows });
const request = body => new Request('http://localhost', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const context = { params: Promise.resolve({ id: 'test' }) };

test('options begin empty and field provenance survives untouched source data and marks manual correction', () => {
  const empty = model.emptyProductOptions('test'); assert.equal(empty.rows.length, 0);
  const first = model.applyOptionRows(empty, [row()], version);
  assert.equal(first.rows[0].provenance.originalName, 'manual'); assert.equal(first.rows[0].provenance.translatedName, 'unverified');
  first.rows[0].provenance.originalName = 'collected';
  const edited = model.applyOptionRows(first, [{ ...row(), translatedName: '대형' }], nextVersion);
  assert.equal(edited.rows[0].provenance.originalName, 'collected'); assert.equal(edited.rows[0].provenance.translatedName, 'manual');
  assert.equal(edited.rows[0].updatedAt, nextVersion); assert.equal(first.rows[0].translatedName, '');
  const unchanged = model.applyOptionRows(edited, model.optionInputs(edited), '2026-09-23T00:00:00.000Z');
  assert.equal(unchanged.rows[0].updatedAt, nextVersion);
});

test('SKU validation rejects duplicates, forged provenance, missing included costs, invalid quantities/dimensions and unowned images', () => {
  for (const rows of [[row(), row()], [row('a'), row('b', { supplierSku: 'SKU-a' })], [row('a', { included: 'yes' })], [row('a', { unitCostCny: null })], [row('a', { unitCostCny: 0 })], [row('a', { unitCostCny: '10' })], [row('a', { unitsPerPack: 0.5 })], [row('a', { unitsPerPack: 0 })], [row('a', { widthCm: -1 })], [row('a', { minimumOrderQuantity: 1.2 })], [row('a', { imageKey: 'other/image.png' })], [row('a', { imageKey: 'owner/missing.png' })], [row('a', { provenance: { originalName: 'collected' } })], [row('a', { originalName: '', translatedName: '', supplierSku: '' })]]) {
    assert.throws(() => model.validateOptionsInput(payload(rows), 'owner', ['owner/image.png']));
  }
  assert.throws(() => model.validateOptionsInput({ ...payload([]), expectedRevision: -1 }, 'owner', []));
  assert.throws(() => model.validateOptionsInput(payload(Array.from({ length: 201 }, (_, i) => row(String(i)))), 'owner', []));
  assert.equal(model.validateOptionsInput(payload([row('draft', { included: false, unitCostCny: null, imageKey: 'owner/image.png' })]), 'owner', ['owner/image.png']).rows[0].unitCostCny, null);
});

test('each included option is priced from its own cost times pack quantity, never product representative cost', () => {
  const calculated = model.calculateOptionPrices([row('a', { unitCostCny: 5, unitsPerPack: 2 }), row('b', { unitCostCny: 0.1, unitsPerPack: 3 }), row('draft', { unitCostCny: null, included: false })], policy);
  assert.equal(calculated[0].sourceCostCny, 10); assert.equal(calculated[0].calculation.supplyPrice, 1000);
  assert.equal(calculated[1].sourceCostCny, 0.3); assert.equal(calculated[1].calculation.supplyPrice, 30);
  assert.equal(calculated[2].calculation, null); assert.equal(calculated[2].error, null);
  assert.equal(model.calculateOptionPrices([row('bad', { unitCostCny: null })], policy)[0].calculation, null);
  assert.ok(model.calculateOptionPrices([row('overflow', { unitCostCny: 1e9, unitsPerPack: 1e6 })], policy)[0].error);
  assert.equal(model.optionSourceCostCny(1e-7, 3), 3e-7);
});

test('saved product policy takes precedence; legacy policy combines stored product margins with explicit current workspace settings', () => {
  const saved = model.resolveOptionPricePolicy(product, { exchangeRate: 999 });
  assert.equal(saved.policySource, 'saved-product'); assert.equal(saved.policy.exchangeRate, 100);
  const legacy = model.resolveOptionPricePolicy({ ...product, pricing_policy: null }, { exchangeRate: 250, supplyMargin: 50, minimumMargin: 2000, minimumMarginEnabled: false, roundingUnit: 10 });
  assert.equal(legacy.policy.exchangeRate, 190); assert.equal(legacy.policy.supplyMargin, 40); assert.equal(legacy.policy.minimumMargin, 0); assert.equal(legacy.policy.roundingUnit, 10);
  assert.equal(legacy.policySource, 'product-and-workspace');
  assert.throws(() => model.resolveOptionPricePolicy({ ...product, pricing_policy: '{corrupt' }));
});

function sqliteDependencies() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(`PRAGMA foreign_keys=ON; CREATE TABLE products(id TEXT PRIMARY KEY,owner_id TEXT NOT NULL,source_price_cny REAL,quote_status TEXT,options_count INTEGER,updated_at TEXT); INSERT INTO products VALUES('test','owner',999,'완료',9,'${version}');`);
  const db = { prepare(sql) { let args = []; const q = { bind(...values) { args = values; return q; }, execute() { return sqlite.prepare(sql).all(...args); }, async first() { return q.execute()[0] ?? null; }, async run() { return sqlite.prepare(sql).run(...args); } }; return q; }, async batch(queries) { sqlite.exec('BEGIN'); try { const result = queries.map(q => ({ results: q.execute() })); sqlite.exec('COMMIT'); return result; } catch (error) { sqlite.exec('ROLLBACK'); throw error; } } };
  return { sqlite, queries: load('db/product-options.ts', { 'cloudflare:workers': { env: { DB: db } } }) };
}
test('real SQLite atomically persists options and selected count while blocking stale option/product versions and foreign ownership', async () => {
  const { sqlite, queries } = sqliteDependencies();
  try {
    const empty = await queries.readProductOptions('owner', 'test'); assert.equal(empty.rows.length, 0);
    const first = model.applyOptionRows(empty, [row('a'), row('b', { included: false, unitCostCny: null })], nextVersion);
    assert.equal((await queries.saveProductOptions('owner', first, 0, version)).revision, 1);
    const saved = sqlite.prepare('SELECT * FROM products').get(); assert.equal(saved.options_count, 1); assert.equal(saved.source_price_cny, 999); assert.equal(saved.quote_status, '대기'); assert.equal(saved.updated_at, nextVersion);
    sqlite.prepare("UPDATE products SET quote_status='완료'").run();
    assert.equal(await queries.saveProductOptions('owner', first, 0, version), null);
    assert.equal(sqlite.prepare('SELECT quote_status FROM products').get().quote_status, '완료');
    const second = model.applyOptionRows(first, [], '2026-09-22T00:00:00.002Z');
    assert.equal(await queries.saveProductOptions('owner', second, 1, version), null);
    assert.equal(await queries.saveProductOptions('other', second, 1, nextVersion), null);
    assert.equal((await queries.readProductOptions('other', 'test')).rows.length, 0);
    assert.equal((await queries.saveProductOptions('owner', second, 1, nextVersion)).revision, 2);
    assert.equal((await queries.readProductOptions('owner', 'test')).rows.length, 0);
    assert.equal(sqlite.prepare('SELECT options_count FROM products').get().options_count, 0);
  } finally { sqlite.close(); }
});

function routeWith({ find = async () => product, read = async () => model.emptyProductOptions('test'), save = async (_owner, options) => options, head = async () => ({ httpMetadata: { contentType: 'image/png' } }), mode } = {}) {
  return load('app/api/products/[id]/options/route.ts', {
    '@/db/queries': { findProduct: find, getSettings: async () => null }, '@/db/product-options': { readProductOptions: read, saveProductOptions: save }, 'cloudflare:workers': { env: { FILES: { head } } },
  }, mode);
}
test('options API returns empty data initially, recomputes prices on server and records manual edits', async () => {
  const route = routeWith(); const get = await route.GET(new Request('http://localhost'), context);
  assert.equal(get.status, 200); assert.equal(get.headers.get('cache-control'), 'no-store'); assert.equal((await get.json()).options.rows.length, 0);
  const response = await route.PATCH(request(payload([row('a', { unitCostCny: 2, unitsPerPack: 3 })])), context);
  assert.equal(response.status, 200); const body = await response.json();
  assert.equal(body.pricing.rows[0].calculation.supplyPrice, 600); assert.equal(body.pricing.rows[0].sourceCostCny, 6);
  assert.equal(body.options.rows[0].provenance.originalName, 'manual'); assert.ok(Date.parse(body.productVersion) > Date.parse(version));
  assert.equal(body.options.registration_status, undefined);
});

test('options API rejects missing/foreign product, stale versions, invalid price and unavailable storage without claiming success', async () => {
  for (const [overrides, expected] of [
    [{ find: async () => null }, 404], [{ find: async () => ({ ...product, updated_at: nextVersion }) }, 409],
    [{ read: async () => ({ ...model.emptyProductOptions('test'), revision: 1 }) }, 409], [{ save: async () => null }, 409],
    [{ save: async () => { throw Error('private D1 information'); } }, 503],
  ]) {
    const response = await routeWith(overrides).PATCH(request(payload([row()])), context);
    assert.equal(response.status, expected); assert.ok(!(await response.text()).includes('private D1'));
  }
  assert.equal((await routeWith().PATCH(request(payload([row('overflow', { unitCostCny: 1e9, unitsPerPack: 1e6 })])), context)).status, 400);
  assert.equal((await routeWith().PATCH(request({ ...payload([row()]), supplyPrice: 1 }), context)).status, 400);
});

test('options API verifies R2 object existence/type, bounded requests and production closure', async () => {
  for (const head of [async () => null, async () => ({ httpMetadata: { contentType: 'image/svg+xml' } })]) {
    assert.equal((await routeWith({ head }).PATCH(request(payload([row('a', { imageKey: 'owner/image.png' })])), context)).status, 400);
  }
  let inspected = false;
  const good = routeWith({ head: async key => { inspected = true; assert.equal(key, 'owner/image.png'); return { httpMetadata: { contentType: 'image/png' } }; } });
  assert.equal((await good.PATCH(request(payload([row('a', { imageKey: 'owner/image.png' })])), context)).status, 200); assert.equal(inspected, true);
  const oversized = await good.PATCH(request({ padding: '한'.repeat(200000) }), context); assert.equal(oversized.status, 413);
  const production = routeWith({ mode: 'production', find: async () => { throw Error('do not access'); } });
  assert.equal((await production.GET(new Request('http://localhost'), context)).status, 503);
  assert.equal((await production.PATCH(request(payload([row()])), context)).status, 503);
});

test('supplier stock keeps zero distinct from unknown and survives legacy saves', () => {
  for (const stock of [null,0,37,Number.MAX_SAFE_INTEGER]) {
    const input=model.validateOptionsInput(payload([row('a',{stock})]),'owner',[]);
    const saved=model.applyOptionRows(model.emptyProductOptions('test'),input.rows,version);
    assert.equal(saved.rows[0].stock,stock);
    saved.rows[0].provenance.stock=stock===null?'unverified':'collected';
    const legacy={...row()};delete legacy.stock;
    const updated=model.applyOptionRows(saved,model.validateOptionsInput(payload([legacy]),'owner',[]).rows,nextVersion);
    assert.equal(updated.rows[0].stock,stock);assert.equal(updated.rows[0].provenance.stock,saved.rows[0].provenance.stock);
    const cleared=model.applyOptionRows(updated,[row('a',{stock:null})],nextVersion);
    assert.equal(cleared.rows[0].stock,null);assert.equal(cleared.rows[0].provenance.stock,stock===null?'unverified':'manual');
    assert.equal(saved.rows[0].stock,stock);
    assert.equal(model.calculateOptionPrices(input.rows,policy)[0].calculation.supplyPrice,1000);
  }
  for (const stock of [-1,0.5,'0',NaN,Infinity,Number.MAX_SAFE_INTEGER+1]) assert.throws(()=>model.validateOptionsInput(payload([row('a',{stock})]),'owner',[]));
});

test('packaging measurements validate separately, survive older clients and preserve explicit clearing',()=>{
 const fields=['packagedWeightG','packagedWidthMm','packagedLengthMm','packagedHeightMm'];
 const input=row('a',{packagedWeightG:480,packagedWidthMm:400,packagedLengthMm:320,packagedHeightMm:90});
 const valid=model.validateOptionsInput(payload([input]),'owner',[]);
 let saved=model.applyOptionRows(model.emptyProductOptions('test'),valid.rows,version);
 for(const key of fields)assert.equal(saved.rows[0].provenance[key],'manual');
 const legacy={...input};for(const key of fields)delete legacy[key];
 saved=model.applyOptionRows(saved,model.validateOptionsInput(payload([legacy]),'owner',[]).rows,nextVersion);
 for(const key of fields)assert.equal(saved.rows[0][key],input[key]);
 saved=model.applyOptionRows(saved,[{...legacy,packagedWeightG:null}],nextVersion);
 assert.equal(saved.rows[0].packagedWeightG,null);assert.equal(saved.rows[0].provenance.packagedWeightG,'manual');
 assert.equal(saved.rows[0].packagedWidthMm,400);
 for(const key of fields)for(const invalid of [0,-1,1.2,'400',Infinity,NaN])assert.throws(()=>model.validateOptionsInput(payload([row('a',{[key]:invalid})]),'owner',[]));
 assert.throws(()=>model.validateOptionsInput(payload([row('a',{packagedWidthMm:1000001})]),'owner',[]));
});

test('packaging basis survives quantity edits and only explicit confirmation advances it',()=>{
 const original=row('a',{packagedWeightG:450,packagedWidthMm:400,packagedLengthMm:300,packagedHeightMm:80});
 let saved=model.applyOptionRows(model.emptyProductOptions('test'),[original],version);
 assert.equal(saved.rows[0].packagingUnitsPerPack,1);
 saved=model.applyOptionRows(saved,[{...original,unitsPerPack:2}],nextVersion);
 assert.equal(saved.rows[0].packagingUnitsPerPack,1);assert.equal(saved.rows[0].packagedWeightG,450);
 const confirmed=model.validateOptionsInput(payload([{...original,unitsPerPack:2,packagingConfirmed:true}]),'owner',[]);
 saved=model.applyOptionRows(saved,confirmed.rows,nextVersion);
 assert.equal(saved.rows[0].packagingUnitsPerPack,2);assert.equal(saved.rows[0].packagingConfirmed,undefined);
 assert.equal(model.optionInputs(saved)[0].packagingConfirmed,undefined);
 assert.throws(()=>model.validateOptionsInput(payload([{...original,packagingConfirmed:'true'}]),'owner',[]));
 assert.throws(()=>model.validateOptionsInput(payload([{...original,packagingUnitsPerPack:2}]),'owner',[]));
});
