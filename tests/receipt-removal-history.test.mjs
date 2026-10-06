import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';
import {memoryDatabase, runtimeDDL} from '../scripts/check-db-schema.mjs';

const version = '2026-10-07T00:00:00.000Z';
const companies = [{owner: 'yun', code: 'A01526306', name: '유앤채'}, {owner: 'waih', code: 'A01464742', name: '와이홉'}];
const fingerprintA = 'a'.repeat(64), fingerprintB = 'b'.repeat(64);

/** Actual source guards, receipt persistence and DELETE handler; SQLite and
 * private file bytes are ephemeral and no request can reach a real service. */
function harness(company = companies[1]) {
  const sqlite = memoryDatabase(); for (const statement of runtimeDDL()) sqlite.exec(statement.sql);
  const state = {fileCalls: [], beforeRemoval: null};
  const objects = new Map([[company.owner + '/main.png', new Uint8Array([1, 2, 3, 4])]]);
  const db = {
    prepare(sql) {
      let args = [];
      const query = {bind(...values) {args = values; return query;}, execute() {
        if (state.beforeRemoval && /^\s*INSERT INTO product_removals/iu.test(sql)) {const callback = state.beforeRemoval; state.beforeRemoval = null; callback();}
        return sqlite.prepare(sql).all(...args);
      }, async first() {return query.execute()[0] ?? null;}, async all() {return {results: query.execute()};}, async run() {return sqlite.prepare(sql).run(...args);}};
      return query;
    },
    async batch(statements) {
      sqlite.exec('BEGIN');
      try {const results = statements.map(statement => ({results: statement.execute()})); sqlite.exec('COMMIT'); return results;}
      catch (error) {sqlite.exec('ROLLBACK'); throw error;}
    },
  };
  const forbiddenFile = name => async key => {state.fileCalls.push([name, key]); throw Error('removal must preserve R2 without reading or writing');};
  const env = {DB: db, FILES: {get: forbiddenFile('get'), head: forbiddenFile('head'), put: forbiddenFile('put'), delete: forbiddenFile('delete')}};
  const cache = new Map();
  function load(file) {
    if (cache.has(file)) return cache.get(file);
    const exports = {}; cache.set(file, exports);
    const code = ts.transpileModule(fs.readFileSync(new URL('../' + file, import.meta.url), 'utf8'), {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022}}).outputText;
    vm.runInNewContext(code, {exports, Error, URL, Date, crypto, Request, Response, Headers, TextEncoder, TextDecoder, Uint8Array, DataView, structuredClone,
      process: {env: {NODE_ENV: 'production'}}, require(name) {
        if (name === 'cloudflare:workers') return {env};
        if (name === 'next/server') return {NextResponse: Response};
        if (name === '@/app/chatgpt-auth') return {getChatGPTUser: async () => ({verifiedAccess: true, userId: company.owner,
          membership: {id: company.owner, status: 'approved', role: company.code === 'A01526306' ? 'admin' : 'member', companyCode: company.code, companyName: company.name}}), getWorkspaceOwnerId: async () => company.owner};
        if (name.startsWith('@/')) return load(name.slice(2) + '.ts');
        if (name.startsWith('./') || name.startsWith('../')) return load(path.posix.join(path.posix.dirname(file), name) + '.ts');
        throw Error(name);
      }}, {filename: file});
    return exports;
  }
  const product = {id: 'p', owner_id: company.owner, source_url: 'https://detail.1688.com/offer/813724060928.html', title: 'PRIVATE HISTORY FIXTURE',
    source_price_cny: 3, exchange_rate: 350, supply_margin: 50, coupang_margin: 40, supply_price: 4050, sale_price: 6750, msrp: 8780,
    options_count: 1, seo_status: '입력됨', image_status: '입력됨', quote_status: '완료', registration_status: '검토 대기', supplier_hub_status: '미전송',
    image_keys: JSON.stringify([...objects.keys()]), goal_stage: 'price', created_at: version, updated_at: version};
  const settings = load('app/workspace-settings.ts').newWorkspaceSettings;
  const policy = load('app/pricing.ts').pricePolicy(settings);
  const source = {productVersion: version, imageKeys: product.image_keys, pricingPolicy: JSON.stringify(policy), contentRevision: 1, optionRevision: 1,
    settingsPayload: JSON.stringify(settings), profile: null,
    collection: {offerId: '813724060928', snapshot: {id: 'source-job', payload: '{ "originalCategoryAndSettings": true }', updatedAt: version, linked: true}}};
  const observedBase = Date.now() - 10000;
  async function seed() {
    const queries = load('db/queries.ts'); await queries.insertProduct(product, policy);
    await queries.insertProduct({...product, id: 'foreign', owner_id: 'other', image_keys: '[]'});
    await queries.saveSettings(company.owner, JSON.stringify(settings));
    const content = load('app/product-content.ts').emptyProductContent('p'); content.revision = 1; content.updatedAt = version;
    content.seo.title.value = '직접 검토한 상품명'; content.assets.main.value = [...objects.keys()]; content.label.manufacturer = {value: '', provenance: 'manual', updatedAt: version};
    const model = load('app/product-options.ts'), options = model.applyOptionRows(model.emptyProductOptions('p'), [
      {...model.emptyOptionInput('sku'), originalName: '원문 옵션', translatedName: '', unitCostCny: 3, included: true, imageKey: [...objects.keys()][0]},
    ], version);
    sqlite.prepare('INSERT INTO product_content VALUES(?,?,?,?,?)').run('p', company.owner, 1, JSON.stringify(content), version);
    sqlite.prepare('INSERT INTO product_options VALUES(?,?,?,?,?)').run('p', company.owner, 1, JSON.stringify(options), version);
    sqlite.prepare('INSERT INTO product_quotation_fields VALUES(?,?,?,?,?)').run('p', company.owner, 1,
      JSON.stringify({schemaVersion: 1, productId: 'p', revision: 1, overrides: {common: {salePrice: '', title: '검토 제목'}, options: {sku: {model: ''}}}, updatedAt: version}), version);
    sqlite.prepare('INSERT INTO collection_jobs VALUES(?,?,?,?,?,?,?,?)').run('source-job', company.owner, '813724060928', product.source_url, 'price', 'awaiting_connector', version, version);
    sqlite.prepare('INSERT INTO collection_context VALUES(?,?)').run('source-job', '{ "originalCategoryAndSettings": true }');
    sqlite.prepare('INSERT INTO collection_results VALUES(?,?,?,?)').run('source-job', company.owner, '{ "original": "原文", "blank": "" }', version);
    sqlite.prepare('INSERT INTO collection_products VALUES(?,?,?,?)').run('source-job', company.owner, 'p', version);
  }
  function receipt(fingerprint, resultPatch = {}, offset = 0) {
    const result = load('app/supplier-hub-receipt.ts').validateSupplierHubReceiptResult({state: 'validation-complete', filename: `YOOFAM-${fingerprint}.xlsx`,
      company: {code: company.code, name: company.name}, includedOptions: 1, observedAt: observedBase + offset, registered: false, quotationId: 'accepted-quotation', ...resultPatch},
    {filename: `YOOFAM-${fingerprint}.xlsx`, company: {code: company.code, name: company.name}, includedOptions: 1});
    return {schemaVersion: 1, evidence: 'chrome-observation', profileId: 'saved-category', categoryId: '80719', fingerprint, productVersion: version,
      recordedAt: new Date(observedBase + offset).toISOString(), result};
  }
  const save = value => load('db/supplier-hub-receipts.ts').saveSupplierHubReceipt(company.owner, 'p', value, source, 1);
  const read = fingerprint => load('db/supplier-hub-receipts.ts').readSupplierHubReceipt(company.owner, 'p', fingerprint);
  const remove = () => load('app/api/products/[id]/route.ts').DELETE(new Request('https://app.test/api/products/p', {method: 'DELETE',
    headers: {'content-type': 'application/json'}, body: JSON.stringify({expectedVersion: version})}), {params: Promise.resolve({id: 'p'})});
  const policies = () => load('db/product-removals.ts').readProductRemovalPolicies(company.owner, [{id: 'p'}]);
  const sourceSnapshot = () => JSON.stringify(Object.fromEntries(sqlite.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT IN ('supplier_hub_receipts','product_removals') ORDER BY name").all()
    .map(({name}) => [name, sqlite.prepare(`SELECT * FROM "${name}" ORDER BY rowid`).all()])));
  const receiptSnapshot = () => JSON.stringify(sqlite.prepare('SELECT * FROM supplier_hub_receipts ORDER BY owner_id,product_id,fingerprint').all());
  const fileSnapshot = () => JSON.stringify([...objects].map(([key, bytes]) => [key, [...bytes]]));
  return {sqlite, state, load, seed, receipt, save, read, remove, policies, sourceSnapshot, receiptSnapshot, fileSnapshot, close() {sqlite.close();}};
}

