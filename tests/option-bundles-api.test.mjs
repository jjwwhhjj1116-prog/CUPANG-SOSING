import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';
import { createRequire } from 'node:module';
import { webcrypto } from 'node:crypto';
import { memoryDatabase, runtimeDDL } from '../scripts/check-db-schema.mjs';

const native = createRequire(import.meta.url), companies = [{ code: 'A01526306', name: '유앤채' }, { code: 'A01464742', name: '와이홉' }];
const version = '2026-10-15T02:00:00.000Z';
async function harness(company = companies[0]) {
  const sqlite = memoryDatabase(); for (const statement of runtimeDDL()) sqlite.exec(statement.sql);
  const owner = 'bundle-owner-' + company.code, id = 'bundle-product-' + company.code, cache = new Map();
  let beforeBatch, fault, verified = true, batches = 0;
  const db = { prepare(sql) { let args = []; const statement = { sql, bind(...values) { args = values; return statement; },
    execute() { return sqlite.prepare(sql).all(...args); }, async first() { return statement.execute()[0] ?? null; },
    async all() { return { results: statement.execute() }; }, async run() { return sqlite.prepare(sql).run(...args); } }; return statement; },
    async batch(statements) {
      const bundle = statements.length === 4 && statements[0].sql.includes('INSERT INTO product_options') && statements[3].sql.includes('INSERT INTO product_quotation_fields');
      if (bundle) { batches++; const callback = beforeBatch; beforeBatch = undefined; callback?.(); }
      sqlite.exec('BEGIN'); try { const results = statements.map((statement, index) => {
        if (bundle && index === fault) throw Error('injected bundle companion failure ' + index);
        return { results: statement.execute() };
      }); sqlite.exec('COMMIT'); return results; } catch (error) { sqlite.exec('ROLLBACK'); throw error; }
    } };
  const bindings = { DB: db }, deps = { 'cloudflare:workers': { env: bindings }, 'next/server': { NextResponse: Response },
    '@/app/chatgpt-auth': { getWorkspaceOwnerId: async () => owner, getChatGPTUser: async () => ({ verifiedAccess: verified, userId: owner,
      membership: { status: 'approved', companyCode: company.code, companyName: company.name } }) },
    '@/db/collection-images': { readOptionSourceImages: async () => ({}) } };
  function load(file) {
    if (cache.has(file)) return cache.get(file); const exports = {}; cache.set(file, exports);
    const source = fs.readFileSync(new URL('../' + file, import.meta.url), 'utf8');
    vm.runInNewContext(ts.transpileModule(source, { fileName: file, compilerOptions: { module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText,
    { exports, Error, RangeError, Date, URL, URLSearchParams, Response, Request, Headers, Blob, TextEncoder, TextDecoder, Uint8Array, DataView,
      structuredClone, crypto: webcrypto, process: { env: { NODE_ENV: 'production' } }, fetch: async () => { throw Error('external request prohibited'); }, require(name) {
        if (name in deps) return deps[name]; if (name.startsWith('@/')) return load(name.slice(2) + '.ts');
        if (name.startsWith('./') || name.startsWith('../')) return load(path.posix.join(path.posix.dirname(file), name) + '.ts'); return native(name);
      } }, { filename: file }); return exports;
  }
  const model = load('app/product-options.ts'), policy = { exchangeRate: 350, supplyMargin: 50, coupangMargin: 40,
    minimumMargin: 3000, msrpMultiple: 1.3, roundingUnit: 10, roundingMode: 'nearest' };
  const product = { id, owner_id: owner, source_url: 'https://detail.1688.com/offer/652000000002.html', title: 'LOCAL BUNDLE FIXTURE',
    source_price_cny: 2.99, exchange_rate: 350, supply_margin: 50, coupang_margin: 40, supply_price: 4050, sale_price: 6750, msrp: 8780,
    options_count: 2, seo_status: '대기', image_status: '대기', quote_status: '대기', registration_status: '미전송', supplier_hub_status: '미전송',
    image_keys: '[]', goal_stage: 'collect', created_at: version, updated_at: version };
  await load('db/queries.ts').insertProduct(product, policy);
  const rows = ['source-a', 'source-b'].map((optionId, index) => ({ ...model.emptyOptionInput(optionId), originalName: '合成选项 ' + index,
    translatedName: '저장한 옵션 ' + index, supplierSku: 'source-sku-' + index, color: '검정', size: 'M', stock: index ? null : 29,
    unitCostCny: 2.99, included: true, packagedWeightG: 200, packagedWidthMm: 50, packagedLengthMm: 60, packagedHeightMm: 70 }));
  await load('db/product-options.ts').saveProductOptions(owner, model.applyOptionRows(model.emptyProductOptions(id), rows, version), 0, version);
  const base = 'https://app.test/api/products/' + id, context = { params: Promise.resolve({ id }) };
  const getView = async profileId => {
    const response = await load('app/api/products/[id]/quotation-fields/route.ts').GET(new Request(base + '/quotation-fields' + (profileId ? '?profileId=' + profileId : '')), context);
    assert.equal(response.status, 200, await response.clone().text()); return response.json();
  };
  const request = (body, suffix = '', headers = {}) => new Request(base + '/option-bundles' + suffix, { method: 'POST',
    headers: { 'content-type': 'application/json', origin: 'https://app.test', ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body) });
  const post = (body, suffix, headers) => load('app/api/products/[id]/option-bundles/route.ts').POST(request(body, suffix, headers), context);
  const body = view => ({ expectedProductVersion: view.productVersion, expectedOptionRevision: view.optionRevision,
    expectedQuotationRevision: view.revision, expectedInputFingerprint: view.inputFingerprint, quantity: 5,
    additions: [{ sourceOptionId: 'source-a', optionId: 'bundle-a' }] });
  const tables = ['products', 'product_options', 'product_quotation_fields', 'product_registration_options'];
  const snapshot = () => JSON.stringify(tables.map(table => [table, sqlite.prepare('SELECT * FROM ' + table + ' ORDER BY rowid').all()]));
  return { sqlite, load, owner, id, policy, product, bindings, getView, post, body, snapshot,
    before(callback) { beforeBatch = callback; }, fault(index) { fault = index; }, verified(value) { verified = value; },
    get batches() { return batches; }, close() { sqlite.close(); } };
}
const plain = value => JSON.parse(JSON.stringify(value));

for (const company of companies) {
  test(`bundle API commits saved facts, selected manual blanks, new prices and empty labels in one clock (${company.code})`, async () => {
    const h = await harness(company); try {
      const model = h.load('app/product-options.ts'), store = h.load('db/product-options.ts');
      const beforeRows = await store.readProductOptions(h.owner, h.id);
      const view = await h.getView();
      const updated = await h.load('db/quotation-fields.ts').saveQuotationFields(h.owner, h.id,
        { common: { brand: '공통 브랜드', labelImages: '' }, options: { 'source-a': { model: '', brand: '옵션 브랜드', supplyPrice: '99000', msrp: '', labelImages: '' },
          'source-b': { model: '유지할 모델', salePrice: '12345' } } }, view.revision,
        (await h.load('app/quotation-fields-snapshot.ts').stableQuotationFieldsView(h.owner, h.id, null)).source);
      assert.ok(updated); const savedView = await h.getView();
      const optionsResponse = await h.load('app/api/products/[id]/options/route.ts').GET(
        new Request('https://app.test/api/products/' + h.id + '/options'), { params: Promise.resolve({ id: h.id }) });
      assert.equal(optionsResponse.status, 200, await optionsResponse.clone().text());
      const beforeOptions = await optionsResponse.json(), additionRequest = h.body(savedView), response = await h.post(additionRequest);
      assert.equal(response.status, 200, await response.clone().text()); const receipt = await response.json();
      assert.deepEqual(Object.keys(receipt).sort(), ['options', 'quotation']);
      assert.equal(h.batches, 1); assert.equal(receipt.options.options.revision, beforeRows.revision + 1);
      assert.equal(receipt.quotation.revision, savedView.revision + 1);
      assert.equal(receipt.quotation.updatedAt, receipt.options.options.updatedAt); assert.equal(receipt.quotation.updatedAt, receipt.options.productVersion);
      assert.equal(receipt.quotation.optionRevision, receipt.options.options.revision);
      const nextRows = receipt.options.options.rows;
      assert.deepEqual(nextRows.slice(0, 2), plain(beforeRows.rows)); assert.equal(nextRows[2].id, 'bundle-a');
      assert.equal(nextRows[2].translatedName, '저장한 옵션 0 (5개묶음)'); assert.equal(nextRows[2].supplierSku, '');
      assert.equal(nextRows[2].unitsPerPack, 5); assert.equal(nextRows[2].stock, 5); assert.equal(nextRows[2].unitCostCny, 2.99);
      for (const field of ['originalName', 'color', 'size', 'imageKey', 'packagedWeightG', 'packagedWidthMm', 'packagedLengthMm', 'packagedHeightMm']) assert.equal(nextRows[2][field], beforeRows.rows[0][field]);
      assert.equal(nextRows[2].packagingUnitsPerPack, 1, 'source packaging basis is not confirmed for the newly larger pack');
      assert.deepEqual(receipt.options.options.bundleSources, { 'bundle-a': { sourceOptionId: 'source-a', quantity: 5 } });
      assert.deepEqual(receipt.quotation.overrides.options['source-a'], savedView.overrides.options['source-a']);
      assert.deepEqual(receipt.quotation.overrides.options['source-b'], savedView.overrides.options['source-b']);
      assert.deepEqual(receipt.quotation.overrides.common, savedView.overrides.common);
      const clone = receipt.quotation.overrides.options['bundle-a']; assert.equal(clone.model, ''); assert.equal(clone.brand, '옵션 브랜드'); assert.equal(clone.labelImages, '');
      assert.equal(clone.supplyPrice, '8230'); assert.equal(clone.salePrice, '13720'); assert.equal(clone.msrp, '17840');
      assert.equal(receipt.options.pricing.rows[2].calculation.supplyPrice, 10470, 'source response uses unchanged normal policy; explicit bundle quote override uses direct minimum');
      assert.equal(receipt.quotation.optionRegistrationNumbers['bundle-a'], receipt.quotation.optionRegistrationNumbers['source-a'] + 'B5');
      assert.deepEqual(receipt.quotation.optionRegistrationNumbers, receipt.options.optionRegistrationNumbers);
      assert.equal(model.optionInputs(receipt.options.options).length, 3);
      const verify = h.load('app/option-bundles.ts').verifyBundleAddReceipt, receiptBefore = JSON.stringify(receipt);
      assert.strictEqual(verify(beforeOptions, savedView, receipt, additionRequest.additions, additionRequest.quantity), receipt,
        'a genuine actual API acknowledgement, including its common null row, must be accepted');
      assert.equal(JSON.stringify(receipt), receiptBefore, 'acknowledgement validation must be read-only');
      for (const tamper of [
        value => { value.options.optionRegistrationNumbers['bundle-a'] = value.options.optionRegistrationNumbers['source-a'] + 'B6';
          value.quotation.optionRegistrationNumbers['bundle-a'] = value.options.optionRegistrationNumbers['bundle-a']; },
        value => { value.quotation.resolved.rows = value.quotation.resolved.rows.filter(row => row.optionId !== 'bundle-a'); },
        value => { value.quotation.resolved.rows.find(row => row.optionId === 'bundle-a').fields.supplyPrice.value = '1'; },
        value => { value.quotation.overrides.options['bundle-a'].brand = '다른 수동 값'; },
      ]) {
        const forged = plain(receipt); tamper(forged); const forgedBefore = JSON.stringify(forged);
        assert.throws(() => verify(beforeOptions, savedView, forged, additionRequest.additions, additionRequest.quantity));
        assert.equal(JSON.stringify(forged), forgedBefore, 'rejected acknowledgement must also retain its data');
        assert.equal(JSON.stringify(receipt), receiptBefore, 'tampered copies cannot alter the genuine receipt');
      }
      const reused = await h.post(h.body(savedView)); assert.equal(reused.status, 409); assert.equal(h.batches, 1);
    } finally { h.close(); }
  });

  test(`bundle scope save preserves every unrelated scope and unknown stock (${company.code})`, async () => {
    const h = await harness(company); try {
      const schema = h.load('app/quotation-schema.ts').getQuotationSchema('80719');
      const profile = await h.load('db/category-profiles.ts').createCategoryProfile(h.owner,
        { name: 'LOCAL BUNDLE CATEGORY', categoryId: '80719', categoryPath: [...schema.categoryPath], template: null, mappings: [] });
      const old = { schemaVersion: 1, productId: h.id, revision: 1, overrides: { common: { brand: 'legacy protected' }, options: {} },
        categoryOverrides: { 'category:80719': { common: { brand: 'scope common' }, options: { 'source-b': { model: '현재 옵션 모델', color: '' } } },
          'category:81221': { common: { brand: 'other protected' }, options: { 'source-a': { model: '다른 분류 모델' } } } }, updatedAt: version };
      h.sqlite.prepare('INSERT INTO product_quotation_fields VALUES(?,?,?,?,?)').run(h.id, h.owner, 1, JSON.stringify(old), version);
      const view = await h.getView(profile.id), body = { ...h.body(view), additions: [{ sourceOptionId: 'source-b', optionId: 'bundle-b' }] };
      const response = await h.post(body, '?profileId=' + profile.id); assert.equal(response.status, 200, await response.clone().text());
      const receipt = await response.json(), state = await h.load('db/quotation-fields.ts').readQuotationFields(h.owner, h.id);
      assert.deepEqual(plain(state.overrides), old.overrides); assert.deepEqual(plain(state.categoryOverrides['category:81221']), old.categoryOverrides['category:81221']);
      assert.equal(state.categoryOverrides['category:80719'].options['bundle-b'].model, '현재 옵션 모델'); assert.equal(state.categoryOverrides['category:80719'].options['bundle-b'].color, '');
      assert.equal(receipt.options.options.rows.at(-1).stock, null); assert.equal(receipt.quotation.categoryContext.categoryId, '80719');
    } finally { h.close(); }
  });

  test(`cloned manual packaging retains the source quantity and review warning in either scope (${company.code})`, async () => {
    for (const categoryId of [null, '80719']) {
      const h = await harness(company); try {
        const fieldsRoute = h.load('app/api/products/[id]/quotation-fields/route.ts'); let profileId;
        if (categoryId) {
          const schema = h.load('app/quotation-schema.ts').getQuotationSchema(categoryId);
          profileId = (await h.load('db/category-profiles.ts').createCategoryProfile(h.owner,
            { name: 'LOCAL PACK BASIS', categoryId, categoryPath: [...schema.categoryPath], template: null, mappings: [] })).id;
        }
        let view = await h.getView(profileId);
        const url = 'https://app.test/api/products/' + h.id + '/quotation-fields' + (profileId ? '?profileId=' + profileId : '');
        const saved = await fieldsRoute.PUT(new Request(url, { method: 'PUT', headers: { 'content-type': 'application/json', origin: 'https://app.test' },
          body: JSON.stringify({ expectedRevision: view.revision, expectedInputFingerprint: view.inputFingerprint,
            changes: [{ optionId: 'source-a', fieldKey: 'packagedWeightG', value: '250' }] }) }), { params: Promise.resolve({ id: h.id }) });
        assert.equal(saved.status, 200, await saved.clone().text()); view = await saved.json();
        assert.deepEqual(view.packagingBasis.options['source-a'].packagedWeightG.unitsPerPack, { 'source-a': 1 });
        const response = await h.post(h.body(view), profileId ? '?profileId=' + profileId : '');
        assert.equal(response.status, 200, await response.clone().text()); const receipt = await response.json();
        const oldFact = view.packagingBasis.options['source-a'].packagedWeightG, fact = receipt.quotation.packagingBasis.options['bundle-a'].packagedWeightG;
        assert.equal(fact.value, oldFact.value); assert.equal(fact.fieldSignature, oldFact.fieldSignature); assert.deepEqual(fact.unitsPerPack, { 'bundle-a': 1 });
        assert.equal(receipt.quotation.overrides.options['bundle-a'].packagedWeightG, '250');
        const clone = receipt.quotation.resolved.rows.find(row => row.optionId === 'bundle-a').fields.packagedWeightG;
        assert.match(clone.validationIssues.join(' '), /직접 입력한 포장 정보는 1개입 기준입니다\. 현재 5개입/);
        assert.deepEqual(receipt.quotation.packagingBasis.options['source-a'], view.packagingBasis.options['source-a']);
        const state = await h.load('db/quotation-fields.ts').readQuotationFields(h.owner, h.id);
        if (categoryId) assert.deepEqual(plain(state.categoryPackagingBasis['category:' + categoryId]), receipt.quotation.packagingBasis);
        else assert.deepEqual(plain(state.packagingBasis), receipt.quotation.packagingBasis);
      } finally { h.close(); }
    }
  });

  test(`bundle validation and stale clocks make zero writes (${company.code})`, async () => {
    const h = await harness(company); try {
      const view = await h.getView(), body = h.body(view), before = h.snapshot();
      for (const invalid of [{ ...body, quantity: 1 }, { ...body, quantity: 1000001 }, { ...body, quantity: 2.5 },
        { ...body, rows: [] }, { ...body, additions: [{ sourceOptionId: 'foreign-source', optionId: 'new' }] },
        { ...body, additions: [{ sourceOptionId: 'source-a', optionId: 'source-b' }] },
        { ...body, additions: [{ sourceOptionId: 'source-a', optionId: 'new', stock: 99 }] }]) {
        assert.equal((await h.post(invalid)).status, 400); assert.equal(h.snapshot(), before);
      }
      for (const invalid of [{ ...body, expectedProductVersion: version.replace('02:', '03:') }, { ...body, expectedOptionRevision: 0 },
        { ...body, expectedQuotationRevision: 1 }, { ...body, expectedInputFingerprint: '0'.repeat(64) }]) {
        assert.equal((await h.post(invalid)).status, 409); assert.equal(h.snapshot(), before);
      }
      assert.equal((await h.post(body, '?profileId=missing')).status, 404);
      assert.equal((await h.post(body, '?profileId=x&profileId=x')).status, 400);
      assert.equal((await h.post(body, '?unexpected=x')).status, 400);
      assert.equal((await h.post(body, '', { origin: 'https://foreign.test' })).status, 400);
      assert.equal((await h.post(body, '', { 'content-type': 'text/plain' })).status, 400);
      assert.equal((await h.post('x'.repeat(512 * 1024 + 1))).status, 413);
      h.verified(false); assert.equal((await h.post(body)).status, 503); assert.equal(h.snapshot(), before); assert.equal(h.batches, 0);
    } finally { h.close(); }
  });

  test(`all bundle companions roll back after an actual transaction fault (${company.code})`, async () => {
    for (const checkpoint of [1, 2, 3]) {
      const h = await harness(company); try {
        const view = await h.getView(), before = h.snapshot(); h.fault(checkpoint);
        const response = await h.post(h.body(view)); assert.equal(response.status, 503);
        assert.equal(h.snapshot(), before, 'no source rows, quotation, display mapping or product clock is partially committed at checkpoint ' + checkpoint);
      } finally { h.close(); }
    }
  });

  test(`SQLite display-capacity and companion-clock CHECK failures roll back bundle facts (${company.code})`, async () => {
    for (const kind of ['display-capacity', 'companion-clock']) {
      const h = await harness(company); try {
        const view = await h.getView();
        if (kind === 'display-capacity') h.sqlite.prepare('INSERT INTO product_registration_options(product_id,owner_id,option_id,sequence) VALUES(?,?,?,?)')
          .run(h.id, h.owner, 'historical-capacity', 999);
        else h.sqlite.exec(`CREATE TRIGGER bundle_clock_fault AFTER UPDATE OF options_count ON products
          BEGIN UPDATE products SET updated_at='2026-10-18T02:00:00.000Z' WHERE id=NEW.id; END`);
        const before = h.snapshot(), response = await h.post(h.body(view));
        assert.equal(response.status, 503); assert.equal(h.snapshot(), before,
          'a real SQLite constraint failure must preserve options, quote, numbers and product clock: ' + kind);
      } finally { h.close(); }
    }
  });

  test(`guard catches same-revision option/quotation payload and price-source races (${company.code})`, async () => {
    for (const kind of ['options', 'quotation', 'policy']) {
      const h = await harness(company); try {
        const view = await h.getView(), body = h.body(view); let raced;
        h.before(() => {
          if (kind === 'options') {
            const row = h.sqlite.prepare('SELECT payload FROM product_options WHERE product_id=?').get(h.id), payload = JSON.parse(row.payload);
            payload.rows[1].translatedName = '다른 편집기의 변경'; h.sqlite.prepare('UPDATE product_options SET payload=? WHERE product_id=?').run(JSON.stringify(payload), h.id);
          } else if (kind === 'quotation') {
            const state = { schemaVersion: 1, productId: h.id, revision: 1, overrides: { common: { brand: '다른 편집기의 변경' }, options: {} }, updatedAt: version };
            h.sqlite.prepare('INSERT INTO product_quotation_fields VALUES(?,?,?,?,?)').run(h.id, h.owner, 1, JSON.stringify(state), version);
          } else h.sqlite.prepare('UPDATE product_price_policy SET payload=? WHERE product_id=?').run(JSON.stringify({ ...h.policy, exchangeRate: 400 }), h.id);
          raced = h.snapshot();
        });
        const response = await h.post(body); assert.equal(response.status, 409, await response.clone().text()); assert.equal(h.snapshot(), raced);
      } finally { h.close(); }
    }
  });

  test(`removed target UUID and previously used source/quantity cannot allocate a new bundle (${company.code})`, async () => {
    const h = await harness(company); try {
      let view = await h.getView(); const response = await h.post(h.body(view)); assert.equal(response.status, 200);
      let options = await h.load('db/product-options.ts').readProductOptions(h.owner, h.id), product = await h.load('db/queries.ts').findProduct(h.owner, h.id);
      const remaining = h.load('app/product-options.ts').optionInputs(options).filter(row => row.id !== 'bundle-a');
      assert.ok(await h.load('db/product-options.ts').saveProductOptions(h.owner,
        h.load('app/product-options.ts').applyOptionRows(options, remaining, '2026-10-16T02:00:00.000Z'), options.revision, product.updated_at));
      view = await h.getView(); const before = h.snapshot();
      assert.equal((await h.post({ ...h.body(view), quantity: 3 })).status, 400, 'immutable lineage prevents reusing the removed bundle UUID');
      assert.equal((await h.post({ ...h.body(view), additions: [{ sourceOptionId: 'source-a', optionId: 'another-bundle' }] })).status, 400, 'removed source/quantity lineage remains reserved');
      // A historical ordinary UUID does not have bundle lineage; the SQL guard
      // must nevertheless reject reusing its append-only number mapping.
      options = await h.load('db/product-options.ts').readProductOptions(h.owner, h.id); product = await h.load('db/queries.ts').findProduct(h.owner, h.id);
      assert.ok(await h.load('db/product-options.ts').saveProductOptions(h.owner,
        h.load('app/product-options.ts').applyOptionRows(options, h.load('app/product-options.ts').optionInputs(options).filter(row => row.id !== 'source-b'), '2026-10-17T02:00:00.000Z'), options.revision, product.updated_at));
      view = await h.getView(); const finalBefore = h.snapshot();
      assert.equal((await h.post({ ...h.body(view), quantity: 3, additions: [{ sourceOptionId: 'source-a', optionId: 'source-b' }] })).status, 409);
      assert.equal(h.snapshot(), finalBefore); assert.notEqual(before, finalBefore);
    } finally { h.close(); }
  });
}
