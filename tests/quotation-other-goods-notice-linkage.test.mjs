import test from 'node:test';
import assert from 'node:assert/strict';
import { mobileIntakeHarness } from './helpers/mobile-intake.mjs';
import { hubSchemaSnapshot, schemaCompanies } from './helpers/hub-schema.mjs';
import { quotationWorkbook } from './helpers/quotation-workbook.mjs';

const plain = value => JSON.parse(JSON.stringify(value));
const names = ['인증/허가 사항', '제조국(원산지)', '소비자상담 관련 전화번호'];
const sources = ['certification', 'countryOfOrigin', 'contact'];
const bindings = ['noticePermission', 'noticeCountryOfOrigin', 'noticeServiceContact'];
const reviewed = ['확인한 인증·허가 내용', '대한민국 확인', '02-1234-5678 확인'];
const revision = { noticeOtherGoodsSourceBindingRevision: 'exact-other-goods-notice-sources-v1' };
const json = async response => {
  assert.equal(response.status, 200, await response.clone().text());
  return response.json();
};

// Exact headings and name/value keys recorded in 64455 Single v188. The
// remaining schema and every workbook/product are local synthetic fixtures.
function snapshot(company, categoryId = '64455', group = 'notices', headings = names) {
  const value = hubSchemaSnapshot(company, categoryId), raw = JSON.parse(value.schemaString);
  raw.properties.legalPage.properties = {
    [group]: { type: 'array', allOf: headings.map(name => ({ contains: { type: 'object', properties: {
      noticeItemName: { type: 'string', enum: [name] }, noticeItemValue: { type: 'string' },
    } } })) },
  };
  return { ...value, schemaString: JSON.stringify(raw), inputBindings: 'couplus-paths-v1' };
}
function fixture(h, company = schemaCompanies[0], categoryId = '64455', group = 'notices', headings = names) {
  const hubSchema = snapshot(company, categoryId, group, headings);
  const model = h.load('app/product-content.ts'), content = model.emptyProductContent('p');
  for (const [index, key] of sources.entries()) content.label[key] = { value: reviewed[index], provenance: 'manual', updatedAt: '2026-10-09T00:00:00Z' };
  const optionModel = h.load('app/product-options.ts');
  const options = optionModel.applyOptionRows(optionModel.emptyProductOptions('p'), [{
    ...optionModel.emptyOptionInput('option'), included: true, originalName: '검토 옵션', unitCostCny: 4.5,
  }], '2026-10-09T00:00:00Z');
  const product = { id: 'p', title: '원문 상품명', source_url: h.sourceUrl, source_price_cny: 4.5,
    supply_price: 3000, sale_price: 5000, msrp: 6500, exchange_rate: 350, supply_margin: 50, coupang_margin: 40,
    image_keys: '[]', created_at: '2026-10-09T00:00:00Z', updated_at: '2026-10-09T00:00:00Z' };
  return { categoryId, categoryPath: hubSchema.categoryPath, product, content, options, settings: { ...h.settings }, hubSchema };
}
const saved = (input, overrides = { common: {}, options: {} }) => ({ ...input,
  categoryContext: { source: 'collection', profileId: 'cat', categoryId: input.categoryId, categoryPath: input.categoryPath },
  state: { revision: 0, overrides }, company: { ...input.hubSchema?.company }, profile: null,
});
const fieldsOf = resolved => names.map(name => resolved.schema.fields.find(field => field.label === name && field.hubWire?.path.join('.') === 'legalPage.notices'));
async function earlierFingerprint(h, source) {
  return h.load('app/automation/model.ts').fingerprint({ format: 'sourceflow-quotation-fields-v1',
    saved: { ...source, settings: h.load('app/settings-fingerprint.ts').savedProductFingerprintSettings(source.settings) }, dataStartRow: 2,
    schema: h.load('app/quotation-schema.ts').getQuotationSchema(source.categoryContext.categoryId, source.categoryContext.categoryPath, source.hubSchema),
    ...h.load('app/product-options.ts').optionPriceCalculationRevision(source.product, source.options.rows, source.settings, source.state.overrides),
  });
}
async function exportCells(h, profile, productId, fields) {
  const model = h.load('app/exports/quotation-source.ts');
  const source = await model.readQuotationExportSource('owner', productId, profile.id), resolved = model.resolveQuotationExport(source);
  const rows = h.load('app/exports/quotation-fields.ts').resolvedQuotationRows(source, resolved, []);
  const bytes = quotationWorkbook(names), sha256 = Buffer.from(await crypto.subtle.digest('SHA-256', bytes)).toString('hex');
  const output = await h.load('app/exports/mapped-quotation.ts').createMappedQuotation({ originalBytes: bytes.buffer,
    profile: { ...profile, template: { name: 'synthetic-other-goods.xlsx', format: 'xlsx', sheetName: '견적서', headerRow: 1, headers: names, sha256 },
      mappings: fields.map((field, column) => ({ field: field.id, column, required: false })) }, rows, dataStartRow: 2 });
  const reader = h.load('app/xlsx-template.ts'), archive = reader.inspectXlsxArchive(await reader.readXlsxArchive(output.bytes.buffer));
  return { source, resolved, rows, output, readRow: index => Array.from(reader.xlsxHeaders(archive, '견적서', index + 2)) };
}

