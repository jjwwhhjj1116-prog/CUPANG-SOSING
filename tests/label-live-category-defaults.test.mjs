import test from 'node:test';
import assert from 'node:assert/strict';
import { mobileIntakeHarness } from './helpers/mobile-intake.mjs';
import { hubSchemaSnapshot, schemaCompanies } from './helpers/hub-schema.mjs';

const json = async response => {
  assert.equal(response.status, 200, await response.clone().text());
  return response.json();
};
function snapshot(company, notice = '제조년월') {
  const value = hubSchemaSnapshot(company), raw = JSON.parse(value.schemaString);
  raw.properties.legalPage.properties.notices.allOf = [{ contains: { type: 'object', properties: {
    name: { type: 'string', enum: [notice] }, value: { type: 'string' },
  } } }];
  return { ...value, schemaString: JSON.stringify(raw) };
}
async function setup(h, value, enabled = true) {
  const api = h.load('app/api/category-profiles/route.ts');
  const input = { name: '시험 최종분류', categoryId: value.categoryId, categoryPath: value.categoryPath, template: null, mappings: [], hubSchema: value };
  const response = await api.POST(new Request('https://app.test/api/category-profiles', {
    method: 'POST', headers: { 'content-type': 'application/json', 'Idempotency-Key': crypto.randomUUID() }, body: JSON.stringify(input),
  }));
  assert.equal(response.status, 201, await response.clone().text());
  const { profile } = await response.json();
  h.context.category = profile;
  h.context.settings.manufactureDatePreviousMonth = enabled;
  // Collection may finish in a different calendar month from URL registration.
  h.context.capturedAt = '2024-03-31T14:59:59Z';
  h.sqlite.prepare('UPDATE collection_context SET payload=? WHERE job_id=?').run(JSON.stringify(h.context), 'job');
  assert.match(await h.intake(), /상품 초안 저장됨/);
  const product = h.sqlite.prepare('SELECT * FROM products').get();
  return { api, input, profile, product, base: '/api/products/' + product.id };
}
function noticeField(view, name) {
  return view.resolved.schema.fields.find(field => field.section === 'legal' && field.label === name);
}

for (const [index, company] of schemaCompanies.entries()) test(`captured category date stays identical in stage six, stage seven and quotation bytes (${company.code})`, async () => {
  const h = mobileIntakeHarness({ companyCode: company.code, companyName: company.name });
  try {
    const name = index ? '출시년월' : '제조년월', f = await setup(h, snapshot(company, name));
    const read = suffix => h.route(f.base + '/' + suffix).then(json);
    const content = (await read('content')).content;
    assert.equal(content.label.releaseDate.value, '2024.02');
    assert.equal(content.label.releaseDate.provenance, 'generated');
    const plan = h.load('app/document-image.ts').documentImagePlan('label', content, { productId: f.product.id });
    assert.equal(plan.rows.find(row => row[0] === '출시년월')[1], '2024.02');
    const registration = await read('registration-settings');
    assert.equal(registration.dateNotice, true);
    assert.equal(registration.referenceTime, h.context.capturedAt);
    let view = await read('quotation-fields'), field = noticeField(view, name);
    assert.equal(view.resolved.rows.filter(row => row.optionId !== null).length, 6);
    for (const row of view.resolved.rows) assert.equal(row.fields[field.id].value, '2024.02');
    // The original snapshot, not an edited profile or current workspace, drives
    // later label review. A GET must not write to the working product.
    const updated = snapshot(company, '다른 항목');
    await json(await f.api.PUT(new Request('https://app.test/api/category-profiles', {
      method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: f.profile.id, expectedRevision: f.profile.revision, profile: { ...f.input, hubSchema: updated } }),
    })));
    await h.load('db/queries.ts').saveSettings('owner', JSON.stringify({ ...h.settings, manufactureDatePreviousMonth: false }));
    const stored = JSON.stringify((await read('content')).content);
    assert.equal((await read('registration-settings')).dateNotice, true);
    assert.equal((await read('registration-settings')).settings.manufactureDatePreviousMonth, true);
    assert.equal(JSON.stringify((await read('content')).content), stored);
    // Explicit stage-six edits and blanks remain authoritative in every option.
    for (const value of ['2024.02', '검토한 제조년월', '']) {
      if (value !== '2024.02') {
        const current = (await read('content')).content;
        await json(await h.route(f.base + '/content', { method: 'PATCH', body: {
          expectedRevision: current.revision, patch: { label: { releaseDate: value }, ...(value ? {} : { labelClears: ['releaseDate'] }) },
        } }));
      }
      view = await read('quotation-fields'); field = noticeField(view, name);
      for (const row of view.resolved.rows) assert.equal(row.fields[field.id].value, value);
      const exports = h.load('app/exports/quotation-source.ts'), source = await exports.readQuotationExportSource('owner', f.product.id, f.profile.id);
      const rows = h.load('app/exports/quotation-fields.ts').resolvedQuotationRows(source, exports.resolveQuotationExport(source), []);
      const bytes = new TextEncoder().encode('제조년월\n').buffer, sha256 = Buffer.from(await crypto.subtle.digest('SHA-256', bytes)).toString('hex');
      const profile = { ...f.profile, template: { name: 'synthetic-notice.csv', format: 'csv', sheetName: '', headerRow: 1, headers: ['제조년월'], sha256 }, mappings: [{ field: field.id, column: 0, required: false }] };
      const output = await h.load('app/exports/mapped-quotation.ts').createMappedQuotation({ originalBytes: bytes, profile, rows, dataStartRow: 2 });
      assert.equal(output.values.length, 6);
      assert.ok(output.values.every(row => row[0] === value));
      assert.equal(new TextDecoder().decode(output.bytes), '"제조년월"\r\n' + (`"${value}"\r\n`).repeat(6));
    }
    assert.ok(!h.network.includes('supplier.coupang.com'));
  } finally { h.close(); }
});

