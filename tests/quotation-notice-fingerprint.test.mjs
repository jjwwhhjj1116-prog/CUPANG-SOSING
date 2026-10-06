import test from 'node:test';
import assert from 'node:assert/strict';
import { mobileIntakeHarness } from './helpers/mobile-intake.mjs';
import { hubSchemaSnapshot, schemaCompanies } from './helpers/hub-schema.mjs';
import { quotationWorkbook } from './helpers/quotation-workbook.mjs';

const json = async response => { assert.equal(response.status, 200, await response.clone().text()); return response.json(); };
const plain = value => JSON.parse(JSON.stringify(value));
const names = ['제조년월', '세탁방법 및 취급시 주의사항'];
async function setup(company, actualNotices = false) {
  const h = mobileIntakeHarness({ companyCode: company.code, companyName: company.name });
  const snap = hubSchemaSnapshot(company), raw = JSON.parse(snap.schemaString);
  raw.properties.legalPage.properties.notices.allOf = actualNotices ? names.map(name => ({ contains: { type: 'object', properties: {
    name: { type: 'string', enum: [name] }, value: { type: 'string' },
  } } })) : [];
  if (!actualNotices) {
    raw.properties.legalPage.properties.dateControl = { type: 'string', title: names[0] };
    raw.properties.legalPage.properties.washingControl = { type: 'string', title: names[1] };
  }
  Object.assign(snap, { schemaString: JSON.stringify(raw), inputBindings: 'couplus-paths-v1', draftInitialization: 'couplus-required-v1' });
  const schema = h.load('app/quotation-schema.ts').getQuotationSchema(snap.categoryId, snap.categoryPath, snap);
  const headers = ['skuId', ...schema.fields.map(field => field.id)], bytes = quotationWorkbook(headers);
  const sha256 = Buffer.from(await crypto.subtle.digest('SHA-256', bytes)).toString('hex');
  const storageKey = h.load('db/category-templates.ts').templateKey('owner', sha256, 'xlsx'); h.objects.set(storageKey, bytes);
  const profile = await h.load('db/category-profiles.ts').createCategoryProfile('owner', {
    name: '합성 고시 지문 검사', categoryId: snap.categoryId, categoryPath: snap.categoryPath, hubSchema: snap,
    template: { name: 'synthetic.xlsx', format: 'xlsx', sha256, storageKey, sheetName: '견적서', headerRow: 1, headers },
    mappings: headers.map((field, column) => ({ field, column, required: false })),
  }, 'cat');
  h.context.category = profile; h.context.capturedAt = '2024-03-31T14:59:59Z';
  Object.assign(h.context.settings, { manufactureDatePreviousMonth: true, washingMethod: '손세탁', handlingPrecautions: '화기 주의' });
  h.sqlite.prepare('UPDATE collection_context SET payload=? WHERE job_id=?').run(JSON.stringify(h.context), 'job');
  await h.intake(); const product = h.sqlite.prepare('SELECT * FROM products').get(), base = '/api/products/' + product.id;
  const source = await h.load('app/exports/quotation-source.ts').readMappedQuotationSource('owner', product.id, 'cat');
  return { ...h, base, product, source, profile };
}

// The deployed fingerprint contract before the notice predicate correction.
// Its payload intentionally has no global version or new normalized defaults.
async function legacyExportFingerprint(h, source = h.source) {
  return h.load('app/automation/model.ts').fingerprint({ format: 'sourceflow-quotation-fields-v1',
    saved: { ...source, settings: h.load('app/settings-fingerprint.ts').savedProductFingerprintSettings(source.settings) }, dataStartRow: 2,
    schema: h.load('app/quotation-schema.ts').getQuotationSchema(source.categoryContext.categoryId, source.categoryContext.categoryPath, source.hubSchema),
    ...h.load('app/product-options.ts').optionPriceCalculationRevision(source.product, source.options.rows, source.settings, source.state.overrides),
  });
}
async function legacyEditorFingerprint(h, view, source = h.source) {
  const inputs = { categoryId: source.categoryContext.categoryId, categoryPath: source.categoryContext.categoryPath,
    product: source.product, content: source.content, options: source.options, settings: source.settings, hubSchema: source.hubSchema };
  return h.load('app/automation/model.ts').fingerprint({ inputs: { ...inputs,
    settings: h.load('app/settings-fingerprint.ts').savedProductFingerprintSettings(inputs.settings) }, schema: view.automatic.schema,
    categoryContext: view.categoryContext, profileRevision: source.profile.revision, settingsPayload: source.source.settingsPayload, collection: source.source.collection,
    ...h.load('app/product-options.ts').optionPriceCalculationRevision(source.product, source.options.rows, source.settings),
  });
}
async function saveEarlierReceipt(h, fingerprint) {
  const result = { state: 'validation-complete', filename: `YOOFAM-${fingerprint}.xlsx`, company: h.source.company,
    includedOptions: 6, quotationId: 'synthetic-earlier-quotation', registered: false, observedAt: Date.now() };
  const receipt = { schemaVersion: 1, evidence: 'chrome-observation', profileId: 'cat', categoryId: h.profile.categoryId,
    fingerprint, productVersion: h.source.product.updated_at, recordedAt: new Date().toISOString(), result };
  assert.equal(await h.load('db/supplier-hub-receipts.ts').saveSupplierHubReceipt('owner', h.product.id, receipt, h.source.source, h.source.state.revision), true);
  return { result, payload: h.sqlite.prepare('SELECT payload FROM supplier_hub_receipts').get().payload };
}

