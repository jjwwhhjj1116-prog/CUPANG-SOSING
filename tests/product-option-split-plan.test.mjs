import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const exports = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../app/product-option-split-plan.ts', import.meta.url), 'utf8'), {
  fileName: 'product-option-split-plan.ts', compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, { exports, structuredClone, Date, Error, require() { throw Error('The split planner must not perform runtime imports or I/O.'); } });
const { planProductOptionSplit: plan, OPTION_SPLIT_GROUP_LIMIT } = exports;
const plain = value => JSON.parse(JSON.stringify(value));
const old = '2026-10-14T01:02:03.000Z', now = '2026-10-15T04:05:06.000Z';
const uuid = n => `11111111-2222-4333-8444-${String(n).padStart(12, '0')}`;
const field = value => ({ value, provenance: 'manual', updatedAt: old });
function fixture(count = 4) {
  const productId = 'original-product';
  const rows = Array.from({ length: count }, (_, index) => ({ id: `option-${index}`, originalName: ` 原文 ${index} `, translatedName: index === 1 ? '' : ` 한글 ${index} `,
    supplierSku: ` SKU ${index} `, unitCostCny: 1.234, unitsPerPack: index + 2, included: index % 2 === 0, imageKey: `owner/raw-${index}.png`,
    color: '', size: ' N/A ', stock: null, minimumOrderQuantity: null, widthCm: null, lengthCm: null, heightCm: null, weightKg: null,
    packagingUnitsPerPack: 2, packagedWeightG: 321, provenance: { originalName: 'collected', translatedName: 'manual', size: 'manual', color: 'manual' }, updatedAt: old }));
  const optionValues = Object.fromEntries(rows.map((row, index) => [row.id, { title: index ? '' : ' 수동 제목 ', brand: ` 직접 ${index} `, altText: '' }]));
  const quantities = Object.fromEntries(rows.map(row => [row.id, 97]));
  const fact = { value: ' 321 ', fieldSignature: '{"id":"physical"}', unitsPerPack: quantities };
  const basis = { version: 1, common: { packagedWeightG: fact }, options: Object.fromEntries(rows.map(row => [row.id, { packagedWeightG: structuredClone(fact) }])) };
  return {
    product: { id: productId, owner_id: 'owner', source_url: 'https://synthetic.invalid/source', title: ' 원본 상품 ', source_price_cny: 1.234,
      exchange_rate: 205, supply_margin: 35, coupang_margin: 40, supply_price: 900, sale_price: 1500, msrp: 1800,
      options_count: rows.filter(row => row.included).length, seo_status: '완료', image_status: '완료', quote_status: '완료',
      registration_status: '등록검토', supplier_hub_status: '미전송', image_keys: '["owner/shared.png"]', goal_stage: 'quotation',
      created_at: old, updated_at: old, pricing_policy: '{ "raw": true }', registration_number: 'KNOWN-ORIGINAL' },
    content: { schemaVersion: 1, productId, revision: 4, updatedAt: old,
      seo: { title: field(' SEO 제목 '), keywords: field(['중복', '중복', '']), description: field(' 원문 설명\n ') },
      seoTitleDocument: { policy: 'couplus-seo-save-v1', sourceTitle: ' SEO 제목 ', sourceUpdatedAt: old, value: ' SEO 제목 ' },
      seoKeywordDocument: { policy: 'couplus-service-v1', sourceKeywords: ['중복', '중복', ''], sourceUpdatedAt: old, value: '중복, 중복, ' },
      intakeKeywordSeed: { value: ['초기'], updatedAt: old, sourceReference: 'old-source' },
      intakeSeoGuidancePending: { jobId: 'old-job', sourceReference: 'old-source', fields: { title: { value: ' SEO 제목 ', updatedAt: old, warning: '후보' } } },
      detail: { description: field('상세\n원문'), altText: field('') }, label: { productName: field(' 표시사항 수동명 ') },
      customLabels: [{ id: 'custom-original-id', name: ' 사용자 항목 ', value: '', visible: false }],
      categoryAttributes: { categoryId: 'category', jobId: 'original-job', values: [{ name: ' 재질 ', value: '' }], bindings: [{ fieldId: 'attribute', fieldSignature: 'raw', value: '' }] },
      assets: { main: field(['owner/shared.png']), detail: field(['owner/body.png']), label: field([]) } },
    options: { schemaVersion: 1, productId, revision: 8, updatedAt: old, rows },
    quotation: { schemaVersion: 1, productId, revision: 7, updatedAt: old,
      overrides: { common: { title: '', brand: ' common ', altText: '' }, options: optionValues },
      categoryOverrides: { 'category:one': { common: { title: ' 범주별 수동명 ' }, options: structuredClone(optionValues) }, 'category:empty': { common: {}, options: {} } },
      packagingBasis: basis, categoryPackagingBasis: { 'category:one': structuredClone(basis) },
      detailSaveBackups: { legacy: [{ receipt: { sourceOptionId: rows[0].id, optionIds: rows.map(row => row.id), uploadId: 'original-proof' }, before: [{ optionId: rows[0].id, fieldKey: 'altText', value: '' }] }] } },
    labels: { schemaVersion: 1, productId, revision: 0, updatedAt: null,
      overrides: { common: { productName: '' }, options: Object.fromEntries(rows.map(row => [row.id, { material: '', productName: ` 표시 ${row.id} ` }])) } },
  };
}
function groupsFor(source, partitions = [['option-0', 'option-1'], ['option-2', 'option-3']]) {
  return partitions.map((optionIds, index) => ({ label: ` 그룹 ${index + 1} `, productId: index === 0 ? source.product.id : uuid(1000 + index), optionIds,
    optionIdMap: Object.fromEntries(optionIds.map((id, j) => [id, index === 0 ? id : uuid(10000 + index * 200 + j)])) }));
}
function frozen(value) { for (const item of Object.values(value)) if (item && typeof item === 'object') frozen(item); return Object.freeze(value); }

