import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';

const nodes = value => Array.isArray(value) ? value.flatMap(nodes) : value && typeof value === 'object' ? [value, ...nodes(value.props?.children)] : [];
const text = value => Array.isArray(value) ? value.map(text).join('') : value && typeof value === 'object' ? text(value.props?.children) : value == null ? '' : String(value);
const uuid = n => `${n.toString(16).padStart(8, '0')}-1111-4111-8111-${n.toString(16).padStart(12, '0')}`;
const company = { code: 'A01464742', name: '와이홉' };
const storageKey = (product = 'source-product', profile = 'profile-one') => `yoofam-option-split-v1:${product}:${profile}`;
function view(count = 3) { return { inputFingerprint: 'a'.repeat(64), productVersion: '2026-10-15T01:00:00.000Z', contentRevision: 3, optionRevision: 4, revision: 5,
  resolved: { rows: [{ optionId: null, optionLabel: '공통', included: true }, ...Array.from({ length: count }, (_, i) => ({ optionId: `option-${i}`, optionLabel: ` 옵션 ${i} `, included: i % 2 === 0, fields: {} }))] } }; }

/** Actual panel + actual client validators. Storage, React hooks and transport
 * are local adapters; no browser, vendor service or application DB is used. */
function harness({ count = 3, storage = new Map(), ledger = new Map(), profileId = 'profile-one', productId = 'source-product', lostAck = false, held = false } = {}) {
  let props, cursor = 0, epoch = 0, tree, closed = false, allocated = 100, committed = 0, settersAfterClose = 0, release;
  const slots = [], effects = [], layouts = [], modules = new Map(), calls = [], busy = [], dirty = [], listeners = new Map();
  const gate = held ? new Promise(resolve => { release = resolve; }) : null;
  class Element { isConnected = true; focus() { document.activeElement = this; } querySelectorAll() { return []; } }
  const document = { activeElement: null };
  const effect = (queue, fn, deps) => { const index = cursor++, previous = slots[index];
    if (!previous || !deps || deps.some((value, i) => !Object.is(value, previous.deps?.[i]))) {
      const next = { deps, cleanup: previous?.cleanup }; slots[index] = next; queue.push(() => { previous?.cleanup?.(); next.cleanup = fn(); });
    } };
  const hooks = {
    useState(initial) { const index = cursor++; if (!(index in slots)) slots[index] = { value: typeof initial === 'function' ? initial() : initial };
      return [slots[index].value, value => { if (closed) { settersAfterClose++; return; } epoch++; slots[index].value = typeof value === 'function' ? value(slots[index].value) : value; }]; },
    useRef(initial) { const index = cursor++; return slots[index] ?? (slots[index] = { current: initial }); },
    useId() { const index = cursor++; return slots[index] ?? (slots[index] = `panel-${index}`); },
    useEffect(fn, deps) { effect(effects, fn, deps); }, useLayoutEffect(fn, deps) { effect(layouts, fn, deps); },
  };
  props = { productId, profileId, view: view(count), disabled: false,
    onBusyChange: value => busy.push(value), onDraftChange: value => dirty.push(value), onCommitted: () => committed++ };
  async function request(url, init = {}) {
    const parsed = new URL(url, 'https://fixture.invalid'), body = init.body ? JSON.parse(init.body) : null, method = init.method ?? 'GET';
    assert.equal(parsed.pathname, `/api/products/${productId}/option-splits`); assert.equal(parsed.searchParams.get('profileId'), profileId || null);
    calls.push({ url, method, body, signal: init.signal });
    if (gate && method === 'POST' && body.action === 'preview') await gate;
    if (method === 'GET') {
      const receipt = ledger.get(parsed.searchParams.get('requestId'));
      return receipt ? Response.json({ receipt, current: true }) : Response.json({ code: 'OPTION_SPLIT_NOT_FOUND', receipt: null, current: false }, { status: 404 });
    }
    assert.equal(method, 'POST');
    const preview = { format: 'product-option-split-preview-v1', requestId: body.requestId, fingerprint: 'b'.repeat(64), sourceProductId: productId,
      sourceVersion: props.view.productVersion, company, warnings: ['수동 견적 제목은 유지됩니다.'], groups: body.groups.map((group, i) => ({ productId: group.productId,
        label: group.label, title: ` 원본 , ${group.label}`, seoTitle: ` SEO , ${group.label}`, retainsSource: i === 0,
        sourceOptionIds: group.optionIds, optionIds: group.optionIds.map(id => group.optionIdMap[id]) })) };
    if (body.action === 'preview') return Response.json(preview);
    assert.equal(body.action, 'commit'); assert.equal(body.previewFingerprint, preview.fingerprint);
    const receipt = { ...preview, format: 'product-option-split-receipt-v1', familyId: uuid(9000), committedAt: '2026-10-15T02:00:00.000Z',
      groups: preview.groups.map((group, i) => ({ ...group, jobId: i ? uuid(9100 + i) : 'original-job', productVersion: '2026-10-15T02:00:00.000Z',
        contentRevision: i ? 1 : 4, optionsRevision: i ? 1 : 5, quotationRevision: i ? 1 : 6, labelsRevision: 1, registrationNumber: String(260101000001 + i) })) };
    ledger.set(body.requestId, receipt); if (lostAck) throw Error('저장 응답 유실');
    return Response.json({ receipt, current: true });
  }
  function load(file) {
    if (modules.has(file)) return modules.get(file); const exports = {}; modules.set(file, exports);
    const jsx = (type, childProps, key) => { const node = { type, props: childProps ?? {}, key }; if (childProps?.ref && !childProps.ref.current) childProps.ref.current = new Element(); return node; };
    vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../' + file, import.meta.url), 'utf8'), { fileName: file,
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText,
    { exports, Error, Date, URL, Response, AbortController, AbortSignal, DOMException, structuredClone, HTMLElement: Element, document,
      crypto: { randomUUID: () => uuid(++allocated) }, fetch: request,
      sessionStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) },
      window: { addEventListener: (kind, listener) => { if (!listeners.has(kind)) listeners.set(kind, new Set()); listeners.get(kind).add(listener); }, removeEventListener: (kind, listener) => listeners.get(kind)?.delete(listener) },
      require(name) { if (name === 'react') return hooks; if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx, Fragment: Symbol.for('fragment') };
        if (name.startsWith('@/')) return load(name.slice(2) + (name.includes('/components/') ? '.tsx' : '.ts'));
        if (name.startsWith('./')) return load(path.posix.join(path.posix.dirname(file), name) + '.ts'); throw Error('Unexpected dependency: ' + name); } });
    return exports;
  }
  const Panel = load('app/components/product-option-split-panel.tsx').ProductOptionSplitPanel;
  function render() { if (closed) return tree; cursor = 0; tree = Panel(props); layouts.splice(0).forEach(fn => fn()); effects.splice(0).forEach(fn => fn()); return tree; }
  async function tick(turns = 3) { for (let i = 0; i < turns; i++) { render(); await new Promise(resolve => setImmediate(resolve)); } render(); }
  async function idle() { let quiet = 0; for (let i = 0; i < 50; i++) { const before = epoch, length = calls.length; await tick(1);
    const processing = nodes(tree).some(node => node.props?.['aria-busy'] === true);
    quiet = !processing && before === epoch && length === calls.length ? quiet + 1 : 0; if (quiet >= 3) return; } throw Error('Panel did not settle'); }
  const find = (type, label) => nodes(render()).find(node => node.type === type && (node.props['aria-label'] === label || text(node) === label));
  function button(label) { return find('button', label); }
  async function click(label) { const node = button(label); assert.ok(node, 'Button exists: ' + label); assert.ok(!node.props.disabled, 'Button enabled: ' + label); node.props.onClick(); render(); await idle(); }
  async function change(type, label, value) { const node = find(type, label); assert.ok(node, 'Control exists: ' + label); assert.ok(!node.props.disabled);
    node.props.onChange({ target: { value: String(value), checked: Boolean(value) } }); await tick(); }
  async function accept() { const checkbox = nodes(render()).find(node => node.type === 'input' && node.props.type === 'checkbox' && !node.props.disabled); assert.ok(checkbox); checkbox.props.onChange({ target: { checked: true } }); await tick(); }
  render();
  return { render, tick, idle, click, change, accept, button, find, calls, busy, dirty, storage, ledger, listeners, release: () => release?.(),
    committed: () => committed, settersAfterClose: () => settersAfterClose,
    props: next => { props = { ...props, ...next }; render(); }, view: props.view,
    close() { closed = true; slots.forEach(slot => slot?.cleanup?.()); } };
}