async function lockedRemoval(h) {
  const source = h.sourceSnapshot(), receipts = h.receiptSnapshot(), files = h.fileSnapshot();
  const response = await h.remove(); assert.equal(response.status, 409, await response.clone().text());
  assert.equal(h.sourceSnapshot(), source); assert.equal(h.receiptSnapshot(), receipts); assert.equal(h.fileSnapshot(), files);
  assert.equal(h.sqlite.prepare('SELECT count(*) AS count FROM product_removals').get().count, 0); assert.deepEqual(h.state.fileCalls, []);
}

for (const company of companies) test(`assigned receipt remains deletion-locked after newer same-fingerprint rejection with the same ID (${company.code})`, async () => {
  const h = harness(company);
  try {
    await h.seed(); const before = h.sourceSnapshot(); assert.equal(await h.save(h.receipt(fingerprintA)), true);
    assert.equal(await h.save(h.receipt(fingerprintA, {state: 'validation-rejected', status: '반려'}, 100)), true);
    const stored = await h.read(fingerprintA); assert.equal(stored.result.state, 'validation-rejected'); assert.equal(stored.result.quotationId, 'accepted-quotation');
    assert.equal(stored.result.registered, false); assert.equal(h.sourceSnapshot(), before);
    const decision = (await h.policies()).p; assert.equal(decision.blocked, true); assert.equal(decision.code, 'PRODUCT_HUB_TRANSMITTED'); await lockedRemoval(h);
  } finally {h.close();}
});