test('reviewed partition keeps the original identities and raw facts, makes independent children and never mutates frozen source', () => {
  const source = fixture(), groups = groupsFor(source, [['option-1', 'option-0'], ['option-3', 'option-2']]), before = JSON.stringify(source);
  frozen(source); frozen(groups);
  const result = plain(plan(source, groups, now)), first = result.groups[0], child = result.groups[1];
  assert.equal(result.sourceProductId, source.product.id); assert.equal(first.retainsSource, true); assert.equal(child.retainsSource, false);
  assert.equal(first.product.id, source.product.id); assert.equal(first.product.registration_number, 'KNOWN-ORIGINAL'); assert.equal(first.product.created_at, old);
  assert.equal(first.product.registration_status, source.product.registration_status); assert.equal(first.product.supplier_hub_status, source.product.supplier_hub_status);
  assert.equal(first.product.title, ' 원본 상품 ,  그룹 1 '); assert.equal(child.product.title, ' 원본 상품 ,  그룹 2 ');
  assert.deepEqual(first.options.rows.map(row => row.id), ['option-1', 'option-0']); assert.deepEqual(child.sourceOptionIds, ['option-3', 'option-2']);
  assert.deepEqual(child.options.rows[0], { ...source.options.rows[3], id: groups[1].optionIdMap['option-3'] });
  assert.equal(child.product.options_count, 1); assert.equal(child.product.supplier_hub_status, '미전송'); assert.equal(child.product.registration_status, '수집완료');
  assert.equal(child.product.created_at, now); assert.equal(Object.hasOwn(child.product, 'registration_number'), false);
  for (const group of result.groups) {
    assert.equal(group.product.quote_status, '대기'); assert.equal(group.product.updated_at, now);
    for (const key of ['source_url', 'image_keys', 'pricing_policy', 'source_price_cny', 'supply_price', 'sale_price', 'msrp']) assert.equal(group.product[key], source.product[key]);
    assert.deepEqual(group.content.detail, source.content.detail); assert.deepEqual(group.content.assets, source.content.assets);
    assert.deepEqual(group.content.label, source.content.label); assert.deepEqual(group.content.customLabels, source.content.customLabels); assert.deepEqual(group.content.categoryAttributes, source.content.categoryAttributes);
    assert.equal(group.options.rows[0].updatedAt, old); assert.deepEqual(group.options.rows[0].provenance, source.options.rows[0].provenance);
  }
  assert.equal(JSON.stringify(source), before);
});

