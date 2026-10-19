import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const version = '2026-10-19T00:00:00.000Z', next = '2026-10-19T00:00:00.001Z';
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const nodes = value => Array.isArray(value) ? value.flatMap(nodes) : value && typeof value === 'object' ? [value, ...nodes(value.props?.children)] : [];
const text = value => Array.isArray(value) ? value.map(text).join('') : value && typeof value === 'object' ? text(value.props?.children) : value == null ? '' : String(value);
const sameDeps = (a, b) => Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((item, index) => Object.is(item, b[index]));
const turn = () => new Promise(resolve => setImmediate(resolve));
const task = (stage, productId = 'product') => ({ productId, productTitle: '검수 상품', optionId: 'black', optionLabel: '블랙', stage, profileId: 'profile',
  categoryContext: { source: 'profile', profileId: 'profile', categoryId: '81452', categoryPath: ['스포츠', '보호대'] }, productVersion: version, imageCount: 2 });
const plan = (enabled = true, productId = 'product') => ({ enabled, scope: { ownerId: 'owner', company: { code: 'A01464742', name: '와이홉' } },
  settings: { translateImages: enabled }, messages: [], tasks: ['main', 'additional', 'detail'].map(stage => task(stage, productId)) });

/** Exact ordered hook slots, dependency comparison and effect cleanup are used.
 * Only the read-only planner/refresh and child editor boundary are fixtures.
 * No OCR, Google, upload, production API or account data is contacted here. */
function harness({ autoPrepare = false, enabled = true, planGate, refreshGate } = {}) {
  const slots = [], layouts = [], effects = [], calls = [], busy = [], pending = [];
  let cursor = 0, dirty = true, tree, closed = false, late = 0, failRefresh = null, refreshVersion = version, refreshWait = refreshGate;
  let props = { products: [{ id: 'product', title: '검수 상품' }], autoPrepare, onBusyChange: value => busy.push(value), onPendingChange: value => pending.push(value) };
  const enqueue = (queue, create, deps) => {
    const index = cursor++, previous = slots[index];
    if (!previous || !sameDeps(previous.deps, deps)) {
      const slot = { deps, cleanup: null }; slots[index] = slot;
      queue.push(() => { previous?.cleanup?.(); slot.cleanup = create(); });
    }
  };
  const hooks = {
    useState(initial) { const index = cursor++; if (!(index in slots)) slots[index] = { value: typeof initial === 'function' ? initial() : initial };
      return [slots[index].value, value => { if (closed) { late++; return; } const nextValue = typeof value === 'function' ? value(slots[index].value) : value;
        if (!Object.is(nextValue, slots[index].value)) { slots[index].value = nextValue; dirty = true; } }]; },
    useRef(initial) { const index = cursor++; return slots[index] ?? (slots[index] = { current: initial }); },
    useEffect(create, deps) { enqueue(effects, create, deps); },
    useLayoutEffect(create, deps) { enqueue(layouts, create, deps); },
    useCallback(callback, deps) { const index = cursor++, previous = slots[index]; if (!previous || !sameDeps(previous.deps, deps)) slots[index] = { deps, callback }; return slots[index].callback; },
  };
  function Child() { throw Error('The child provider/editor must not execute in this boundary test.'); }
  const helpers = {
    async planBatchImageWork(products, signal) {
      calls.push({ kind: 'plan', products: structuredClone(products), signal }); await planGate?.promise;
      // A provider that returns after abort exercises the component's own guard.
      return plan(enabled, products[0]?.id ?? 'product');
    },
    async refreshBatchImageTask(selected, value, signal) {
      calls.push({ kind: 'refresh', selected, plan: value, signal }); await refreshWait?.promise;
      if (failRefresh) throw Error(failRefresh);
      return { productVersion: refreshVersion };
    },
  };
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../app/components/batch-image-work-panel.tsx', import.meta.url), 'utf8'),
    { fileName: 'batch-image-work-panel.tsx', compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText,
  { exports, AbortController, Error, structuredClone, require(name) {
    if (name === 'react') return hooks;
    if (name === 'react/jsx-runtime') return { jsx: (type, props, key) => ({ type, key, props }), jsxs: (type, props, key) => ({ type, key, props }) };
    if (name === '@/app/batch-image-work') return helpers;
    if (name === '@/app/components/detail-image-batch-panel') return { DetailImageBatchPanel: Child };
    throw Error(`Unexpected dependency: ${name}`);
  } });
  function render() {
    if (closed) return tree;
    for (let index = 0; dirty && index < 30; index++) {
      dirty = false; cursor = 0; tree = exports.BatchImageWorkPanel(props);
      layouts.splice(0).forEach(run => run()); effects.splice(0).forEach(run => run());
      if (index === 29 && dirty) throw Error('The hook component did not settle.');
    }
    return tree;
  }
  const h = {
    calls, busy, pending, render,
    button(label) { return nodes(render()).find(node => node.type === 'button' && text(node) === label); },
    taskButton(stage) { return nodes(render()).find(node => node.type === 'button' && text(node).includes(stage)); },
    child() { return nodes(render()).find(node => node.type === Child); },
    async idle() { for (let index = 0; index < 8; index++) { render(); await turn(); } return render(); },
    update(value) { props = { ...props, ...value }; dirty = true; return render(); },
    fail(value) { failRefresh = value; }, savedVersion(value) { refreshVersion = value; }, holdRefresh(value) { refreshWait = value; },
    get late() { return late; },
    close() { if (closed) return; closed = true; slots.forEach(slot => slot?.cleanup?.()); },
  };
  return h;
}

