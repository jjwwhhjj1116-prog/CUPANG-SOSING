import test from 'node:test';
import assert from 'node:assert/strict';
import { mobileIntakeHarness } from './helpers/mobile-intake.mjs';

test('Couplus notice settings combine exact text and freeze the previous Korean calendar month', () => {
  const h = mobileIntakeHarness();
  try {
    const settings = h.load('app/workspace-settings.ts');
    const model = h.load('app/couplus-registration-defaults.ts');
    assert.equal(settings.newWorkspaceSettings.shelfLifeDays, 0);
    assert.equal(settings.newWorkspaceSettings.handlingReason, '해당사항없음');
    const saved = settings.validateSettings({ washingMethod: '손세탁', handlingPrecautions: '화기 주의', manufactureDatePreviousMonth: true, shelfLifeDays: 365, handlingReason: '유리' });
    assert.equal(model.washingPrecautionsText(saved), '세탁방법: 손세탁, 취급시 주의사항: 화기 주의');
    assert.equal(model.washingPrecautionsText({ washingMethod: '손세탁' }), '손세탁');
    assert.equal(model.washingPrecautionsText({ handlingPrecautions: '화기 주의' }), '화기 주의');
    assert.equal(model.washingPrecautionsText({}), '');
    for (const [time, month] of [['2026-10-02T00:00:00Z', '2026.09'], ['2026-01-31T23:00:00+09:00', '2025.12'], ['2024-03-31T12:00:00+09:00', '2024.02'], ['2026-09-30T15:00:00Z', '2026.09']]) {
      assert.equal(model.previousRegistrationMonth(time), month);
    }
    for (const invalid of [undefined, '', '2026-02-31', 'invalid', '2026-01-01']) assert.equal(model.previousRegistrationMonth(invalid), '');
    for (const patch of [{ washingMethod: 1 }, { handlingPrecautions: '\u0000text' }, { washingMethod: 'x'.repeat(501) }, { manufactureDatePreviousMonth: 'true' }, { shelfLifeDays: -1 }, { shelfLifeDays: 1.5 }, { shelfLifeDays: 100001 }, { handlingReason: 'invented' }]) assert.throws(() => settings.validateSettings(patch));
    const frozen = h.load('app/collection-registration-settings.ts').collectionRegistrationSettings({ ...saved, washingMethod: '새 설정', manufactureDatePreviousMonth: false, shelfLifeDays: 30 }, saved);
    assert.equal(frozen.washingMethod, '손세탁'); assert.equal(frozen.manufactureDatePreviousMonth, true); assert.equal(frozen.shelfLifeDays, 365);
    const legacy = h.load('app/collection-registration-settings.ts').collectionRegistrationSettings(saved, { brand: '이전' });
    assert.equal(legacy.washingMethod, ''); assert.equal(legacy.manufactureDatePreviousMonth, false); assert.equal(legacy.shelfLifeDays, null); assert.equal(legacy.handlingReason, '');
  } finally { h.close(); }
});