test('all state clocks advance only at the top, while child revisions start at one and included counts may be zero', () => {
  const source = fixture(), result = plan(source, groupsFor(source, [['option-0', 'option-2'], ['option-1', 'option-3']]), now);
  for (const key of ['content', 'options', 'quotation', 'labels']) {
    assert.equal(result.groups[0][key].revision, source[key].revision + 1); assert.equal(result.groups[1][key].revision, 1);
    for (const group of result.groups) { assert.equal(group[key].productId, group.product.id); assert.equal(group[key].updatedAt, now); }
  }
  assert.equal(result.groups[1].product.options_count, 0); assert.equal(result.groups[1].options.rows.every(row => row.included === false), true);
  assert.equal(result.groups[1].options.rows[0].packagingUnitsPerPack, 2); assert.equal(result.groups[1].options.rows[0].unitsPerPack, 3);
});

test('legacy and every category override preserve common/manual blanks and remap only selected existing option properties', () => {
  const source = fixture(), groups = groupsFor(source), id = groups[1].optionIdMap['option-2'];
  source.quotation.overrides.options['removed-option'] = { title: 'historical' };
  const child = plain(plan(source, groups, now).groups[1]);
  assert.deepEqual(child.quotation.overrides.common, source.quotation.overrides.common);
  assert.deepEqual(child.quotation.overrides.options[id], source.quotation.overrides.options['option-2']);
  assert.equal(child.quotation.overrides.options[id].title, ''); assert.equal(Object.hasOwn(child.quotation.overrides.options[id], 'missing'), false);
  assert.equal(Object.hasOwn(child.quotation.overrides.options, 'removed-option'), false);
  for (const layer of [child.quotation.overrides, child.quotation.categoryOverrides['category:one']]) {
    assert.deepEqual(Object.keys(layer.options), Object.values(groups[1].optionIdMap)); assert.equal(layer.options[id].altText, '');
  }
  assert.deepEqual(child.quotation.categoryOverrides['category:empty'], { common: {}, options: {} });
  assert.deepEqual(child.labels.overrides.common, { productName: '' }); assert.equal(child.labels.overrides.options[id].material, '');
  assert.equal(child.labels.overrides.options[id].productName, ' 표시 option-2 ');
});

test('packaging confirmation subsets/remaps every inner quantity map without inventing current quantity confirmations', () => {
  const source = fixture(), groups = groupsFor(source), child = plain(plan(source, groups, now).groups[1]);
  for (const basis of [child.quotation.packagingBasis, child.quotation.categoryPackagingBasis['category:one']]) {
    assert.deepEqual(Object.keys(basis.options), Object.values(groups[1].optionIdMap));
    for (const facts of [basis.common, ...Object.values(basis.options)]) {
      assert.equal(facts.packagedWeightG.value, ' 321 '); assert.equal(facts.packagedWeightG.fieldSignature, '{"id":"physical"}');
      assert.deepEqual(facts.packagedWeightG.unitsPerPack, Object.fromEntries(Object.values(groups[1].optionIdMap).map(id => [id, 97])));
    }
  }
});

test('a missing scoped option value remains missing and optional sidecars stay absent', () => {
  const source = fixture(); delete source.quotation.overrides.options['option-2'];
  for (const key of ['categoryOverrides', 'packagingBasis', 'categoryPackagingBasis', 'detailSaveBackups']) delete source.quotation[key];
  delete source.content.seoTitleDocument; delete source.content.seoKeywordDocument;
  const groups = groupsFor(source), child = plan(source, groups, now).groups[1];
  assert.equal(Object.hasOwn(child.quotation.overrides.options, groups[1].optionIdMap['option-2']), false);
  for (const key of ['categoryOverrides', 'packagingBasis', 'categoryPackagingBasis', 'detailSaveBackups']) assert.equal(Object.hasOwn(child.quotation, key), false);
});

test('valid SEO title proof advances consistently, keyword proof remains unchanged, and old intake automatic proof is cleared', () => {
  const source = fixture(), result = plain(plan(source, groupsFor(source), now));
  for (const group of result.groups) {
    assert.equal(group.content.seo.title.value, ` SEO 제목 , ${group.label}`); assert.equal(group.content.seo.title.updatedAt, now);
    assert.equal(group.content.seo.title.provenance, 'manual');
    assert.deepEqual(group.content.seoTitleDocument, { policy: 'couplus-seo-save-v1', sourceTitle: group.content.seo.title.value, sourceUpdatedAt: now, value: group.content.seo.title.value });
    assert.deepEqual(group.content.seoKeywordDocument, source.content.seoKeywordDocument); assert.deepEqual(group.content.seo.keywords, source.content.seo.keywords);
    assert.equal(Object.hasOwn(group.content, 'intakeSeoGuidancePending'), false);
  }
  assert.deepEqual(result.groups[0].content.intakeKeywordSeed, source.content.intakeKeywordSeed); assert.equal(Object.hasOwn(result.groups[1].content, 'intakeKeywordSeed'), false);
  assert.deepEqual(result.groups[0].quotation.detailSaveBackups, source.quotation.detailSaveBackups);
  assert.equal(Object.hasOwn(result.groups[1].quotation, 'detailSaveBackups'), false);
});

