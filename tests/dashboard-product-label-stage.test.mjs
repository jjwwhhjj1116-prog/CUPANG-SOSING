import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { createRequire } from 'node:module';

const native = createRequire(import.meta.url);
const nodes = value => Array.isArray(value) ? value.flatMap(nodes) : value && typeof value === 'object' ? [value, ...nodes(value.props?.children)] : [];
const version = '2026-10-07T00:00:00.000Z';
const product = id => ({ id, title: '상품 ' + id, updated_at: version, image_keys: JSON.stringify(['owner/' + id + '/a.png']), source_price_cny: 2,
  exchange_rate: 350, supply_margin: 50, coupang_margin: 40, supply_price: 1400, sale_price: 2340, msrp: 3050, options_count: 2 });

/** Render the real DetailPanel with stateful mock children. Distinct component
 * keys retain editor draft state across hidden stages; changing an actual scope
 * must create a new instance. Navigation never executes child HTTP handlers. */
function harness() {
  const instances = new Map(), modules = new Map(), components = new Map(), records = [], effects = [];
  let active, tree, nextIdentity = 0, saved = 0, calls = 0;
  let props = { tab: '표시사항', product: product('p'), settings: { minimumMarginEnabled: false, msrpMultiple: 1.3, roundingUnit: 10 }, focusedOptionId: 'red', preferredProfileId: 'profile-a',
    onSaved() { saved++; }, onUpload() {}, onSavePrice: async () => {}, onManageCategories() {}, onBeforeFreeImageApply: () => true, onPrepareSubmission() {}, onReviewPackaging() {} };
  const hooks = {
    useState(initial) { const instance = active, slot = instance.index++; if (!(slot in instance.slots)) instance.slots[slot] = typeof initial === 'function' ? initial() : initial; return [instance.slots[slot], value => { if (instance.mounted) instance.slots[slot] = typeof value === 'function' ? value(instance.slots[slot]) : value; }]; },
    useRef(value) { const slot = active.index++; return active.slots[slot] ?? (active.slots[slot] = { current: value }); },
    useMemo(fn) { return fn(); },
    useCallback(fn, deps) { const slot = active.index++, old = active.slots[slot]; if (!old || deps.some((value, i) => !Object.is(value, old.deps[i]))) active.slots[slot] = { fn, deps }; return active.slots[slot].fn; },
    useEffect(fn, deps) { const instance = active, slot = instance.index++, old = instance.slots[slot]; if (!old || !deps || deps.some((value, i) => !Object.is(value, old.deps[i]))) { const value = { deps, cleanup: old?.cleanup }; instance.slots[slot] = value; effects.push(() => { value.cleanup?.(); value.cleanup = fn(); }); } },
  };
  function componentModule(name) {
    if (!components.has(name)) {
      const child = received => {
        const [draft, setDraft] = hooks.useState(''), [busy, setBusy] = hooks.useState(false), instance = active;
        records.push({ name, props: received, ancestors: instance.ancestors, instance, draft, setDraft, setBusy });
        const step = name === 'product-label-editor' ? '표시사항' : name === 'option-label-editor' ? '상품고시' : '공통 자료';
        return { type: 'section', props: { 'data-child': name, 'data-quotation-source-step': step, 'data-workspace-dirty': !!draft, 'data-workspace-saving': busy } };
      };
      child.displayName = name; components.set(name, child);
    }
    const component = components.get(name);
    return new Proxy({ __esModule: true, default: component }, { get(target, key) { return key in target ? target[key] : component; } });
  }
  function load(file) {
    if (modules.has(file)) return modules.get(file);
    const exports = {}; modules.set(file, exports); const source = fs.readFileSync(new URL('../' + file, import.meta.url), 'utf8') + (file.endsWith('dashboard-client.tsx') ? '\nexport { DetailPanel };' : '');
    vm.runInNewContext(ts.transpileModule(source, { fileName: file, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText,
      { exports, URL, URLSearchParams, Date, Intl, TextEncoder, TextDecoder, crypto, AbortController, structuredClone, window: { print() {}, setTimeout() {} }, fetch: async () => { calls++; throw Error('Unexpected dashboard request.'); }, require(name) {
        if (name === 'react') return hooks;
        if (name === 'react/jsx-runtime') return { jsx: (type, received, key) => ({ type, props: received, key }), jsxs: (type, received, key) => ({ type, props: received, key }), Fragment: 'fragment' };
        if (name.endsWith('.css')) return {};
        if (name.startsWith('@/app/components/')) return componentModule(name.split('/').at(-1));
        return name.startsWith('@/') ? load(name.slice(2) + '.ts') : native(name);
      } }); return exports;
  }
  const Detail = load('app/components/dashboard-client.tsx').DetailPanel, guards = load('app/workspace-close.ts');
  function expand(value, path, ancestors, seen) {
    if (Array.isArray(value)) return value.map((child, i) => expand(child, path + '/' + (child?.key ?? i), ancestors, seen)); if (!value || typeof value !== 'object') return value;
    if (typeof value.type === 'function') {
      const key = path + '/' + (value.type.displayName ?? value.type.name) + ':' + (value.key ?? ''); let instance = instances.get(key);
      if (!instance) { instance = { identity: ++nextIdentity, slots: [], mounted: true }; instances.set(key, instance); }
      seen.add(key); instance.index = 0; instance.ancestors = ancestors; active = instance; return expand(value.type(value.props), key, ancestors, seen);
    }
    return { ...value, props: { ...value.props, children: expand(value.props?.children, path + '/children', [...ancestors, value], seen) } };
  }
  function render(patch = {}) {
    props = { ...props, ...patch }; records.length = 0; const seen = new Set(); tree = expand({ type: Detail, props }, 'root', [], seen);
    for (const [key, instance] of instances) if (!seen.has(key)) { instance.mounted = false; instance.slots.forEach(slot => slot?.cleanup?.()); instances.delete(key); }
    effects.splice(0).forEach(effect => effect()); return tree;
  }
  const all = name => { render(); return records.filter(row => row.name === name); };
  const record = (name, predicate = () => true) => { const found = all(name).filter(row => predicate(row.props)); assert.equal(found.length, 1, 'One ' + name); return found[0]; };
  const visible = record => !record.ancestors.some(ancestor => ancestor.props?.hidden === true);
  const matches = (node, selector) => { const [, key, value] = selector.match(/^\[([^=\]]+)(?:="([^"]+)")?\]$/); return value === undefined ? node.props?.[key] !== undefined : String(node.props?.[key]) === value; };
  const element = node => ({ getAttribute: key => node.props?.[key] === undefined ? null : String(node.props[key]), querySelector: selector => nodes(node.props?.children).find(child => matches(child, selector)) ?? null });
  const dom = () => ({ querySelector: selector => nodes(tree).find(node => matches(node, selector)) ?? null, querySelectorAll: selector => nodes(tree).filter(node => matches(node, selector)).map(element) });
  render(); return { render, record, all, visible, get saved() { return saved; }, get calls() { return calls; }, edit(name, value, predicate) { record(name, predicate).setDraft(value); render(); },
    closeResult() { render(); return guards.requestWorkspaceClose(dom(), () => false); }, pending() { render(); return Array.from(guards.quotationSourceState(dom()).steps); },
    close() { for (const instance of instances.values()) { instance.mounted = false; instance.slots.forEach(slot => slot?.cleanup?.()); } } };
}

test('the exact product-label editor belongs to step 6, retains its hidden draft and stays separate from step 7 legal notices', () => {
  const h = harness(); try {
    const productLabel = h.record('product-label-editor'), legal = h.record('option-label-editor');
    assert.equal(productLabel.props.productId, 'p'); assert.equal(productLabel.props.optionId, 'red'); assert.equal(productLabel.props.profileId, 'profile-a');
    h.edit('product-label-editor', 'manual nine-row product label'); h.edit('option-label-editor', 'manual category legal notices');
    for (const tab of ['추가 이미지', '상세 이미지', '견적서', 'SEO', '표시사항']) {
      h.render({ tab }); const label = h.record('product-label-editor'), notice = h.record('option-label-editor');
      assert.equal(label.instance, productLabel.instance); assert.equal(label.draft, 'manual nine-row product label'); assert.equal(h.visible(label), tab === '표시사항'); assert.equal(h.all('product-label-editor').length, 1);
      assert.equal(notice.instance, legal.instance); assert.equal(notice.draft, 'manual category legal notices'); assert.equal(h.visible(notice), tab === '견적서');
      assert.ok(h.pending().includes('표시사항')); assert.ok(h.pending().includes('상품고시')); assert.equal(h.closeResult(), 'cancel');
    }
    assert.equal(h.calls, 0); assert.equal(h.saved, 0);
  } finally { h.close(); }
});

test('product/option/profile scope resets the nine-row editor, while source clocks and successful saves retain its instance', () => {
  const h = harness(); try {
    const initial = h.record('product-label-editor'); h.edit('product-label-editor', 'red-only label');
    h.render({ product: { ...product('p'), updated_at: '2026-10-07T00:00:01.000Z' } }); const clock = h.record('product-label-editor');
    assert.equal(clock.instance, initial.instance); assert.equal(clock.draft, 'red-only label'); assert.equal(clock.props.version, '2026-10-07T00:00:01.000Z');
    clock.props.onSaved(); const refreshed = h.record('product-label-editor'); assert.equal(refreshed.instance, initial.instance); assert.equal(refreshed.props.refreshToken, '1'); assert.equal(refreshed.draft, 'red-only label'); assert.equal(h.saved, 1);
    h.render({ focusedOptionId: 'blue' }); const blue = h.record('product-label-editor'); assert.notEqual(blue.instance, initial.instance); assert.equal(blue.props.optionId, 'blue'); assert.equal(blue.draft, ''); assert.equal(initial.instance.mounted, false);
    h.render({ focusedOptionId: undefined }); const common = h.record('product-label-editor'); assert.equal(common.props.optionId, null); assert.notEqual(common.instance, blue.instance); assert.equal(common.draft, ''); assert.equal(h.visible(common), true);
    h.edit('product-label-editor', 'common label'); h.render({ tab: '견적서' }); assert.equal(h.record('product-label-editor').instance, common.instance); assert.equal(h.record('product-label-editor').draft, 'common label'); assert.equal(h.all('option-label-editor').length, 0);
    h.record('quotation-panel').props.onProfileChange('profile-b'); const profile = h.record('product-label-editor'); assert.notEqual(profile.instance, common.instance); assert.equal(profile.props.profileId, 'profile-b'); assert.equal(profile.props.optionId, null); assert.equal(profile.draft, '');
    h.render({ product: product('other'), preferredProfileId: 'profile-c', tab: '표시사항' }); const next = h.record('product-label-editor'); assert.notEqual(next.instance, profile.instance); assert.equal(next.props.productId, 'other'); assert.equal(next.props.profileId, 'profile-c'); assert.equal(next.props.optionId, null); assert.equal(next.draft, ''); assert.equal(h.calls, 0);
  } finally { h.close(); }
});

test('legacy common label/source tools stay mounted in advanced collapses and never replace the nine-row primary editor', () => {
  const h = harness(); try {
    const commonContent = h.record('product-content-editor'), document = h.record('document-image-panel', props => props.section === 'label'), primary = h.record('product-label-editor');
    h.edit('product-content-editor', 'preserved source labels'); h.edit('document-image-panel', 'preserved legacy PNG draft', props => props.section === 'label');
    for (const focusedOptionId of ['red', undefined]) {
      h.render({ tab: '표시사항', focusedOptionId }); const common = h.record('product-content-editor'), png = h.record('document-image-panel', props => props.section === 'label');
      assert.equal(common.instance, commonContent.instance); assert.equal(common.draft, 'preserved source labels'); assert.equal(png.instance, document.instance); assert.equal(png.draft, 'preserved legacy PNG draft');
      assert.equal(common.ancestors.findLast(ancestor => ancestor.type === 'details').props.open === true, false); assert.equal(png.ancestors.findLast(ancestor => ancestor.type === 'details').props.open === true, false);
      assert.equal(h.visible(h.record('product-label-editor')), true); assert.equal(h.record('product-label-editor').props.optionId, focusedOptionId ?? null);
    }
    h.render({ tab: '상세 이미지' }); assert.equal(h.record('product-content-editor').instance, commonContent.instance); assert.equal(h.record('document-image-panel', props => props.section === 'label').instance, document.instance);
    assert.equal(primary.instance.mounted, false); assert.equal(h.closeResult(), 'cancel'); assert.equal(h.calls, 0); assert.equal(h.saved, 0);
  } finally { h.close(); }
});
