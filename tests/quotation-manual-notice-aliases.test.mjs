import test from 'node:test';
import assert from 'node:assert/strict';
import { mobileIntakeHarness } from './helpers/mobile-intake.mjs';
import { hubSchemaSnapshot, schemaCompanies } from './helpers/hub-schema.mjs';
const plain = value => JSON.parse(JSON.stringify(value));

for (const [nameKey, valueKey] of [['noticeName', 'noticeValue'], ['heading', 'body']]) test(`compiler-supported ${nameKey}/${valueKey} notices remain manual-only`, () => {
  const h = mobileIntakeHarness();
  try {
    const snap = hubSchemaSnapshot(schemaCompanies[0], '80719'), raw = JSON.parse(snap.schemaString);
    raw.properties.legalPage.properties = { notices: { type: 'array', allOf: ['재질', '출시년월', '세탁방법 및 취급시 주의사항'].map(name => ({ contains: { type: 'object', properties: {
      [nameKey]: { type: 'string', enum: [name] }, [valueKey]: { type: 'string' },
    } } })) } };
    const hubSchema = { ...snap, schemaString: JSON.stringify(raw), inputBindings: 'couplus-paths-v1' };
    const model = h.load('app/quotation-schema.ts'), bindings = h.load('app/quotation-notice-inputs.ts');
    const schema = model.getQuotationSchema('80719', snap.categoryPath, hubSchema);
    assert.deepEqual(plain(schema.unsupportedFields), []);
    const content = h.load('app/product-content.ts').emptyProductContent('p');
    content.label.material = { value: '자동 권한 아님', provenance: 'manual', updatedAt: '2026-10-06T00:00:00Z' };
    const optionsModel = h.load('app/product-options.ts');
    const options = optionsModel.applyOptionRows(optionsModel.emptyProductOptions('p'), ['red', 'blue'].map(id => ({ ...optionsModel.emptyOptionInput(id), included: true, originalName: id, unitCostCny: 4.5 })), '2026-10-06T00:00:00Z');
    const input = { categoryId: '80719', categoryPath: snap.categoryPath, hubSchema, content, options, settings: { ...h.settings, manufactureDatePreviousMonth: true }, product: {
      id: 'p', title: '상품', source_url: h.sourceUrl, source_price_cny: 4.5, supply_price: 3000, sale_price: 5000, msrp: 6500, exchange_rate: 350, supply_margin: 50, coupang_margin: 40, image_keys: '[]', created_at: '2026-10-06T00:00:00Z', updated_at: '2026-10-06T00:00:00Z',
    } };
    const automatic = model.resolveQuotationFields(input), helpers = h.load('app/option-label-fields.ts');
    const view = { revision: 0, contentRevision: 0, optionRevision: 0, productVersion: input.product.updated_at, inputFingerprint: 'a'.repeat(64), imageKeys: [], categoryContext: { categoryId: '80719' }, overrides: { common: {}, options: {} }, resolved: automatic, automatic };
    const fields = helpers.optionLabelFields(view);
    assert.equal(fields.length, 3, 'accepted compiler fields stay visible to humans');
    for (const field of fields) {
      assert.equal(bindings.isQuotationLegalNotice(field), true);
      assert.equal(bindings.quotationNoticeInput(field), undefined, 'alias never gains observed automatic source authority');
      assert.equal(automatic.rows.find(row => row.optionId === 'red').fields[field.id].value, '해당사항없음', field.label);
    }
    assert.equal(h.load('app/label-autofill.ts').labelDateNotice('80719', snap.categoryPath, hubSchema), false);
    const field = fields.find(item => item.label === '재질');
    const changes = helpers.optionLabelChanges(view, 'red', { [field.id]: '' });
    assert.deepEqual(plain(changes), [{ fieldKey: field.id, optionId: 'red', value: '' }]);
    const overrides = { common: { [field.id]: '공통 재질' }, options: { red: { [field.id]: '' }, blue: { [field.id]: '다른 옵션' } } };
    const resolved = model.resolveQuotationFields({ ...input, overrides });
    assert.equal(resolved.rows.find(row => row.optionId === 'red').fields[field.id].value, '');
    assert.equal(resolved.rows.find(row => row.optionId === 'blue').fields[field.id].value, '다른 옵션');
    const plan = h.load('app/quotation-label-plan.ts').quotationLabelPlan(resolved, 'red');
    assert.deepEqual(plain(plan.rows.find(row => row[0] === '재질')), ['재질', '[공란]']);
    for (const wire of [{ ...field.hubWire, path: ['legalPage', 'certificates'] }, { ...field.hubWire, name: '소재' }, { ...field.hubWire, nameKey: valueKey }, { ...field.hubWire, valueKey: '' }]) {
      assert.equal(bindings.isQuotationLegalNotice({ ...field, hubWire: wire }), false);
      assert.equal(bindings.quotationNoticeInput({ ...field, hubWire: wire }), undefined);
    }
    const duplicate = { ...view, resolved: { ...automatic, schema: { ...automatic.schema, fields: [...automatic.schema.fields, field] } } };
    assert.throws(() => helpers.optionLabelFields(duplicate), /연결을 하나로/);
    assert.equal(h.network.length, 0);
  } finally { h.close(); }
});
