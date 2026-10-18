import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const nodes = tree => Array.isArray(tree) ? tree.flatMap(nodes) : tree && typeof tree === 'object' ? [tree, ...nodes(tree.props?.children)] : [];
function fixture() {
  const listeners = new Map(), doc = { activeElement: null, addEventListener(name, fn) { const list = listeners.get(name) ?? new Set(); list.add(fn); listeners.set(name, list); }, removeEventListener(name, fn) { listeners.get(name)?.delete(fn); } };
  class Element {
    constructor(tag = 'div', props = {}) { this.tag = tag; this.props = props; this.children = []; this.parentElement = null; this.inert = false; this.style = {}; this.isConnected = true; }
    append(...children) { for (const child of children) { child.parentElement = this; this.children.push(child); } }
    get tabIndex() { return this.props.tabIndex ?? (['button', 'input', 'select', 'textarea', 'summary', 'a'].includes(this.tag) ? 0 : -1); }
    get disabled() { return !!this.props.disabled; }
    hasAttribute(name) { return name === 'disabled' ? this.disabled : name === 'hidden' ? !!this.props.hidden : name === 'inert' ? this.inert : this.props[name] !== undefined; }
    closest() { return this.inert || this.props.hidden ? this : this.parentElement?.closest() ?? null; }
    getClientRects() { return this.closest() ? [] : [{}]; }
    contains(target) { return this === target || this.children.some(child => child.contains(target)); }
    querySelectorAll() { return this.children.flatMap(child => [child, ...child.querySelectorAll()]).filter(child => ['button', 'a', 'input', 'select', 'textarea', 'summary'].includes(child.tag) || child.props.tabIndex !== undefined || child.props.contentEditable === 'true'); }
    focus() { doc.activeElement = this; for (const fn of listeners.get('focusin') ?? []) fn({ target: this }); }
  }
  const body = new Element('body'), nav = new Element('nav'), holder = new Element(), sibling = new Element(), oldInert = new Element(), trigger = new Element('button');
  doc.body = body; oldInert.inert = true; nav.append(trigger); body.append(nav, holder, oldInert); holder.append(sibling); trigger.focus();
  const slots = [], layouts = [], dom = new Map(); let cursor = 0, changed = false, count = 0, allowed = true;
  const hooks = { useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = { value: typeof initial === 'function' ? initial() : initial }; return [slots[i].value, value => { slots[i].value = typeof value === 'function' ? value(slots[i].value) : value; changed = true; }]; },
    useRef(value) { const i = cursor++; return slots[i] ?? (slots[i] = { current: value }); }, useLayoutEffect(fn, deps) { const i = cursor++, before = slots[i]; if (!before || deps.some((value, index) => !Object.is(value, before.deps[index]))) { const next = { deps }; slots[i] = next; layouts.push(() => { before?.cleanup?.(); next.cleanup = fn(); }); } } };
  const exports = {}, jsx = (type, props) => ({ type, props });
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../app/components/detail-image-edit-dialog.tsx', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText,
    { exports, document: doc, HTMLElement: Element, require(name) { if (name === 'react') return hooks; if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx }; throw Error(name); } });
  const child = { type: 'input', props: { 'aria-label': 'retained editor', value: 'draft' } }, tail = { type: 'button', props: { children: 'last control' } };
  let props = { children: [child, tail], open: false, modal: true, identity: 'product:option:version1', canClose: () => allowed, onClose: () => count++ }, tree;
  function build(node, at = 'root') {
    if (!node || typeof node !== 'object') return null; const item = dom.get(at) ?? new Element(node.type); dom.set(at, item); item.props = node.props; item.children = [];
    // Model native disabled-control blur: activeElement falls back to BODY without
    // dispatching focusin, so the modal's focusin listener cannot repair it alone.
    if (doc.activeElement === item && item.disabled) doc.activeElement = body;
    if (node.props.ref) node.props.ref.current = item;
    const children = Array.isArray(node.props.children) ? node.props.children.flat(Infinity) : [node.props.children];
    children.forEach((entry, index) => { const next = build(entry, at + '/' + index); if (next) item.append(next); }); return item;
  }
  function render(patch = {}) {
    props = { ...props, ...patch }; let turns = 0;
    do { changed = false; cursor = 0; tree = exports.DetailImageEditDialog(props); const root = build(tree); holder.children = [sibling]; holder.append(root); layouts.splice(0).forEach(fn => fn()); if (++turns > 5) throw Error('render loop'); } while (changed);
    return tree;
  }
  const control = label => nodes(tree).find(node => node.props?.['aria-label'] === label), element = label => [...dom.values()].find(item => item.props?.['aria-label'] === label);
  function event(name, extra = {}) { const value = { key: '', target: doc.activeElement, prevented: false, stopped: false, preventDefault() { this.prevented = true; }, stopPropagation() { this.stopped = true; }, ...extra }; for (const fn of listeners.get(name) ?? []) fn(value); return value; }
  render();
  return { render, control, element, event, doc, nav, sibling, oldInert, trigger, child, get tree() { return tree; }, get closes() { return count; }, setAllowed(value) { allowed = value; }, close() { for (const slot of slots) slot?.cleanup?.(); }, listenerCount: () => [...listeners.values()].reduce((sum, list) => sum + list.size, 0) };
}

