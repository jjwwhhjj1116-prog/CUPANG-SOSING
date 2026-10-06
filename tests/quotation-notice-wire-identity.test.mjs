import test from 'node:test';
import assert from 'node:assert/strict';
import { mobileIntakeHarness } from './helpers/mobile-intake.mjs';
import { hubSchemaSnapshot, schemaCompanies } from './helpers/hub-schema.mjs';
import { quotationWorkbook } from './helpers/quotation-workbook.mjs';

const plain = value => JSON.parse(JSON.stringify(value));
const sportsNames = ['제품 구성', '색상', '크기, 중량', '상품별 세부 사양', 'KC 인증정보'];
const basketNames = ['품명 및 모델명', '재질', '구성품', '크기', '제조자(수입자)', '제조국', '수입신고 문구 여부', '품질보증기준', 'A/S 책임자와 전화번호'];
const named = name => ({ contains: { type: 'object', properties: { name: { type: 'string', enum: [name] }, value: { type: 'string' } } } });

// Synthetic non-notice arrays reproduce the former title/ID shortcut. They do
// not establish that a real saved Hub quotation contains duplicate labels.
function fixture(h, company, categoryId, names, group = 'notices') {
  const snap = hubSchemaSnapshot(company, categoryId), raw = JSON.parse(snap.schemaString);
  raw.properties.legalPage.properties = {
    [group]: { type: 'array', allOf: names.map(named) },
    annotation: { type: 'string', title: '인증 메모', default: '공식 양식 기본값' },
  };
  const hubSchema = { ...snap, schemaString: JSON.stringify(raw), inputBindings: 'couplus-paths-v1' };
  const model = h.load('app/product-content.ts'), content = model.emptyProductContent('p');
  const manual = value => ({ value, provenance: 'manual', updatedAt: '2026-10-06T00:00:00Z' });
  content.seo.title = manual('최종 SEO 상품명');
  Object.assign(content.label, {
    productName: manual('직접 상품명'), model: manual('모델X'), material: manual('직접 재질'), components: manual('직접 구성'),
    dimensions: manual('직접 크기 중량'), specifications: manual('직접 세부 사양'), kcInformation: manual('직접 KC 정보'),
    manufacturer: manual('직접 제조사'), importer: manual('직접 수입사'), countryOfOrigin: manual('직접 제조국'),
    importDeclaration: manual('직접 수입신고 문구'), qualityAssurance: manual('직접 품질보증'), contact: manual('직접 연락처'),
  });
  const optionsModel = h.load('app/product-options.ts');
  const options = optionsModel.applyOptionRows(optionsModel.emptyProductOptions('p'), [{
    ...optionsModel.emptyOptionInput('option'), included: true, originalName: '검토 옵션', unitCostCny: 4.5,
    color: '직접 색상', widthCm: 2, lengthCm: 3, heightCm: 4,
  }], '2026-10-06T00:00:00Z');
  const product = { id: 'p', title: '원문 상품명', source_url: h.sourceUrl, source_price_cny: 4.5,
    supply_price: 3000, sale_price: 5000, msrp: 6500, exchange_rate: 350, supply_margin: 50, coupang_margin: 40,
    image_keys: '[]', created_at: '2026-10-06T00:00:00Z', updated_at: '2026-10-06T00:00:00Z' };
  return { categoryId, categoryPath: snap.categoryPath, product, content, options, settings: { ...h.settings }, hubSchema };
}

const saved = (input, overrides = { common: {}, options: {} }) => ({ ...input,
  categoryContext: { source: 'collection', profileId: 'cat', categoryId: input.categoryId, categoryPath: input.categoryPath },
  state: { revision: 0, overrides }, company: { ...input.hubSchema.company }, profile: null,
});
async function earlierFingerprint(h, source) {
  return h.load('app/automation/model.ts').fingerprint({ format: 'sourceflow-quotation-fields-v1',
    saved: { ...source, settings: h.load('app/settings-fingerprint.ts').savedProductFingerprintSettings(source.settings) }, dataStartRow: 2,
    schema: h.load('app/quotation-schema.ts').getQuotationSchema(source.categoryContext.categoryId, source.categoryContext.categoryPath, source.hubSchema),
    ...h.load('app/product-options.ts').optionPriceCalculationRevision(source.product, source.options.rows, source.settings, source.state.overrides),
  });
}

