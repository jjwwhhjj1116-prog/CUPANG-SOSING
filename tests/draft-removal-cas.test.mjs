import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';
import {memoryDatabase, runtimeDDL} from '../scripts/check-db-schema.mjs';

const version = '2026-10-07T00:00:00.000Z';
const nextVersion = '2026-10-07T00:00:00.001Z';
const removedAt = '2026-10-07T00:00:00.002Z';
const companies = [{owner: 'yun', code: 'A01526306'}, {owner: 'waih', code: 'A01464742'}];

/** Real database helpers and ephemeral SQLite; the race changes only the
 * removal marker after an editor has read its source and before its batch. */
function harness(company, kind, revision) {
  const sqlite = memoryDatabase();
  for (const statement of runtimeDDL()) sqlite.exec(statement.sql);
  const state = {beforeWrite: null, raced: 0};
  const db = {
    prepare(sql) {
      let args = [];
      const query = {sql, bind(...values) {args = values; return query;}, execute() {return sqlite.prepare(sql).all(...args);},
        async first() {return query.execute()[0] ?? null;}, async all() {return {results: query.execute()};}, async run() {return sqlite.prepare(sql).run(...args);}};
      return query;
    },
    async batch(statements) {
      if (state.beforeWrite && statements.some(statement => /^\s*INSERT INTO (?:product_options|product_quotation_fields)\(/u.test(statement.sql))) {
        const race = state.beforeWrite; state.beforeWrite = null; state.raced++; race();
      }
      sqlite.exec('BEGIN');
      try {const results = statements.map(statement => ({results: statement.execute()})); sqlite.exec('COMMIT'); return results;}
      catch (error) {sqlite.exec('ROLLBACK'); throw error;}
    },
  };
  const cache = new Map();
  function load(file) {
    if (cache.has(file)) return cache.get(file);
    const exports = {}; cache.set(file, exports);
    const code = ts.transpileModule(fs.readFileSync(new URL('../' + file, import.meta.url), 'utf8'),
      {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022}}).outputText;
    vm.runInNewContext(code, {exports, Error, Date, URL, TextEncoder, Uint8Array, structuredClone, crypto,
      require(name) {
        if (name === 'cloudflare:workers') return {env: {DB: db}};
        if (name.startsWith('@/')) return load(name.slice(2) + '.ts');
        if (name.startsWith('./') || name.startsWith('../')) return load(path.posix.join(path.posix.dirname(file), name) + '.ts');
        throw Error(name);
      }}, {filename: file});
    return exports;
  }
  const optionModel = load('app/product-options.ts');
  const options = optionModel.applyOptionRows(optionModel.emptyProductOptions('product'), [
    {...optionModel.emptyOptionInput('one'), originalName: '검토 옵션 A', translatedName: '', unitCostCny: 3, included: true},
    {...optionModel.emptyOptionInput('two'), originalName: '검토 옵션 B', translatedName: '보존한 번역', unitCostCny: 7, included: true},
  ], version);
  const content = load('app/product-content.ts').emptyProductContent('product');
  content.revision = 1; content.updatedAt = version; content.seo.title.value = '보존할 상품명';
  content.label.manufacturer.value = ''; content.label.manufacturer.provenance = 'manual';
  const settings = load('app/workspace-settings.ts').newWorkspaceSettings;
  const policy = load('app/pricing.ts').pricePolicy({...settings, minimumMargin: 3000});
  const product = {id: 'product', owner_id: company.owner, source_url: 'https://detail.1688.com/offer/813724060928.html', title: 'EPHEMERAL DRAFT FIXTURE',
    source_price_cny: 3, exchange_rate: 350, supply_margin: 50, coupang_margin: 40, supply_price: 4050, sale_price: 6750, msrp: 8780,
    options_count: 2, seo_status: '입력됨', image_status: '대기', quote_status: '완료', registration_status: '검토 대기', supplier_hub_status: '미전송',
    image_keys: '[]', goal_stage: 'price', created_at: version, updated_at: version};
  const qstate = {schemaVersion: 1, productId: 'product', revision: 1, overrides: {common: {title: '직접 고친 제목', manufacturer: ''}, options: {two: {model: '보존 모델'}}}, updatedAt: version};
  const insert = (table, values) => sqlite.prepare(`INSERT INTO ${table} VALUES(${values.map(() => '?').join(',')})`).run(...values);
  async function seed() {
    await load('db/queries.ts').insertProduct(product, policy);
    await load('db/queries.ts').insertProduct({...product, id: 'foreign', owner_id: 'other'}, policy);
    await load('db/queries.ts').saveSettings(company.owner, JSON.stringify(settings));
    insert('product_content', ['product', company.owner, 1, JSON.stringify(content), version]);
    if (kind !== 'options' || revision > 0) insert('product_options', ['product', company.owner, 1, JSON.stringify(options), version]);
    if (kind !== 'quotation' || revision > 0) insert('product_quotation_fields', ['product', company.owner, 1, JSON.stringify(qstate), version]);
  }
  const snapshot = () => JSON.stringify(Object.fromEntries(['products', 'product_price_policy', 'product_options', 'product_content', 'product_quotation_fields', 'workspace_settings']
    .map(table => [table, sqlite.prepare('SELECT * FROM ' + table + ' ORDER BY 1').all()])));
  const markRemoved = (owner = company.owner) => insert('product_removals', ['product', owner, removedAt, version]);
  const source = () => ({productVersion: version, imageKeys: '[]', pricingPolicy: JSON.stringify(policy), contentRevision: 1,
    optionRevision: kind === 'options' ? revision : 1, settingsPayload: JSON.stringify(settings), profile: null, collection: null});
  async function read() {
    assert.equal((await load('db/queries.ts').findProduct(company.owner, 'product')).updated_at, version);
    if (kind === 'quotation') {
      const previous = await load('db/quotation-fields.ts').readQuotationFields(company.owner, 'product');
      assert.equal(previous.revision, revision);
      return {previous, guard: source(), next: {common: {...previous.overrides.common, title: '이후 저장할 제목'}, options: previous.overrides.options}};
    }
    const previous = await load('db/product-options.ts').readProductOptions(company.owner, 'product');
    assert.equal(previous.revision, revision);
    const inputs = previous.rows.length ? optionModel.optionInputs(previous).map(row => row.id === 'one' ? {...row, unitsPerPack: 3} : row)
      : [{...optionModel.emptyOptionInput('new'), originalName: '새 검토 옵션', unitCostCny: 5, included: true}];
    return {previous, next: optionModel.applyOptionRows(previous, inputs, nextVersion)};
  }
  const save = read => kind === 'quotation'
    ? load('db/quotation-fields.ts').saveQuotationFields(company.owner, 'product', read.next, read.previous.revision, read.guard)
    : load('db/product-options.ts').saveProductOptions(company.owner, read.next, read.previous.revision, version);
  return {sqlite, state, load, seed, read, save, snapshot, markRemoved, source, close() {sqlite.close();}};
}