test('an opted-out category keeps its date label blank and does not introduce a supplier fact', async () => {
  const h = mobileIntakeHarness();
  try {
    const f = await setup(h, snapshot(schemaCompanies[0]), false);
    const content = (await json(await h.route(f.base + '/content'))).content;
    assert.equal(content.label.releaseDate.value, '');
    assert.equal(content.label.releaseDate.provenance, 'unverified');
  } finally { h.close(); }
});

test('a captured form without a date notice overrides a static category date assumption', async () => {
  const h = mobileIntakeHarness();
  try {
    const value = snapshot(schemaCompanies[0], '출시년월 안내');
    value.categoryId = '80719'; value.categoryPath = [...h.context.category.categoryPath];
    value.metadata.displayCategoryCode = '80719';
    const f = await setup(h, value), body = await json(await h.route(f.base + '/registration-settings'));
    const content = (await json(await h.route(f.base + '/content'))).content;
    assert.equal(body.dateNotice, false);
    assert.equal(content.label.releaseDate.value, '');
    const draft = Object.fromEntries(Object.entries(content.label).map(([key, field]) => [key, field.value]));
    const fill = h.load('app/label-autofill.ts').fillLabelDraft(draft, content, f.product.title, body.settings, body.categoryId, [], body.referenceTime, body.dateNotice);
    assert.equal(fill.label.releaseDate, '');
  } finally { h.close(); }
});

test('same-named product attributes are not manufacturing notices and malformed snapshots never fall back', async () => {
  const h = mobileIntakeHarness();
  try {
    const value = snapshot(schemaCompanies[0], '출시년월 안내'), raw = JSON.parse(value.schemaString);
    raw.properties.productPage.properties.basicAttributes.properties.date = { title: '제조년월', type: 'string' };
    value.schemaString = JSON.stringify(raw);
    const f = await setup(h, value);
    assert.equal((await json(await h.route(f.base + '/registration-settings'))).dateNotice, false);
    assert.equal((await json(await h.route(f.base + '/content'))).content.label.releaseDate.value, '');
    h.context.category.hubSchema = { ...value, categoryId: '991235' };
    h.sqlite.prepare('UPDATE collection_context SET payload=? WHERE job_id=?').run(JSON.stringify(h.context), 'job');
    assert.equal((await h.route(f.base + '/registration-settings')).status, 503);
  } finally { h.close(); }
});