for (const company of schemaCompanies) test(`only changed notice defaults retire the earlier package identity and preserve its receipt (${company.code})`, async () => {
  const h = await setup(company); try {
    const oldFingerprint = await legacyExportFingerprint(h), earlier = await saveEarlierReceipt(h, oldFingerprint);
    const before = ['products', 'product_content', 'product_options', 'collection_context'].map(table => h.sqlite.prepare(`SELECT * FROM ${table}`).get());
    const view = await json(await h.route(h.base + '/quotation-fields?profileId=cat'));
    assert.notEqual(view.inputFingerprint, await legacyEditorFingerprint(h, view));
    const staleEdit = await h.route(h.base + '/quotation-fields?profileId=cat', { method: 'PUT', body: {
      expectedRevision: view.revision, expectedInputFingerprint: await legacyEditorFingerprint(h, view), changes: [{ fieldKey: 'title', optionId: null, value: '오래된 화면' }],
    } }); assert.equal(staleEdit.status, 409);
    const preview = await json(await h.route(h.base + '/quotation', { method: 'POST', body: { action: 'preview' } }));
    assert.notEqual(preview.fingerprint, oldFingerprint); assert.notEqual(preview.filename, earlier.result.filename);
    const sourceView = await json(await h.route(h.base + '/quotation', { method: 'POST', body: { action: 'source' } }));
    assert.equal(sourceView.fingerprint, preview.fingerprint);
    assert.equal((await h.route(h.base + '/quotation', { method: 'POST', body: { action: 'export', fingerprint: oldFingerprint } })).status, 409);
    const staleReceipt = await h.route(h.base + '/supplier-hub-receipt', { method: 'POST', body: {
      profileId: 'cat', categoryId: h.profile.categoryId, fingerprint: oldFingerprint, result: earlier.result,
    } }); assert.equal(staleReceipt.status, 409);
    assert.equal((await json(await h.route(h.base + '/supplier-hub-receipt?fingerprint=' + oldFingerprint))).receipt.result.quotationId, earlier.result.quotationId);
    assert.equal((await json(await h.route(h.base + '/supplier-hub-receipt?fingerprint=' + preview.fingerprint))).receipt, null);
    assert.equal(h.sqlite.prepare('SELECT payload FROM supplier_hub_receipts').get().payload, earlier.payload);
    const exported = await h.route(h.base + '/quotation', { method: 'POST', body: { action: 'export', fingerprint: preview.fingerprint } });
    assert.equal(exported.status, 200, await exported.clone().text());
    const files = await h.load('app/xlsx-template.ts').readXlsxArchive(await exported.arrayBuffer());
    const document = JSON.parse(new TextDecoder().decode(files.get('quotation-fields.json')));
    assert.equal(document.inputFingerprint, preview.fingerprint);
    for (const row of document.rows) for (const field of document.schema.fields.filter(field => names.includes(field.label))) assert.equal(row.fields[field.id].value, '');
    for (const [index, table] of ['products', 'product_content', 'product_options', 'collection_context'].entries()) assert.deepEqual(h.sqlite.prepare(`SELECT * FROM ${table}`).get(), before[index]);
    assert.ok(!h.network.includes('supplier.coupang.com'));
  } finally { h.close(); }
});

for (const company of schemaCompanies) test(`proper named notices retain the precise earlier editor/package identity and receipt (${company.code})`, async () => {
  const h = await setup(company, true); try {
    const oldFingerprint = await legacyExportFingerprint(h), earlier = await saveEarlierReceipt(h, oldFingerprint);
    const view = await json(await h.route(h.base + '/quotation-fields?profileId=cat'));
    assert.equal(view.inputFingerprint, await legacyEditorFingerprint(h, view));
    const preview = await json(await h.route(h.base + '/quotation', { method: 'POST', body: { action: 'preview' } }));
    assert.equal(preview.fingerprint, oldFingerprint); assert.equal(preview.filename, earlier.result.filename);
    const restored = await json(await h.route(h.base + '/supplier-hub-receipt?fingerprint=' + preview.fingerprint));
    assert.equal(restored.receipt.result.quotationId, earlier.result.quotationId);
    assert.equal(h.sqlite.prepare('SELECT payload FROM supplier_hub_receipts').get().payload, earlier.payload);
    const fields = view.resolved.schema.fields.filter(field => names.includes(field.label));
    for (const row of view.resolved.rows.filter(row => row.included)) for (const field of fields) assert.equal(row.fields[field.id].value, field.label === names[0] ? '2024.02' : '세탁방법: 손세탁, 취급시 주의사항: 화기 주의');
  } finally { h.close(); }
});

