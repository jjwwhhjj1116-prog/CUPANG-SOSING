import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';
import { createRequire } from 'node:module';
import { mobileIntakeHarness } from './helpers/mobile-intake.mjs';

const native = createRequire(import.meta.url);
const plain = value => JSON.parse(JSON.stringify(value));
const nodes = value => Array.isArray(value) ? value.flatMap(nodes) : value && typeof value === 'object' ? [value, ...nodes(value.props?.children)] : [];
const text = value => Array.isArray(value) ? value.map(text).join('') : value && typeof value === 'object' ? text(value.props?.children) : value == null ? '' : String(value);
const sameDeps = (left, right) => Array.isArray(left) && Array.isArray(right) && left.length === right.length && right.every((item, index) => Object.is(item, left[index]));
const json = async response => { assert.equal(response.status, 200, await response.clone().text()); return response.json(); };
const companies = [{ code: 'A01526306', name: '유앤채' }, { code: 'A01464742', name: '와이홉' }];

// Run the real content editor against local API handlers and SQLite/R2. The
// seller, translator and image bytes are recorded inert fixtures throughout.
async function fixture(company) {
  const api = mobileIntakeHarness({ companyCode: company.code, companyName: company.name });
  api.sqlite.prepare("UPDATE collection_jobs SET goal='work'").run();
  await api.intake();
  const product = api.sqlite.prepare('SELECT * FROM products').get();
  const base = '/api/products/' + product.id;
  const read = async () => (await json(await api.route(base + '/content'))).content;
  const original = await read();
  assert.equal(original.detailDescriptionLinked, true);
  assert.ok(original.assets.detail.value.length > 1);
  const identity = () => JSON.stringify({
    receipt: api.sqlite.prepare('SELECT payload FROM collection_results').get().payload,
    context: api.sqlite.prepare('SELECT payload FROM collection_context').get().payload,
    options: api.sqlite.prepare('SELECT payload FROM product_options').get().payload,
    pricing: Object.fromEntries(Object.entries(api.sqlite.prepare('SELECT * FROM products').get()).filter(([key]) => ['source_price_cny', 'supply_price', 'sale_price', 'msrp', 'exchange_rate', 'supply_margin', 'coupang_margin', 'pricing_policy'].includes(key))),
    files: [...api.objects].map(([key, bytes]) => [key, Buffer.from(bytes).toString('base64')]),
  });
  const preserved = identity(), calls = [], modules = new Map(), slots = [], effects = [];
  let cursor = 0, closed = false, saved = 0, failNext = false, section = '이미지', epoch = 0;
  const hook = (fn, deps) => {
    const index = cursor++, previous = slots[index];
    if (!previous || !sameDeps(previous.deps, deps)) {
      const entry = { deps, cleanup: previous?.cleanup };
      slots[index] = entry;
      effects.push(() => { previous?.cleanup?.(); entry.cleanup = fn(); });
    }
  };
  const react = {
    useState(initial) { const index = cursor++; if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial; return [slots[index], next => { assert.equal(closed, false, 'no late editor updates'); epoch++; slots[index] = typeof next === 'function' ? next(slots[index]) : next; }]; },
    useRef(initial) { const index = cursor++; return slots[index] ?? (slots[index] = { current: initial }); },
    useCallback(fn, deps) { const index = cursor++, previous = slots[index]; if (!previous || !sameDeps(previous.deps, deps)) slots[index] = { value: fn, deps }; return slots[index].value; },
    useEffect: hook,
    useLayoutEffect: hook,
  };
  function load(file) {
    if (modules.has(file)) return modules.get(file);
    const exports = {}; modules.set(file, exports);
    vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../' + file, import.meta.url), 'utf8'), {
      fileName: file, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
    }).outputText, {
      exports, AbortController, structuredClone, TextEncoder, crypto, URL, Date, Intl,
      fetch: async (url, init = {}) => {
        const body = init.body ? JSON.parse(init.body) : undefined;
        calls.push({ url, method: init.method ?? 'GET', body });
        if (failNext && init.method === 'PATCH') { failNext = false; return Response.json({ error: 'local temporary write failure' }, { status: 503 }); }
        return api.route(url, { method: init.method ?? 'GET', ...(body ? { body } : {}) });
      },
      require(name) {
        if (name === 'react') return react;
        if (name === 'react/jsx-runtime') return { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) };
        if (name.startsWith('./') || name.startsWith('../')) return load(path.posix.join(path.posix.dirname(file), name) + '.ts');
        return name.startsWith('@/') ? load(name.slice(2) + (name.includes('/components/') ? '.tsx' : '.ts')) : native(name);
      },
    });
    return exports;
  }
  const Component = load('app/components/product-content-editor.tsx').ProductContentEditor;
  const render = () => {
    cursor = 0;
    const root = Component({ product, section, focusedAssetRole: 'detail', onSaved() { saved++; } });
    const tree = root.type(root.props);
    effects.splice(0).forEach(effect => effect());
    return tree;
  };
  const idle = async () => {
    let quiet = 0;
    for (let attempt = 0; attempt < 500; attempt++) {
      const previous = epoch, count = calls.length; render();
      await new Promise(resolve => setImmediate(resolve));
      const tree = render();
      if (epoch === previous && calls.length === count && !tree.props['aria-busy']) { if (++quiet === 2) return; } else quiet = 0;
    }
    assert.fail('editor local requests did not settle');
  };
  const button = name => { const found = nodes(render()).filter(node => node.type === 'button' && text(node.props.children) === name); assert.equal(found.length, 1, name); return found[0]; };
  const detail = () => nodes(render()).find(node => node.props?.['aria-label'] === '상세페이지 설명');
  const role = key => { const index = JSON.parse(product.image_keys).indexOf(key) + 1; assert.ok(index > 0); const field = nodes(render()).find(node => node.props?.['aria-label'] === `이미지 ${index} 역할`); assert.ok(field); return field; };
  const seo = () => nodes(render()).find(node => node.type === 'textarea' && node.props.maxLength === 20000);
  await idle();
  return { api, original, product, base, calls, read, role, detail, seo, render, idle,
    section(value) { section = value; }, button, get saved() { return saved; }, failOnce() { failNext = true; },
    writes() { return calls.filter(call => call.method === 'PATCH'); },
    quote: async () => json(await api.route(base + '/quotation-fields')),
    unchanged() { assert.equal(identity(), preserved, 'source receipt/context/options/pricing/files preserved'); },
    close() { for (const slot of slots) slot?.cleanup?.(); closed = true; api.close(); },
  };
}

