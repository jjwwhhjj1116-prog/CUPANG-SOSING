import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { createRequire } from 'node:module';
import { mobileIntakeHarness } from './helpers/mobile-intake.mjs';

const native = createRequire(import.meta.url);
const companies = [{ code: 'A01464742', name: '와이홉' }, { code: 'A01526306', name: '유앤채' }];
const nodes = tree => Array.isArray(tree) ? tree.flatMap(nodes) : tree && typeof tree === 'object' ? [tree, ...nodes(tree.props?.children)] : [];
const json = async (response, status = 200) => { assert.equal(response.status, status, await response.clone().text()); return response.json(); };

async function fixture(company) {
  const h = mobileIntakeHarness({ companyCode: company.code, companyName: company.name });
  await h.load('db/queries.ts').saveSettings('owner', JSON.stringify(h.settings));
  const create = async (suffix, fingerprint, prefix) => {
    const created = await json(await h.load('app/api/products/route.ts').POST(new Request('https://app.test/api/products', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sourceUrl: 'https://detail.1688.com/offer/63400000000' + suffix + '.html', title: '합성 원본 ' + prefix,
        sourcePriceCny: 5, optionsCount: 2, goalStage: 'price' }),
    })), 201);
    const product = created.product, observedAt = Date.now() - 10000, quotationId = 'original-' + company.code + '-' + suffix;
    const result = { state: 'validation-complete', registered: false, filename: `YOOFAM-${fingerprint}.xlsx`, company,
      includedOptions: 2, quotationId, observedAt, status: '파일 검증 완료', registration: {
        quotationId, scope: 'queried-pages', pagesRead: 1, hasMore: false, includedOptions: 2, registered: false, observedAt,
        rows: [0, 1].map(index => ({ title: prefix + ' ' + index, skuId: prefix + '-SKU-' + index, submittedAt: '2026-10-13',
          category: '합성 시험', barcode: '', sourceQuotation: `YOOFAM-${fingerprint}.xlsx`, status: '상품 검수중', stage: '상품 확인' })),
      } };
    const receipt = { schemaVersion: 1, evidence: 'chrome-observation', profileId: 'original-profile', categoryId: '80719',
      fingerprint, productVersion: product.updated_at, recordedAt: new Date(observedAt).toISOString(), result };
    await h.load('db/supplier-hub-receipts.ts').ensureSupplierHubReceiptDatabase();
    h.sqlite.prepare('INSERT INTO supplier_hub_receipts VALUES(?,?,?,?,?,?)').run('owner', product.id, fingerprint,
      observedAt, h.load('app/supplier-hub-receipt.ts').supplierHubReceiptOrder(result), JSON.stringify(receipt));
    const content = await json(await h.route('/api/products/' + product.id + '/content'));
    await json(await h.route('/api/products/' + product.id + '/content', { method: 'PATCH', body: {
      expectedRevision: content.content.revision, patch: { seo: { title: '직접 수정한 B ' + prefix, description: '' }, label: { manufacturer: '' } },
    } }));
    return { productId: product.id, receipt };
  };
  try {
    const first = await create(1, 'a'.repeat(64), 'ORIGINAL'), second = await create(2, 'b'.repeat(64), 'SECOND');
    const sources = () => JSON.stringify(['products', 'product_content', 'product_options', 'product_quotation_fields', 'product_price_policy']
      .map(table => h.sqlite.prepare('SELECT * FROM ' + table + ' ORDER BY rowid').all()));
    return { h, first, second, sources, close() { h.close(); } };
  } catch (error) { h.close(); throw error; }
}

