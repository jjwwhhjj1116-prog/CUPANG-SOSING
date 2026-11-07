import test from 'node:test';
import assert from 'node:assert/strict';
import { module, plain, syntheticSnapshot } from './helpers/supplier-hub-single-projection.mjs';

const { proposeProductName, supplierHubDisplayedProductName, supplierHubProductNameIssue } = module('app/product-name-proposal.ts');
const base = '유앤채 실리콘 필라테스 양말';
const option = (attributeName, attributeValue) => ({ attributeName, attributeValue });

test('option proposals put the verified size and selling count after color', () => {
  const input = { brand: '유앤채', productName: base, color: '그린', size: '均码', count: 1, quantity: '' };
  assert.equal(proposeProductName(input).value, base + ' 그린 Free 1개');
  assert.equal(proposeProductName({ ...input, productName: base + ' 그린 Free 1개' }).value, base + ' 그린 Free 1개');
  assert.equal(proposeProductName({ ...input, productName: '실리콘 필라테스 양말 2개', color: '블랙', size: 'M', count: 2 }).value, base + ' 블랙 M 2개');
  assert.equal(proposeProductName({ ...input, count: 4, quantity: '4켤레' }).value, base + ' 그린 Free 4켤레');
  assert.equal(proposeProductName({ ...input, count: 1, quantity: '50개' }).value, base + ' 그린 Free 1개');
  for (const size of ['', '해당사항없음', '해당 없음', '상세페이지 참조'])
    assert.deepEqual(plain(proposeProductName({ ...input, size })), { value: '', missing: ['사이즈'] });
});

test('the live quotation builds a proposal from saved options without rewriting the Hub body fields', () => {
  const snapshot = syntheticSnapshot(), raw = JSON.parse(snapshot.schemaString);
  const named = label => ({ contains: { type: 'object', required: ['attributeName', 'attributeValue'], properties: {
    attributeName: { type: 'string', enum: [label], requirement: '필수' }, attributeValue: { type: 'string' },
  } } });
  raw.properties.productPage.properties.commonAttributes.properties.exposedAttributes.allOf.push(named('패션의류/잡화 사이즈'));
  raw.properties.productPage.properties.unexposedAttributes.allOf.push(named('수량'));
  snapshot.schemaString = JSON.stringify(raw);
  const model = module('app/quotation-schema.ts'), content = module('app/product-content.ts').emptyProductContent('p1');
  content.seo.title.value = base;
  const optionsModel = module('app/product-options.ts');
  const options = optionsModel.applyOptionRows(optionsModel.emptyProductOptions('p1'), [
    { ...optionsModel.emptyOptionInput('green'), color: '검정', size: 'FREE', unitsPerPack: 1, included: true },
  ], '2026-11-07T01:00:00Z');
  const input = {
    categoryId: snapshot.categoryId, categoryPath: snapshot.categoryPath, hubSchema: snapshot, content, options,
    product: { id: 'p1', title: base, image_keys: '[]', supply_price: 1000, sale_price: 2000 },
    settings: { ...module('app/workspace-settings.ts').defaultSettings, brand: '유앤채' },
  };
  const resolved = model.resolveQuotationFields(input), row = resolved.rows[1];
  const size = resolved.schema.fields.find(field => field.hubWire?.name === '패션의류/잡화 사이즈');
  const hiddenQuantity = resolved.schema.fields.find(field => field.hubWire?.name === '수량');
  assert.equal(row.productNameProposal.value, base + ' 검정 Free 1개');
  assert.equal(row.fields.title.value, base);
  assert.equal(row.fields[size.id].value, '해당사항없음');
  assert.equal(row.fields[hiddenQuantity.id].value, '');
  const color = resolved.schema.fields.find(field => field.hubWire?.name === '색상');
  options.rows[0].color = '';
  options.rows[0].provenance.color = 'unverified';
  input.generatedAdoption = { policy: 'owned-job-facts-v1', sourceBasis: 'a'.repeat(64),
    entries: [{ jobId: 'fixture-job', optionId: 'green', fieldKey: color.id, value: '검정' }] };
  const withSavedColor = model.resolveQuotationFields(input).rows[1];
  assert.equal(withSavedColor.fields[color.id].source, 'generated');
  assert.equal(withSavedColor.productNameProposal.value, base + ' 검정 Free 1개');
  const change = value => [{ fieldKey: size.id, optionId: 'green', value }];
  const context = { schema: resolved.schema, optionIds: ['green'] };
  assert.throws(() => model.validateQuotationChanges(change('해당 사항 없음'), context), /실제 사이즈/);
  const [saved] = model.validateQuotationChanges(change('M'), context);
  input.overrides = { common: {}, options: { green: { [saved.fieldKey]: saved.value } } };
  assert.equal(model.resolveQuotationFields(input).rows[1].productNameProposal.value, base + ' 검정 M 1개');
});

