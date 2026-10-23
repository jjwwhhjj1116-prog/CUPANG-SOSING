import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { createRequire } from 'node:module';
import { fixture, panel, nodes, plain } from './helpers/detail-workspace.mjs';
const native = createRequire(import.meta.url);
function dashboard() {
  const slots = [], layouts = [], cache = new Map(), stubs = new Map(); let cursor = 0, changed = false, requests = 0;
  const effect = (fn, deps) => { const i = cursor++, before = slots[i]; if (!before || !deps || deps.some((value, index) => !Object.is(value, before.deps?.[index]))) { const next = { deps }; slots[i] = next; layouts.push(() => { before?.cleanup?.(); next.cleanup = fn(); }); } };
  const hooks = { useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = { value: typeof initial === 'function' ? initial() : initial }; return [slots[i].value, value => { slots[i].value = typeof value === 'function' ? value(slots[i].value) : value; changed = true; }]; },
    useRef(value) { const i = cursor++; return slots[i] ?? (slots[i] = { current: value }); }, useMemo(fn, deps) { const i = cursor++, before = slots[i]; if (!before || deps.some((value, index) => !Object.is(value, before.deps[index]))) slots[i] = { deps, value: fn() }; return slots[i].value; }, useCallback(fn, deps) { return hooks.useMemo(() => fn, deps); }, useEffect: effect, useLayoutEffect: effect };
  function component(name) { if (!stubs.has(name)) { const fn = () => null; Object.defineProperty(fn, 'name', { value: name }); stubs.set(name, fn); } return stubs.get(name); }
  function load(file) {
    if (cache.has(file)) return cache.get(file); const exports = {}; cache.set(file, exports); let source = fs.readFileSync(new URL('../' + file, import.meta.url), 'utf8');
    if (file.endsWith('dashboard-client.tsx')) source += '\nexport {DetailPanel};';
    vm.runInNewContext(ts.transpileModule(source, { fileName: file, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText,
      { exports, AbortController, TextEncoder, crypto, fetch() { requests++; throw Error('External request forbidden'); }, require(name) { if (name === 'react') return hooks; if (name === 'react/jsx-runtime') return { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) };
        if (name.startsWith('@/app/components/')) return new Proxy({}, { get: (_, key) => component(name + ':' + String(key)) }); return name.startsWith('@/') ? load(name.slice(2) + '.ts') : native(name); } }); return exports;
  }
  const Detail = load('app/components/dashboard-client.tsx').DetailPanel;
  let props = { product: { id: 'p', updated_at: '2026-10-18T00:00:00.000Z', image_keys: '["owner/a.png"]' }, settings: {}, tab: '상세 이미지', focusedOptionId: 'red', preferredProfileId: 'profile', onSaved() {}, onUpload() {}, onBeforeFreeImageApply: () => true };
  let tree; function render(patch = {}) { props = { ...props, ...patch }; let turns = 0; do { changed = false; cursor = 0; tree = Detail(props); layouts.splice(0).forEach(fn => fn()); if (++turns > 6) throw Error('render loop'); } while (changed); return tree; }
  const child = suffix => nodes(tree).find(node => typeof node.type === 'function' && node.type.name.endsWith(':' + suffix));
  render(); return { render, child, card: () => nodes(tree).find(node => node.type?.name?.endsWith(':OptionImageEditor') && node.props.stage === 'detail'),
    genericEntry: () => nodes(tree).find(node => node.props?.className === 'image-stage-editor-entry')?.props.children,
    dialog: () => child('DetailImageEditDialog'), editor: () => nodes(tree).find(node => node.props?.quotationContext && Object.hasOwn(node.props, 'onCloseGuard')), get requests() { return requests; }, close() { slots.forEach(slot => slot?.cleanup?.()); } };
}
const target = { kind: 'quotation', profileId: 'profile', optionId: 'red', input: 'detailImages', fieldKey: 'detail', slotIndex: 0, revision: 3, inputFingerprint: 'a'.repeat(64), optionRevision: 2, value: 'owner/a.png' };

for (const [tab,role] of [['대표 이미지','main'],['추가 이미지','additional'],['상세 이미지','detail']]) test(`${tab}: generic entry explicitly carries its stage role without choosing an original or quotation slot`, () => {
  const h=dashboard();try{
    h.render({tab});h.editor().props.onCloseGuard(()=>true);h.genericEntry().props.onClick();h.render();
    assert.equal(h.dialog().props.open,true);assert.equal(h.editor().props.active,true);assert.equal(h.editor().props.editorEntry.role,role);
    assert.equal(h.editor().props.editorEntry.sequence,1);assert.equal(h.editor().props.translationTarget,undefined);assert.equal(h.requests,0);
  }finally{h.close();}
});

