import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';

const modules = new Map();
function load(file) {
  if (modules.has(file)) return modules.get(file);
  const exports = {}; modules.set(file, exports);
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../' + file, import.meta.url), 'utf8'), {
    fileName: file, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { exports, Error, Date, structuredClone, TextEncoder, TextDecoder, Uint8Array, DataView, require(name) {
    if (name.startsWith('@/')) return load(name.slice(2) + '.ts');
    if (name.startsWith('./') || name.startsWith('../')) return load(path.posix.join(path.posix.dirname(file), name) + '.ts');
    throw Error('Metadata helper cannot use an external or database runtime: ' + name);
  } });
  return exports;
}
const { detailEditorInputs, validateDetailEditorInputs } = load('app/detail-editor-inputs.ts');
const { MAX_IMAGE_BYTES } = load('app/image-files.ts');
const plain = value => JSON.parse(JSON.stringify(value));
const hash = character => character.repeat(64);
const old = '2026-10-15T01:00:00.000Z';
function freeze(value) { for (const child of Object.values(value)) if (child && typeof child === 'object') freeze(child); return Object.freeze(value); }

function fixture({ owner = 'owner-Waihop', productId = 'source-product', categoryId = '81221', count = 3, dynamic = true } = {}) {
  const uploadId = hash('a'), key = `${owner}/quotation-label-${uploadId}.png`, scope = 'category:' + categoryId;
  const images = [{ key: `${owner}/first.png`, sha256: hash('b'), width: 400, height: 100 },
    { key: `${owner}/second.jpg`, sha256: hash('c'), width: 800, height: 200 }];
  const field = (id, type = 'text', extra = {}) => ({ id, type, section: 'image', label: id, required: false, maxLength: 16000, ...extra });
  const fields = [field('additionalImages', 'images'), field('detailImages', 'images'), field('detailHtml', 'textarea'), field('altText'), field('brand')];
  if (dynamic) fields.push(field('wire-detail-images', 'images', { hubInput: 'detailImages', hubWire: { path: ['imagePage', 'details', 'detailedImage'] } }),
    field('wire-detail-html', 'textarea', { hubInput: 'detailHtml', hubWire: { path: ['imagePage', 'details', 'htmlProductDetailContent'] } }));
  const values = { additionalImages: '', detailImages: key, detailHtml: '', altText: '  원래 ALT  ', brand: '',
    ...(dynamic ? { 'wire-detail-images': key, 'wire-detail-html': '' } : {}) };
  const options = Array.from({ length: count }, (_, index) => ({ optionId: `option-${index}`, included: index % 2 === 0 }));
  const overrides = { common: { ...values }, options: Object.fromEntries(options.map(row => [row.optionId, { altText: '', brand: ' 직접 값 ' }])) };
  const rows = [{ optionId: null, included: false }, ...options].map(row => ({ ...row,
    fields: Object.fromEntries(Object.entries(values).map(([id, value]) => [id, { value, source: 'manual-common' }])) }));
  const receipt = { uploadId, key, sha256: hash('d'), bytes: 2048, revision: 5, beforeRevision: 4, categoryId,
    sourceOptionId: 'option-0', optionIds: options.map(row => row.optionId) };
  const backup = { receipt, sources: images, before: [{ optionId: null, fieldKey: 'detailHtml', value: '<p>기존 수동 HTML</p>' }],
    beforeProductVersion: old, beforeInputFingerprint: hash('e'), updatedAt: old };
  const state = { schemaVersion: 1, productId, revision: 9, updatedAt: old, overrides: { common: { altText: '', detailHtml: 'legacy HTML' }, options: {} },
    categoryOverrides: { [scope]: overrides, 'category:other': { common: { detailHtml: '', title: ' 다른 분류 ' }, options: {} } },
    detailSaveBackups: { [scope]: [backup] }, unknownMetadata: { manualBlank: '', raw: ' 原文 ' } };
  const view = { revision: state.revision, updatedAt: old, productVersion: old, inputFingerprint: hash('f'), contentRevision: 7, optionRevision: 8,
    imageKeys: [key, ...images.map(image => image.key)], overrides: structuredClone(overrides),
    categoryContext: { source: 'collection', profileId: 'profile', categoryId, categoryPath: ['저장한 분류'] },
    resolved: { schema: { categoryId, categoryPath: ['저장한 분류'], status: 'observed', fields }, rows } };
  const document = { format: 'saved-detail-inputs-v1', categoryId,
    origin: { productId, sourceOptionId: receipt.sourceOptionId, uploadId, revision: receipt.revision },
    output: { key, sha256: receipt.sha256, bytes: receipt.bytes }, images: structuredClone(images) };
  return { owner, productId, categoryId, scope, key, images, receipt, backup, state, view, document };
}

