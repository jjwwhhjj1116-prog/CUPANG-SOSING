import test from 'node:test';
import assert from 'node:assert/strict';
import { providedOptionFixture, providedOptionModule as module } from './helpers/provided-option-quotation.mjs';
import { syntheticSnapshot, companies } from './helpers/supplier-hub-single-projection.mjs';
import { seoWorkspaceHarness } from './helpers/seo-workspace.mjs';

const plain = value => JSON.parse(JSON.stringify(value));
const now = '2026-10-22T01:00:00.000Z', title = '유앤채 부드러운 리본 뒤꿈치 보호 쿠션 패드';
const quotation = module('app/quotation-schema.ts'), cm = module('app/product-content.ts');
const policy = module('app/explicit-seo-quotation-defaults.ts'), workspace = module('app/seo-workspace.ts');
function fixture(company = companies[0]) {
  const snapshot = syntheticSnapshot(company); snapshot.categoryId = '68183';
  snapshot.categoryPath = ['패션의류잡화', '유니섹스/남녀공용 패션', '공용화', '깔창/쿠션패드', '쿠션패드'];
  const raw = JSON.parse(snapshot.schemaString), product = raw.properties.productPage.properties;
  product.searchTags = { type: 'string', title: '검색태그', maxLength: 150 };
  product.unexposedAttributes.allOf.push({ contains: { type: 'object', properties: {
    attributeName: { type: 'string', enum: ['모델명/품번'], requirement: '필수' }, attributeValue: { type: 'string' },
  }, required: ['attributeName', 'attributeValue'] } });
  snapshot.schemaString = JSON.stringify(raw);
  const f = providedOptionFixture({ reviewedNames: true }), schema = quotation.getQuotationSchema(snapshot.categoryId, snapshot.categoryPath, snapshot);
  f.content.initialLegalNotices = module('app/initial-legal-notices.ts').createInitialLegalNotices(schema, f.settings, now);
  f.content.label.productName = { value: f.content.seo.title.value, provenance: 'generated', updatedAt: f.product.updated_at };
  f.content.seo.title.provenance = 'collected';
  const keys = { model: schema.fields.find(field => field.hubInput === 'model').id,
    peer: schema.fields.find(field => field.label === '모델명/품번').id,
    notice: schema.fields.find(field => field.label === '품명 및 모델명').id,
    tags: schema.fields.find(field => field.hubInput === 'searchTags').id };
  const resolve = (content = f.content, overrides, schemaSnapshot = snapshot) => quotation.resolveQuotationFields({ ...f, content,
    categoryId: schemaSnapshot.categoryId, categoryPath: schemaSnapshot.categoryPath, hubSchema: schemaSnapshot, ...(overrides ? { overrides } : {}) });
  const save = (seo = { title, keywords: ['뒤꿈치 보호', '신발 패드'] }, content = f.content) => workspace.applySeoWorkspaceChanges({
    productId: f.product.id, productVersion: f.product.updated_at, content, options: f.options, imageKeys: [],
  }, { expectedProductVersion: f.product.updated_at, expectedContentRevision: content.revision, expectedOptionRevision: f.options.revision, seo }, now).content;
  return { f, snapshot, schema, keys, resolve, save };
}

test('only an explicit SEO save links the native model pair and initial name notice; reads never change legacy content', () => {
  for (const company of companies) {
    const x = fixture(company), before = JSON.stringify(x.f);
    const old = x.resolve().rows[0].fields;
    assert.equal(old[x.keys.model].value, ''); assert.equal(old[x.keys.peer].value, ''); assert.equal(old[x.keys.notice].value, '해당사항없음');
    assert.equal(JSON.stringify(x.f), before); assert.equal(x.f.content.explicitSeoQuotationDefaults, undefined);
    const saved = x.save(), savedBeforeRead = JSON.stringify(saved), fields = x.resolve(saved).rows[0].fields;
    for (const key of ['model', 'peer', 'notice']) assert.equal(fields[x.keys[key]].value, title, key);
    assert.equal(fields[x.keys.tags].value, '뒤꿈치 보호, 신발 패드');
    assert.equal(saved.explicitSeoQuotationDefaults.productId, x.f.product.id);
    assert.equal(JSON.stringify(saved), savedBeforeRead); assert.deepEqual(plain(saved.initialLegalNotices), plain(x.f.content.initialLegalNotices));
    assert.deepEqual(plain(saved.label), plain(x.f.content.label));
    assert.deepEqual(plain(saved.assets), plain(x.f.content.assets));
  }
});

