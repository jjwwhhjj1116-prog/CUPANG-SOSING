import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { providedOptionModule } from './provided-option-quotation.mjs';
import { syntheticSnapshot, companies } from './supplier-hub-single-projection.mjs';
export { companies };
export const plain = value => JSON.parse(JSON.stringify(value));

export function aiModule({ instantTimeout = false } = {}) {
  const exports = {}, output = ts.transpileModule(fs.readFileSync(new URL('../../app/quotation-ai.ts', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  let timers = 0;
  vm.runInNewContext(output, { exports, Error, Date, TextEncoder, structuredClone,
    setTimeout(callback, delay) { timers++; return instantTimeout ? setTimeout(callback, 0) : setTimeout(callback, delay); }, clearTimeout,
    require(name) { if (name.startsWith('@/app/')) return providedOptionModule(name.slice(2) + '.ts'); throw Error('Non-pure dependency: ' + name); },
    fetch() { throw Error('No network is allowed in AI proposal tests.'); },
  }, { filename: 'app/quotation-ai.ts' });
  return { ...exports, timerCount: () => timers };
}

export function aiFixture({ company = companies[0], count = 2, hidden = true } = {}) {
  const productId = 'synthetic-ai-653', timestamp = new Date().toISOString();
  const contentModel = providedOptionModule('app/product-content.ts'), optionModel = providedOptionModule('app/product-options.ts');
  const settings = { ...providedOptionModule('app/workspace-settings.ts').defaultSettings, hiddenAttributes: hidden };
  const snapshot = syntheticSnapshot(company), raw = JSON.parse(snapshot.schemaString);
  const attr = (name, node) => ({ contains: { type: 'object', required: ['attributeName', 'attributeValue'], properties: {
    attributeName: { type: 'string', enum: [name], requirement: '필수' }, attributeValue: node,
  } } });
  raw.properties.productPage.properties.commonAttributes.properties.exposedAttributes.allOf.push(attr('사이즈', { type: 'string', maxLength: 100 }));
  raw.properties.productPage.properties.unexposedAttributes.allOf.push(attr('재질 종류', { type: 'string', enum: ['실리콘', '면'] }));
  raw.properties.legalPage.properties.notices.allOf.push({ contains: { type: 'object', required: ['noticeItemName', 'noticeItemValue'], properties: {
    noticeItemName: { type: 'string', enum: ['KC 인증정보'], requirement: '필수' }, noticeItemValue: { type: 'string' },
  } } });
  raw.properties.logisticsPage.properties.skuUnitBoxDimension = { type: 'string', title: '포장 크기' };
  raw.properties.logisticsPage.properties.skuUnitBoxWeight = { type: 'string', title: '포장 무게' };
  snapshot.schemaString = JSON.stringify(raw);
  const content = contentModel.emptyProductContent(productId);
  content.seo.title = { value: '합성 보호대', provenance: 'translated', updatedAt: timestamp };
  content.seo.description = { value: '단층 실리콘 보호대 합성 입력', provenance: 'collected', updatedAt: timestamp };
  content.label.material = { value: '실리콘', provenance: 'collected', updatedAt: timestamp };
  const rows = Array.from({ length: count }, (_, index) => ({ ...optionModel.emptyOptionInput(String(index + 1).padStart(8, '0')),
    originalName: index % 2 ? '白色单层' : '黑色单层', translatedName: index % 2 ? '흰색 단층' : '검정 단층', included: true, unitCostCny: 3, unitsPerPack: 1 }));
  const options = optionModel.applyOptionRows(optionModel.emptyProductOptions(productId), rows, timestamp);
  const product = { id: productId, owner_id: 'synthetic-owner-653', source_url: 'synthetic://ai-653', title: '合成保护带', source_price_cny: 3,
    exchange_rate: 190, supply_margin: 40, coupang_margin: 35, supply_price: 5000, sale_price: 8000, msrp: 10400, options_count: count,
    seo_status: 'pending', image_status: 'pending', quote_status: 'pending', registration_status: 'pending', supplier_hub_status: 'unverified', image_keys: '[]',
    goal_stage: 'work', created_at: timestamp, updated_at: timestamp };
  const state = { schemaVersion: 1, productId, revision: 0, overrides: { common: {}, options: {} }, updatedAt: null };
  const profile = { id: 'synthetic-ai-profile-653', revision: 1, name: 'SYNTHETIC-653', categoryId: snapshot.categoryId, categoryPath: [...snapshot.categoryPath], hubSchema: snapshot, template: null, mappings: [] };
  const saved = { product, content, options, settings, state, savedScopes: state, profile,
    categoryContext: { source: 'profile', profileId: profile.id, categoryId: profile.categoryId, categoryPath: [...profile.categoryPath] },
    source: { productVersion: timestamp, imageKeys: '[]', pricingPolicy: null, contentRevision: content.revision, optionRevision: options.revision,
      settingsPayload: JSON.stringify(settings), profile: { id: profile.id, revision: 1 }, collection: null }, company: { ...company }, hubSchema: snapshot, template: null };
  return { saved, snapshot, raw, options, state, product, profile, content, syncSchema() { snapshot.schemaString = JSON.stringify(raw); },
    scope: { optionId: null, applyToAllOptions: true }, excluded() { const row = options.rows.at(-1); row.included = false; return row.id; } };
}
export function mockProvider({ differentName = '색상', mutate } = {}) {
  const calls = [];
  return { calls, async run(model, input) {
    const request = JSON.parse(input.messages[1].content); calls.push({ model, request, input });
    const choose = field => field.choices?.find(choice => choice.value)?.value ?? (field.hubWire.name === '사이즈' ? '단층' : '실리콘');
    let result;
    if (request.task === 'ANALYZE_SCHEMA_ATTRIBUTES') result = { differentiatedFieldIds: request.fields.filter(field => field.hubWire.name === differentName).map(field => field.id) };
    else if (request.task.startsWith('GET_DIFFERENTIATED_ATTRIBUTES_BATCH_')) result = { options: request.targets.map((target, index) => ({ optionId: target.optionId,
      changes: request.fields.filter(field => target.writableFieldIds.includes(field.id)).map(field => ({ fieldKey: field.id, value: field.choices?.[index % field.choices.length]?.value ?? choose(field) })) })) };
    else result = { changes: request.fields.map(field => ({ fieldKey: field.id, value: choose(field) })) };
    return mutate ? mutate(result, request, calls.length) : { response: JSON.stringify(result) };
  } };
}
