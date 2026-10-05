import test from 'node:test';
import assert from 'node:assert/strict';
import { mobileIntakeHarness } from './helpers/mobile-intake.mjs';
import { hubSchemaSnapshot, schemaCompanies, schemaPath } from './helpers/hub-schema.mjs';
import { quotationWorkbook } from './helpers/quotation-workbook.mjs';

// Synthetic supported capture contract, not an authenticated commercial schema.
function snapshot(company) {
  const original = hubSchemaSnapshot(company), raw = JSON.parse(original.schemaString);
  raw.required = ['productPage'];
  raw.properties.productPage.required = ['confirmed', 'requiredText'];
  raw.properties.productPage.properties.confirmed = { type: 'boolean', title: '확인 여부' };
  raw.properties.productPage.properties.requiredText = { type: 'string', title: '필수 원문' };
  return { ...original, draftInitialization: 'couplus-required-v1', inputBindings: 'couplus-paths-v1', settingsInitialization: 'couplus-options-v1', schemaString: JSON.stringify(raw) };
}
const json = async response => { assert.equal(response.status, 200, await response.clone().text()); return response.json(); };
const plain = value => JSON.parse(JSON.stringify(value));

test('required empty choices need an actual supplied source and never turn text, images or false into N/A', () => {
  const h = mobileIntakeHarness();
  try {
    const model = h.load('app/quotation-schema.ts'), snap = snapshot(schemaCompanies[0]);
    const schema = model.getQuotationSchema(snap.categoryId, schemaPath, snap);
    const choice = schema.fields.find(field => field.label === '렌즈 유형');
    assert.equal(choice.required, true); assert.equal(choice.draftDefault, '');
    assert.deepEqual(plain(choice.choices), [{value: '', label: '해당사항없음'}, {value: 'UV', label: 'UV'}]);
    for (const source of ['manual-common', 'manual-option', 'couplus-default', 'schema', 'content', 'settings', 'option']) {
      assert.deepEqual(plain(model.quotationValueIssues(choice, '', [], source)), [], source);
    }
    for (const source of [undefined, 'empty']) assert.match(model.quotationValueIssues(choice, '', [], source).join(), /필수/);
    for (const field of [{...choice, type: 'text'}, {...choice, type: 'images'}, {...choice, choices: [{value: 'UV', label: 'UV'}]}]) {
      assert.match(model.quotationValueIssues(field, '', [], 'manual-common').join(), /필수/);
    }
    assert.match(model.quotationValueIssues(choice, ' ', [], 'manual-common').join(), /필수/);
    const boolean = schema.fields.find(field => field.label === '확인 여부');
    assert.equal(boolean.draftDefault, 'false');
    assert.deepEqual(plain(model.quotationValueIssues(boolean, 'false', [], 'couplus-default')), []);
    assert.match(model.quotationValueIssues(boolean, '', [], 'manual-common').join(), /필수/);
  } finally { h.close(); }
});