test('new Hub submissions reject placeholder title values without touching archived data or legal notices', () => {
  const document = { startPage: { productName: base }, productPage: {
    commonAttributes: { exposedAttributes: [option('색상', '그린'), option('패션의류/잡화 사이즈', '해당사항없음')] },
    unexposedAttributes: [option('수량', '1개')],
  }, legalPage: { notices: [{ noticeItemValue: '해당사항없음' }] } };
  const saved = JSON.stringify(document);
  assert.match(supplierHubProductNameIssue([document]), /실제 사이즈/);
  assert.equal(supplierHubDisplayedProductName(document), '');
  assert.equal(JSON.stringify(document), saved);
  document.productPage.commonAttributes.exposedAttributes[1].attributeValue = 'Free';
  assert.equal(supplierHubProductNameIssue([document]), '');
  assert.equal(supplierHubDisplayedProductName(document), base + ' 그린 Free');
  document.productPage.commonAttributes.exposedAttributes.push(option('수량', '1개'));
  assert.equal(supplierHubDisplayedProductName(document), base + ' 그린 Free 1개');
});

test('a color in the option name fills the required exposed field and native title without overriding saved choices', () => {
  const snapshot = syntheticSnapshot(), raw = JSON.parse(snapshot.schemaString);
  const colorSchema = raw.properties.productPage.properties.commonAttributes.properties.exposedAttributes.allOf[0].contains.properties;
  colorSchema.attributeValue = { type: 'string' };
  snapshot.categoryId = '80025';
  snapshot.nativeSerializationPolicy = 'supplier-hub-native-required-form-v1';
  snapshot.schemaString = JSON.stringify(raw);
  const title = '유앤채 다용도 책상 정리 펜홀더';
  const content = module('app/product-content.ts').emptyProductContent('p1');
  content.quotationWorkflow = 'collected-native-v1';
  content.seo.title.value = title;
  const optionsModel = module('app/product-options.ts'), model = module('app/quotation-schema.ts');
  const options = optionsModel.applyOptionRows(optionsModel.emptyProductOptions('p1'), [
    { ...optionsModel.emptyOptionInput('pen'), originalName: '纯白笔筒', translatedName: '순백색 펜통', included: true },
  ], '2026-11-08T00:00:00Z');
  const input = {
    categoryId: snapshot.categoryId, categoryPath: snapshot.categoryPath, hubSchema: snapshot, content, options,
    product: { id: 'p1', title, image_keys: '[]', supply_price: 1000, sale_price: 2000 },
    settings: { ...module('app/workspace-settings.ts').defaultSettings, brand: '유앤채' },
  };
  const resolve = () => model.resolveQuotationFields(input);
  const initial = resolve();
  const color = initial.schema.fields.find(field => field.visibility === 'exposed' && field.hubWire?.name === '색상');
  assert.equal(color.required, true);
  assert.equal(initial.rows[0].fields[color.id].value, '');
  assert.equal(initial.rows[1].fields[color.id].value, '화이트');
  assert.deepEqual(plain(initial.rows[1].fields[color.id].validationIssues), []);
  assert.equal(initial.rows[1].productNameProposal.value, title + ' 화이트');
  assert.equal(options.rows[0].color, '');

  // Preserve exact official wire values and do not guess an ambiguous or unavailable choice.
  colorSchema.attributeValue.enum = ['흰색', '검정'];
  snapshot.schemaString = JSON.stringify(raw);
  assert.equal(resolve().rows[1].productNameProposal.value, title + ' 흰색');
  colorSchema.attributeValue.enum = ['화이트', '흰색'];
  snapshot.schemaString = JSON.stringify(raw);
  assert.equal(resolve().rows[1].fields[color.id].value, '');
  colorSchema.attributeValue.enum = ['검정'];
  snapshot.schemaString = JSON.stringify(raw);
  assert.equal(resolve().rows[1].fields[color.id].value, '');
  delete colorSchema.attributeValue.enum;
  snapshot.schemaString = JSON.stringify(raw);

  options.rows[0].translatedName = '순백색 / 블랙 펜통';
  assert.equal(resolve().rows[1].fields[color.id].value, '');
  options.rows[0].translatedName = '블랙 펜통';
  assert.equal(resolve().rows[1].fields[color.id].value, '');
  options.rows[0].translatedName = '순백색 펜통';
  options.rows[0].originalName = '白色/黑色笔筒';
  assert.equal(resolve().rows[1].fields[color.id].value, '');
  options.rows[0].originalName = '白色混色笔筒';
  assert.equal(resolve().rows[1].fields[color.id].value, '');
  options.rows[0].originalName = '粉色笔筒';
  options.rows[0].translatedName = '';
  assert.equal(resolve().rows[1].productNameProposal.value, title + ' 핑크');
  options.rows[0].originalName = '黑色笔筒收纳';
  options.rows[0].translatedName = '검은색 펜꽂이';
  assert.equal(resolve().rows[1].productNameProposal.value, title + ' 블랙');
  options.rows[0].originalName = '咖色笔筒收纳';
  options.rows[0].translatedName = '카라펜홀더수납';
  assert.equal(resolve().rows[1].productNameProposal.value, title + ' 커피');
  options.rows[0].originalName = '';
  options.rows[0].translatedName = '펜통 (순백색)';
  assert.equal(resolve().rows[1].productNameProposal.value, title + ' 화이트');
  options.rows[0].translatedName = '오렌지 껍질 제거기';
  assert.equal(resolve().rows[1].fields[color.id].value, '');
  options.rows[0].translatedName = '펜통 (순백색)';
  options.rows[0].originalName = '纯白笔筒';
  options.rows[0].color = '검정';
  options.rows[0].provenance.color = 'manual';
  assert.equal(resolve().rows[1].productNameProposal.value, title + ' 검정');
  options.rows[0].color = '';
  assert.equal(resolve().rows[1].fields[color.id].value, '');
  options.rows[0].provenance.color = 'unverified';
  input.overrides = { common: {}, options: { pen: { [color.id]: '' } } };
  const cleared = resolve().rows[1];
  assert.equal(cleared.fields[color.id].source, 'manual-option');
  assert.equal(cleared.fields[color.id].value, '');
  assert.deepEqual(plain(cleared.productNameProposal.missing), ['색상']);
  input.overrides.options.pen[color.id] = '검정';
  assert.equal(resolve().rows[1].productNameProposal.value, title + ' 검정');
  delete input.overrides;
  delete content.quotationWorkflow;
  options.rows[0].size = 'Free';
  assert.equal(resolve().rows[1].productNameProposal.value, title + ' 화이트 Free 1개');
  colorSchema.attributeName.enum = ['재질'];
  snapshot.schemaString = JSON.stringify(raw);
  const unrelated = resolve();
  const material = unrelated.schema.fields.find(field => field.visibility === 'exposed' && field.hubWire?.name === '재질');
  assert.equal(unrelated.rows[1].fields[material.id].value, '해당사항없음');
});