test('inactive, equal-valued and manually overridden controls retain the exact legacy fingerprint payload', async () => {
  const h = await setup(schemaCompanies[0]); try {
    const model = h.load('app/exports/quotation-source.ts'), bindings = h.load('app/quotation-notice-inputs.ts');
    const targets = model.resolveQuotationExport(h.source).schema.fields.filter(field => names.includes(field.label));
    const inactive = { ...h.source, content: structuredClone(h.source.content), settings: { ...h.source.settings, manufactureDatePreviousMonth: false, washingMethod: '', handlingPrecautions: '' } };
    for (const key of ['releaseDate', 'washingPrecautions']) inactive.content.label[key] = { value: '', provenance: 'unverified', updatedAt: null };
    const cleared = structuredClone(h.source);
    for (const key of ['releaseDate', 'washingPrecautions']) cleared.content.label[key] = { value: '', provenance: 'manual', updatedAt: 'saved' };
    const common = { ...h.source, state: { ...h.source.state, overrides: { common: Object.fromEntries(targets.map(field => [field.id, '직접 검토'])), options: {} } } };
    const option = { ...h.source, state: { ...h.source.state, overrides: { common: {}, options: Object.fromEntries(h.source.options.rows.map(row => [row.id, Object.fromEntries(targets.map(field => [field.id, '']))])) } } };
    const equal = structuredClone(h.source), raw = JSON.parse(equal.hubSchema.schemaString);
    raw.required = ['legalPage']; raw.properties.legalPage.required = ['dateControl', 'washingControl'];
    raw.properties.legalPage.properties.dateControl.enum = [h.load('app/couplus-registration-defaults.ts').previousRegistrationMonth(equal.product.created_at)];
    raw.properties.legalPage.properties.washingControl.enum = ['세탁방법: 손세탁, 취급시 주의사항: 화기 주의'];
    equal.hubSchema.schemaString = JSON.stringify(raw);
    for (const [name, source] of [['inactive', inactive], ['cleared', cleared], ['common', common], ['option', option], ['equal', equal]]) {
      assert.deepEqual(plain(bindings.quotationNoticeBindingFingerprint(source, model.resolveQuotationExport(source))), {}, name);
      assert.equal(await model.quotationExportFingerprint(source, 2), await legacyExportFingerprint(h, source));
    }
    const changed = { ...inactive, content: structuredClone(inactive.content) };
    changed.content.label.releaseDate = { value: '직접 저장한 6단계 날짜', provenance: 'manual', updatedAt: 'saved' };
    assert.notEqual(await model.quotationExportFingerprint(changed, 2), await legacyExportFingerprint(h, changed), 'stored nonempty content leaked by the old title rule also changes actual output');
    assert.equal(changed.content.label.releaseDate.value, '직접 저장한 6단계 날짜');
    for (const optionOnly of [false, true]) {
      const view = await json(await h.route(h.base + '/quotation-fields?profileId=cat'));
      const optionIds = optionOnly ? h.source.options.rows.map(row => row.id) : [null];
      const changes = targets.flatMap(field => optionIds.map(optionId => ({ fieldKey: field.id, optionId, value: optionOnly ? '' : '직접 검토' })));
      if (optionOnly) changes.push(...targets.map(field => ({ fieldKey: field.id, optionId: null, value: null })));
      const savedView = await json(await h.route(h.base + '/quotation-fields?profileId=cat', { method: 'PUT', body: {
        expectedRevision: view.revision, expectedInputFingerprint: view.inputFingerprint, changes,
      } }));
      const source = await model.readMappedQuotationSource('owner', h.product.id, 'cat');
      assert.equal(savedView.inputFingerprint, await legacyEditorFingerprint(h, savedView, source));
      assert.equal(await model.quotationExportFingerprint(source, 2), await legacyExportFingerprint(h, source));
      for (const row of savedView.resolved.rows.filter(row => row.included)) for (const field of targets) {
        assert.equal(row.fields[field.id].value, optionOnly ? '' : '직접 검토');
        assert.equal(row.fields[field.id].source, optionOnly ? 'manual-option' : 'manual-common');
      }
    }
  } finally { h.close(); }
});