for (const company of companies) test(`photo-only stage-five save retains current SEO description through actual quotation API (${company.code})`, async () => {
  const f = await fixture(company);
  try {
    const sourceDescription = f.api.load('app/product-content.ts').currentDetailContent(f.original).description.value;
    const removed = f.original.assets.detail.value[0];
    f.role(removed).props.onChange({ target: { value: '' } });
    const click = f.button('상세 설명·이미지 저장').props.onClick; click(); click(); await f.idle();
    assert.equal(f.writes().length, 1); assert.equal(f.saved, 1);
    assert.equal(f.writes()[0].body.patch.detail, undefined, 'untouched description/alt text must not be written');
    assert.equal((await f.read()).detailDescriptionLinked, true);
    f.section('SEO'); f.seo().props.onChange({ target: { value: '검토한 한국어 상세 설명' } });
    f.button('SEO 저장').props.onClick(); await f.idle();
    f.section('이미지'); assert.equal(f.detail().props.value, '검토한 한국어 상세 설명');
    const content = await f.read(), quote = await f.quote();
    assert.equal(content.detailDescriptionLinked, true); assert.equal(content.detail.description.provenance, f.original.detail.description.provenance);
    for (const row of quote.resolved.rows.filter(row => row.included)) {
      assert.match(row.fields.detailHtml.value, /<p>검토한 한국어 상세 설명<\/p>/);
      assert.ok(!row.fields.detailImages.value.split('\n').includes(removed));
      assert.ok(!row.fields.detailHtml.value.includes(sourceDescription));
    }
    f.unchanged();
  } finally { f.close(); }
});

