import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';
import sharp from 'sharp';
import { createRequire } from 'node:module';
import { createHash, webcrypto } from 'node:crypto';

const native = createRequire(import.meta.url), plain = value => JSON.parse(JSON.stringify(value));
const nodes = value => Array.isArray(value) ? value.flatMap(nodes) : value && typeof value === 'object' ? [value, ...nodes(value.props?.children)] : [];
const text = value => Array.isArray(value) ? value.map(text).join('') : value && typeof value === 'object' ? text(value.props?.children) : value == null ? '' : String(value);
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const reopen = '저장 전 개별 사진으로 편집';

// Share this suite's pure PNG/view declarations without importing its tests.
const fixtureUrl = new URL('./detail-editor-inputs-client.test.mjs', import.meta.url);
const fixtureText = fs.readFileSync(fixtureUrl, 'utf8'), fixtureAst = ts.createSourceFile('fixture.mjs', fixtureText, ts.ScriptTarget.Latest, true), declarations = [];
for (const statement of fixtureAst.statements) {
  if (ts.isImportDeclaration(statement)) continue;
  if (ts.isExpressionStatement(statement) && ts.isCallExpression(statement.expression) && statement.expression.expression.getText(fixtureAst) === 'test') break;
  declarations.push(statement.getText(fixtureAst));
}
const { fixture } = vm.runInNewContext(declarations.join('\n').replaceAll('import.meta.url', JSON.stringify(fixtureUrl.href)) + '\n({fixture})',
  { assert, fs, path, vm, ts, sharp, createRequire, createHash, webcrypto, URL, Response, Headers, Buffer, AbortController, AbortSignal, DOMException, TextEncoder, TextDecoder, Uint8Array, structuredClone });