test('Stage5 presentation retains the same editor node, traps focus and restores navigation and the exact trigger', () => {
  const h = fixture(), input = h.element('retained editor');
  try {
    assert.equal(h.tree.props.hidden, true); assert.equal(h.listenerCount(), 0);
    h.render({ open: true }); assert.equal(h.element('retained editor'), input); assert.equal(input.props.value, 'draft');
    assert.equal(h.nav.inert, true); assert.equal(h.sibling.inert, true); assert.equal(h.oldInert.inert, true); assert.equal(h.doc.body.style.overflow, 'hidden');
    assert.equal(h.doc.activeElement, h.element('이미지 편집 닫기')); assert.equal(h.control('이미지 편집').props['aria-modal'], true);
    const last = h.element('이미지 편집').querySelectorAll().at(-1); last.focus(); const tab = h.event('keydown', { key: 'Tab' }); assert.equal(tab.prevented, true); assert.equal(h.doc.activeElement, h.element('이미지 편집 닫기'));
    const reverse = h.event('keydown', { key: 'Tab', shiftKey: true }); assert.equal(reverse.prevented, true); assert.equal(h.doc.activeElement, last);
    h.trigger.focus(); assert.notEqual(h.doc.activeElement, h.trigger, 'outside programmatic focus is returned to this dialog');
    h.render({ open: false }); assert.equal(h.element('retained editor'), input); assert.equal(h.nav.inert, false); assert.equal(h.sibling.inert, false); assert.equal(h.oldInert.inert, true); assert.equal(h.doc.activeElement, h.trigger); assert.equal(h.listenerCount(), 0);
  } finally { h.close(); }
});

test('Escape, close button and backdrop consult the current close guard and do not close the parent workspace', () => {
  const h = fixture();
  try {
    h.render({ open: true }); const button = h.control('이미지 편집 닫기').props.onClick; h.setAllowed(false);
    const escape = h.event('keydown', { key: 'Escape' }); assert.equal(escape.prevented, true); assert.equal(escape.stopped, true); assert.equal(h.closes, 0);
    button(); assert.equal(h.closes, 0); let stopped = false; h.tree.props.onMouseDown({ target: {}, currentTarget: {}, stopPropagation() { stopped = true; } }); assert.equal(h.closes, 0); assert.equal(stopped, true);
    h.setAllowed(true); button(); assert.equal(h.closes, 1); h.event('keydown', { key: 'Escape' }); assert.equal(h.closes, 2);
    const target = {}; h.tree.props.onMouseDown({ target, currentTarget: target, stopPropagation() {} }); assert.equal(h.closes, 3);
  } finally { h.close(); }
});

test('busy or dirty rendering blocks every close route and stale source callbacks cannot close a later identity', () => {
  const h = fixture();
  try {
    h.render({ open: true }); const old = h.control('이미지 편집 닫기').props.onClick;
    h.render({ blocked: true }); assert.equal(h.control('이미지 편집 닫기').props.disabled, true); old(); h.event('keydown', { key: 'Escape' }); assert.equal(h.closes, 0);
    h.render({ blocked: false, identity: 'product:option:version2' }); old(); assert.equal(h.closes, 0); h.control('이미지 편집 닫기').props.onClick(); assert.equal(h.closes, 1);
    assert.equal(h.element('retained editor').props.value, 'draft');
  } finally { h.close(); }
});