test('scope parsing is local to one resolution and is skipped entirely for legacy packets without explicit intent', () => {
  const x = fixture(), legacy = structuredClone(x.f.content);
  Object.defineProperty(legacy, 'initialLegalNotices', { get() { throw Error('legacy packets must not parse optional linkage scope'); } });
  const empty = policy.explicitSeoQuotationDefaultsResolver(legacy, x.schema);
  for (const field of x.schema.fields) assert.equal(empty(field, { value: '', source: 'empty' }), null);
  const saved = x.save(), notices = saved.initialLegalNotices; let scopeReads = 0;
  Object.defineProperty(saved, 'initialLegalNotices', { get() { scopeReads++; return notices; } });
  const project = policy.explicitSeoQuotationDefaultsResolver(saved, x.schema), atCreation = scopeReads;
  assert.ok(atCreation > 0);
  for (let option = 0; option < 10; option++) for (const field of x.schema.fields) project(field, { value: '', source: 'empty' });
  assert.equal(scopeReads, atCreation, 'each option/field uses only the already proved immutable request-local scope');
  const changed = structuredClone(x.f.content); changed.explicitSeoQuotationDefaults = { ...saved.explicitSeoQuotationDefaults, productId: 'different' };
  const next = policy.explicitSeoQuotationDefaultsResolver(changed, x.schema);
  assert.equal(next(x.schema.fields.find(field => field.id === x.keys.model), { value: '', source: 'empty' }), null, 'a later resolution does not reuse another snapshot proof');
});

test('direct stage-six models/name blanks and all stage-seven manual overrides remain authoritative', () => {
  for (const value of ['', 'DIRECT-MODEL']) {
    const x = fixture(), content = structuredClone(x.f.content);
    content.label.model = { value, provenance: 'manual', updatedAt: now };
    content.label.productName = { value, provenance: 'manual', updatedAt: now };
    const saved = x.save(undefined, content), fields = x.resolve(saved).rows[0].fields;
    assert.equal(fields[x.keys.model].value, value); assert.equal(fields[x.keys.peer].value, value);
    assert.equal(fields[x.keys.notice].value, '해당사항없음', 'keep independent initial notice instead of deriving from a directly edited label');
  }
  for (const layer of ['common', 'option']) for (const value of ['', '별도로 검토한 견적 입력']) {
    const x = fixture(), saved = x.save(), overrides = { common: {}, options: {} };
    const changes = Object.fromEntries(['model', 'peer', 'notice'].map(key => [x.keys[key], value]));
    if (layer === 'common') overrides.common = changes; else overrides.options[x.f.options.rows[0].id] = changes;
    const before = JSON.stringify(overrides), rows = x.resolve(saved, overrides).rows;
    const fields = rows.find(row => row.optionId === (layer === 'option' ? x.f.options.rows[0].id : null)).fields;
    for (const key of ['model', 'peer', 'notice']) { assert.equal(fields[x.keys[key]].value, value); assert.equal(fields[x.keys[key]].source, 'manual-' + layer); }
    assert.equal(JSON.stringify(overrides), before);
  }
});

test('existing collected models and changed title/category/clock/signatures cannot be silently replaced', () => {
  const x = fixture(), source = structuredClone(x.f.content);
  source.label.model = { value: 'SOURCE-10', provenance: 'collected', updatedAt: now };
  assert.equal(x.resolve(x.save(undefined, source)).rows[0].fields[x.keys.model].value, 'SOURCE-10');
  const saved = x.save();
  const mutations = [
    c => { delete c.explicitSeoQuotationDefaults; }, c => { c.explicitSeoQuotationDefaults.productId = 'another-product'; },
    c => { c.seo.title.value = '다른 작성자가 변경한 상품명'; }, c => { c.seo.title.updatedAt = now.replace('01:', '02:'); },
    c => { c.explicitSeoQuotationDefaults.sourceUpdatedAt = c.seo.title.updatedAt = null; },
    c => { c.explicitSeoQuotationDefaults.categoryId = '81452'; }, c => { c.explicitSeoQuotationDefaults.categoryPath = ['다른 경로']; },
    c => { c.initialLegalNotices.fields[0].signature += ' '; }, c => { c.initialLegalNotices.fields.pop(); },
  ];
  for (const mutate of mutations) {
    const current = structuredClone(saved); mutate(current);
    const fields = x.resolve(current).rows[0].fields;
    assert.equal(fields[x.keys.model].value, ''); assert.equal(fields[x.keys.peer].value, '');
  }
  const different = structuredClone(x.snapshot); different.categoryPath = [...different.categoryPath, '다른 경로'];
  assert.equal(x.resolve(saved, undefined, different).rows[0].fields[x.keys.model].value, '');
});