test('idle image mode only plans saved lists and never mounts an automatic OCR editor', async () => {
  const h = harness(); try {
    await h.idle(); assert.deepEqual(h.calls.map(call => call.kind), ['plan']); assert.equal(h.child(), undefined);
    assert.match(text(h.render()), /3개 옵션·단계 작업/);
    h.button('현재 설정·이미지 목록 다시 확인').props.onClick(); await h.idle();
    assert.deepEqual(h.calls.map(call => call.kind), ['plan', 'plan']); assert.equal(h.child(), undefined);
  } finally { h.close(); }
});

test('explicit work-start passes autoPrepare once to the refreshed first stage and never submits a result', async () => {
  const h = harness({ autoPrepare: true }); try {
    await h.idle(); assert.deepEqual(h.calls.map(call => call.kind), ['plan', 'refresh']);
    const child = h.child(); assert.equal(child.props.autoPrepare, true); assert.equal(child.props.stage, 'main');
    assert.equal(child.props.version, version); assert.equal(child.props.productId, 'product'); assert.equal(child.props.optionId, 'black');
    await h.idle(); assert.equal(h.calls.length, 2);
    h.button('현재 설정·이미지 목록 다시 확인').props.onClick(); await h.idle();
    assert.equal(h.child(), undefined); assert.deepEqual(h.calls.map(call => call.kind), ['plan', 'refresh', 'plan']);
  } finally { h.close(); }
});

test('disabled translation settings keep explicit work-start read-only and show the reason', async () => {
  const h = harness({ autoPrepare: true, enabled: false }); try {
    await h.idle(); assert.deepEqual(h.calls.map(call => call.kind), ['plan']); assert.equal(h.child(), undefined);
    assert.match(text(h.render()), /이미지 번역이 꺼져 있어 번역을 시작하지 않았습니다/);
  } finally { h.close(); }
});

test('a held task refresh rejects duplicate clicks and reports navigation busy until the exact read finishes', async () => {
  const held = deferred(), h = harness({ refreshGate: held }); try {
    await h.idle(); const retained = h.taskButton('대표 이미지').props.onClick;
    retained(); retained(); await h.idle();
    assert.equal(h.calls.filter(call => call.kind === 'refresh').length, 1); assert.equal(h.busy.at(-1), true);
    assert.ok(nodes(h.render()).filter(node => node.type === 'button').every(node => node.props.disabled === true));
    h.taskButton('추가 이미지').props.onClick(); h.button('현재 설정·이미지 목록 다시 확인').props.onClick(); await h.idle();
    assert.deepEqual(h.calls.map(call => call.kind), ['plan', 'refresh']);
    held.resolve(); await h.idle(); assert.equal(h.busy.at(-1), false); assert.equal(h.child().props.autoPrepare, true);
  } finally { held.resolve(); h.close(); }
});

test('pending preview and uncertain-save locks survive child busy release and block all task/list callbacks', async () => {
  const h = harness({ autoPrepare: true }); try {
    await h.idle(); const child = h.child(), key = child.key, nextTask = h.taskButton('추가 이미지').props.onClick;
    child.props.onBusyChange(true); child.props.onPendingChange(true); child.props.onBusyChange(false); await h.idle();
    assert.equal(h.pending.at(-1), true); assert.equal(h.render().props['data-workspace-dirty'], true);
    assert.ok(nodes(h.render()).filter(node => node.type === 'button').every(node => node.props.disabled === true));
    nextTask(); h.button('현재 설정·이미지 목록 다시 확인').props.onClick(); await h.idle();
    assert.equal(h.child().key, key); assert.equal(h.calls.length, 2);
    child.props.onPendingChange(false); await h.idle(); nextTask(); await h.idle();
    assert.equal(h.child().props.stage, 'additional'); assert.equal(h.calls.length, 3);
  } finally { h.close(); }
});

test('a confirmed child save advances the same preview version without replaying OCR or a plan read', async () => {
  const h = harness({ autoPrepare: true }); try {
    await h.idle(); const before = h.child(); before.props.onSavedView({ productVersion: next }); await h.idle();
    assert.equal(h.child().key, before.key); assert.equal(h.child().props.version, next);
    assert.equal(h.child().props.stage, before.props.stage); assert.equal(h.calls.length, 2);
    h.savedVersion(next); h.taskButton('상세 이미지').props.onClick(); await h.idle();
    assert.equal(h.child().props.stage, 'detail'); assert.equal(h.child().props.version, next);
  } finally { h.close(); }
});