test('a later generic stage entry retires a completed card selection while the next exact card still retains its original quotation target', () => {
  const h=dashboard();try{
    h.card().props.onEdit('owner/a.png','detail',target);h.render();h.editor().props.onCloseGuard(()=>true);h.dialog().props.onClose();h.render();
    h.render({tab:'대표 이미지'});h.genericEntry().props.onClick();h.render();assert.equal(h.editor().props.translationTarget,undefined);assert.equal(h.editor().props.editorEntry.role,'main');
    h.dialog().props.onClose();h.render();const mainTarget={...target,input:'mainImage',fieldKey:'main',slotIndex:0};
    h.child('ProductOptionsEditor').props.onEdit('owner/a.png','main',mainTarget);h.render();
    assert.deepEqual(plain(h.editor().props.translationTarget.quotationTarget),mainTarget);assert.equal(h.editor().props.translationTarget.role,'main');assert.equal(h.requests,0);
  }finally{h.close();}
});

test('generic entry cannot retire a target while its retained editor guard is unavailable, dirty or uncertain', () => {
  const h=dashboard();try{
    h.genericEntry().props.onClick();h.render();assert.equal(h.dialog().props.open,false);
    h.editor().props.onCloseGuard(()=>false);h.genericEntry().props.onClick();h.render();assert.equal(h.dialog().props.open,false);
    h.editor().props.onCloseGuard(()=>true);h.editor().props.onEditingChange(true);h.genericEntry().props.onClick();h.render();assert.equal(h.dialog().props.open,false);
    h.editor().props.onEditingChange(false);h.genericEntry().props.onClick();h.render();assert.equal(h.dialog().props.open,true);assert.equal(h.editor().props.editorEntry.sequence,1);assert.equal(h.requests,0);
  }finally{h.close();}
});

test('retained generic-open callbacks cannot select a stage after stage or product-version ABA', () => {
  for(const boundary of ['stage','version']){const h=dashboard();try{
    h.render({tab:'대표 이미지'});h.editor().props.onCloseGuard(()=>true);const oldOpen=h.genericEntry().props.onClick;
    if(boundary==='stage'){h.render({tab:'추가 이미지'});h.render({tab:'대표 이미지'});}
    else{h.render({product:{id:'p',updated_at:'2026-10-18T00:00:01.000Z',image_keys:'["owner/a.png"]'}});h.render({product:{id:'p',updated_at:'2026-10-18T00:00:00.000Z',image_keys:'["owner/a.png"]'}});}
    oldOpen();h.render();assert.equal(h.dialog().props.open,false);assert.equal(h.editor().props.editorEntry,undefined);
    h.genericEntry().props.onClick();h.render();assert.equal(h.dialog().props.open,true);assert.equal(h.editor().props.editorEntry.role,'main');assert.equal(h.requests,0);
  }finally{h.close();}}
});

test('the actual Stage5 card callback opens the retained editor dialog with the exact quotation target and does not write', () => {
  const h = dashboard();
  try {
    const type = h.editor().type; assert.equal(h.dialog().props.open, false); assert.equal(h.editor().props.active, false);
    const edit = h.card().props.onEdit; edit('owner/a.png', 'detail', target); edit('owner/a.png', 'detail', { ...target, slotIndex: 1 }); h.render(); assert.equal(h.dialog().props.open, true); assert.equal(h.dialog().props.modal, true); assert.equal(h.card().props.disabled, true);
    assert.equal(h.editor().type, type); assert.equal(h.editor().props.active, true); assert.deepEqual(plain(h.editor().props.translationTarget.quotationTarget), target); assert.equal(h.editor().props.translationTarget.intent, 'manual');
    h.editor().props.onCloseGuard(() => true); h.dialog().props.onClose(); h.render(); assert.equal(h.dialog().props.open, false); assert.equal(h.editor().type, type); assert.equal(h.requests, 0);
  } finally { h.close(); }
});

test('dashboard close callbacks cannot discard same-tick edits, active I/O, pending recovery or an unregistered guard', () => {
  const h = dashboard();
  try {
    h.card().props.onEdit('owner/a.png', 'detail', target); h.render(); const oldClose = h.dialog().props.onClose, editor = h.editor();
    oldClose(); h.render(); assert.equal(h.dialog().props.open, true);
    editor.props.onCloseGuard(() => true); editor.props.onEditingChange(true); oldClose(); h.render(); assert.equal(h.dialog().props.open, true); assert.equal(h.dialog().props.blocked, true);
    editor.props.onEditingChange(false); editor.props.onBusyChange(true); oldClose(); h.render(); assert.equal(h.dialog().props.open, true);
    editor.props.onBusyChange(false); editor.props.onCloseGuard(() => false); oldClose(); h.render(); assert.equal(h.dialog().props.open, true, 'pending or uncertain save stays in the same editor');
    editor.props.onCloseGuard(() => true); oldClose(); h.render(); assert.equal(h.dialog().props.open, false); assert.equal(h.requests, 0);
  } finally { h.close(); }
});