test('only a known native shape gets defaults; bounded Korean title and native input validation remain required', () => {
  const x = fixture();
  for (const title of ['', '纯中文', '한국어混合', '한글\u0001', '한글\ud800']) {
    const content = structuredClone(x.f.content); content.seo.title.value = title; content.seo.title.updatedAt = now;
    assert.equal(policy.applyExplicitSeoQuotationDefaults(content, { title }), false);
  }
  const old = structuredClone(x.f.content); delete old.initialLegalNotices;
  assert.equal(policy.applyExplicitSeoQuotationDefaults(old, { title }), false);
  const saved = x.save({ title: '가'.repeat(49) + '😀' + '긴 상품명' }), fields = x.resolve(saved).rows[0].fields;
  assert.equal(fields[x.keys.model].value, '가'.repeat(49)); assert.equal(fields[x.keys.peer].value, '가'.repeat(49));
  assert.equal(fields[x.keys.notice].value, '가'.repeat(49) + '😀' + '긴 상품명');
  const short = structuredClone(x.snapshot), raw = JSON.parse(short.schemaString); raw.properties.productPage.properties.modelNumber.maxLength = 3;
  short.schemaString = JSON.stringify(raw);
  const shortSchema = quotation.getQuotationSchema(short.categoryId, short.categoryPath, short);
  const content = structuredClone(x.f.content); content.initialLegalNotices = module('app/initial-legal-notices.ts').createInitialLegalNotices(shortSchema, x.f.settings, now);
  assert.equal(x.resolve(x.save(undefined, content), undefined, short).rows[0].fields[x.keys.model].value, '');
});

test('option-only saves and content patches cannot forge the explicit SEO proof; stage-five manual text stays intact', () => {
  const x = fixture(), content = cm.applyContentPatch(x.f.content, { detail: { description: '', altText: '직접 검토한 이미지 설명' } }, x.f.product.updated_at);
  const before = JSON.stringify(content.detail), saved = x.save(undefined, content);
  assert.equal(JSON.stringify(saved.detail), before);
  assert.equal(cm.currentDetailContent(saved).description.value, ''); assert.equal(cm.currentDetailContent(saved).altText.value, '직접 검토한 이미지 설명');
  const value = workspace.applySeoWorkspaceChanges({ productId: x.f.product.id, productVersion: x.f.product.updated_at, content: x.f.content, options: x.f.options, imageKeys: [] },
    { expectedProductVersion: x.f.product.updated_at, expectedContentRevision: x.f.content.revision, expectedOptionRevision: x.f.options.revision,
      optionNames: [{ optionId: x.f.options.rows[0].id, value: '수정한 옵션' }] }, now);
  assert.equal(value.content.explicitSeoQuotationDefaults, undefined); assert.equal(value.content, x.f.content);
  assert.throws(() => cm.validateContentInput({ expectedRevision: 0, patch: { explicitSeoQuotationDefaults: saved.explicitSeoQuotationDefaults } }, [], ''), /지원하지|허용|항목/);
});

for (const company of companies) test(`real SEO API persists only the scoped intent; quotation and prior manual labels stay byte-identical (${company.code})`, async () => {
  const h = seoWorkspaceHarness({ companyCode: company.code });
  try {
    const x = fixture(company), content = structuredClone(h.content);
    content.initialLegalNotices = x.f.content.initialLegalNotices;
    h.sqlite.prepare('UPDATE product_content SET payload=? WHERE product_id=?').run(JSON.stringify(content), h.id);
    const before = h.stored(), response = await h.request('PATCH', { expectedProductVersion: h.version,
      expectedContentRevision: content.revision, expectedOptionRevision: h.options.revision, seo: { title } });
    assert.equal(response.status, 200, await response.clone().text()); const answer = await response.json(), after = h.stored();
    assert.equal(answer.content.explicitSeoQuotationDefaults.productId, h.id);
    assert.equal(answer.content.explicitSeoQuotationDefaults.categoryId, '68183');
    assert.deepEqual(after.quotation, before.quotation); assert.deepEqual(plain(answer.content.label), plain(content.label));
    assert.deepEqual(plain(answer.content.detail), plain(content.detail));
    const view = quotation.resolveQuotationFields({ ...x.f, product: { ...x.f.product, id: h.id }, content: answer.content,
      categoryId: x.snapshot.categoryId, categoryPath: x.snapshot.categoryPath, hubSchema: x.snapshot });
    assert.equal(view.rows[0].fields[x.keys.model].value, title);
    assert.equal(view.rows[0].fields[x.keys.notice].value, '해당사항없음', 'old direct product-name label is preserved');
    assert.deepEqual((await (await h.request()).json()).content.explicitSeoQuotationDefaults, answer.content.explicitSeoQuotationDefaults);
  } finally { h.close(); }
});