function panel(f, transport = f.request, confirm = () => true) {
  const props = { productId: 'product', optionId: 'red', profileId: 'profile', version: f.view.productVersion, refreshToken: '0', stage: 'detail', active: true, disabled: false };
  const slots = [], layouts = [], effects = [], cache = new Map(), calls = [], listeners = new Map();
  let cursor = 0, epoch = 0, closed = false, lateWrites = 0, saved = 0;
  const changed = (before, after) => !before || !after || before.length !== after.length || after.some((value, i) => !Object.is(value, before[i]));
  function effect(queue, fn, deps) {
    const i = cursor++, previous = slots[i];
    if (!previous || changed(previous.deps, deps)) { const next = { deps, cleanup: previous?.cleanup }; slots[i] = next; queue.push(() => { previous?.cleanup?.(); next.cleanup = fn(); }); }
  }
  const react = {
    useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = typeof initial === 'function' ? initial() : initial;
      return [slots[i], value => { if (closed) { lateWrites++; return; } const next = typeof value === 'function' ? value(slots[i]) : value; if (!Object.is(next, slots[i])) { slots[i] = next; epoch++; } }]; },
    useRef(initial) { const i = cursor++; return slots[i] ?? (slots[i] = { current: initial }); },
    useEffect(fn, deps) { effect(effects, fn, deps); }, useLayoutEffect(fn, deps) { effect(layouts, fn, deps); },
  };
  const document = { activeElement: null, addEventListener(name, callback) { const set = listeners.get(name) ?? new Set(); set.add(callback); listeners.set(name, set); },
    removeEventListener(name, callback) { listeners.get(name)?.delete(callback); } };
  async function fetcher(url, init = {}) {
    calls.push({ url, method: init.method ?? 'GET', init });
    if (init.method === 'PUT') {
      const body = JSON.parse(init.body); assert.equal(body.expectedRevision, f.view.revision); assert.equal(body.expectedInputFingerprint, f.view.inputFingerprint);
      for (const change of body.changes) {
        const own = f.view.overrides.options[change.optionId] ??= {};
        if (change.value === null) delete own[change.fieldKey]; else own[change.fieldKey] = change.value;
        const cell = f.view.resolved.rows.find(row => row.optionId === change.optionId).fields[change.fieldKey]; cell.value = change.value; cell.source = 'manual-option';
      }
      f.view.revision++; f.view.productVersion = new Date(Date.parse(f.view.productVersion) + 1).toISOString(); f.view.updatedAt = f.view.productVersion;
      return Response.json(f.view);
    }
    return transport(url, init);
  }
  function load(file) {
    if (cache.has(file)) return cache.get(file); const exports = {}; cache.set(file, exports);
    vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../' + file, import.meta.url), 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText,
    { exports, Error, Date, URL, URLSearchParams, AbortController, AbortSignal, DOMException, Response, Headers, Blob, File, Uint8Array, DataView,
      TextEncoder, TextDecoder, structuredClone, crypto: webcrypto, fetch: fetcher, document, window: {confirm}, setTimeout, clearTimeout,
      require(name) {
        if (name === 'react') return react;
        if (name === 'react/jsx-runtime') return { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) };
        if (name === '@/app/components/detail-image-composite-panel') return { DetailImageCompositePanel: () => null };
        if (name.startsWith('@/')) return load(name.slice(2) + (name.includes('/components/') ? '.tsx' : '.ts'));
        if (name.startsWith('./') || name.startsWith('../')) return load(path.posix.join(path.posix.dirname(file), name) + '.ts');
        return native(name);
      } });
    return exports;
  }
  const Component = load('app/components/option-image-editor.tsx').OptionImageEditor;
  function render() { cursor = 0; const tree = Component({ ...props, onSaved() { saved++; props.version = f.view.productVersion; } }); layouts.splice(0).forEach(run => run()); effects.splice(0).forEach(run => run()); return tree; }
  const flush = async (count = 3) => { for (let i = 0; i < count; i++) { render(); await new Promise(resolve => setImmediate(resolve)); } return render(); };
  async function settle() {
    let quiet = 0; const deadline = Date.now() + 10000;
    for (;;) { const before = epoch, count = calls.length, tree = await flush(1);
      quiet = !tree.props['data-workspace-saving'] && before === epoch && count === calls.length && !layouts.length && !effects.length ? quiet + 1 : 0;
      if (quiet >= 2) return tree; assert.ok(Date.now() < deadline, 'option input editor did not settle'); }
  }
  const button = label => nodes(render()).find(node => node.type === 'button' && (text(node) === label || node.props['aria-label'] === label));
  const control = label => nodes(render()).find(node => node.props?.['aria-label'] === label);
  const ordered = () => nodes(render()).filter(node => node.type === 'figure' && node.props['data-image-sort-key']).map(node => node.props['data-image-sort-key']);
  function start(label) { const node = button(label); assert.ok(node && !node.props.disabled, 'available button: ' + label + ' ' + text(render())); node.props.onClick(); }
  render();
  return { props, calls, render, flush, settle, button, control, ordered, start, get saved() { return saved; }, get lateWrites() { return lateWrites; },
    async click(label) { start(label); return settle(); }, set(values) { Object.assign(props, values); render(); render(); },
    html(value) { const node = control('선택 옵션 상세 HTML'); assert.ok(node && !node.props.disabled); node.props.onChange({ target: { value } }); render(); },
    close() { closed = true; slots.forEach(slot => slot?.cleanup?.()); } };
}

