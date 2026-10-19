import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const stamp = '2026-10-19T00:00:00.000Z';
const nodes = value => Array.isArray(value) ? value.flatMap(nodes) : value && typeof value === 'object' ? [value, ...nodes(value.props?.children)] : [];
const text = value => Array.isArray(value) ? value.map(text).join('') : value && typeof value === 'object' ? text(value.props?.children) : value == null ? '' : String(value);
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const turn = () => new Promise(resolve => setImmediate(resolve));
const sameDeps = (a, b) => Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((value, index) => Object.is(value, b[index]));

/** The actual component and dependency-aware ordered React hook/effect lifecycle
 * run here. Provider and persisted image-result boundaries are isolated local
 * fixtures; no OCR engine, Google request, seller image or write is executed. */
function panel({ autoPrepare = true, active = true, disabled = false, stage = 'detail', permission = true, heldRead, heldPrepare, heldApply, uncertain = false } = {}) {
  const slots = [], layouts = [], effects = [], calls = [], busy = [], pending = [], savedViews = [];
  let cursor = 0, dirty = true, tree, closed = false, late = 0, allow = permission, failApply = uncertain, savedCount = 0;
  const keys = ['owner/a.png', 'owner/b.png']; let view = { productVersion: stamp, revision: 2, imageKeys: [...keys] };
  let props = { productId: 'product', optionId: 'black', profileId: 'profile', version: stamp, active, disabled, stage, autoPrepare,
    beforeApply: () => allow, onBusyChange: value => busy.push(value), onPendingChange: value => pending.push(value),
    onSavedView(value) { savedViews.push(value); props = { ...props, version: value.productVersion }; dirty = true; }, onSaved() { savedCount++; } };
  const enqueue = (queue, create, deps) => {
    const index = cursor++, previous = slots[index];
    if (!previous || !sameDeps(previous.deps, deps)) { const slot = { deps, create, kind: queue === layouts ? 'layout' : 'effect', cleanup: null }; slots[index] = slot; queue.push(() => { previous?.cleanup?.(); slot.cleanup = create(); }); }
  };
  const hooks = {
    useState(initial) { const index = cursor++; if (!(index in slots)) slots[index] = { value: typeof initial === 'function' ? initial() : initial };
      return [slots[index].value, value => { if (closed) { late++; return; } const changed = typeof value === 'function' ? value(slots[index].value) : value;
        if (!Object.is(changed, slots[index].value)) { slots[index].value = changed; dirty = true; } }]; },
    useRef(initial) { const index = cursor++; return slots[index] ?? (slots[index] = { current: initial }); },
    useEffect(create, deps) { enqueue(effects, create, deps); }, useLayoutEffect(create, deps) { enqueue(layouts, create, deps); },
  };
  const helpers = {
    detailBatchTranslationSlots: () => ({ keys, slots: [0, 1], protectedSlots: [] }), detailBatchCapacity: value => 150 - value.imageKeys.length,
    async readDetailBatchView(input, signal) { calls.push({ kind: 'read', input, signal }); await heldRead?.promise; return view; },
    async prepareDetailImageBatch(input, signal, progress) {
      calls.push({ kind: 'prepare', input, signal }); const result = { ...input, items: keys.map((sourceKey, slotIndex) => ({ sourceKey, slotIndex, status: 'ready',
        message: '', texts: [{ original: '黑色', translated: '블랙' }], rendered: { output: new Blob(['synthetic preview'], { type: 'image/png' }) } })) };
      progress(result, '검토용 미리보기 준비'); await heldPrepare?.promise; signal.throwIfAborted(); return result;
    },
    async applyDetailBatchResult(batch, slotIndex, signal, progress) {
      calls.push({ kind: 'apply', slotIndex, signal }); await heldApply?.promise; signal.throwIfAborted();
      if (failApply) { const result = { ...batch, items: batch.items.map(item => item.slotIndex === slotIndex ? { ...item, status: 'uncertain' } : item) }; progress(result); throw Error('저장 ACK 확인 필요'); }
      view = { ...view, productVersion: new Date(Date.parse(view.productVersion) + 1).toISOString(), revision: view.revision + 1, imageKeys: [...view.imageKeys, `owner/result-${slotIndex}.png`] };
      const result = { ...batch, view, items: batch.items.map(item => item.slotIndex === slotIndex ? { ...item, status: 'applied', message: '적용 완료' } : item) };
      calls.at(-1).confirmedView = view; progress(result); return result;
    },
    async recoverDetailBatchResult(batch, signal) {
      calls.push({ kind: 'recover', signal }); signal.throwIfAborted();
      view = { ...view, productVersion: new Date(Date.parse(view.productVersion) + 1).toISOString(), revision: view.revision + 1 };
      calls.at(-1).confirmedView = view;
      return { ...batch, view, items: batch.items.map(item => item.status === 'uncertain' ? { ...item, status: 'applied' } : item) };
    },
  };
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../app/components/detail-image-batch-panel.tsx', import.meta.url), 'utf8'),
    { fileName: 'detail-image-batch-panel.tsx', compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText,
  { exports, AbortController, Blob, URL, Error, require(name) {
    if (name === 'react') return hooks;
    if (name === 'react/jsx-runtime') return { jsx: (type, props, key) => ({ type, props, key }), jsxs: (type, props, key) => ({ type, props, key }) };
    if (name === '@/app/detail-image-batch') return helpers; throw Error(`Unexpected dependency ${name}`);
  } });
  function render() {
    if (closed) return tree;
    for (let index = 0; dirty && index < 40; index++) {
      dirty = false; cursor = 0; tree = exports.DetailImageBatchPanel(props);
      layouts.splice(0).forEach(run => run()); effects.splice(0).forEach(run => run());
      if (index === 39 && dirty) throw Error('The component did not settle.');
    }
    return tree;
  }
  const label = stage === 'main' ? '대표 이미지' : stage === 'additional' ? '추가 이미지' : '상세 이미지';
  const h = { calls, busy, pending, savedViews, render,
    button(value) { return nodes(render()).find(node => node.type === 'button' && text(node) === value); },
    control(value) { return nodes(render()).find(node => node.props?.['aria-label'] === value); },
    async idle() { for (let index = 0; index < 12; index++) { render(); await turn(); } return render(); },
    async click(value) { const button = h.button(value); assert.ok(button && !button.props.disabled, value); button.props.onClick(); await h.idle(); },
    review(index) { const checkbox = h.control(`${label} ${index + 1} 번역 결과 검토 완료`); assert.ok(checkbox && !checkbox.props.disabled); checkbox.props.onChange({ target: { checked: true } }); render(); },
    update(value) { props = { ...props, ...value }; dirty = true; return render(); },
    replayMountedEffects() {
      render(); const committed = slots.filter(slot => slot?.create);
      for (const kind of ['layout', 'effect']) committed.filter(slot => slot.kind === kind).forEach(slot => slot.cleanup?.());
      for (const kind of ['layout', 'effect']) committed.filter(slot => slot.kind === kind).forEach(slot => { slot.cleanup = slot.create(); });
      return render();
    },
    allow(value) { allow = value; }, uncertain(value) { failApply = value; },
    get late() { return late; }, get savedCount() { return savedCount; },
    close() { if (closed) return; closed = true; slots.forEach(slot => slot?.cleanup?.()); },
  }; return h;
}