test('sports and fashion bindings require the full named legalPage.notices wire', () => {
  const h = mobileIntakeHarness(); try {
    const { quotationNoticeInput, isQuotationLegalNotice } = h.load('app/quotation-notice-inputs.ts');
    for (const label of [...sportsNames, '종류', '소재', '치수', '취급시 주의사항']) {
      const field = { id: 'live_991234_test', label, section: 'legal', visibility: 'common', type: 'text',
        hubWire: { path: ['legalPage', 'notices'], name: label, nameKey: 'name', valueKey: 'value' } };
      assert.ok(quotationNoticeInput(field), label); assert.equal(isQuotationLegalNotice(field), true);
      for (const wire of [
        { ...field.hubWire, path: ['legalPage', 'certificates'] },
        { ...field.hubWire, path: ['legalPage', 'other', 'notices'] },
        { ...field.hubWire, path: ['legalPage', 'notices', 'other'] },
        { ...field.hubWire, nameKey: undefined }, { ...field.hubWire, valueKey: '' },
        { ...field.hubWire, name: '다른 항목' },
      ]) assert.equal(quotationNoticeInput({ ...field, hubWire: wire }), undefined, JSON.stringify(wire));
      assert.equal(quotationNoticeInput({ ...field, hubWire: undefined }), undefined);
    }
  } finally { h.close(); }
});

for (const company of schemaCompanies) test(`foreign legal arrays keep captured defaults and stable manual field IDs (${company.code})`, () => {
  const h = mobileIntakeHarness({ companyCode: company.code, companyName: company.name }); try {
    const model = h.load('app/quotation-schema.ts');
    for (const [categoryId, names] of [['991234', sportsNames], ['80719', basketNames]]) {
      const input = fixture(h, company, categoryId, names, 'certificates'), before = JSON.stringify(input);
      const resolved = model.resolveQuotationFields(input), row = resolved.rows.find(row => row.included);
      const fields = resolved.schema.fields.filter(field => field.hubWire?.path.join('.') === 'legalPage.certificates');
      assert.equal(fields.length, names.length);
      if (categoryId === '80719') assert.equal(fields.find(field => field.label === '재질').id, 'noticeMaterial', 'legacy wire IDs remain available to saved manual overrides');
      for (const field of fields) {
        assert.equal(row.fields[field.id].value, '해당사항없음', field.label);
        assert.equal(row.fields[field.id].source, 'couplus-default', field.label);
      }
      const annotation = resolved.schema.fields.find(field => field.label === '인증 메모');
      assert.equal(row.fields[annotation.id].value, '공식 양식 기본값'); assert.equal(row.fields[annotation.id].source, 'schema');
      const first = fields[0], second = fields[1];
      const changed = model.resolveQuotationFields({ ...input, overrides: {
        common: { [first.id]: '견적 공통 수정', [second.id]: '공통값' }, options: { option: { [second.id]: '' } },
      } }).rows.find(row => row.included);
      assert.equal(changed.fields[first.id].value, '견적 공통 수정'); assert.equal(changed.fields[first.id].source, 'manual-common');
      assert.equal(changed.fields[second.id].value, ''); assert.equal(changed.fields[second.id].source, 'manual-option');
      assert.equal(JSON.stringify(input), before, 'read-only resolution does not rewrite stored content or IDs');
    }
  } finally { h.close(); }
});

