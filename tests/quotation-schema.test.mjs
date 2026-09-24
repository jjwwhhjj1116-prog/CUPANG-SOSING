import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import ts from 'typescript';

const cache = new Map();
function load(file) {
  if (cache.has(file)) return cache.get(file);
  const exports = {};
  const compiled = ts.transpileModule(fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(compiled, { exports, structuredClone, TextEncoder, require(name) {
    if (name.startsWith('./')) return load(path.posix.join(path.posix.dirname(file), name) + '.ts');
    if (!name.startsWith('@/app/')) throw Error(name);
    return load(name.slice(2) + '.ts');
  } });
  cache.set(file, exports); return exports;
}
const model = load('app/quotation-schema.ts');
const contentModel = load('app/product-content.ts');
const optionModel = load('app/product-options.ts');
const settingsModel = load('app/workspace-settings.ts');
const clone = value => JSON.parse(JSON.stringify(value));
const policy = { exchangeRate: 200, supplyMargin: 55, coupangMargin: 0, minimumMargin: 0, msrpMultiple: 1, roundingUnit: 100 };
const product = { id: 'p1', owner_id: 'owner', title: '수집한 가방', source_price_cny: 999, supply_price: 111, sale_price: 222, msrp: 333,
  pricing_policy: JSON.stringify(policy), exchange_rate: 200, supply_margin: 55, coupang_margin: 0, image_keys: JSON.stringify(['owner/main.png', 'owner/option.png', 'owner/detail.png']) };
function fixture() {
  const content = contentModel.emptyProductContent('p1');
  content.seo.title.value = '번역된 가방'; content.seo.keywords.value = ['가방', '대용량'];
  content.seo.description.value = '<script>alert("x")</script>\n제품 설명';
  content.label.model.value = 'A-100'; content.label.manufacturer.value = '실제 제조사';
  content.label.material.value = '면'; content.label.dimensions.value = '20 × 30 × 40 cm';
  content.assets.main.value = ['owner/main.png']; content.assets.detail.value = ['owner/detail.png'];
  const option = { ...optionModel.emptyOptionInput('red'), originalName: '红', translatedName: '빨강', unitCostCny: 4.5, included: true,
    widthCm: 20, lengthCm: 30, heightCm: 40, weightKg: 0.3, imageKey: 'owner/option.png' };
  const options = optionModel.applyOptionRows(optionModel.emptyProductOptions('p1'), [option], '2026-09-22T12:00:00.000Z');
  return { categoryId: '80719', product: clone(product), content, settings: { ...settingsModel.defaultSettings, brand: '입력 브랜드', manufacturer: '기본 제조사', importer: '수입사', boxSkuQuantity: 50 }, options };
}
const context = (input = fixture()) => ({ schema: model.getQuotationSchema(input.categoryId), optionIds: input.options.rows.map(row => row.id), ownedImageKeys: JSON.parse(input.product.image_keys), overrides: input.overrides });
const change = (fieldKey, value, optionId = null) => ({ fieldKey, value, optionId });

test('81452 follows official empty select values, required attributes, option cap, price and barcode rules', () => {
  const input = fixture(); input.categoryId = '81452';
  const schema = model.getQuotationSchema('81452');
  const evidence = JSON.parse(fs.readFileSync(new URL('../docs/supplier-hub-81452-product-2026-09-24.json', import.meta.url), 'utf8'));
  const selects = schema.fields.filter(field => field.id.startsWith('brace_') && field.type === 'select');
  assert.equal(selects.length, 7);
  selects.forEach((field, index) => assert.deepEqual(clone(field.choices), evidence.selects[index]));
  for (const key of ['color', 'quantity', 'size', 'supplyPrice', 'salePrice']) assert.equal(schema.fields.find(field => field.id === key).required, true);
  assert.equal(schema.fields.find(field => field.id === 'searchTags').required, false);
  assert.equal(model.quotationOptionLimitIssue(schema, 100), null);
  assert.match(model.quotationOptionLimitIssue(schema, 101), /100/);
  assert.ok(model.quotationPriceIssues(schema, '5000', '4999').length);
  const ctx = { ...context(input), schema };
  assert.throws(() => model.validateQuotationChanges([change('barcodeMode', 'existing'), change('barcode', 'bad')], ctx), /바코드/);
  assert.throws(() => model.validateQuotationChanges([change('brace_direction', '해당사항없음')], ctx), /선택/);
  assert.equal(model.validateQuotationChanges([change('brace_direction', '')], ctx)[0].value, '');
  input.overrides = { common: { brace_direction: '해당사항없음' }, options: {} };
  const previous = model.resolveQuotationFields(input).rows[1].fields.brace_direction;
  assert.equal(previous.value, '해당사항없음'); assert.ok(previous.issues.some(issue => issue.includes('선택')));
});

test('observed brace quotation exposes its own attributes and notices without certifying saved example values', () => {
  const input = fixture(); input.categoryId = '81452';
  const resolved = model.resolveQuotationFields(input);
  const schema = resolved.schema;
  assert.equal(schema.status, 'observed'); assert.equal(schema.submissionReady, false);
  assert.equal(schema.categoryPath.at(-1), '헬스보호대');
  assert.equal(schema.fields.filter(field => field.visibility === 'hidden').length, 10);
  assert.equal(schema.fields.filter(field => field.section === 'legal' && (field.id.startsWith('notice') || field.id.startsWith('brace_notice'))).length, 12);
  assert.deepEqual(clone(schema.fields.find(field => field.id === 'brace_direction').choices.map(choice => choice.label)), ['좌우겸용', '오른쪽', '왼쪽', '좌우세트', '해당사항없음']);
  assert.equal(resolved.rows[1].fields.brace_purpose.value, '');
  assert.equal(resolved.rows[1].fields.brace_noticeKc.value, '');
  assert.equal(resolved.rows[1].fields.noticeMaterial.value, '면');
  assert.equal(resolved.rows[1].fields.quantity.value, '1');
  assert.equal(schema.fields.some(field => field.id === 'kcsCertificationNumber'), false);
  const ctx = { ...context(input), schema };
  assert.throws(() => model.validateQuotationChanges([change('brace_direction', '추정값')], ctx), /선택/);
  input.overrides = model.applyQuotationChanges(model.emptyQuotationOverrides(), [change('brace_direction', '좌우겸용'), change('brace_noticeKc', '', 'red')]);
  const final = model.resolveQuotationFields(input);
  assert.equal(final.rows[1].fields.brace_direction.value, '좌우겸용');
  assert.equal(final.rows[1].fields.brace_noticeKc.source, 'manual-option');
  const exported = load('app/exports/quotation-fields.ts').resolvedQuotationRows(input, final, [
    { key: 'owner/main.png', name: 'assets/main.png' }, { key: 'owner/option.png', name: 'assets/option.png' }, { key: 'owner/detail.png', name: 'assets/detail.png' },
  ]);
  assert.equal(exported[0].brace_direction, '좌우겸용');
  assert.equal(exported[0].brace_noticeKc, '');
  assert.equal(exported[0].noticeMaterial, '면');
});

test('brace size and weight notice follows label edits through export while preserving manual blanks', () => {
  const input = fixture(); input.categoryId = '81452';
  input.content.label.dimensions = { value: '허리둘레 70~85 cm / 180 g', provenance: 'manual', updatedAt: 'now' };
  const original = clone(input);
  const resolve = () => model.resolveQuotationFields(input);
  assert.equal(resolve().rows[1].fields.size.value, '');
  assert.ok(resolve().rows[1].fields.size.issues.length > 0);
  assert.equal(resolve().rows[1].fields.brace_noticeSizeWeight.value, '허리둘레 70~85 cm / 180 g');
  assert.equal(resolve().rows[1].fields.brace_noticeSizeWeight.source, 'content');
  const exported = load('app/exports/quotation-fields.ts').resolvedQuotationRows(input, resolve(), [
    { key: 'owner/main.png', name: 'assets/main.png' }, { key: 'owner/option.png', name: 'assets/option.png' }, { key: 'owner/detail.png', name: 'assets/detail.png' },
  ]);
  assert.equal(exported[0].brace_noticeSizeWeight, '허리둘레 70~85 cm / 180 g');
  assert.deepEqual(clone(input), original);
  input.content.label.dimensions.value = '';
  assert.equal(resolve().rows[1].fields.brace_noticeSizeWeight.value, '');
  input.overrides = { common: { brace_noticeSizeWeight: '공통 크기' }, options: { red: { brace_noticeSizeWeight: '' } } };
  assert.equal(resolve().rows[0].fields.brace_noticeSizeWeight.value, '공통 크기');
  assert.equal(resolve().rows[1].fields.brace_noticeSizeWeight.source, 'manual-option');
  assert.equal(resolve().rows[1].fields.brace_noticeSizeWeight.value, '');
  input.content.label.certification.value = '일반 허가사항';
  assert.equal(resolve().rows[1].fields.brace_noticeKc.value, '');
  input.overrides.options.red.size = 'S';
  assert.equal(resolve().rows[1].fields.size.value, 'S');
  assert.equal(resolve().rows[1].fields.size.source, 'manual-option');
  const kitchen = fixture();
  assert.equal(model.resolveQuotationFields(kitchen).rows[1].fields.size.value, '20 × 30 × 40 cm');
});

test('structured option color and size reach quotation and export while old clients and manual blanks preserve edits', () => {
  const input = fixture(); input.categoryId = '81452';
  const rows = optionModel.optionInputs(input.options);
  rows[0].color = '검정'; rows[0].size = 'S';
  input.options = optionModel.applyOptionRows(input.options, rows, 'attributes');
  const resolved = model.resolveQuotationFields(input);
  assert.equal(resolved.rows[1].fields.color.value, '검정');
  assert.equal(resolved.rows[1].fields.brace_noticeColor.value, '검정');
  assert.equal(resolved.rows[1].fields.size.value, 'S');
  const exported = load('app/exports/quotation-fields.ts').resolvedQuotationRows(input, resolved, [
    { key: 'owner/main.png', name: 'assets/main.png' }, { key: 'owner/option.png', name: 'assets/option.png' }, { key: 'owner/detail.png', name: 'assets/detail.png' },
  ]);
  assert.equal(exported[0].color, '검정'); assert.equal(exported[0].size, 'S');
  const kitchen = model.resolveQuotationFields({ ...input, categoryId: '80719' });
  assert.equal(kitchen.rows[1].fields.size.value, 'S');
  assert.equal(kitchen.rows[1].fields.noticeDimensions.value, '20 × 30 × 40 cm');
  const oldRows = optionModel.optionInputs(input.options);
  delete oldRows[0].color; delete oldRows[0].size;
  const body = { expectedRevision: 1, expectedProductVersion: '2026-09-24T00:00:00Z', rows: oldRows };
  const validated = optionModel.validateOptionsInput(body, 'owner', JSON.parse(product.image_keys));
  const retained = optionModel.applyOptionRows(input.options, validated.rows, 'old-client');
  assert.equal(retained.rows[0].color, '검정'); assert.equal(retained.rows[0].size, 'S');
  const cleared = optionModel.optionInputs(retained); cleared[0].color = ''; cleared[0].size = '';
  input.options = optionModel.applyOptionRows(retained, cleared, 'cleared');
  for (const key of ['color', 'size']) {
    assert.equal(input.options.rows[0].provenance[key], 'manual');
    assert.equal(model.resolveQuotationFields(input).rows[1].fields[key].value, '');
    assert.throws(() => optionModel.validateOptionsInput({ ...body, rows: [{ ...cleared[0], [key]: 'x'.repeat(201) }] }, 'owner', JSON.parse(product.image_keys)));
  }
  input.overrides = { common: { size: 'M' }, options: { red: { color: '흰색' } } };
  assert.equal(model.resolveQuotationFields(input).rows[1].fields.size.value, 'M');
  assert.equal(model.resolveQuotationFields(input).rows[1].fields.color.value, '흰색');
});

test('reviewed attribute translation reaches saved quotation and Excel rows', () => {
  const input = fixture(); input.categoryId = '81452';
  input.options.rows[0].color = '黑色'; input.options.rows[0].size = '小号';
  input.options.rows[0].provenance.color = 'collected'; input.options.rows[0].provenance.size = 'collected';
  const translation = load('app/option-translation.ts');
  const attributes = translation.optionTranslationAttributes(input.options);
  const job = { productId: 'p1', productVersion: 'current', status: 'completed', review: { source: { attributes } },
    result: { draft: { attributes: attributes.map((item, sourceIndex) => ({ sourceIndex, name: 'ignored', value: item.name.startsWith('option-color:') ? '검정' : '소형' })) } } };
  const adopted = translation.adoptOptionTranslations(input.options, job, 'current');
  input.options = optionModel.applyOptionRows(input.options, adopted.rows, 'saved');
  const resolved = model.resolveQuotationFields(input);
  assert.equal(resolved.rows[1].fields.color.value, '검정');
  assert.equal(resolved.rows[1].fields.brace_noticeColor.value, '검정');
  assert.equal(resolved.rows[1].fields.size.value, '소형');
  const exported = load('app/exports/quotation-fields.ts').resolvedQuotationRows(input, resolved, [
    { key: 'owner/main.png', name: 'assets/main.png' }, { key: 'owner/option.png', name: 'assets/option.png' }, { key: 'owner/detail.png', name: 'assets/detail.png' },
  ]);
  assert.equal(exported[0].color, '검정'); assert.equal(exported[0].size, '소형');
});

test('deleted or fully excluded options never resurrect the representative quotation row', () => {
  const input = fixture();
  input.overrides = { common: { title: '보존할 공통값' }, options: { red: { model: '보존할 옵션값' } } };
  const original = clone(input);
  for (const options of [
    optionModel.applyOptionRows(input.options, [], 'deleted'),
    { ...input.options, rows: input.options.rows.map(row => ({ ...row, included: false })) },
  ]) {
    const resolved = model.resolveQuotationFields({ ...input, options });
    assert.equal(resolved.rows.some(row => row.included), false);
    assert.equal(resolved.rows[0].fields.title.value, '보존할 공통값');
    assert.match(resolved.issues.join(' '), /포함할 옵션/);
    assert.throws(() => load('app/exports/quotation-fields.ts').resolvedQuotationRows({ ...input, options }, resolved, []), /포함할 옵션/);
  }
  assert.equal(model.resolveQuotationFields({ ...input, options: optionModel.emptyProductOptions('p1') }).rows[0].included, true);
  assert.equal(model.resolveQuotationFields(input).rows[1].included, true);
  assert.deepEqual(clone(input), original);
});

test('cleared saved label facts stay empty in quotation cells and exported Excel mappings',()=>{
 const input=fixture();
 const keys=['manufacturer','importer','contact','countryOfOrigin','material','qualityAssurance','productName','model'];
 const initial=Object.fromEntries(keys.map(key=>[key,'이전 입력']));
 input.content=contentModel.applyContentPatch(input.content,{label:initial},'before');
 input.content=contentModel.applyContentPatch(input.content,{label:Object.fromEntries(keys.map(key=>[key,'']))},'after');
 const resolved=model.resolveQuotationFields(input);
 for(const row of resolved.rows) for(const key of ['manufacturer','noticeManufacturerImporter','noticeServiceContact','noticeCountryOfOrigin','noticeMaterial','noticeQualityAssurance','noticeNameModel','model']){
  assert.equal(row.fields[key].value,'',key);assert.equal(row.fields[key].source,'content',key);
 }
 const {resolvedQuotationRows}=load('app/exports/quotation-fields.ts');
 const rows=resolvedQuotationRows({...input,profile:null},resolved,[{key:'owner/option.png',name:'assets/option.png'},{key:'owner/main.png',name:'assets/main.png'},{key:'owner/detail.png',name:'assets/detail.png'}]);
 assert.equal(rows[0].manufacturer,'');assert.equal(rows[0].importer,'');assert.equal(rows[0].serviceContact,'');assert.equal(rows[0].countryOfOrigin,'');assert.equal(rows[0].material,'');
});

test('untouched label blanks still inherit settings and observed category defaults',()=>{
 const input=fixture();input.content=contentModel.emptyProductContent('p1');
 const row=model.resolveQuotationFields(input).rows[1];
 assert.equal(row.fields.manufacturer.value,input.settings.manufacturer);
 assert.equal(row.fields.noticeManufacturerImporter.value,'제조자: 기본 제조사 / 수입자: 수입사');
 assert.equal(row.fields.noticeCountryOfOrigin.value,'해당사항없음');
 input.overrides={common:{manufacturer:'견적에서 수정'},options:{}};
 input.content.label.manufacturer={value:'',provenance:'manual',updatedAt:'now'};
 assert.equal(model.resolveQuotationFields(input).rows[1].fields.manufacturer.value,'견적에서 수정');
});

test('observed Couplus defaults fill only 80719 missing fields and preserve source edits',()=>{
 const input=fixture();let row=model.resolveQuotationFields(input).rows[1];
 for(const [id,value] of Object.entries({taxType:'과세',barcodeMode:'request-coupang',shelfLifeDays:'0',handlingReason:'해당사항없음',color:'해당사항없음',noticeCountryOfOrigin:'해당사항없음'})){
  assert.equal(row.fields[id].value,value);assert.equal(row.fields[id].source,'couplus-default');assert.equal(row.fields[id].needsReview,true);
 }
 assert.equal(row.fields.lidIncluded.value,'');assert.equal(row.fields.lidIncluded.source,'couplus-default');
 assert.equal(row.fields.quantity.value,'1');assert.equal(row.fields.noticeMaterial.value,'면');
 input.content.label.countryOfOrigin.value='중국';input.content.seo.title.value='수정 상품명';input.content.assets.detail.value=['owner/detail.png'];
 row=model.resolveQuotationFields(input).rows[1];assert.equal(row.fields.noticeCountryOfOrigin.value,'중국');assert.equal(row.fields.title.value,'수정 상품명');assert.equal(row.fields.detailImages.value,'owner/detail.png');
 input.overrides={common:{taxType:'면세',handlingReason:''},options:{red:{taxType:'영세'}}};row=model.resolveQuotationFields(input).rows[1];
 assert.equal(row.fields.taxType.value,'영세');assert.equal(row.fields.handlingReason.value,'');assert.equal(row.fields.handlingReason.source,'manual-common');
 input.categoryId='unknown';input.overrides=undefined;row=model.resolveQuotationFields(input).rows[1];assert.equal(row.fields.taxType.value,'');assert.equal(row.fields.kcMarkType.value,'');
});

test('observed category defaults never replace missing package measurements or missing image files',()=>{
 const input=fixture();input.content=contentModel.emptyProductContent('p1');input.options.rows[0].imageKey=null;
 const row=model.resolveQuotationFields(input).rows[1];
 for(const id of ['mainImage','additionalImages','labelImages','detailImages','packagedWeightG','packagedDimensionsMm'])assert.equal(row.fields[id].value,'');
});

test('all 22 official kitchen-storage schemas match independently recorded option columns, choices and notice order', () => {
  const evidence = JSON.parse(fs.readFileSync(new URL('../docs/supplier-hub-product-schemas-2026-09-23.json', import.meta.url), 'utf8'));
  assert.equal(evidence.records.length, 22);
  const profileModel = load('app/category-profiles.ts');
  for (const record of evidence.records) {
    const schema = model.getQuotationSchema(record.categoryId);
    assert.equal(schema.status, 'observed'); assert.equal(schema.submissionReady, false);
    assert.deepEqual(clone(schema.categoryPath), record.path);
    const exposed = record.columns.slice(0, record.columns.findIndex(column => column.label === '공급가 *'));
    assert.deepEqual(clone(schema.fields.filter(field => field.visibility === 'exposed').map(field => ({label: field.label, required: field.required}))), exposed.map(column => ({label: column.label.replace(/\s*\*\s*$/, ''), required: column.label.endsWith('*')})));
    const hidden = schema.fields.filter(field => field.visibility === 'hidden');
    assert.deepEqual(clone(hidden.map(field => field.label)), record.hidden.map(field => field.label));
    for (let i = 0; i < hidden.length; i++) {
      assert.equal(hidden[i].type, record.hidden[i].type === 'select' ? 'select' : 'text');
      assert.deepEqual(clone(hidden[i].choices ?? []), record.hidden[i].choices ?? []);
    }
    assert.deepEqual(clone(schema.fields.filter(field => field.id.startsWith('notice')).map(field => field.label)), record.noticeLabels);
    assert.equal(schema.maxIncludedOptions, 100);
    assert.equal(schema.salePriceMustCoverSupply, true);
    assert.equal(new Set(schema.fields.map(field => field.id)).size, schema.fields.length);
    for (const field of schema.fields) assert.ok(Object.hasOwn(profileModel.categoryFields, field.id), `${record.categoryId}/${field.id} must export`);
  }
});

test('category-specific values cannot leak between same-named attributes; unknown categories stay unconfirmed', () => {
  const a = model.getQuotationSchema('80714'); const b = model.getQuotationSchema('80715');
  assert.ok(!a.fields.some(field => field.id === 'size'));
  assert.ok(b.fields.some(field => field.id === 'size'));
  const fieldA = a.fields.find(field => field.visibility === 'hidden' && field.label === '설치 유형');
  const fieldB = b.fields.find(field => field.visibility === 'hidden' && field.label === '설치 유형');
  assert.notEqual(fieldA.id, fieldB.id);
  const input = fixture(); input.categoryId = '80715';
  input.overrides = {common: {[fieldA.id]: fieldA.choices.find(choice => choice.value).value}, options: {}};
  const row = model.resolveQuotationFields(input).rows[1];
  assert.equal(row.fields[fieldA.id], undefined); assert.equal(row.fields[fieldB.id].value, '');
  assert.throws(() => model.validateQuotationChanges([change(fieldA.id, '')], context(input)), /견적 필드/);
  for (const id of ['unobserved-category', '__proto__', 'constructor']) assert.equal(model.getQuotationSchema(id).status, 'unconfirmed');
});

test('official price relationship uses final option overrides and never silently adjusts entered prices', () => {
  const input = fixture(); input.categoryId = '80714';
  input.overrides = {common: {supplyPrice: '5000', salePrice: '4500'}, options: {red: {salePrice: '6000'}}};
  let rows = model.resolveQuotationFields(input).rows;
  assert.ok(rows[0].fields.salePrice.issues.some(issue => issue.includes('공급가보다')));
  assert.equal(rows[0].fields.salePrice.value, '4500');
  assert.ok(!rows[1].fields.salePrice.issues.some(issue => issue.includes('공급가보다')));
  input.overrides.options.red.salePrice = '4999'; rows = model.resolveQuotationFields(input).rows;
  assert.ok(rows[1].fields.salePrice.issues.some(issue => issue.includes('공급가보다')));
  assert.equal(rows[1].fields.salePrice.value, '4999');
  assert.equal(model.quotationPriceIssues(model.getQuotationSchema('80714'), '5000', '5000').length, 0);
});

test('observed screenshot schema has five sections, all 80719 attributes and keeps unsupported categories separate', () => {
  const known = model.getQuotationSchema('80719');
  assert.equal(known.status, 'observed'); assert.equal(known.submissionReady, false);
  assert.deepEqual(clone(known.categoryPath), ['주방용품', '주방수납/정리', '주방수납바구니/바스켓']);
  assert.deepEqual([...new Set(known.fields.map(field => field.section))], ['start', 'product', 'image', 'legal', 'logistics']);
  assert.equal(known.fields.filter(field => field.visibility === 'exposed').length, 3);
  assert.equal(known.fields.filter(field => field.visibility === 'hidden').length, 28);
  for (const key of ['manufacturerPartNumber', 'noticeImportDeclaration', 'kcMarkType', 'packagedDimensionsMm', 'detailHtml']) assert.ok(known.fields.some(field => field.id === key));
  const unknown = model.getQuotationSchema('123', ['다른', '분류']);
  assert.equal(unknown.status, 'unconfirmed'); assert.deepEqual(clone(unknown.categoryPath), ['다른', '분류']);
  assert.ok(unknown.fields.every(field => field.visibility === 'common'));
  assert.ok(!unknown.fields.some(field => ['color', 'basketShape', 'noticeImportDeclaration'].includes(field.id)));
  known.fields[0].label = 'changed'; assert.equal(model.getQuotationSchema('80719').fields[0].label, '상품명');
});

test('resolver connects saved SEO/settings/options/images and computes option-specific prices without rounding regression', () => {
  const result = model.resolveQuotationFields(fixture());
  assert.equal(result.rows.length, 2); assert.equal(result.rows[0].optionId, null); assert.equal(result.rows[0].included, false);
  const row = result.rows[1]; assert.equal(row.included, true); assert.equal(row.fields.title.value, '번역된 가방'); assert.equal(row.fields.title.source, 'content');
  assert.equal(row.fields.manufacturer.value, '실제 제조사'); assert.equal(row.fields.brand.value, '입력 브랜드'); assert.equal(row.fields.brand.needsReview, true);
  assert.equal(row.fields.supplyPrice.value, '2000'); assert.equal(row.fields.supplyPrice.source, 'pricing');
  assert.equal(result.rows[0].fields.supplyPrice.value, '111');
  assert.equal(row.fields.mainImage.value, 'owner/option.png'); assert.equal(row.fields.mainImage.source, 'option');
  assert.equal(row.fields.quantity.value, '1'); assert.equal(row.fields.size.value, '20 × 30 × 40 cm');
  assert.equal(row.fields.boxSkuQuantity.value, '50');
  assert.match(row.fields.detailHtml.value, /&lt;script&gt;/); assert.ok(!row.fields.detailHtml.value.includes('<script>')); assert.match(row.fields.detailHtml.value, /<br>/);
});

test('unknown legal applicability and packaged measurements remain empty instead of copying product dimensions or treating zero as absent', () => {
  const input = fixture(); const row = model.resolveQuotationFields(input).rows[1];
  for (const key of ['packagedWeightG', 'packagedDimensionsMm']) {
    assert.equal(row.fields[key].value, '', key); assert.equal(row.fields[key].needsReview, true, key);
  }
  const edits = model.validateQuotationChanges([change('shelfLifeDays', '0'), change('kcMarkType', '해당사항없음'), change('handlingReason', '유리')], context(input));
  input.overrides = model.applyQuotationChanges(model.emptyQuotationOverrides(), edits);
  const edited = model.resolveQuotationFields(input).rows[1];
  assert.equal(edited.fields.shelfLifeDays.value, '0'); assert.equal(edited.fields.kcMarkType.value, '해당사항없음');
  assert.equal(edited.fields.kcMarkType.source, 'manual-common'); assert.equal(edited.fields.kcMarkType.needsReview, true);
});

test('manual option > common > auto; explicit empty remains, clear restores fallback, common edits apply to future options', () => {
  const input = fixture(); const current = model.emptyQuotationOverrides();
  const edits = model.validateQuotationChanges([change('brand', '공통 수정'), change('brand', '', 'red')], context(input));
  input.overrides = model.applyQuotationChanges(current, edits);
  assert.equal(Object.keys(current.common).length, 0);
  let resolved = model.resolveQuotationFields(input); assert.equal(resolved.rows[0].fields.brand.value, '공통 수정'); assert.equal(resolved.rows[1].fields.brand.value, '');
  assert.equal(resolved.rows[1].fields.brand.source, 'manual-option');
  input.options.rows.push({ ...input.options.rows[0], id: 'blue', translatedName: '파랑' });
  resolved = model.resolveQuotationFields(input); assert.equal(resolved.rows[2].fields.brand.value, '공통 수정');
  input.overrides = model.applyQuotationChanges(input.overrides, [change('brand', null, 'red')]);
  assert.equal(model.resolveQuotationFields(input).rows[1].fields.brand.value, '공통 수정');
  input.overrides = model.applyQuotationChanges(input.overrides, [change('brand', null)]);
  assert.equal(model.resolveQuotationFields(input).rows[1].fields.brand.value, '입력 브랜드');
});

test('validation rejects unknown field/option/category mutation, duplicate edits and invalid inputs while preserving draft blanks', () => {
  for (const edits of [[change('injected', 'x')], [change('brand', 'x', 'foreign')], [change('category', '123')], [change('__proto__', 'x')],
    [change('brand', 'a'), change('brand', 'b')], [change('brand', 12)], [change('brand', 'a\u0000b')], [change('brand', ' '.repeat(501))],
    [change('model', '가'.repeat(51))], [change('searchTags', 'a'.repeat(21))], [change('searchTags', Array(16).fill('가나다라마바사아자차').join(','))],
    [change('packagedWeightG', '0.3')], [change('packagedWeightG', '-1')], [change('packagedDimensionsMm', '1.5*20*30')],
    [change('packagedDimensionsMm', '10*20')], [change('shelfLifeDays', '-1')], [change('taxType', 'unknown')], [change('supplyPrice', '1e3')]]) {
    assert.throws(() => model.validateQuotationChanges(edits, context()));
  }
  assert.equal(model.validateQuotationChanges([change('title', '')], context())[0].value, '');
  assert.equal(model.validateQuotationChanges([change('packagedDimensionsMm', '200*300*400'), change('packagedWeightG', '350')], context()).length, 2);
});

test('missing or unowned images cannot be silently emitted as valid private keys or invented public links', () => {
  const input = fixture(); input.options.rows[0].imageKey = 'other/private.png'; input.content.assets.detail.value.push('owner/deleted.png');
  const row = model.resolveQuotationFields(input).rows[1];
  assert.equal(row.fields.mainImage.value, ''); assert.ok(row.fields.mainImage.issues.some(issue => issue.includes('제외')));
  assert.equal(row.fields.detailImages.value, 'owner/detail.png'); assert.equal(row.fields.detailImages.needsReview, true);
  for (const value of ['other/private.png', 'https://example.com/image.png', 'owner/main.png\nowner/main.png']) assert.throws(() => model.validateQuotationChanges([change('mainImage', value)], context(input)));
  assert.equal(model.validateQuotationChanges([change('mainImage', 'owner/main.png')], context(input))[0].value, 'owner/main.png');
  input.product.image_keys = '{}'; assert.ok(model.resolveQuotationFields(input).issues.some(issue => issue.includes('이미지 목록')));
});

test('auto oversized SEO is flagged, not truncated, and barcode conflicts stay reviewable', () => {
  const input = fixture(); input.content.seo.keywords.value = ['가'.repeat(30)];
  input.overrides = { common: { barcodeMode: 'request-coupang', barcode: '12345678' }, options: {} };
  let row = model.resolveQuotationFields(input).rows[0];
  assert.equal(row.fields.searchTags.value, '가'.repeat(30)); assert.ok(row.fields.searchTags.issues.some(issue => issue.includes('20자')));
  assert.ok(row.fields.barcode.issues.some(issue => issue.includes('충돌')));
  input.overrides.common = { barcodeMode: 'existing' }; row = model.resolveQuotationFields(input).rows[0];
  assert.ok(row.fields.barcode.issues.some(issue => issue.includes('실제 바코드')));
});

test('common row is the only export row without options; excluded options stay editable and have no fabricated prices', () => {
  const input = fixture(); input.options.rows[0].included = false; input.options.rows[0].unitCostCny = null;
  let result = model.resolveQuotationFields(input); assert.equal(result.rows.filter(row => row.included).length, 0);
  assert.equal(result.rows[1].fields.supplyPrice.value, ''); assert.ok(result.rows[1].fields.supplyPrice.issues.length);
  input.options = optionModel.emptyProductOptions('p1'); result = model.resolveQuotationFields(input); assert.equal(result.rows.length, 1); assert.equal(result.rows[0].included, true);
  input.categoryId = 'unknown'; result = model.resolveQuotationFields(input); assert.equal(result.schema.status, 'unconfirmed'); assert.equal(result.rows[0].fields.color, undefined);
});

test('Supplier Hub Product Page select values exactly match observed DOM including one empty N/A choice',()=>{
  const observed=JSON.parse(fs.readFileSync(new URL('../docs/supplier-hub-80719-product-fields-2026-09-22.json',import.meta.url),'utf8'));
  const schema=model.getQuotationSchema('80719');assert.equal(observed.fields.length,20);
  for(const documented of observed.fields){
    const field=schema.fields.find(field=>field.id===documented.id);assert.equal(field.type,'select',documented.id);
    assert.deepEqual(clone(field.choices),documented.options.map(({label,value})=>({label,value})),documented.id);
    assert.equal(field.choices.filter(choice=>choice.value==='').length,1);assert.equal(field.choices.find(choice=>choice.value==='').label,'해당사항없음');
  }
  const transparent=schema.fields.find(field=>field.id==='transparent');assert.ok(transparent.choices.some(choice=>choice.value==='해당없음'));
  assert.equal(schema.fields.find(field=>field.id==='totalQuantity').type,'text');
  for(const id of observed.exposedRequired){const field=schema.fields.find(field=>field.id===id);assert.equal(field.required,true);assert.ok(model.quotationValueIssues(field,'').some(issue=>issue.includes('필수')));}
  assert.match(schema.evidence,/Supplier Hub 공식 화면/);assert.match(schema.evidence,/이미지·인증·물류/);assert.equal(schema.submissionReady,false);
  assert.ok(model.getQuotationSchema('not-80719').fields.every(field=>field.visibility==='common'));
});

test('out-of-list saved material stays unchanged and blank official choices remain manual drafts without generating legal N/A',()=>{
  const input=fixture();let row=model.resolveQuotationFields(input).rows[1];
  assert.equal(row.fields.storageMaterial.value,'면');assert.equal(row.fields.storageMaterial.source,'content');assert.ok(row.fields.storageMaterial.issues.some(issue=>issue.includes('선택값')));
  assert.throws(()=>model.validateQuotationChanges([change('storageMaterial','면')],context(input)),/선택값/);
  input.overrides=model.applyQuotationChanges(model.emptyQuotationOverrides(),model.validateQuotationChanges([change('storageMaterial',''),change('color',''),change('quantity',''),change('size','')],context(input)));
  row=model.resolveQuotationFields(input).rows[1];assert.equal(row.fields.storageMaterial.value,'');assert.equal(row.fields.storageMaterial.source,'manual-common');
  for(const id of ['color','quantity','size']){assert.equal(row.fields[id].value,'');assert.equal(row.fields[id].source,'manual-common');assert.ok(row.fields[id].issues.some(issue=>issue.includes('필수')));}
  assert.equal(row.fields.kcMarkType.value,'해당사항없음');assert.equal(row.fields.kcMarkType.source,'couplus-default');assert.equal(row.fields.noticeCountryOfOrigin.value,'해당사항없음');
  input.overrides=model.applyQuotationChanges(input.overrides,[change('storageMaterial',null)]);row=model.resolveQuotationFields(input).rows[1];assert.equal(row.fields.storageMaterial.value,'면');assert.ok(row.fields.storageMaterial.issues.some(issue=>issue.includes('선택값')));
  input.overrides=model.applyQuotationChanges(input.overrides,model.validateQuotationChanges([change('storageMaterial','폴리프로필렌(PP)')],context(input)));
  assert.equal(model.resolveQuotationFields(input).rows[1].fields.storageMaterial.value,'폴리프로필렌(PP)');
});

test('Observed 80719 requires supply and sale prices, makes search tags optional, and distinguishes blank optional values from required or evidentiary review', () => {
  const input = fixture(); input.content.seo.keywords.value = [];
  input.overrides = { common: { supplyPrice: '', salePrice: '', msrp: '', mainImage: '' }, options: {} };
  const resolved = model.resolveQuotationFields(input);
  const row = resolved.rows[1];
  for (const id of ['supplyPrice', 'salePrice']) {
    assert.equal(resolved.schema.fields.find(field => field.id === id).required, true);
    assert.ok(row.fields[id].issues.some(issue => issue.includes('필수'))); assert.equal(row.fields[id].needsReview, true);
  }
  for (const id of ['searchTags', 'msrp', 'mainImage']) { assert.equal(row.fields[id].value, ''); assert.equal(row.fields[id].issues.length, 0); assert.equal(row.fields[id].needsReview, false); }
  assert.equal(row.fields.kcCertificationNumber.needsReview, true, 'Evidence review remains even if an optional legal value is empty');
  assert.doesNotThrow(() => model.validateQuotationChanges([change('supplyPrice', ''), change('salePrice', '')], context(input)));
  const unknown = model.getQuotationSchema('unobserved-category');
  assert.equal(unknown.fields.find(field => field.id === 'supplyPrice').required, false);
  assert.equal(unknown.fields.find(field => field.id === 'salePrice').required, false);
  assert.equal(unknown.fields.find(field => field.id === 'searchTags').required, true);
});

test('80719 existing barcode validates exact raw length, uppercase characters and spaces without inventing hyphen restrictions', () => {
  const input = fixture(); input.overrides = { common: { barcodeMode: 'existing' }, options: {} };
  for (const invalid of ['ABC12', 'A'.repeat(15), 'abc123', 'ＡBC123', 'ABC_12', ' ABC123', 'ABC123 ', 'ABC  12', 'ABC\t12', 'ABC\n12']) {
    assert.throws(() => model.validateQuotationChanges([change('barcode', invalid)], context(input)), /바코드/);
    input.overrides.common.barcode = invalid;
    const cell = model.resolveQuotationFields(input).rows[0].fields.barcode;
    assert.equal(cell.value, invalid); assert.ok(cell.issues.some(issue => issue.includes('바코드')));
  }
  for (const valid of ['ABC123', 'A'.repeat(14), 'ABC 12', '-AB--1', 'ABC12-']) {
    assert.doesNotThrow(() => model.validateQuotationChanges([change('barcode', valid)], context(input)));
    assert.equal(model.quotationBarcodeIssues('80719', 'existing', valid).length, 0);
  }
  assert.doesNotThrow(() => model.validateQuotationChanges([change('barcode', '')], context(input)));
  assert.equal(model.quotationBarcodeIssues('unobserved-category', 'existing', 'lowercase').length, 0);
  assert.equal(model.quotationBarcodeIssues('80719', 'request-coupang', 'lowercase').length, 0);
});

test('barcode validation uses the final inherited common and option modes, regardless of change ordering', () => {
  const input = fixture(); input.overrides = { common: { barcodeMode: 'existing', barcode: 'ABC123' }, options: { red: { barcode: 'ABC456' } } };
  assert.throws(() => model.validateQuotationChanges([change('barcode', 'abc456', 'red')], context(input)), /바코드/);
  assert.doesNotThrow(() => model.validateQuotationChanges([change('barcode', 'abc456', 'red'), change('barcodeMode', 'request-coupang', 'red')], context(input)));
  input.overrides.common.barcodeMode = 'request-coupang'; input.overrides.options.red.barcode = 'lowercase';
  assert.throws(() => model.validateQuotationChanges([change('barcodeMode', 'existing')], context(input)), /바코드/);
  assert.doesNotThrow(() => model.validateQuotationChanges([change('barcodeMode', 'existing'), change('barcode', 'ABC456', 'red')], context(input)));
  assert.doesNotThrow(() => model.validateQuotationChanges([change('brand', '다른 항목 수정')], context(input)));
});

test('80719 warns above 100 included options while preserving all 200 local rows and prices', () => {
  const input = fixture(); const template = input.options.rows[0];
  input.options.rows = Array.from({ length: 200 }, (_, index) => ({ ...template, id: `option-${index}`, included: index < 101 }));
  const before = JSON.stringify(input.options);
  let resolved = model.resolveQuotationFields(input);
  assert.equal(resolved.rows.length, 201); assert.equal(resolved.rows.filter(row => row.included).length, 101);
  assert.match(resolved.issues[0], /101개.*100개.*보존/); assert.equal(JSON.stringify(input.options), before);
  assert.equal(resolved.rows.at(-1).optionId, 'option-199');
  input.options.rows[100].included = false; resolved = model.resolveQuotationFields(input);
  assert.ok(!resolved.issues.some(issue => issue.includes('한도를 초과'))); assert.equal(resolved.rows.length, 201);
  input.categoryId = 'unobserved-category'; input.options.rows[100].included = true; resolved = model.resolveQuotationFields(input);
  assert.equal(resolved.schema.maxIncludedOptions, undefined); assert.ok(!resolved.issues.some(issue => issue.includes('한도를 초과')));
});

test('77442 uses observed Couplus board fields without claiming official verification or copying saved product values',()=>{
 const input=fixture();input.categoryId='77442';const schema=model.getQuotationSchema('77442');
 assert.equal(schema.status,'unconfirmed');assert.equal(schema.submissionReady,false);
 assert.deepEqual(clone(schema.categoryPath),['완구/취미','보드게임','바둑/체스/윷놀이','바둑','바둑알+바둑판']);
 assert.equal(schema.fields.filter(f=>f.visibility==='exposed').length,2);
 assert.equal(schema.fields.filter(f=>f.visibility==='hidden').length,16);
 assert.equal(schema.fields.filter(f=>f.id.startsWith('notice')).length,5);
 assert.equal(schema.fields.some(f=>f.id==='kcsCertificationNumber'),false);
 const row=model.resolveQuotationFields(input).rows[1];
 for(const id of ['board_magnetic','board_width','noticePermission','packagedWeightG','packagedDimensionsMm','taxType'])assert.equal(row.fields[id].value,'');
 assert.equal(row.fields.title.value,'번역된 가방');assert.equal(row.fields.mainImage.value,'owner/option.png');assert.equal(row.fields.quantity.value,'1');
 input.overrides={common:{board_magnetic:'자석부착가능',noticePermission:'확인된 증빙'},options:{}};
 assert.equal(model.resolveQuotationFields(input).rows[1].fields.board_magnetic.value,'자석부착가능');
 assert.equal(model.getQuotationSchema('80719').fields.some(f=>f.id.startsWith('board_')),false);
 assert.equal(model.getQuotationSchema('unknown').fields.some(f=>f.id.startsWith('board_')),false);
});
test('77442 schema clones choices so one form cannot alter future category forms',()=>{
 const first=model.getQuotationSchema('77442');first.fields.find(f=>f.id==='board_magnetic').choices[0].label='변경';
 assert.equal(model.getQuotationSchema('77442').fields.find(f=>f.id==='board_magnetic').choices[0].label,'해당사항없음');
});

test('board fields and saved certification reach template columns without cross-category mappings',()=>{
 const input=fixture();input.categoryId='77442';
 input.content=contentModel.applyContentPatch(input.content,{label:{certification:'확인한 인증 자료',productName:'동일 상품명',model:'동일 상품명'}},'now');
 const profileModel=load('app/category-profiles.ts');
 const schema=model.getQuotationSchema('77442');
 const board=schema.fields.filter(field=>field.id.startsWith('board_'));
 const values=Object.fromEntries(board.map(field=>[field.id,field.choices?.at(-1).value??'확인값']));
 input.overrides={common:values,options:{red:{board_width:'30cm'}}};
 const resolved=model.resolveQuotationFields(input);
 const row=resolved.rows[1];
 assert.equal(row.fields.noticePermission.value,'확인한 인증 자료');
 assert.equal(row.fields.noticePermission.source,'content');
 assert.equal(row.fields.noticeNameModel.value,'동일 상품명');
 const fields=[...board,schema.fields.find(field=>field.id==='noticePermission')];
 const headers=fields.map(field=>field.label);
 const suggestion=load('app/quotation-mapping.ts').suggestQuotationMappings(headers,'77442');
 assert.equal(suggestion.mappings.length,17);
 const profile={name:'바둑 연결 검증',categoryId:'77442',categoryPath:schema.categoryPath,
  template:{name:'fixture.csv',format:'csv',sha256:'a'.repeat(64),sheetName:'',headerRow:1,headers},mappings:suggestion.mappings};
 const mapped=load('app/exports/quotation-fields.ts').resolvedQuotationRows({...input,profile},resolved,[
  {key:'owner/option.png',name:'assets/option.png'},{key:'owner/main.png',name:'assets/main.png'},{key:'owner/detail.png',name:'assets/detail.png'}]);
 const exported=profileModel.mapQuotationRow(profile,mapped[0]);
 assert.deepEqual(clone(exported.values),fields.map(field=>row.fields[field.id].value));
 assert.throws(()=>profileModel.validateCategoryProfile({...profile,categoryId:'80719'}),/다른 카테고리/);
 assert.equal(load('app/quotation-mapping.ts').suggestQuotationMappings(['자석 부착가능 여부'],'80719').mappings.length,0);
 assert.equal(profileModel.categoryFieldScope('board_width'),'77442');
 input.content=contentModel.applyContentPatch(input.content,{label:{certification:''}},'later');
 assert.equal(model.resolveQuotationFields(input).rows[1].fields.noticePermission.value,'');
 input.overrides.common.noticePermission='견적 수동값';
 assert.equal(model.resolveQuotationFields(input).rows[1].fields.noticePermission.value,'견적 수동값');
 input.content.label.model.value='다른 모델';
 assert.equal(model.resolveQuotationFields(input).rows[1].fields.noticeNameModel.value,'동일 상품명 / 다른 모델');
});

test('deliberately cleared SEO title remains empty in quotation, alt text and both Excel row paths',()=>{
 const input=fixture();
 input.content=contentModel.applyContentPatch(input.content,{seo:{title:'검토한 이름'}},'before');
 input.content=contentModel.applyContentPatch(input.content,{seo:{title:''}},'after');
 const resolved=model.resolveQuotationFields(input);
 for(const row of resolved.rows){
  assert.equal(row.fields.title.value,'');assert.equal(row.fields.title.source,'content');
  assert.equal(row.fields.altText.value,'');assert.ok(row.fields.title.issues.length);
 }
 const assets=[{key:'owner/option.png',name:'assets/option.png'},{key:'owner/main.png',name:'assets/main.png'},{key:'owner/detail.png',name:'assets/detail.png'}];
 const mapped=load('app/exports/quotation-fields.ts').resolvedQuotationRows({...input,profile:null},resolved,assets);
 const legacy=load('app/exports/quotation-data.ts').quotationData(input.product,input.content,input.settings,input.options.rows,assets);
 assert.equal(mapped[0].title,'');assert.equal(legacy[0].title,'');
 input.overrides={common:{title:'견적 전용 이름'},options:{}};
 assert.equal(model.resolveQuotationFields(input).rows[1].fields.title.value,'견적 전용 이름');
 input.content=contentModel.emptyProductContent('p1');delete input.overrides;
 assert.equal(model.resolveQuotationFields(input).rows[1].fields.title.value,input.product.title);
});

test('saved components and release month flow into category quotations and Excel while manual clears win',()=>{
 for(const categoryId of ['80719','80699','81452']){
  const input=fixture();input.categoryId=categoryId;
  input.content=contentModel.applyContentPatch(input.content,{label:{components:'본체 1개 / 파우치 1개',releaseDate:'2026년 9월'}},'2026-09-24T00:00:00Z');
  const before=JSON.stringify(input);const resolved=model.resolveQuotationFields(input);
  const assets=[{key:'owner/option.png',name:'assets/option.png'},{key:'owner/main.png',name:'assets/main.png'},{key:'owner/detail.png',name:'assets/detail.png'}];
  const rows=load('app/exports/quotation-fields.ts').resolvedQuotationRows(input,resolved,assets);
  assert.equal(resolved.rows[1].fields.noticeComponents.value,'본체 1개 / 파우치 1개');assert.equal(resolved.rows[1].fields.noticeReleaseDate.source,'content');
  assert.equal(rows[0].noticeComponents,'본체 1개 / 파우치 1개');assert.equal(rows[0].noticeReleaseDate,'2026년 9월');assert.equal(JSON.stringify(input),before);
  input.content=contentModel.applyContentPatch(input.content,{label:{components:'',releaseDate:''}},'2026-09-24T00:00:01Z');
  const cleared=model.resolveQuotationFields(input).rows[1].fields;assert.equal(cleared.noticeComponents.value,'');assert.equal(cleared.noticeComponents.source,'content');assert.equal(cleared.noticeReleaseDate.value,'');
  input.overrides={common:{noticeComponents:'견적 공통'},options:{red:{noticeComponents:'옵션 직접 수정',noticeReleaseDate:''}}};
  const edited=model.resolveQuotationFields(input).rows[1].fields;assert.equal(edited.noticeComponents.value,'옵션 직접 수정');assert.equal(edited.noticeReleaseDate.source,'manual-option');
 }
 const other=fixture();other.categoryId='77442';assert.equal(model.resolveQuotationFields(other).rows[1].fields.noticeComponents,undefined);
});

test('quotation image review uses final per-option overrides and the same attachment filenames as Excel',()=>{
 const input=fixture();input.overrides={common:{mainImage:'owner/main.png',detailHtml:'<script>evil()</script>'},options:{red:{mainImage:'owner/detail.png',additionalImages:'owner/main.png\nowner/option.png',labelImages:''}}};
 input.options.rows.push({...clone(input.options.rows[0]),id:'excluded',translatedName:'EXCLUDED UNIQUE',included:false});
 input.options.rows[0].translatedName='<img src=x onerror=evil()> & 상품';
 const before=JSON.stringify(input);const resolved=model.resolveQuotationFields(input);
 const assets=[{key:'owner/main.png',name:'assets/image-001.png'},{key:'owner/option.png',name:'assets/image-002.jpg'},{key:'owner/detail.png',name:'assets/image-003.webp'}];
 const exporter=load('app/exports/quotation-fields.ts');
 const rows=exporter.resolvedQuotationRows(input,resolved,assets);
 const result=exporter.quotationFieldFiles({...input,state:{revision:1,overrides:input.overrides},categoryContext:{categoryId:'80719'}},resolved,assets,'fingerprint');
 const html=result.files.find(file=>file.name==='quotation-images.html').data;
 const detail=result.files.find(file=>file.name==='quotation-detail.html').data;
 assert.ok(detail.includes('src="assets/'+rows[0].detailImages+'"'));
 assert.match(detail,/&lt;script&gt;evil\(\)&lt;\/script&gt;/);assert.doesNotMatch(detail,/<script>|EXCLUDED UNIQUE/);
 assert.equal(rows[0].mainImage,'image-003.webp');assert.ok(html.includes('src="assets/'+rows[0].mainImage+'"'));
 assert.ok(html.indexOf('1. image-001.png')<html.indexOf('2. image-002.jpg'));
 assert.match(html,/연결된 이미지 없음/);assert.match(html,/&lt;img src=x onerror=evil\(\)&gt; &amp; 상품/);
 assert.doesNotMatch(html,/<script>|<img src=x|EXCLUDED UNIQUE/);assert.equal(JSON.stringify(input),before);
 const render=load('app/exports/quotation-image-index.ts').quotationImageIndex;
 assert.throws(()=>render(resolved,assets.slice(0,2)),/첨부 파일/);
 for(const name of ['https://evil.test/a.png','../image.png','assets/../../image.png','assets/image.png" onerror="evil()'])assert.throws(()=>render(resolved,assets.map(asset=>({...asset,name}))),/첨부 파일/);
});

test('final option image overrides detect main/detail overlap without changing assets',()=>{
 const input=fixture();const original=clone(input);
 input.overrides={common:{detailImages:'owner/option.png'},options:{}};
 let resolved=model.resolveQuotationFields(input);
 assert.ok(resolved.rows.find(row=>row.optionId==='red').fields.detailImages.issues.includes(model.duplicateQuotationImageIssue));
 input.overrides.options.red={mainImage:'owner/main.png'};
 resolved=model.resolveQuotationFields(input);
 assert.equal(resolved.rows.find(row=>row.optionId==='red').fields.detailImages.issues.includes(model.duplicateQuotationImageIssue),false);
 assert.deepEqual(clone(input.content),original.content);
 assert.deepEqual(clone(model.quotationImageRoleIssues('', '')),[]);
});


test('quotation detail images compose banners and preserve explicit manual overrides', () => {
 const input=fixture();input.content.assets.detailTop.value=['owner/top'];input.content.assets.detailBottom.value=['owner/bottom'];
 input.product.image_keys=JSON.stringify([...JSON.parse(input.product.image_keys),'owner/top','owner/bottom']);
 assert.equal(model.resolveQuotationFields(input).rows[1].fields.detailImages.value,'owner/top\nowner/detail.png\nowner/bottom');
 input.overrides={common:{detailImages:'owner/detail.png'},options:{}};
 assert.equal(model.resolveQuotationFields(input).rows[1].fields.detailImages.value,'owner/detail.png');
 input.overrides.common.detailImages='';
 assert.equal(model.resolveQuotationFields(input).rows[1].fields.detailImages.value,'');
});


test('64497 preserves Couplus attributes and notices after official product-page verification',()=>{
 const schema=model.getQuotationSchema('64497');
 const evidence=JSON.parse(fs.readFileSync(new URL('../docs/couplus-64497-quotation-2026-09-24.json',import.meta.url),'utf8'));
 assert.equal(schema.status,'observed');assert.equal(schema.submissionReady,false);
 assert.deepEqual(clone(schema.categoryPath),evidence.path);
 assert.deepEqual(clone(schema.fields.filter(f=>f.visibility==='exposed').map(f=>f.label)),evidence.exposed);
 const hidden=schema.fields.filter(f=>f.visibility==='hidden');assert.equal(hidden.length,33);
 for(const expected of evidence.hidden){const actual=hidden.find(f=>f.id===expected.id);assert.equal(actual.label,expected.label);assert.deepEqual(clone(actual.choices?.map(c=>c.label)??[]),expected.choices);}
 assert.equal(schema.fields.find(f=>f.id==='model').required,false);
 assert.ok(schema.fields.some(f=>f.id==='kcsCertificationNumber'));
 assert.equal(schema.fields.filter(f=>f.section==='legal'&&f.id.startsWith('notice')).length,5);
 for(const f of schema.fields.filter(f=>f.id.startsWith('notice')))assert.equal(f.required,true);
 const mutable=model.getQuotationSchema('64497');mutable.fields.find(f=>f.id==='tooth_cupMaterial').choices[0].label='변경';
 assert.equal(model.getQuotationSchema('64497').fields.find(f=>f.id==='tooth_cupMaterial').choices[0].label,'해당사항없음');
});
test('64497 official choices, required fields, prices and barcodes are enforced without changing saved overrides',()=>{
 const schema=model.getQuotationSchema('64497');
 const evidence=JSON.parse(fs.readFileSync(new URL('../docs/supplier-hub-64497-product-2026-09-24.json',import.meta.url),'utf8'));
 const selects=schema.fields.filter(f=>f.id.startsWith('tooth_')&&f.type==='select');
 assert.equal(selects.length,evidence.selectsInDisplayedOrder.length);
 selects.forEach((field,index)=>assert.deepEqual(clone(field.choices).sort((a,b)=>a.label.localeCompare(b.label)),evidence.selectsInDisplayedOrder[index].map(({label,value})=>({label,value})).sort((a,b)=>a.label.localeCompare(b.label))));
 for(const id of evidence.required)assert.equal(schema.fields.find(f=>f.id===id).required,true);
 assert.equal(schema.fields.find(f=>f.id==='searchTags').required,false);
 assert.equal(model.quotationOptionLimitIssue(schema,100),null);
 assert.match(model.quotationOptionLimitIssue(schema,101),/100/);
 assert.ok(model.quotationPriceIssues(schema,'5000','4999').length);
 assert.equal(model.quotationPriceIssues(schema,'5000','5000').length,0);
 assert.ok(model.quotationBarcodeIssues('64497','existing','abc').length);
 assert.equal(model.quotationBarcodeIssues('64497','existing','AB123456').length,0);
 const input=fixture();input.categoryId='64497';input.overrides={common:{tooth_cupMaterial:''},options:{}};
 const before=JSON.stringify(input);const row=model.resolveQuotationFields(input).rows[1];
 assert.equal(row.fields.tooth_cupMaterial.value,'');assert.equal(row.fields.tooth_cupMaterial.source,'manual-common');
 assert.equal(JSON.stringify(input),before);
});

test('calculated and overridden MSRP reach submission evidence review without turning it into a numeric error',()=>{
 const input=fixture(); input.categoryId='64497';
 const review=load('app/submission-review.ts');
 for(const overrides of [undefined,{common:{msrp:'25000'},options:{}},{common:{msrp:'25000'},options:{red:{msrp:'30000'}}}]){
  input.overrides=overrides;const resolved=model.resolveQuotationFields(input);
  const issues=review.inspectSubmission(resolved,JSON.parse(input.product.image_keys)).issues.filter(i=>i.fieldId==='msrp');
  assert.equal(issues.length,1);assert.equal(issues[0].kind,'review');assert.equal(issues[0].code,'MSRP_EVIDENCE_REVIEW');
  assert.equal(issues[0].optionId,'red');assert.equal(resolved.rows[1].fields.msrp.issues.length,0);
 }
 input.overrides={common:{msrp:''},options:{}};
 assert.equal(review.inspectSubmission(model.resolveQuotationFields(input),[]).issues.some(i=>i.fieldId==='msrp'),false);
});

test('64497 links saved content and preserves blanks without copying another seller product',()=>{
 const input=fixture();input.categoryId='64497';
 let row=model.resolveQuotationFields(input).rows[1];
 assert.equal(row.fields.noticePermission.value,'');assert.ok(row.fields.noticePermission.issues.some(i=>i.includes('필수')));
 for(const id of ['tooth_cupMaterial','kcMarkType','packagedWeightG','packagedDimensionsMm','shelfLifeDays'])assert.equal(row.fields[id].value,'');
 assert.equal(row.fields.title.value,'번역된 가방');assert.equal(row.fields.mainImage.value,'owner/option.png');assert.equal(row.fields.quantity.value,'1');
 input.content=contentModel.applyContentPatch(input.content,{label:{certification:'확인된 허가 자료'}},'now');
 row=model.resolveQuotationFields(input).rows[1];assert.equal(row.fields.noticePermission.value,'확인된 허가 자료');assert.equal(row.fields.noticePermission.source,'content');
 input.overrides={common:{noticePermission:'공통 확인값'},options:{red:{noticePermission:''}}};
 row=model.resolveQuotationFields(input).rows[1];assert.equal(row.fields.noticePermission.value,'');assert.equal(row.fields.noticePermission.source,'manual-option');assert.ok(row.fields.noticePermission.issues.some(i=>i.includes('필수')));
 assert.equal(model.getQuotationSchema('80719').fields.some(f=>f.id.startsWith('tooth_')),false);
});
test('64497 fields map into quotation exports and reject cross-category profiles',()=>{
 const input=fixture();input.categoryId='64497';const schema=model.getQuotationSchema('64497');
 const fields=schema.fields.filter(f=>f.id.startsWith('tooth_')||f.id.startsWith('notice'));
 const values=Object.fromEntries(fields.map(f=>[f.id,f.choices?.at(-1).value??'확인값']));
 input.overrides={common:values,options:{red:{tooth_width:'30cm'}}};
 const suggestion=load('app/quotation-mapping.ts').suggestQuotationMappings(fields.map(f=>f.label),'64497');assert.equal(suggestion.mappings.length,fields.length);
 const profile={name:'양치용품 연결 검증',categoryId:'64497',categoryPath:schema.categoryPath,template:{name:'fixture.csv',format:'csv',sha256:'a'.repeat(64),sheetName:'',headerRow:1,headers:fields.map(f=>f.label)},mappings:suggestion.mappings};
 const profileModel=load('app/category-profiles.ts');profileModel.validateCategoryProfile(profile);
 const resolved=model.resolveQuotationFields(input);
 const mapped=load('app/exports/quotation-fields.ts').resolvedQuotationRows({...input,profile},resolved,[{key:'owner/main.png',name:'assets/main.png'},{key:'owner/option.png',name:'assets/option.png'},{key:'owner/detail.png',name:'assets/detail.png'}]);
 assert.deepEqual(clone(profileModel.mapQuotationRow(profile,mapped[0]).values),fields.map(f=>resolved.rows[1].fields[f.id].value));
 assert.equal(profileModel.categoryFieldScope('tooth_width'),'64497');
 assert.throws(()=>profileModel.validateCategoryProfile({...profile,categoryId:'80719'}),/다른 카테고리/);
});

test('resolved evidence warnings remain reviews while real validation and transport failures remain errors',()=>{
 const input=fixture();const review=load('app/submission-review.ts');
 input.content.assets.detail.value=['owner/option.png'];
 input.overrides={common:{barcodeMode:'existing',barcode:'',supplyPrice:'5000',salePrice:'4000'},options:{}};
 input.categoryId='64497';const before=JSON.stringify(input);const resolved=model.resolveQuotationFields(input);
 const report=review.inspectSubmission(resolved,JSON.parse(input.product.image_keys));
 const manufacturer=report.issues.filter(i=>i.fieldId==='manufacturer');
 assert.ok(manufacturer.some(i=>i.kind==='review'));assert.equal(manufacturer.some(i=>i.kind==='error'),false);
 assert.ok(report.issues.some(i=>i.fieldId==='barcode'&&i.kind==='error'));
 assert.ok(report.issues.some(i=>i.fieldId==='salePrice'&&i.kind==='error'));
 assert.ok(report.issues.some(i=>i.fieldId==='mainImage'&&i.kind==='error'&&i.message.includes('공개 주소')));
 assert.equal(report.issues.filter(i=>i.code==='MAIN_DETAIL_DUPLICATE').length,1);
 assert.equal(report.issues.some(i=>i.kind==='error'&&i.message.includes('반려 가능성')),false);
 assert.equal(JSON.stringify(input),before);assert.equal(report.submissionReady,false);
});

test('Couplus defaults retain explicit review provenance without being reported as malformed input',()=>{
 const input=fixture();const review=load('app/submission-review.ts');
 const resolved=model.resolveQuotationFields(input);const row=resolved.rows.find(r=>r.included);
 const defaults=Object.entries(row.fields).filter(([,cell])=>cell.source==='couplus-default'&&cell.value.trim());
 assert.ok(defaults.length>0);const report=review.inspectSubmission(resolved,JSON.parse(input.product.image_keys));
 for(const [id,cell] of defaults){
  assert.ok(cell.reviewMessages.some(m=>m.includes('쿠플러스')));
  assert.ok(report.issues.some(i=>i.fieldId===id&&i.kind==='review'&&i.message.includes('쿠플러스')));
  if(!cell.validationIssues.length)assert.equal(report.issues.some(i=>i.fieldId===id&&i.kind==='error'),false);
 }
});

test('downloaded quotation review matches final saved cells and preserves evidence/error distinction',()=>{
 const input=fixture();input.overrides={common:{brand:'직접 입력',barcodeMode:'existing',barcode:''},options:{red:{msrp:'27000'}}};
 input.options.rows.push({...clone(input.options.rows[0]),id:'excluded',included:false});
 const saved={...input,state:{revision:7,overrides:input.overrides},categoryContext:{categoryId:'80719'}};
 const resolved=model.resolveQuotationFields(input);const before=JSON.stringify(saved);
 const assets=[{key:'owner/main.png',name:'assets/main.png'},{key:'owner/option.png',name:'assets/option.png'},{key:'owner/detail.png',name:'assets/detail.png'}];
 const result=load('app/exports/quotation-fields.ts').quotationFieldFiles(saved,resolved,assets,'snapshot-fingerprint');
 const report=JSON.parse(result.files.find(f=>f.name==='submission-review.json').data);
 const expected=clone(load('app/submission-review.ts').inspectSubmission(resolved,JSON.parse(input.product.image_keys)));
 assert.deepEqual(report.issues,expected.issues);assert.equal(report.errorCount,expected.errorCount);assert.equal(report.reviewCount,expected.reviewCount);
 assert.equal(report.inputFingerprint,'snapshot-fingerprint');assert.equal(report.quotationRevision,7);
 assert.equal(report.submissionReady,false);assert.equal(report.transport,'not-connected');
 assert.ok(report.issues.some(i=>i.code==='MSRP_EVIDENCE_REVIEW'));
 assert.ok(report.issues.some(i=>i.fieldId==='barcode'&&i.kind==='error'));
 assert.equal(report.issues.some(i=>i.optionId==='excluded'),false);
 const csv=result.files.find(f=>f.name==='submission-review.csv').data;assert.match(csv,/MSRP_EVIDENCE_REVIEW/);assert.match(csv,/오류/);assert.match(csv,/검토/);
 assert.equal(JSON.stringify(saved),before);
});

test('Hub upload plan splits labels from product images using final included references only',()=>{
 const input=fixture();input.overrides={common:{labelImages:'owner/main.png'},options:{red:{mainImage:'owner/detail.png',additionalImages:'owner/detail.png\nowner/option.png'}}};
 input.options.rows.push({...clone(input.options.rows[0]),id:'excluded',included:false});
 const resolved=model.resolveQuotationFields(input);const before=JSON.stringify(resolved);
 const assets=[{key:'owner/main.png',name:'assets/main.png'},{key:'owner/option.png',name:'assets/option.png'},{key:'owner/detail.png',name:'assets/detail.png'},{key:'owner/unused',name:'assets/unused.png'}];
 const plan=load('app/exports/supplier-hub-upload-plan.ts').supplierHubUploadPlan(resolved,assets);
 assert.deepEqual(clone(plan.labelImages.map(a=>a.filename)),['main.png']);
 assert.deepEqual(clone(plan.productImages.map(a=>a.filename)),['detail.png','option.png']);
 assert.equal(plan.productImages[0].references.length,3);
 assert.equal(plan.productImages.some(a=>a.references.some(r=>r.optionId==='excluded')),false);
 assert.equal(plan.missingLabels.length,0);assert.equal(plan.uploaded,false);assert.equal(plan.submissionReady,false);
 assert.equal(plan.agreements.priceData,'unconfirmed');assert.equal(JSON.stringify(resolved),before);
 input.overrides.options.red.labelImages='';
 const missing=load('app/exports/supplier-hub-upload-plan.ts').supplierHubUploadPlan(model.resolveQuotationFields(input),assets);
 assert.equal(missing.labelImages.length,0);assert.equal(missing.missingLabels[0].optionId,'red');
 const create=load('app/exports/supplier-hub-upload-plan.ts').supplierHubUploadPlan;
 assert.throws(()=>create(resolved,assets.slice(1)),/누락/);
 assert.throws(()=>create(resolved,[...assets,{key:'other',name:'assets/MAIN.png'}]),/중복/);
 assert.throws(()=>create(resolved,[...assets,{key:'other',name:'../escape.png'}]),/경로/);
});

test('offline upload guide renders final role groups safely and exposes missing labels without claiming submission',()=>{
 const input=fixture();input.options.rows[0].translatedName='<script>alert(1)</script>';
 const resolved=model.resolveQuotationFields(input);
 const assets=[{key:'owner/main.png',name:'assets/main.png'},{key:'owner/option.png',name:'assets/option.png'},{key:'owner/detail.png',name:'assets/detail.png'}];
 const plan=load('app/exports/supplier-hub-upload-plan.ts').supplierHubUploadPlan(resolved,assets);
 const render=load('app/exports/supplier-hub-upload-page.ts').supplierHubUploadPage;
 const before=JSON.stringify(plan);const html=render(plan);
 assert.match(html,/2\. 상품 이미지/);assert.match(html,/3\. 제품 필수 표시사항/);assert.match(html,/라벨 연결이 없는 옵션/);
 assert.match(html,/href="assets\/option.png" download="option.png"/);
 assert.match(html,/&lt;script&gt;alert\(1\)&lt;\/script&gt;/);assert.doesNotMatch(html,/<script>/);
 assert.match(html,/default-src 'none'/);assert.match(html,/등록은 실행하지 않습니다/);assert.equal(JSON.stringify(plan),before);
 for(const path of ['https://evil.test/a.png','../a.png','assets/a.png" onerror="evil()']){
  const invalid=clone(plan);invalid.productImages[0].archivePath=path;assert.throws(()=>render(invalid),/첨부 경로/);
 }
});

test('mapping coverage detects category-required and manual fields absent from Excel without treating constants as links',()=>{
 const input=fixture();input.overrides={common:{model:'직접 모델'},options:{red:{searchTags:''}}};
 input.options.rows.push({...clone(input.options.rows[0]),id:'excluded',included:false});
 input.overrides.options.excluded={brand:'제외 수정'};
 const resolved=model.resolveQuotationFields(input);
 const coverage=load('app/exports/quotation-fields.ts').quotationMappingCoverage;
 const profile={mappings:[{column:0,field:'title'},{column:1,field:'constant',value:'모델'},{column:2,field:'material'},{column:3,field:'brand'}]};
 const before=JSON.stringify({resolved,profile});const result=coverage(resolved,profile);
 assert.equal(result.some(f=>f.fieldId==='title'),false);
 assert.equal(result.some(f=>f.fieldId==='noticeMaterial'),false);
 assert.ok(result.some(f=>f.fieldId==='model'&&f.manualOptions[0].optionId==='red'));
 assert.ok(result.some(f=>f.fieldId==='searchTags'&&f.manualOptions.length===1));
 assert.ok(result.some(f=>f.required));
 assert.equal(result.some(f=>f.manualOptions.some(o=>o.optionId==='excluded')),false);
 assert.equal(JSON.stringify({resolved,profile}),before);
 const complete={mappings:resolved.schema.fields.map((f,column)=>({column,field:f.id}))};
 assert.equal(coverage(resolved,complete).length,0);
});

test('observed storage-material attributes reuse saved label material across category schemas', () => {
  const catalog = load('app/hub-product-schemas.ts').hubProductSchemas;
  let covered = 0;
  for (const categoryId of [...Object.keys(catalog), '64497']) {
    if (categoryId === '80719') continue; // Existing named storageMaterial mapping has separate coverage.
    const input = fixture(); input.categoryId = categoryId;
    const schema = model.getQuotationSchema(categoryId);
    const definition = schema.fields.find(field => field.contentField === 'material');
    if (!definition) continue;
    covered++;
    const value = definition.choices?.find(choice => choice.value)?.value ?? '확인된 재질';
    input.content.label.material = {value, provenance:'manual', updatedAt:'2026-09-24T00:00:00Z'};
    const before = JSON.stringify(input);
    const resolved = model.resolveQuotationFields(input);
    for (const row of resolved.rows) {
      assert.equal(row.fields[definition.id].value,value, categoryId);
      assert.equal(row.fields[definition.id].source,'content');
      assert.equal(row.fields[definition.id].validationIssues.length,0);
    }
    assert.equal(JSON.stringify(input),before);
    // Component-specific material fields do not inherit the whole-product fact.
    for (const field of schema.fields.filter(field => /재질/.test(field.label) && field.id !== definition.id && field.id !== 'noticeMaterial')) {
      assert.equal(resolved.rows[0].fields[field.id].value,'',`${categoryId}/${field.label}`);
    }
    input.content.label.material.value = '';
    assert.equal(model.resolveQuotationFields(input).rows[0].fields[definition.id].value,'');
    input.content.label.material.value = value;
    input.overrides = {common:{[definition.id]:'직접 입력'},options:{red:{[definition.id]:''}}};
    const manual = model.resolveQuotationFields(input);
    assert.equal(manual.rows[0].fields[definition.id].value,'직접 입력');
    assert.equal(manual.rows[1].fields[definition.id].value,'');
    assert.equal(manual.rows[1].fields[definition.id].source,'manual-option');
  }
  assert.ok(covered > 1);
});

test('category material choice mismatch remains visible and is never guessed or replaced with N/A', () => {
  const input = fixture(); input.categoryId = '80699';
  input.content.label.material.value = '선택지에 없는 복합재료';
  const definition = model.getQuotationSchema(input.categoryId).fields.find(field => field.contentField === 'material');
  const field = model.resolveQuotationFields(input).rows[1].fields[definition.id];
  assert.equal(field.value,'선택지에 없는 복합재료');
  assert.ok(field.validationIssues.length > 0);
  assert.equal(field.source,'content');
});

test('cleared option measurements stay empty through save, quotation and export', () => {
  for (const key of ['widthCm', 'lengthCm', 'heightCm']) {
    const input = fixture();
    const before = clone(input.options);
    input.options = optionModel.applyOptionRows(input.options, optionModel.optionInputs(input.options).map(row => ({ ...row, [key]: null })), '2026-09-24T12:00:00.000Z');
    assert.equal(input.options.rows[0].provenance[key], 'manual');
    input.options = optionModel.applyOptionRows(input.options, optionModel.optionInputs(input.options), '2026-09-24T12:01:00.000Z');
    assert.equal(input.options.rows[0].provenance[key], 'manual');
    const resolved = model.resolveQuotationFields(input);
    for (const id of ['size', 'noticeDimensions']) {
      assert.equal(resolved.rows[1].fields[id].value, '');
      assert.equal(resolved.rows[1].fields[id].source, 'option');
    }
    assert.equal(resolved.rows[0].fields.noticeDimensions.value, '20 × 30 × 40 cm');
    const exported = load('app/exports/quotation-fields.ts').resolvedQuotationRows(input, resolved, JSON.parse(input.product.image_keys).map((key, index) => ({ key, name: `assets/${index}.png` })));
    assert.equal(exported[0].noticeDimensions, '');
    assert.equal(exported[0].size, '');
    assert.equal(before.rows[0][key] > 0, true);
    input.overrides = { common: { noticeDimensions: '직접 확인한 치수' }, options: {} };
    assert.equal(model.resolveQuotationFields(input).rows[1].fields.noticeDimensions.value, '직접 확인한 치수');
  }
});

test('untouched empty measurements inherit label while complete measurements and purchasing size take precedence', () => {
  const input = fixture();
  const row = { ...optionModel.emptyOptionInput('red'), originalName: '옵션', unitCostCny: 1, included: true };
  input.options = optionModel.applyOptionRows(optionModel.emptyProductOptions('p1'), [row], 'now');
  assert.equal(input.options.rows[0].provenance.widthCm, 'unverified');
  assert.equal(model.resolveQuotationFields(input).rows[1].fields.noticeDimensions.value, '20 × 30 × 40 cm');
  input.options = optionModel.applyOptionRows(input.options, [{ ...row, widthCm: 1, lengthCm: 2, heightCm: 3 }], 'later');
  assert.equal(model.resolveQuotationFields(input).rows[1].fields.noticeDimensions.value, '1 × 2 × 3 cm');
  input.options = optionModel.applyOptionRows(input.options, [{ ...row, size: 'L', widthCm: null, lengthCm: 2, heightCm: 3 }], 'last');
  assert.equal(model.resolveQuotationFields(input).rows[1].fields.size.value, 'L');
  assert.equal(model.resolveQuotationFields(input).rows[1].fields.noticeDimensions.value, '');
});
