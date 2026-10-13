import test from 'node:test';
import assert from 'node:assert/strict';
import { mobileIntakeHarness } from './helpers/mobile-intake.mjs';
import { quotationWorkbook } from './helpers/quotation-workbook.mjs';
import { schemaCompanies } from './helpers/hub-schema.mjs';

const sizePath = ['imagePage', 'images', 'sizeChartImage'];
const categoryPath = ['패션의류잡화', '유니섹스/남녀공용 패션', '공용 잡화', '선글라스', '남녀공용패션선글라스'];
const plain = value => JSON.parse(JSON.stringify(value));
const hash = async bytes => Buffer.from(await crypto.subtle.digest('SHA-256', bytes)).toString('hex');
const json = async (response, status = 200) => { assert.equal(response.status, status, await response.clone().text()); return response.json(); };

// Sanitized fragment of recorded 69900 Single v188. The size-chart file wire is
// optional string|null, maximum five images in its original instruction. The
// same captured contract is exercised in two isolated company fixtures; this
// is not an authenticated second-company form or a real Hub registration.
function snapshot(company, amend) {
  const raw = { type: 'object', properties: {
    startPage: { type: 'object', properties: { productName: { type: 'string', title: '상품명' } } },
    productPage: { type: 'object', properties: {} }, legalPage: { type: 'object', properties: {} },
    imagePage: { type: 'object', properties: { images: { type: 'object', properties: {
      sizeChartImage: { type: ['string', 'null'], requirement: '선택', title: '사이즈차트 이미지 파일명' },
    } } } },
  } };
  amend?.(raw);
  return { format: 'supplier-hub-schema-v1', categoryId: '69900', categoryPath, company, observedAt: Date.now(),
    inputBindings: 'couplus-paths-v1', metadata: { kanCategoryId: 2624, noticeNumber: 4, scopeType: 'Retail_Categorized_Single', version: 188 }, schemaString: JSON.stringify(raw) };
}

async function setup(company) {
  const h = mobileIntakeHarness({ companyCode: company.code, companyName: company.name });
  const hubSchema = snapshot(company), schema = h.load('app/quotation-schema.ts').getQuotationSchema('69900', categoryPath, hubSchema);
  const sizeField = schema.fields.find(field => JSON.stringify(field.hubWire?.path) === JSON.stringify(sizePath));
  const headers = ['skuId', ...schema.fields.map(field => field.id)], bytes = quotationWorkbook(headers), sha256 = await hash(bytes);
  const storageKey = h.load('db/category-templates.ts').templateKey('owner', sha256, 'xlsx'); h.objects.set(storageKey, bytes);
  const profile = await h.load('db/category-profiles.ts').createCategoryProfile('owner', { name: '사이즈표 연결 시험', categoryId: '69900', categoryPath, hubSchema,
    template: { name: 'synthetic-size-chart.xlsx', format: 'xlsx', sha256, storageKey, sheetName: '견적서', headerRow: 1, headers },
    mappings: headers.map((field, column) => ({ field, column, required: false })) }, 'cat');
  h.context.category = profile; h.sqlite.prepare('UPDATE collection_context SET payload=?').run(JSON.stringify(h.context));
  h.sqlite.prepare("UPDATE collection_jobs SET goal='work'").run(); await h.intake();
  const product = () => h.sqlite.prepare('SELECT * FROM products').get(), base = '/api/products/' + product().id;
  return { h, product, base, headers, sizeField, profile, bytes, storageKey, endpoint: base + '/quotation-fields' };
}

async function exported(f) {
  const { h, base, headers } = f, preview = await json(await h.route(base + '/quotation', { method: 'POST', body: { action: 'preview' } }));
  const response = await h.route(base + '/quotation', { method: 'POST', body: { action: 'export', fingerprint: preview.fingerprint } });
  assert.equal(response.status, 200, await response.clone().text());
  const reader = h.load('app/xlsx-template.ts'), zip = await reader.readXlsxArchive(await response.arrayBuffer());
  const document = JSON.parse(new TextDecoder().decode(zip.get('quotation-fields.json'))), plan = JSON.parse(new TextDecoder().decode(zip.get('supplier-hub-upload-plan.json')));
  const workbook = reader.inspectXlsxArchive(await reader.readXlsxArchive(zip.get(plan.quotation.file.filename)));
  return { zip, document, plan, cells: document.rows.map((_, index) => reader.xlsxHeaders(workbook, '견적서', index + 2)), column: headers.indexOf(f.sizeField.id) };
}

