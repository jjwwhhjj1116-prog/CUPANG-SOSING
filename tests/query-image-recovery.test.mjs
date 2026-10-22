import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { createRequire } from 'node:module';
import { mobileIntakeHarness } from './helpers/mobile-intake.mjs';
import { intakeOwnerScopeHarness, intakeScopeCompanies } from './helpers/intake-owner-scope.mjs';

const native = createRequire(import.meta.url);
const nodes = tree => Array.isArray(tree) ? tree.flatMap(nodes) : tree && typeof tree === 'object' ? [tree, ...nodes(tree.props?.children)] : [];
const text = tree => typeof tree === 'string' || typeof tree === 'number' ? String(tree) : Array.isArray(tree) ? tree.map(text).join('') : tree && typeof tree === 'object' ? text(tree.props?.children) : '';
const settle = async () => { for (let index = 0; index < 20; index++) await new Promise(resolve => setImmediate(resolve)); };
const eventually = async predicate => { for (let index = 0; index < 200 && !predicate(); index++) await new Promise(resolve => setTimeout(resolve, 5)); assert.equal(predicate(), true, 'The synthetic request did not settle.'); };
const captureId = '79200000-0000-4000-8000-000000000001';
const selection = url => ({ format: 'yoofam-saved-query-capture-v1', sourceUrl: url, captureId, fingerprint: 'a'.repeat(64), revision: 1 });

function receiptPanel(fetcher, props = {}, loadActual) {
  const slots = [], effects = []; let cursor = 0, closed = false, lateUpdates = 0;
  const hooks = {
    useState(initial) { const slot = cursor++; if (!(slot in slots)) slots[slot] = initial; return [slots[slot], value => { if (closed) { lateUpdates++; return; } slots[slot] = typeof value === 'function' ? value(slots[slot]) : value; }]; },
    useRef(initial) { const slot = cursor++; return slots[slot] ?? (slots[slot] = { current: initial }); },
    useEffect(effect, deps) { const slot = cursor++, prior = slots[slot]; if (!prior || deps?.some((value, index) => !Object.is(value, prior.deps[index]))) { slots[slot] = { deps, cleanup: prior?.cleanup }; effects.push(() => { slots[slot].cleanup?.(); slots[slot].cleanup = effect(); }); } },
  };
  const cache = new Map();
  function load(file) {
    if (cache.has(file)) return cache.get(file);
    const exports = {}; cache.set(file, exports);
    vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../' + file, import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText, {
      exports, Error, URL, Date, Headers, AbortController, AbortSignal, setTimeout: callback => setImmediate(callback), clearTimeout: clearImmediate, fetch: fetcher,
      require(name) {
        if (name === 'react') return hooks;
        if (name === 'react/jsx-runtime') return native(name);
        if (name === '@/app/components/collection-price-basis-panel') return { CollectionPriceBasisPanel: () => null };
        if (loadActual && !name.includes('/components/')) return loadActual(name.slice(2) + '.ts');
        return load(name.slice(2) + (name.includes('/components/') ? '.tsx' : '.ts'));
      },
    });
    return exports;
  }
  const Panel = load('app/components/collection-result-panel.tsx').CollectionResultPanel;
  function render() { cursor = 0; const wrapper = Panel({ jobId: 'job', offerId: '813724060928', onSaved() {}, ...props }); const tree = wrapper.type(wrapper.props); effects.splice(0).forEach(effect => effect()); return tree; }
  const button = label => { const found = nodes(render()).find(node => node.type === 'button' && text(node) === label); assert.ok(found, 'Missing action ' + label); return found; };
  return { render, button, async click(label) { const action = button(label); assert.equal(action.props.disabled, false); action.props.onClick(); await settle(); }, async importImages() { const action = nodes(render()).find(node => node.type === 'button' && text(node).startsWith('상품·선택 이미지 ')); assert.ok(action); assert.equal(action.props.disabled, false); action.props.onClick(); await settle(); }, close() { closed = true; for (const slot of slots) slot?.cleanup?.(); }, get lateUpdates() { return lateUpdates; } };
}

