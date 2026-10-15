import test from 'node:test';
import assert from 'node:assert/strict';
import { mobileIntakeHarness } from './helpers/mobile-intake.mjs';

// Local SQLite, real snapshot/API handlers, synthetic manual products only.
// The reused harness's external source/image fixtures are never invoked.
const at = '2026-10-15T00:00:00.000Z';
const plain = value => JSON.parse(JSON.stringify(value));
const productInput = (id, owner = 'owner') => ({
  id, owner_id: owner, source_url: 'synthetic://670/' + id, title: '합성 번호 검수 ' + id,
  source_price_cny: 5, exchange_rate: 350, supply_margin: 50, coupang_margin: 40,
  supply_price: 4050, sale_price: 6750, msrp: 8780, options_count: 0,
  seo_status: '대기', image_status: '대기', quote_status: '대기', registration_status: '수동 입력',
  supplier_hub_status: '미전송', image_keys: '[]', goal_stage: 'price', created_at: at, updated_at: at,
});
async function create(h, id, owner = 'owner') {
  return h.load('db/queries.ts').insertProduct(productInput(id, owner));
}
async function saveRows(h, id, ids, owner = 'owner') {
  const queries = h.load('db/queries.ts'), store = h.load('db/product-options.ts'), model = h.load('app/product-options.ts');
  const previous = await store.readProductOptions(owner, id), product = await queries.findProduct(owner, id);
  const version = new Date(Date.parse(product.updated_at) + 1).toISOString();
  const inputs = ids.map(optionId => ({ ...model.emptyOptionInput(optionId), originalName: '합성 옵션 ' + optionId, unitCostCny: 5, included: true }));
  const options = model.applyOptionRows(previous, inputs, version);
  assert.ok(await store.saveProductOptions(owner, options, previous.revision, product.updated_at));
  return options;
}
async function read(h, id) {
  const response = await h.route('/api/products/' + id + '/quotation-fields');
  assert.equal(response.status, 200, await response.clone().text());
  return response.json();
}
function assertNoDisplayPayload(view) {
  for (const key of ['resolved', 'automatic', 'overrides']) {
    assert.equal(JSON.stringify(view[key]).includes('optionRegistrationNumbers'), false, key);
    assert.equal(JSON.stringify(view[key]).includes('26101500100'), false, key);
  }
}

test('quotation GET/PUT expose persisted option numbers while editing continues to address original UUIDs', async () => {
  const h = mobileIntakeHarness();
  try {
    const product = await create(h, 'quotation-number-api');
    await saveRows(h, product.id, ['uuid-a', 'uuid-b']);
    const before = await read(h, product.id);
    assert.deepEqual(before.optionRegistrationNumbers, { 'uuid-a': '261015001001', 'uuid-b': '261015001002' });
    assert.deepEqual(before.resolved.rows.map(row => row.optionId), [null, 'uuid-a', 'uuid-b']);
    assertNoDisplayPayload(before);
    const endpoint = '/api/products/' + product.id + '/quotation-fields';
    const save = optionId => h.route(endpoint, { method: 'PUT', body: {
      expectedRevision: before.revision, expectedInputFingerprint: before.inputFingerprint,
      changes: [{ fieldKey: 'brand', optionId, value: '검토한 옵션 브랜드' }],
    } });
    assert.equal((await save(before.optionRegistrationNumbers['uuid-b'])).status, 400);
    const response = await save('uuid-b');
    assert.equal(response.status, 200, await response.clone().text());
    const saved = await response.json();
    assert.deepEqual(saved.optionRegistrationNumbers, before.optionRegistrationNumbers);
    assert.equal(saved.overrides.options['uuid-b'].brand, '검토한 옵션 브랜드');
    assert.equal(saved.overrides.options[before.optionRegistrationNumbers['uuid-b']], undefined);
    const persisted = JSON.parse(h.sqlite.prepare('SELECT payload FROM product_quotation_fields WHERE product_id=?').get(product.id).payload);
    assert.equal(Object.hasOwn(persisted, 'optionRegistrationNumbers'), false);
    assert.equal(Object.hasOwn(persisted.overrides.options, 'uuid-b'), true);
    assert.deepEqual(h.network, []);
  } finally { h.close(); }
});

