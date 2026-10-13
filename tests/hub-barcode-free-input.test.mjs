import test from 'node:test';
import assert from 'node:assert/strict';
import { mobileIntakeHarness } from './helpers/mobile-intake.mjs';
import { hubSchemaSnapshot, schemaCompanies, schemaPath } from './helpers/hub-schema.mjs';
import { quotationWorkbook, workbookArchive } from './helpers/quotation-workbook.mjs';

const noBarcode = '바코드 없음(쿠팡 바코드 생성 요청)';
const barcodePath = ['productPage', 'commonAttributes', 'productBarcode'];
const plain = value => JSON.parse(JSON.stringify(value));
const json = async (response, status = 200) => {
  assert.equal(response.status, status, await response.clone().text());
  return response.json();
};
// Sanitized productBarcode control recorded in Single 69900 v188: dropdown
// offers the request preset; type:string/minLength:1 carries no enum/const.
// The surrounding category, supplier/AI/auth/image data and OOXML are fixtures.
function snapshot(company, mutate = () => {}) {
  const value = hubSchemaSnapshot(company, '69900'), raw = JSON.parse(value.schemaString);
  const common = raw.properties.productPage.properties.commonAttributes;
  common.required = ['productBarcode'];
  common.properties.productBarcode = { type: 'string', minLength: 1, title: '상품 바코드', dropdown: [noBarcode] };
  raw.required = ['startPage', 'productPage', 'imagePage', 'legalPage', 'logisticsPage'];
  raw.properties.productPage.required = ['commonAttributes'];
  mutate(raw);
  return { ...value, draftInitialization: 'couplus-required-v1', inputBindings: 'couplus-paths-v1',
    settingsInitialization: 'couplus-options-v1', schemaString: JSON.stringify(raw) };
}
async function workbook(h, alert = 'false', allowBlank = true) {
  const reader = h.load('app/xlsx-template.ts'), archive = await reader.readXlsxArchive(quotationWorkbook(['상품 바코드', '검수 메모']).buffer);
  const xml = new TextDecoder().decode(archive.get('xl/worksheets/sheet1.xml'));
  const rule = `<dataValidation type="list" sqref="A2:A8"${alert === null ? '' : ` showErrorMessage="${alert}"`}${allowBlank ? ' allowBlank="true"' : ''}><formula1>"${noBarcode}"</formula1></dataValidation>`;
  archive.set('xl/worksheets/sheet1.xml', new TextEncoder().encode(xml.replace('</worksheet>', `<dataValidations count="1">${rule}</dataValidations></worksheet>`)));
  return { bytes: workbookArchive([...archive].map(([name, bytes]) => [name, new TextDecoder().decode(bytes)])), rule };
}
async function setup(company) {
  const h = mobileIntakeHarness({ companyCode: company.code, companyName: company.name });
  const original = await workbook(h), sha256 = Buffer.from(await crypto.subtle.digest('SHA-256', original.bytes)).toString('hex');
  const storageKey = `owner/category-templates/${sha256}.xlsx`;
  await h.bindings.FILES.put(storageKey, original.bytes, { customMetadata: { sha256, format: 'xlsx' } });
  const hubSchema = snapshot(company);
  const profile = await h.load('db/category-profiles.ts').createCategoryProfile('owner', {
    name: '바코드 추천·자유입력 회귀', categoryId: hubSchema.categoryId, categoryPath: schemaPath, hubSchema,
    template: { name: 'barcode.xlsx', format: 'xlsx', sheetName: '견적서', headerRow: 1, dataStartRow: 2,
      headers: ['상품 바코드', '검수 메모'], sha256, storageKey }, mappings: [{ column: 0, field: 'barcode', required: true }, { column: 1, field: 'constant', constant: '검수값', required: false }],
  }, 'cat');
  h.context.category = profile;
  h.sqlite.prepare('UPDATE collection_context SET payload=? WHERE job_id=?').run(JSON.stringify(h.context), 'job');
  await h.intake();
  const product = h.sqlite.prepare('SELECT * FROM products').get(), endpoint = `/api/products/${product.id}/quotation-fields`;
  return { h, original, profile, product, endpoint, storageKey };
}
const preserved = h => JSON.stringify(['collection_results', 'collection_context', 'collection_images', 'product_content', 'product_options', 'category_profiles']
  .map(table => h.sqlite.prepare(`SELECT * FROM ${table}`).all()));