function panel(f, options = {}) {
  const modules = new Map(), frames = new Map(), effects = [], calls = [], messages = [], listeners = new Set();
  let props = { ...f.first }, frame, cursor = 0, saved = 0, closed = false, hold, release;
  const hooks = {
    useState(initial) { const current = frame, index = cursor++; if (!(index in current.slots)) current.slots[index] = typeof initial === 'function' ? initial() : initial;
      return [current.slots[index], value => { current.slots[index] = typeof value === 'function' ? value(current.slots[index]) : value; }]; },
    useRef(initial) { const index = cursor++; return frame.slots[index] ?? (frame.slots[index] = { current: initial }); },
    useEffect(fn, deps) { const current = frame, index = cursor++, old = current.slots[index];
      if (!old || !deps || deps.some((dep, i) => !Object.is(dep, old.deps[i]))) { current.slots[index] = { deps, cleanup: old?.cleanup };
        effects.push(() => { old?.cleanup?.(); current.slots[index].cleanup = fn(); }); }
    },
  };
  const win = { location: { origin: 'https://app.test' }, addEventListener(_type, listener) { listeners.add(listener); },
    removeEventListener(_type, listener) { listeners.delete(listener); }, postMessage(request) {
      messages.push(request);
      assert.ok(['PING', 'REFRESH', 'REGISTRATION'].includes(request.type), 'historical lookup cannot upload or request validation');
      const emit = () => {
        const base = request.payload?.fingerprint === f.second.receipt.fingerprint ? f.second.receipt : f.first.receipt;
        let record = { ...structuredClone(base.result), observedAt: base.result.observedAt + 1000 };
        if (request.type === 'REFRESH') {
          if (options.cached === 'older') record.registration = { ...record.registration, observedAt: base.result.observedAt - 1, rows: [] };
          else delete record.registration;
        } else if (request.type === 'REGISTRATION') {
          record.registration.observedAt = base.result.observedAt + 2000;
          record.registration.rows = record.registration.rows.map(row => ({ ...row, status: '검수 상태 확인됨' }));
        }
        Object.assign(record, options.resultPatch ?? {}, { origin: win.location.origin, productId: request.payload?.productId,
          categoryId: base.categoryId, fingerprint: base.fingerprint });
        const result = request.type === 'PING' ? { ok: true, historicalReceiptLookup: true, productTransmissionHistory: true }
          : { ok: true, fingerprint: base.fingerprint, registered: false, record };
        queueMicrotask(() => { for (const listener of [...listeners]) listener({ source: win, origin: win.location.origin,
          data: { channel: 'YOOFAM_HUB_HANDOFF_RESULT', requestId: request.requestId, result } }); });
      };
      if (hold && request.type === 'REFRESH') { hold = false; release = emit; } else emit();
    } };
  const fetcher = async (path, init = {}) => {
    const method = init.method ?? 'GET'; calls.push({ method, path, body: init.body ? JSON.parse(init.body) : undefined });
    if (method === 'POST' && options.postStatus) return Response.json({ error: '보관 확인 실패' }, { status: options.postStatus });
    if (method === 'POST' && options.badAck) return Response.json({ saved: true, fingerprint: 'c'.repeat(64), registered: false });
    if (method === 'GET' && options.getStatus) return Response.json({ error: '조회 확인 실패' }, { status: options.getStatus });
    const response = await f.h.route(path, { method, body: init.body });
    if (method === 'GET' && options.readVersion) {
      const body = await response.json(); if (body.receipt) body.receipt.productVersion = '2000-01-01T00:00:00.000Z'; return Response.json(body);
    }
    return response;
  };
  function load(file) {
    if (modules.has(file)) return modules.get(file); const exports = {}; modules.set(file, exports);
    const extension = file.startsWith('app/components/') ? '.tsx' : '.ts';
    vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../' + file + extension, import.meta.url), 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
    }).outputText, { exports, Error, URL, AbortController, Date, crypto, TextEncoder, setTimeout, clearTimeout, window: win, fetch: fetcher,
      require(name) { if (name === 'react') return hooks; return name.startsWith('@/') ? load(name.slice(2)) : native(name); } });
    return exports;
  }
  const Component = load('app/components/historical-supplier-hub-result').HistoricalSupplierHubResult;
  function renderNode(node, path, used) {
    if (Array.isArray(node)) return node.map((item, index) => renderNode(item, path + ':' + index, used));
    if (!node || typeof node !== 'object') return node;
    if (typeof node.type === 'function') {
      const key = path + ':' + node.type.name + ':' + String(node.key ?? ''); used.add(key);
      frame = frames.get(key) ?? { slots: [] }; frames.set(key, frame); cursor = 0;
      return renderNode(node.type(node.props), key, used);
    }
    return { ...node, props: { ...node.props, children: renderNode(node.props?.children, path + '/children', used) } };
  }
  function render() {
    const used = new Set(), tree = renderNode({ type: Component, props: { ...props, onSaved() { saved++; } } }, 'root', used);
    for (const [key, old] of frames) if (!used.has(key)) { for (const slot of old.slots) slot?.cleanup?.(); frames.delete(key); }
    while (effects.length) effects.shift()(); return tree;
  }
  return { calls, messages, get saved() { return saved; }, render,
    rows() { return nodes(render()).filter(node => node.type === 'tbody').flatMap(node => nodes(node).filter(child => child.type === 'tr')); },
    async settle() { for (let i = 0; i < 12; i++) { render(); await new Promise(resolve => setImmediate(resolve)); } },
    button(label) { const button = nodes(render()).find(node => node.type === 'button' && node.props.children === label); assert.ok(button); return button; },
    hold() { hold = true; }, release() { release?.(); }, setProps(value) { props = value; render(); },
    resetFailures() { options.postStatus = undefined; options.badAck = false; options.getStatus = undefined; options.readVersion = false; },
    close() { if (closed) return; closed = true; for (const current of frames.values()) for (const slot of current.slots) slot?.cleanup?.(); },
  };
}

