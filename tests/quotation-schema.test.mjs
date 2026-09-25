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

test('single translation content save reaches quotation and export while retaining quotation overrides',()=>{
 const input=fixture();input.content=contentModel.emptyProductContent('p1');
 const job={productId:'p1',productVersion:'v',status:'completed',review:{source:{attributes:[{name:'상품속성: 材质'}]}},result:{draft:{title:'한번에 작성한 상품명',keywords:['수납'],description:'번역 설명',attributes:[{sourceIndex:0,name:'재질',value:'면'}]}}};
 const plan=load('app/translation-batch-adoption.ts').translationBatchAdoption(input.content,job,'v');
 input.content=contentModel.applyContentPatch(input.content,plan.input.patch,'now');
 let result=model.resolveQuotationFields(input);
 assert.equal(result.rows[1].fields.title.value,'한번에 작성한 상품명');
 assert.equal(result.rows[1].fields.noticeMaterial.value,'면');
 const rows=load('app/exports/quotation-fields.ts').resolvedQuotationRows(input,result,JSON.parse(input.product.image_keys).map((key,index)=>({key,name:`assets/${index}.png`})));
 assert.equal(rows[0].noticeMaterial,'면');
 input.overrides={common:{title:'견적 전용 상품명'},options:{red:{noticeMaterial:''}}};result=model.resolveQuotationFields(input);
 assert.equal(result.rows[1].fields.title.value,'견적 전용 상품명');assert.equal(result.rows[1].fields.noticeMaterial.value,'');
});

test('bulk option image edits reach quotation and preserve manual overrides and common-image fallback',()=>{
 const input=fixture(),tools=load('app/option-editor-tools.ts'),keys=JSON.parse(input.product.image_keys);
 const rows=optionModel.optionInputs(input.options);
 const preview=tools.previewOptionBulk(rows,['red'],{type:'imageKey',value:'owner/detail.png'},policy,keys);
 input.options=optionModel.applyOptionRows(input.options,tools.applyOptionBulk(rows,preview,keys),'now');
 let resolved=model.resolveQuotationFields(input);assert.equal(resolved.rows[1].fields.mainImage.value,'owner/detail.png');assert.equal(input.options.rows[0].provenance.imageKey,'manual');
 const assets=keys.map((key,index)=>({key,name:`assets/${index}.png`}));assert.equal(load('app/exports/quotation-fields.ts').resolvedQuotationRows(input,resolved,assets)[0].mainImage,'2.png');
 input.overrides={common:{},options:{red:{mainImage:'owner/option.png'}}};assert.equal(model.resolveQuotationFields(input).rows[1].fields.mainImage.value,'owner/option.png');
 const updated=optionModel.optionInputs(input.options);const clear=tools.previewOptionBulk(updated,['red'],{type:'imageKey',value:null},policy,keys);input.options=optionModel.applyOptionRows(input.options,tools.applyOptionBulk(updated,clear,keys),'later');
 input.overrides=model.emptyQuotationOverrides();resolved=model.resolveQuotationFields(input);assert.equal(resolved.rows[1].fields.mainImage.value,'owner/main.png');assert.equal(input.options.rows[0].imageKey,null);assert.equal(input.options.rows[0].provenance.imageKey,'manual');
});

test('explicit KC information reaches the brace notice and export without inferring certification IDs or other categories',()=>{
 const input=fixture();input.categoryId='81452';
 input.content=contentModel.applyContentPatch(input.content,{label:{certification:'일반 허가 문구',kcInformation:'확인한 KC 표시 내용'}},'now');
 const before=JSON.stringify(input);let resolved=model.resolveQuotationFields(input);
 assert.equal(resolved.rows[1].fields.brace_noticeKc.value,'확인한 KC 표시 내용');assert.equal(resolved.rows[1].fields.brace_noticeKc.source,'content');
 assert.equal(resolved.rows[1].fields.kcCertificationNumber.value,'');assert.equal(resolved.rows[1].fields.kcMarkType.value,'');
 const files=JSON.parse(input.product.image_keys).map((key,index)=>({key,name:`assets/${index}.png`}));
 assert.equal(load('app/exports/quotation-fields.ts').resolvedQuotationRows(input,resolved,files)[0].brace_noticeKc,'확인한 KC 표시 내용');
 assert.equal(load('app/quotation-label-plan.ts').quotationLabelPlan(resolved,'red').rows.find(row=>row[0]==='KC 인증정보')[1],'확인한 KC 표시 내용');assert.equal(JSON.stringify(input),before);
 input.overrides={common:{brace_noticeKc:'공통값'},options:{red:{brace_noticeKc:''}}};resolved=model.resolveQuotationFields(input);assert.equal(resolved.rows[0].fields.brace_noticeKc.value,'공통값');assert.equal(resolved.rows[1].fields.brace_noticeKc.value,'');assert.equal(resolved.rows[1].fields.brace_noticeKc.source,'manual-option');
 input.overrides=model.emptyQuotationOverrides();input.content=contentModel.applyContentPatch(input.content,{label:{kcInformation:''}},'later');resolved=model.resolveQuotationFields(input);assert.equal(resolved.rows[1].fields.brace_noticeKc.value,'');assert.equal(resolved.rows[1].fields.brace_noticeKc.source,'content');
 delete input.content.label.kcInformation;assert.equal(model.resolveQuotationFields(input).rows[1].fields.brace_noticeKc.value,'');
 input.categoryId='77442';assert.equal(model.resolveQuotationFields(input).rows[1].fields.noticePermission.value,'일반 허가 문구');
});