async function mapped(f, view, bytes = f.original.bytes, overrides = {}) {
  const source = f.h.load('app/exports/quotation-source.ts'), saved = await source.readQuotationExportSource('owner', f.product.id, f.profile.id);
  const resolved = source.resolveQuotationExport(saved);
  assert.equal(resolved.schema.categoryId, view.resolved.schema.categoryId);
  const assets = JSON.parse(saved.product.image_keys).map((key, index) => ({ key, name: `images/${index}.png` }));
  const rows = f.h.load('app/exports/quotation-fields.ts').resolvedQuotationRows(saved, resolved, assets);
  const sha256=Buffer.from(await crypto.subtle.digest('SHA-256',bytes)).toString('hex');
  const result = await f.h.load('app/exports/mapped-quotation.ts').createMappedQuotation({ originalBytes: bytes.slice().buffer,
    profile: { ...f.profile, template:{...f.profile.template,sha256}, ...overrides }, rows, dataStartRow: 2 });
  const reader = f.h.load('app/xlsx-template.ts'), files = await reader.readXlsxArchive(result.bytes.slice().buffer);
  const output = reader.inspectXlsxArchive(files);
  return { result, rows, company:saved.company, cells: Array.from({ length: rows.length }, (_, index) => Array.from(reader.xlsxHeaders(output, '견적서', index + 2))),
    worksheet: new TextDecoder().decode(files.get('xl/worksheets/sheet1.xml')) };
}

for (const company of schemaCompanies) test(`reviewed existing barcodes preserve leading zeros through API, six final wire rows and advisory XLSX (${company.code})`, async () => {
  const f = await setup(company), { h } = f;
  try {
    let view = await json(await h.route(f.endpoint));
    const field = view.resolved.schema.fields.find(item => JSON.stringify(item.hubWire?.path) === JSON.stringify(barcodePath));
    assert.equal(field.id, 'barcode'); assert.equal(field.hubInput, 'barcode'); assert.equal(field.type, 'text'); assert.equal(field.choices, undefined);
    const included = view.resolved.rows.filter(row => row.included); assert.equal(included.length, 6);
    assert.ok(included.every(row => row.fields.barcode.value === noBarcode && row.fields.barcode.source === 'couplus-default'));
    const before = preserved(h), images = JSON.stringify([...h.objects].map(([key, bytes]) => [key, Buffer.from(bytes).toString('hex')]));
    view = await json(await h.route(f.endpoint, { method: 'PUT', body: {
      expectedRevision: view.revision, expectedInputFingerprint: view.inputFingerprint,
      changes: [{ optionId: null, fieldKey: 'barcodeMode', value: 'existing' },
        { optionId: null, fieldKey: 'barcode', value: '08805864565456' },
        { optionId: included[1].optionId, fieldKey: 'barcode', value: 'ABC123' }],
    } }));
    assert.ok(view.resolved.rows.filter(row => row.included).every(row => row.fields.barcode.validationIssues.length === 0));
    const output = await mapped(f, view);
    assert.deepEqual(output.cells, Array.from({ length: 6 }, (_, index) => [index === 1 ? 'ABC123' : '08805864565456', '검수값']));
    assert.ok(output.rows.every((row, index) => row.barcode === (index === 1 ? 'ABC123' : '08805864565456') && typeof row.barcode === 'string'));
    assert.equal(output.result.report.validationIssueCount, 0); assert.equal(output.result.report.missingRequired.length, 0);
    assert.ok(output.result.report.warnings.some(message => message.includes('상품 바코드도 자유 입력')));
    assert.ok(output.worksheet.includes(f.original.rule), 'the original recommendation rule is preserved verbatim');
    assert.equal(preserved(h), before); assert.equal(JSON.stringify([...h.objects].map(([key, bytes]) => [key, Buffer.from(bytes).toString('hex')])), images);
    assert.deepEqual(Buffer.from(h.objects.get(f.storageKey)), Buffer.from(f.original.bytes));
    assert.equal(output.company.code, company.code); assert.equal(view.categoryContext.categoryId, '69900');
    assert.equal(h.sqlite.prepare('SELECT supplier_hub_status FROM products').get().supplier_hub_status, '미전송');
    assert.ok(!h.network.includes('supplier.coupang.com'));
  } finally { h.close(); }
});