test('individual proposal preserves every <=20 option including excluded rows, does not truncate labels or send requests on opening', async () => {
  const h = harness(); try {
    h.view.resolved.rows[3].optionLabel = '가'.repeat(121); await h.idle(); await h.click('상품 나누기');
    assert.equal(h.find('input', '분할 그룹 수').props.value, 3); assert.equal(h.find('input', '그룹 1 이름').props.value, ' 옵션 0 ');
    assert.equal(h.find('input', '그룹 3 이름').props.value, '');
    const selects = nodes(h.render()).filter(node => node.type === 'select'); assert.deepEqual(selects.map(node => node.props.value), [0, 1, 2]);
    assert.match(text(h.render()), /제외/); assert.equal(h.calls.length, 0); assert.equal(h.dirty.at(-1), true); assert.equal(h.busy.at(-1), false);
    assert.equal(h.listeners.get('beforeunload').size, 1); await h.click('취소'); assert.equal(h.dirty.at(-1), false); assert.equal(h.listeners.get('beforeunload').size, 0);
  } finally { h.close(); }
});

test('>20 options start unassigned and require a complete manual grouping before a preview-only request', async () => {
  const h = harness({ count: 21 }); try {
    await h.idle(); await h.click('상품 나누기'); assert.equal(h.find('input', '분할 그룹 수').props.value, 2);
    assert.ok(nodes(h.render()).filter(node => node.type === 'select').every(node => node.props.value === -1));
    await h.click('분할 미리보기'); assert.equal(h.calls.length, 0); assert.match(text(h.render()), /옵션|그룹/);
    for (let i = 0; i < 21; i++) await h.change('select', ` 옵션 ${i}  저장 그룹`, i % 2);
    await h.click('분할 미리보기'); assert.equal(h.calls.length, 1); assert.equal(h.calls[0].body.action, 'preview');
    assert.equal(h.calls[0].body.groups.flatMap(group => group.optionIds).length, 21); assert.equal(h.calls.some(call => call.body?.action === 'commit'), false);
    assert.match(text(h.render()), /SEO/); assert.ok(h.busy.includes(true)); assert.equal(h.busy.at(-1), false);
  } finally { h.close(); }
});

