import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';

const nodes = value => Array.isArray(value) ? value.flatMap(nodes) : value && typeof value === 'object' ? [value, ...nodes(value.props?.children)] : [];
const text = value => Array.isArray(value) ? value.map(text).join('') : value && typeof value === 'object' ? text(value.props?.children) : value == null ? '' : String(value);
const uuid = n => `${n.toString(16).padStart(8, '0')}-1111-4111-8111-${n.toString(16).padStart(12, '0')}`;
const old = '2026-10-15T01:00:00.000Z', later = '2026-10-15T02:00:00.000Z';
const storageKey = (product = 'source-product', profile = 'profile-one') => `yoofam-detail-family-v1:${product}:${profile}`;

/** Actual exported TSX form + actual client with local React/DOM/storage and
 * transport adapters. This is not native rendering or a backend persistence test. */
function harness({ productId = 'source-product', profileId = 'profile-one', count = 3, eligible = count - 1, sourceReady = true,
  beforeOpen = () => true, storage = new Map(), ledger = new Map(), lostAck = false, hold } = {}) {
  let props, cursor = 0, epoch = 0, tree, closed = false, allocated = 100, saved = 0, afterClose = 0, release, controls = [];
  const slots = [], effects = [], layouts = [], modules = new Map(), calls = [], busy = [], listeners = new Map();
  const gate = hold ? new Promise(resolve => { release = resolve; }) : null;
  const catalog = { format: 'detail-family-catalog-v1', sourceProductId: productId, sourceVersion: old, inputFingerprint: 'a'.repeat(64),
    company: { code: 'A01464742', name: '와이홉' }, familyId: uuid(900), sourceReady, reason: sourceReady ? null : '원본 상세 저장을 먼저 완료해주세요.',
    image: sourceReady ? { key: `owner/quotation-label-${'b'.repeat(64)}.png`, sha256: 'c'.repeat(64), bytes: 12345, width: 800, height: 600 } : null,
    targets: Array.from({ length: count }, (_, i) => ({ productId: `target-${i}`, title: `대상 ${i}`, registrationNumber: String(260101000001 + i), optionCount: 2,
      eligible: i < eligible, reason: i < eligible ? null : '등록전송 이력 있음' })) };
  class Element {
    constructor(node) { this.node = node; this.isConnected = true; }
    get tabIndex() { return this.node?.props?.tabIndex ?? 0; }
    hasAttribute(name) { return name === 'disabled' && Boolean(this.node?.props?.disabled); }
    focus() { document.activeElement = this; }
    querySelectorAll() { return controls; }
  }
  const document = { activeElement: null };
  const outside = new Element(); document.activeElement = outside;
  const effect = (queue, fn, deps) => { const index = cursor++, previous = slots[index];
    if (!previous || !deps || deps.some((value, i) => !Object.is(value, previous.deps?.[i]))) {
      const next = { deps, cleanup: previous?.cleanup }; slots[index] = next; queue.push(() => { previous?.cleanup?.(); next.cleanup = fn(); });
    } };
  const hooks = {
    useState(initial) { const index = cursor++; if (!(index in slots)) slots[index] = { value: typeof initial === 'function' ? initial() : initial };
      return [slots[index].value, value => { if (closed) { afterClose++; return; } epoch++; slots[index].value = typeof value === 'function' ? value(slots[index].value) : value; }]; },
    useRef(initial) { const index = cursor++; return slots[index] ?? (slots[index] = { current: initial }); },
    useId() { const index = cursor++; return slots[index] ?? (slots[index] = `family-${index}`); },
    useEffect(fn, deps) { effect(effects, fn, deps); }, useLayoutEffect(fn, deps) { effect(layouts, fn, deps); },
  };
  props = { productId, profileId, version: old, active: true, disabled: false, beforeOpen, onSaved: () => saved++, onBusyChange: value => busy.push(value) };
  function preview(body) { return { format: 'detail-family-preview-v1', requestId: body.requestId, fingerprint: 'd'.repeat(64), sourceProductId: productId,
    sourceVersion: catalog.sourceVersion, company: catalog.company, familyId: catalog.familyId, key: catalog.image.key, sha256: catalog.image.sha256, bytes: catalog.image.bytes,
    targets: body.targetIds.map(id => { const target = catalog.targets.find(item => item.productId === id); return { productId: id, title: target.title,
      registrationNumber: target.registrationNumber, beforeVersion: old, revision: 4, optionIds: [`${id}-option-0`, `${id}-option-1`] }; }) }; }
  async function fetcher(url, init = {}) {
    const parsed = new URL(url, 'https://fixture.invalid'), body = init.body ? JSON.parse(init.body) : null, method = init.method ?? 'GET';
    assert.equal(parsed.pathname, `/api/products/${productId}/detail-family`); assert.equal(parsed.searchParams.get('profileId'), profileId || null);
    const kind = method === 'GET' ? parsed.searchParams.has('requestId') ? 'recover' : 'catalog' : body.action;
    calls.push({ url, method, kind, body, signal: init.signal }); if (gate && kind === hold) await gate;
    if (kind === 'catalog') return Response.json(catalog);
    if (kind === 'recover') { const receipt = ledger.get(parsed.searchParams.get('requestId'));
      return receipt ? Response.json({ receipt, current: true }) : Response.json({ code: 'DETAIL_FAMILY_NOT_FOUND', receipt: null, current: false }, { status: 404 }); }
    const value = preview(body); assert.equal(body.expectedInputFingerprint, catalog.inputFingerprint);
    if (kind === 'preview') return Response.json(value);
    assert.equal(kind, 'commit'); assert.equal(body.previewFingerprint, value.fingerprint);
    const receipt = { ...value, format: 'detail-family-receipt-v1', committedAt: later, targets: value.targets.map(target => ({ ...target, savedVersion: later, savedRevision: 5 })) };
    ledger.set(body.requestId, receipt); if (lostAck) throw Error('저장 ACK 유실'); return Response.json({ receipt, current: true });
  }
  function load(file) {
    if (modules.has(file)) return modules.get(file); const exports = {}; modules.set(file, exports);
    const jsx = (type, childProps, key) => { const node = { type, props: childProps ?? {}, key }; if (childProps?.ref && !childProps.ref.current) childProps.ref.current = new Element(node); return node; };
    vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../' + file, import.meta.url), 'utf8'), { fileName: file,
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText,
    { exports, Error, Date, URL, Response, AbortController, AbortSignal, DOMException, structuredClone, HTMLElement: Element, document,
      TextEncoder, TextDecoder, Uint8Array, DataView, crypto: { randomUUID: () => uuid(++allocated) }, fetch: fetcher,
      sessionStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) },
      window: { addEventListener: (kind, listener) => { if (!listeners.has(kind)) listeners.set(kind, new Set()); listeners.get(kind).add(listener); }, removeEventListener: (kind, listener) => listeners.get(kind)?.delete(listener) },
      require(name) { if (name === 'react') return hooks; if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx, Fragment: Symbol.for('fragment') };
        if (name.startsWith('@/')) return load(name.slice(2) + (name.includes('/components/') ? '.tsx' : '.ts'));
        if (name.startsWith('./') || name.startsWith('../')) return load(path.posix.join(path.posix.dirname(file), name) + '.ts'); throw Error('Unexpected dependency: ' + name); } });
    return exports;
  }
  const Form = load('app/components/detail-family-apply-panel.tsx').DetailFamilyApplyForm;
  function render() { if (closed) return tree; cursor = 0; tree = Form(props);
    const dialog = nodes(tree).find(node => node.props?.role === 'dialog'); controls = nodes(dialog).filter(node => ['input', 'button', 'select'].includes(node.type)).map(node => new Element(node));
    layouts.splice(0).forEach(fn => fn()); effects.splice(0).forEach(fn => fn()); return tree; }
  async function tick(turns = 3) { for (let i = 0; i < turns; i++) { render(); await new Promise(resolve => setImmediate(resolve)); } render(); }
  async function idle() { let quiet = 0; for (let i = 0; i < 60; i++) { const before = epoch, length = calls.length; await tick(1);
    const processing = nodes(tree).some(node => node.props?.['aria-busy'] === true);
    quiet = !processing && before === epoch && length === calls.length ? quiet + 1 : 0; if (quiet >= 3) return; } throw Error('Family panel did not settle'); }
  const find = (type, label) => nodes(render()).find(node => node.type === type && (node.props['aria-label'] === label || text(node) === label));
  const button = label => find('button', label);
  async function click(label) { const node = button(label); assert.ok(node, 'Button exists: ' + label); assert.ok(!node.props.disabled, 'Button enabled: ' + label); node.props.onClick(); render(); await idle(); }
  async function check(label, checked) { const node = find('input', label); assert.ok(node); assert.ok(!node.props.disabled); node.props.onChange({ target: { checked } }); await tick(); }
  async function accept() { const checkbox = nodes(render()).find(node => node.type === 'input' && node.props.type === 'checkbox' && !node.props['aria-label'] && !node.props.disabled);
    assert.ok(checkbox); checkbox.props.onChange({ target: { checked: true } }); await tick(); }
  render();
  return { render, tick, idle, click, check, accept, button, find, calls, busy, storage, ledger, catalog, document, outside, listeners,
    props: next => { props = { ...props, ...next }; render(); }, saved: () => saved, afterClose: () => afterClose, release: () => release?.(),
    controls: () => controls, close() { closed = true; slots.forEach(slot => slot?.cleanup?.()); } };
}

