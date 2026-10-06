import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { createRequire } from 'node:module';

const native = createRequire(import.meta.url);
const nodes = value => Array.isArray(value) ? value.flatMap(nodes) : value && typeof value === 'object' ? [value, ...nodes(value.props?.children)] : [];
const text = value => Array.isArray(value) ? value.map(text).join('') : value && typeof value === 'object' ? text(value.props?.children) : value == null ? '' : String(value);
const plain = value => JSON.parse(JSON.stringify(value));
const version = '2026-10-07T00:00:00.000Z';
const product = id => ({ id, title: '상품 ' + id, updated_at: version, image_keys: JSON.stringify(['owner/' + id + '/a.png']),
  source_price_cny: 2, exchange_rate: 350, supply_margin: 50, coupang_margin: 40, supply_price: 1400, sale_price: 2340, msrp: 3050, options_count: 2 });

/** Execute the real private DetailPanel with stateful child editors. React-like
 * path/key reconciliation makes an accidental conditional remount observable:
 * the child loses its pending text and its workspace draft marker. */
function harness(initial = {}) {
  const instances = new Map(), modules = new Map(), stubs = new Map(), effects = [], records = [];
  let active, tree, nextIdentity = 0;
  const calls = { saved: 0, reads: 0, uploads: 0, submission: 0 };
  let props = { tab: '추가 이미지', product: product('product-a'), settings: { minimumMarginEnabled: false, msrpMultiple: 1.3, roundingUnit: 10, roundingMode: 'ceil' },
    focusedOptionId: 'red', preferredProfileId: 'profile-a', onSaved() { calls.saved++; }, onUpload() { calls.uploads++; },
    onSavePrice: async () => {}, onManageCategories() {}, onBeforeFreeImageApply: () => true,
    onPrepareSubmission() { calls.submission++; }, onReviewPackaging() {}, ...initial };
  const hooks = {
    useState(initialValue) {
      const instance = active, slot = instance.index++;
      if (!(slot in instance.slots)) instance.slots[slot] = typeof initialValue === 'function' ? initialValue() : initialValue;
      return [instance.slots[slot], value => { if (instance.mounted) instance.slots[slot] = typeof value === 'function' ? value(instance.slots[slot]) : value; }];
    },
    useRef(value) { const slot = active.index++; return active.slots[slot] ?? (active.slots[slot] = { current: value }); },
    useCallback(fn, deps) { const slot = active.index++, old = active.slots[slot]; if (!old || deps.some((value, i) => !Object.is(value, old.deps[i]))) active.slots[slot] = { fn, deps }; return active.slots[slot].fn; },
    useMemo(fn) { return fn(); },
    useEffect(fn, deps) {
      const instance = active, slot = instance.index++, old = instance.slots[slot];
      if (!old || !deps || deps.some((value, i) => !Object.is(value, old.deps[i]))) {
        const entry = { deps, cleanup: old?.cleanup }; instance.slots[slot] = entry;
        effects.push(() => { entry.cleanup?.(); entry.cleanup = fn(); });
      }
    },
  };
  function componentModule(name) {
    if (!stubs.has(name)) {
      const child = received => {
        const [draft, setDraft] = hooks.useState(''), [saving, setSaving] = hooks.useState(false);
        const instance = active;
        records.push({ name, props: received, instance, ancestors: instance.ancestors, draft, saving, setDraft, setSaving });
        const step = name === 'option-image-editor' ? received.stage === 'detail' ? '상세 이미지' : '추가 이미지'
          : name === 'option-label-editor' ? '상품고시' : name === 'product-content-editor' ? '공통 자료' : '보조 편집';
        return { type: 'section', props: { 'data-child': name, 'data-quotation-source-step': step, 'data-workspace-dirty': !!draft, 'data-workspace-saving': saving,
          children: { type: 'input', props: { 'aria-label': name + ' retained draft', value: draft, onChange: event => setDraft(event.target.value) } } } };
      };
      child.displayName = name; stubs.set(name, child);
    }
    const component = stubs.get(name);
    return new Proxy({ __esModule: true, default: component }, { get(target, key) { return key in target ? target[key] : component; } });
  }
  function load(file) {
    if (modules.has(file)) return modules.get(file);
    const exports = {}; modules.set(file, exports);
    const source = fs.readFileSync(new URL('../' + file, import.meta.url), 'utf8') + (file.endsWith('dashboard-client.tsx') ? '\nexport { DetailPanel };' : '');
    vm.runInNewContext(ts.transpileModule(source, { fileName: file, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText,
      { exports, AbortController, URL, URLSearchParams, TextEncoder, TextDecoder, Date, Intl, crypto, structuredClone,
        fetch: async () => { calls.reads++; throw Error('Stage navigation must not send a request through DetailPanel.'); },
        window: { print() {}, setTimeout() {} }, require(name) {
          if (name === 'react') return hooks;
          if (name === 'react/jsx-runtime') return { jsx: (type, received, key) => ({ type, props: received, key }), jsxs: (type, received, key) => ({ type, props: received, key }), Fragment: 'fragment' };
          if (name.endsWith('.css')) return {};
          if (name.startsWith('@/app/components/')) return componentModule(name.split('/').at(-1));
          return name.startsWith('@/') ? load(name.slice(2) + '.ts') : native(name);
        } });
    return exports;
  }
  const DetailPanel = load('app/components/dashboard-client.tsx').DetailPanel;
  const guards = load('app/workspace-close.ts');
  function expand(value, path, ancestors, seen) {
    if (Array.isArray(value)) return value.map((child, i) => expand(child, path + '/' + (child?.key ?? i), ancestors, seen));
    if (!value || typeof value !== 'object') return value;
    if (typeof value.type === 'function') {
      const key = path + '/' + (value.type.displayName ?? value.type.name) + ':' + (value.key ?? '');
      let instance = instances.get(key);
      if (!instance) { instance = { identity: ++nextIdentity, slots: [], mounted: true }; instances.set(key, instance); }
      seen.add(key); instance.index = 0; instance.ancestors = ancestors; active = instance;
      return expand(value.type(value.props), key, ancestors, seen);
    }
    return { ...value, props: { ...value.props, children: expand(value.props?.children, path + '/children', [...ancestors, value], seen) } };
  }
  function render(patch = {}) {
    props = { ...props, ...patch }; records.length = 0; const seen = new Set();
    tree = expand({ type: DetailPanel, props }, 'root', [], seen);
    for (const [key, instance] of instances) if (!seen.has(key)) { instance.mounted = false; instance.slots.forEach(slot => slot?.cleanup?.()); instances.delete(key); }
    effects.splice(0).forEach(effect => effect()); return tree;
  }
  const record = (name, predicate = () => true) => { render(); const found = records.filter(row => row.name === name && predicate(row.props)); assert.equal(found.length, 1, 'Expected one ' + name); return found[0]; };
  const visible = row => !row.ancestors.some(element => element.props?.hidden === true);
  const matches = (node, selector) => { const [, key, value] = selector.match(/^\[([^=\]]+)(?:="([^"]+)")?\]$/); return value === undefined ? node.props?.[key] !== undefined : String(node.props?.[key]) === value; };
  const element = node => ({ getAttribute: key => node.props?.[key] === undefined ? null : String(node.props[key]), querySelector: selector => nodes(node.props?.children).find(child => matches(child, selector)) ?? null });
  const dom = () => ({ querySelector: selector => nodes(tree).find(node => matches(node, selector)) ?? null, querySelectorAll: selector => nodes(tree).filter(node => matches(node, selector)).map(element) });
  render();
  return { render, record, visible, calls, all(name) { render(); return records.filter(row => row.name === name); },
    edit(name, value, predicate) { record(name, predicate).setDraft(value); render(); }, busy(name, value, predicate) { record(name, predicate).setSaving(value); render(); },
    pending() { render(); return Array.from(guards.quotationSourceState(dom()).steps); },
    closeResult() { render(); return guards.requestWorkspaceClose(dom(), () => false); },
    close() { for (const instance of instances.values()) { instance.mounted = false; instance.slots.forEach(slot => slot?.cleanup?.()); } },
  };
}

test('separate selected image stages retain independent drafts while hidden across steps 4, 5 and 7', () => {
  const h = harness(); try {
    const byStage = stage => h.record('option-image-editor', received => received.stage === stage);
    const additional = byStage('additional'), detail = byStage('detail'); assert.notEqual(additional.instance, detail.instance);
    h.edit('option-image-editor', 'additional order', received => received.stage === 'additional');
    h.edit('option-image-editor', 'detail order and manual blank HTML', received => received.stage === 'detail');
    for (const tab of ['상세 이미지', '견적서', 'SEO', '표시사항', '추가 이미지']) {
      h.render({ tab }); assert.equal(h.all('option-image-editor').length, 2);
      for (const [stage, original, draft, visibleTab] of [['additional', additional, 'additional order', '추가 이미지'], ['detail', detail, 'detail order and manual blank HTML', '상세 이미지']]) {
        const image = byStage(stage); assert.equal(image.instance, original.instance); assert.equal(image.instance.mounted, true); assert.equal(image.draft, draft);
        assert.equal(image.props.stage, stage); assert.equal(h.visible(image), tab === visibleTab); assert.ok(!Object.hasOwn(image.props, 'onTranslate'));
      }
      assert.equal(h.closeResult(), 'cancel'); assert.ok(h.pending().includes('추가 이미지')); assert.ok(h.pending().includes('상세 이미지'));
    }
    h.busy('option-image-editor', true, received => received.stage === 'detail'); h.render({ tab: '가격' }); assert.equal(h.closeResult(), 'busy');
    assert.deepEqual(h.calls, { saved: 0, reads: 0, uploads: 0, submission: 0 });
  } finally { h.close(); }
});

test('selected image scope follows product, option, effective profile and the saved clock without leaking a previous draft', () => {
  const h = harness(); try {
    const byStage = stage => h.record('option-image-editor', received => received.stage === stage);
    const first = byStage('additional'), retainedDetail = byStage('detail');
    h.edit('option-image-editor', 'red-only', received => received.stage === 'additional'); h.edit('option-image-editor', 'unsaved detail', received => received.stage === 'detail');
    h.render({ product: { ...product('product-a'), updated_at: '2026-10-07T00:00:01.000Z' } });
    const clock = byStage('additional'); assert.equal(clock.instance, first.instance); assert.equal(clock.draft, 'red-only'); assert.equal(clock.props.version, '2026-10-07T00:00:01.000Z');
    clock.props.onSaved(); const saved = byStage('additional'); assert.equal(saved.instance, first.instance); assert.equal(saved.props.refreshToken, '1'); assert.equal(saved.draft, 'red-only'); assert.equal(h.calls.saved, 1);
    const detail = byStage('detail'); assert.equal(detail.instance, retainedDetail.instance); assert.equal(detail.draft, 'unsaved detail'); assert.equal(detail.props.refreshToken, '1'); assert.equal(detail.props.version, clock.props.version);
    h.render({ tab: '견적서' }); h.record('quotation-panel').props.onProfileChange('profile-b');
    const profile = byStage('additional'); assert.notEqual(profile.instance, first.instance); assert.equal(profile.draft, ''); assert.equal(profile.props.profileId, 'profile-b'); assert.equal(first.instance.mounted, false); assert.equal(retainedDetail.instance.mounted, false);
    assert.equal(byStage('detail').props.profileId, 'profile-b'); assert.equal(byStage('detail').draft, '');
    h.edit('option-image-editor', 'profile-b-only', received => received.stage === 'additional'); h.render({ focusedOptionId: 'blue' });
    const blue = byStage('additional'); assert.notEqual(blue.instance, profile.instance); assert.equal(blue.props.optionId, 'blue'); assert.equal(blue.draft, ''); assert.equal(profile.instance.mounted, false);
    h.render({ product: product('product-b'), preferredProfileId: 'profile-c' });
    const next = byStage('additional'); assert.notEqual(next.instance, blue.instance); assert.equal(next.props.productId, 'product-b'); assert.equal(next.props.profileId, 'profile-c'); assert.equal(next.props.optionId, 'blue'); assert.equal(next.draft, '');
    assert.equal(h.record('option-label-editor').props.profileId, 'profile-c'); assert.equal(h.calls.reads, 0);
  } finally { h.close(); }
});

test('common content keeps its draft across scoped image collapses and the open common step 6 editor', () => {
  const h = harness(); try {
    const common = h.record('product-content-editor'); h.edit('product-content-editor', 'shared content draft');
    for (const [tab, section, role, label] of [['추가 이미지', '이미지', 'additional', '추가 이미지'], ['상세 이미지', '이미지', 'detail', '상세 이미지'], ['표시사항', '표시사항', undefined, '표시사항'], ['SEO', 'SEO', undefined, 'SEO·설명']]) {
      h.render({ tab }); const current = h.record('product-content-editor'), collapse = current.ancestors.findLast(element => element.type === 'details');
      assert.equal(current.instance, common.instance); assert.equal(current.draft, 'shared content draft'); assert.equal(current.props.product.id, 'product-a');
      const scoped = tab !== '표시사항';
      assert.equal(current.props.section, section); assert.equal(current.props.focusedAssetRole, role); assert.equal(collapse.props.open, scoped ? undefined : true);
      assert.ok(nodes(collapse).some(node => node.type === 'summary' && node.props.hidden === !scoped && text(node) === '상품 공통 ' + label + ' 편집'));
    }
    h.render({ tab: '견적서' }); h.record('quotation-panel').props.onProfileChange('profile-b'); assert.equal(h.record('product-content-editor').instance, common.instance); assert.equal(h.record('product-content-editor').draft, 'shared content draft');
    h.render({ focusedOptionId: undefined, tab: '추가 이미지' }); const unscoped = h.record('product-content-editor');
    assert.equal(unscoped.instance, common.instance); assert.equal(unscoped.draft, 'shared content draft'); assert.equal(unscoped.ancestors.findLast(element => element.type === 'details').props.open, true);
    assert.equal(h.all('option-image-editor').length, 0); assert.equal(h.all('option-label-editor').length, 0); assert.equal(h.calls.reads, 0);
  } finally { h.close(); }
});

test('step 6 keeps common label tools separate from the selected Supplier Hub notices shown only in step 7', () => {
  const h = harness({ tab: '표시사항' }); try {
    const commonLabel = h.record('document-image-panel', received => received.section === 'label'), notices = h.record('option-label-editor');
    h.edit('document-image-panel', 'common PNG draft', received => received.section === 'label'); h.edit('option-label-editor', 'selected notice draft');
    assert.equal(h.visible(commonLabel), true); assert.equal(h.visible(notices), false); assert.equal(notices.props.productId, 'product-a'); assert.equal(notices.props.optionId, 'red'); assert.equal(notices.props.profileId, 'profile-a');
    const labelCollapse = commonLabel.ancestors.findLast(element => element.type === 'details'); assert.equal(labelCollapse.props.open, true); assert.ok(nodes(labelCollapse).some(node => node.type === 'summary' && text(node) === '상품 공통 표시사항 PNG 작성'));
    for (const tab of ['상세 이미지', '가격', 'SEO', '견적서', '표시사항']) {
      h.render({ tab }); const label = h.record('document-image-panel', received => received.section === 'label'), notice = h.record('option-label-editor');
      assert.equal(label.instance, commonLabel.instance); assert.equal(label.draft, 'common PNG draft'); assert.equal(h.visible(label), tab === '표시사항');
      assert.equal(notice.instance, notices.instance); assert.equal(notice.draft, 'selected notice draft'); assert.equal(h.visible(notice), tab === '견적서'); assert.equal(h.all('option-label-editor').length, 1);
      assert.ok(h.pending().includes('상품고시')); assert.equal(h.closeResult(), 'cancel');
    }
    assert.deepEqual(h.calls, { saved: 0, reads: 0, uploads: 0, submission: 0 });
  } finally { h.close(); }
});

test('scoped stage editors inherit image-processing exclusion without receiving an unsupported quote-only translation action', () => {
  const h = harness(); try {
    const additional = h.record('option-image-editor', received => received.stage === 'additional'), detail = h.record('option-image-editor', received => received.stage === 'detail');
    assert.ok(h.all('option-image-editor').every(image => image.props.disabled === false)); assert.equal(h.record('product-content-editor').props.imageProcessingBusy, false);
    h.record('free-image-translation-panel').props.onBusyChange(true); assert.ok(h.all('option-image-editor').every(image => image.props.disabled === true)); assert.equal(h.record('product-content-editor').props.imageProcessingBusy, true);
    h.render({ tab: '상세 이미지' }); assert.equal(h.record('option-image-editor', received => received.stage === 'additional').instance, additional.instance); assert.equal(h.record('option-image-editor', received => received.stage === 'detail').instance, detail.instance); assert.ok(h.all('option-image-editor').every(image => image.props.disabled === true));
    h.record('image-generation-panel').props.onBusyChange(true); h.record('free-image-translation-panel').props.onBusyChange(false); assert.ok(h.all('option-image-editor').every(image => image.props.disabled === true));
    h.record('image-generation-panel').props.onBusyChange(false); assert.ok(h.all('option-image-editor').every(image => image.props.disabled === false && !Object.hasOwn(image.props, 'onTranslate')));
    assert.deepEqual(plain(h.record('free-image-translation-panel').props.imageKeys), ['owner/product-a/a.png']); assert.equal(h.calls.reads, 0); assert.equal(h.calls.saved, 0);
  } finally { h.close(); }
});