test('reopening stages verified images without a write, then only the existing explicit save writes the selected option', async () => {
  const f = await fixture(), before = plain(f.view), h = panel(f);
  try {
    await h.settle(); assert.deepEqual(h.ordered(), [f.key]); await h.click(reopen);
    assert.deepEqual(h.ordered(), ['owner/one.png', 'owner/two.png']); assert.equal(h.render().props['data-workspace-dirty'], true);
    assert.deepEqual(plain(f.view), before); assert.equal(h.calls.filter(call => call.method !== 'GET').length, 0);
    assert.equal(h.control('선택 옵션 상세 HTML').props.value, '<p>수동 HTML 보존</p>');
    await h.click('선택 옵션 이미지 저장'); assert.equal(h.saved, 1);
    const writes = h.calls.filter(call => call.method === 'PUT'); assert.equal(writes.length, 1);
    const body = JSON.parse(writes[0].init.body); assert.ok(body.changes.every(change => change.optionId === 'red' && ['detailImages', 'wire-detail-images'].includes(change.fieldKey)));
    assert.equal(f.view.overrides.options.red.detailImages, 'owner/one.png\nowner/two.png');
    assert.equal(f.view.overrides.options.red['wire-detail-images'], f.view.overrides.options.red.detailImages);
    for (const key of ['altText', 'detailHtml', 'wire-detail-html', 'additionalImages']) assert.equal(f.view.overrides.options.red[key], before.overrides.options.red[key]);
    assert.deepEqual(plain(f.view.overrides.common), before.overrides.common); assert.deepEqual(plain(f.view.overrides.options.blue), before.overrides.options.blue);
    assert.deepEqual(plain(f.view.detailEditorInputs), before.detailEditorInputs); assert.equal(h.render().props['data-workspace-dirty'], false);
  } finally { h.close(); }
});

test('duplicate saved positions all reopen as a draft and saving stays blocked until the exact duplicate position is removed', async () => {
  const f = await fixture({ duplicate: true });
  f.view.resolved.schema.fields.filter(field => field.type === 'images' && field.id !== 'additionalImages').forEach(field => { field.maxItems = 2; });
  const h = panel(f);
  try {
    await h.settle(); await h.click(reopen);
    assert.deepEqual(h.ordered(), ['owner/one.png', 'owner/two.png', 'owner/one.png']);
    assert.equal(h.button('선택 옵션 이미지 저장').props.disabled, true);
    assert.ok(nodes(h.render()).some(node => node.props?.role === 'alert')); assert.ok(h.calls.every(call => call.method === 'GET'));
    await h.click('상세 이미지 3 선택 제거'); assert.deepEqual(h.ordered(), ['owner/one.png', 'owner/two.png']);
    assert.equal(h.button('선택 옵션 이미지 저장').props.disabled, false); await h.click('선택 옵션 이미지 저장');
    assert.equal(h.calls.filter(call => call.method === 'PUT').length, 1); assert.equal(f.view.overrides.options.red.detailImages, 'owner/one.png\nowner/two.png');
  } finally { h.close(); }
});

test('HTML and other image-stage drafts block reopening and remain intact with no implicit save', async () => {
  const f = await fixture(), h = panel(f);
  try {
    await h.settle(); const stale = h.button(reopen).props.onClick; h.html('<p>아직 저장하지 않은 HTML</p>');
    assert.equal(h.button(reopen).props.disabled, true); const count = h.calls.length; stale(); await h.settle(); assert.equal(h.calls.length, count);
    assert.equal(h.control('선택 옵션 상세 HTML').props.value, '<p>아직 저장하지 않은 HTML</p>');
    h.set({ stage: 'additional' }); await h.flush(); h.start('추가 이미지 선택 비우기'); await h.settle();
    h.set({ stage: 'detail' }); await h.flush(); assert.equal(h.button(reopen).props.disabled, true);
    assert.equal(h.control('선택 옵션 상세 HTML').props.value, '<p>아직 저장하지 않은 HTML</p>'); assert.ok(h.calls.every(call => call.method === 'GET'));
  } finally { h.close(); }
});

test('a tampered file leaves the current composite, HTML and stored data untouched and reports the failure', async () => {
  const f = await fixture(), before = JSON.stringify(f.view); f.objects.set('owner/one.png', await sharp({ create: { width: 800, height: 1, channels: 4, background: '#999999' } }).png().toBuffer());
  const h = panel(f);
  try { await h.settle(); await h.click(reopen); assert.deepEqual(h.ordered(), [f.key]); assert.equal(h.render().props['data-workspace-dirty'], false);
    assert.equal(JSON.stringify(f.view), before); assert.ok(nodes(h.render()).some(node => node.props?.role === 'alert')); assert.ok(h.calls.every(call => call.method === 'GET'));
  } finally { h.close(); }
});

