import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';

const modules = new Map();
function load(file) {
  if (modules.has(file)) return modules.get(file); const exports = {}; modules.set(file, exports);
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../' + file, import.meta.url), 'utf8'), { fileName: file,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
  { exports, Error, Date, structuredClone, TextEncoder, TextDecoder, Uint8Array, DataView,
    require(name) { if (name.startsWith('@/')) return load(name.slice(2) + '.ts');
      if (name.startsWith('./') || name.startsWith('../')) return load(path.posix.join(path.posix.dirname(file), name) + '.ts');
      throw Error('Pure planner cannot import external runtime: ' + name); } });
  return exports;
}
const { detailFamilySource, detailFamilyTargetPlan } = load('app/detail-family-plan.ts');
const plain = value => JSON.parse(JSON.stringify(value));
const old = '2026-10-15T01:00:00.000Z', now = '2026-10-15T02:00:00.000Z';
const companies = ['A01464742', 'A01526306'];
const hash = character => character.repeat(64);
function fixture({ company = companies[0], productId = 'source-product', categoryId = '81221', count = 3, dynamic = true } = {}) {
  const uploadId = hash('a'), key = `owner-${company}/quotation-label-${uploadId}.png`, scope = `category:${categoryId}`;
  const field = (id, type = 'text', extra = {}) => ({ id, type, section: 'image', label: id, required: false, visibility: 'common', maxLength: type === 'images' ? 16000 : 150000, ...extra });
  const fields = [field('additionalImages', 'images'), field('detailImages', 'images'), field('detailHtml', 'textarea'), field('altText'), field('brand')];
  if (dynamic) fields.push(field('wire-detail-images', 'images', { hubInput: 'detailImages', hubWire: { path: ['imagePage', 'details', 'detailedImage'] } }),
    field('wire-detail-html', 'textarea', { hubInput: 'detailHtml', hubWire: { path: ['imagePage', 'details', 'htmlProductDetailContent'] } }));
  const real = Array.from({ length: count }, (_, i) => ({ optionId: `option-${i}`, optionLabel: `원문 ${i}`, included: i % 2 === 0 }));
  const values = { additionalImages: '', detailImages: key, detailHtml: '', altText: ' ALT 공백 보존 ', brand: ' 원래 브랜드 ',
    ...(dynamic ? { 'wire-detail-images': key, 'wire-detail-html': '' } : {}) };
  const overrides = { common: { ...values }, options: Object.fromEntries(real.map((row, i) => [row.optionId, { ...values, altText: i ? '' : ' 옵션 ALT ' }])) };
  const rows = [{ optionId: null, optionLabel: '공통', included: false }, ...real].map(row => ({ ...row,
    fields: Object.fromEntries(Object.entries(row.optionId === null ? values : overrides.options[row.optionId]).map(([id, value]) => [id, { value, source: 'manual-option', needsReview: false, issues: [] }])) }));
  const receipt = { uploadId, key, sha256: hash('b'), bytes: 12345, revision: 5, beforeRevision: 4, categoryId, sourceOptionId: 'option-0', optionIds: real.map(row => row.optionId) };
  const backup = { receipt, before: [{ optionId: null, fieldKey: 'detailHtml', value: '<p>원래 수동 HTML</p>' }], sources: [], beforeProductVersion: old,
    beforeInputFingerprint: hash('c'), updatedAt: old };
  const state = { schemaVersion: 1, productId, revision: 9, updatedAt: old, overrides: { common: { title: 'legacy 유지' }, options: {} },
    categoryOverrides: { [scope]: overrides, 'category:another': { common: { detailHtml: ' 다른 범위 ', altText: '' }, options: { preserved: { detailImages: 'other' } } } },
    packagingBasis: { version: 1, common: {}, options: {} }, categoryPackagingBasis: { [scope]: { version: 1, common: { old: { value: 'manual', unitsPerPack: {} } }, options: {} } },
    detailSaveBackups: { [scope]: [backup], 'category:another': [{ receipt: { key: 'unrelated' } }] }, unknownExtra: { raw: [' 原文 ', ''] } };
  const view = { revision: state.revision, updatedAt: old, productVersion: old, inputFingerprint: hash('d'), contentRevision: 7, optionRevision: 8,
    imageKeys: [key, `owner-${company}/original.png`], overrides: structuredClone(overrides), categoryContext: { source: 'collection', profileId: 'profile', categoryId, categoryPath: ['보관 범주'] },
    resolved: { schema: { version: 1, categoryId, categoryPath: ['보관 범주'], status: 'observed', evidence: `synthetic-${company}`, fields, submissionReady: false }, rows, issues: [] } };
  return { input: { productId, view, state }, receipt, key, scope };
}
function sync(f) { f.input.state.categoryOverrides[f.scope] = structuredClone(f.input.view.overrides); }
function freeze(value) { for (const item of Object.values(value)) if (item && typeof item === 'object') freeze(item); return Object.freeze(value); }