for (const owner of ['owner-Waihop', 'owner-Yoonchae']) test(`ordinary saved backup supplies a cloned ordered pre-composite list (${owner})`, () => {
  const f = fixture({ owner }), before = JSON.stringify([f.view, f.state]); freeze(f.view); freeze(f.state);
  const result = detailEditorInputs(f.view, f.state, f.productId);
  assert.deepEqual(plain(result), f.document); assert.equal(JSON.stringify([f.view, f.state]), before);
  assert.notEqual(result.images, f.backup.sources); assert.notEqual(result.images[0], f.backup.sources[0]);
  result.images[0].key = `${owner}/changed-local.png`; result.origin.productId = 'changed';
  assert.equal(f.backup.sources[0].key, f.images[0].key); assert.equal(f.state.productId, f.productId);
});

test('derivation uses sealed history rather than current content roles or a currently displayed draft', () => {
  const f = fixture();
  f.view.content = { assets: { detailTop: { value: [] }, detail: { value: ['unrelated/current-role.png'] }, detailBottom: { value: [] } } };
  f.view.detailDraft = { detailImages: 'unrelated/unsaved.png', detailHtml: '<p>미저장</p>' };
  assert.deepEqual(plain(detailEditorInputs(f.view, f.state, f.productId).images), f.images);
});

test('manual blanks, legacy/other-category HTML, ALT and unknown metadata are not modified or copied into inputs', () => {
  const f = fixture(), before = JSON.stringify([f.view, f.state]);
  const result = detailEditorInputs(f.view, f.state, f.productId);
  assert.deepEqual(Object.keys(result).sort(), ['categoryId', 'format', 'images', 'origin', 'output']);
  assert.equal(JSON.stringify([f.view, f.state]), before);
  assert.equal(f.state.categoryOverrides[f.scope].common.brand, ''); assert.equal(f.state.overrides.common.altText, '');
  assert.equal(f.state.categoryOverrides['category:other'].common.detailHtml, '');
});

test('last ordinary backup for the same current PNG wins and unrelated later receipt is not used', () => {
  const f = fixture(), newer = structuredClone(f.backup);
  newer.receipt.revision = 7; newer.receipt.beforeRevision = 6; newer.sources.reverse();
  f.state.detailSaveBackups[f.scope].push(newer, { receipt: { key: 'different-output' }, sources: [] });
  const result = detailEditorInputs(f.view, f.state, f.productId);
  assert.equal(result.origin.revision, 7); assert.deepEqual(plain(result.images), [...f.images].reverse());
});

test('a malformed last matching backup does not silently fall back to an older list', () => {
  const f = fixture(), corrupt = structuredClone(f.backup); corrupt.sources = [];
  f.state.detailSaveBackups[f.scope].push(corrupt);
  assert.equal(detailEditorInputs(f.view, f.state, f.productId), null);
});

test('persisted category metadata takes precedence and retains foreign source identity without fabricating an ordinary receipt', () => {
  const f = fixture({ productId: 'target-product' }), family = structuredClone(f.document);
  family.origin.productId = 'family-source'; family.origin.sourceOptionId = 'source-old-option'; family.origin.revision = 120;
  family.images.reverse(); f.state.detailEditorInputs = { [f.scope]: family };
  delete f.state.detailSaveBackups;
  const result = detailEditorInputs(f.view, f.state, f.productId);
  assert.deepEqual(plain(result), family); assert.ok(result.origin.revision > f.view.revision);
  assert.equal(f.state.detailSaveBackups, undefined); assert.equal(f.state.productId, 'target-product');
});

test('a present corrupt or stale scoped family document cannot downgrade to valid ordinary history', () => {
  for (const mutate of [value => { value.categoryId = 'other'; }, value => { value.output.sha256 = 'bad'; },
    value => { value.images = []; }, value => { value.output.key = `owner-Waihop/quotation-label-${hash('e')}.png`; value.origin.uploadId = hash('e'); }]) {
    const f = fixture(), document = structuredClone(f.document); mutate(document);
    f.state.detailEditorInputs = { [f.scope]: document };
    assert.equal(detailEditorInputs(f.view, f.state, f.productId), null);
  }
  for (const metadata of [null, [], 'invalid', { 'category:81221': null }]) {
    const f = fixture(); f.state.detailEditorInputs = metadata;
    assert.equal(detailEditorInputs(f.view, f.state, f.productId), null);
  }
});