test('disabling the focused close control during async loading keeps focus inside through busy and idle commits', () => {
  const h = fixture(), input = h.element('retained editor');
  try {
    h.render({ open: true }); assert.equal(h.doc.activeElement, h.element('이미지 편집 닫기'));
    h.render({ blocked: true, children: [{ ...h.child, props: { ...h.child.props, disabled: true } }, { type: 'button', props: { disabled: true, children: 'loading' } }] });
    const busyFocus = h.doc.activeElement; h.event('keydown', { key: 'Escape' }); assert.equal(h.closes, 0);
    assert.equal(h.nav.inert, true); assert.equal(h.sibling.inert, true);
    h.render({ blocked: false });
    assert.equal(h.element('이미지 편집').contains(h.doc.activeElement), true, 'async loading must not leave focus on BODY after becoming idle');
    assert.equal(busyFocus, h.element('이미지 편집'), 'a disabled focused close button falls back to the dialog while all controls are busy');
    assert.equal(h.element('retained editor'), input); assert.equal(input.props.value, 'draft');
    h.setAllowed(false); h.event('keydown', { key: 'Escape' }); h.control('이미지 편집 닫기').props.onClick(); assert.equal(h.closes, 0);
    h.render({ open: false }); assert.equal(h.doc.activeElement, h.trigger); assert.equal(h.nav.inert, false); assert.equal(h.listenerCount(), 0);
  } finally { h.close(); }
});

test('busy changes preserve an enabled editor focus and recover silent outside focus without moving it to a background stage', () => {
  const h = fixture(), input = h.element('retained editor');
  try {
    h.render({ open: true }); input.focus(); h.render({ blocked: true }); assert.equal(h.doc.activeElement, input);
    h.render({ blocked: false }); assert.equal(h.doc.activeElement, input, 'do not steal focus from a usable editor control');
    h.doc.activeElement = h.doc.body; h.render({ blocked: true });
    assert.equal(h.doc.activeElement, h.element('이미지 편집')); assert.equal(h.nav.inert, true); assert.notEqual(h.doc.activeElement, h.trigger);
    h.render({ blocked: false }); assert.equal(h.doc.activeElement, h.element('이미지 편집')); assert.equal(h.closes, 0);
  } finally { h.close(); }
});

test('background pointer events are blocked, editor events remain available, and unmount removes every listener', () => {
  const h = fixture();
  h.render({ open: true }); assert.equal(h.event('click', { target: h.trigger }).stopped, true); assert.equal(h.event('pointerdown', { target: h.trigger }).prevented, true);
  assert.equal(h.event('click', { target: h.element('retained editor') }).prevented, false); h.close(); assert.equal(h.listenerCount(), 0); assert.equal(h.nav.inert, false); assert.equal(h.oldInert.inert, true); assert.equal(h.doc.activeElement, h.trigger);
});

test('Stage3 and Stage4 remain inline with no dialog role, navigation lock or event handlers', () => {
  const h = fixture(), input = h.element('retained editor');
  try {
    h.render({ modal: false, open: true }); assert.equal(h.tree.props.hidden, false); assert.equal(h.tree.props['data-workspace-saving'], undefined);
    assert.equal(nodes(h.tree).some(node => node.props?.role === 'dialog'), false); assert.equal(h.tree.props.onMouseDown, undefined); assert.equal(h.listenerCount(), 0); assert.equal(h.nav.inert, false); assert.equal(h.element('retained editor'), input);
  } finally { h.close(); }
});

test('closed wrapper does not conceal dirty children, while self-apply ignores only existing free-image markers', () => {
  const h = fixture(), exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../app/workspace-close.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, { exports });
  const free = { type: 'section', props: { 'data-free-image-editor': 'true', 'data-workspace-dirty': 'true' } }, peer = { type: 'section', props: { 'data-workspace-dirty': 'true' } };
  const root = extra => ({ querySelector(selector) { return [...nodes(h.tree), ...extra].find(node => {
    const [, field] = selector.match(/^\[([^=]+)="true"\]/); return String(node.props?.[field]) === 'true' && (!selector.includes(':not([data-free-image-editor])') || node.props?.['data-free-image-editor'] === undefined);
  }) ?? null; } });
  try {
    h.render({ children: free }); assert.equal(exports.workspaceEditState(root([])).dirty, true); assert.equal(exports.workspaceEditState(root([]), true).dirty, false);
    assert.equal(exports.workspaceEditState(root([peer]), true).dirty, true); assert.equal(exports.workspaceEditState(root([])).busy, false);
    h.render({ open: true }); assert.equal(exports.workspaceEditState(root([])).busy, true); assert.equal(exports.workspaceEditState(root([]), true).busy, false);
    assert.equal(exports.workspaceEditState(root([{ type: 'section', props: { 'data-workspace-saving': 'true' } }]), true).busy, true);
  } finally { h.close(); }
});