for (const company of companies) test(`source proves current common/all-option final image while retaining later unrelated edits (${company})`, () => {
  const f = fixture({ company }), sourceBefore = JSON.stringify(f.input); freeze(f.input);
  const proof = plain(detailFamilySource(f.input));
  assert.deepEqual(proof, { productId: f.input.productId, categoryId: '81221', key: f.key, sha256: hash('b'), bytes: 12345, uploadId: hash('a'), receiptRevision: 5 });
  assert.notEqual(proof.receiptRevision, f.input.view.revision);
  assert.equal(JSON.stringify(f.input), sourceBefore);
});

test('source allows the current split subset of the historical receipt and selects the last matching key', () => {
  const f = fixture(); f.receipt.optionIds.push('removed-option'); f.receipt.sourceOptionId = 'removed-option';
  const newer = structuredClone(f.input.state.detailSaveBackups[f.scope][0]); newer.receipt.revision = 7; newer.receipt.beforeRevision = 6; newer.receipt.sha256 = hash('e');
  f.input.state.detailSaveBackups[f.scope].push(newer, { receipt: { key: 'different' } });
  const source = detailFamilySource(f.input); assert.equal(source.receiptRevision, 7); assert.equal(source.sha256, hash('e'));
});

for (const company of companies) test(`target changes only current category final image/HTML and preserves ALT, manual blanks, receipts and all unrelated state (${company})`, () => {
  const source = detailFamilySource(fixture({ company }).input), target = fixture({ company, productId: 'target-product' });
  target.input.view.imageKeys = [`owner-${company}/target-original.png`];
  delete target.input.view.overrides.common.detailImages; target.input.view.overrides.common.detailHtml = '';
  delete target.input.view.overrides.options['option-1']['wire-detail-html']; sync(target);
  const before = JSON.stringify(target.input); freeze(target.input); freeze(source);
  const result = plain(detailFamilyTargetPlan(target.input, source, now));
  assert.deepEqual(result.imageKeys, [`owner-${company}/target-original.png`, source.key]); assert.equal(result.quotation.revision, 10); assert.equal(result.quotation.updatedAt, now);
  assert.equal(result.quotation.productId, 'target-product'); assert.deepEqual(result.quotation.overrides, target.input.state.overrides);
  assert.deepEqual(result.quotation.categoryOverrides['category:another'], target.input.state.categoryOverrides['category:another']);
  for (const key of ['packagingBasis', 'categoryPackagingBasis', 'detailSaveBackups', 'unknownExtra']) assert.deepEqual(result.quotation[key], target.input.state[key]);
  const updated = result.quotation.categoryOverrides[target.scope];
  for (const layer of [updated.common, ...Object.values(updated.options)]) {
    assert.equal(layer.detailImages, source.key); assert.equal(layer['wire-detail-images'], source.key); assert.equal(layer.detailHtml, ''); assert.equal(layer['wire-detail-html'], '');
  }
  assert.equal(updated.common.altText, ' ALT 공백 보존 '); assert.equal(updated.options['option-1'].altText, '');
  assert.equal(result.before.find(change => change.optionId === null && change.fieldKey === 'detailImages').value, null);
  assert.equal(result.before.find(change => change.optionId === null && change.fieldKey === 'detailHtml').value, '');
  assert.equal(result.before.find(change => change.optionId === 'option-1' && change.fieldKey === 'wire-detail-html').value, null);
  assert.equal(result.changes.some(change => change.fieldKey === 'altText'), false); assert.equal(result.changes.length, 16);
  assert.equal(JSON.stringify(target.input), before);
});