for (const company of schemaCompanies) test(`stage-six other-goods notices, manual blanks and final overrides reach exact SKU XLSX cells (${company.code})`, async () => {
  const h = mobileIntakeHarness({ companyCode: company.code, companyName: company.name }); try {
    const hubSchema = snapshot(company), api = h.load('app/api/category-profiles/route.ts');
    const response = await api.POST(new Request('https://app.test/api/category-profiles', { method: 'POST',
      headers: { 'content-type': 'application/json', 'Idempotency-Key': crypto.randomUUID() },
      body: JSON.stringify({ name: '합성 기타 재화 고시', categoryId: hubSchema.categoryId, categoryPath: hubSchema.categoryPath, template: null, mappings: [], hubSchema }),
    }));
    assert.equal(response.status, 201, await response.clone().text()); const { profile } = await response.json();
    h.context.category = profile; h.sqlite.prepare('UPDATE collection_context SET payload=? WHERE job_id=?').run(JSON.stringify(h.context), 'job');
    assert.match(await h.intake(), /상품 초안 저장됨/);
    const product = h.sqlite.prepare('SELECT * FROM products').get(), base = '/api/products/' + product.id;
    const read = suffix => h.route(base + '/' + suffix).then(json);
    let content = (await read('content')).content;
    await json(await h.route(base + '/content', { method: 'PATCH', body: { expectedRevision: content.revision,
      patch: { label: Object.fromEntries(sources.map((key, index) => [key, reviewed[index]])) } } }));
    let view = await read('quotation-fields'), fields = fieldsOf(view.resolved);
    assert.ok(fields.every(field => field?.id.startsWith('live_64455_')), 'new captured wires retain their original field IDs');
    for (const row of view.resolved.rows) for (const [index, field] of fields.entries()) {
      assert.equal(row.fields[field.id].value, reviewed[index], field.label); assert.equal(row.fields[field.id].source, 'content', field.label);
    }
    const first = await exportCells(h, profile, product.id, fields);
    assert.equal(first.source.company.code, company.code); assert.equal(first.source.hubSchema.schemaString, hubSchema.schemaString);
    assert.equal(first.rows.length, 6);
    for (let index = 0; index < 6; index++) {
      assert.deepEqual(Array.from(first.output.values[index]), reviewed); assert.deepEqual(first.readRow(index), reviewed);
    }
    content = (await read('content')).content;
    await json(await h.route(base + '/content', { method: 'PATCH', body: { expectedRevision: content.revision,
      patch: { label: Object.fromEntries(sources.map(key => [key, ''])), labelClears: sources } } }));
    view = await read('quotation-fields');
    for (const row of view.resolved.rows) for (const field of fields) {
      assert.equal(row.fields[field.id].value, ''); assert.equal(row.fields[field.id].source, 'content', 'explicit blanks suppress form and settings defaults');
    }
    const optionIds = view.resolved.rows.filter(row => row.optionId !== null).map(row => row.optionId);
    view = await json(await h.route(base + '/quotation-fields', { method: 'PUT', body: { expectedRevision: view.revision, expectedInputFingerprint: view.inputFingerprint, changes: [
      { optionId: null, fieldKey: fields[0].id, value: '견적 공통 인증·허가' },
      { optionId: optionIds[0], fieldKey: fields[0].id, value: '' },
      { optionId: optionIds[1], fieldKey: fields[1].id, value: '견적 개별 제조국' },
      { optionId: null, fieldKey: fields[2].id, value: '견적 공통 상담 연락처' },
    ] } }));
    const final = await exportCells(h, profile, product.id, fields);
    for (let index = 0; index < 6; index++) {
      const expected = [index === 0 ? '' : '견적 공통 인증·허가', index === 1 ? '견적 개별 제조국' : '', '견적 공통 상담 연락처'];
      assert.deepEqual(Array.from(final.output.values[index]), expected); assert.deepEqual(final.readRow(index), expected);
      const row = view.resolved.rows.find(row => row.optionId === optionIds[index]);
      assert.deepEqual(fields.map(field => row.fields[field.id].value), expected);
    }
    content = (await read('content')).content;
    for (const key of sources) { assert.equal(content.label[key].value, ''); assert.equal(content.label[key].provenance, 'manual'); }
    assert.ok(!h.network.includes('supplier.coupang.com'));
  } finally { h.close(); }
});