for (const company of schemaCompanies) test(`nullable required selection survives API, review and CSV/XLSX without rewriting its wire (${company.code})`, async () => {
  const h = mobileIntakeHarness({companyCode: company.code, companyName: company.name});
  try {
    const snap = snapshot(company), api = h.load('app/api/category-profiles/route.ts');
    const input = { name: '시험 최종분류', categoryId: snap.categoryId, categoryPath: schemaPath, template: null, mappings: [], hubSchema: snap };
    const created = await api.POST(new Request('https://app.test/api/category-profiles', {method: 'POST', headers: {'content-type': 'application/json', 'Idempotency-Key': crypto.randomUUID()}, body: JSON.stringify(input)}));
    assert.equal(created.status, 201, await created.clone().text()); const {profile} = await created.json();
    h.context.category = profile;
    h.sqlite.prepare('UPDATE collection_context SET payload=? WHERE job_id=?').run(JSON.stringify(h.context), 'job');
    await h.intake();
    const product = h.sqlite.prepare('SELECT * FROM products').get(), path = `/api/products/${product.id}/quotation-fields`;
    let view = await json(await h.route(path));
    const choice = view.resolved.schema.fields.find(field => field.label === '렌즈 유형');
    const boolean = view.resolved.schema.fields.find(field => field.label === '확인 여부');
    const text = view.resolved.schema.fields.find(field => field.label === '필수 원문');
    const options = view.resolved.rows.filter(row => row.optionId !== null); assert.equal(options.length, 6);
    for (const row of options) {
      assert.equal(row.fields[choice.id].source, 'couplus-default');
      assert.deepEqual(row.fields[choice.id].validationIssues, []);
      assert.equal(row.fields[boolean.id].value, 'false');
      assert.match(row.fields[text.id].validationIssues.join(), /필수/);
    }
    const original = h.sqlite.prepare('SELECT payload FROM collection_context').get().payload;
    const productBefore = JSON.stringify({...product, updated_at: ''}), sourceRows = ['product_content', 'product_options', 'collection_results'].map(table => h.sqlite.prepare(`SELECT payload FROM ${table}`).get().payload);
    await json(await h.route(path, {method: 'PUT', body: {expectedRevision: view.revision, expectedInputFingerprint: view.inputFingerprint, changes: [
      {fieldKey: choice.id, optionId: null, value: ''},
      {fieldKey: choice.id, optionId: options[0].optionId, value: 'UV'},
      {fieldKey: choice.id, optionId: options[1].optionId, value: ''},
      {fieldKey: text.id, optionId: null, value: ''},
    ]}}));
    view = await json(await h.route(path));
    for (const row of view.resolved.rows.filter(row => row.optionId)) {
      const selected = row.optionId === options[0].optionId;
      assert.equal(row.fields[choice.id].value, selected ? 'UV' : '');
      assert.deepEqual(row.fields[choice.id].validationIssues, []);
      assert.equal(h.load('app/quotation-field-display.ts').quotationFieldDisplay(choice, row.fields[choice.id]), selected ? 'UV' : '해당사항없음');
      assert.match(row.fields[text.id].validationIssues.join(), /필수/);
    }
    const review = h.load('app/submission-review.ts').inspectSubmission(view.resolved, view.imageKeys);
    assert.equal(review.issues.filter(issue => issue.kind === 'error' && issue.fieldId === choice.id).length, 0);
    assert.ok(review.issues.some(issue => issue.kind === 'review' && issue.fieldId === choice.id));
    assert.ok(review.issues.some(issue => issue.kind === 'error' && issue.fieldId === text.id));
    const missing = structuredClone(view.resolved);
    for (const row of missing.rows) row.fields[choice.id] = {...row.fields[choice.id], value: '', source: 'empty', validationIssues: [], issues: []};
    assert.equal(h.load('app/submission-review.ts').inspectSubmission(missing, view.imageKeys).issues.filter(issue => issue.kind === 'error' && issue.fieldId === choice.id).length, 6);
    const exporter = h.load('app/exports/quotation-source.ts'), saved = await exporter.readQuotationExportSource('owner', product.id, profile.id);
    const resolved = exporter.resolveQuotationExport(saved), assets = JSON.parse(product.image_keys).map((key, i) => ({key, name: `assets/${i}.png`}));
    const rows = h.load('app/exports/quotation-fields.ts').resolvedQuotationRows(saved, resolved, assets);
    assert.equal(rows[1][choice.id], ''); assert.ok(rows[1].selectedEmptyChoices.includes(choice.id));
    const headers = ['선택 문구', '원본 선택 코드', '불리언'];
    for (const format of ['csv', 'xlsx']) {
      const bytes = format === 'csv' ? new TextEncoder().encode(headers.join(',') + '\n') : quotationWorkbook(headers);
      const originalBytes = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
      const sha256 = Buffer.from(await crypto.subtle.digest('SHA-256', originalBytes)).toString('hex');
      const mappedProfile = {...profile, template: {name: `fixture.${format}`, format, sheetName: format === 'xlsx' ? '견적서' : '', headerRow: 1, headers, sha256}, mappings: [
        {column: 0, field: choice.id, required: true, choiceFormat: 'label'},
        {column: 1, field: choice.id, required: false, choiceFormat: 'value'},
        {column: 2, field: boolean.id, required: true},
      ]};
      const output = await h.load('app/exports/mapped-quotation.ts').createMappedQuotation({originalBytes, profile: mappedProfile, rows, dataStartRow: 2});
      assert.deepEqual(plain(output.values[0]), ['UV', 'UV', 'false']);
      assert.deepEqual(plain(output.values[1]), ['해당사항없음', '', 'false']);
      assert.equal(output.report.missingRequired.length, 0);
      if (format === 'xlsx') {
        const reader = h.load('app/xlsx-template.ts'), sheet = reader.inspectXlsxArchive(await reader.readXlsxArchive(output.bytes));
        assert.deepEqual(plain(reader.xlsxHeaders(sheet, '견적서', 3)), ['해당사항없음', '', 'false']);
      } else assert.match(new TextDecoder().decode(output.bytes), /"해당사항없음","","false"/);
    }
    assert.equal(h.sqlite.prepare('SELECT payload FROM collection_context').get().payload, original);
    const finalProduct = h.sqlite.prepare('SELECT * FROM products').get();
    assert.equal(JSON.stringify({...finalProduct, updated_at: ''}), productBefore);
    assert.equal(finalProduct.updated_at, view.productVersion, 'only the explicit quotation save advances the product revision');
    assert.deepEqual(['product_content', 'product_options', 'collection_results'].map(table => h.sqlite.prepare(`SELECT payload FROM ${table}`).get().payload), sourceRows);
    assert.equal(saved.hubSchema.schemaString, snap.schemaString);
    assert.equal(h.network.includes('supplier.coupang.com'), false);
  } finally { h.close(); }
});