test('all three image stages retain a closed modal and changing product version retains the original active edit target', () => {
  const h = dashboard();
  try {
    const type = h.editor().type;
    h.render({ tab: '대표 이미지' }); assert.equal(h.dialog().props.modal, true); assert.equal(h.editor().props.active, false); assert.equal(h.editor().type, type);
    h.render({ tab: '추가 이미지' }); assert.equal(h.dialog().props.modal, true); assert.equal(h.editor().props.active, false); assert.equal(h.editor().type, type);
    h.render({ tab: '상세 이미지' }); h.card().props.onEdit('owner/a.png', 'detail', target); h.render(); const identity = h.dialog().props.identity;
    h.render({ product: { id: 'p', updated_at: '2026-10-18T00:00:01.000Z', image_keys: '["owner/a.png"]' } });
    assert.notEqual(h.dialog().props.identity, identity); assert.equal(h.dialog().props.open, true); assert.equal(h.editor().type, type); assert.deepEqual(plain(h.editor().props.translationTarget.quotationTarget), target); assert.equal(h.requests, 0);
  } finally { h.close(); }
});

for (const role of ['detailTop', 'detail', 'detailBottom']) test(`the actual common ${role} translation callback opens Stage5 without inventing an option target`, () => {
  const h = dashboard();
  try {
    h.child('ProductContentEditor').props.onTranslateImage('owner/a.png', 'en', role); h.render();
    assert.equal(h.dialog().props.open, true); assert.equal(h.editor().props.active, true); assert.equal(h.editor().props.translationTarget.role, role);
    assert.equal(h.editor().props.translationTarget.sourceLanguage, 'en'); assert.equal(h.editor().props.translationTarget.quotationTarget, undefined);
    assert.equal(h.child('ProductContentEditor').props.imageProcessingBusy, true); assert.equal(h.requests, 0);
  } finally { h.close(); }
});

for (const tab of ['대표 이미지', '추가 이미지']) test(`common image callbacks in ${tab} open the retained modal, pin the target and enforce same-tick close guards without writing`, () => {
  const h = dashboard();
  try {
    h.render({ tab }); const type = h.editor().type;
    assert.equal(h.editor().props.active, false, 'a hidden editor cannot begin translation');
    const role = tab === '대표 이미지' ? 'main' : 'additional';
    h.child('ProductContentEditor').props.onTranslateImage('owner/a.png', 'zh', role); h.render();
    assert.equal(h.dialog().props.modal, true); assert.equal(h.dialog().props.open, true); assert.equal(h.editor().type, type); assert.equal(h.editor().props.active, true);
    assert.equal(h.editor().props.translationTarget.role, role); assert.equal(h.editor().props.translationTarget.sourceLanguage, 'zh');
    const close = h.dialog().props.onClose;
    close(); h.render(); assert.equal(h.dialog().props.open, true, 'unregistered guard cannot discard the edit');
    h.editor().props.onCloseGuard(() => true); h.editor().props.onEditingChange(true); close(); h.render(); assert.equal(h.dialog().props.open, true);
    h.editor().props.onEditingChange(false); h.editor().props.onBusyChange(true); close(); h.render(); assert.equal(h.dialog().props.open, true);
    h.editor().props.onBusyChange(false); close(); h.render(); assert.equal(h.dialog().props.open, false); assert.equal(h.editor().type, type); assert.equal(h.editor().props.active, false); assert.equal(h.requests, 0);
  } finally { h.close(); }
});

test('workspace photo editing uses the same modal and preserves the existing live close and save boundaries', async () => {
  const f = await fixture(), h = panel(f);
  const editor = () => nodes(h.render()).find(node => typeof node.type === 'function' && node.type.name === 'FreeImageTranslationPanel');
  const dialog = () => nodes(h.render()).find(node => typeof node.type === 'function' && node.type.name === 'DetailImageEditDialog');
  try {
    await h.idle(); await h.click('상세 편집 구성 열기'); await h.click('편집 구성 보관'); const writes = f.calls.filter(call => call.method !== 'GET').length;
    await h.click('작업 사진 2 편집'); const child = editor(), oldClose = dialog().props.onClose;
    assert.equal(dialog().props.open, true); assert.equal(dialog().props.canClose(), false); assert.equal(child.props.translationTarget.workspaceTarget.photoId, f.workspace.document.photos[1].id);
    child.props.onCloseGuard(() => true); child.props.onEditingChange(true); oldClose(); h.render(); assert.ok(editor()); assert.equal(dialog().props.blocked, true);
    child.props.onEditingChange(false); child.props.onBusyChange(true); oldClose(); h.render(); assert.ok(editor());
    child.props.onBusyChange(false); child.props.onCloseGuard(() => false); oldClose(); h.render(); assert.ok(editor());
    child.props.onCloseGuard(() => true); oldClose(); await h.idle(); assert.equal(editor(), undefined); assert.equal(h.adopted.length, 0); assert.equal(f.calls.filter(call => call.method !== 'GET').length, writes);
  } finally { h.close(); }
});