for (const company of schemaCompanies) test(`saved size-chart images reach six final quote rows, XLSX and exact upload bytes (${company.code})`, async () => {
  const f = await setup(company), { h, base, product, sizeField, endpoint } = f;
  try {
    assert.equal(sizeField.id, 'live_69900_7603c5ee312f8322', 'the formerly text-only wire retains its saved override identity');
    assert.equal(sizeField.type, 'images'); assert.equal(sizeField.hubInput, 'sizeImages'); assert.equal(sizeField.maxItems, 5);
    assert.equal(h.load('app/quotation-input-links.ts').quotationInputLink(sizeField), '옵션·사이즈표에서 저장한 사이즈표 이미지');
    assert.equal(h.load('app/quotation-field-groups.ts').quotationFieldGroup(sizeField), '기본 이미지');
    const raw = h.sqlite.prepare('SELECT payload FROM collection_results').get().payload, context = h.sqlite.prepare('SELECT payload FROM collection_context').get().payload;
    const policy = product().pricing_policy, originalImages = new Map([...h.objects].map(([key, bytes]) => [key, Buffer.from(bytes)]));
    const keys = JSON.parse(product().image_keys), selected = [keys[3], keys[4]], replacement = keys[5];
    let content = (await json(await h.route(base + '/content'))).content;
    const assets = Object.fromEntries(Object.entries(content.assets).map(([role, field]) => [role, role === 'size' ? selected : field.value.filter(key => !selected.includes(key))]));
    content = (await json(await h.route(base + '/content', { method: 'PATCH', body: { expectedRevision: content.revision, patch: { assets } } }))).content;
    let view = await json(await h.route(endpoint)), included = view.resolved.rows.filter(row => row.included);
    assert.equal(included.length, 6);
    assert.ok(included.every(row => row.fields[sizeField.id].value === selected.join('\n') && row.fields[sizeField.id].source === 'content'));
    let output = await exported(f);
    for (const cells of output.cells) assert.equal(cells[output.column], selected.map(key => output.document.uploadFilenames[key]).join('\n'));
    for (const key of selected) {
      const attachment = output.plan.productImages.find(image => image.key === key); assert.ok(attachment);
      assert.equal(attachment.sha256, await hash(h.objects.get(key))); assert.deepEqual(Buffer.from(output.zip.get(attachment.archivePath)), Buffer.from(h.objects.get(key)));
      assert.equal(attachment.references.filter(reference => reference.fieldId === sizeField.id).length, 6);
      assert.ok(!output.plan.labelImages.some(image => image.key === key), 'size-chart files use the product-image area');
    }
    // Manual per-option keys and explicit blanks keep precedence over a later
    // shared size-chart save; restore-null returns to the latest shared source.
    view = await json(await h.route(endpoint, { method: 'PUT', body: { expectedRevision: view.revision, expectedInputFingerprint: view.inputFingerprint,
      changes: [{ optionId: included[0].optionId, fieldKey: sizeField.id, value: selected[1] }, { optionId: included[1].optionId, fieldKey: sizeField.id, value: '' }] } }));
    content = (await json(await h.route(base + '/content'))).content;
    const replaced = Object.fromEntries(Object.entries(content.assets).map(([role, field]) => [role, role === 'size' ? [replacement] : field.value.filter(key => key !== replacement)]));
    await json(await h.route(base + '/content', { method: 'PATCH', body: { expectedRevision: content.revision, patch: { assets: replaced } } }));
    view = await json(await h.route(endpoint)); output = await exported(f);
    const expected = [selected[1], '', ...Array(4).fill(replacement)];
    for (const [index, row] of output.document.rows.entries()) {
      assert.equal(row.fields[sizeField.id].value, expected[index]); assert.equal(output.cells[index][output.column], expected[index] ? output.document.uploadFilenames[expected[index]] : '');
    }
    assert.ok(output.plan.productImages.every(image => image.key !== selected[0]), 'superseded size images remain stored but leave final attachments');
    assert.ok(output.plan.productImages.every(image => !image.references.some(ref => ref.optionId === included[1].optionId && ref.fieldId === sizeField.id)));
    view = await json(await h.route(endpoint, { method: 'PUT', body: { expectedRevision: view.revision, expectedInputFingerprint: view.inputFingerprint,
      changes: [{ optionId: included[0].optionId, fieldKey: sizeField.id, value: null }] } }));
    assert.equal(view.resolved.rows.find(row => row.optionId === included[0].optionId).fields[sizeField.id].value, replacement);
    assert.equal(view.resolved.rows.find(row => row.optionId === included[1].optionId).fields[sizeField.id].value, '');
    assert.equal(h.sqlite.prepare('SELECT payload FROM collection_results').get().payload, raw); assert.equal(h.sqlite.prepare('SELECT payload FROM collection_context').get().payload, context);
    assert.equal(product().pricing_policy, policy); assert.equal(product().supplier_hub_status, '미전송');
    for (const [key, bytes] of originalImages) assert.deepEqual(Buffer.from(h.objects.get(key)), bytes);
    assert.deepEqual(Buffer.from(h.objects.get(f.storageKey)), Buffer.from(f.bytes)); assert.ok(!h.network.some(host => host.includes('coupang')));
  } finally { h.close(); }
});