test('saved product type reaches category kind and label image, preserves quotation overrides and manual blank',()=>{
 const input=fixture();input.categoryId='103495';
 input.content=contentModel.applyContentPatch(input.content,{label:{productType:'러닝용 허리 가방'}},'2026-09-24T00:00:00Z');
 const before=JSON.stringify(input);let row=model.resolveQuotationFields(input).rows[1];
 assert.equal(row.fields.marathon_noticeKind.value,'러닝용 허리 가방');assert.equal(row.fields.marathon_noticeKind.source,'content');
 const plan=load('app/document-image.ts').documentImagePlan('label',input.content,{productId:'p1'});assert.equal(plan.rows.find(row=>row[0]==='상품 유형')[1],'러닝용 허리 가방');assert.equal(JSON.stringify(input),before);
 input.overrides={common:{marathon_noticeKind:'공통 유형'},options:{red:{marathon_noticeKind:'옵션 유형'}}};
 assert.equal(model.resolveQuotationFields(input).rows[1].fields.marathon_noticeKind.value,'옵션 유형');
 input.overrides.options.red.marathon_noticeKind='';assert.equal(model.resolveQuotationFields(input).rows[1].fields.marathon_noticeKind.value,'');
 input.overrides=model.emptyQuotationOverrides();input.content=contentModel.applyContentPatch(input.content,{label:{productType:''}},'2026-09-24T01:00:00Z');
 row=model.resolveQuotationFields(input).rows[1];assert.equal(row.fields.marathon_noticeKind.value,'');assert.equal(row.fields.marathon_noticeKind.source,'content');
 delete input.content.label.productType;assert.equal(model.resolveQuotationFields(input).rows[1].fields.marathon_noticeKind.value,'');
});

test('77442 official choices, required model, option rules and dimension bindings preserve manual edits', () => {
 const input=fixture();input.categoryId='77442';const schema=model.getQuotationSchema('77442');
 const evidence=JSON.parse(fs.readFileSync(new URL('../docs/supplier-hub-77442-product-2026-09-24.json',import.meta.url),'utf8'));
 const selects=schema.fields.filter(f=>f.id.startsWith('board_')&&f.type==='select');
 assert.equal(selects.length,7);selects.forEach((f,i)=>assert.deepEqual(clone(f.choices),evidence.selects[i]));
 evidence.required.forEach(id=>assert.equal(schema.fields.find(f=>f.id===id).required,true));
 assert.equal(schema.fields.find(f=>f.id==='searchTags').required,false);
 assert.equal(model.quotationOptionLimitIssue(schema,100),null);assert.match(model.quotationOptionLimitIssue(schema,101),/100/);
 assert.ok(model.quotationPriceIssues(schema,'5000','4999').length);
 assert.throws(()=>model.validateQuotationChanges([change('barcodeMode','existing'),change('barcode','bad')],context(input)),/바코드/);
 let fields=model.resolveQuotationFields(input).rows[1].fields;
 assert.equal(fields.board_width.value,'20 cm');assert.equal(fields.board_length.value,'30 cm');
 input.options.rows[0].widthCm=null;input.options.rows[0].provenance.widthCm='manual';
 fields=model.resolveQuotationFields(input).rows[1].fields;assert.equal(fields.board_width.value,'');
 input.overrides={common:{board_width:'40cm',board_magnetic:'해당사항없음'},options:{red:{board_width:'25cm'}}};
 fields=model.resolveQuotationFields(input).rows[1].fields;
 assert.equal(fields.board_width.value,'25cm');assert.equal(fields.board_magnetic.value,'해당사항없음');assert.ok(fields.board_magnetic.validationIssues.length);
});

test('103495 official form rules validate choices, required options, prices and barcode without certifying submission', () => {
  const input = fixture(); input.categoryId = '103495';
  const schema = model.getQuotationSchema(input.categoryId);
  const evidence = JSON.parse(fs.readFileSync(new URL('../docs/supplier-hub-103495-product-2026-09-24.json', import.meta.url), 'utf8'));
  const selects = schema.fields.filter(f => f.type === 'select' && f.id.startsWith('marathon_'));
  assert.equal(selects.length, 10);
  selects.forEach((f,i) => assert.deepEqual(clone(f.choices), evidence.selects[i]));
  evidence.required.forEach(id => assert.equal(schema.fields.find(f => f.id === id).required, true));
  assert.equal(schema.fields.find(f => f.id === 'searchTags').required, false);
  assert.equal(model.quotationOptionLimitIssue(schema,100), null);
  assert.match(model.quotationOptionLimitIssue(schema,101), /100/);
  assert.ok(model.quotationPriceIssues(schema,'5000','4999').length);
  const ctx = context(input);
  assert.throws(()=>model.validateQuotationChanges([change('barcodeMode','existing'),change('barcode','abc')],ctx), /바코드/);
  assert.throws(()=>model.validateQuotationChanges([change('marathon_waterproof','해당사항없음')],ctx), /선택/);
  assert.equal(model.validateQuotationChanges([change('marathon_waterproof','')],ctx)[0].value,'');
  input.overrides={common:{marathon_waterproof:'해당사항없음'},options:{}};
  const existing=model.resolveQuotationFields(input).rows[1].fields.marathon_waterproof;
  assert.equal(existing.value,'해당사항없음'); assert.ok(existing.validationIssues.length);
  assert.equal(schema.submissionReady,false);
});

test('103495 preserves observed marathon form while deriving notices from each option, not saved example values', () => {
  const input = fixture(); input.categoryId = '103495';
  const schema = model.getQuotationSchema(input.categoryId);
  const evidence = JSON.parse(fs.readFileSync(new URL('../docs/couplus-marathon-103495-observation.json', import.meta.url), 'utf8'));
  const attributes = schema.fields.filter(f => f.visibility !== 'common');
  assert.deepEqual(clone(schema.categoryPath), evidence.path);
  assert.equal(schema.status, 'observed'); assert.equal(schema.submissionReady, false);
  assert.equal(attributes.length, 26);
  attributes.forEach((f, i) => {
    assert.equal(f.label, evidence.attributes[i].label);
    assert.deepEqual(clone(f.choices?.map(v => v.label) ?? []).sort(), [...evidence.attributes[i].choices].sort());
  });
  assert.equal(schema.fields.filter(f => f.id === 'noticeMaterial').length, 1);
  assert.equal(schema.fields.find(f => f.id === 'model').required, false);
  input.options.rows[0].color = '그레이'; input.options.rows[0].size = 'Free';
  input.content.label.precautions.value = '실제 취급 주의사항';
  let row = model.resolveQuotationFields(input).rows[1].fields;
  assert.equal(row.marathon_noticeColor.value, '그레이');
  assert.equal(row.marathon_noticeSize.value, 'Free');
  assert.equal(row.noticeMaterial.value, '면');
  assert.equal(row.marathon_noticeCaution.value, '실제 취급 주의사항');
  assert.equal(row.marathon_noticeKind.value, '');
  assert.equal(row.marathon_waterproof.value, '');
  input.options.rows[0].size = ''; input.options.rows[0].color = '';
  input.options.rows[0].provenance.size = 'manual'; input.options.rows[0].provenance.color = 'manual';
  row = model.resolveQuotationFields(input).rows[1].fields;
  assert.equal(row.marathon_noticeColor.value, ''); assert.equal(row.marathon_noticeSize.value, '');
  assert.equal(row.size.value, '');
  input.overrides = {common: {marathon_noticeColor: '공통 수정'}, options: {red: {marathon_noticeColor: '개별 수정'}}};
  assert.equal(model.resolveQuotationFields(input).rows[1].fields.marathon_noticeColor.value, '개별 수정');
  const profiles = load('app/category-profiles.ts');
  for (const f of schema.fields.filter(f => f.id.startsWith('marathon_'))) {
    assert.ok(Object.hasOwn(profiles.categoryFields, f.id));
  }
});

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

