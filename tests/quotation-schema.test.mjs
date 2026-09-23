import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const cache = new Map();
function load(file) {
  if (cache.has(file)) return cache.get(file);
  const exports = {};
  const compiled = ts.transpileModule(fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(compiled, { exports, structuredClone, require(name) {
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
  input.options.rows = []; result = model.resolveQuotationFields(input); assert.equal(result.rows.length, 1); assert.equal(result.rows[0].included, true);
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