test('only the three complete named legal notice wires acquire the new source meanings', () => {
  const h = mobileIntakeHarness(); try {
    const helper = h.load('app/quotation-notice-inputs.ts');
    for (const [index, label] of names.entries()) {
      const field = { id: 'live_test', label, section: 'legal', visibility: 'common', type: 'text',
        hubWire: { path: ['legalPage', 'notices'], name: label, nameKey: 'noticeItemName', valueKey: 'noticeItemValue' } };
      assert.equal(helper.quotationNoticeInput(field), bindings[index]);
      for (const changed of [
        { ...field, hubWire: undefined }, { ...field, section: 'product' }, { ...field, visibility: 'hidden' },
        ...[['legalPage', 'certificates'], ['legalPage', 'notices', 'nested'], ['legalPage', 'nested', 'notices']].map(path => ({ ...field, hubWire: { ...field.hubWire, path } })),
        { ...field, hubWire: { ...field.hubWire, name: '다른 항목' } },
        { ...field, hubWire: { ...field.hubWire, nameKey: '' } }, { ...field, hubWire: { ...field.hubWire, valueKey: undefined } },
        { ...field, label: label + ' 참고', hubWire: { ...field.hubWire, name: label + ' 참고' } },
      ]) assert.equal(helper.quotationNoticeInput(changed), undefined, JSON.stringify(changed));
    }
    const model = h.load('app/quotation-schema.ts');
    for (const [group, headings] of [['certificates', names], ['notices', names.map(name => name + ' 참고')]]) {
      const input = fixture(h, schemaCompanies[0], '64455', group, headings), before = JSON.stringify(input), resolved = model.resolveQuotationFields(input);
      const targets = resolved.schema.fields.filter(field => headings.includes(field.label));
      for (const row of resolved.rows) for (const field of targets) {
        assert.equal(row.fields[field.id].value, '해당사항없음'); assert.equal(row.fields[field.id].source, 'couplus-default');
      }
      const field = targets[0], changed = model.resolveQuotationFields({ ...input, overrides: { common: { [field.id]: '검토 후 직접 입력' }, options: { option: { [field.id]: '' } } } });
      assert.equal(changed.rows.find(row => row.optionId === 'option').fields[field.id].value, '');
      assert.equal(JSON.stringify(input), before, 'reading never rewrites source content or wire identities');
      assert.deepEqual(plain(helper.quotationNoticeBindingFingerprint(input, resolved)), {});
    }
  } finally { h.close(); }
});

