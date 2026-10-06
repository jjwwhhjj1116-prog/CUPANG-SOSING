import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { createRequire } from 'node:module';
import * as parse5 from 'parse5';
import * as nodeCrypto from 'node:crypto';
import ts from 'typescript';
import { memoryDatabase, runtimeDDL } from '../scripts/check-db-schema.mjs';

const native = createRequire(import.meta.url);
const version = '2026-10-06T07:00:00.000Z';
const companies = [{ code: 'A01464742', name: '와이홉' }, { code: 'A01526306', name: '유앤채' }];
const cases = [
  { name: 'absent settings', amounts: [17920, 29870, 38830], unit: 10, mode: 'nearest' },
  { name: 'explicit empty settings retain legacy defaults', settings: {}, amounts: [18000, 30000, 39000], unit: 100, mode: 'up' },
  { name: 'explicit partial settings retain their values', settings: { minimumMarginEnabled: false, minimumMargin: 0, msrpMultiple: 1.7, roundingUnit: 10, roundingMode: 'nearest', brand: '', manufacturer: '' }, amounts: [17920, 29870, 50780], unit: 10, mode: 'nearest' },
  { name: 'saved product policy takes precedence', policy: { exchangeRate: 200, supplyMargin: 20, coupangMargin: 25, minimumMargin: 0, msrpMultiple: 1.4, roundingUnit: 1, roundingMode: 'nearest' }, amounts: [6400, 8533, 11946], unit: 1, mode: 'nearest' },
];
const prices = row => ['supplyPrice', 'salePrice', 'msrp'].map(key => row.fields[key].value);
const amounts = price => [price.supplyPrice, price.salePrice, price.msrp];
const policy = value => ({ exchangeRate: value.exchangeRate, supplyMargin: value.supplyMargin, coupangMargin: value.coupangMargin, minimumMargin: value.minimumMargin, msrpMultiple: value.msrpMultiple, roundingUnit: value.roundingUnit, roundingMode: value.roundingMode ?? 'up' });
const plain = value => JSON.parse(JSON.stringify(value));
const text = tree => Array.isArray(tree) ? tree.map(text).join('') : tree && typeof tree === 'object' ? text(tree.props?.children) : tree == null ? '' : String(tree);