test('a rejection cannot drop or change an already assigned receipt ID, so retries cannot unlock deletion', async () => {
  const h = harness();
  try {
    await h.seed(); assert.equal(await h.save(h.receipt(fingerprintA)), true); const before = h.receiptSnapshot();
    for (const quotationId of [undefined, '', 'different-quotation']) {
      assert.equal(await h.save(h.receipt(fingerprintA, {state: 'validation-rejected', quotationId}, 100)), false);
      assert.equal(h.receiptSnapshot(), before);
    }
    await lockedRemoval(h);
  } finally {h.close();}
});

test('newer unassigned rejection under another fingerprint cannot hide the earlier accepted external quotation', async () => {
  const h = harness();
  try {
    await h.seed(); assert.equal(await h.save(h.receipt(fingerprintA)), true);
    assert.equal(await h.save(h.receipt(fingerprintB, {state: 'validation-rejected', quotationId: ''}, 100)), true);
    assert.equal(h.sqlite.prepare('SELECT fingerprint FROM supplier_hub_receipts ORDER BY observed_at DESC LIMIT 1').get().fingerprint, fingerprintB);
    assert.equal((await h.read(fingerprintA)).result.registered, false); await lockedRemoval(h);
  } finally {h.close();}
});

test('registered:false on a validated completed receipt is observational and never permits local removal', async () => {
  const h = harness();
  try {await h.seed(); assert.equal(await h.save(h.receipt(fingerprintA, {registered: false})), true); await lockedRemoval(h);}
  finally {h.close();}
});

test('an unrelated owner receipt does not lock a product without an owned external receipt', async () => {
  const h = harness();
  try {
    await h.seed(); const value = h.receipt(fingerprintA);
    h.sqlite.prepare('INSERT INTO supplier_hub_receipts VALUES(?,?,?,?,?,?)').run('other', 'p', fingerprintA, value.result.observedAt,
      h.load('app/supplier-hub-receipt.ts').supplierHubReceiptOrder(value.result), JSON.stringify(value));
    assert.equal((await h.policies()).p.blocked, false);
    const source = h.sourceSnapshot(), receipts = h.receiptSnapshot(), files = h.fileSnapshot();
    const response = await h.remove(); assert.equal(response.status, 200, await response.clone().text());
    assert.equal(h.sourceSnapshot(), source); assert.equal(h.receiptSnapshot(), receipts); assert.equal(h.fileSnapshot(), files); assert.deepEqual(h.state.fileCalls, []);
  } finally {h.close();}
});