test('changing group names/count/assignments invalidates the accepted preview and an externally changed source cannot commit', async () => {
  const h = harness(); try {
    await h.idle(); await h.click('상품 나누기'); await h.click('분할 미리보기'); await h.accept();
    assert.equal(h.button('확인한 그룹으로 분할 저장').props.disabled, false);
    await h.change('input', '그룹 1 이름', ' 직접 바꾼 그룹 '); assert.equal(h.find('div', '상품 분할 미리보기'), undefined); assert.equal(h.button('확인한 그룹으로 분할 저장').props.disabled, true);
    await h.click('분할 미리보기'); await h.accept(); await h.change('input', '분할 그룹 수', 2);
    assert.equal(h.button('확인한 그룹으로 분할 저장').props.disabled, true);
    await h.click('분할 미리보기'); await h.accept(); await h.change('select', ' 옵션 1  저장 그룹', 0);
    assert.equal(h.button('확인한 그룹으로 분할 저장').props.disabled, true);
    await h.click('분할 미리보기'); await h.accept(); h.props({ view: { ...h.view, inputFingerprint: 'c'.repeat(64) } }); await h.tick();
    assert.equal(h.button('확인한 그룹으로 분할 저장').props.disabled, true); assert.match(text(h.render()), /원본 저장값이 바뀌었습니다/);
    assert.equal(h.calls.every(call => call.body?.action === 'preview'), true);
  } finally { h.close(); }
});