test('other-category persisted documents never leak into the current scope or suppress its ordinary fallback', () => {
  const f = fixture(); f.state.detailEditorInputs = { 'category:other': { ...f.document, categoryId: 'other' } };
  assert.deepEqual(plain(detailEditorInputs(f.view, f.state, f.productId)), f.document);
  delete f.state.detailSaveBackups[f.scope]; assert.equal(detailEditorInputs(f.view, f.state, f.productId), null);
});

test('ordinary fallback accepts current split subset and a removed historical source option but rejects unsaved new IDs', () => {
  const f = fixture(); f.receipt.optionIds.push('removed-option'); f.receipt.sourceOptionId = 'removed-option';
  assert.equal(detailEditorInputs(f.view, f.state, f.productId).origin.sourceOptionId, 'removed-option');
  f.view.resolved.rows[1].optionId = 'new-not-saved';
  assert.equal(detailEditorInputs(f.view, f.state, f.productId), null);
});

test('ordinary receipt validates category, option membership, revision, output identity and both legacy/new text policies', () => {
  const f = fixture();
  f.receipt.textPolicy = 'couplus-detail-alt-v1'; f.receipt.textCommonFilled = false;
  assert.ok(detailEditorInputs(f.view, f.state, f.productId));
  for (const mutate of [value => { value.categoryId = 'other'; }, value => { value.revision = 10; value.beforeRevision = 9; },
    value => { value.beforeRevision = 1; }, value => { value.optionIds = []; }, value => { value.optionIds.push(value.optionIds[0]); },
    value => { value.sourceOptionId = 'unknown-source-option'; }, value => { value.optionIds = ['option-0']; },
    value => { value.uploadId = hash('e'); }, value => { value.sha256 = 'bad'; }, value => { value.bytes = 0; },
    value => { value.textPolicy = 'unknown-policy'; }, value => { value.textPolicy = undefined; }, value => { value.textCommonFilled = 'false'; }]) {
    const g = fixture(); g.receipt.textPolicy = 'couplus-detail-alt-v1'; g.receipt.textCommonFilled = false; mutate(g.receipt);
    assert.equal(detailEditorInputs(g.view, g.state, g.productId), null);
  }
});

test('exact current common aliases and empty HTML are required, including captured canonical-only schemas', () => {
  const canonical = fixture({ dynamic: false }); assert.ok(detailEditorInputs(canonical.view, canonical.state, canonical.productId));
  for (const mutate of [f => { f.view.resolved.rows[0].fields['wire-detail-images'].value = f.images[0].key; },
    f => { f.view.resolved.rows[0].fields.detailHtml.value = '<p>새 수동 HTML</p>'; },
    f => { f.view.resolved.rows[0].fields['wire-detail-html'].value = ' '; }, f => { f.view.resolved.rows.shift(); },
    f => { f.view.resolved.schema.fields.push({ ...f.view.resolved.schema.fields.find(field => field.id === 'wire-detail-images'), id: 'ambiguous' }); }]) {
    const f = fixture(); mutate(f); assert.equal(detailEditorInputs(f.view, f.state, f.productId), null);
  }
});

test('source and image pool clocks/identity/category ownership mismatches produce no inputs', () => {
  for (const mutate of [f => { f.state.productId = 'other'; }, f => { f.state.revision++; }, f => { f.state.updatedAt = 'different'; },
    f => { f.view.resolved.schema.status = 'unknown'; }, f => { f.view.resolved.schema.categoryId = 'other'; },
    f => { f.view.categoryContext.categoryId = null; }, f => { f.view.overrides.common.brand = 'different'; },
    f => { f.view.imageKeys = f.view.imageKeys.filter(key => key !== f.images[0].key); },
    f => { f.view.imageKeys.push('foreign/file.png'); }, f => { f.view.imageKeys.push(f.images[0].key); },
    f => { f.view.resolved.rows[2].optionId = f.view.resolved.rows[1].optionId; }]) {
    const f = fixture(); mutate(f); assert.equal(detailEditorInputs(f.view, f.state, f.productId), null);
  }
});

test('duplicate image positions retain exact order while contradictory proof for the same key is rejected', () => {
  const f = fixture(); f.document.images = [f.images[1], f.images[0], f.images[1]];
  const result = validateDetailEditorInputs(f.document, f.owner, f.categoryId);
  assert.deepEqual(plain(result.images), f.document.images); assert.equal(result.images.length, 3);
  const inconsistent = structuredClone(f.document); inconsistent.images[2] = { ...inconsistent.images[2], sha256: hash('e') };
  assert.throws(() => validateDetailEditorInputs(inconsistent, f.owner, f.categoryId));
});