for (const company of [{ companyCode: 'A01464742', companyName: '와이홉' }, { companyCode: 'A01526306', companyName: '유앤채' }]) test(`URL draft preserves notice and logistics settings through manual review and export (${company.companyCode})`, async () => {
  const h = mobileIntakeHarness(company);
  try {
    Object.assign(h.context.settings, { washingMethod: '손세탁', handlingPrecautions: '화기 주의', manufactureDatePreviousMonth: true, shelfLifeDays: 180, handlingReason: '유리' });
    h.context.capturedAt = '2026-10-01T00:00:00+09:00';
    h.sqlite.prepare('UPDATE collection_context SET payload=? WHERE job_id=?').run(JSON.stringify(h.context), 'job');
    assert.match(await h.intake(), /상품 초안 저장됨/);
    const product = h.sqlite.prepare('SELECT * FROM products').get();
    const read = async suffix => (await h.route(`/api/products/${product.id}/${suffix}`)).json();
    const content = await h.load('db/product-content.ts').readProductContent('owner', product.id);
    assert.equal(content.label.washingPrecautions.value, '세탁방법: 손세탁, 취급시 주의사항: 화기 주의');
    assert.equal(content.label.washingPrecautions.provenance, 'generated');
    assert.equal(content.label.releaseDate.value, '2026.09');
    const plan = h.load('app/document-image.ts').documentImagePlan('label', content, { productId: product.id });
    assert.equal(plan.rows.find(row => row[0] === '세탁방법 및 취급시 주의사항')[1], content.label.washingPrecautions.value);
    const registration = await read('registration-settings');
    assert.equal(registration.settings.washingMethod, '손세탁'); assert.equal(registration.referenceTime, h.context.capturedAt);
    // Later workspace settings never replace this product's intake snapshot.
    await h.load('db/queries.ts').saveSettings('owner', JSON.stringify({ ...h.settings, washingMethod: '다른 설정', manufactureDatePreviousMonth: false, shelfLifeDays: 10, handlingReason: '해당사항없음' }));
    const path = `/api/products/${product.id}/quotation-fields`, view = await read('quotation-fields');
    for (const row of view.resolved.rows) {
      assert.equal(row.fields.noticeReleaseDate.value, '2026.09'); assert.ok(row.fields.noticeReleaseDate.needsReview);
      assert.equal(row.fields.shelfLifeDays.value, '180'); assert.equal(row.fields.handlingReason.value, '유리');
    }
    const option = view.resolved.rows.find(row => row.optionId);
    const response = await h.route(path, { method: 'PUT', body: { expectedRevision: view.revision, expectedInputFingerprint: view.inputFingerprint, changes: [{ optionId: option.optionId, fieldKey: 'noticeReleaseDate', value: '' }, { optionId: option.optionId, fieldKey: 'shelfLifeDays', value: '0' }, { optionId: option.optionId, fieldKey: 'handlingReason', value: '해당사항없음' }] } });
    assert.equal(response.status, 200, await response.clone().text());
    const exports = h.load('app/exports/quotation-source.ts'), source = await exports.readQuotationExportSource('owner', product.id, null), resolved = exports.resolveQuotationExport(source);
    const assets = JSON.parse(product.image_keys).map((key, index) => ({ key, name: `assets/${index}.png` }));
    const rows = h.load('app/exports/quotation-fields.ts').resolvedQuotationRows(source, resolved, assets);
    const edited = rows.find(row => row.skuId === source.options.rows.find(row => row.id === option.optionId).supplierSku);
    assert.equal(edited.noticeReleaseDate, ''); assert.equal(edited.shelfLifeDays, 0); assert.equal(edited.handlingReason, '해당사항없음');
    assert.equal(rows.find(row => row !== edited).noticeReleaseDate, '2026.09');
    // Stage-six explicit blanks must also survive the settings defaults.
    const model = h.load('app/product-content.ts'), changed = model.applyContentPatch(content, { label: { releaseDate: '', washingPrecautions: '' }, labelClears: ['releaseDate', 'washingPrecautions'] }, '2026-11-01T00:00:00Z');
    const draft = Object.fromEntries(Object.entries(changed.label).map(([key, field]) => [key, field.value]));
    const filled = h.load('app/label-autofill.ts').fillLabelDraft(draft, changed, product.title, source.settings, '80719', [], h.context.capturedAt);
    assert.equal(filled.label.releaseDate, ''); assert.equal(filled.label.washingPrecautions, '');
    assert.equal(h.calls.some(path => path.includes('supplier-hub-receipt')), false);
  } finally { h.close(); }
});

test('recorded category date notices accept the opt-in setting, while unrelated attributes and manual dates retain priority', () => {
  const h = mobileIntakeHarness();
  try {
    const model = h.load('app/quotation-schema.ts'), contentModel = h.load('app/product-content.ts');
    const ids = [...new Set([...Object.keys(h.load('app/hub-product-schemas.ts').hubProductSchemas), '80719', '81452', '64497', '103495', '77442', '81221'])];
    const settings = { ...h.settings, manufactureDatePreviousMonth: true }, product = { id: 'p', title: '검토 상품', image_keys: '[]', created_at: '2024-03-31T14:59:00Z', pricing_policy: JSON.stringify(settings) }, options = h.load('app/product-options.ts').emptyProductOptions('p');
    for (const categoryId of ids) {
      const content = contentModel.emptyProductContent('p'), input = { categoryId, content, product, options, settings }, resolved = model.resolveQuotationFields(input);
      const month = resolved.schema.fields.find(field => field.section === 'legal' && ['출시년월', '제조년월'].includes(field.label));
      const draft = Object.fromEntries(Object.entries(content.label).map(([key, field]) => [key, field.value]));
      const filled = h.load('app/label-autofill.ts').fillLabelDraft(draft, content, product.title, settings, categoryId, [], product.created_at);
      assert.equal(filled.label.releaseDate, month ? '2024.02' : '', categoryId);
      if (month) {
        assert.equal(resolved.rows[0].fields[month.id].value, '2024.02', categoryId);
        for (const value of ['', '직접 확인한 제조년월']) {
          content.label.releaseDate = { value, provenance: 'manual', updatedAt: 'saved' };
          assert.equal(model.resolveQuotationFields(input).rows[0].fields[month.id].value, value, categoryId);
        }
      }
      const washing = resolved.schema.fields.find(field => field.section === 'product' && field.label === '세탁방법');
      if (washing) assert.equal(resolved.rows[0].fields[washing.id].source, 'couplus-default');
    }
  } finally { h.close(); }
});

test('saved settings API persists opt-in notice and logistics fields and rejects invalid saves without replacing them', async () => {
  const h = mobileIntakeHarness();
  try {
    const route = h.load('app/api/settings/route.ts');
    const value = { ...h.settings, washingMethod: '손세탁', handlingPrecautions: '화기 주의', manufactureDatePreviousMonth: true, shelfLifeDays: 30, handlingReason: '유리' };
    const put = patch => route.PUT(new Request('https://app.test/api/settings', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(patch) }));
    assert.equal((await put(value)).status, 200);
    assert.deepEqual((await (await route.GET()).json()).settings, value);
    assert.equal((await put({ ...value, shelfLifeDays: -1 })).status, 400);
    assert.deepEqual((await (await route.GET()).json()).settings, value);
  } finally { h.close(); }
});