test('200 real rows including excluded rows receive bounded exact canonical/wire changes without rewriting source records', () => {
  const sourceFixture = fixture({ count: 200 }), source = detailFamilySource(sourceFixture.input), target = fixture({ count: 200, productId: 'target-product' });
  const before = JSON.stringify([sourceFixture.input, target.input]);
  const plan = detailFamilyTargetPlan(target.input, source, now); assert.equal(plan.changes.length, 804); assert.equal(plan.before.length, 804);
  assert.equal(Object.keys(plan.quotation.categoryOverrides[target.scope].options).length, 200);
  assert.ok(plan.changes.some(change => change.optionId === 'option-199' && change.value === source.key));
  assert.equal(JSON.stringify([sourceFixture.input, target.input]), before);
});

test('canonical-only captured schemas work and the final key already in a full pool is neither duplicated nor rejected', () => {
  const source = detailFamilySource(fixture({ dynamic: false }).input), target = fixture({ dynamic: false, productId: 'target-product' });
  target.input.view.imageKeys = [source.key, ...Array.from({ length: 149 }, (_, i) => `owner-A01464742/pool-${i}.png`)];
  const result = detailFamilyTargetPlan(target.input, source, now); assert.equal(result.imageKeys.length, 150); assert.equal(result.changes.length, 8);
  const full = fixture({ productId: 'target-product' }); full.input.view.imageKeys = Array.from({ length: 150 }, (_, i) => `owner-A01464742/pool-${i}.png`);
  assert.throws(() => detailFamilyTargetPlan(full.input, source, now), /보관 공간/);
});

test('source rejects mixed image keys, HTML, absent canonical/primary row aliases and excluded-row discrepancies', () => {
  for (const change of [f => f.input.view.resolved.rows[1].fields.detailImages.value = 'other',
    f => f.input.view.resolved.rows[2].fields['wire-detail-images'].value = 'other',
    f => f.input.view.resolved.rows[2].fields.detailHtml.value = '<p>보존할 HTML</p>',
    f => delete f.input.view.resolved.rows[0].fields.detailImages,
    f => delete f.input.view.resolved.rows[1].fields['wire-detail-html'],
    f => f.input.view.resolved.rows[0].fields['wire-detail-images'].value = '',
    f => f.input.view.resolved.rows[0].fields['wire-detail-images'].value = ' N/A ']) {
    const f = fixture(); change(f); assert.throws(() => detailFamilySource(f.input));
  }
});

test('ambiguous, missing, readonly or wrongly mapped detail schema bindings fail instead of guessing by labels', () => {
  for (const change of [f => f.input.view.resolved.schema.fields.push({ ...f.input.view.resolved.schema.fields.find(field => field.id === 'wire-detail-images'), id: 'duplicate-wire' }),
    f => f.input.view.resolved.schema.fields = f.input.view.resolved.schema.fields.filter(field => field.id !== 'detailHtml'),
    f => f.input.view.resolved.schema.fields.find(field => field.id === 'wire-detail-html').readOnly = true,
    f => f.input.view.resolved.schema.fields.find(field => field.id === 'wire-detail-images').hubInput = 'additionalImages',
    f => f.input.view.resolved.schema.fields.find(field => field.id === 'wire-detail-html').type = 'number']) {
    const f = fixture(); change(f); assert.throws(() => detailFamilySource(f.input));
    f.input.productId = 'target-product'; f.input.state.productId = 'target-product';
    assert.throws(() => detailFamilyTargetPlan(f.input, detailFamilySource(fixture().input), now));
  }
});

