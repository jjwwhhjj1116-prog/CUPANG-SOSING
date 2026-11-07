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