test('quotation number map follows current rows through reorder, removal and re-addition without allocating on reads', async () => {
  const h = mobileIntakeHarness();
  try {
    const product = await create(h, 'quotation-number-order');
    await saveRows(h, product.id, ['a', 'b', 'c']);
    const before = await read(h, product.id), first = before.optionRegistrationNumbers;
    await saveRows(h, product.id, ['c', 'a', 'b']);
    const reordered = await read(h, product.id);
    assert.deepEqual(reordered.optionRegistrationNumbers, first);
    assert.deepEqual(reordered.resolved.rows.map(row => row.optionId), [null, 'c', 'a', 'b']);
    await saveRows(h, product.id, ['b']);
    assert.deepEqual((await read(h, product.id)).optionRegistrationNumbers, { b: first.b });
    assert.equal(h.sqlite.prepare('SELECT count(*) n FROM product_registration_options WHERE product_id=?').get(product.id).n, 3);
    await saveRows(h, product.id, ['c', 'new', 'b']);
    const restored = await read(h, product.id);
    assert.deepEqual(restored.optionRegistrationNumbers, { c: first.c, new: '261015001004', b: first.b });
    const stored = JSON.stringify(h.sqlite.prepare('SELECT * FROM product_registration_options ORDER BY sequence').all());
    await read(h, product.id); await read(h, product.id);
    assert.equal(JSON.stringify(h.sqlite.prepare('SELECT * FROM product_registration_options ORDER BY sequence').all()), stored);
    assertNoDisplayPayload(restored);
    assert.deepEqual(h.network, []);
  } finally { h.close(); }
});

test('snapshot display maps remain owner scoped even when two members share option UUIDs', async () => {
  const h = mobileIntakeHarness();
  try {
    const own = await create(h, 'owner-number-product');
    await create(h, 'foreign-earlier-number', 'other');
    const foreign = await create(h, 'foreign-number-product', 'other');
    await saveRows(h, own.id, ['same-option']); await saveRows(h, foreign.id, ['same-option'], 'other');
    const snapshot = h.load('app/quotation-fields-snapshot.ts').stableQuotationFieldsView;
    assert.deepEqual(plain((await snapshot('owner', own.id, null)).view.optionRegistrationNumbers), { 'same-option': '261015001001' });
    assert.deepEqual(plain((await snapshot('other', foreign.id, null)).view.optionRegistrationNumbers), { 'same-option': '261015002001' });
    await assert.rejects(() => snapshot('owner', foreign.id, null), error => error.status === 404);
    assert.equal((await h.route('/api/products/' + foreign.id + '/quotation-fields')).status, 404);
    assert.deepEqual(h.network, []);
  } finally { h.close(); }
});

test('legacy metadata omission leaves quotation fingerprint and resolved data identical and consumes no numbers', async () => {
  const h = mobileIntakeHarness();
  try {
    const product = await create(h, 'number-fingerprint');
    await saveRows(h, product.id, ['a', 'b']);
    const numbered = await read(h, product.id);
    const rawOptions = h.sqlite.prepare('SELECT payload FROM product_options WHERE product_id=?').get(product.id).payload;
    const counter = h.sqlite.prepare('SELECT * FROM product_registration_counters').all();
    // In-memory legacy fixture only: remove response companions without changing source clocks.
    h.sqlite.prepare('DELETE FROM product_registration_options WHERE product_id=?').run(product.id);
    h.sqlite.prepare('DELETE FROM product_registration_numbers WHERE product_id=?').run(product.id);
    const legacy = await read(h, product.id);
    assert.equal(Object.hasOwn(legacy, 'optionRegistrationNumbers'), false);
    assert.equal(legacy.inputFingerprint, numbered.inputFingerprint);
    for (const key of ['resolved', 'automatic', 'overrides', 'productVersion', 'contentRevision', 'optionRevision', 'revision']) assert.deepEqual(legacy[key], numbered[key]);
    assert.equal(h.sqlite.prepare('SELECT payload FROM product_options WHERE product_id=?').get(product.id).payload, rawOptions);
    assert.deepEqual(h.sqlite.prepare('SELECT * FROM product_registration_counters').all(), counter);
    assert.equal(h.sqlite.prepare('SELECT count(*) n FROM product_registration_numbers').get().n, 0);
    assert.deepEqual(h.network, []);
  } finally { h.close(); }
});

test('source changes during display-map read still reject the whole quotation snapshot', async () => {
  const h = mobileIntakeHarness();
  try {
    const product = await create(h, 'number-source-race');
    await saveRows(h, product.id, ['a', 'b']);
    const prepare = h.db.prepare;
    let metadataReads = 0;
    h.db.prepare = sql => {
      const query = prepare(sql);
      if (sql.includes('FROM product_registration_numbers n JOIN product_registration_options m')) {
        const all = query.all;
        query.all = async () => {
          const result = await all(); metadataReads++;
          h.sqlite.prepare('UPDATE products SET updated_at=? WHERE id=?').run('2026-10-15T00:00:01.000Z', product.id);
          return result;
        };
      }
      return query;
    };
    const response = await h.route('/api/products/' + product.id + '/quotation-fields');
    assert.equal(response.status, 409);
    const rejected = await response.json();
    assert.equal(rejected.code, 'QUOTATION_FIELDS_CONFLICT');
    assert.equal(Object.hasOwn(rejected, 'optionRegistrationNumbers'), false);
    assert.equal(metadataReads, 1);
    assert.equal(h.sqlite.prepare('SELECT count(*) n FROM product_quotation_fields').get().n, 0);
    assert.deepEqual(h.network, []);
  } finally { h.close(); }
});
