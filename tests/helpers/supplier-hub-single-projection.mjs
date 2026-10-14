import { providedOptionModule } from './provided-option-quotation.mjs';
import { mobileIntakeHarness } from './mobile-intake.mjs';

export const companies = [{ code: 'A01526306', name: '유앤채' }, { code: 'A01464742', name: '와이홉' }];
export const categoryPath = ['스포츠/레져', '헬스/요가', '헬스기구/용품', '헬스보호대'];
export const plain = value => JSON.parse(JSON.stringify(value));
export const module = providedOptionModule;
const object = (properties, required = []) => ({ type: 'object', properties, required });
const named = (nameKey, valueKey, entries) => ({ type: 'array', items: {}, allOf: entries.map(([name, value]) => ({ contains: object({
  [nameKey]: { type: 'string', enum: [name], requirement: '필수' }, [valueKey]: value,
}, [nameKey, valueKey]) })) });
export function syntheticSnapshot(company = companies[0]) {
  const raw = object({
    startPage: object({ productName: { type: 'string', title: '상품명', minLength: 1 }, categoryPath: { type: 'string', title: '카테고리', minLength: 1 } }, ['productName', 'categoryPath']),
    productPage: object({ modelNumber: { type: ['string', 'null'], title: '모델명', maxLength: 60 }, brand: { type: 'string', title: '브랜드' },
      commonAttributes: object({ purchasePrice: { type: 'string', title: '공급가' }, coupangSalePrice: { type: 'string', title: '판매가' }, msrp: { type: ['string', 'null'], title: '정상가' },
        count: { type: 'integer', title: '합성 정수', minimum: 0 }, booleanValue: { type: 'boolean', title: '합성 불리언' },
        exposedAttributes: named('attributeName', 'attributeValue', [['색상', { type: 'string', enum: ['검정', '흰색'] }]]),
      }),
      unexposedAttributes: named('attributeName', 'attributeValue', [['문자 선택', { type: ['string', 'null'], enum: ['0', 'false', null] }], ['수동 공란', { type: ['string', 'null'] }], ['null 선택', { type: ['string', 'null'], enum: ['선택', null] }]]),
    }),
    imagePage: object({ images: object({ mainImage: { type: 'string', title: '대표이미지 파일명' }, additionalImage: { type: ['string', 'null'], title: '추가이미지 파일명' },
      labelImages: named('labelImageType', 'labelImageFiles', [['한글표시사항', { type: 'string' }]]), }),
      details: object({ detailedImage: { type: 'string', title: '상세이미지 파일명' }, htmlProductDetailContent: { type: ['string', 'null'], title: 'HTML 상품 상세 컨텐츠' } }),
      msrpAgree: { type: 'boolean', title: '가격 자료 동의', default: true }, labelContactAgreed: { type: 'boolean', title: '표시사항 연락처 동의', default: true },
    }),
    legalPage: object({ notices: named('noticeItemName', 'noticeItemValue', [['품명 및 모델명', { type: 'string' }], ['소재', { type: 'string' }]]) }),
    logisticsPage: object({ totalSKUsInBox: { type: 'integer', title: '박스 내 SKU 수량' } }),
    sourcingPage: { ...object({ sourcingChannelType: { type: ['string', 'null'], hidden: true, requirement: '선택' }, sourcingChannelId: { type: ['string', 'null'], hidden: true, requirement: '선택' } }, ['sourcingChannelType', 'sourcingChannelId']), hidden: true },
  }, ['startPage', 'productPage', 'imagePage', 'legalPage', 'logisticsPage', 'sourcingPage']);
  raw.metadata = 'scope:Retail_Categorized_Single;categoryId:765432;version:188;productNoticeName:합성 고시;productNoticeCategoryId:25';
  return { format: 'supplier-hub-schema-v1', categoryId: '81452', categoryPath: [...categoryPath], company: { ...company }, observedAt: Date.now(), schemaString: JSON.stringify(raw),
    metadata: { kanCategoryId: 765432, noticeNumber: 25, scopeType: 'Retail_Categorized_Single', version: 188 }, draftInitialization: 'couplus-required-v1', inputBindings: 'couplus-paths-v1', settingsInitialization: 'couplus-options-v1' };
}
export function projectionFixture(snapshot = syntheticSnapshot()) {
  const schema = module('app/quotation-schema.ts').getQuotationSchema(snapshot.categoryId, snapshot.categoryPath, snapshot);
  const fields = Object.fromEntries(schema.fields.map(field => [field.id, { value: '', source: 'empty', needsReview: true, issues: [], validationIssues: [] }]));
  const row = { optionId: 'synthetic-one', optionLabel: '검정', included: true, fields };
  const resolved = { schema, rows: [row], issues: [], reviewMessages: [], validationIssues: [] };
  const set = (path, name, value, source = 'manual-option') => {
    const field = schema.fields.find(field => JSON.stringify(field.hubWire?.path) === JSON.stringify(path) && field.hubWire?.name === name);
    if (!field) throw Error('Fixture exact wire absent: ' + path.join('.') + ':' + name);
    fields[field.id] = { value, source, needsReview: true, issues: [], validationIssues: [] }; return field.id;
  };
  set(['startPage', 'productName'], undefined, '검토 상품, 검정');
  set(['startPage', 'categoryPath'], undefined, categoryPath.join(' > ') + ' (81452)', 'schema');
  set(['productPage', 'modelNumber'], undefined, '');
  set(['productPage', 'brand'], undefined, '합성 브랜드');
  set(['productPage', 'commonAttributes', 'purchasePrice'], undefined, '11960');
  set(['productPage', 'commonAttributes', 'coupangSalePrice'], undefined, '19930');
  set(['productPage', 'commonAttributes', 'msrp'], undefined, '25910');
  return { snapshot, schema, row, resolved, set, input: { snapshot, company: snapshot.company, categoryId: snapshot.categoryId, categoryPath: snapshot.categoryPath, resolved } };
}
export async function apiFixture(company = companies[0], snapshot = syntheticSnapshot(company)) {
  const h = mobileIntakeHarness({ companyCode: company.code, companyName: company.name });
  const now = new Date().toISOString(), id = 'synthetic-document-652';
  const policy = h.load('app/pricing.ts').pricePolicy(h.settings);
  await h.load('db/queries.ts').insertProduct({ id, owner_id: 'owner', source_url: 'synthetic://step652-single-document', title: '合成原文', source_price_cny: 7.1,
    exchange_rate: policy.exchangeRate, supply_margin: policy.supplyMargin, coupang_margin: policy.coupangMargin, supply_price: 11960, sale_price: 19930, msrp: 25910, options_count: 1,
    seo_status: 'pending', image_status: 'pending', quote_status: 'pending', registration_status: 'pending', supplier_hub_status: 'unverified', image_keys: '["owner/main.png","owner/label.png"]',
    goal_stage: 'work', created_at: now, updated_at: now }, policy);
  await h.load('db/queries.ts').saveSettings('owner', JSON.stringify(h.settings));
  const contentModel = h.load('app/product-content.ts'), optionModel = h.load('app/product-options.ts');
  const content = contentModel.applyContentPatch(contentModel.emptyProductContent(id), { seo: { title: '저장한 검토 상품' }, assets: { main: ['owner/main.png'], label: ['owner/label.png'] } }, now);
  await h.load('db/product-content.ts').saveProductContent('owner', content, 0);
  const current = await h.load('db/queries.ts').findProduct('owner', id);
  const options = optionModel.applyOptionRows(optionModel.emptyProductOptions(id), [{ ...optionModel.emptyOptionInput('synthetic-one'), originalName: '黑色', translatedName: '검정', supplierSku: 'SYNTHETIC-652', unitCostCny: 7.1, unitsPerPack: 1, included: true, color: '검정' }], now);
  await h.load('db/product-options.ts').saveProductOptions('owner', options, 0, current.updated_at);
  const profile = await h.load('db/category-profiles.ts').createCategoryProfile('owner', { name: 'SYNTHETIC-SINGLE-DOCUMENT-652', categoryId: '81452', categoryPath: [...categoryPath], template: null, mappings: [], hubSchema: snapshot }, 'synthetic-profile-652');
  if (!profile) throw Error('Profile fixture did not persist');
  const base = '/api/products/' + id, query = '?profileId=' + profile.id;
  const state = () => JSON.stringify(['products', 'product_price_policy', 'product_content', 'product_options', 'product_quotation_fields', 'category_profiles', 'workspace_settings', 'collection_jobs', 'collection_context', 'collection_results', 'supplier_hub_receipts'].map(table => h.sqlite.prepare('SELECT * FROM ' + table).all()));
  return { h, id, profile, snapshot, base, query, state, close: () => h.close() };
}