test('strict document, origin, output and image field sets reject missing fields or injected editor/OCR metadata', () => {
  const f = fixture();
  for (const target of ['root', 'origin', 'output', 'image']) {
    for (const kind of ['missing', 'extra']) {
      const value = structuredClone(f.document), object = target === 'root' ? value : target === 'image' ? value.images[0] : value[target];
      if (kind === 'missing') delete object[Object.keys(object)[0]]; else object.regions = [];
      assert.throws(() => validateDetailEditorInputs(value, f.owner, f.categoryId));
    }
  }
  for (const value of [null, [], 'string', { ...f.document, format: 'other' }, { ...f.document, categoryId: 'other' }])
    assert.throws(() => validateDetailEditorInputs(value, f.owner, f.categoryId));
});

test('keys and output upload identity cannot escape the exact owner namespace or refer to the output itself', () => {
  const f = fixture();
  for (const key of ['', 'foreign/image.png', 'https://app.test/image.png', '/media/quotation/token', `${f.owner}/../image.png`,
    `${f.owner}/image%2Fname.png`, `${f.owner}/image\\name.png`, `${f.owner}/image\nname.png`, `${f.owner}/image.png?x`, f.key]) {
    const value = structuredClone(f.document); value.images[0].key = key;
    assert.throws(() => validateDetailEditorInputs(value, f.owner, f.categoryId), key);
  }
  const mismatch = structuredClone(f.document); mismatch.output.key = `${f.owner}/not-label.png`;
  assert.throws(() => validateDetailEditorInputs(mismatch, f.owner, f.categoryId));
  assert.throws(() => validateDetailEditorInputs(f.document, 'other-owner', f.categoryId));
});

test('origin IDs, digests, revision and output byte bounds reject malformed metadata', () => {
  const f = fixture();
  for (const mutate of [value => { value.origin.productId = '__proto__'; }, value => { value.origin.sourceOptionId = 'bad/option'; },
    value => { value.origin.uploadId = 'A'.repeat(64); }, value => { value.origin.revision = 0; }, value => { value.origin.revision = 1.5; },
    value => { value.origin.revision = Number.MAX_SAFE_INTEGER + 1; }, value => { value.output.bytes = MAX_IMAGE_BYTES + 1; },
    value => { value.output.bytes = NaN; }, value => { value.output.sha256 = 'bad'; }, value => { value.images[0].sha256 = 'bad'; }]) {
    const value = structuredClone(f.document); mutate(value); assert.throws(() => validateDetailEditorInputs(value, f.owner, f.categoryId));
  }
});

test('per-image display geometry and compositor rounded total height are bounded exactly', () => {
  const f = fixture();
  const limit = structuredClone(f.document); limit.images = [{ ...f.images[0], width: 800, height: 16000 }];
  assert.equal(validateDetailEditorInputs(limit, f.owner, f.categoryId).images[0].height, 16000);
  const minimum = structuredClone(f.document); minimum.images = Array.from({ length: 150 }, () => ({ ...f.images[0], width: 16000, height: 1 }));
  assert.equal(validateDetailEditorInputs(minimum, f.owner, f.categoryId).images.length, 150);
  for (const images of [[{ ...f.images[0], width: 0 }], [{ ...f.images[0], height: 16001 }], [{ ...f.images[0], width: 1.5 }],
    [{ ...f.images[0], width: 16000, height: 16000 }], [{ ...f.images[0], width: 1, height: 21 }],
    [{ ...f.images[0], width: 800, height: 16000 }, { ...f.images[1], width: 16000, height: 1 }]]) {
    assert.throws(() => validateDetailEditorInputs({ ...f.document, images }, f.owner, f.categoryId));
  }
});

test('200 real options including excluded options are independent of the 150-position image limit', () => {
  const f = fixture({ count: 200 });
  f.backup.sources = Array.from({ length: 150 }, () => ({ ...f.images[0], width: 800, height: 1 }));
  const result = detailEditorInputs(f.view, f.state, f.productId);
  assert.equal(result.images.length, 150); assert.equal(f.receipt.optionIds.length, 200); assert.equal(f.view.resolved.rows.filter(row => row.included === false).length, 101);
  f.backup.sources.push({ ...f.images[0], width: 800, height: 1 });
  assert.equal(detailEditorInputs(f.view, f.state, f.productId), null);
  assert.throws(() => validateDetailEditorInputs({ ...f.document, images: [] }, f.owner, f.categoryId));
});