test('an idle image editor reads its saved list without starting OCR or emitting a saved-view callback', async () => {
  const h = panel({ autoPrepare: false }); try {
    await h.idle(); await h.idle(); assert.deepEqual(h.calls.map(call => call.kind), ['read']);
    assert.equal(h.savedViews.length, 0); assert.equal(h.savedCount, 0); assert.equal(h.pending.at(-1), false);
  } finally { h.close(); }
});

for (const stage of ['main', 'additional', 'detail']) test(`explicit autoPrepare starts one Chinese OCR preview after the saved read (${stage})`, async () => {
  const h = panel({ stage }); try {
    await h.idle(); assert.deepEqual(h.calls.map(call => call.kind), ['read', 'read', 'prepare']);
    assert.equal(h.calls[2].input.stage, stage); assert.equal(h.calls[2].input.language, 'zh');
    assert.equal(h.pending.at(-1), true); assert.equal(h.savedViews.length, 0); assert.equal(h.savedCount, 0);
    await h.idle(); h.update({ disabled: true }); h.update({ disabled: false }); await h.idle();
    assert.equal(h.calls.filter(call => call.kind === 'prepare').length, 1, 'sibling busy/unlock must not restart OCR');
    assert.equal(h.calls.some(call => call.kind === 'apply' || call.kind === 'recover'), false);
  } finally { h.close(); }
});

test('initial disabled or hidden stages defer the automatic read and OCR until the first actual unlock', async () => {
  for (const initial of [{ disabled: true }, { active: false }]) {
    const h = panel(initial); try {
      await h.idle(); assert.equal(h.calls.length, 0); h.update({ disabled: false, active: true }); await h.idle();
      assert.deepEqual(h.calls.map(call => call.kind), ['read', 'read', 'prepare']);
      h.update({ disabled: true }); h.update({ disabled: false }); await h.idle(); assert.equal(h.calls.filter(call => call.kind === 'prepare').length, 1);
    } finally { h.close(); }
  }
});

test('a pending preview signals true and explicitly discarding unused previews signals false without a write', async () => {
  const h = panel(); try {
    await h.idle(); assert.equal(h.pending[0], false); assert.equal(h.pending.at(-1), true);
    assert.equal(h.render().props['data-workspace-dirty'], true);
    await h.click('미적용 번역 결과 지우기 · 원본 유지');
    assert.equal(h.pending.at(-1), false); assert.equal(h.render().props['data-workspace-dirty'], false);
    assert.equal(h.calls.some(call => call.kind === 'apply'), false); assert.equal(h.savedViews.length, 0);
    await h.idle(); assert.equal(h.calls.filter(call => call.kind === 'prepare').length, 1);
  } finally { h.close(); }
});