function harness(company) {
  const owner = 'local-' + company.code;
  const email = company.code === 'A01526306' ? 'jwhj1116@kakao.com' : 'unari8484@gmail.com';
  const role = company.code === 'A01526306' ? 'admin' : 'member';
  const sqlite = memoryDatabase();
  for (const statement of runtimeDDL()) sqlite.exec(statement.sql);
  let externalCalls = 0;
  const db = { prepare(sql) { let args = []; const q = { bind(...values) { args = values; return q; }, execute() { return sqlite.prepare(sql).all(...args); }, async all() { return { results: q.execute() }; }, async first() { return q.execute()[0] ?? null; }, async run() { return sqlite.prepare(sql).run(...args); } }; return q; },
    async batch(queries) { sqlite.exec('BEGIN'); try { const result = queries.map(q => ({ results: q.execute() })); sqlite.exec('COMMIT'); return result; } catch (error) { sqlite.exec('ROLLBACK'); throw error; } } };
  const cache = new Map();
  function load(file) {
    if (cache.has(file)) return cache.get(file);
    const exports = {}; cache.set(file, exports);
    const code = ts.transpileModule(fs.readFileSync(new URL('../' + file, import.meta.url), 'utf8'), { fileName: file, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
    vm.runInNewContext(code, { exports, Error, crypto: nodeCrypto.webcrypto, URL, URLSearchParams, Headers, Response, Request, TextEncoder, TextDecoder, Uint8Array, DataView, structuredClone,
      process: { env: { NODE_ENV: 'production' } }, fetch() { externalCalls++; throw Error('No external requests allowed'); },
      require(name) {
        if (name === 'parse5') return parse5;
        if (name === 'node:crypto') return nodeCrypto;
        if (name === 'next/server') return { NextResponse: Response };
        if (name === 'cloudflare:workers') return { env: { DB: db } };
        if (name === '@/app/chatgpt-auth') return { getChatGPTUser: async () => ({ verifiedAccess: true, userId: owner, email, membership: { id: owner, email, role, status: 'approved', companyCode: company.code, companyName: company.name } }), getWorkspaceOwnerId: async () => owner };
        if (name === 'react') return { useRef: initial => ({ current: initial }), useState: initial => [initial, () => { throw Error('Unexpected state update on clean initial render'); }] };
        if (name === '@/app/components/option-quotation-prices') return { OptionQuotationPrices: () => null };
        if (name === '@/app/components/option-price-preview') return { OptionPricePreview: () => null };
        if (name.startsWith('@/')) return load(name.slice(2) + '.ts');
        if (name.startsWith('./') || name.startsWith('../')) return load(path.posix.join(path.posix.dirname(file), name) + '.ts');
        return native(name);
      },
    }, { filename: file });
    return exports;
  }
  // Invoke the actual private Dashboard resolver without running the Dashboard.
  // Product/Settings annotations are erased; its only runtime dependency is pricePolicy.
  const dashboard = fs.readFileSync(new URL('../app/components/dashboard-client.tsx', import.meta.url), 'utf8');
  const start = dashboard.indexOf('function savedPricePolicy(');
  assert.ok(start >= 0, 'Dashboard saved price resolver exists');
  const resolver = {};
  vm.runInNewContext(ts.transpileModule(dashboard.slice(start).replace('function savedPricePolicy(', 'export function savedPricePolicy('), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
    { exports: resolver, pricePolicy: load('app/pricing.ts').pricePolicy });
  const raw = () => JSON.stringify(Object.fromEntries(['products', 'product_options', 'product_price_policy', 'workspace_settings', 'product_quotation_fields'].map(table => [table, sqlite.prepare('SELECT * FROM ' + table + ' ORDER BY 1').all()])));
  return { owner, sqlite, load, resolver, raw, get externalCalls() { return externalCalls; } };
}

for (const company of companies) for (const fixture of cases) test(`${company.name}: options, price editor and quotation agree with ${fixture.name}`, async () => {
  const h = harness(company);
  try {
    const product = { id: 'local-product', owner_id: h.owner, source_url: 'https://detail.1688.com/offer/123456789.html', title: 'LOCAL TEST ONLY',
      source_price_cny: 25.6, exchange_rate: 350, supply_margin: 50, coupang_margin: 40, supply_price: 17920, sale_price: 29870, msrp: 38830, options_count: 2,
      seo_status: '대기', image_status: '대기', quote_status: '대기', registration_status: '수동 입력', supplier_hub_status: '미전송', image_keys: '[]', goal_stage: 'collect', created_at: version, updated_at: version };
    const queries = h.load('db/queries.ts');
    await queries.insertProduct(product, fixture.policy);
    if (fixture.settings !== undefined) await queries.saveSettings(h.owner, JSON.stringify(fixture.settings));
    const model = h.load('app/product-options.ts');
    const single = { ...model.emptyOptionInput('single'), originalName: '原文 单个', translatedName: '', supplierSku: 'LOCAL-SINGLE', unitCostCny: 25.6, unitsPerPack: 1, included: true };
    const pack = { ...model.emptyOptionInput('pack'), originalName: '原文 三个', translatedName: '검토한 묶음', supplierSku: 'LOCAL-PACK', unitCostCny: 25.6, unitsPerPack: 3, included: true };
    const excluded = { ...model.emptyOptionInput('excluded'), originalName: '原文 排除', unitCostCny: null, unitsPerPack: 7, included: false };
    const options = model.applyOptionRows(model.emptyProductOptions(product.id), [single, pack, excluded], version);
    options.rows[0].provenance.originalName = 'collected';
    options.rows[0].provenance.translatedName = 'manual';
    h.sqlite.prepare('INSERT INTO product_options VALUES(?,?,?,?,?)').run(product.id, h.owner, options.revision, JSON.stringify(options), version);
    const overrides = h.load('app/quotation-schema.ts').emptyQuotationOverrides();
    overrides.options.single = { supplyPrice: '12345', msrp: '' };
    const state = { schemaVersion: 1, productId: product.id, revision: 1, overrides, updatedAt: version };
    h.sqlite.prepare('INSERT INTO product_quotation_fields VALUES(?,?,?,?,?)').run(product.id, h.owner, 1, JSON.stringify(state), version);
    const before = h.raw();
    const response = await h.load('app/api/settings/route.ts').GET();
    assert.equal(response.status, 200, await response.clone().text());
    const settingsBody = await response.json();
    assert.equal(settingsBody.settings === null, fixture.settings === undefined);
    const settings = h.load('app/workspace-settings.ts').savedRegistrationSettings(settingsBody.settings);
    const savedProduct = await queries.findProduct(h.owner, product.id);
    const displayPolicy = h.resolver.savedPricePolicy(savedProduct, settings);
    assert.equal(displayPolicy.roundingUnit, fixture.unit);
    assert.equal(displayPolicy.roundingMode ?? 'up', fixture.mode);
    const editor = h.load('app/components/price-editor.tsx').PriceEditor({ sourcePrice: product.source_price_cny, initial: displayPolicy, onSave: async () => { throw Error('Read-only render must not save'); } });
    for (const amount of fixture.amounts) assert.ok(text(editor).includes(amount.toLocaleString('ko-KR') + '원'), 'PriceEditor displays ' + amount);
    const context = { params: Promise.resolve({ id: product.id }) };
    const request = suffix => new Request('https://app.test/api/products/' + product.id + suffix);
    const optionReply = await h.load('app/api/products/[id]/options/route.ts').GET(request('/options'), context);
    assert.equal(optionReply.status, 200, await optionReply.clone().text());
    const optionBody = await optionReply.json();
    const quotationReply = await h.load('app/api/products/[id]/quotation-fields/route.ts').GET(request('/quotation-fields'), context);
    assert.equal(quotationReply.status, 200, await quotationReply.clone().text());
    const quotation = await quotationReply.json();
    const exports = h.load('app/exports/quotation-source.ts');
    const exportSource = await exports.readQuotationExportSource(h.owner, product.id, null);
    assert.deepEqual(plain(exportSource.company), company);
    const exported = exports.resolveQuotationExport(exportSource);
    const exportAutomatic = exports.resolveQuotationExport({ ...exportSource, state: { ...exportSource.state, overrides: { common: {}, options: {} } } });
    for (const row of [single, pack]) {
      const expected = amounts(h.load('app/pricing.ts').calculatePrice(row.unitCostCny, displayPolicy, row.unitsPerPack));
      const displayed = quotation.automatic.rows.find(item => item.optionId === row.id);
      const automaticExport = exportAutomatic.rows.find(item => item.optionId === row.id);
      assert.deepEqual(prices(displayed), expected.map(String));
      assert.deepEqual(Array.from(prices(automaticExport)), expected.map(String));
    }
    for (const resolved of [quotation.resolved, exported]) {
      const manual = resolved.rows.find(row => row.optionId === single.id);
      assert.equal(manual.fields.supplyPrice.value, '12345');
      assert.equal(manual.fields.msrp.value, '');
      assert.equal(resolved.rows.find(row => row.optionId === excluded.id).included, false);
    }
    assert.deepEqual(optionBody.options.rows.map(row => [row.originalName, row.translatedName, row.unitCostCny, row.unitsPerPack, row.included]), Array.from(options.rows, row => [row.originalName, row.translatedName, row.unitCostCny, row.unitsPerPack, row.included]));
    assert.equal(optionBody.options.rows[0].provenance.originalName, 'collected');
    assert.equal(optionBody.options.rows[0].provenance.translatedName, 'manual');
    assert.equal(optionBody.pricing.rows[2].calculation, null);
    assert.equal(optionBody.pricing.rows[2].error, null);
    assert.equal(h.raw(), before, 'Product/options/policy/settings/quotation bytes remain unchanged');
    assert.equal(h.externalCalls, 0);
    // This failed only for absent settings before the default-policy repair.
    assert.deepEqual(policy(optionBody.pricing.policy), policy(displayPolicy));
    for (const row of [single, pack]) {
      const optionPrice = optionBody.pricing.rows.find(item => item.optionId === row.id).calculation;
      const quotePrice = quotation.automatic.rows.find(item => item.optionId === row.id);
      assert.deepEqual(amounts(optionPrice).map(String), prices(quotePrice));
    }
    assert.deepEqual(amounts(optionBody.pricing.rows[0].calculation), fixture.amounts);
  } finally { h.sqlite.close(); }
});