test('size-chart linkage requires the exact opted-in string wire and never adds a legacy field', () => {
  const h = mobileIntakeHarness();
  try {
    const q = h.load('app/quotation-schema.ts'), company = schemaCompanies[0];
    const legacy = q.getQuotationSchema('69900', categoryPath); assert.ok(!legacy.fields.some(field => field.hubInput === 'sizeImages'));
    const notOptedIn = snapshot(company); delete notOptedIn.inputBindings;
    assert.ok(!q.getQuotationSchema('69900', categoryPath, notOptedIn).fields.some(field => field.hubInput === 'sizeImages'));
    for (const amend of [raw => { raw.properties.imagePage.properties.images.properties.sizeChartImage.type = 'number'; },
      raw => { raw.properties.imagePage.properties.images.properties.sizeChartImage.enum = [null, 'fixed']; },
      raw => { raw.properties.imagePage.properties.images.properties.sizeChartImage.const = 'fixed'; },
      raw => { raw.properties.imagePage.properties.images.properties.sizeChartImage.pattern = '^fixed$'; },
      raw => { const images = raw.properties.imagePage.properties.images; images.properties.otherSizeImage = images.properties.sizeChartImage; delete images.properties.sizeChartImage; }]) {
      const captured = snapshot(company, amend), before = JSON.stringify(captured), schema = q.getQuotationSchema('69900', categoryPath, captured);
      assert.ok(!schema.fields.some(field => field.hubInput === 'sizeImages')); assert.equal(JSON.stringify(captured), before);
    }
    const named = snapshot(company, raw => { raw.properties.imagePage.properties.images = { type: 'array', allOf: [{ contains: { type: 'object', properties: {
      name: { type: 'string', enum: ['사이즈차트 이미지 파일명'] }, value: { type: 'string' },
    } } }] }; });
    assert.ok(!q.getQuotationSchema('69900', categoryPath, named).fields.some(field => field.hubInput === 'sizeImages'));
  } finally { h.close(); }
});

test('unused size images stay empty; six images, duplicates and foreign keys cannot be saved', async () => {
  const f = await setup(schemaCompanies[0]), { h, endpoint, product, sizeField } = f;
  try {
    const view = await json(await h.route(endpoint)); assert.ok(view.resolved.rows.every(row => row.fields[sizeField.id].value === ''));
    const keys = JSON.parse(product().image_keys), tableBefore = JSON.stringify(h.sqlite.prepare('SELECT * FROM product_quotation_fields').all());
    for (const value of [keys.slice(0, 6).join('\n'), [keys[0], keys[0]].join('\n'), 'foreign/image.png']) {
      await json(await h.route(endpoint, { method: 'PUT', body: { expectedRevision: view.revision, expectedInputFingerprint: view.inputFingerprint,
        changes: [{ optionId: null, fieldKey: sizeField.id, value }] } }), 400);
      assert.equal(JSON.stringify(h.sqlite.prepare('SELECT * FROM product_quotation_fields').all()), tableBefore);
    }
    const plan = h.load('app/exports/supplier-hub-upload-plan.ts').supplierHubUploadPlan;
    const arbitrary = { ...plain(view.resolved), schema: { ...plain(view.resolved.schema), fields: [{ ...plain(sizeField), hubWire: { path: ['imagePage', 'images', 'otherSizeImage'] } }] } };
    assert.throws(() => plan(arbitrary, []), /업로드 영역/);
  } finally { h.close(); }
});
