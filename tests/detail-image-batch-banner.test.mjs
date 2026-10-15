import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
import { schemaCompanies } from './helpers/hub-schema.mjs';

// Import only fixture declarations; importing the original test module would
// register its independent regression suite a second time.
const fixtureUrl = new URL('./detail-image-batch.test.mjs', import.meta.url);
const source = fs.readFileSync(fixtureUrl, 'utf8');
const ast = ts.createSourceFile('detail-image-batch.test.mjs', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
const fixtureDeclarations = [];
for (const statement of ast.statements) {
  if (ts.isImportDeclaration(statement)) {
    const specifier = statement.moduleSpecifier.text;
    const absolute = specifier.startsWith('.') ? new URL(specifier, fixtureUrl).href : import.meta.resolve(specifier);
    fixtureDeclarations.push(statement.getText(ast).replace(statement.moduleSpecifier.getText(ast), JSON.stringify(absolute)));
  } else if (ts.isVariableStatement(statement) || ts.isFunctionDeclaration(statement)) fixtureDeclarations.push(statement.getText(ast));
  else break;
}
const { fixture, png } = await import('data:text/javascript,' + encodeURIComponent(fixtureDeclarations.join('\n') + '\nexport { fixture, png };'));
const plain = value => JSON.parse(JSON.stringify(value));
const signal = () => new AbortController().signal;
const json = async response => { assert.equal(response.status, 200, await response.clone().text()); return response.json(); };
const uploads = f => f.calls.filter(call => call.init.body instanceof FormData).length;
const retained = f => JSON.stringify([f.product(), f.sourceRows(), f.h.sqlite.prepare('SELECT * FROM product_quotation_fields').all(),
  [...f.h.objects].map(([key, bytes]) => [key, Buffer.from(bytes).toString('hex')])]);
async function roles(f, { top = [f.order[0]], body = [f.order[1]], bottom = [f.order[2]] } = {}) {
  const content = (await json(await f.h.route(f.base + '/content'))).content;
  await json(await f.h.route(f.base + '/content', { method: 'PATCH', body: { expectedRevision: content.revision,
    patch: { assets: { main: [], additional: [], label: [], size: [], detailTop: top, detail: body, detailBottom: bottom } } } }));
  f.view = await f.read(); f.input.view = f.view;
  return f.view;
}
function traceDependencies(f) {
  const trace = { read: [], ocr: [], translate: [], render: [] };
  const deps = { ...f.deps,
    readSource: async (...args) => { trace.read.push({ key: args[2], slot: args[6].slotIndex }); return f.deps.readSource(...args); },
    recognize: async (image, language, ...args) => { trace.ocr.push({ key: image.source.sourceKey, language }); return f.deps.recognize(image, language, ...args); },
    translate: async (...args) => { trace.translate.push({ key: args[0].sourceKey, slot: args[0].quotationTarget.slotIndex, language: args[1] });
      return f.h.load('app/free-image-translation-client.ts').translateFreeImageRegions(...args); },
    render: async (image, ...args) => { trace.render.push({ key: image.source.sourceKey, slot: image.source.quotationTarget.slotIndex }); return f.deps.render(image, ...args); },
  };
  return { deps, trace };
}
const prepare = (f, deps, input = f.input) => f.model.prepareDetailImageBatch(input, signal(), () => {}, deps);
async function cachedBanner(f) {
  const target = f.model.detailBatchSelection(f.view, f.selected, f.profile.id, 'detail');
  const quotationTarget = { kind: 'quotation', profileId: f.profile.id, optionId: f.selected, input: 'detailImages', fieldKey: target.target.primary,
    slotIndex: 0, revision: f.view.revision, inputFingerprint: f.view.inputFingerprint, optionRevision: f.view.optionRevision, value: target.value };
  const image = await f.deps.readSource(f.id, f.view.productVersion, f.order[0], 'detail', signal(), f.deps.fetcher, quotationTarget);
  return { ...f.input, items: [{ slotIndex: 0, sourceKey: f.order[0], status: 'ready', message: '', texts: [],
    rendered: { source: image.source, output: new Blob([png(170)], { type: 'image/png' }), width: image.width, height: image.height } }] };
}

for (const company of schemaCompanies) for (const language of ['zh', 'en']) {
  test(`detail batch skips saved top/footer roles and applies the original body slot only (${company.code}, ${language})`, async () => {
    const f = await fixture(company);
    try {
      await roles(f);
      assert.deepEqual(plain(f.view.protectedDetailImageKeys), [f.order[0], f.order[2]]);
      const before = retained(f), sourceRows = f.sourceRows(), oldOverrides = plain(f.view.overrides), { deps, trace } = traceDependencies(f);
      let batch = await prepare(f, deps, { ...f.input, language });
      assert.deepEqual(plain(f.model.detailBatchTranslationSlots(f.view, f.selected, f.profile.id, 'detail')),
        { keys: f.order, slots: [1], protectedSlots: [0, 2] });
      assert.deepEqual(plain(batch.items.map(item => [item.slotIndex, item.sourceKey, item.status])),
        [[0, f.order[0], 'skipped'], [1, f.order[1], 'ready'], [2, f.order[2], 'skipped']]);
      for (const name of ['read', 'ocr', 'translate', 'render']) assert.deepEqual(trace[name].map(row => row.key), [f.order[1]], name);
      assert.deepEqual(trace.read.map(row => row.slot), [1]);
      assert.deepEqual(f.google, [language === 'zh' ? '中文' : 'English']);
      assert.equal(retained(f), before); assert.equal(uploads(f), 0);
      for (const item of [batch.items[0], batch.items[2]]) { assert.equal(item.rendered, undefined); assert.deepEqual(plain(item.texts), []); }
      batch = await f.model.applyDetailBatchResult(batch, 1, signal(), () => {}, deps);
      assert.equal(batch.items[1].status, 'applied');
      assert.equal(uploads(f), 1); assert.equal(f.sourceRows(), sourceRows);
      const selected = batch.view.resolved.rows.find(row => row.optionId === f.selected);
      const expectedKeys = [f.order[0], batch.items[1].appliedKey, f.order[2]];
      const target = f.h.load('app/quotation-image-targets.ts').optionImageTargets(batch.view.resolved.schema.fields).detailImages;
      for (const fieldKey of target.linked) {
        assert.equal(selected.fields[fieldKey].value, expectedKeys.join('\n'));
        delete oldOverrides.options[f.selected][fieldKey];
      }
      const stored = plain(batch.view.overrides);
      for (const fieldKey of target.linked) delete stored.options[f.selected][fieldKey];
      assert.deepEqual(stored, oldOverrides, 'manual HTML, common fields and every other option remain exact');
      assert.deepEqual(plain(batch.view.protectedDetailImageKeys), [f.order[0], f.order[2]]);
      assert.deepEqual(plain(batch.items.map(item => item.status)), ['skipped', 'applied', 'skipped']);
      assert.equal(f.product().supplier_hub_status, '미전송');
      assert.ok(!f.h.network.some(host => /supplier\.coupang|couplus/.test(host)));
    } finally { f.close(); }
  });
}

test('a legacy shared top/body key stays protected wherever it appears in the selected order', async () => {
  const f = await fixture(schemaCompanies[0]);
  try {
    await roles(f);
    const row = f.h.sqlite.prepare('SELECT payload FROM product_content WHERE product_id=?').get(f.id), content = JSON.parse(row.payload);
    content.assets.detail.value.unshift(f.order[0]);
    f.h.sqlite.prepare('UPDATE product_content SET payload=? WHERE product_id=?').run(JSON.stringify(content), f.id);
    f.view = await f.read();
    const target = f.h.load('app/quotation-image-targets.ts').optionImageTargets(f.view.resolved.schema.fields).detailImages;
    const order = [f.order[1], f.order[2], f.order[0]];
    await json(await f.h.route(f.qurl, { method: 'PUT', body: { expectedRevision: f.view.revision, expectedInputFingerprint: f.view.inputFingerprint,
      changes: target.linked.map(fieldKey => ({ optionId: f.selected, fieldKey, value: order.join('\n') })) } }));
    f.view = await f.read(); f.input.view = f.view;
    const before = retained(f), { deps, trace } = traceDependencies(f), batch = await prepare(f, deps);
    assert.deepEqual(plain(batch.items.map(item => item.status)), ['ready', 'skipped', 'skipped']);
    assert.deepEqual(trace.read, [{ key: f.order[1], slot: 0 }]);
    assert.equal(retained(f), before); assert.equal(uploads(f), 0);
  } finally { f.close(); }
});

test('an explicit empty role proof translates every saved body slot including the first and last', async () => {
  const f = await fixture(schemaCompanies[0]);
  try {
    await roles(f, { top: [], body: f.order, bottom: [] });
    assert.deepEqual(plain(f.view.protectedDetailImageKeys), []);
    const before = retained(f), { deps, trace } = traceDependencies(f), batch = await prepare(f, deps);
    assert.deepEqual(plain(batch.items.map(item => item.status)), ['ready', 'ready', 'ready']);
    assert.deepEqual(trace.read, f.order.map((key, slot) => ({ key, slot })));
    assert.equal(f.google.length, 3); assert.equal(retained(f), before); assert.equal(uploads(f), 0);
  } finally { f.close(); }
});

test('missing or malformed detail role proof rejects before source, OCR, translation or rendering', async () => {
  const f = await fixture(schemaCompanies[0]);
  try {
    await roles(f);
    for (const proof of [undefined, null, 'bad', [f.order[0], f.order[0]], ['other/foreign.png'], [f.order[0], 1]]) {
      const view = plain(f.view); if (proof === undefined) delete view.protectedDetailImageKeys; else view.protectedDetailImageKeys = proof;
      const before = retained(f), calls = f.calls.length, { deps, trace } = traceDependencies(f);
      await assert.rejects(prepare(f, deps, { ...f.input, view }));
      for (const list of Object.values(trace)) assert.equal(list.length, 0);
      assert.equal(f.calls.length, calls); assert.equal(retained(f), before);
    }
  } finally { f.close(); }
});

test('a cached legacy-ready banner cannot be applied even with a currently valid source and quotation binding', async () => {
  const f = await fixture(schemaCompanies[0]);
  try {
    await roles(f);
    const cached = await cachedBanner(f);
    const before = retained(f), calls = f.calls.length, { deps, trace } = traceDependencies(f);
    await assert.rejects(f.model.applyDetailBatchResult(cached, 0, signal(), () => {}, deps));
    assert.equal(trace.read.length, 0); assert.equal(uploads(f), 0); assert.equal(retained(f), before);
    assert.ok(f.calls.slice(calls).every(call => (call.init.method ?? 'GET') === 'GET'));
  } finally { f.close(); }
});

test('a body result becoming a protected banner blocks apply before another source read or any upload', async () => {
  const f = await fixture(schemaCompanies[0]);
  try {
    await roles(f); const { deps, trace } = traceDependencies(f), batch = await prepare(f, deps);
    await roles(f, { top: [f.order[1]], body: [f.order[0]], bottom: [f.order[2]] });
    const before = retained(f), sourceReads = trace.read.length;
    await assert.rejects(f.model.applyDetailBatchResult(batch, 1, signal(), () => {}, deps));
    assert.equal(trace.read.length, sourceReads); assert.equal(uploads(f), 0); assert.equal(retained(f), before);
  } finally { f.close(); }
});

test('unknown body save cannot recover into a retry after the saved source becomes a protected banner', async () => {
  const f = await fixture(schemaCompanies[0]);
  try {
    await roles(f); const { deps } = traceDependencies(f); let batch = await prepare(f, deps);
    f.intercept(async (_url, init) => { if (init.body instanceof FormData) throw Error('fixture response lost before commit'); });
    await assert.rejects(f.model.applyDetailBatchResult(batch, 1, signal(), value => { batch = value; }, deps));
    assert.equal(batch.items[1].status, 'uncertain'); assert.equal(uploads(f), 1);
    f.intercept(null); await roles(f, { top: [f.order[1]], body: [f.order[0]], bottom: [f.order[2]] });
    const before = retained(f), calls = f.calls.length;
    await assert.rejects(f.model.recoverDetailBatchResult(batch, signal(), () => {}, deps));
    assert.equal(uploads(f), 1); assert.equal(batch.items[1].status, 'uncertain'); assert.equal(retained(f), before);
    assert.ok(f.calls.slice(calls).every(call => (call.init.method ?? 'GET') === 'GET'
      || call.init.method === 'POST' && typeof call.init.body === 'string' && JSON.parse(call.init.body).action === 'recover'), 'recovery only reads the existing result');
    await assert.rejects(f.model.applyDetailBatchResult(batch, 1, signal(), () => {}, deps));
    assert.equal(uploads(f), 1);
  } finally { f.close(); }
});

test('legacy unknown banner outcomes are read back as applied or skipped and never authorize another upload', async () => {
  for (const committed of [false, true]) {
    const f = await fixture(schemaCompanies[0]);
    try {
      await roles(f); const cached = await cachedBanner(f), entry = cached.items[0];
      const uncertain = { ...cached, items: [{ ...entry, status: 'uncertain', attempt: { image: entry.rendered, before: f.view } }] };
      if (committed) await f.h.load('app/free-image-translation-client.ts').applyFreeImageTranslation(entry.rendered, signal(), f.deps.fetcher);
      const before = retained(f), writes = uploads(f);
      const recovered = await f.model.recoverDetailBatchResult(uncertain, signal(), () => {}, f.deps);
      assert.equal(recovered.items[0].status, committed ? 'applied' : 'skipped');
      assert.equal(recovered.items[0].attempt, undefined); assert.equal(uploads(f), writes); assert.equal(retained(f), before);
      if (!committed) { assert.equal(recovered.items[0].rendered, undefined); assert.deepEqual(plain(recovered.items[0].texts), []); }
      await assert.rejects(f.model.applyDetailBatchResult(recovered, 0, signal(), () => {}, f.deps));
      assert.equal(uploads(f), writes); assert.equal(retained(f), before);
    } finally { f.close(); }
  }
});

test('additional image batches never exclude a saved slot merely because its key is also a protected detail banner', async () => {
  const f = await fixture(schemaCompanies[0], { stage: 'additional' });
  try {
    await roles(f); const before = retained(f), { deps, trace } = traceDependencies(f), batch = await prepare(f, deps);
    assert.deepEqual(plain(batch.items.map(item => item.status)), ['ready', 'ready', 'ready']);
    assert.deepEqual(trace.read, f.order.map((key, slot) => ({ key, slot })));
    const missingProof = plain(f.view); delete missingProof.protectedDetailImageKeys;
    assert.deepEqual(plain(f.model.detailBatchTranslationSlots(missingProof, f.selected, f.profile.id, 'additional')),
      { keys: f.order, slots: [0, 1, 2], protectedSlots: [] });
    assert.equal(retained(f), before); assert.equal(uploads(f), 0);
  } finally { f.close(); }
});