test('active, version and disabled ABA transitions cannot adopt an old reopening response or its stale button action', async () => {
  for (const kind of ['active', 'version', 'disabled']) {
    const f = await fixture(), gate = deferred(), entered = deferred(); let held = false;
    const transport = async (url, init) => { const response = await f.request(url, init); if (!held && url.startsWith('/api/files/')) { held = true; entered.resolve(); await gate.promise; } return response; };
    const h = panel(f, transport);
    try {
      await h.settle(); const stale = h.button(reopen).props.onClick; h.start(reopen); await entered.promise;
      assert.equal(h.render().props['data-workspace-saving'], true);
      const original = h.props[kind], other = kind === 'version' ? '2026-10-15T02:00:00.001Z' : !original;
      h.set({ [kind]: other }); await h.flush(); h.set({ [kind]: original }); await h.flush(); gate.resolve(); await h.settle();
      assert.equal(h.render().props['data-workspace-dirty'], false, kind); assert.deepEqual(h.ordered(), [f.key], kind);
      const count = h.calls.length; stale(); await h.settle(); assert.equal(h.calls.length, count, 'old event closure is stale after ' + kind);
      assert.ok(h.calls.every(call => call.method === 'GET'));
    } finally { gate.resolve(); h.close(); }
  }
});

test('changing option/profile scope or unmounting during a read cannot populate another editor or write after unmount', async () => {
  for (const kind of ['optionId', 'profileId', 'unmount']) {
    const f = await fixture(), gate = deferred(), entered = deferred(); let held = false;
    const transport = async (url, init) => { const response = await f.request(url, init); if (!held && url.startsWith('/api/files/')) { held = true; entered.resolve(); await gate.promise; } return response; };
    const h = panel(f, transport);
    try {
      await h.settle(); h.start(reopen); await entered.promise;
      if (kind === 'unmount') h.close(); else { h.set({ [kind]: kind === 'optionId' ? 'blue' : 'other-profile' }); await h.flush(); }
      gate.resolve(); await new Promise(resolve => setImmediate(resolve)); if (kind !== 'unmount') await h.settle();
      assert.equal(h.lateWrites, 0, kind); if (kind !== 'unmount') assert.equal(h.render().props['data-workspace-dirty'], false, kind);
      assert.ok(h.calls.every(call => call.method === 'GET'));
    } finally { gate.resolve(); if (kind !== 'unmount') h.close(); }
  }
});


test('duplicate-position deletion respects cancellation and rechecks option/source identity after confirmation', async () => {
  for (const mode of ['cancel', 'option', 'version']) {
    const f = await fixture({ duplicate: true }); let h, confirmations = 0;
    h = panel(f, f.request, () => {
      confirmations++;
      if (mode === 'option') h.set({optionId:'blue'});
      if (mode === 'version') h.set({version:new Date(Date.parse(f.view.productVersion)+1).toISOString()});
      return mode !== 'cancel';
    });
    try {
      await h.settle(); await h.click(reopen); const before = plain(f.view);
      const remove = h.button('상세 이미지 3 선택 제거').props.onClick;
      remove(); await h.settle(); assert.equal(confirmations,1);
      assert.equal(h.calls.some(call=>call.method==='PUT'||call.method==='POST'),false);
      assert.deepEqual(plain(f.view),before,'confirmation cannot change saved source or another option');
      if(mode==='cancel') assert.deepEqual(h.ordered(),['owner/one.png','owner/two.png','owner/one.png']);
      else {remove();await h.settle();assert.equal(confirmations,1,'retained callback cannot regain the old scope');}
    } finally {h.close();}
  }
});