test('77442 uses officially cross-checked board fields without copying saved product values',()=>{
 const input=fixture();input.categoryId='77442';const schema=model.getQuotationSchema('77442');
 assert.equal(schema.status,'observed');assert.equal(schema.submissionReady,false);
 assert.deepEqual(clone(schema.categoryPath),['완구/취미','보드게임','바둑/체스/윷놀이','바둑','바둑알+바둑판']);
 assert.equal(schema.fields.filter(f=>f.visibility==='exposed').length,2);
 assert.equal(schema.fields.filter(f=>f.visibility==='hidden').length,16);
 assert.equal(schema.fields.filter(f=>f.id.startsWith('notice')).length,5);
 assert.equal(schema.fields.some(f=>f.id==='kcsCertificationNumber'),false);
 const row=model.resolveQuotationFields(input).rows[1];
 for(const id of ['board_magnetic','noticePermission','packagedWeightG','packagedDimensionsMm','taxType'])assert.equal(row.fields[id].value,'');
 assert.equal(row.fields.title.value,'번역된 가방');assert.equal(row.fields.mainImage.value,'owner/option.png');assert.equal(row.fields.quantity.value,'1');
 input.overrides={common:{board_magnetic:'자석부착가능',noticePermission:'확인된 증빙'},options:{}};
 assert.equal(model.resolveQuotationFields(input).rows[1].fields.board_magnetic.value,'자석부착가능');
 assert.equal(model.getQuotationSchema('80719').fields.some(f=>f.id.startsWith('board_')),false);
 assert.equal(model.getQuotationSchema('unknown').fields.some(f=>f.id.startsWith('board_')),false);
});
test('77442 schema clones choices so one form cannot alter future category forms',()=>{
 const first=model.getQuotationSchema('77442');first.fields.find(f=>f.id==='board_magnetic').choices[0].label='변경';
 assert.equal(model.getQuotationSchema('77442').fields.find(f=>f.id==='board_magnetic').choices[0].label,'자석부착가능');
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
 for (const asset of assets) {
  asset.data=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2RkcAAAAASUVORK5CYII=','base64');
  asset.data.writeUInt32BE(asset.key==='owner/detail.png'?780:1000,16);
  asset.data.writeUInt32BE(1000,20);
 }
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

test('mapping coverage includes populated automatic optional values but excludes blank automatic and excluded options',()=>{
 const coverage=load('app/exports/quotation-fields.ts').quotationMappingCoverage;
 const resolved={schema:{fields:[{id:'altText',label:'대체 텍스트',required:false},{id:'detailHtml',label:'상세',required:false}]},rows:[
  {optionId:'a',optionLabel:'자동',included:true,fields:{altText:{value:'자동 상품명',source:'content'},detailHtml:{value:'',source:'empty'}}},
  {optionId:'b',optionLabel:'직접',included:true,fields:{altText:{value:'',source:'manual-option'},detailHtml:{value:'',source:'empty'}}},
  {optionId:'c',optionLabel:'제외',included:false,fields:{altText:{value:'제외',source:'settings'},detailHtml:{value:'제외 상세',source:'content'}}},
 ]};
 const before=JSON.stringify(resolved);const missing=coverage(resolved,{mappings:[]});
 assert.equal(missing.length,1);assert.equal(missing[0].fieldId,'altText');
 assert.deepEqual(Array.from(missing[0].automaticOptions,o=>o.optionId),['a']);
 assert.deepEqual(Array.from(missing[0].manualOptions,o=>o.optionId),['b']);
 assert.equal(coverage(resolved,{mappings:[{column:0,field:'altText'}]}).length,0);
 assert.equal(JSON.stringify(resolved),before);
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
    for (const field of schema.fields.filter(field => /재질/.test(field.label) && field.contentField !== 'material' && field.id !== 'noticeMaterial')) {
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

test('whole-product material flows from saved content into each observed category and export without replacing manual values', () => {
  const catalog=load('app/hub-product-schemas.ts').hubProductSchemas;
  let covered=0;
  for(const categoryId of [...Object.keys(catalog),'64497','103495','77442','81452']) {
    const input=fixture();input.categoryId=categoryId;
    const definition=model.getQuotationSchema(categoryId).fields.find(field=>field.label==='상품 재질');
    if(!definition)continue;
    covered++;
    const value=definition.choices?.find(choice=>choice.value)?.value ?? '확인한 재질';
    input.content=contentModel.applyContentPatch(input.content,{label:{material:value}},'2026-09-24T12:00:00Z');
    const before=JSON.stringify(input);
    let resolved=model.resolveQuotationFields(input);
    for(const row of resolved.rows){assert.equal(row.fields[definition.id].value,value,categoryId);assert.equal(row.fields[definition.id].source,'content');assert.equal(row.fields[definition.id].validationIssues.length,0);}
    const exported=load('app/exports/quotation-fields.ts').resolvedQuotationRows(input,resolved,JSON.parse(input.product.image_keys).map((key,index)=>({key,name:`assets/${index}.png`})));
    assert.equal(exported[0][definition.id],value,categoryId);
    assert.equal(JSON.stringify(input),before);
    input.overrides={common:{[definition.id]:'직접 지정한 재질'},options:{red:{[definition.id]:''}}};
    resolved=model.resolveQuotationFields(input);
    assert.equal(resolved.rows[0].fields[definition.id].value,'직접 지정한 재질');assert.equal(resolved.rows[1].fields[definition.id].source,'manual-option');assert.equal(resolved.rows[1].fields[definition.id].value,'');
    input.overrides=model.emptyQuotationOverrides();
    input.content=contentModel.applyContentPatch(input.content,{label:{material:''}},'2026-09-24T12:01:00Z');
    resolved=model.resolveQuotationFields(input);assert.equal(resolved.rows[1].fields[definition.id].value,'');assert.equal(resolved.rows[1].fields[definition.id].source,'content');
    input.content.label.material.value='선택지에 없는 확인된 복합 재질';
    const mismatch=model.resolveQuotationFields(input).rows[1].fields[definition.id];assert.equal(mismatch.value,input.content.label.material.value);if(definition.choices)assert.ok(mismatch.validationIssues.length>0);
  }
  assert.ok(covered>=4,`Observed whole-product fields covered: ${covered}`);
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

test('observed category dimension attributes follow option measurements through quotation export', () => {
  const hub = load('app/hub-product-schemas.ts').hubProductSchemas;
  const expected = { '가로길이': ['widthCm', '20 cm'], '세로길이': ['lengthCm', '30 cm'], '아이템 높이': ['heightCm', '40 cm'] };
  let checked = 0;
  for (const categoryId of [...Object.keys(hub), '64497', '77442', '81452']) {
    const input = fixture(); input.categoryId = categoryId;
    const original = clone(input);
    const resolved = model.resolveQuotationFields(input);
    const exported = load('app/exports/quotation-fields.ts').resolvedQuotationRows(input, resolved, JSON.parse(input.product.image_keys).map((key, i) => ({ key, name: `assets/${i}.png` })));
    for (const field of resolved.schema.fields.filter(field => field.optionDimension)) {
      assert.equal(field.optionDimension, expected[field.label][0]);
      assert.equal(resolved.rows[1].fields[field.id].value, expected[field.label][1]);
      assert.equal(resolved.rows[1].fields[field.id].source, 'option');
      assert.equal(exported[0][field.id], expected[field.label][1]);
      checked++;
    }
    for (const field of resolved.schema.fields.filter(field => /포장|중량|최대|최소|조절/.test(field.label))) assert.equal(field.optionDimension, undefined);
    assert.deepEqual(clone(input), original);
  }
  assert.ok(checked >= 25);
});

test('individual dimension bindings preserve clears, overrides and per-option values without inferring label text', () => {
  const input = fixture();
  input.options = optionModel.applyOptionRows(input.options, [
    { ...optionModel.optionInputs(input.options)[0], widthCm: null },
    { ...optionModel.emptyOptionInput('blue'), originalName: 'blue', unitCostCny: 2, included: true, widthCm: 12.5 },
    { ...optionModel.emptyOptionInput('empty'), originalName: 'empty', unitCostCny: 2, included: true },
  ], '2026-09-24T12:00:00Z');
  const resolved = model.resolveQuotationFields(input);
  assert.equal(resolved.rows[1].fields.width.value, '');
  assert.equal(resolved.rows[1].fields.width.source, 'option');
  assert.equal(resolved.rows[1].fields.itemHeight.value, '40 cm');
  assert.equal(resolved.rows[2].fields.width.value, '12.5 cm');
  assert.notEqual(resolved.rows[3].fields.width.value, '20 cm');
  input.overrides = { common: { width: '80 mm' }, options: { red: { width: '' } } };
  const final = model.resolveQuotationFields(input);
  assert.equal(final.rows[1].fields.width.value, '');
  assert.equal(final.rows[1].fields.width.source, 'manual-option');
  assert.equal(final.rows[2].fields.width.value, '80 mm');
  assert.equal(final.rows[2].fields.width.source, 'manual-common');
});

test('saved tax default reaches every category quotation and export while explicit overrides win', () => {
  const categories = [...Object.keys(load('app/hub-product-schemas.ts').hubProductSchemas), '64497', '77442', '81452', null];
  for (const categoryId of categories) {
    for (const taxType of ['과세', '면세', '영세']) {
      const input = fixture(); input.categoryId = categoryId;
      input.settings = settingsModel.savedRegistrationSettings(JSON.parse(JSON.stringify({ ...input.settings, taxType })));
      const before = clone(input);
      const resolved = model.resolveQuotationFields(input);
      for (const row of resolved.rows) {
        assert.equal(row.fields.taxType.value, taxType);
        assert.equal(row.fields.taxType.source, 'settings');
      }
      const files = JSON.parse(input.product.image_keys).map((key, i) => ({ key, name: `assets/${i}.png` }));
      assert.equal(load('app/exports/quotation-fields.ts').resolvedQuotationRows(input, resolved, files)[0].taxType, taxType);
      assert.deepEqual(clone(input), before);
      input.overrides = { common: { taxType: '면세' }, options: { red: { taxType: '' } } };
      const edited = model.resolveQuotationFields(input);
      assert.equal(edited.rows[0].fields.taxType.value, '면세');
      assert.equal(edited.rows[1].fields.taxType.value, '');
      assert.equal(edited.rows[1].fields.taxType.source, 'manual-option');
      assert.ok(edited.rows[1].fields.taxType.validationIssues.length);
    }
  }
});

test('missing tax settings preserve observed category defaults and never invent defaults for other categories', () => {
  const oldSettings = { ...settingsModel.defaultSettings }; delete oldSettings.taxType;
  for (const saved of [null, oldSettings, { ...oldSettings, taxType: '' }]) {
    const settings = settingsModel.savedRegistrationSettings(saved);
    assert.equal(settings.taxType, '');
    const input = fixture(); input.settings = settings;
    assert.equal(model.resolveQuotationFields(input).rows[1].fields.taxType.value, '과세');
    assert.equal(model.resolveQuotationFields(input).rows[1].fields.taxType.source, 'couplus-default');
    input.categoryId = '81452';
    assert.equal(model.resolveQuotationFields(input).rows[1].fields.taxType.value, '');
    assert.ok(model.resolveQuotationFields(input).rows[1].fields.taxType.validationIssues.length);
  }
  for (const value of ['invalid', null, 0, true, {}, ['과세']]) assert.throws(() => settingsModel.validateSettings({ taxType: value }), /과세여부/);
});


test('archive review inspects final attachment bytes and preserves image guidance in JSON and CSV', () => {
 const input=fixture();
 input.overrides={common:{},options:{red:{mainImage:'owner/main.png',detailImages:'owner/detail.png'}}};
 const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2RkcAAAAASUVORK5CYII=','base64');
 const main=Buffer.from(png); main.writeUInt32BE(999,16);main.writeUInt32BE(1000,20);
 const detail=Buffer.from(png);detail.writeUInt32BE(780,16);detail.writeUInt32BE(1501,20);
 const assets=[{key:'owner/main.png',name:'assets/image-001.png',data:main},{key:'owner/detail.png',name:'assets/image-002.png',data:detail},{key:'owner/option.png',name:'assets/image-003.png',data:png}];
 const resolved=model.resolveQuotationFields(input);
 const source={...input,state:{revision:1,overrides:input.overrides},categoryContext:{categoryId:'80719'}};
 const exporter=load('app/exports/quotation-fields.ts');
 const files=exporter.quotationFieldFiles(source,resolved,assets,'same-revision').files;
 const review=JSON.parse(files.find(file=>file.name==='submission-review.json').data);
 const csv=files.find(file=>file.name==='submission-review.csv').data;
 assert.ok(review.issues.some(issue=>issue.fieldId==='mainImage'&&issue.message.includes('999×1000')));
 assert.ok(review.issues.some(issue=>issue.fieldId==='detailImages'&&issue.message.includes('780×1501')));
 assert.match(csv,/999×1000/);assert.match(csv,/780×1501/);
 assert.ok(review.limits.some(line=>line.includes('패키지에 포함한 이미지 바이트')));
 assert.equal(review.submissionReady,false);
 const inspector=load('app/exports/quotation-image-checks.ts').inspectQuotationAssets;
 main.writeUInt32BE(1000,16);detail.writeUInt32BE(1500,20);
 assert.equal(inspector(resolved,assets).size,0);
 const invalid=[...assets];invalid[0]={...assets[0],data:Buffer.from('<svg/>')};
 assert.equal(inspector(resolved,invalid).get('owner/main.png').kind,'error');
 assert.equal(inspector(resolved,assets.slice(1)).get('owner/main.png').kind,'error');
 assert.equal(inspector(resolved,[{...assets[0],data:png.subarray(0,8)},...assets.slice(1)]).get('owner/main.png').kind,'review');
 for(const row of resolved.rows)row.included=false;
 assert.equal(inspector(resolved,invalid).size,0);
});


test('quotation label PNG plan follows category fields and final option overrides without changing saved content',()=>{
 const input=fixture(); input.categoryId='103495';
 input.options.rows.push({...clone(input.options.rows[0]),id:'blue',translatedName:'파랑',color:'파랑'});
 input.overrides={common:{model:'공통 모델',manufacturer:'공통 제조사'},options:{red:{model:'옵션 모델',marathon_noticeColor:'직접 색상',marathon_noticeSize:''}}};
 const before=JSON.stringify(input);const resolved=model.resolveQuotationFields(input);
 const make=load('app/quotation-label-plan.ts').quotationLabelPlan;
 const red=make(resolved,'red'),blue=make(resolved,'blue');
 assert.ok(red.rows.some(row=>row[0]==='모델명'&&row[1]==='옵션 모델'));
 assert.ok(blue.rows.some(row=>row[0]==='모델명'&&row[1]==='공통 모델'));
 for(const field of resolved.schema.fields.filter(field=>field.section==='legal')){
  const cell=resolved.rows.find(row=>row.optionId==='red').fields[field.id];
  assert.ok(red.rows.some(row=>row[0]===field.label&&row[1]===(cell.value.trim()?field.choices?.find(choice=>choice.value===cell.value)?.label??cell.value:'[공란]')));
 }
 assert.ok(red.rows.some(row=>row[1]==='직접 색상'));
 assert.ok(red.rows.some(row=>row[1]==='[공란]'));
 assert.match(red.footer,/첨부·전송되지 않았습니다/);
 assert.equal(JSON.stringify(input),before);
 assert.throws(()=>make(resolved,'missing'),/포함된 옵션/);
 resolved.rows.find(row=>row.optionId==='red').included=false;
 assert.throws(()=>make(resolved,'red'),/포함된 옵션/);
 resolved.schema.categoryId=null;
 assert.throws(()=>make(resolved,'blue'),/카테고리/);
});

test('saved custom labels reach option quotation PNGs without altering official cells or content', () => {
 const input=fixture();
 input.content.customLabels=[{id:'custom-a',name:'추가 안내',value:'세탁 방법',visible:true},{id:'custom-b',name:'숨김',value:'비공개',visible:false},{id:'custom-c',name:'직접 비움',value:'',visible:true}];
 input.overrides={common:{model:'공통'},options:{red:{model:'직접 모델'}}};
 const before=JSON.stringify(input);const resolved=model.resolveQuotationFields(input);
 const plan=load('app/quotation-label-plan.ts').quotationLabelPlan(resolved,'red');
 assert.deepEqual(clone(plan.rows.slice(-2)),[['추가 안내','세탁 방법'],['직접 비움','[공란]']]);
 assert.ok(!plan.rows.some(row=>row[0]==='숨김'));
 assert.equal(resolved.rows[1].fields.model.value,'직접 모델');
 assert.ok(!resolved.schema.fields.some(field=>field.id==='custom-a'));
 assert.equal(JSON.stringify(input),before);
 resolved.customLabels[0].value='변경';assert.equal(input.content.customLabels[0].value,'세탁 방법');
 delete input.content.customLabels;assert.deepEqual(clone(model.resolveQuotationFields(input).customLabels),[]);
});

test('80719 product weight follows saved selling-unit weight without inventing packaged weight or overwriting manual values',()=>{
 const input=fixture();const before=JSON.stringify(input);let resolved=model.resolveQuotationFields(input);
 assert.equal(resolved.rows[1].fields.weight.value,'0.3 kg');assert.equal(resolved.rows[1].fields.weight.source,'option');
 assert.equal(resolved.rows[1].fields.packagedWeightG.value,'');assert.equal(resolved.rows[0].fields.weight.source,'couplus-default');
 const assets=JSON.parse(input.product.image_keys).map((key,index)=>({key,name:`assets/${index}.png`}));
 assert.equal(load('app/exports/quotation-fields.ts').resolvedQuotationRows(input,resolved,assets)[0].weight,'0.3 kg');assert.equal(JSON.stringify(input),before);
 input.options.rows[0].unitsPerPack=3;assert.equal(model.resolveQuotationFields(input).rows[1].fields.weight.value,'0.3 kg');
 input.overrides={common:{weight:'공통 중량'},options:{red:{weight:''}}};resolved=model.resolveQuotationFields(input);
 assert.equal(resolved.rows[1].fields.weight.value,'');assert.equal(resolved.rows[1].fields.weight.source,'manual-option');
 delete input.overrides.options.red;assert.equal(model.resolveQuotationFields(input).rows[1].fields.weight.value,'공통 중량');
 input.overrides=model.emptyQuotationOverrides();input.options.rows[0].weightKg=null;input.options.rows[0].provenance.weightKg='manual';
 assert.equal(model.resolveQuotationFields(input).rows[1].fields.weight.value,'');assert.equal(model.resolveQuotationFields(input).rows[1].fields.weight.source,'option');
 input.options.rows[0].provenance.weightKg='unverified';assert.equal(model.resolveQuotationFields(input).rows[1].fields.weight.source,'couplus-default');
 input.categoryId='81452';resolved=model.resolveQuotationFields(input);assert.equal(resolved.rows[1].fields.packagedWeightG.value,'');assert.equal(resolved.rows[1].fields.brace_noticeSizeWeight.value,input.content.label.dimensions.value);
});

test('reviewed label translations flow to quotation, label document and export while quotation overrides win',()=>{
 const input=fixture();input.content=contentModel.emptyProductContent('p1');
 const job={productId:'p1',productVersion:input.product.updated_at,status:'completed',review:{source:{attributes:[{name:'상품속성: 材质',value:'棉'}]}},result:{draft:{attributes:[{sourceIndex:0,name:'재질',value:'면'}]}}};
 const plan=load('app/translation-label-adoption.ts').translationLabelAdoption(input.content,job,input.product.updated_at,[{sourceIndex:0,field:'material'}]);
 input.content=contentModel.applyContentPatch(input.content,plan.input.patch,'now');
 const resolved=model.resolveQuotationFields(input);assert.equal(resolved.rows[1].fields.noticeMaterial.value,'면');assert.equal(resolved.rows[1].fields.noticeMaterial.source,'content');
 const doc=load('app/document-image.ts').documentImagePlan('label',input.content,{productId:'p1'});assert.equal(doc.rows.find(row=>row[0]==='재질')[1],'면');
 const assets=JSON.parse(input.product.image_keys).map((key,index)=>({key,name:`assets/${index}.png`}));assert.equal(load('app/exports/quotation-fields.ts').resolvedQuotationRows(input,resolved,assets)[0].noticeMaterial,'면');
 input.overrides={common:{noticeMaterial:'견적 수동값'},options:{}};assert.equal(model.resolveQuotationFields(input).rows[1].fields.noticeMaterial.value,'견적 수동값');
});

const categoryEvidence=JSON.parse(fs.readFileSync(new URL('../docs/supplier-hub-product-schemas-2026-09-23.json',import.meta.url),'utf8'));
test('material display choices become exact wire values without changing text notices or inventing unsupported materials',()=>{
 let covered=0;
 for(const categoryId of [...categoryEvidence.records.map(record=>record.categoryId),'64497','103495','77442','81452']){
  const input=fixture();input.categoryId=categoryId;
  const fields=model.getQuotationSchema(categoryId).fields.filter(field=>field.type==='select'&&(field.contentField==='material'||field.id==='storageMaterial'));
  for(const field of fields){
   covered++;input.content=contentModel.applyContentPatch(input.content,{label:{material:'해당사항없음'}},'now');
   const before=JSON.stringify(input);let resolved=model.resolveQuotationFields(input);
   assert.equal(resolved.rows[1].fields[field.id].value,'',`${categoryId}/${field.id}`);
   assert.equal(resolved.rows[1].fields[field.id].source,'content');assert.equal(resolved.rows[1].fields[field.id].validationIssues.length,0);
   if(resolved.rows[1].fields.noticeMaterial)assert.equal(resolved.rows[1].fields.noticeMaterial.value,'해당사항없음');
   const assets=JSON.parse(input.product.image_keys).map((key,index)=>({key,name:`assets/${index}.png`}));
   assert.equal(load('app/exports/quotation-fields.ts').resolvedQuotationRows(input,resolved,assets)[0][field.id],'');assert.equal(JSON.stringify(input),before);
   input.content=contentModel.applyContentPatch(input.content,{label:{material:'확인 필요 복합재질'}},'later');
   resolved=model.resolveQuotationFields(input);assert.equal(resolved.rows[1].fields[field.id].value,'확인 필요 복합재질');assert.ok(resolved.rows[1].fields[field.id].validationIssues.length>0);
   input.overrides={common:{[field.id]:'직접 수정'},options:{red:{[field.id]:''}}};resolved=model.resolveQuotationFields(input);assert.equal(resolved.rows[1].fields[field.id].source,'manual-option');assert.equal(resolved.rows[1].fields[field.id].value,'');
   input.overrides=model.emptyQuotationOverrides();
  }
 }
 assert.ok(covered>1);
});

test('saved marathon model reaches model-number attribute and export but never compatibility or manufacturer part numbers',()=>{
 const input=fixture();input.categoryId='103495';input.content=contentModel.applyContentPatch(input.content,{label:{model:'MODEL-172'}},'now');
 const before=JSON.stringify(input);let resolved=model.resolveQuotationFields(input);
 assert.equal(resolved.rows[1].fields.model.value,'MODEL-172');assert.equal(resolved.rows[1].fields.marathon_modelNumber.value,'MODEL-172');assert.equal(resolved.rows[1].fields.marathon_modelNumber.source,'content');
 const assets=JSON.parse(input.product.image_keys).map((key,index)=>({key,name:`assets/${index}.png`}));
 assert.equal(load('app/exports/quotation-fields.ts').resolvedQuotationRows(input,resolved,assets)[0].marathon_modelNumber,'MODEL-172');assert.equal(JSON.stringify(input),before);
 for(const id of ['marathon_parentPart','marathon_part'])assert.equal(resolved.rows[1].fields[id].value,'');
 input.overrides={common:{marathon_modelNumber:'공통'},options:{red:{marathon_modelNumber:''}}};resolved=model.resolveQuotationFields(input);assert.equal(resolved.rows[1].fields.marathon_modelNumber.value,'');assert.equal(resolved.rows[0].fields.marathon_modelNumber.value,'공통');
 input.overrides=model.emptyQuotationOverrides();input.content=contentModel.applyContentPatch(input.content,{label:{model:''}},'later');resolved=model.resolveQuotationFields(input);assert.equal(resolved.rows[1].fields.marathon_modelNumber.value,'');assert.equal(resolved.rows[1].fields.marathon_modelNumber.source,'content');
 input.categoryId='80706';input.content=contentModel.applyContentPatch(input.content,{label:{model:'MODEL-172'}},'later');resolved=model.resolveQuotationFields(input);const compatibility=resolved.schema.fields.find(field=>field.label==='호환모델');assert.ok(compatibility);assert.equal(resolved.rows[1].fields[compatibility.id].value,'');
});

test('saved components populate exact observed included-components fields, exports and manual clears',()=>{
 const ids=[...categoryEvidence.records.map(record=>record.categoryId),'81452','103495','64497','77442'];
 let checked=0;
 for(const id of ids){
  const input=fixture();input.categoryId=id;
  const schema=model.getQuotationSchema(id);
  const field=schema.fields.find(field=>field.section==='product'&&field.visibility==='hidden'&&field.label==='포함 구성 요소'&&field.type==='select');
  if(!field)continue;
  checked++;
  input.content=contentModel.applyContentPatch(input.content,{label:{components:'본품'}},'now');
  const before=JSON.stringify(input);let resolved=model.resolveQuotationFields(input);
  assert.equal(resolved.rows[1].fields[field.id].value,'본품',id);
  assert.equal(resolved.rows[1].fields[field.id].source,'content',id);
  const assets=JSON.parse(input.product.image_keys).map((key,index)=>({key,name:`assets/${index}.png`}));
  assert.equal(load('app/exports/quotation-fields.ts').resolvedQuotationRows(input,resolved,assets)[0][field.id],'본품',id);
  assert.equal(JSON.stringify(input),before);
  input.overrides={common:{[field.id]:'설명서'},options:{red:{[field.id]:''}}};
  resolved=model.resolveQuotationFields(input);assert.equal(resolved.rows[1].fields[field.id].value,'');assert.equal(resolved.rows[1].fields[field.id].source,'manual-option');
  delete input.overrides.options.red;assert.equal(model.resolveQuotationFields(input).rows[1].fields[field.id].value,'설명서');
  input.overrides=model.emptyQuotationOverrides();input.content=contentModel.applyContentPatch(input.content,{label:{components:''}},'later');
  resolved=model.resolveQuotationFields(input);assert.equal(resolved.rows[1].fields[field.id].value,'');assert.equal(resolved.rows[1].fields[field.id].source,'content');
  input.content=contentModel.applyContentPatch(input.content,{label:{components:'해당사항없음'}},'later');
  resolved=model.resolveQuotationFields(input);assert.equal(resolved.rows[1].fields[field.id].value,'');assert.equal(resolved.rows[1].fields[field.id].source,'content');
  input.content=contentModel.applyContentPatch(input.content,{label:{components:'본체 1개 / 파우치 1개'}},'later');
  resolved=model.resolveQuotationFields(input);assert.equal(resolved.rows[1].fields[field.id].value,'본체 1개 / 파우치 1개');assert.ok(resolved.rows[1].fields[field.id].validationIssues.some(issue=>issue.includes('선택값')));
 }
 assert.ok(checked>0);
 const unknown=fixture();unknown.categoryId='999999';assert.ok(!model.getQuotationSchema(unknown.categoryId).fields.some(field=>field.contentField==='components'));
});

test('all recorded Hub categories reject invalid inherited existing barcodes before saving',()=>{
 for(const record of categoryEvidence.records){
  const input=fixture();input.categoryId=record.categoryId;
  input.overrides={common:{barcodeMode:'existing',barcode:'ABC123'},options:{red:{barcode:'ABC456'}}};
  assert.throws(()=>model.validateQuotationChanges([change('barcode','abc456','red')],context(input)),/바코드/,record.categoryId);
  assert.doesNotThrow(()=>model.validateQuotationChanges([change('barcode','ABC789','red')],context(input)));
  assert.doesNotThrow(()=>model.validateQuotationChanges([change('barcode','', 'red')],context(input)));
 }
});
for(const record of categoryEvidence.records){
 test(`recorded Hub ${record.categoryId}: every exposed/hidden/notice field and select wire value matches`,()=>{
  const schema=model.getQuotationSchema(record.categoryId);const normalize=value=>JSON.parse(JSON.stringify(value));
  assert.deepEqual(normalize(schema.categoryPath),record.path);
  const boundary=record.columns.findIndex(column=>column.label==='공급가 *');assert.ok(boundary>0);
  const exposed=record.columns.slice(0,boundary).map(column=>({label:column.label.replace(/\s*\*\s*$/,''),required:column.label.endsWith('*')}));
  assert.deepEqual(normalize(schema.fields.filter(f=>f.visibility==='exposed').map(f=>({label:f.label,required:f.required}))),exposed);
  const hidden=schema.fields.filter(f=>f.visibility==='hidden');assert.equal(hidden.length,record.hidden.length);
  for(const observed of record.hidden){const fields=hidden.filter(f=>f.label===observed.label);assert.equal(fields.length,1,observed.label);const field=fields[0];assert.equal(field.type,observed.type==='input'?'text':observed.type);
   if(observed.type==='select')assert.deepEqual(normalize(field.choices.map(c=>[c.value,c.label])),observed.choices.map(c=>[c.value,c.label]),observed.label);
  }
  const actualNotices=schema.fields.filter(f=>f.section==='legal'&&f.id.startsWith('notice')).map(f=>f.label);
  assert.deepEqual(normalize(actualNotices),record.noticeLabels??[]);
  assert.equal(schema.maxIncludedOptions,record.maxIncludedOptions);assert.equal(schema.submissionReady,false);
 });
 test(`recorded Hub ${record.categoryId}: stage values and manual overrides survive final quotation export`,()=>{
  const input=fixture();input.categoryId=record.categoryId;input.product.image_keys=JSON.stringify([...JSON.parse(input.product.image_keys),'owner/additional.png']);
  input.content=contentModel.applyContentPatch(input.content,{seo:{title:'검토 상품',keywords:['확인키워드'],description:'확인 설명'},label:{material:'확인 재질',countryOfOrigin:'중국',components:'본품 1개',releaseDate:'2026-09',qualityAssurance:'확인 보증',contact:'확인 연락처'},assets:{additional:['owner/additional.png'],label:['owner/option.png']}},'now');
  input.options.rows[0].color='검정';input.options.rows[0].size='Free';const snapshot=JSON.stringify(input);
  const resolved=model.resolveQuotationFields(input),row=resolved.rows.find(r=>r.optionId==='red');
  for(const [key,value] of Object.entries({title:'검토 상품',searchTags:'확인키워드',color:'검정',quantity:'1',mainImage:'owner/option.png',additionalImages:'owner/additional.png',labelImages:'owner/option.png',noticeMaterial:'확인 재질',noticeCountryOfOrigin:'중국',noticeComponents:'본품 1개',noticeReleaseDate:'2026-09',noticeQualityAssurance:'확인 보증',noticeServiceContact:'확인 연락처'}))assert.equal(row.fields[key]?.value,value,key);
  assert.ok(Number(row.fields.supplyPrice.value)>0);assert.ok(Number(row.fields.salePrice.value)>0);
  const assets=JSON.parse(input.product.image_keys).map((key,index)=>({key,name:`assets/${index}.png`}));const rows=load('app/exports/quotation-fields.ts').resolvedQuotationRows(input,resolved,assets);
  assert.equal(rows.length,1);assert.equal(rows[0].title,'검토 상품');assert.equal(rows[0].noticeMaterial,'확인 재질');assert.equal(rows[0].mainImage,'1.png');assert.equal(rows[0].labelImages,'1.png');assert.equal(JSON.stringify(input),snapshot);
  input.overrides={common:{noticeMaterial:'공통 재질',title:'견적 이름'},options:{red:{noticeMaterial:''}}};let changed=model.resolveQuotationFields(input);assert.equal(changed.rows[1].fields.noticeMaterial.value,'');assert.equal(changed.rows[1].fields.title.value,'견적 이름');
  input.overrides=model.emptyQuotationOverrides();input.content=contentModel.applyContentPatch(input.content,{label:{material:''}},'later');changed=model.resolveQuotationFields(input);assert.equal(changed.rows[1].fields.noticeMaterial.value,'');assert.equal(changed.rows[1].fields.noticeMaterial.source,'content');
 });
}


for(const id of ['81452','103495','64497','77442'])test(`recorded Hub ${id}: observed product dropdown wire values match the category form`,()=>{
 const evidence=JSON.parse(fs.readFileSync(new URL(`../docs/supplier-hub-${id}-product-2026-09-24.json`,import.meta.url),'utf8'));
 const schema=model.getQuotationSchema(id);const actual=schema.fields.filter(f=>f.section==='product'&&f.visibility==='hidden'&&f.type==='select').map(f=>f.choices.map(c=>[c.value,c.label]));
 const selects=evidence.selects??evidence.selectsInDisplayedOrder;
 const sorted=list=>[...list].sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)));assert.deepEqual(clone(actual.map(sorted)),selects.map(list=>sorted(list.map(c=>[c.value,c.label]))));
 // Couplus omits the space in this one observed display label. Keep both
 // exact paths explicit: do not broadly normalize potentially distinct leaves.
 if(id==='64497'){
  assert.deepEqual(evidence.path,['생활용품','욕실용품','욕실수납/정리','양치용품 정리']);
  assert.deepEqual(clone(schema.categoryPath),['생활용품','욕실용품','욕실수납/정리','양치용품정리']);
 }else assert.deepEqual(clone(schema.categoryPath),evidence.path);
 assert.equal(schema.categoryId,id);assert.equal(schema.submissionReady,false);
});

test('equivalent translated headings reach category quotation notices without replacing manual overrides',()=>{
 const categories=[...new Set([...Object.keys(load('app/hub-product-schemas.ts').hubProductSchemas),'80719','81452','64497','103495','77442'])];let checked=0;
 for(const categoryId of categories){
  const input=fixture();input.categoryId=categoryId;input.content=contentModel.emptyProductContent('p1');
  const job={productId:'p1',productVersion:'v',status:'completed',review:{source:{attributes:[{name:'상품속성: 材质'},{name:'상품속성: 配件'}]}},result:{draft:{title:'상품명',keywords:[],description:'',attributes:[{sourceIndex:0,name:'소재',value:'면'},{sourceIndex:1,name:'구성품',value:'본체 1개'}]}}};
  const plan=load('app/translation-batch-adoption.ts').translationBatchAdoption(input.content,job,'v');input.content=contentModel.applyContentPatch(input.content,plan.input.patch,'now');
  let resolved=model.resolveQuotationFields(input);const row=resolved.rows.find(r=>r.optionId==='red');
  if(row.fields.noticeMaterial){checked++;assert.equal(row.fields.noticeMaterial.value,'면');input.overrides={common:{noticeMaterial:''},options:{}};resolved=model.resolveQuotationFields(input);assert.equal(resolved.rows.find(r=>r.optionId==='red').fields.noticeMaterial.value,'');}
  if(row.fields.noticeComponents)assert.equal(row.fields.noticeComponents.value,'본체 1개');
 }
 assert.equal(categories.length,26);assert.ok(checked>=22);
});

test('Excel mapping coverage includes explicit automatic empty choices but not genuinely unset cells',()=>{
 const coverage=load('app/exports/quotation-fields.ts').quotationMappingCoverage;
 const field={id:'storageMaterial',label:'재질',type:'select',required:false,choices:[{value:'',label:'해당사항없음'}]};
 const row=(id,source,included=true)=>({optionId:id,optionLabel:id,included,fields:{storageMaterial:{value:'',source}}});
 const resolved={schema:{fields:[field]},rows:[row('default','couplus-default'),row('content','content'),row('unset','empty'),row('manual','manual-option'),row('excluded','content',false)]};
 const before=JSON.stringify(resolved), result=coverage(resolved,{mappings:[]});
 assert.equal(result.length,1);assert.deepEqual(clone(result[0].automaticOptions.map(o=>o.optionId)),['default','content']);assert.deepEqual(clone(result[0].manualOptions.map(o=>o.optionId)),['manual']);
 assert.equal(coverage(resolved,{mappings:[{field:'storageMaterial'}]}).length,0);assert.equal(JSON.stringify(resolved),before);
 for(const change of [{type:'text'},{choices:[{value:'yes',label:'예'}]}])assert.equal(coverage({schema:{fields:[{...field,...change}]},rows:[row('a','content')]},{mappings:[]}).length,0);
});