test('catalog is read-only, only explicit eligible family members default selected and beforeOpen protects other drafts', async () => {
  let allowed = false, guards = 0; const h = harness({ beforeOpen: () => { guards++; return allowed; } }); try {
    await h.idle(); assert.deepEqual(h.calls.map(call => call.kind), ['catalog']);
    await h.click('분할 상품에 상세 적용'); assert.equal(guards, 1); assert.equal(nodes(h.render()).some(node => node.props?.role === 'dialog'), false);
    assert.match(text(h.render()), /미저장 입력/); assert.equal(h.saved(), 0);
    allowed = true; await h.click('분할 상품에 상세 적용');
    assert.equal(h.find('input', '대상 0 상세 적용 대상').props.checked, true); assert.equal(h.find('input', '대상 1 상세 적용 대상').props.checked, true);
    assert.equal(h.find('input', '대상 2 상세 적용 대상').props.checked, false); assert.equal(h.find('input', '대상 2 상세 적용 대상').props.disabled, true);
    assert.equal(h.render().props['data-workspace-dirty'], true); assert.equal(h.busy.at(-1), true);
    assert.equal(h.render().props['data-quotation-source-step'], '상세 이미지');
    assert.equal(h.calls.filter(call => call.method !== 'GET').length, 0);
  } finally { h.close(); }
});