test('a lost commit response locks edits/retry and GET-only recovery verifies the durable reviewed receipt', async () => {
  const h = harness({ lostAck: true }); try {
    await h.idle(); await h.click('상품 나누기'); await h.click('분할 미리보기'); await h.accept(); await h.click('확인한 그룹으로 분할 저장');
    assert.deepEqual(h.calls.map(call => call.body?.action), ['preview', 'commit']); assert.ok(h.storage.has(storageKey()));
    assert.equal(h.button('상품 나누기').props.disabled, true); assert.equal(h.button('취소').props.disabled, true);
    assert.equal(h.button('확인한 그룹으로 분할 저장'), undefined); assert.equal(h.dirty.at(-1), true); assert.equal(h.committed(), 0);
    await h.click('분할 저장 결과 확인'); assert.deepEqual(h.calls.map(call => call.method), ['POST', 'POST', 'GET']);
    assert.equal(h.committed(), 1); assert.equal(h.storage.has(storageKey()), false); assert.equal(h.dirty.at(-1), false);
    assert.match(text(h.render()), /분할 저장했습니다/);
  } finally { h.close(); }
});

test('reload restores a bound attempt for the exact product/profile and only reads its receipt after an explicit click', async () => {
  const storage = new Map(), ledger = new Map(), initial = harness({ lostAck: true, storage, ledger });
  await initial.idle(); await initial.click('상품 나누기'); await initial.click('분할 미리보기'); await initial.accept(); await initial.click('확인한 그룹으로 분할 저장'); initial.close();
  for (const scope of [{ profileId: 'different-profile' }, { productId: 'different-product' }]) {
    const other = harness({ storage, ledger, ...scope }); try {
      await other.idle(); assert.equal(other.calls.length, 0); assert.equal(other.button('상품 나누기').props.disabled, false); assert.ok(storage.has(storageKey()));
    } finally { other.close(); }
  }
  const reloaded = harness({ storage, ledger }); try {
    await reloaded.idle(); assert.equal(reloaded.calls.length, 0); assert.match(text(reloaded.render()), /이전에 요청한 분할/);
    assert.equal(reloaded.button('상품 나누기').props.disabled, true); await reloaded.click('분할 저장 결과 확인');
    assert.deepEqual(reloaded.calls.map(call => call.method), ['GET']); assert.equal(reloaded.committed(), 1); assert.equal(storage.has(storageKey()), false);
  } finally { reloaded.close(); }
});

test('corrupt local recovery data requires explicit list acknowledgement before reset and never sends POST or GET', async () => {
  const storage = new Map([[storageKey(), '{corrupt'], ['unrelated', 'retain']]), h = harness({ storage }); try {
    await h.idle(); assert.equal(h.button('상품 나누기').props.disabled, true); assert.equal(h.button('목록 확인 후 이전 확인 자료 정리').props.disabled, true);
    const checkbox = nodes(h.render()).find(node => node.type === 'input' && node.props.type === 'checkbox'); assert.ok(checkbox);
    checkbox.props.onChange({ target: { checked: true } }); await h.tick(); await h.click('목록 확인 후 이전 확인 자료 정리');
    assert.equal(h.calls.length, 0); assert.equal(h.committed(), 1); assert.equal(storage.has(storageKey()), false); assert.equal(storage.get('unrelated'), 'retain');
    assert.equal(h.button('상품 나누기').props.disabled, false); assert.equal(h.dirty.at(-1), false);
  } finally { h.close(); }
});

test('unmount aborts an outstanding preview and ignores its later response while releasing parent locks', async () => {
  const h = harness({ held: true }); await h.idle(); await h.click('상품 나누기');
  h.button('분할 미리보기').props.onClick(); await h.tick(); assert.equal(h.calls.length, 1); assert.equal(h.busy.at(-1), true);
  h.close(); assert.equal(h.calls[0].signal.aborted, true); assert.equal(h.busy.at(-1), false); assert.equal(h.dirty.at(-1), false);
  h.release(); await new Promise(resolve => setImmediate(resolve)); await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.settersAfterClose(), 0); assert.equal(h.committed(), 0); assert.equal(h.storage.size, 0);
});
