import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { module, plain, syntheticSnapshot, apiFixture, companies } from './helpers/supplier-hub-single-projection.mjs';

const model = module('app/quotation-schema.ts');
const contentModel = module('app/product-content.ts'), optionModel = module('app/product-options.ts');
const settings = module('app/workspace-settings.ts').defaultSettings;
const timestamp = '2026-10-23T00:00:00.000Z';
function fixture(snapshot = syntheticSnapshot()) {
  const content = contentModel.emptyProductContent('paired-product');
  content.seo.title = { value: '합성 검토 상품', provenance: 'manual', updatedAt: timestamp };
  content.label.material = { value: '', provenance: 'manual', updatedAt: timestamp };
  content.assets.main.value = ['owner/main.png'];
  content.customLabels = [{ id: 'test-label', name: '검토 표시', value: '합성 값', visible: true }];
  const options = optionModel.applyOptionRows(optionModel.emptyProductOptions('paired-product'), ['one', 'two'].map((id, index) => ({
    ...optionModel.emptyOptionInput(id), originalName: '合成', translatedName: index ? '흰색' : '검정',
    color: index ? '흰색' : '검정', unitCostCny: 5, unitsPerPack: index + 1, included: true,
  })), timestamp);
  const policy = { exchangeRate: 200, supplyMargin: 55, coupangMargin: 0, minimumMargin: 0, msrpMultiple: 1, roundingUnit: 100 };
  return { categoryId: snapshot?.categoryId ?? '80719', categoryPath: snapshot?.categoryPath ?? [],
    ...(snapshot ? { hubSchema: snapshot } : {}), content, options, settings: { ...settings, brand: '합성 브랜드' },
    product: { id: 'paired-product', owner_id: 'owner', title: '合成', image_keys: '["owner/main.png"]',
      created_at: timestamp, updated_at: timestamp, source_price_cny: 5, supply_price: 1000, sale_price: 2000, msrp: 3000,
      pricing_policy: JSON.stringify(policy), exchange_rate: 200, supply_margin: 55, coupang_margin: 0 },
    overrides: { common: { brand: '', packagedWeightG: '420' }, options: { one: { title: '수동 옵션 상품명', color: '' } } } };
}
function legacyPair(input) {
  const automatic = { ...input }; delete automatic.overrides; delete automatic.packagingBasis;
  return { automatic: model.resolveQuotationFields(automatic), resolved: model.resolveQuotationFields(input) };
}
function parity(input) {
  const before = JSON.stringify(input), actual = model.resolveQuotationFieldsPair(input);
  assert.deepEqual(plain(actual), plain(legacyPair(input)));
  assert.equal(JSON.stringify(input), before, 'resolution must not mutate its inputs');
  return actual;
}

for (const company of companies) test(`paired resolution equals two legacy calls on recorded live schema (${company.code})`, () => {
  const categoryPath = ['패션의류잡화', '유니섹스/남녀공용 패션', '공용 잡화', '선글라스', '남녀공용패션선글라스'];
  const snapshot = { format: 'supplier-hub-schema-v1', categoryId: '69900', categoryPath, company, observedAt: Date.now(),
    draftInitialization: 'couplus-required-v1', settingsInitialization: 'couplus-options-v1', inputBindings: 'couplus-paths-v1',
    metadata: { displayCategoryCode: '69900', kanCategoryId: 2624, scopeType: 'Retail_Categorized_Single', noticeNumber: 4, version: 188 },
    schemaString: fs.readFileSync(new URL('../outputs/step573-live-69900-schema.json', import.meta.url), 'utf8') };
  const input = fixture(snapshot), paired = parity(input);
  assert.ok(paired.resolved.schema.fields.some(field => field.hubWire));
  assert.equal(paired.automatic.rows[0].fields.brand.value, '합성 브랜드');
  assert.equal(paired.resolved.rows[0].fields.brand.value, '');
  assert.equal(paired.resolved.rows[1].fields.title.value, '수동 옵션 상품명');
  delete input.overrides; parity(input);
});

test('automatic ignores overrides and packaging history while resolved retains manual blanks and stale-basis errors', () => {
  const input = fixture(null), packaging = module('app/quotation-packaging-basis.ts');
  const fields = model.getQuotationSchema(input.categoryId).fields;
  input.packagingBasis = packaging.applyQuotationPackagingBasis(undefined, fields, { one: 1, two: 2 }, [
    { fieldKey: 'packagedWeightG', optionId: null, value: '420' },
  ]);
  input.options.rows[0].unitsPerPack = 3;
  input.packagingBasis.common.packagedWeightG.nonMeasuredDraft = { origin: 'ai-estimate', measured: false };
  const pair = parity(input), automatic = pair.automatic.rows[1].fields, resolved = pair.resolved.rows[1].fields;
  assert.equal(automatic.noticeMaterial.value, '', 'manual content blanks also apply to automatic values');
  assert.equal(automatic.noticeMaterial.source, 'content');
  assert.equal(automatic.packagedWeightG.value, '');
  assert.equal(automatic.packagedWeightG.reviewMessages.some(message => message.includes('AI 추정값')), false);
  assert.equal(resolved.color.value, ''); assert.equal(resolved.color.source, 'manual-option');
  assert.equal(resolved.packagedWeightG.value, '420');
  assert.ok(resolved.packagedWeightG.validationIssues.some(packaging.isQuotationPackagingBasisIssue));
  assert.ok(resolved.packagedWeightG.reviewMessages.some(message => message.includes('AI 추정값')));
  input.packagingBasis.common.packagedWeightG.fieldSignature = 'changed schema'; parity(input);
  input.options.rows.forEach(option => { option.included = false; }); parity(input);
  input.options = optionModel.emptyProductOptions(input.product.id); parity(input);
});