for (const company of companies) for (const cached of ['missing', 'older']) test(`historical file-only ${cached} rows keep stored SKUs and their observation clock (${company.code})`, async () => {
  const f = await fixture(company), p = panel(f, { cached });
  try {
    const before = f.sources(), previous = f.first.receipt.result.registration;
    assert.equal(p.rows().length, 2); p.button('원래 견적서 검증 결과 조회').props.onClick(); await p.settle();
    assert.equal(p.rows().length, 2, 'file validation is not a new SKU observation');
    assert.equal(p.saved, 1); assert.ok(!nodes(p.render()).some(node => node.props?.role === 'alert'));
    const stored = await json(await f.h.route('/api/products/' + f.first.productId + '/supplier-hub-receipt?fingerprint=' + f.first.receipt.fingerprint));
    assert.equal(stored.receipt.productVersion, f.first.receipt.productVersion);
    assert.equal(stored.receipt.result.registration.observedAt, previous.observedAt);
    assert.deepEqual(stored.receipt.result.registration.rows, previous.rows);
    assert.equal(stored.receipt.result.observedAt, f.first.receipt.result.observedAt, 'equal registration evidence may give an unchanged 200 acknowledgement');
    const posted = p.calls.find(call => call.method === 'POST');
    assert.equal(posted.body.result.registration.observedAt, previous.observedAt);
    assert.equal(p.messages.filter(message => message.type === 'REFRESH').length, 1);
    assert.ok(p.calls.some(call => call.method === 'GET'), 'adoption must read the authoritative original receipt after its acknowledgement');
    p.button('원래 견적서 상품별 상태 조회').props.onClick(); await p.settle();
    assert.equal(p.saved, 2); assert.equal(p.rows().length, 2);
    assert.ok(JSON.stringify(p.render()).includes('검수 상태 확인됨'));
    assert.equal(f.sources(), before); assert.deepEqual(f.h.network, []);
  } finally { p.close(); f.close(); }
});

