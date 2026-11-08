import assert from 'node:assert/strict';
import test from 'node:test';
import { hubSchemaSnapshot } from './helpers/hub-schema.mjs';
import { mobileIntakeHarness } from './helpers/mobile-intake.mjs';

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
const ownProduct = h => h.sqlite.prepare('SELECT * FROM products').get();
const content = h => h.sqlite.prepare('SELECT payload FROM product_content').get().payload;
const options = h => h.sqlite.prepare('SELECT payload FROM product_options').get().payload;
const labels = h => h.sqlite.prepare('SELECT payload FROM product_labels').get().payload;
const json = async response => { assert.equal(response.status, 200, await response.clone().text()); return response.json(); };
const labelKeys = h => [...h.objects.keys()].filter(key => /^owner\/quotation-label-[a-f0-9]{64}\.png$/.test(key));

function fixture(config = {}) {
  const drawn = [], calls = [];
  const document = {
    fonts: { load: async () => [], ready: Promise.resolve() },
    createElement(name) {
      assert.equal(name, 'canvas');
      const text = [];
      return {
        getContext: () => ({ measureText: value => ({ width: value.length * 12 }), fillRect() {}, fillText(value) { text.push(value); } }),
        toBlob(callback, type) { drawn.push(text); callback(new Blob([png], { type })); },
      };
    },
  };
  const fixtureImageUrls = ['https://cbu01.alicdn.com/local-label-main.png', 'https://cbu01.alicdn.com/local-label-additional.png', 'https://cbu01.alicdn.com/local-label-detail.png'];
  const h = mobileIntakeHarness({ ...config, document, fixtureImageUrls });
  const company = h.context.company;
  const schema = hubSchemaSnapshot(company, '64455'), raw = JSON.parse(schema.schemaString);
  raw.properties.imagePage = { type: 'object', properties: { images: { type: 'object', properties: {
    labelImages: { type: 'array', allOf: [{ contains: { type: 'object', properties: {
      labelImageType: { type: 'string', enum: ['제품 한글 표시사항 라벨 또는 도안 이미지'] },
      labelImageFiles: { type: 'string' },
    } } }] },
  } } } };
  schema.categoryPath = ['생활용품', '청소용품', '청소솔/스틱'];
  schema.schemaString = JSON.stringify(raw);
  schema.inputBindings = 'couplus-paths-v1';
  schema.draftInitialization = 'couplus-required-v1';
  schema.nativeSerializationPolicy = 'supplier-hub-native-required-form-v1';
  h.context.category = { ...h.context.category, categoryId: schema.categoryId, categoryPath: schema.categoryPath, hubSchema: schema };
  h.sqlite.prepare('UPDATE collection_context SET payload=?').run(JSON.stringify(h.context));
  async function seed() {
    await json(await h.route('/api/collection-jobs/job/result', { method: 'POST', body: {
      schemaVersion: 1, sourceUrl: h.sourceUrl, provider: 'synthetic-native-intake-label',
      collectedAt: new Date().toISOString(), title: '청소솔', description: '',
      attributes: config.attributes ?? [{ name: '原产国/地区', value: '中国' }, { name: '材质', value: '塑料' }],
      options: [
        { sku: 'first', name: '첫 옵션', color: '绿色', unitPriceCny: 3.49, minimumOrder: 1, stock: 1, imageIndex: 0 },
        { sku: 'second', name: '다른 옵션', color: '白色', unitPriceCny: 3.49, minimumOrder: 1, stock: 1, imageIndex: 1 },
      ],
      images: fixtureImageUrls.map((url, index) => ({ url, role: ['main', 'additional', 'detail'][index] })),
    } }));
  }
  let seeded = false;
  let afterRoles;
  const request = async (path, init = {}) => {
    const call = { path, method: init.method ?? 'GET', body: init.body };
    calls.push(call);
    const response = await h.route(path, call);
    if (path.endsWith('/image-draft') && response.ok) {
      await config.afterRoles?.(h);
      afterRoles = { content: content(h), options: options(h), labels: labels(h), pool: JSON.parse(ownProduct(h).image_keys) };
    }
    return await config.response?.(h, call, response) ?? response;
  };
  const intake = async () => {
    if (!seeded) { await seed(); seeded = true; }
    return h.intake('job', { initializeImageRoles: true, fetcher: request });
  };
  const labelWrites = () => calls.filter(({ path, method }) =>
    path === '/api/files' && method === 'POST' || path.endsWith('/attachments') && method === 'POST' || path.endsWith('/quotation-fields') && method === 'PUT');
  return { h, drawn, calls, intake, labelWrites, get afterRoles() { return afterRoles; } };
}