for (const company of companies) for (const kind of ['quotation', 'options']) for (const revision of [0, 1]) {
  test(`removal after the ${kind} editor read blocks atomic revision ${revision + 1} and preserves all saved drafts (${company.code})`, async () => {
    const h = harness(company, kind, revision);
    try {
      await h.seed(); const read = await h.read(); const before = h.snapshot();
      if (kind === 'quotation') assert.equal(await h.load('db/quotation-fields.ts').quotationSourcesCurrent(company.owner, 'product', read.guard), true);
      h.state.beforeWrite = () => h.markRemoved();
      assert.equal(await h.save(read), null);
      assert.equal(h.state.raced, 1); assert.equal(h.snapshot(), before);
      const marker = h.sqlite.prepare('SELECT * FROM product_removals WHERE product_id=?').get('product');
      assert.equal(marker.owner_id, company.owner); assert.equal(marker.product_version, version);
      const product = h.sqlite.prepare('SELECT * FROM products WHERE id=?').get('product');
      assert.equal(product.updated_at, version); assert.equal(product.quote_status, '완료'); assert.equal(product.options_count, 2);
      if (kind === 'quotation') assert.equal(await h.load('db/quotation-fields.ts').quotationSourcesCurrent(company.owner, 'product', read.guard), false);
    } finally {h.close();}
  });
}

for (const kind of ['quotation', 'options']) {
  test(`${kind} writes remain blocked on retries until the exact removal is restored, then a deliberate save succeeds`, async () => {
    const company = companies[0], h = harness(company, kind, 1);
    try {
      await h.seed(); const read = await h.read(), before = h.snapshot(); h.markRemoved();
      assert.equal(await h.save(read), null); assert.equal(await h.save(read), null); assert.equal(h.snapshot(), before);
      assert.ok(await h.load('db/product-removals.ts').restoreProduct(company.owner, 'product', version, removedAt));
      const saved = await h.save(read); assert.equal(saved.revision, 2);
      assert.ok(h.sqlite.prepare('SELECT updated_at FROM products WHERE id=?').get('product').updated_at > version);
      assert.equal(h.sqlite.prepare('SELECT updated_at FROM products WHERE id=?').get('foreign').updated_at, version);
      const untouched = kind === 'quotation' ? 'product_options' : 'product_quotation_fields';
      const protectedRows = JSON.parse(before)[untouched];
      assert.deepEqual(JSON.parse(JSON.stringify(h.sqlite.prepare('SELECT * FROM ' + untouched + ' ORDER BY 1').all())), protectedRows);
    } finally {h.close();}
  });

  test(`${kind} removal guard is scoped to the product owner rather than an unrelated marker`, async () => {
    const company = companies[1], h = harness(company, kind, 1);
    try {
      await h.seed(); const read = await h.read(); h.markRemoved('other');
      const saved = await h.save(read); assert.equal(saved.revision, 2);
      assert.equal(h.sqlite.prepare('SELECT owner_id FROM product_removals WHERE product_id=?').get('product').owner_id, 'other');
    } finally {h.close();}
  });
}
