import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import ts from 'typescript';

const native = createRequire(import.meta.url);
const nodes = tree => Array.isArray(tree) ? tree.flatMap(nodes) : tree && typeof tree === 'object' ? [tree, ...nodes(tree.props?.children)] : [];
const text = tree => typeof tree === 'string' || typeof tree === 'number' ? String(tree) : Array.isArray(tree) ? tree.map(text).join('') : tree?.props ? text(tree.props.children) : '';
const plain = value => JSON.parse(JSON.stringify(value));

function harness() {
  const cache = new Map(), slots = []; let cursor = 0, requests = 0;
  const hooks = { useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = initial; return [slots[i], value => { slots[i] = typeof value === 'function' ? value(slots[i]) : value; }]; } };
  function load(file) {
    if (cache.has(file)) return cache.get(file);
    const exports = {}; cache.set(file, exports);
    const output = ts.transpileModule(fs.readFileSync(new URL('../' + file, import.meta.url), 'utf8'), { fileName: file,
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
    vm.runInNewContext(output, { exports, Error, structuredClone, TextEncoder, URLSearchParams, AbortController, fetch() { requests++; throw Error('Unexpected request'); }, require(name) {
      if (name === 'react') return hooks;
      if (name.endsWith('.css')) return {};
      if (name.startsWith('@/')) { const path = name.slice(2); return load(path + (fs.existsSync(new URL('../' + path + '.ts', import.meta.url)) ? '.ts' : '.tsx')); }
      if (name === 'react/jsx-runtime') return native(name);
      throw Error(name);
    } });
    return exports;
  }
  const Component = load('app/components/quotation-exposed-duplicates.tsx').QuotationExposedDuplicates;
  const editor = load('app/components/quotation-fields-editor.tsx');
  return { render(props) { cursor = 0; return Component(props); }, editor, requests: () => requests };
}

function fixture(count = 4) {
  const fields = ['color', 'size'].map(id => ({ id, label: id === 'color' ? '색상' : '사이즈', section: 'product', visibility: 'exposed', type: 'text', required: true }));
  const cell = value => ({ value, source: 'option', needsReview: false, issues: [], validationIssues: [], reviewMessages: [] });
  const rows = [{ optionId: null, optionLabel: '공통', included: false, fields: { color: cell('공통 색상'), size: cell('공통 크기') } },
    ...Array.from({ length: count }, (_, i) => ({ optionId: `option-${i}`, optionLabel: `옵션 ${i + 1}`, included: true,
      fields: { color: cell(i < 2 ? '빨강' : '파랑'), size: cell('M') } }))];
  const resolved = { schema: { version: 1, categoryId: '80719', categoryPath: ['검사'], status: 'observed', fields }, rows, issues: [] };
  return { resolved, automatic: plain(resolved), overrides: { common: {}, options: {} }, imageKeys: [] };
}

const props = (view, onOpen = () => {}, disabled = false) => ({ resolved: view.resolved,
  readValue: (id, field) => view.resolved.rows.find(row => row.optionId === id).fields[field].value, onOpen, disabled });

test('comparison displays exact values and each option opens its own product attribute by UUID', () => {
  const h = harness(), view = fixture(), opened = [], before = JSON.stringify(view), p = props(view, (...args) => opened.push(args));
  p.numbers = { 'option-0': '261015001001', 'option-1': '261015001002' };
  const tree = h.render(p), elements = nodes(tree);
  assert.match(text(tree), /2개 그룹 · 4개 옵션/); assert.match(text(tree), /261015001001 · 옵션 1/);
  assert.equal(elements.filter(node => node.type === 'tr').length, 3);
  assert.deepEqual(elements.filter(node => node.type === 'td').map(node => text(node)), ['빨강', 'M']);
  for (const button of elements.filter(node => node.type === 'button')) button.props.onClick();
  assert.deepEqual(opened, [['option-0', 'color'], ['option-1', 'color']]);
  assert.equal(JSON.stringify(view), before); assert.equal(h.requests(), 0);
});

test('group selection shows the selected pair and vanished groups fall back to a current group', () => {
  const h = harness(), view = fixture(), opened = [], p = props(view, (...args) => opened.push(args));
  const select = nodes(h.render(p)).find(node => node.type === 'select');
  select.props.onChange({ target: { value: JSON.stringify(['option-2', 'option-3']) } });
  let tree = h.render(p); assert.equal(nodes(tree).filter(node => node.type === 'td')[0].props.children, '파랑');
  nodes(tree).find(node => node.type === 'button').props.onClick(); assert.deepEqual(opened, [['option-2', 'color']]);
  view.resolved.rows[4].fields.color.value = '검정';
  tree = h.render(p); assert.match(text(tree), /1개 그룹 · 2개 옵션/);
  assert.equal(nodes(tree).filter(node => node.type === 'td')[0].props.children, '빨강');
  assert.equal(nodes(tree).find(node => node.type === 'select').props.value, JSON.stringify(['option-0', 'option-1']));
  assert.equal(h.requests(), 0);
});

test('real editor cells compare unsaved common inheritance, option blanks and reset to saved automatic values', () => {
  const h = harness(), view = fixture(2), before = JSON.stringify(view), draft = [];
  const p = { ...props(view), readValue: (id, field) => h.editor.resolveQuotationEditorCell(view, draft, id, field).value };
  assert.match(text(h.render(p)), /1개 그룹/);
  draft.push({ optionId: 'option-0', fieldKey: 'color', value: '' }); assert.equal(h.render(p), null);
  draft.push({ optionId: 'option-1', fieldKey: 'color', value: '' });
  assert.equal(nodes(h.render(p)).find(node => node.type === 'td').props.children, '(공란)');
  draft.splice(0, draft.length, { optionId: null, fieldKey: 'color', value: '  공통 입력  ' });
  assert.equal(nodes(h.render(p)).find(node => node.type === 'td').props.children, '  공통 입력  ');
  draft.push({ optionId: 'option-0', fieldKey: 'color', value: null });
  assert.equal(nodes(h.render(p)).find(node => node.type === 'td').props.children, '  공통 입력  ', 'an option reset still inherits the common layer');
  draft.splice(0, draft.length, { optionId: 'option-0', fieldKey: 'color', value: null }, { optionId: 'option-1', fieldKey: 'color', value: '파랑' });
  assert.equal(h.render(p), null, 'reset to automatic differs from the other option draft');
  assert.equal(JSON.stringify(view), before); assert.equal(h.requests(), 0);
});

test('excluded, unique and unavailable comparisons do not create false duplicate panels', () => {
  const h = harness(), view = fixture(2), p = props(view);
  view.resolved.rows[2].included = false; assert.equal(h.render(p), null);
  view.resolved.rows[2].included = true; view.resolved.rows[2].fields.size.value = 'L'; assert.equal(h.render(p), null);
  view.resolved.rows[2].fields.size.value = 'M'; view.resolved.schema.status = 'unconfirmed'; assert.equal(h.render(p), null);
  view.resolved.schema.status = 'observed'; delete view.resolved.rows[1].fields.color; assert.equal(h.render(p), null);
  assert.equal(h.requests(), 0);
});

test('disabled comparison actions cannot navigate or change the selected group', () => {
  const h = harness(), view = fixture(), opened = [], p = props(view, (...args) => opened.push(args), true);
  const tree = h.render(p), select = nodes(tree).find(node => node.type === 'select');
  assert.equal(select.props.disabled, true); select.props.onChange({ target: { value: JSON.stringify(['option-2', 'option-3']) } });
  for (const button of nodes(tree).filter(node => node.type === 'button')) { assert.equal(button.props.disabled, true); button.props.onClick(); }
  assert.deepEqual(opened, []); assert.equal(nodes(h.render(p)).find(node => node.type === 'select').props.value, JSON.stringify(['option-0', 'option-1']));
  assert.equal(h.requests(), 0);
});

test('200 option comparison renders only one selected group attribute table', () => {
  const h = harness(), view = fixture(200);
  for (const [index, row] of view.resolved.rows.entries()) if (row.optionId) row.fields.color.value = `색상 ${Math.floor((index - 1) / 2)}`;
  const tree = h.render(props(view)), elements = nodes(tree);
  assert.match(text(tree), /100개 그룹 · 200개 옵션/);
  assert.equal(elements.filter(node => node.type === 'option').length, 100);
  assert.equal(elements.filter(node => node.type === 'button').length, 2);
  assert.equal(elements.filter(node => node.type === 'tr').length, 3);
  assert.equal(h.requests(), 0);
});