for (const company of intakeScopeCompanies) {
  test(`${company.code}: only the exact failed query row opens an image-only recovery panel`, async () => {
    const h = intakeOwnerScopeHarness(company);
    try {
      const protectedRow = JSON.stringify(h.rows[0]);
      const sourceUrl = 'https://detail.1688.com/offer/792000000001.html';
      const row = { ...h.newRow(), id: 'new-query-row', url: sourceUrl, sourceCapture: selection(sourceUrl), status: 'error', productId: 'new-query-product', message: '초안 저장됨 · 원본 이미지 저장 실패' };
      const job = { id: '79200000-0000-4000-8000-000000000002', offer_id: '792000000001', source_url: sourceUrl, product_id: row.productId, status: 'awaiting_connector', received_at: '2026-10-22T00:00:00.000Z' };
      h.jobs.push(job); h.setRows([...h.rows, row]);
      assert.equal(nodes(h.render()).filter(node => node.type === 'button' && text(node) === '누락 원본 이미지 이어받기').length, 1);
      h.button('누락 원본 이미지 이어받기').props.onClick();
      const panel = nodes(h.render()).find(node => node.type?.name === 'CollectionResultPanel');
      assert.ok(panel); assert.equal(panel.props.jobId, job.id); assert.equal(panel.props.productId, row.productId); assert.equal(panel.props.expectedProductId, row.productId); assert.equal(panel.props.assignToStage, false); assert.equal(panel.props.isCurrent(), true);
      panel.props.onSaved({ status: 'completed', productId: 'wrong-product' }); assert.equal(JSON.stringify(h.rows[0]), protectedRow); assert.equal(h.rows[1], row);
      panel.props.onSaved({ status: 'completed', productId: row.productId }); assert.equal(JSON.stringify(h.rows[0]), protectedRow); assert.equal(h.rows[1].status, 'error'); assert.match(h.rows[1].message, /다른 미완료 단계/); assert.equal(h.posts.length, 0); assert.equal(h.collections.length, 0);
    } finally { h.close(); }
  });

  test(`${company.code}: ambiguous jobs, saved rows and protected non-query rows cannot expose recovery`, () => {
    for (const mutation of ['duplicate', 'url', 'product', 'cancelled', 'missing-receipt', 'saved', 'page', 'unselected']) {
      const h = intakeOwnerScopeHarness(company);
      try {
        const sourceUrl = 'https://detail.1688.com/offer/792000000001.html';
        const row = { ...h.newRow(), sourceCapture: selection(sourceUrl), url: sourceUrl, status: mutation === 'saved' ? 'saved' : 'error', productId: 'new-product' };
        const job = { id: 'new-job', source_url: mutation === 'url' ? 'https://detail.1688.com/offer/792000000002.html' : sourceUrl, offer_id: '792000000001', product_id: mutation === 'product' ? 'another-product' : row.productId, status: mutation === 'cancelled' ? 'cancelled' : 'awaiting_connector', received_at: mutation === 'missing-receipt' ? null : '2026-10-22T00:00:00Z' };
        if (mutation === 'page') row.sourceCapture.format = 'yoofam-saved-page-capture-v1';
        if (mutation === 'unselected') delete row.sourceCapture;
        h.jobs.push(job, ...(mutation === 'duplicate' ? [{ ...job, id: 'ambiguous-second-job' }] : [])); h.setRows([row]);
        assert.equal(nodes(h.render()).some(node => node.type === 'button' && text(node) === '누락 원본 이미지 이어받기'), false, mutation);
      } finally { h.close(); }
    }
  });

  test(`${company.code}: retained callbacks reject changed rows, job links and owner ABA changes`, () => {
    for (const change of ['row', 'job', 'owner-back', 'unmount']) {
      const h = intakeOwnerScopeHarness(company);
      try {
        const sourceUrl = 'https://detail.1688.com/offer/792000000001.html';
        const row = { ...h.newRow(), url: sourceUrl, sourceCapture: selection(sourceUrl), status: 'error', productId: 'new-product' };
        h.jobs.push({ id: 'new-job', source_url: sourceUrl, offer_id: '792000000001', product_id: row.productId, status: 'awaiting_connector', received_at: '2026-10-22T00:00:00Z' }); h.setRows([row]);
        const open = h.button('누락 원본 이미지 이어받기').props.onClick; open();
        const panel = nodes(h.render()).find(node => node.type?.name === 'CollectionResultPanel'); assert.equal(panel.props.isCurrent(), true);
        if (change === 'row') h.setRows([{ ...row, message: '다른 작업에서 변경됨' }]);
        if (change === 'job') h.jobs[0] = { ...h.jobs[0], product_id: 'another-product' };
        if (change === 'owner-back') { h.switchOwner('other-owner'); h.switchOwner(company.owner); }
        if (change === 'unmount') h.close();
        assert.equal(panel.props.isCurrent(), false, change);
        const before = JSON.stringify(h.rows); panel.props.onSaved({ status: 'completed', productId: row.productId }); open(); assert.equal(JSON.stringify(h.rows), before, change); assert.equal(h.lateStateWrites, 0, change); assert.equal(h.posts.length, 0);
      } finally { h.close(); }
    }
  });
}