for (const company of companies) for (const value of ['직접 작성한 상세 문구', '']) test(`manual ${value ? 'description' : 'blank'} plus photo edit keeps one precise patch and final manual HTML (${company.code})`, async () => {
  const f = await fixture(company);
  try {
    const initialQuote = await f.quote(), selected = initialQuote.resolved.rows.find(row => row.included).optionId;
    await json(await f.api.route(f.base + '/quotation-fields', { method: 'PUT', body: { expectedRevision: initialQuote.revision, expectedInputFingerprint: initialQuote.inputFingerprint,
      changes: [{ fieldKey: 'detailHtml', optionId: selected, value: '<p>견적서 직접 HTML 보존</p>' }] } }));
    f.detail().props.onChange({ target: { value } });
    f.role(f.original.assets.detail.value[0]).props.onChange({ target: { value: '' } });
    f.failOnce(); f.button('상세 설명·이미지 저장').props.onClick(); await f.idle();
    assert.equal(f.saved, 0); assert.equal(f.detail().props.value, value);
    assert.equal((await f.read()).detailDescriptionLinked, true, 'failed write leaves linked source intact');
    f.button('상세 설명·이미지 저장').props.onClick(); await f.idle();
    assert.equal(f.saved, 1); assert.equal(f.writes().length, 2);
    assert.deepEqual(plain(f.writes()[1].body.patch.detail), { description: value });
    let content = await f.read(); assert.equal(content.detailDescriptionLinked, false); assert.equal(content.detail.description.value, value); assert.equal(content.detail.description.provenance, 'manual');
    assert.deepEqual(plain(content.detail.altText), plain(f.original.detail.altText), 'unchanged alternate text is preserved');
    f.section('SEO'); f.seo().props.onChange({ target: { value: '다른 SEO 설명이 직접 상세를 복원하지 않음' } });
    f.button('SEO 저장').props.onClick(); await f.idle();
    content = await f.read(); assert.equal(f.api.load('app/product-content.ts').currentDetailContent(content).description.value, value);
    const quote = await f.quote(); assert.equal(quote.resolved.rows.find(row => row.optionId === selected).fields.detailHtml.value, '<p>견적서 직접 HTML 보존</p>');
    for (const row of quote.resolved.rows.filter(row => row.included && row.optionId !== selected)) {
      assert.ok(!row.fields.detailHtml.value.includes('다른 SEO 설명'));
      if (value) assert.ok(row.fields.detailHtml.value.includes(value));
    }
    f.unchanged();
  } finally { f.close(); }
});

for (const company of companies) test(`stale photo/detail save retains input and does not detach the original on CAS conflict (${company.code})`, async () => {
  const f = await fixture(company);
  try {
    f.detail().props.onChange({ target: { value: '미저장 상세 수정' } });
    const removed = f.original.assets.detail.value[0]; f.role(removed).props.onChange({ target: { value: '' } });
    await json(await f.api.route(f.base + '/content', { method: 'PATCH', body: { expectedRevision: f.original.revision, patch: { detail: { altText: '별도 대체 텍스트' } } } }));
    f.button('상세 설명·이미지 저장').props.onClick(); await f.idle();
    assert.equal(f.saved, 0); assert.equal(f.writes().length, 1); assert.equal(f.detail().props.value, '미저장 상세 수정');
    assert.equal(f.role(removed).props.value, '');
    const current = await f.read(); assert.equal(current.detailDescriptionLinked, true); assert.equal(current.detail.altText.value, '별도 대체 텍스트');
    assert.deepEqual(plain(current.assets.detail.value), plain(f.original.assets.detail.value));
    assert.ok(nodes(f.render()).some(node => node.props?.role === 'alert' && /바뀌|변경|최신|저장/.test(text(node))));
    f.unchanged();
  } finally { f.close(); }
});