test('receipt identity/hash/size/key/category/option membership/version mismatches fail closed', () => {
  for (const change of [f => f.receipt.sha256 = 'bad', f => f.receipt.uploadId = 'bad', f => f.receipt.bytes = 0,
    f => f.receipt.bytes = 10 * 1024 * 1024 + 1, f => f.receipt.categoryId = 'another', f => f.receipt.optionIds.pop(),
    f => f.receipt.optionIds.push('option-0'), f => f.receipt.sourceOptionId = 'unknown', f => f.receipt.revision = 10,
    f => f.receipt.beforeRevision = 3, f => f.receipt.textCommonFilled = true,
    f => { const key = f.key.replace('quotation-label-', '../quotation-label-'); f.input.view.resolved.rows.forEach(row => { row.fields.detailImages.value = key; row.fields['wire-detail-images'].value = key; }); f.input.view.imageKeys.push(key); f.receipt.key = key; },
    f => delete f.input.state.detailSaveBackups[f.scope], f => f.input.view.imageKeys = []]) {
    const f = fixture(); change(f); assert.throws(() => detailFamilySource(f.input));
  }
});

test('source and target snapshots require observed matching known categories, exact scoped bytes and valid unique IDs', () => {
  for (const change of [f => f.input.state.revision++, f => f.input.state.updatedAt = now,
    f => f.input.state.categoryOverrides[f.scope].common.altText = 'concurrent', f => f.input.state.productId = 'different',
    f => f.input.view.categoryContext.categoryId = null, f => f.input.view.resolved.schema.categoryId = 'another',
    f => f.input.view.resolved.schema.status = 'unconfirmed', f => f.input.view.resolved.rows[1].optionId = 'constructor',
    f => f.input.view.resolved.rows[2].optionId = 'option-0', f => f.input.view.resolved.rows.push(structuredClone(f.input.view.resolved.rows[0])),
    f => f.input.view.imageKeys.push(f.key)]) {
    const f = fixture(); change(f); assert.throws(() => detailFamilySource(f.input));
  }
  const source = detailFamilySource(fixture().input);
  assert.throws(() => detailFamilyTargetPlan(fixture().input, source, now), /다른 가족 상품/);
  const different = fixture({ productId: 'target-product', categoryId: '80719' }); assert.throws(() => detailFamilyTargetPlan(different.input, source, now), /같은 카테고리/);
  for (const time of ['invalid', old, '2026-10-14T01:00:00.000Z']) assert.throws(() => detailFamilyTargetPlan(fixture({ productId: 'target-product' }).input, source, time), /시각/);
});

test('target does not invent or copy normal detail-save receipts and returned objects are independent', () => {
  const source = detailFamilySource(fixture().input), f = fixture({ productId: 'target-product' }); delete f.input.state.detailSaveBackups;
  const before = JSON.stringify(f.input), output = detailFamilyTargetPlan(f.input, source, now);
  assert.equal(Object.hasOwn(output.quotation, 'detailSaveBackups'), false); assert.equal(output.changes.every(change => ['detailImages', 'detailHtml', 'wire-detail-images', 'wire-detail-html'].includes(change.fieldKey)), true);
  output.quotation.unknownExtra.raw.push('changed'); output.quotation.categoryOverrides['category:another'].common.altText = 'changed'; output.imageKeys.push('changed'); output.before[0].value = 'changed';
  assert.equal(JSON.stringify(f.input), before);
});