test('the preview follows the exposed order and preserves legitimate zero and false choices', () => {
  const document = { startPage: { productName: base }, productPage: {
    commonAttributes: { exposedAttributes: [option('형태', '원형'), option('수량', 0)] },
    exposedAttributes: [{ name: '특성', value: false }],
  } };
  assert.equal(supplierHubProductNameIssue([document]), '');
  assert.equal(supplierHubDisplayedProductName(document), base + ' 원형 0 false');
});

test('every present exposed entry requires a real value regardless of hidden attributes or legal notices', () => {
  const common = [option('형태', '원형')], exposed = [];
  const document = { startPage: { productName: base }, productPage: {
    commonAttributes: { exposedAttributes: common }, exposedAttributes: exposed,
    unexposedAttributes: [option('사이즈', '상세페이지 참조'), option('재질', null)],
  }, legalPage: { notices: [{ noticeItemName: '품명', noticeItemValue: '해당사항없음' }] } };
  assert.equal(supplierHubProductNameIssue([document]), '');
  assert.equal(supplierHubDisplayedProductName(document), base + ' 원형');

  for (const value of [undefined, null, '', ' \t', 'N/A', 'Not applicable', '해당 사항 없음',
    '상세참조', '상세 페이지 참조', '상품 상세정보 참고', 'See product details', '미입력']) {
    const missing = value === undefined ? { attributeName: '색상' } : option('색상', value);
    for (const attributes of [common, exposed]) {
      attributes.push(missing);
      const saved = JSON.stringify(document);
      assert.match(supplierHubProductNameIssue([document]), /노출 속성.*색상.*실제 옵션값/, String(value));
      assert.equal(supplierHubDisplayedProductName(document), '');
      assert.equal(JSON.stringify(document), saved);
      attributes.pop();
    }
  }
});
