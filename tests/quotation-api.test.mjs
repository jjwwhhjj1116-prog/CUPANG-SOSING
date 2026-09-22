import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { webcrypto, createHash } from 'node:crypto';
import { unzipSync } from 'fflate';

function load(file, overrides = {}, mode = 'development') {
  const output = ts.transpileModule(fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports = {};
  vm.runInNewContext(output, { exports, Response, TextEncoder, TextDecoder, Uint8Array, ArrayBuffer, DataView, structuredClone, Blob, CompressionStream, DecompressionStream, crypto: webcrypto,
    process: { env: { NODE_ENV: mode } }, require(name) {
      if (name in overrides) return overrides[name];
      if (name === 'next/server') return { NextResponse: Response };
      if (name === '@/app/chatgpt-auth') return { getChatGPTUser: async () => ({ userId: 'owner' }), getWorkspaceOwnerId: async () => 'owner' };
      if (name.startsWith('@/')) return load(`${name.slice(2)}.ts`, overrides, mode);
      throw Error(name);
    } });
  return exports;
}
const contentModel = load('app/product-content.ts'); const optionsModel = load('app/product-options.ts');
const { quotationData } = load('app/exports/quotation-data.ts');
const { defaultSettings } = load('app/workspace-settings.ts');
const policy = { exchangeRate: 100, supplyMargin: 0, coupangMargin: 0, minimumMargin: 0, msrpMultiple: 1, roundingUnit: 10 };
const product = { id: 'test', owner_id: 'owner', title: '원문 상품', source_url: 'synthetic://test', source_price_cny: 999, supply_price: 99900, sale_price: 99900, msrp: 99900,
  pricing_policy: JSON.stringify(policy), exchange_rate: 190, supply_margin: 40, coupang_margin: 35, options_count: 2, image_keys: '["owner/option.png"]', updated_at: '2026-09-22T00:00:00.000Z' };
const content = contentModel.applyContentPatch(contentModel.emptyProductContent('test'), { seo: { title: '=SUM(1,1)', description: '설명' } }, product.updated_at);
const optionRows = [
  { ...optionsModel.emptyOptionInput('first'), originalName: '原文', translatedName: '첫 번째', supplierSku: 'SKU-1', unitCostCny: 0.001, unitsPerPack: 3, included: true, imageKey: 'owner/option.png' },
  { ...optionsModel.emptyOptionInput('second'), originalName: '第二', supplierSku: 'SKU-2', unitCostCny: 0.1, unitsPerPack: 3, included: true },
  { ...optionsModel.emptyOptionInput('excluded'), originalName: '제외됨', unitCostCny: null },
];
const options = optionsModel.applyOptionRows(optionsModel.emptyProductOptions('test'), optionRows, product.updated_at);
const png = new Uint8Array(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2RkcAAAAASUVORK5CYII=', 'base64'));
const templateBytes = new TextEncoder().encode('상품명,옵션명,공급가,이미지\r\n');
const sha = createHash('sha256').update(templateBytes).digest('hex'); const templateKey = `owner/category-templates/${sha}.csv`;
const profile = { id: 'profile', revision: 1, verification: 'draft', createdAt: product.updated_at, updatedAt: product.updated_at,
  name: '시험용 양식', categoryId: 'test-category', categoryPath: ['시험'],
  template: { name: 'synthetic.csv', format: 'csv', sha256: sha, sheetName: '', headerRow: 1, headers: ['상품명', '옵션명', '공급가', '이미지'], storageKey: templateKey },
  mappings: [{ column: 0, field: 'title', required: true }, { column: 1, field: 'skuName', required: true }, { column: 2, field: 'supplyPrice', required: true }, { column: 3, field: 'mainImage', required: false }],
};
const assets = [{ key: 'owner/option.png', name: 'assets/image-001.png', data: png }];

test('quotation rows use the identical option policy/decimal cost calculation and omit excluded SKUs', () => {
  const rows = quotationData(product, content, defaultSettings, options.rows, assets);
  const calculated = optionsModel.calculateOptionPrices(optionRows, policy).filter(row => row.included);
  assert.equal(rows.length, 2); assert.equal(rows[0].skuName, '첫 번째'); assert.equal(rows[1].skuName, '第二');
  assert.equal(rows[0].sourcePriceCny, 0.003); assert.equal(rows[1].sourcePriceCny, 0.3);
  assert.equal(rows[0].supplyPrice, calculated[0].calculation.supplyPrice); assert.equal(rows[1].supplyPrice, calculated[1].calculation.supplyPrice);
  assert.equal(rows[0].mainImage, assets[0].name); assert.equal(rows[1].mainImage, '');
  assert.equal(rows[0].barcode, ''); assert.equal(rows[0].countryOfOrigin, '');
  assert.throws(() => quotationData(product, content, defaultSettings, options.rows, []), /누락/);
  assert.throws(() => quotationData(product, content, defaultSettings, [{ ...optionRows[0], included: false }], assets), /포함/);
});

test('quotation data keeps representative product price separate and does not create SKU rows when none are saved', () => {
  const rows = quotationData(product, content, defaultSettings, [], []);
  assert.equal(rows.length, 1); assert.equal(rows[0].sourcePriceCny, 999); assert.equal(rows[0].supplyPrice, product.supply_price);
  assert.equal(rows[0].skuId, undefined); assert.equal(rows[0].skuName, undefined);
});

function routeWith({ find = async () => product, readOptions = async () => options, readContent = async () => content, readProfile = async () => profile,
  get = async key => key === templateKey ? { size: templateBytes.length, arrayBuffer: async () => templateBytes.slice().buffer } : { size: png.length, arrayBuffer: async () => png.slice().buffer },
  mode,
} = {}) {
  return load('app/api/products/[id]/quotation/route.ts', {
    '@/db/queries': { findProduct: find, getSettings: async () => null }, '@/db/product-options': { readProductOptions: readOptions },
    '@/db/product-content': { readProductContent: readContent }, '@/db/category-profiles': { getCategoryProfile: readProfile },
    'cloudflare:workers': { env: { FILES: { get } } },
  }, mode);
}
const request = body => new Request('http://localhost', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const context = { params: Promise.resolve({ id: 'test' }) }; const preview = { action: 'preview', profileId: profile.id, dataStartRow: 2 };

test('real preview/export pipeline fills mapped CSV, includes option assets and preserves manual provenance', async () => {
  const route = routeWith(); const response = await route.POST(request(preview), context);
  assert.equal(response.status, 200); const review = await response.json();
  assert.match(review.fingerprint, /^[a-f0-9]{64}$/); assert.equal(review.report.optionRevision, 1); assert.equal(review.report.rowCount, 2);
  assert.equal(review.report.submissionReady, false); assert.equal(review.rows[0][2], 10); assert.equal(review.rows[1][2], 30);
  const exported = await route.POST(request({ ...preview, action: 'export', fingerprint: review.fingerprint }), context);
  assert.equal(exported.status, 200); assert.equal(exported.headers.get('content-type'), 'application/zip'); assert.equal(exported.headers.get('cache-control'), 'no-store');
  const files = unzipSync(new Uint8Array(await exported.arrayBuffer()));
  const csv = new TextDecoder().decode(files['quotation-filled.csv']);
  assert.ok(csv.includes('"\'=SUM(1,1)"')); assert.ok(csv.includes('"첫 번째","10","assets/image-001.png"'));
  assert.ok(!csv.includes('제외됨')); assert.deepEqual(files['assets/image-001.png'], png);
  const exportedOptions = JSON.parse(new TextDecoder().decode(files['options.json']));
  assert.equal(exportedOptions.rows.length, 3); assert.equal(exportedOptions.rows[0].provenance.originalName, 'manual');
  assert.equal(JSON.parse(new TextDecoder().decode(files['quotation-report.json'])).submissionReady, false);
});

test('quotation export rejects stale approval fingerprints and detects edits during generation', async () => {
  let reads = 0;
  const stale = routeWith({ get: async () => { reads++; throw Error('must not load stale export'); } });
  const response = await stale.POST(request({ ...preview, action: 'export', fingerprint: '0'.repeat(64) }), context);
  assert.equal(response.status, 409); assert.equal(reads, 0);
  let calls = 0;
  const changing = routeWith({ readOptions: async () => ({ ...options, revision: ++calls }) });
  assert.equal((await changing.POST(request(preview), context)).status, 409);
});

test('quotation API enforces owner/template links, missing object errors and SHA-256 of the real original bytes', async () => {
  for (const [overrides, expected] of [
    [{ find: async () => null }, 404], [{ readProfile: async () => null }, 404],
    [{ readProfile: async () => ({ ...profile, template: { ...profile.template, storageKey: `other/category-templates/${sha}.csv` } }) }, 409],
    [{ get: async () => null }, 409],
    [{ get: async key => key === templateKey ? { size: 5_000_001 } : { size: png.length, arrayBuffer: async () => png.slice().buffer } }, 413],
    [{ get: async key => key === templateKey ? { size: 3, arrayBuffer: async () => new TextEncoder().encode('bad').buffer } : { size: png.length, arrayBuffer: async () => png.slice().buffer } }, 400],
  ]) assert.equal((await routeWith(overrides).POST(request(preview), context)).status, expected);
  const foreignOptions = { ...options, rows: [{ ...options.rows[0], imageKey: 'other/private.png' }] };
  assert.equal((await routeWith({ readOptions: async () => foreignOptions }).POST(request(preview), context)).status, 409);
});

test('quotation API validates action/start rows/size and is closed in production', async () => {
  for (const body of [null, {}, { ...preview, dataStartRow: 1 }, { ...preview, dataStartRow: 2.5 }, { ...preview, action: 'submit' }, { ...preview, action: 'export' }]) {
    assert.equal((await routeWith().POST(request(body), context)).status, 400);
  }
  assert.equal((await routeWith().POST(request({ padding: 'a'.repeat(5000) }), context)).status, 413);
  const production = routeWith({ mode: 'production', find: async () => { throw Error('must not query storage'); } });
  assert.equal((await production.POST(request(preview), context)).status, 503);
  const failed = await routeWith({ find: async () => { throw Error('private SQL data'); } }).POST(request(preview), context);
  assert.equal(failed.status, 503); assert.ok(!(await failed.text()).includes('private SQL'));
});