test('DB key versus payload fingerprint mismatch fails closed instead of trusting a rejected payload', async () => {
  const h = harness();
  try {
    await h.seed(); assert.equal(await h.save(h.receipt(fingerprintA, {state: 'validation-rejected', quotationId: ''})), true);
    h.sqlite.prepare('UPDATE supplier_hub_receipts SET fingerprint=? WHERE owner_id=? AND product_id=?').run(fingerprintB, companies[1].owner, 'p');
    const decision = (await h.policies()).p;
    assert.equal(decision.blocked, true); assert.equal(decision.code, 'PRODUCT_HUB_EVIDENCE_UNCONFIRMED'); await lockedRemoval(h);
  } finally {h.close();}
});

test('pure file rejection without an assigned ID can be removed without changing source/receipt/file bytes', async () => {
  const h = harness();
  try {
    await h.seed(); assert.equal(await h.save(h.receipt(fingerprintA, {state: 'validation-rejected', quotationId: ''})), true);
    const decision = (await h.policies()).p; assert.equal(decision.blocked, false); assert.equal(decision.code, null);
    const source = h.sourceSnapshot(), receipts = h.receiptSnapshot(), files = h.fileSnapshot();
    const response = await h.remove(); assert.equal(response.status, 200, await response.clone().text());
    assert.equal(h.sourceSnapshot(), source); assert.equal(h.receiptSnapshot(), receipts); assert.equal(h.fileSnapshot(), files);
    assert.equal(h.sqlite.prepare('SELECT count(*) AS count FROM product_removals').get().count, 1); assert.deepEqual(h.state.fileCalls, []);
  } finally {h.close();}
});

test('mutable local registration labels alone do not pretend there is an external Hub receipt', async () => {
  const h = harness();
  try {
    await h.seed(); h.sqlite.prepare('UPDATE products SET registration_status=?,supplier_hub_status=? WHERE id=?').run('등록완료', 'SKU ID 확인', 'p');
    assert.equal((await h.policies()).p.blocked, false);
    const source = h.sourceSnapshot(), files = h.fileSnapshot();
    const response = await h.remove(); assert.equal(response.status, 200, await response.clone().text());
    assert.equal(h.sourceSnapshot(), source); assert.equal(h.fileSnapshot(), files); assert.deepEqual(h.state.fileCalls, []);
    assert.equal(h.sqlite.prepare('SELECT count(*) AS count FROM supplier_hub_receipts').get().count, 0);
  } finally {h.close();}
});

test('a new accepted receipt arriving after removal preflight is caught by the atomic receipt snapshot guard', async () => {
  const h = harness();
  try {
    await h.seed(); assert.equal(await h.save(h.receipt(fingerprintA, {state: 'validation-rejected', quotationId: ''})), true);
    const source = h.sourceSnapshot(), files = h.fileSnapshot();
    const accepted = h.receipt(fingerprintB, {}, 100);
    h.state.beforeRemoval = () => h.sqlite.prepare('INSERT INTO supplier_hub_receipts VALUES(?,?,?,?,?,?)').run(companies[1].owner, 'p', fingerprintB,
      accepted.result.observedAt, h.load('app/supplier-hub-receipt.ts').supplierHubReceiptOrder(accepted.result), JSON.stringify(accepted));
    const response = await h.remove(); assert.equal(response.status, 409, await response.clone().text());
    assert.equal(h.sourceSnapshot(), source); assert.equal(h.fileSnapshot(), files); assert.deepEqual(h.state.fileCalls, []);
    assert.equal(h.sqlite.prepare('SELECT count(*) AS count FROM product_removals').get().count, 0);
    assert.equal((await h.policies()).p.code, 'PRODUCT_HUB_TRANSMITTED');
    assert.equal(h.sqlite.prepare('SELECT count(*) AS count FROM supplier_hub_receipts').get().count, 2);
  } finally {h.close();}
});