for (const company of [
  { companyCode: 'A01464742', companyName: '와이홉' },
  { companyCode: 'A01526306', companyName: '유앤채' },
]) test('native SEO+가격 saves proven option Korean labels after source roles (' + company.companyCode + ')', async () => {
  const lost = new Set();
  const f = fixture({ ...company, response(_h, { path, method }, response) {
    if (company.companyCode === 'A01526306' && response.ok && (
      path === '/api/files' && method === 'POST' || path.endsWith('/attachments') && method === 'POST' || path.endsWith('/quotation-fields') && method === 'PUT'
    ) && !lost.has(path)) { lost.add(path); throw Error('LOCAL write ACK lost after commit'); }
  } });
  const { h } = f;
  try {
    const message = await f.intake();
    assert.match(message, /표시사항.*PNG.*견적/);
    assert.equal(f.drawn.length, 2);
    assert.ok(f.drawn[0].some(text => text.includes('우드 패턴 다리 선글라스')));
    assert.ok(f.drawn[0].includes(company.companyName));
    const product = ownProduct(h), base = '/api/products/' + product.id, keys = labelKeys(h);
    assert.equal(keys.length, 2);
    assert.ok(keys.every(key => Buffer.from(h.objects.get(key)).equals(png)));
    assert.deepEqual(JSON.parse(product.image_keys), [...f.afterRoles.pool, ...keys]);
    assert.equal(content(h), f.afterRoles.content);
    assert.equal(options(h), f.afterRoles.options);
    assert.equal(labels(h), f.afterRoles.labels);
    assert.equal(product.quote_status, '대기');
    assert.equal(product.supplier_hub_status, '미전송');
    const quote = await json(await h.route(base + '/quotation-fields'));
    assert.equal(quote.overrides.common.labelImages, undefined);
    const included = quote.resolved.rows.filter(row => row.included);
    assert.deepEqual(included.map(row => row.fields.labelImages.value), keys);
    const named = quote.resolved.schema.fields.find(field => field.hubWire?.nameKey === 'labelImageType');
    assert.deepEqual(named?.hubWire, { path: ['imagePage', 'images', 'labelImages'], name: '제품 한글 표시사항 라벨 또는 도안 이미지', nameKey: 'labelImageType', valueKey: 'labelImageFiles' });
    assert.deepEqual(included.map(row => row.fields[named.id].value), keys, 'native named label wire keeps each proven option key');
    const scope = { productId: product.id, endpoint: base + '/product-labels', quotationEndpoint: base + '/quotation-fields' };
    const result = h.load('app/product-label-result.ts').readCurrentProductLabelResult;
    for (const row of included) {
      const saved = await result({ ...scope, optionId: row.optionId }, (path, init) => h.route(path, { method: init?.method }));
      assert.equal(saved.result?.key, row.fields.labelImages.value);
      assert.equal(saved.result?.proof.optionId, row.optionId);
    }
    assert.deepEqual(f.labelWrites().map(call => call.method), ['POST', 'POST', 'PUT', 'POST', 'POST', 'PUT']);
    assert.deepEqual(JSON.parse(f.labelWrites()[1].body), { key: keys[0], role: null, expectedVersion: JSON.parse(f.afterRoles.content).updatedAt, expectedContentRevision: JSON.parse(f.afterRoles.content).revision });
    if (company.companyCode === 'A01526306') assert.equal(lost.size, 3);
    const before = JSON.stringify({ product, quote, objects: [...h.objects.keys()] });
    await f.intake();
    assert.equal(f.drawn.length, 2);
    assert.equal(f.labelWrites().length, 6);
    assert.equal(JSON.stringify({ product: ownProduct(h), quote: await json(await h.route(base + '/quotation-fields')), objects: [...h.objects.keys()] }), before);
  } finally { h.close(); }
});