const json = async (response, status = 200) => { assert.equal(response.status, status, await response.clone().text()); return response.json(); };
const editableContent = payload => { const content = JSON.parse(payload); delete content.revision; delete content.updatedAt; return JSON.stringify(content); };
async function partialDraft(company) {
  const urls = [0, 1, 2].map(index => `https://cbu01.alicdn.com/synthetic-recovery-${index}.png`);
  const good = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2RkcAAAAASUVORK5CYII=', 'base64');
  const bytes = [good, Uint8Array.of(1, 2), Uint8Array.of(3, 4)];
  const h = mobileIntakeHarness({ ...company, fixtureImageUrls: urls, fixtureImageBytes: bytes });
  const source = { schemaVersion: 1, sourceUrl: h.sourceUrl, offerId: '813724060928', provider: 'public-product-jsonld-v1', collectedAt: '2026-10-01T00:00:00.000Z', title: '합성 원본 이미지 복구 상품', description: '합성 원문', options: [{ sku: 'synthetic-sku', name: '검정', unitPriceCny: 2, minimumOrder: 1, stock: 5, imageIndex: 0 }], images: urls.map((url, index) => ({ url, role: index ? 'detail' : 'main' })) };
  h.load('app/product-query.ts').queryProductSource = async () => ({ source, sourceStored: false, draftCreated: false, provider: 'public-page', offerId: source.offerId });
  const stored = await json(await h.load('app/api/query-captures/route.ts').POST(new Request('https://app.test/api/query-captures', { method: 'POST', headers: { origin: 'https://app.test', 'content-type': 'application/json' }, body: JSON.stringify({ id: captureId, sourceUrl: h.sourceUrl, expectedOwnerId: 'owner', expectedCompany: { code: company.companyCode, name: company.companyName } }) })));
  const capture = h.load('app/source-capture-selection.ts').querySourceCaptureSelection(h.load('app/query-source-capture.ts').querySourceCaptureSummary(stored.item));
  h.sqlite.prepare("UPDATE collection_jobs SET goal='collect'").run();
  const job = await h.load('db/collection-jobs.ts').findCollectionJob('owner', 'job');
  await assert.rejects(h.load('app/intake-collection.ts').collectIntakeProduct(job, { signal: new AbortController().signal, fetcher: (path, init) => h.route(path, { method: init?.method ?? 'GET', body: init?.body }), selectedCapture: capture, onJob() {}, onProgress() {} }), /이미지/);
  const productId = h.sqlite.prepare("SELECT product_id FROM collection_products WHERE job_id='job'").get().product_id;
  assert.equal(h.sqlite.prepare('SELECT count(*) n FROM collection_images').get().n, 1);
  assert.equal(h.objects.size, 1);
  return { h, productId, capture, repair() { bytes[1] = Buffer.concat([good, Buffer.from([1])]); bytes[2] = Buffer.concat([good, Buffer.from([2])]); } };
}