test('account, settings or category refresh rejection retains the previous editor and its preview', async () => {
  const h = harness({ autoPrepare: true }); try {
    await h.idle(); const before = h.child();
    for (const reason of ['로그인 계정이 변경됐습니다.', '기본설정이 변경됐습니다.', '카테고리 연결이 변경됐습니다.']) {
      h.fail(reason); h.taskButton('추가 이미지').props.onClick(); await h.idle();
      assert.equal(h.child().key, before.key); assert.equal(h.child().props.version, before.props.version);
      assert.equal(h.child().props.stage, 'main'); assert.match(text(h.render()), new RegExp(reason.replaceAll('.', '\\.')));
      assert.equal(h.busy.at(-1), false); assert.equal(h.pending.includes(true), false);
    }
  } finally { h.close(); }
});

test('closing while planning or refreshing aborts its read and never adopts a late provider result', async () => {
  for (const kind of ['plan', 'refresh']) {
    const held = deferred(), h = harness(kind === 'plan' ? { planGate: held } : { autoPrepare: true, refreshGate: held });
    await h.idle(); const request = h.calls.at(-1); assert.equal(request.kind, kind);
    h.close(); assert.equal(request.signal.aborted, true); held.resolve(); await turn(); await turn();
    assert.equal(h.late, 0); assert.equal(h.busy.at(-1), false); assert.equal(h.pending.at(-1), false);
  }
});

test('an old child save callback cannot advance a different task or update the unmounted panel', async () => {
  const h = harness({ autoPrepare: true }); try {
    await h.idle(); const old = h.child(); h.taskButton('추가 이미지').props.onClick(); await h.idle();
    assert.equal(h.child().props.stage, 'additional'); old.props.onSavedView({ productVersion: next }); await h.idle();
    assert.equal(h.child().props.version, version, 'an obsolete main-image save must not alter the additional-image clock');
    const current = h.child(); h.close(); current.props.onSavedView({ productVersion: next }); assert.equal(h.late, 0);
  } finally { h.close(); }
});

test('changing the product selection aborts a held read, releases its busy lock and reads the new selection', async () => {
  const held = deferred(), h = harness({ refreshGate: held }); try {
    await h.idle(); h.taskButton('대표 이미지').props.onClick(); await h.idle();
    const oldRead = h.calls.at(-1); assert.equal(oldRead.kind, 'refresh');
    h.update({ products: [{ id: 'other-product', title: '새 검수 상품' }] }); await h.idle();
    assert.equal(oldRead.signal.aborted, true); held.resolve(); await h.idle();
    assert.equal(h.busy.at(-1), false); assert.equal(h.child(), undefined);
    assert.equal(h.calls.filter(call => call.kind === 'plan').length, 2);
    assert.equal(h.calls.filter(call => call.kind === 'plan').at(-1).products[0].id, 'other-product');
  } finally { held.resolve(); h.close(); }
});

test('reselecting the same task creates a new generation and old callbacks cannot release its preview lock', async () => {
  const h = harness({ autoPrepare: true }); try {
    await h.idle(); const previous = h.child(); h.taskButton('대표 이미지').props.onClick(); await h.idle();
    const current = h.child(); assert.notEqual(current.key, previous.key); assert.equal(current.props.stage, previous.props.stage);
    current.props.onBusyChange(true); current.props.onPendingChange(true); await h.idle();
    previous.props.onBusyChange(false); previous.props.onPendingChange(false); previous.props.onSavedView({ productVersion: next }); await h.idle();
    assert.equal(h.busy.at(-1), true); assert.equal(h.pending.at(-1), true); assert.equal(h.child().props.version, version);
    assert.equal(h.render().props['data-workspace-saving'], true); assert.equal(h.render().props['data-workspace-dirty'], true);
    current.props.onBusyChange(false); current.props.onPendingChange(false); await h.idle();
    assert.equal(h.busy.at(-1), false); assert.equal(h.pending.at(-1), false);
  } finally { h.close(); }
});

test('the displayed old child cannot release navigation busy while a different task refresh is in flight', async () => {
  const held = deferred(), h = harness({ autoPrepare: true }); try {
    await h.idle(); const old = h.child(); h.holdRefresh(held); h.taskButton('상세 이미지').props.onClick(); await h.idle();
    assert.equal(h.busy.at(-1), true); old.props.onBusyChange(false); await h.idle();
    assert.equal(h.busy.at(-1), true, 'child idle notification must not release an independent task-read lock');
    assert.equal(h.render().props['data-workspace-saving'], true);
    held.resolve(); await h.idle(); assert.equal(h.child().props.stage, 'detail'); assert.equal(h.busy.at(-1), false);
  } finally { held.resolve(); h.close(); }
});