test('a completed product during native intake receives no automatic label write', async () => {
  const f = fixture({ afterRoles(h) { h.sqlite.prepare("UPDATE products SET supplier_hub_status='전송완료'").run(); } });
  try {
    const message = await f.intake();
    assert.doesNotMatch(message, /PNG를 저장/);
    assert.equal(f.drawn.length, 0);
    assert.deepEqual(f.labelWrites(), []);
    assert.deepEqual(labelKeys(f.h), []);
  } finally { f.h.close(); }
});

test('native intake stops before label mutation if the owner saves a label during rendering', async () => {
  const f = fixture({ async response(h, { path, method }, response) {
    if (path.endsWith('/product-labels') && method === 'GET' && f.drawn.length && !manual) {
      manual = true;
      const view = await response.clone().json();
      await json(await h.route(path, { method: 'PUT', body: {
        expectedRevision: view.revision, expectedInputFingerprint: view.inputFingerprint,
        changes: [{ optionId: null, fieldKey: 'manufacturer', value: '직접 검토한 제조원' }],
      } }));
      return h.route(path);
    }
  } });
  let manual = false;
  try {
    const message = await f.intake();
    assert.match(message, /표시사항.*미완료/);
    assert.equal(manual, true);
    assert.equal(JSON.parse(labels(f.h)).overrides.common.manufacturer, '직접 검토한 제조원');
    assert.deepEqual(f.labelWrites(), []);
    assert.deepEqual(labelKeys(f.h), []);
  } finally { f.h.close(); }
});
test('different saved option quantities receive independently proven native label PNGs', async () => {
  const f = fixture({ afterRoles(h) {
    const source = JSON.parse(options(h)), [first, second] = source.rows;
    source.bundleSources = { [second.id]: { sourceOptionId: first.id, quantity: 3 } };
    h.sqlite.prepare('UPDATE product_options SET payload=?').run(JSON.stringify(source));
  } });
  const { h } = f;
  try {
    const message = await f.intake();
    assert.match(message, /PNG를 저장하고 2개 포함 옵션/);
    assert.equal(f.drawn.length, 2);
    assert.ok(f.drawn[0].includes('1개'));
    assert.ok(f.drawn[1].includes('3개'));
    const product = ownProduct(h), base = '/api/products/' + product.id;
    const view = await json(await h.route(base + '/quotation-fields'));
    const rowKeys = view.resolved.rows.filter(row => row.included).map(row => row.fields.labelImages.value);
    assert.deepEqual(new Set(rowKeys), new Set(labelKeys(h)));
    assert.equal(rowKeys.length, 2);
    assert.notEqual(rowKeys[0], rowKeys[1]);
    assert.equal(view.overrides.common.labelImages, undefined);
    assert.equal(content(h), f.afterRoles.content);
    assert.equal(options(h), f.afterRoles.options);
    assert.equal(labels(h), f.afterRoles.labels);
    const proof = h.load('app/product-label-result.ts').readCurrentProductLabelResult;
    for (const row of view.resolved.rows.filter(row => row.included)) {
      const saved = await proof({ productId: product.id, endpoint: base + '/product-labels', quotationEndpoint: base + '/quotation-fields', optionId: row.optionId },
        (path, init) => h.route(path, { method: init?.method }));
      assert.equal(saved.result?.key, row.fields.labelImages.value);
      assert.equal(saved.result?.proof.optionId, row.optionId);
    }
    assert.deepEqual(f.labelWrites().map(call => call.method), ['POST', 'POST', 'PUT', 'POST', 'POST', 'PUT']);
  } finally { h.close(); }
});