test('unready sources cannot open and more than 19 eligible targets require an explicit bounded selection', async () => {
  const unavailable = harness({ sourceReady: false }); try { await unavailable.idle(); assert.equal(unavailable.button('분할 상품에 상세 적용').props.disabled, true); assert.match(text(unavailable.render()), /먼저 완료/); } finally { unavailable.close(); }
  const h = harness({ count: 20, eligible: 20 }); try {
    await h.idle(); await h.click('분할 상품에 상세 적용'); assert.equal(h.button('상세 적용 미리보기').props.disabled, true);
    assert.ok(nodes(h.render()).filter(node => node.type === 'input' && node.props['aria-label']).every(node => !node.props.checked));
    await h.check('대상 3 상세 적용 대상', true); await h.click('상세 적용 미리보기');
    assert.deepEqual(h.calls.find(call => call.kind === 'preview').body.targetIds, ['target-3']); assert.equal(h.calls.some(call => call.kind === 'commit'), false);
  } finally { h.close(); }
});

test('review shows the stored image and exact targets, and selection changes discard approval without any commit', async () => {
  const h = harness(); try {
    await h.idle(); await h.click('분할 상품에 상세 적용');
    assert.match(nodes(h.render()).find(node => node.type === 'img').props.src, /^\/api\/files\/owner\/quotation-label-/);
    await h.click('상세 적용 미리보기'); await h.accept(); assert.equal(h.button('확인한 상품에 상세 적용').props.disabled, false);
    const requested = h.calls.find(call => call.kind === 'preview').body; assert.deepEqual(requested.targetIds, ['target-0', 'target-1']);
    assert.match(text(h.find('div', '분할 상품 상세 적용 미리보기')), /대상 0/); assert.match(text(h.find('div', '분할 상품 상세 적용 미리보기')), /옵션 2개/);
    await h.check('대상 1 상세 적용 대상', false); assert.equal(h.find('div', '분할 상품 상세 적용 미리보기'), undefined);
    assert.equal(h.button('확인한 상품에 상세 적용').props.disabled, true); assert.equal(h.calls.some(call => call.kind === 'commit'), false);
  } finally { h.close(); }
});