for (const company of schemaCompanies) test(`the no-barcode preset and manual blanks remain distinct reviewable values (${company.code})`, async () => {
  const f = await setup(company), { h } = f;
  try {
    let view = await json(await h.route(f.endpoint));
    let output = await mapped(f, view);
    assert.deepEqual(output.cells, Array.from({ length: 6 }, () => [noBarcode, '검수값']));
    assert.equal(output.result.report.validationIssueCount, 0);
    const option = view.resolved.rows.find(row => row.included), before = preserved(h);
    view = await json(await h.route(f.endpoint, { method: 'PUT', body: {
      expectedRevision: view.revision, expectedInputFingerprint: view.inputFingerprint,
      changes: [{ optionId: option.optionId, fieldKey: 'barcode', value: '' }],
    } }));
    const empty = view.resolved.rows.find(row => row.optionId === option.optionId).fields.barcode;
    assert.equal(empty.value, ''); assert.equal(empty.source, 'manual-option'); assert.ok(empty.validationIssues.some(message => message.includes('필수')));
    output = await mapped(f, view); assert.equal(output.cells[0][0], ''); assert.ok(output.result.report.missingRequired.length > 0);
    assert.ok(view.resolved.rows.filter(row => row.included && row.optionId !== option.optionId).every(row => row.fields.barcode.value === noBarcode));
    view = await json(await h.route(f.endpoint, { method: 'PUT', body: {
      expectedRevision: view.revision, expectedInputFingerprint: view.inputFingerprint,
      changes: [{ optionId: option.optionId, fieldKey: 'barcode', value: null }],
    } }));
    assert.equal(view.resolved.rows.find(row => row.optionId === option.optionId).fields.barcode.value, noBarcode);
    assert.equal(preserved(h), before);
  } finally { h.close(); }
});

test('explicit schema enums/constants and differently located dropdowns retain their exact constraints and defaults', () => {
  const h = mobileIntakeHarness();
  try {
    const quotes = h.load('app/quotation-schema.ts');
    for (const company of schemaCompanies) {
      for (const keyword of ['enum', 'const']) {
        const value = snapshot(company, raw => { const node = raw.properties.productPage.properties.commonAttributes.properties.productBarcode; node[keyword] = keyword === 'enum' ? [noBarcode] : noBarcode; });
        const original = JSON.stringify(value), schema = quotes.getQuotationSchema('69900', schemaPath, value), field = schema.fields.find(item => item.hubInput === 'barcode');
        assert.equal(field.type, 'select'); assert.deepEqual(plain(field.choices), [{ value: noBarcode, label: noBarcode }]);
        assert.throws(() => quotes.validateQuotationChanges([{ optionId: null, fieldKey: field.id, value: 'ABC123' }], { schema, optionIds: [] }), /지원하는 선택값/);
        if (keyword === 'const') assert.equal(schema.status, 'unconfirmed');
        assert.equal(JSON.stringify(value), original);
      }
      const other = snapshot(company, raw => {
        const common = raw.properties.productPage.properties.commonAttributes;
        common.properties.unrelatedBarcode = { ...common.properties.productBarcode }; delete common.properties.productBarcode; common.required = ['unrelatedBarcode'];
        raw.properties.productPage.properties.commonAttributes.properties.exposedAttributes.allOf.push({ contains: { type: 'object', properties: {
          attributeName: { type: 'string', enum: ['상품 바코드'] }, attributeValue: { type: 'string', enum: [noBarcode] },
        } } });
      });
      const schema = quotes.getQuotationSchema('69900', schemaPath, other);
      for (const field of schema.fields.filter(item => item.label === '상품 바코드')) {
        assert.equal(field.type, 'select'); assert.ok(field.choices.length);
        assert.throws(() => quotes.validateQuotationChanges([{ optionId: null, fieldKey: field.id, value: 'ABC123' }], { schema, optionIds: [] }), /지원하는 선택값/);
      }
    }
  } finally { h.close(); }
});

