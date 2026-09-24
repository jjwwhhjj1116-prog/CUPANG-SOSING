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
const { attachQuotationLabels: batch } = load('app/quotation-label-batch.ts');
const cell = value => ({ value, source: 'manual-option' });
function fixture() {
  return { revision: 2, inputFingerprint: 'before', productVersion: '2026-09-24T00:00:00.000Z', contentRevision: 3, imageKeys: ['owner/old.png'],
    categoryContext: { categoryId: '80719', profileId: 'profile' }, resolved: {
      schema: { categoryId: '80719', categoryPath: ['주방'], fields: [{ id: 'title', label: '상품명', section: 'start' }, { id: 'model', label: '모델명', section: 'product' }, { id: 'labelImages', type: 'images', section: 'image' }] },
      rows: ['red', 'blue'].map(id => ({ optionId: id, optionLabel: id, included: true, fields: { title: cell('제품'), model: cell(id), labelImages: cell('owner/old.png') } })),
    } };
}
function harness(uniqueUploads = false) {
  const initial = fixture(); let view = structuredClone(initial); let uploadedKey = null;
  const calls = []; let failAttachment = false; let conflictPut = false; let changeAfterAttach = false;
  const fetcher = async (url, init = {}) => {
    calls.push({ url, method: init.method ?? 'GET', body: typeof init.body === 'string' ? JSON.parse(init.body) : init.body });
    if (url === '/api/files') return Response.json({ key: uniqueUploads ? `owner/new-${calls.filter(call => call.url === '/api/files').length}.png` : 'owner/new.png' });
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
  return { initial, calls, fetcher, get view() { return view; }, set view(value) { view = value; },
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

test('batch renders included option-specific values and preserves all prior labels', async () => {
  const h = harness(true); const plans = []; const progress = [];
  h.initial.resolved.rows.push({ optionId: 'excluded', optionLabel: 'excluded', included: false, fields: {} });
  const { view: saved } = await batch({ productId: 'p1', endpoint: '/fields', view: h.initial, uploaded: new Map(),
    render: async plan => { plans.push(plan); return { blob: new Blob(['png']) }; }, onProgress: p => progress.push(p),
  }, h.fetcher);
  assert.equal(plans.length, 2);
  assert.equal(plans[0].rows.find(row => row[0] === '모델명')[1], 'red');
  assert.equal(plans[1].rows.find(row => row[0] === '모델명')[1], 'blue');
  assert.equal(saved.resolved.rows[0].fields.labelImages.value, 'owner/old.png\nowner/new-1.png');
  assert.equal(saved.resolved.rows[1].fields.labelImages.value, 'owner/old.png\nowner/new-2.png');
  assert.equal(progress.at(-1).completed, 2);
  assert.equal(progress.at(-1).total, 2);
});

test('batch resumes after second-option conflict without regenerating or duplicating either PNG', async () => {
  const h = harness(true); const uploaded = new Map(); let renders = 0; let fail = true;
  const request = async (url, init) => {
    if (init?.method === 'PUT' && JSON.parse(init.body).changes[0].optionId === 'blue' && fail) { fail = false; return Response.json({ error: '충돌' }, { status: 409 }); }
    return h.fetcher(url, init);
  };
  const input = { productId: 'p1', endpoint: '/fields', view: h.initial, uploaded,
    render: async () => { renders++; return { blob: new Blob(['png']) }; }, onProgress() {},
  };
  await assert.rejects(batch(input, request), /충돌/);
  assert.match(h.view.resolved.rows[0].fields.labelImages.value, /new-1/);
  assert.equal(h.view.resolved.rows[1].fields.labelImages.value, 'owner/old.png');
  await batch(input, request);
  assert.equal(renders, 2); assert.equal(uploaded.size, 2);
  assert.equal(h.calls.filter(call => call.url === '/api/files').length, 2);
  assert.equal(h.calls.filter(call => call.method === 'PUT').length, 2);
});

test('batch validates all plans before mutation and stops if later option changes during rendering', async () => {
  const h = harness(true); let renders = 0;
  const input = { productId: 'p1', endpoint: '/fields', view: h.initial, uploaded: new Map(),
    render: async () => { renders++; if (renders === 2) h.view.resolved.rows[1].fields.model.value = 'changed'; return { blob: new Blob(['png']) }; }, onProgress() {},
  };
  await assert.rejects(batch(input, h.fetcher), /변경/);
  assert.equal(h.calls.filter(call => call.url === '/api/files').length, 1);
  assert.match(h.view.resolved.rows[0].fields.labelImages.value, /new-1/);
  const invalid = fixture(); invalid.resolved.rows[1].fields.title.value = ''; invalid.resolved.rows[1].fields.model.value = '';
  await assert.rejects(batch({ ...input, view: invalid }, h.fetcher), /견적 값/);
  assert.equal(renders, 2);
});

test('batch capacity preflight stops before rendering or uploading and counts retained retry keys', async () => {
  const h = harness(true); h.view.imageKeys = Array.from({ length: 49 }, (_, i) => `owner/${i}.png`);
  let renders = 0;
  const input = { productId: 'p1', endpoint: '/fields', view: h.initial, uploaded: new Map(), render: async () => { renders++; return { blob: new Blob(['png']) }; }, onProgress() {} };
  await assert.rejects(batch(input, h.fetcher), /49개.*2개/);
  assert.equal(renders, 0); assert.equal(h.calls.filter(call => call.method !== 'GET').length, 0);
  h.view.imageKeys = ['owner/old.png'];
  h.view.resolved.rows[1].fields.labelImages.value = Array.from({ length: 30 }, (_, i) => `owner/${i}.png`).join('\n');
  await assert.rejects(batch(input, h.fetcher), /blue.*30개/); assert.equal(renders, 0);
  const full = harness(true); full.view.imageKeys = Array.from({ length: 50 }, (_, i) => `owner/${i}.png`);
  const uploaded = new Map([['red', 'owner/0.png'], ['blue', 'owner/1.png']]);
  full.view.resolved.rows[0].fields.labelImages.value = 'owner/0.png';
  full.view.resolved.rows[1].fields.labelImages.value = 'owner/1.png';
  const result = await batch({ ...input, view: full.initial, uploaded }, full.fetcher);
  assert.equal(result.completed, 2); assert.equal(result.stopped, false); assert.equal(renders, 0);
  assert.equal(full.calls.filter(call => call.method !== 'GET').length, 0);
});

test('stop during an option save completes that option, then resumes with no duplicate upload', async () => {
  const h = harness(true); let stop = false; let renders = 0; const uploaded = new Map();
  const request = async (url, init) => {
    const response = await h.fetcher(url, init);
    if (init?.method === 'PUT') stop = true;
    return response;
  };
  const input = { productId: 'p1', endpoint: '/fields', view: h.initial, uploaded, shouldStop: () => stop,
    render: async () => { renders++; return { blob: new Blob(['png']) }; }, onProgress() {} };
  const first = await batch(input, request);
  assert.equal(first.stopped, true); assert.equal(first.completed, 1);
  assert.equal(first.view.resolved.rows[0].fields.labelImages.value, 'owner/old.png\nowner/new-1.png');
  assert.equal(first.view.resolved.rows[1].fields.labelImages.value, 'owner/old.png');
  stop = false;
  const resumed = await batch(input, h.fetcher);
  assert.equal(resumed.stopped, false); assert.equal(resumed.completed, 2); assert.equal(renders, 2);
  assert.equal(h.calls.filter(call => call.url === '/api/files').length, 2);
});

test('stop before execution or during rendering never starts an upload', async () => {
  const h = harness(); let stop = true; let renders = 0;
  const input = { productId: 'p1', endpoint: '/fields', view: h.initial, uploaded: new Map(), shouldStop: () => stop,
    render: async () => { renders++; stop = true; return { blob: new Blob(['png']) }; }, onProgress() {} };
  assert.equal((await batch(input, h.fetcher)).stopped, true);
  assert.equal(h.calls.length, 0); assert.equal(renders, 0);
  stop = false;
  const result = await batch(input, h.fetcher);
  assert.equal(result.stopped, true); assert.equal(result.completed, 0); assert.equal(renders, 1);
  assert.equal(h.calls.filter(call => call.method !== 'GET').length, 0);
});