for (const company of [{ companyCode: 'A01526306', companyName: '유앤채' }, { companyCode: 'A01464742', companyName: '와이홉' }]) test(`${company.companyCode}: real query intake with two failed images recovers only missing originals and preserves manual stages`, async () => {
  const { h, productId, capture, repair } = await partialDraft(company);
  let panel;
  try {
    const content = JSON.parse(h.sqlite.prepare('SELECT payload FROM product_content WHERE product_id=?').get(productId).payload);
    const savedKey = h.sqlite.prepare('SELECT object_key FROM collection_images').get().object_key;
    await json(await h.route(`/api/products/${productId}/content`, { method: 'PATCH', body: { expectedRevision: content.revision, patch: { seo: { title: '사용자가 직접 수정한 제목', description: '설명 보존', keywords: ['수동 키워드'] }, assets: { main: [savedKey], detail: [] } } } }));
    const beforeContent = h.sqlite.prepare('SELECT payload FROM product_content WHERE product_id=?').get(productId).payload;
    const beforeOptions = h.sqlite.prepare('SELECT payload FROM product_options WHERE product_id=?').get(productId).payload;
    const originalProduct = h.sqlite.prepare('SELECT * FROM products WHERE id=?').get(productId), protectedProduct = { ...originalProduct, id: 'synthetic-protected-existing', title: '보호해야 할 기존 작업' };
    const columns = Object.keys(protectedProduct); h.sqlite.prepare(`INSERT INTO products(${columns.join(',')}) VALUES(${columns.map(() => '?').join(',')})`).run(...Object.values(protectedProduct));
    const protectedBefore = JSON.stringify(h.sqlite.prepare('SELECT * FROM products WHERE id=?').get(protectedProduct.id));
    repair(); const attempts = [], outcomes = [];
    panel = receiptPanel(async (path, init) => { if (path.endsWith('/images')) attempts.push(JSON.parse(init.body)); return h.route(path, { method: init?.method ?? 'GET', body: init?.body }); }, { productId, expectedProductId: productId, assignToStage: false, onSaved: outcome => outcomes.push(outcome) }, h.load);
    await panel.click('수신 결과 조회');
    assert.deepEqual(nodes(panel.render()).filter(node => node.type === 'input').map(node => node.props.checked), [false, true, true]);
    await panel.importImages();
    await eventually(() => outcomes.length > 0);
    assert.deepEqual(attempts, [{ index: 1, assignToStage: false }, { index: 2, assignToStage: false }]);
    assert.equal(outcomes.at(-1).status, 'completed'); assert.equal(outcomes.at(-1).productId, productId); assert.equal(h.objects.size, 3);
    // Saving library files increments only the document's concurrency revision/time.
    // Every editable field, its provenance and per-field timestamp must remain exact.
    assert.equal(editableContent(h.sqlite.prepare('SELECT payload FROM product_content WHERE product_id=?').get(productId).payload), editableContent(beforeContent));
    assert.equal(h.sqlite.prepare('SELECT payload FROM product_options WHERE product_id=?').get(productId).payload, beforeOptions);
    assert.equal(JSON.stringify(h.sqlite.prepare('SELECT * FROM products WHERE id=?').get(protectedProduct.id)), protectedBefore);
    assert.equal(h.aiSources.length, 0); assert.ok(h.network.every(host => host === 'cbu01.alicdn.com')); assert.ok(!h.calls.some(path => /translation|image-draft|submission|supplier-hub/.test(path)));
    assert.deepEqual(capture.sourceUrl, h.sourceUrl); assert.equal(h.sqlite.prepare('SELECT count(*) n FROM products').get().n, 2);
  } finally { panel?.close(); h.close(); }
});

test('server product mismatch is rejected before the first image write and cannot publish a different product', async () => {
  const source = { schemaVersion: 1, sourceUrl: 'https://detail.1688.com/offer/813724060928.html', offerId: '813724060928', provider: 'synthetic', collectedAt: '2026-10-22T00:00:00Z', title: '합성 원문', description: '', options: [{ sku: 'x', name: 'x', unitPriceCny: 1, minimumOrder: 1, stock: 1 }], images: [{ url: 'https://cbu01.alicdn.com/synthetic.png', role: 'main' }] };
  const calls = [], saved = [];
  const panel = receiptPanel(async (path, init) => { calls.push([path, init?.method]); if (path.endsWith('/result')) return Response.json({ jobId: 'job', offerId: source.offerId, receipt: { result: source }, message: '합성' }); if (path.endsWith('/capacity')) return Response.json({ capacity: { usedSlots: 0, totalImages: 1, reusableIndices: [] } }); return Response.json({ productId: 'different-product' }); }, { productId: 'expected-product', expectedProductId: 'expected-product', assignToStage: false, onSaved: result => saved.push(result) });
  try { await panel.click('수신 결과 조회'); await panel.importImages(); assert.ok(!calls.some(([path]) => path.endsWith('/images'))); assert.equal(saved.length, 0); assert.match(text(panel.render()), /서버의 상품 연결/); }
  finally { panel.close(); }
});

for (const mismatch of ['company', 'owner', 'stale-row']) test(`${mismatch} change after review prevents missing-image requests through the real product gate`, async () => {
  const { h, productId, repair } = await partialDraft({ companyCode: 'A01526306', companyName: '유앤채' });
  let current = true, panel;
  try {
    repair(); const images = [], saved = [];
    panel = receiptPanel(async (path, init) => { if (path.endsWith('/images')) images.push(JSON.parse(init.body)); return h.route(path, { method: init?.method ?? 'GET', body: init?.body }); }, { productId, expectedProductId: productId, assignToStage: false, isCurrent: () => current, onSaved: outcome => saved.push(outcome) }, h.load);
    await panel.click('수신 결과 조회');
    if (mismatch === 'company') h.setCompany({ code: 'A01464742', name: '와이홉' });
    if (mismatch === 'owner') h.sqlite.prepare("UPDATE collection_jobs SET owner_id='another-owner' WHERE id='job'").run();
    if (mismatch === 'stale-row') current = false;
    await panel.importImages(); assert.equal(images.length, 0); assert.equal(saved.length, 0); assert.equal(h.objects.size, 1); assert.equal(h.aiSources.length, 0);
  } finally { panel?.close(); h.close(); }
});