for (const company of companies) test(`failed history ACK or readback never replaces the prior receipt and explicit retry stays read-only (${company.code})`, async () => {
  for (const options of [{ postStatus: 403 }, { postStatus: 409 }, { postStatus: 503 }, { badAck: true }, { getStatus: 503 }, { readVersion: true }]) {
    const f = await fixture(company), p = panel(f, options);
    try {
      const before = f.sources(), previous = JSON.stringify(p.render());
      p.button('원래 견적서 검증 결과 조회').props.onClick(); await p.settle();
      assert.equal(p.rows().length, 2); assert.equal(p.saved, 0);
      assert.ok(nodes(p.render()).some(node => node.props?.role === 'alert'));
      assert.ok(JSON.stringify(p.render()).includes('ORIGINAL-SKU-1'));
      assert.ok(previous.includes('ORIGINAL-SKU-1')); assert.equal(p.calls.filter(call => call.method === 'POST').length, 1);
      p.resetFailures(); p.button('원래 견적서 검증 결과 조회').props.onClick(); await p.settle();
      assert.equal(p.saved, 1); assert.equal(p.rows().length, 2); assert.equal(p.calls.filter(call => call.method === 'POST').length, 2);
      assert.equal(f.sources(), before); assert.deepEqual(f.h.network, []);
    } finally { p.close(); f.close(); }
  }
});

for (const company of companies) test(`an original receipt scope change aborts the late result without showing or storing it (${company.code})`, async () => {
  const f = await fixture(company), p = panel(f);
  try {
    const before = f.sources(); p.hold(); p.button('원래 견적서 검증 결과 조회').props.onClick(); await p.settle();
    p.setProps(f.second); assert.ok(JSON.stringify(p.render()).includes('SECOND-SKU-1'));
    p.release(); await p.settle(); assert.ok(JSON.stringify(p.render()).includes('SECOND-SKU-1'));
    assert.ok(!JSON.stringify(p.render()).includes('ORIGINAL-SKU-1'));
    assert.equal(p.saved, 0); assert.equal(p.calls.filter(call => call.method === 'POST').length, 0);
    assert.equal(f.sources(), before); assert.deepEqual(f.h.network, []);
  } finally { p.close(); f.close(); }
});

for (const company of companies) test(`changed validation state, company, ID or explicit newer SKU snapshot is never merged with old issued rows (${company.code})`, async () => {
  const patches = ['not-found', 'validation-pending', 'validation-rejected'].map(state => ({ state }));
  patches.push({ quotationId: 'another-full-id' }, { company: companies.find(value => value.code !== company.code) },
    { includedOptions: 1 });
  for (const resultPatch of [...patches, null]) {
    const f = await fixture(company);
    const patch = resultPatch ?? { registration: { ...structuredClone(f.first.receipt.result.registration), observedAt: Date.now() + 1000, rows: [] } };
    const p = panel(f, { resultPatch: patch });
    try {
      const before = f.sources(), receiptBefore = f.h.sqlite.prepare('SELECT payload FROM supplier_hub_receipts WHERE product_id=?').get(f.first.productId).payload;
      p.button('원래 견적서 검증 결과 조회').props.onClick(); await p.settle();
      assert.equal(p.saved, 0); assert.equal(p.rows().length, 2); assert.ok(nodes(p.render()).some(node => node.props?.role === 'alert'));
      assert.equal(f.h.sqlite.prepare('SELECT payload FROM supplier_hub_receipts WHERE product_id=?').get(f.first.productId).payload, receiptBefore);
      const posted = p.calls.find(call => call.method === 'POST');
      if (['not-found', 'validation-pending', 'validation-rejected'].includes(patch.state)) assert.equal(posted?.body.result.registration, undefined);
      if (resultPatch === null) assert.deepEqual(posted.body.result.registration.rows, [], 'an explicitly newer empty lookup cannot be replaced with old SKUs');
      assert.equal(p.calls.filter(call => call.method === 'GET').length, 0); assert.equal(f.sources(), before); assert.deepEqual(f.h.network, []);
    } finally { p.close(); f.close(); }
  }
});