test('proper sports/basket notice sources, explicit blanks and legacy static notices retain their final export cells', async () => {
  const h = mobileIntakeHarness(); try {
    const model = h.load('app/quotation-schema.ts'), company = schemaCompanies[0];
    for (const [categoryId, names, expected] of [
      ['991234', sportsNames, ['직접 구성', '직접 색상', '직접 크기 중량', '직접 세부 사양', '직접 KC 정보']],
      ['80719', basketNames, ['직접 상품명 / 모델X', '직접 재질', '직접 구성', '2 × 3 × 4 cm', '제조자: 직접 제조사 / 수입자: 직접 수입사', '직접 제조국', '직접 수입신고 문구', '직접 품질보증', '직접 연락처']],
    ]) {
      const input = fixture(h, company, categoryId, names), source = saved(input);
      const resolved = model.resolveQuotationFields(input), row = resolved.rows.find(row => row.included);
      const fields = names.map(name => resolved.schema.fields.find(field => field.hubWire?.path.join('.') === 'legalPage.notices' && field.label === name));
      assert.deepEqual(Array.from(fields, field => row.fields[field.id].value), expected);
      const outputRows = h.load('app/exports/quotation-fields.ts').resolvedQuotationRows(source, resolved, []);
      const headers = fields.map(field => field.id), bytes = quotationWorkbook(headers);
      const sha256 = Buffer.from(await crypto.subtle.digest('SHA-256', bytes)).toString('hex');
      const output = await h.load('app/exports/mapped-quotation.ts').createMappedQuotation({ originalBytes: bytes.buffer,
        profile: { name: '합성 고시 연결 검사', categoryId, categoryPath: input.categoryPath, hubSchema: input.hubSchema,
          template: { name: 'synthetic.xlsx', format: 'xlsx', sheetName: '견적서', headerRow: 1, headers, sha256 },
          mappings: fields.map((field, column) => ({ field: field.id, column, required: false })) }, rows: outputRows, dataStartRow: 2 });
      const reader = h.load('app/xlsx-template.ts'), sheet = reader.inspectXlsxArchive(await reader.readXlsxArchive(output.bytes.buffer));
      assert.deepEqual(Array.from(reader.xlsxHeaders(sheet, '견적서', 2)), expected);
      input.content.label.components.value = '';
      const cleared = model.resolveQuotationFields(input).rows.find(row => row.included);
      const component = fields.find(field => ['제품 구성', '구성품'].includes(field.label));
      assert.equal(cleared.fields[component.id].value, ''); assert.equal(cleared.fields[component.id].source, 'content');
    }
    const legacy = fixture(h, company, '80719', basketNames); delete legacy.hubSchema;
    const row = model.resolveQuotationFields(legacy).rows.find(row => row.included);
    assert.equal(row.fields.noticeMaterial.value, '직접 재질'); assert.equal(row.fields.noticeComponents.value, '직접 구성');
    assert.equal(row.fields.noticeCountryOfOrigin.value, '직접 제조국');
    assert.equal(h.network.length, 0, 'contract export never contacts a seller or Supplier Hub');
  } finally { h.close(); }
});

test('only the narrow affected automatic non-notice scope refreshes package identity', async () => {
  const h = mobileIntakeHarness(); try {
    const model = h.load('app/exports/quotation-source.ts'), bindings = h.load('app/quotation-notice-inputs.ts');
    for (const [categoryId, names] of [['991234', sportsNames], ['80719', basketNames]]) {
      const input = fixture(h, schemaCompanies[0], categoryId, names, 'certificates'), source = saved(input);
      const resolved = model.resolveQuotationExport(source);
      assert.deepEqual(plain(bindings.quotationNoticeBindingFingerprint(source, resolved)), { noticeSourceBindingRevision: 'exact-legal-notice-sources-v1' });
      assert.notEqual(await model.quotationExportFingerprint(source, 2), await earlierFingerprint(h, source));
      const targets = resolved.schema.fields.filter(field => field.hubWire?.path.join('.') === 'legalPage.certificates');
      for (const common of [true, false]) {
        const fields = Object.fromEntries(targets.map(field => [field.id, '']));
        const manualSource = saved(input, common ? { common: fields, options: {} } : { common: {}, options: { option: fields } });
        assert.deepEqual(plain(bindings.quotationNoticeBindingFingerprint(manualSource, model.resolveQuotationExport(manualSource))), {});
        assert.equal(await model.quotationExportFingerprint(manualSource, 2), await earlierFingerprint(h, manualSource));
      }
      const excluded = saved({ ...input, options: { ...input.options, rows: input.options.rows.map(row => ({ ...row, included: false })) } });
      assert.deepEqual(plain(bindings.quotationNoticeBindingFingerprint(excluded, model.resolveQuotationExport(excluded))), {});
      const proper = saved(fixture(h, schemaCompanies[0], categoryId, names));
      assert.deepEqual(plain(bindings.quotationNoticeBindingFingerprint(proper, model.resolveQuotationExport(proper))), {});
      assert.equal(await model.quotationExportFingerprint(proper, 2), await earlierFingerprint(h, proper));
    }
    const unrelated = saved(fixture(h, schemaCompanies[0], '991234', ['독립 인증 메모'], 'certificates'));
    assert.deepEqual(plain(bindings.quotationNoticeBindingFingerprint(unrelated, model.resolveQuotationExport(unrelated))), {});
    assert.equal(await model.quotationExportFingerprint(unrelated, 2), await earlierFingerprint(h, unrelated));
    assert.equal(h.network.length, 0);
  } finally { h.close(); }
});
