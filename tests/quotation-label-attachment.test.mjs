import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
function load(file) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
    { exports, File, Blob, FormData, Error, require(name) { return load(`${name.slice(2)}.ts`); } });
  return exports;
}
const { attachQuotationLabel: attach } = load('app/quotation-label-attachment.ts');
const cell = value => ({ value, source: 'manual-option' });
function fixture() {
  return { revision: 2, inputFingerprint: 'before', productVersion: '2026-09-24T00:00:00.000Z', contentRevision: 3, imageKeys: ['owner/old.png'],
    categoryContext: { categoryId: '80719', profileId: 'profile' }, resolved: {
      schema: { categoryId: '80719', categoryPath: ['주방'], fields: [{ id: 'title', label: '상품명', section: 'start' }, { id: 'model', label: '모델명', section: 'product' }, { id: 'labelImages', type: 'images', section: 'image' }] },
      rows: ['red', 'blue'].map(id => ({ optionId: id, optionLabel: id, included: true, fields: { title: cell('제품'), model: cell(id), labelImages: cell('owner/old.png') } })),
    } };
}
function harness() {
  const initial = fixture(); let view = structuredClone(initial); let uploadedKey = null;
  const calls = []; let failAttachment = false; let conflictPut = false; let changeAfterAttach = false;
  const fetcher = async (url, init = {}) => {
    calls.push({ url, method: init.method ?? 'GET', body: typeof init.body === 'string' ? JSON.parse(init.body) : init.body });
    if (url === '/api/files') return Response.json({ key: 'owner/new.png' });
    if (url.endsWith('/attachments')) {
      if (failAttachment) { failAttachment = false; return Response.json({ error: '연결 충돌' }, { status: 409 }); }
      const body = JSON.parse(init.body); assert.equal(body.role, null); assert.equal(body.expectedContentRevision, view.contentRevision);
      assert.equal(body.expectedVersion, view.productVersion);
      view.imageKeys.push(body.key); view.productVersion = '2026-09-24T00:00:01.000Z'; view.inputFingerprint = 'after-attachment';
      if (changeAfterAttach) view.resolved.rows[0].fields.model.value = '다른 모델';
      return Response.json({ productVersion: view.productVersion });
    }
    if (init.method === 'PUT') {
      if (conflictPut) { conflictPut = false; return Response.json({ error: '견적 저장 충돌' }, { status: 409 }); }
      const body = JSON.parse(init.body); assert.equal(body.expectedInputFingerprint, view.inputFingerprint); assert.equal(body.expectedRevision, view.revision);
      assert.equal(body.changes.length, 1); assert.equal(body.changes[0].fieldKey, 'labelImages');
      view.resolved.rows.find(row => row.optionId === body.changes[0].optionId).fields.labelImages.value = body.changes[0].value; view.revision++;
    }
    return Response.json(view);
  };
  return { initial, calls, get view() { return view; }, set view(value) { view = value; },
    failAttachment() { failAttachment = true; }, conflictPut() { conflictPut = true; }, changeAfterAttach() { changeAfterAttach = true; },
    run() { return attach({ productId: 'p1', endpoint: '/api/products/p1/quotation-fields?profileId=profile', renderedView: initial, optionId: 'red', blob: new Blob(['test'], { type: 'image/png' }), uploadedKey, onUploaded: key => { uploadedKey = key; } }, fetcher); },
  };
}
test('label attachment adds only the chosen option, preserves old labels and is idempotent', async () => {
  const h = harness(); const saved = await h.run();
  assert.equal(saved.resolved.rows[0].fields.labelImages.value, 'owner/old.png\nowner/new.png');
  assert.equal(saved.resolved.rows[1].fields.labelImages.value, 'owner/old.png');
  assert.deepEqual(saved.imageKeys, ['owner/old.png', 'owner/new.png']);
  assert.equal(h.initial.resolved.rows[0].fields.labelImages.value, 'owner/old.png');
  await h.run();
  assert.equal(h.calls.filter(call => call.url === '/api/files').length, 1);
  assert.equal(h.calls.filter(call => call.method === 'PUT').length, 1);
});
test('retries reuse an uploaded file after product-attachment or quotation CAS failure', async () => {
  for (const failure of ['failAttachment', 'conflictPut']) {
    const h = harness(); h[failure](); await assert.rejects(h.run(), /충돌/);
    assert.equal(h.view.resolved.rows[0].fields.labelImages.value, 'owner/old.png');
    await h.run(); assert.equal(h.calls.filter(call => call.url === '/api/files').length, 1);
    assert.equal(h.view.resolved.rows[0].fields.labelImages.value, 'owner/old.png\nowner/new.png');
  }
});
test('changed label values, category or excluded option prevent stale PNG connection', async () => {
  for (const change of [v => { v.resolved.rows[0].fields.model.value = ''; }, v => { v.resolved.schema.categoryId = 'other'; }, v => { v.resolved.rows[0].included = false; }]) {
    const h = harness(); change(h.view); await assert.rejects(h.run());
    assert.equal(h.calls.filter(call => call.method !== 'GET').length, 0);
  }
  const h = harness(); h.changeAfterAttach(); await assert.rejects(h.run(), /변경/);
  assert.equal(h.calls.filter(call => call.method === 'PUT').length, 0);
  assert.ok(h.view.imageKeys.includes('owner/new.png')); // Preserve partial upload; do not claim a linked label.
});
test('limits are checked before uploading and latest existing labels are retained', async () => {
  const full = harness(); full.view.imageKeys = Array.from({ length: 50 }, (_, i) => `owner/${i}.png`); await assert.rejects(full.run(), /한도/);
  assert.equal(full.calls.length, 1);
  const labels = harness(); labels.view.resolved.rows[0].fields.labelImages.value = Array.from({ length: 30 }, (_, i) => `owner/${i}.png`).join('\n'); await assert.rejects(labels.run(), /한도/);
  const h = harness(); h.view.resolved.rows[0].fields.labelImages.value += '\nowner/another.png'; h.view.imageKeys.push('owner/another.png');
  const saved = await h.run(); assert.equal(saved.resolved.rows[0].fields.labelImages.value, 'owner/old.png\nowner/another.png\nowner/new.png');
});
