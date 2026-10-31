import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { freeImageEditFixture } from './helpers/free-image-edit-api.mjs';
import { schemaCompanies } from './helpers/hub-schema.mjs';

const plain = value => JSON.parse(JSON.stringify(value));
const json = async response => { assert.equal(response.status, 200, await response.clone().text()); return response.json(); };
// Reuse the real full/partial queue with isolated adapters, without importing
// that file's tests or making provider calls. The listing response below comes
// from the actual local API and the real image-text save handler.
function batchFixture() {
  const url = new URL('./batch-selected-work.test.mjs', import.meta.url), source = fs.readFileSync(url, 'utf8'),
    ast = ts.createSourceFile(url.pathname, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const declarations = [];
  for (const statement of ast.statements) {
    if (ts.isImportDeclaration(statement)) continue;
    if (ts.isVariableStatement(statement) || ts.isFunctionDeclaration(statement)) declarations.push(statement.getText(ast));
    else break;
  }
  return vm.runInNewContext(declarations.join('\n').replaceAll('import.meta.url', JSON.stringify(url.href)) + '\nfixture()',
    { assert, fs, vm, ts, Response, AbortController, AbortSignal, Date, URL, TextEncoder, structuredClone, Blob, Error });
}
async function selectedOnly(f) {
  const before = await json(await f.h.route(f.base + '/options')), rows = f.h.load('app/product-options.ts').optionInputs(before.options);
  for (const row of rows) row.included = row.id === f.selected;
  await json(await f.h.route(f.base + '/options', { method: 'PATCH', body: { expectedRevision: before.options.revision,
    expectedProductVersion: before.productVersion, rows } }));
}
async function listing(f) {
  const snapshot = f.snapshot(), reads = [], head = f.h.bindings.FILES.head, get = f.h.bindings.FILES.get;
  f.h.bindings.FILES.head = async key => { reads.push(['HEAD', key]); return head(key); };
  f.h.bindings.FILES.get = async (...args) => { reads.push(['GET', args[0]]); return get(...args); };
  try {
    const response = await f.h.load('app/api/products/[id]/route.ts').GET(new Request('https://app.test' + f.base), { params: Promise.resolve({ id: f.id }) });
    const product = (await json(response)).product;
    assert.equal(f.snapshot(), snapshot, 'listing diagnostics must not change the product, content or quotation');
    assert.ok(reads.filter(([method]) => method === 'GET').every(([, key]) => key.endsWith('.edit.json')), 'no PNG body downloads');
    return { product, reads };
  } finally { f.h.bindings.FILES.head = head; f.h.bindings.FILES.get = get; }
}

for (const company of schemaCompanies) test(`a saved partial image stays failed after reload and full work does not skip it (${company.code})`, async () => {
  const f = await freeImageEditFixture(company);
  try {
    await selectedOnly(f);
    const source = (await json(await f.source())).source, document = f.doc(); document.regions[0].issue = '번역하지 못한 중국어 영역';
    const saved = await json(await f.applyEdit(source, document)), { product, reads } = await listing(f), summary = product.content_summary;
    assert.equal(summary.stages.additionalImages.state, 'failed'); assert.equal(summary.stages.additionalImages.imageReview, 'unresolved');
    assert.equal(summary.stages.mainImage.state, 'complete'); assert.equal(summary.stages.detailImage.state, 'complete');
    assert.deepEqual(reads, [['HEAD', saved.key], ['GET', saved.key + '.edit.json']]);
    assert.equal(summary.finalImageKeys, undefined, 'internal effective references do not expand the listing DTO');
    const queue = batchFixture(); queue.options.mode = 'full';
    queue.intercept(call => call.url === '/api/products/product' ? Response.json({ product: { ...product, id: 'product', updated_at: '2026-10-23T00:00:00.000Z' } }) : null);
    const result = await queue.run(['additionalImages']);
    assert.equal(result.stages[0].status, 'draft', result.stages[0].message);
    assert.equal(queue.calls.filter(call => call.adapter === 'image').length, 1, 'partial saved PNG cannot be skipped as complete');
    assert.equal(queue.calls.some(call => /supplier-hub|submit|registration/.test(call.url ?? '') && call.method !== 'GET'), false);
  } finally { f.close(); }
});

test('a repaired selected image clears the error, while superseded and excluded partial outputs are not read', async () => {
  const f = await freeImageEditFixture(schemaCompanies[0]);
  try {
    await selectedOnly(f);
    const source = (await json(await f.source())).source, partial = f.doc(); partial.regions[0].issue = '남은 번역 오류';
    const old = await json(await f.applyEdit(source, partial)), opened = await json(await f.reopen(old.key));
    opened.editDocument.regions[0].issue = null; opened.editDocument.regions[0].translated = '직접 확인하고 수정한 문구';
    const repaired = await json(await f.applyEdit(opened.source, opened.editDocument, f.png(91)));
    const view = await f.read(), target = f.h.load('app/quotation-seo-targets.ts').exactPrimaryQuotationTarget(view.resolved.schema.fields, 'additionalImages');
    await json(await f.h.route(f.qurl, { method: 'PUT', body: { expectedRevision: view.revision, expectedInputFingerprint: view.inputFingerprint,
      changes: target.linked.map(fieldKey => ({ optionId: f.other, fieldKey, value: old.key })) } }));
    const store = f.h.load('db/product-content.ts'), content = await store.readProductContent('owner', f.id);
    const patch = f.h.load('app/product-content.ts').applyContentPatch(content, { assets: { additional: [old.key] } }, new Date(Date.parse(f.product().updated_at) + 1).toISOString());
    assert.ok(await store.saveProductContent('owner', patch, content.revision), 'retain a superseded global manual assignment');
    const { product, reads } = await listing(f);
    assert.equal(product.content_summary.stages.additionalImages.state, 'complete'); assert.equal(product.content_summary.stages.additionalImages.imageReview, undefined);
    assert.deepEqual(reads, [['HEAD', repaired.key], ['GET', repaired.key + '.edit.json']]);
    assert.ok(JSON.parse(product.image_keys).includes(old.key), 'unselected generated output remains in the upload pool');
  } finally { f.close(); }
});

test('one edited output reused across current image roles is read once and cannot be completed through a manual assignment branch', async () => {
  const f = await freeImageEditFixture(schemaCompanies[0]);
  try {
    await selectedOnly(f);
    const source = (await json(await f.source())).source, document = f.doc(); document.regions[0].issue = '직접 저장 후에도 남은 번역 오류';
    const saved = await json(await f.applyEdit(source, document)), view = await f.read(), changes = [];
    for (const input of ['mainImage', 'additionalImages', 'detailImages']) {
      const target = f.h.load('app/quotation-seo-targets.ts').exactPrimaryQuotationTarget(view.resolved.schema.fields, input);
      changes.push(...target.linked.map(fieldKey => ({ optionId: f.selected, fieldKey, value: saved.key })));
    }
    await json(await f.h.route(f.qurl, { method: 'PUT', body: { expectedRevision: view.revision, expectedInputFingerprint: view.inputFingerprint, changes } }));
    const { product, reads } = await listing(f);
    for (const stage of ['mainImage', 'additionalImages', 'detailImage']) assert.equal(product.content_summary.stages[stage].state, 'failed', stage);
    assert.deepEqual(reads, [['HEAD', saved.key], ['GET', saved.key + '.edit.json']]);
  } finally { f.close(); }
});

test('missing or corrupt selected review cannot become complete, but ordinary manual image references stay complete', async () => {
  const f = await freeImageEditFixture(schemaCompanies[0]);
  try {
    await selectedOnly(f);
    assert.equal((await listing(f)).product.content_summary.stages.additionalImages.state, 'complete');
    const source = (await json(await f.source())).source, saved = await json(await f.applyEdit(source, f.doc())), sidecar = f.h.objects.get(saved.key + '.edit.json').slice();
    for (const bytes of [null, new TextEncoder().encode('{bad')]) {
      if (bytes === null) f.h.objects.delete(saved.key + '.edit.json'); else f.h.objects.set(saved.key + '.edit.json', bytes);
      const { product } = await listing(f); assert.equal(product.content_summary.stages.additionalImages.state, 'pending');
      assert.equal(product.content_summary.stages.additionalImages.imageReview, 'unconfirmed');
    }
    f.h.objects.set(saved.key + '.edit.json', sidecar);
    assert.equal((await listing(f)).product.content_summary.stages.additionalImages.state, 'complete');
  } finally { f.close(); }
});

test('current image review failure overrides stale executed completion for every image role without changing label status', () => {
  const cache = new Map();
  const load = file => { if (cache.has(file)) return cache.get(file); const exports = {}; cache.set(file, exports);
    vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../' + file, import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
      { exports, Date, structuredClone, require: name => load(name.slice(2) + '.ts') }); return exports; };
  const model = load('app/registration-stage-status.ts'), saved = model.pendingRegistrationStages(), execution = model.pendingRegistrationStages(), selected = { main: ['owner/m.png'], additional: ['owner/a.png'], detail: ['owner/d.png'] };
  for (const id of ['mainImage', 'additionalImages', 'detailImage', 'koreanLabel']) { saved[id] = { state: 'complete', detail: '저장된 값' }; execution[id] = { state: 'complete', detail: '이전 실행' }; }
  const review = (key, status, changes = {}) => ({ format: 'free-image-edit-review-v1', productId: 'p', key, status, unresolvedRegions: status === 'unresolved' ? 1 : null, ...changes });
  const before = JSON.stringify({ saved, execution, selected });
  for (const status of ['unresolved', 'unconfirmed']) {
    const reviewed = model.registrationStagesWithImageReviews('p', saved, selected, Object.values(selected).flat().map(key => review(key, status))), merged = model.mergeRegistrationStages(reviewed, execution);
    for (const id of ['mainImage', 'additionalImages', 'detailImage']) assert.equal(merged[id].state, status === 'unresolved' ? 'failed' : 'pending', id);
    assert.equal(merged.koreanLabel.state, 'complete');
  }
  const clear = model.registrationStagesWithImageReviews('p', saved, selected, Object.values(selected).flat().map(key => review(key, 'clear')));
  assert.deepEqual(plain(clear), plain(saved));
  const unrelated = model.registrationStagesWithImageReviews('p', saved, selected, Object.values(selected).flat().map(key => review(key, 'clear', { productId: 'other' })));
  assert.equal(unrelated.mainImage.state, 'pending');
  assert.equal(JSON.stringify({ saved, execution, selected }), before);
});