test('manual empty SEO title is retained verbatim and stale or malformed title/keyword proof is omitted', () => {
  for (const title of ['', '   ']) {
    const source = fixture(); source.content.seo.title.value = title; source.content.seoTitleDocument.sourceTitle = title; source.content.seoTitleDocument.value = title;
    const result = plan(source, groupsFor(source), now), group = result.groups[1];
    assert.equal(group.content.seo.title.value, title ? `${title}, ${group.label}` : '');
    assert.equal(group.content.seo.title.updatedAt, title ? now : old);
    assert.equal(group.content.seoTitleDocument.sourceUpdatedAt, group.content.seo.title.updatedAt);
  }
  for (const change of [s => s.content.seoTitleDocument.sourceTitle = 'old', s => s.content.seoTitleDocument.sourceUpdatedAt = now,
    s => s.content.seoTitleDocument.extra = true, s => s.content.seoTitleDocument.value = 'unrelated']) {
    const source = fixture(); change(source); source.content.seoKeywordDocument.sourceKeywords[0] = 'stale';
    for (const group of plan(source, groupsFor(source), now).groups) {
      assert.equal(Object.hasOwn(group.content, 'seoTitleDocument'), false); assert.equal(Object.hasOwn(group.content, 'seoKeywordDocument'), false);
    }
  }
});

test('child state objects share no mutable source or sibling references', () => {
  const source = fixture(6), groups = groupsFor(source, [['option-0', 'option-1'], ['option-2', 'option-3'], ['option-4', 'option-5']]), original = JSON.stringify(source);
  const result = plan(source, groups, now), siblingBefore = JSON.stringify(result.groups[2]);
  result.groups[1].content.assets.main.value.push('changed'); result.groups[1].options.rows[0].provenance.size = 'changed';
  result.groups[1].quotation.overrides.common.title = 'changed'; result.groups[1].quotation.packagingBasis.common.packagedWeightG.unitsPerPack.changed = 1;
  result.groups[1].labels.overrides.common.productName = 'changed'; result.groups[1].optionIdMap['option-2'] = 'changed';
  assert.equal(JSON.stringify(source), original); assert.equal(JSON.stringify(result.groups[2]), siblingBefore); assert.notEqual(groups[1].optionIdMap['option-2'], 'changed');
});

test('rejects incomplete partitions, duplicate/unknown options, empty groups and forged mapping entries without changing input', () => {
  for (const change of [g => g[1].optionIds.pop(), g => g[1].optionIds.push('option-2'), g => g[1].optionIds[0] = 'unknown',
    g => { g[1].optionIds = []; g[1].optionIdMap = {}; }, g => g[1].optionIdMap.extra = uuid(800), g => delete g[1].optionIdMap['option-2'],
    g => { g[1].optionIds[0] = 'option-0'; g[1].optionIdMap = { 'option-0': uuid(800), 'option-3': uuid(801) }; }]) {
    const source = fixture(), groups = groupsFor(source); change(groups); const before = JSON.stringify({ source, groups });
    assert.throws(() => plan(source, groups, now)); assert.equal(JSON.stringify({ source, groups }), before);
  }
  const source = fixture(), groups = groupsFor(source); source.options.rows[3].id = source.options.rows[0].id;
  assert.throws(() => plan(source, groups, now), /원본 옵션 ID/);
});