test('country evidence missing or ambiguous fresh promotion never triggers automatic label writes', async () => {
  for (const config of [
    { attributes: [{ name: '产地', value: '浙江台州' }] },
    { async response(_h, { path, method }, response) {
      if (!path.endsWith('/product') || method !== 'POST' || !response.ok) return;
      const body = await response.json();
      delete body.reused;
      return Response.json(body);
    } },
  ]) {
    const f = fixture(config);
    try {
      const message = await f.intake();
      assert.doesNotMatch(message, /PNG를 저장/);
      if (config.attributes) assert.match(message, /PNG 연결 미완료.*제조국/);
      else assert.ok(!f.calls.some(call => call.path.endsWith('/product-labels')));
      assert.equal(f.drawn.length, 0);
      assert.deepEqual(f.labelWrites(), []);
      assert.deepEqual(labelKeys(f.h), []);
    } finally { f.h.close(); }
  }
});

test('native automatic label keeps a previously saved explicit quotation label blank', async () => {
  const f = fixture({ async afterRoles(h) {
    const endpoint = '/api/products/' + ownProduct(h).id + '/quotation-fields';
    const view = await json(await h.route(endpoint));
    await json(await h.route(endpoint, { method: 'PUT', body: {
      expectedRevision: view.revision, expectedInputFingerprint: view.inputFingerprint,
      changes: [{ optionId: null, fieldKey: 'labelImages', value: '' }],
    } }));
  } });
  try {
    assert.match(await f.intake(), /기존 표시사항 입력 또는 이미지 선택을 유지/);
    assert.equal(f.drawn.length, 0);
    assert.deepEqual(f.labelWrites(), []);
    const view = await json(await f.h.route('/api/products/' + ownProduct(f.h).id + '/quotation-fields'));
    assert.equal(view.overrides.common.labelImages, '');
  } finally { f.h.close(); }
});

test('explicitly saving an edited option replaces its own stale automatic PNG and preserves the other option', async () => {
  const f = fixture();
  const { h } = f;
  try {
    await f.intake();
    const productId = ownProduct(h).id, base = '/api/products/' + productId;
    const endpoint = base + '/product-labels', quotationEndpoint = base + '/quotation-fields';
    const before = await json(await h.route(endpoint));
    const [first, second] = before.rows.filter(row => row.included);
    const [firstKey, secondKey] = labelKeys(h);
    assert.ok(firstKey && secondKey);
    const edited = await json(await h.route(endpoint, { method: 'PUT', body: {
      expectedRevision: before.revision, expectedInputFingerprint: before.inputFingerprint,
      changes: [{ optionId: first.optionId, fieldKey: 'netContents', value: '검토한 구성 3개' }],
    } }));
    const save = h.load('app/product-label-save.ts').completeProductLabelSave;
    const saved = await save({ productId, endpoint, quotationEndpoint, optionId: first.optionId, view: edited, cache: new Map(),
      assertCurrent() {}, render: h.load('app/document-image-render.ts').renderDocument },
      (path, init) => h.route(path, { method: init?.method, body: init?.body }));
    assert.notEqual(saved.key, firstKey);
    assert.equal(saved.quotation.overrides.options[first.optionId].labelImages, saved.key);
    assert.equal(saved.quotation.overrides.common.labelImages, undefined);
    assert.equal(saved.quotation.resolved.rows.find(row => row.optionId === second.optionId).fields.labelImages.value, secondKey);
    assert.ok(saved.view.imageKeys.includes(firstKey));
    assert.equal(JSON.parse(labels(h)).overrides.options[first.optionId].netContents, '검토한 구성 3개');
    const proof = h.load('app/product-label-result.ts').readCurrentProductLabelResult;
    const current = await proof({ productId, endpoint, quotationEndpoint, optionId: first.optionId }, (path, init) => h.route(path, { method: init?.method }));
    assert.equal(current.result?.key, saved.key);
  } finally { h.close(); }
});