test('changed newly linked values and equal-valued source semantics retire earlier export fingerprints', async () => {
  const h = mobileIntakeHarness(); try {
    const model = h.load('app/exports/quotation-source.ts'), helper = h.load('app/quotation-notice-inputs.ts');
    for (const value of [undefined, '', '해당사항없음']) {
      const input = fixture(h);
      if (value !== undefined) for (const key of sources) input.content.label[key].value = value;
      const source = saved(input), resolved = model.resolveQuotationExport(source);
      assert.deepEqual(plain(helper.quotationNoticeBindingFingerprint(source, resolved)), revision);
      assert.notEqual(await model.quotationExportFingerprint(source, 2), await earlierFingerprint(h, source));
    }
    const fallback = fixture(h);
    for (const key of sources) fallback.content.label[key] = { value: '', provenance: 'unverified', updatedAt: null };
    fallback.settings.serviceContact = '기본설정에서 확인한 상담 연락처';
    const source = saved(fallback), resolved = model.resolveQuotationExport(source), contact = fieldsOf(resolved)[2];
    assert.equal(resolved.rows.find(row => row.included).fields[contact.id].value, fallback.settings.serviceContact);
    assert.equal(resolved.rows.find(row => row.included).fields[contact.id].source, 'settings');
    assert.deepEqual(plain(helper.quotationNoticeBindingFingerprint(source, resolved)), revision);
    assert.notEqual(await model.quotationExportFingerprint(source, 2), await earlierFingerprint(h, source));
  } finally { h.close(); }
});

test('absent sources, manual quotation cells, excluded options and lookalikes retain unchanged export hashes', async () => {
  const h = mobileIntakeHarness(); try {
    const model = h.load('app/exports/quotation-source.ts'), helper = h.load('app/quotation-notice-inputs.ts');
    const absent = fixture(h); absent.settings.serviceContact = '';
    for (const key of sources) absent.content.label[key] = { value: '', provenance: 'unverified', updatedAt: null };
    const manual = fixture(h), ids = fieldsOf(model.resolveQuotationExport(saved(manual))).map(field => field.id);
    const cells = Object.fromEntries(ids.map(id => [id, '']));
    const excluded = fixture(h); excluded.options.rows[0].included = false;
    for (const source of [saved(absent), saved(manual, { common: cells, options: {} }), saved(manual, { common: {}, options: { option: cells } }),
      saved(excluded), saved(fixture(h, schemaCompanies[0], '64455', 'certificates')), saved(fixture(h, schemaCompanies[0], '64455', 'notices', names.map(name => name + ' 참고')))]) {
      const resolved = model.resolveQuotationExport(source);
      assert.deepEqual(plain(helper.quotationNoticeBindingFingerprint(source, resolved)), {});
      assert.equal(await model.quotationExportFingerprint(source, 2), await earlierFingerprint(h, source));
    }
  } finally { h.close(); }
});

test('already bound canonical and static other-goods notices keep their old source values and export hashes', async () => {
  const h = mobileIntakeHarness(); try {
    const model = h.load('app/exports/quotation-source.ts'), helper = h.load('app/quotation-notice-inputs.ts');
    for (const categoryId of ['77442', '64497']) {
      const input = fixture(h, schemaCompanies[0], categoryId), source = saved(input), resolved = model.resolveQuotationExport(source);
      assert.deepEqual(fieldsOf(resolved).map(field => field.id), bindings);
      assert.deepEqual(fieldsOf(resolved).map(field => resolved.rows.find(row => row.included).fields[field.id].value), reviewed);
      assert.deepEqual(plain(helper.quotationNoticeBindingFingerprint(source, resolved)), {});
      assert.equal(await model.quotationExportFingerprint(source, 2), await earlierFingerprint(h, source));
      delete source.hubSchema;
      const staticResolved = model.resolveQuotationExport(source), row = staticResolved.rows.find(row => row.included);
      assert.deepEqual(bindings.map(id => row.fields[id].value), reviewed);
      assert.deepEqual(plain(helper.quotationNoticeBindingFingerprint(source, staticResolved)), {});
      assert.equal(await model.quotationExportFingerprint(source, 2), await earlierFingerprint(h, source));
    }
  } finally { h.close(); }
});