test('requires retained original IDs and caller-supplied fresh globally distinct child UUIDs', () => {
  for (const change of [g => g[0].productId = uuid(777), g => g[0].optionIdMap['option-0'] = uuid(777),
    g => g[1].productId = 'not-a-uuid', g => g[1].optionIdMap['option-2'] = 'not-a-uuid',
    g => g[1].optionIdMap['option-2'] = g[1].productId, g => g[1].optionIdMap['option-3'] = g[1].optionIdMap['option-2'],
    g => g[1].productId = uuid(1001).replace('-4333-', '-1333-'), g => g[1].optionIdMap['option-2'] = '__proto__']) {
    const source = fixture(), groups = groupsFor(source); change(groups); assert.throws(() => plan(source, groups, now));
  }
  const source = fixture(6), groups = groupsFor(source, [['option-0'], ['option-1'], ['option-2', 'option-3', 'option-4', 'option-5']]);
  groups[2].productId = groups[1].optionIdMap['option-1']; assert.throws(() => plan(source, groups, now), /새 UUID/);
  const sourceWithUuid = fixture(); sourceWithUuid.options.rows[3].id = uuid(900);
  const reuse = groupsFor(sourceWithUuid, [['option-0', 'option-1'], ['option-2', uuid(900)]]); reuse[1].productId = uuid(900);
  assert.throws(() => plan(sourceWithUuid, reuse, now), /새 UUID/);
});

test('enforces 2..20 groups and the 200-original-option limit while preserving reviewed label whitespace', () => {
  assert.equal(OPTION_SPLIT_GROUP_LIMIT, 20);
  const source = fixture(200), groups = groupsFor(source, Array.from({ length: 20 }, (_, i) => Array.from({ length: 10 }, (_, j) => `option-${i * 10 + j}`)));
  groups[1].label = ` ${'가'.repeat(118)} `;
  const result = plan(source, groups, now); assert.equal(result.groups.length, 20); assert.equal(result.groups[1].label, groups[1].label);
  assert.equal(result.groups.flatMap(g => g.sourceOptionIds).length, 200);
  for (const bad of [[], groups.slice(0, 1), [...groups, structuredClone(groups[1])]]) assert.throws(() => plan(source, bad, now), /2~20/);
  const tooMany = fixture(201); assert.throws(() => plan(tooMany, groupsFor(tooMany), now), /2~200/);
  for (const label of ['', ' \n ', '가'.repeat(121), 'bad\u0000label']) {
    const s = fixture(), g = groupsFor(s); g[1].label = label; assert.throws(() => plan(s, g, now), /120자/);
  }
});

test('rejects historical bundle links and legal file attachments instead of silently discarding source evidence', () => {
  for (const modify of [s => s.options.bundleSources = { removed: { sourceOptionId: 'old', quantity: 2 } },
    s => s.content.legalDocuments = { applicability: 'required', files: [{ key: 'owner/legal/original-product/proof.pdf', name: '원본.pdf' }] }]) {
    const source = fixture(); modify(source); const before = JSON.stringify(source);
    assert.throws(() => plan(source, groupsFor(source), now), /번들|법적 첨부/); assert.equal(JSON.stringify(source), before);
  }
  const source = fixture(); source.options.bundleSources = {}; source.content.legalDocuments = { applicability: 'required', files: [] };
  assert.deepEqual(plain(plan(source, groupsFor(source), now).groups[1].content.legalDocuments), source.content.legalDocuments);
});

test('state identity/revision/time mismatches and oversized suffixed titles fail without truncation', () => {
  for (const key of ['content', 'options', 'quotation', 'labels']) {
    const source = fixture(); source[key].productId = 'other'; assert.throws(() => plan(source, groupsFor(source), now), /ID·버전/);
    const invalid = fixture(); invalid[key].revision = Number.MAX_SAFE_INTEGER; assert.throws(() => plan(invalid, groupsFor(invalid), now), /ID·버전/);
  }
  const source = fixture(); assert.throws(() => plan(source, groupsFor(source), 'invalid'), /시각/);
  for (const setTitle of [s => s.product.title = '가'.repeat(500), s => s.content.seo.title.value = '가'.repeat(500)]) {
    const input = fixture(); setTitle(input); const before = JSON.stringify(input);
    assert.throws(() => plan(input, groupsFor(input), now), /500자/); assert.equal(JSON.stringify(input), before);
  }
});

test('preserves and remaps category-scoped label data if a compatible stored scope is present', () => {
  const source = fixture(); source.labels.categoryOverrides = { 'category:one': structuredClone(source.labels.overrides) };
  const groups = groupsFor(source), child = plan(source, groups, now).groups[1];
  assert.deepEqual(plain(child.labels.categoryOverrides['category:one'].common), source.labels.overrides.common);
  assert.deepEqual(Object.keys(child.labels.categoryOverrides['category:one'].options), Object.values(groups[1].optionIdMap));
});