test('lost ACK or a commit completed while hidden locks repeat writes until explicit GET-only recovery', async () => {
  for (const mode of ['lost-ack', 'hidden-commit']) {
  const h = harness({ lostAck: mode === 'lost-ack', hold: mode === 'hidden-commit' ? 'commit' : undefined }); try {
    await h.idle(); await h.click('분할 상품에 상세 적용'); await h.click('상세 적용 미리보기'); await h.accept();
    if (mode === 'hidden-commit') {
      h.button('확인한 상품에 상세 적용').props.onClick(); await h.tick(); h.props({ active: false }); await h.tick();
      h.release(); await h.idle(); assert.equal(h.saved(), 0); h.props({ active: true }); await h.idle();
    } else await h.click('확인한 상품에 상세 적용');
    assert.deepEqual(h.calls.map(call => call.kind), ['catalog', 'preview', 'commit']); assert.ok(h.storage.has(storageKey()));
    assert.equal(h.button('취소').props.disabled, true); assert.equal(h.button('확인한 상품에 상세 적용'), undefined);
    assert.equal(h.render().props['data-workspace-saving'], true); assert.equal(h.busy.at(-1), true); assert.equal(h.saved(), 0);
    await h.click('상세 적용 결과 확인'); assert.deepEqual(h.calls.map(call => call.kind), ['catalog', 'preview', 'commit', 'recover']);
    assert.equal(h.calls.at(-1).method, 'GET'); assert.equal(h.saved(), 1); assert.equal(h.storage.has(storageKey()), false);
    assert.equal(h.render().props['data-workspace-dirty'], false); assert.equal(h.busy.at(-1), false);
  } finally { h.close(); }
  }
});

test('reload restores exact pending source/profile evidence and recovery reads without re-preview or re-commit', async () => {
  const storage = new Map(), ledger = new Map(), first = harness({ lostAck: true, storage, ledger });
  await first.idle(); await first.click('분할 상품에 상세 적용'); await first.click('상세 적용 미리보기'); await first.accept(); await first.click('확인한 상품에 상세 적용'); first.close();
  for (const scope of [{ profileId: 'other-profile' }, { productId: 'other-product' }]) {
    const other = harness({ storage, ledger, ...scope }); try { await other.idle(); assert.deepEqual(other.calls.map(call => call.kind), ['catalog']); assert.ok(storage.has(storageKey())); } finally { other.close(); }
  }
  const h = harness({ storage, ledger }); try {
    await h.idle(); assert.equal(h.calls.length, 0); assert.match(text(h.render()), /이전에 요청한 상세 적용/);
    await h.click('상세 적용 결과 확인'); assert.deepEqual(h.calls.map(call => call.kind), ['recover']); assert.equal(h.calls[0].method, 'GET'); assert.equal(h.saved(), 1);
  } finally { h.close(); }
});

