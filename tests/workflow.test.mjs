import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

// Execute the actual route modules with D1/auth/HTTP dependencies substituted.
// No remote service, credential or production database is used.
function load(relative, overrides = {}) {
  const source = fs.readFileSync(new URL(`../${relative}`, import.meta.url), 'utf8');
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports = {};
  vm.runInNewContext(output, {
    exports, crypto, URL, Response, TextEncoder, TextDecoder, Uint8Array, DataView, process: {env: {NODE_ENV: 'development'}},
    require: name => {
      if (name in overrides) return overrides[name];
      if (name === '@/db/product-content') return {readRegistrationSummaries: async()=>({})};
      if (name === 'next/server') return { NextResponse: Response };
      if (name === '@/app/chatgpt-auth') return { getChatGPTUser: async () => ({ userId: 'test-owner' }), getWorkspaceOwnerId: async () => 'test-owner' };
      if (name === '@/db/workspace-banners' || name === '@/app/workspace-banners') return load(name.slice(2)+'.ts');
      if (name === '@/app/workspace-settings') return load('app/workspace-settings.ts');
      if (name === '@/app/product-content') return load('app/product-content.ts');
      if (name === '@/app/pricing') return load('app/pricing.ts');
      if (name === '@/app/product-options') return load('app/product-options.ts');
      if (name === '@/app/workflow') return load('app/workflow.ts');
      if (name === 'cloudflare:workers') return { env: {} };
      if (name === '@/app/request-body') return load('app/request-body.ts');
      if (name === '@/app/database-readiness') return load('app/database-readiness.ts');
      if (name === '@/app/image-files') return load('app/image-files.ts');
      if (name === '@/app/exports/review-bundle') return load('app/exports/review-bundle.ts');
      if (name === '@/app/exports/zip') return load('app/exports/zip.ts');
      if (name.startsWith('@/app/automation/')) return load(name.replace('@/', '') + '.ts');
      if (name.startsWith('@/app/')) return load(name.slice(2) + '.ts');
      throw new Error(`Unexpected dependency: ${name}`);
    },
  }, { filename: relative });
  return exports;
}
const request = body => new Request('http://localhost/api/products', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const input = { sourceUrl: 'https://detail.1688.com/offer/123456789.html', title: 'LOCAL TEST ONLY', sourcePriceCny: 10 };
const productRoute = queries => load('app/api/products/route.ts', { '@/db/queries': queries });

test('all requested goals remain manual/pending after successful storage', async () => {
  for (const goalStage of ['collect', 'price', 'work', 'transmit']) {
    let saved;
    const route = productRoute({ insertProduct: async p => (saved = p) });
    const response = await route.POST(request({ ...input, goalStage }));
    assert.equal(response.status, 201);
    const { product } = await response.json();
    assert.equal(saved.id, product.id);
    assert.equal(product.goal_stage, goalStage);
    for (const key of ['seo_status', 'image_status', 'quote_status']) assert.equal(product[key], '대기');
    assert.equal(product.registration_status, '수동 입력');
    assert.equal(product.supplier_hub_status, '미전송');
  }
});

test('failed insert returns 503 without a phantom product or internal error details', async () => {
  const route = productRoute({ insertProduct: async () => { throw new Error('private database details'); } });
  const response = await route.POST(request(input));
  assert.equal(response.status, 503);
  const body = await response.json();
  assert.ok(body.error);
  assert.equal(body.product, undefined);
  assert.ok(!JSON.stringify(body).includes('private database'));
});

test('failed list is distinguishable from an empty persisted list', async () => {
  const failed = await productRoute({ listProducts: async () => { throw new Error(); } }).GET();
  assert.equal(failed.status, 503);
  assert.equal((await failed.json()).products, undefined);
  const empty = await productRoute({ listProducts: async () => [] }).GET();
  assert.equal(empty.status, 200);
  assert.deepEqual((await empty.json()).products, []);
});

test('malformed input, non-product URLs and non-finite prices never reach storage', async () => {
  let writes = 0;
  const route = productRoute({ insertProduct: async p => { writes++; return p; } });
  for (const body of [null, [], { ...input, sourcePriceCny: 0 }, { ...input, sourcePriceCny: 'Infinity' },
    { ...input, exchangeRate: 'Infinity' }, { ...input, supplyMargin: 100 }, { ...input, optionsCount: 1.5 },
    { ...input, sourceUrl: 'https://detail.1688.com/offer/demo.html' },
    { ...input, sourceUrl: 'https://detail.1688.com.evil.example/offer/123.html' },
    { ...input, sourceUrl: 'https://user:password@detail.1688.com/offer/123.html' }]) {
    assert.equal((await route.POST(request(body))).status, 400);
  }
  assert.equal((await route.POST(new Request('http://localhost', { method: 'POST', body: '{' }))).status, 400);
  assert.equal(writes, 0);
});

test('zero margin and configured MSRP are respected (not original Couplus equivalence)', async () => {
  const route = productRoute({ insertProduct: async p => p });
  const response = await route.POST(request({ ...input, exchangeRate: 100, supplyMargin: 0, coupangMargin: 0, minimumMargin: 0, msrpMultiple: 2 }));
  const { product } = await response.json();
  assert.equal(product.supply_price, 1000);
  assert.equal(product.sale_price, 1000);
  assert.equal(product.msrp, 2000);
});

test('generic PATCH cannot fabricate completion or modify derived prices', async () => {
  let writes = 0;
  const route = load('app/api/products/[id]/route.ts', { '@/db/queries': { updateProduct: async () => { writes++; } } });
  for (const body of [{ seo_status: '완료' }, { image_status: '완료' }, { quote_status: '완료' },
    { registration_status: '전송 가능' }, { supplier_hub_status: '전송완료' }, { sale_price: 1 },
    { title: 'valid', registration_status: '전송완료' }, { image_keys: '["another-owner/image.png"]' }, null, {}]) {
    assert.equal((await route.PATCH(request(body), { params: Promise.resolve({ id: 'test' }) })).status, 400);
  }
  assert.equal(writes, 0);
});

test('PATCH returns stored response and distinguishes missing products, version conflicts and database failures', async () => {
  const expectedVersion = '2026-09-22T00:00:00.000Z';
  const existing = {id:'test',image_keys:'["test-owner/image.png"]',updated_at:expectedVersion};
  for (const [updateProduct, current, expected] of [
    [async (owner, id, updates, version) => { assert.equal(version, expectedVersion); return { id, owner_id: owner, ...updates }; }, existing, 200],
    [async () => null, null, 404], [async () => null, existing, 409],
    [async () => { throw new Error(); }, existing, 503],
  ]) {
    const route = load('app/api/products/[id]/route.ts', { '@/db/queries': { updateProduct, findProduct: async () => current } });
    const response = await route.PATCH(request({ image_keys: '["test-owner/image.png"]', expectedVersion }), { params: Promise.resolve({ id: 'test' }) });
    assert.equal(response.status, expected);
  }
});

test('image PATCH requires a valid version without allowing additional fields; title-only legacy input remains valid', async () => {
  let writes = 0;
  const route = load('app/api/products/[id]/route.ts', { '@/db/queries': { updateProduct: async (_owner, id, updates, version) => { writes++; assert.equal(version, undefined); return {id,...updates}; } } });
  const ctx = { params: Promise.resolve({ id: 'test' }) };
  for (const expectedVersion of [undefined, null, 123, '', 'invalid']) {
    assert.equal((await route.PATCH(request({ image_keys: '[]', expectedVersion }),ctx)).status,400);
  }
  assert.equal((await route.PATCH(request({ title:'valid', expectedVersion:'2026-09-22T00:00:00.000Z', secret:true }),ctx)).status,400);
  assert.equal((await route.PATCH(request({ expectedVersion:'2026-09-22T00:00:00.000Z' }),ctx)).status,400);
  assert.equal((await route.PATCH(request({title:'legacy edit'}),ctx)).status,200);
  assert.equal(writes,1);
});

test('settings failures do not become successful saves or empty defaults', async () => {
  const fail = async () => { throw new Error(); };
  const route = load('app/api/settings/route.ts', { '@/db/queries': { getSettings: fail, saveSettings: fail } });
  assert.equal((await route.GET()).status, 503);
  assert.equal((await route.PUT(request({ brand: 'test' }))).status, 503);
  assert.equal((await route.PUT(request(null))).status, 400);
});

test('Supplier Hub always fails closed with no outbound or database dependency', async () => {
  // The loader rejects any added fetch adapter/DB/env dependency.
  const route = load('app/api/supplier-hub/route.ts');
  const response = await route.POST(request({ productIds: ['test'], confirmed: true }));
  assert.equal(response.status, 501);
  assert.equal((await response.json()).code, 'SUPPLIER_HUB_NOT_VERIFIED');
});

test('integration diagnostics distinguish D1 query from R2 binding and never claim browser connection', async () => {
  for (const available of [true, false]) {
    const route = load('app/api/integrations/route.ts', { 'cloudflare:workers': { env: available ? {
      DB: { prepare: sql => sql === 'SELECT 1 AS ok' ? { first: async () => ({ ok: 1 }) } : { all: async () => ({success: true, results: load('app/database-readiness.ts').requiredDatabaseTables.map(name => ({name}))}) } }, FILES: {},
    } : {} } });
    const response = await route.GET();
    const body = await response.json();
    assert.equal(body.database, available ? 'query_ok' : 'unavailable');
    assert.equal(body.databaseSchema.status, available ? 'tables_present' : 'unavailable');
    assert.equal(body.files, available ? 'binding_present' : 'unavailable');
    assert.equal(body.extension, 'unverified');
    assert.equal(body.supplierHub, 'unverified');
    assert.equal(body.cli, 'unverified');
    assert.equal(body.submissionEnabled, false);
    assert.equal(body.translation.configured, false);
    assert.equal(body.imageProcessing.configured, false);
    assert.equal(body.collection.configured, false);
    assert.equal(response.headers.get('cache-control'), 'no-store');
  }
});

test('integration diagnostics expose missing storage tables without hiding a successful connection', async () => {
  const readiness = load('app/database-readiness.ts');
  const expected = ['collection_results', 'collection_products', 'collection_images'];
  for (const fail of [false, true]) {
    const route = load('app/api/integrations/route.ts', {'cloudflare:workers': {env: {DB: {prepare: sql => {
      if (sql === 'SELECT 1 AS ok') return {first: async () => ({ok: 1})};
      assert.equal(sql, "SELECT name FROM sqlite_master WHERE type = 'table'");
      return {all: async () => {
        if (fail) throw new Error('private database information');
        return {success: true, results: readiness.requiredDatabaseTables.filter(name => !expected.includes(name)).map(name => ({name}))};
      }};
    }}}}});
    const body = await (await route.GET()).json();
    assert.equal(body.database, 'query_ok');
    assert.equal(body.databaseSchema.status, fail ? 'unavailable' : 'missing_tables');
    assert.deepEqual(body.databaseSchema.missingTables, fail ? [] : expected);
    assert.ok(!JSON.stringify(body).includes('private database information'));
    assert.equal(body.submissionEnabled, false);
  }
});

test('database table inspection contract covers every checked-in migration table', () => {
  const directory = new URL('../db/migrations/', import.meta.url);
  const tables = fs.readdirSync(directory).filter(name => name.endsWith('.sql')).flatMap(name =>
    [...fs.readFileSync(new URL(name, directory), 'utf8').matchAll(/CREATE TABLE IF NOT EXISTS\s+(\w+)/g)].map(match => match[1]));
  assert.deepEqual([...load('app/database-readiness.ts').requiredDatabaseTables].sort(), [...new Set(tables)].sort());
});