test('confirmed application emits exactly the acknowledged view and advances the parent clock only after review', async () => {
  const h = panel(); try {
    await h.idle(); assert.equal(h.savedViews.length, 0); h.review(0); await h.click('검토한 상세 이미지 1개 적용');
    const applied = h.calls.find(call => call.kind === 'apply'); assert.ok(applied);
    assert.equal(h.savedViews.length, 1); assert.equal(h.savedViews[0], applied.confirmedView);
    assert.equal(h.savedViews[0].productVersion, '2026-10-19T00:00:00.001Z'); assert.equal(h.savedViews[0].revision, 3);
    assert.equal(h.savedCount, 1); assert.equal(h.pending.at(-1), true, 'the unchecked second preview is still pending');
    assert.equal(h.calls.filter(call => call.kind === 'prepare').length, 1);
    await h.click('미적용 번역 결과 지우기 · 원본 유지'); assert.equal(h.pending.at(-1), false);
  } finally { h.close(); }
});

test('uncertain saves keep pending true, emit no clock and read recovery without another upload or OCR', async () => {
  const h = panel({ uncertain: true }); try {
    await h.idle(); h.review(0); h.review(1); await h.click('검토한 상세 이미지 2개 적용');
    assert.equal(h.calls.filter(call => call.kind === 'apply').length, 1); assert.equal(h.savedViews.length, 0); assert.equal(h.savedCount, 0);
    assert.equal(h.pending.at(-1), true); assert.equal(h.button('미적용 번역 결과 지우기 · 원본 유지'), undefined);
    await h.click('같은 이미지 저장 상태 확인'); const confirmed = h.calls.find(call => call.kind === 'recover').confirmedView;
    assert.equal(h.savedViews.length, 1); assert.equal(h.savedViews[0], confirmed); assert.equal(h.savedCount, 1);
    assert.equal(h.calls.filter(call => call.kind === 'apply').length, 1); assert.equal(h.calls.filter(call => call.kind === 'prepare').length, 1);
    assert.equal(h.button('검토한 상세 이미지 0개 적용').props.disabled, true); assert.equal(h.pending.at(-1), true);
    await h.click('미적용 번역 결과 지우기 · 원본 유지'); assert.equal(h.pending.at(-1), false);
  } finally { h.close(); }
});

test('closing a held saved read or OCR aborts it without a late state update or saved callback', async () => {
  for (const kind of ['read', 'prepare']) {
    const held = deferred(), h = panel(kind === 'read' ? { heldRead: held } : { heldPrepare: held });
    await h.idle(); const call = h.calls.at(-1); assert.equal(call.kind, kind);
    h.close(); assert.equal(call.signal.aborted, true); held.resolve(); await turn(); await turn();
    assert.equal(h.late, 0); assert.equal(h.savedViews.length, 0); assert.equal(h.savedCount, 0); assert.equal(h.busy.at(-1), false);
  }
});

test('cancelled automatic OCR retains its local preview and never restarts until a fresh explicit action', async () => {
  const held = deferred(), h = panel({ heldPrepare: held }); try {
    await h.idle(); assert.equal(h.calls.filter(call => call.kind === 'prepare').length, 1); const call = h.calls.at(-1);
    await h.click('일괄 이미지 작업 중단'); assert.equal(call.signal.aborted, true); held.resolve(); await h.idle();
    assert.equal(h.pending.at(-1), true); assert.equal(h.calls.filter(call => call.kind === 'prepare').length, 1);
    assert.equal(h.savedViews.length, 0); assert.equal(h.calls.some(call => call.kind === 'apply'), false);
    await h.click('미적용 번역 결과 지우기 · 원본 유지'); assert.equal(h.pending.at(-1), false);
  } finally { held.resolve(); h.close(); }
});

test('closing while an explicit apply awaits its result cannot emit an acknowledged saved clock', async () => {
  const held = deferred(), h = panel({ heldApply: held });
  await h.idle(); h.review(0); const button = h.button('검토한 상세 이미지 1개 적용'); button.props.onClick(); await h.idle();
  const call = h.calls.at(-1); assert.equal(call.kind, 'apply'); h.close(); assert.equal(call.signal.aborted, true);
  held.resolve(); await turn(); await turn(); assert.equal(h.savedViews.length, 0); assert.equal(h.savedCount, 0); assert.equal(h.late, 0);
});

test('development effect replay aborts the first read and still reaches exactly one automatic preview', async () => {
  const h = panel(); try {
    h.render(); const first = h.calls[0]; h.replayMountedEffects();
    assert.equal(first.signal.aborted, true); await h.idle();
    assert.equal(h.calls.filter(call => call.kind === 'prepare').length, 1);
    assert.equal(h.busy.at(-1), false); assert.equal(h.render().props['data-workspace-saving'], false);
    assert.equal(h.pending.at(-1), true); assert.equal(h.savedViews.length, 0);
  } finally { h.close(); }
});