test('barcode suggestions never relax enforced workbook lists, required blanks or unrelated controls', async () => {
  const f = await setup(schemaCompanies[0]), { h } = f;
  try {
    let view = await json(await h.route(f.endpoint));
    view = await json(await h.route(f.endpoint, { method: 'PUT', body: {
      expectedRevision: view.revision, expectedInputFingerprint: view.inputFingerprint,
      changes: [{ optionId: null, fieldKey: 'barcode', value: '08805864565456' }],
    } }));
    for (const alert of ['true', '1', null]) {
      const original = await workbook(h, alert), output = await mapped(f, view, original.bytes);
      assert.equal(output.result.report.validationIssueCount, 6);
      assert.ok(output.worksheet.includes(original.rule));
    }
    const original = await workbook(h, 'false', false);
    view = await json(await h.route(f.endpoint, { method: 'PUT', body: {
      expectedRevision: view.revision, expectedInputFingerprint: view.inputFingerprint,
      changes: [{ optionId: null, fieldKey: 'barcode', value: '' }],
    } }));
    const empty = await mapped(f, view, original.bytes);
    assert.equal(empty.result.report.validationIssueCount, 6); assert.ok(empty.result.report.missingRequired.length > 0);
    // The same suppressed Excel alert cannot forgive a foreign scalar/enum.
    for (const node of [{ type: 'string', enum: [noBarcode] }, { type: 'string', const: noBarcode }, { type: 'number' }]) {
      const hubSchema = snapshot(schemaCompanies[0], raw => { raw.properties.productPage.properties.commonAttributes.properties.productBarcode = { ...node, title: '상품 바코드' }; });
      const schema = h.load('app/quotation-schema.ts').getQuotationSchema('69900', schemaPath, hubSchema), field = schema.fields.find(item => JSON.stringify(item.hubWire?.path) === JSON.stringify(barcodePath));
      const result = await h.load('app/exports/mapped-quotation.ts').createMappedQuotation({ originalBytes: f.original.bytes.slice().buffer,
        profile: { ...f.profile, hubSchema, mappings: [{ column: 0, field: field.id, required: true }] }, rows: [{ [field.id]: 'ABC123' }], dataStartRow: 2 });
      assert.equal(result.report.validationIssueCount, 1);
    }
  } finally { h.close(); }
});

test('request-mode conflicts remain visible without rewriting saved barcodes, and another company cannot save them', async () => {
  const f = await setup(schemaCompanies[0]), { h } = f;
  try {
    let view = await json(await h.route(f.endpoint));
    view = await json(await h.route(f.endpoint, { method: 'PUT', body: {
      expectedRevision: view.revision, expectedInputFingerprint: view.inputFingerprint,
      changes: [{ optionId: null, fieldKey: 'barcodeMode', value: 'request-coupang' },
        { optionId: null, fieldKey: 'barcode', value: '08805864565456' }],
    } }));
    assert.ok(view.resolved.rows.filter(row => row.included).every(row => row.fields.barcode.value === '08805864565456'
      && row.fields.barcode.validationIssues.some(message => message.includes('충돌'))));
    assert.ok(h.load('app/submission-review.ts').inspectSubmission(view.resolved, []).errorCount > 0);
    const before = JSON.stringify(['products', 'product_quotation_fields', 'collection_context'].map(table => h.sqlite.prepare(`SELECT * FROM ${table}`).all()));
    h.setCompany(schemaCompanies[1]);
    await json(await h.route(f.endpoint, { method: 'PUT', body: {
      expectedRevision: view.revision, expectedInputFingerprint: view.inputFingerprint,
      changes: [{ optionId: null, fieldKey: 'barcode', value: 'ABC123' }],
    } }), 409);
    assert.equal(JSON.stringify(['products', 'product_quotation_fields', 'collection_context'].map(table => h.sqlite.prepare(`SELECT * FROM ${table}`).all())), before);
    h.setCompany(schemaCompanies[0]);
    const fresh = await json(await h.route(f.endpoint)); assert.equal(fresh.revision, view.revision);
    assert.equal(fresh.productVersion, view.productVersion); assert.equal(fresh.overrides.common.barcode, '08805864565456');
  } finally { h.close(); }
});