test('both result graphs are independently mutable and cannot contaminate later calls', () => {
  const input = fixture(), pair = parity(input), baseline = plain(pair), inputBefore = JSON.stringify(input);
  const objects = (value, found = new Set()) => {
    if (value && typeof value === 'object' && !found.has(value)) { found.add(value); Object.values(value).forEach(child => objects(child, found)); }
    return found;
  };
  const automaticObjects = objects(pair.automatic);
  for (const value of objects(pair.resolved)) assert.equal(automaticObjects.has(value), false, 'views share a mutable object');
  pair.automatic.schema.categoryPath.push('changed');
  pair.automatic.schema.fields.find(field => field.choices?.length).choices[0].label = 'changed';
  pair.automatic.schema.fields.find(field => field.hubWire).hubWire.path.push('changed');
  pair.automatic.rows[0].fields.brand.issues.push('changed');
  pair.automatic.customLabels[0].value = 'changed';
  assert.deepEqual(plain(pair.resolved), baseline.resolved);
  const automaticAfter = plain(pair.automatic);
  pair.resolved.schema.fields[0].label = 'resolved changed'; pair.resolved.rows[0].fields.brand.value = 'resolved changed';
  assert.deepEqual(plain(pair.automatic), automaticAfter);
  assert.deepEqual(plain(model.resolveQuotationFieldsPair(input)), baseline);
  assert.equal(JSON.stringify(input), inputBefore);
});

test('a pair validates and compiles exactly once per invocation, without cross-call reuse', () => {
  const hub = module('app/supplier-hub-schema.ts'), compile = hub.compileHubQuotationSchema, validate = hub.validateHubSchemaSnapshot;
  let compilations = 0, validations = 0;
  hub.compileHubQuotationSchema = (...args) => { compilations++; return compile(...args); };
  hub.validateHubSchemaSnapshot = (...args) => { validations++; return validate(...args); };
  try {
    const input = fixture(); model.resolveQuotationFieldsPair(input);
    assert.equal(compilations, 1); assert.equal(validations, 1);
    model.resolveQuotationFieldsPair(input);
    assert.equal(compilations, 2); assert.equal(validations, 2);
    input.hubSchema = { ...input.hubSchema, schemaString: '{malformed' };
    assert.throws(() => model.resolveQuotationFieldsPair(input));
    assert.equal(validations, 3, 'each call validates its own supplied snapshot');
    assert.equal(compilations, 2, 'malformed snapshots never reach compilation');
  } finally { hub.compileHubQuotationSchema = compile; hub.validateHubSchemaSnapshot = validate; }
});

test('invalid packaging metadata is still rejected by both entry points', () => {
  const input = fixture(); input.packagingBasis = { version: 1, common: {}, options: {}, forged: true };
  assert.throws(() => model.resolveQuotationFields(input), /포장값/);
  assert.throws(() => model.resolveQuotationFieldsPair(input), /포장값/);
});

test('snapshot retains identical values/fingerprint and its final source-conflict fence', async () => {
  const f = await apiFixture();
  try {
    const resolver = f.h.load('app/quotation-schema.ts'), pair = resolver.resolveQuotationFieldsPair;
    const snapshot = f.h.load('app/quotation-fields-snapshot.ts'), store = f.h.load('db/quotation-fields.ts');
    const before = f.state(), actual = await snapshot.stableQuotationFieldsView('owner', f.id, f.profile.id);
    try {
      resolver.resolveQuotationFieldsPair = input => {
        const automatic = { ...input }; delete automatic.overrides; delete automatic.packagingBasis;
        return { automatic: resolver.resolveQuotationFields(automatic), resolved: resolver.resolveQuotationFields(input) };
      };
      const legacy = await snapshot.stableQuotationFieldsView('owner', f.id, f.profile.id);
      assert.deepEqual(plain(actual), plain(legacy), 'includes inputFingerprint and source guard');
    } finally { resolver.resolveQuotationFieldsPair = pair; }
    assert.equal(f.state(), before); assert.equal(f.h.network.length, 0);
    const current = store.quotationSourcesCurrent; let fences = 0;
    store.quotationSourcesCurrent = async (...args) => { fences++; assert.equal(await current(...args), true); return false; };
    try {
      await assert.rejects(() => snapshot.stableQuotationFieldsView('owner', f.id, f.profile.id), error => error.status === 409 && error.code === 'QUOTATION_FIELDS_CONFLICT');
      assert.equal(fences, 1);
    } finally { store.quotationSourcesCurrent = current; }
    assert.equal(f.state(), before);
  } finally { f.close(); }
});