test('active or version changes revoke old approval and cannot reactivate a prior accepted write', async () => {
  const h = harness(); try {
    await h.idle(); await h.click('분할 상품에 상세 적용'); await h.click('상세 적용 미리보기'); await h.accept();
    h.props({ active: false }); await h.tick(); h.props({ active: true }); await h.idle();
    const resumed = h.button('확인한 상품에 상세 적용'); assert.ok(!resumed || resumed.props.disabled, 'Returning to a stage must require fresh review approval');
    if (!nodes(h.render()).some(node => node.props?.role === 'dialog')) await h.click('분할 상품에 상세 적용');
    await h.click('상세 적용 미리보기'); await h.accept(); h.props({ version: later }); await h.tick();
    const changed = h.button('확인한 상품에 상세 적용'); assert.ok(!changed || changed.props.disabled);
    assert.equal(h.calls.some(call => call.kind === 'commit'), false);
  } finally { h.close(); }
});

test('late preview after leaving the active stage is discarded and unmount aborts further state adoption', async () => {
  const h = harness({ hold: 'preview' }); await h.idle(); await h.click('분할 상품에 상세 적용');
  h.button('상세 적용 미리보기').props.onClick(); await h.tick(); h.props({ active: false }); await h.tick(); h.release(); await h.idle();
  h.props({ active: true }); await h.idle(); assert.equal(h.find('div', '분할 상품 상세 적용 미리보기'), undefined);
  assert.equal(h.calls.some(call => call.kind === 'commit'), false); h.close(); assert.equal(h.busy.at(-1), false);
  const closing = harness({ hold: 'preview' }); await closing.idle(); await closing.click('분할 상품에 상세 적용'); closing.button('상세 적용 미리보기').props.onClick(); await closing.tick();
  closing.close(); assert.equal(closing.calls.at(-1).signal.aborted, true); closing.release(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(closing.afterClose(), 0); assert.equal(closing.saved(), 0);
});

test('focus is contained within the dialog and Escape restores prior focus without sending a request', async () => {
  const h = harness(); try {
    await h.idle(); await h.click('분할 상품에 상세 적용'); assert.notEqual(h.document.activeElement, h.outside);
    const dialog = nodes(h.render()).find(node => node.props?.role === 'dialog');
    const list = h.controls().filter(control => !control.hasAttribute('disabled') && control.tabIndex >= 0); list.at(-1).focus();
    let prevented = false;
    dialog.props.onKeyDown({ key: 'Tab', shiftKey: false, preventDefault: () => { prevented = true; } }); assert.equal(prevented, true);
    assert.equal(h.document.activeElement, list[0]);
    prevented = false; dialog.props.onKeyDown({ key: 'Tab', shiftKey: true, preventDefault: () => { prevented = true; } });
    assert.equal(prevented, true); assert.equal(h.document.activeElement, list.at(-1));
    dialog.props.onKeyDown({ key: 'Escape', preventDefault() {} }); await h.tick(); assert.equal(h.document.activeElement, h.outside);
    assert.equal(h.render().props['data-workspace-dirty'], false); assert.deepEqual(h.calls.map(call => call.kind), ['catalog']);
  } finally { h.close(); }
});

test('invalid catalog image metadata is rejected before targets or a write can be reviewed', async () => {
  const h = harness(); try {
    h.catalog.image.width = 799; await h.idle();
    assert.match(text(h.render()), /검토한 원본·회사·대상과 다릅니다/);
    assert.equal(h.button('분할 상품에 상세 적용').props.disabled, true); assert.equal(h.calls.some(call => call.method !== 'GET'), false);
  } finally { h.close(); }
});

test('corrupt pending confirmation requires explicit acknowledgement before local reset and performs no write', async () => {
  const storage = new Map([[storageKey(), '{corrupt'], ['unrelated', 'retain']]), h = harness({ storage }); try {
    await h.idle(); assert.equal(h.button('목록 확인 후 이전 확인 자료 정리').props.disabled, true);
    const checkbox = nodes(h.render()).find(node => node.type === 'input' && node.props.type === 'checkbox'); checkbox.props.onChange({ target: { checked: true } }); await h.tick();
    await h.click('목록 확인 후 이전 확인 자료 정리'); assert.equal(h.storage.has(storageKey()), false); assert.equal(h.storage.get('unrelated'), 'retain');
    assert.equal(h.calls.some(call => call.method !== 'GET'), false); assert.equal(h.saved(), 1); assert.equal(h.render().props['data-workspace-saving'], false);
  } finally { h.close(); }
});
