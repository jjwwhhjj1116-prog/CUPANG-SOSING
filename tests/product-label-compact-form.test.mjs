import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import ts from 'typescript';
import { createRequire } from 'node:module';
import { webcrypto } from 'node:crypto';

// Reuse only declarations: these cases execute the real component with the
// existing synthetic CAS/render boundary and never register the older suite.
const url = new URL('./product-label-editor.test.mjs', import.meta.url), source = fs.readFileSync(url, 'utf8');
const ast = ts.createSourceFile(url.pathname, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS), parts = [];
for (const statement of ast.statements) {
  if (ts.isImportDeclaration(statement)) continue;
  if (ts.isExpressionStatement(statement) && ts.isCallExpression(statement.expression) && statement.expression.expression.getText(ast) === 'test') break;
  parts.push(statement.getText(ast));
}
const helper = parts.join('\n').replaceAll('import.meta.url', JSON.stringify(url.href))
  .replace('{exports,Error,AbortController', '{exports,crypto:webcrypto,Error,AbortController');
const { editor, fixture, nodes, text } = vm.runInNewContext(helper + '\n({editor,fixture,nodes,text})',
  { assert, fs, vm, path, ts, createRequire, webcrypto, Response, Blob, JSON, URL, Date, AbortController, structuredClone, TextEncoder, setImmediate, setTimeout, clearTimeout });
const plain = value => JSON.parse(JSON.stringify(value));
function ancestors(tree, target, trail = []) {
  if (tree === target) return trail;
  if (Array.isArray(tree)) { for (const child of tree) { const found = ancestors(child, target, trail); if (found) return found; } }
  else if (tree && typeof tree === 'object') return ancestors(tree.props?.children, target, [...trail, tree]);
  return null;
}
const find = (h, label) => nodes(h.render()).find(node => node.props?.['aria-label'] === label);
const disclosures = h => nodes(h.render()).filter(node => node.type === 'details' && ['product-label-row-tools', 'product-label-extra-tools'].includes(node.props.className));
const mutations = h => h.calls.filter(call => call.init?.method && call.init.method !== 'GET');

test('single-line rows expose one caption/value and visible delete while optional controls are initially closed', async () => {
  const f = fixture(), before = plain(f.view), h = editor((url, init) => f.reply(url, init));
  try {
    await h.idle(); const tree = h.render(), rows = nodes(tree).filter(node => node.props?.['data-label-sort-id']);
    assert.equal(rows.length, 9); assert.equal(disclosures(h).length, 10);
    assert.ok(disclosures(h).every(node => node.props.open !== true));
    for (const row of rows) {
      const value = nodes(row).find(node => node.props?.className === 'product-label-value-input');
      assert.equal(value.type, 'input'); assert.equal(value.props.type, 'text');
      const label = ancestors(row, value).findLast(node => node.type === 'label');
      assert.equal(nodes(label).some(node => node.type === 'span'), false, 'caption is not repeated above the input');
      const remove = nodes(row).find(node => node.props?.className?.includes('product-label-delete'));
      assert.ok(remove); assert.equal(ancestors(row, remove).some(node => node.type === 'details'), false);
      for (const arrow of nodes(row).filter(node => node.type === 'button' && ['↑', '↓'].includes(text(node))))
        assert.equal(ancestors(row, arrow).findLast(node => node.type === 'details')?.props.className, 'product-label-row-tools');
    }
    const requiredDelete = find(h, '선택 옵션 표시사항 항목 1 삭제');
    assert.equal(requiredDelete.props.disabled, true); requiredDelete.props.onClick();
    assert.equal(nodes(h.render()).filter(node => node.props?.['data-label-sort-id']).length, 9);
    assert.equal(h.render().props['data-workspace-dirty'], false);
    assert.equal(mutations(h).length, 0); assert.deepEqual(plain(f.view), before);
  } finally { h.close(); }
});

test('stored CRLF text opens losslessly as multiline and stays multiline while the last line break is edited away', async () => {
  const f = fixture(), original = '검토한 재질\r\n두 번째 줄\n세 번째 줄', row = f.view.rows.find(row => row.optionId === 'red');
  f.view.overrides.options.red.material = original; row.values.material = original; row.sources.material = 'manual-option';
  const before = plain(f.view), h = editor((url, init) => f.reply(url, init));
  try {
    await h.idle(); assert.equal(h.input('선택 옵션 원료명 및 성분명(재질)').type, 'textarea');
    assert.equal(h.input('선택 옵션 원료명 및 성분명(재질)').props.value, original);
    const collapse = find(h, '선택 옵션 원료명 및 성분명(재질) 한 줄로 편집');
    assert.equal(collapse.props.disabled, true); collapse.props.onClick();
    assert.equal(h.input('선택 옵션 원료명 및 성분명(재질)').type, 'textarea');
    h.edit('선택 옵션 원료명 및 성분명(재질)', '줄바꿈을 정리한 내용');
    assert.equal(h.input('선택 옵션 원료명 및 성분명(재질)').type, 'textarea');
    assert.equal(h.input('선택 옵션 원료명 및 성분명(재질)').props.value, '줄바꿈을 정리한 내용');
    assert.equal(mutations(h).length, 0); assert.deepEqual(plain(f.view), before);
  } finally { h.close(); }
});

test('optional multiline editing stages and explicitly saves exact newlines without changing other option values', async () => {
  const f = fixture(), other = plain(f.view.rows.find(row => row.optionId === 'blue')), h = editor((url, init) => f.reply(url, init));
  try {
    await h.idle(); const label = '선택 옵션 내용량', expand = find(h, label + ' 여러 줄로 편집');
    const tree = h.render(), target = nodes(tree).find(node => node.props?.['aria-label'] === label + ' 여러 줄로 편집');
    assert.equal(ancestors(tree, target).findLast(node => node.type === 'details').props.open, undefined);
    expand.props.onClick(); assert.equal(h.input(label).type, 'textarea');
    const value = '검토한 한 세트\n단품 두 개'; h.edit(label, value);
    assert.equal(h.input(label).props.value, value); assert.equal(mutations(h).length, 0);
    await h.click('정보 저장하기');
    assert.equal(mutations(h).length, 1); assert.equal(h.saved, 1);
    assert.equal(f.view.overrides.options.red.netContents, value);
    assert.deepEqual(plain(f.view.rows.find(row => row.optionId === 'blue')), other);
  } finally { h.close(); }
});

test('disclosed clear and restore retain their confirmation/draft semantics and required caption editing remains available', async () => {
  const f = fixture(), before = plain(f.view), h = editor((url, init) => f.reply(url, init));
  try {
    await h.idle(); const label = '선택 옵션 제조원';
    const tree = h.render(), clear = nodes(tree).find(node => node.type === 'button' && text(node) === '제조원 비우기');
    assert.equal(ancestors(tree, clear).findLast(node => node.type === 'details').props.open, undefined);
    await h.click('제조원 비우기'); assert.equal(h.input(label).props.value, '');
    await h.click('제조원 공통·자동값 복원'); assert.equal(h.input(label).props.value, before.rows.find(row => row.optionId === 'red').automatic.manufacturer);
    assert.equal(find(h, '선택 옵션 표시사항 항목 1 이름 편집').props.disabled, false);
    assert.equal(find(h, '선택 옵션 표시사항 항목 1 삭제').props.disabled, true);
    assert.equal(mutations(h).length, 0); assert.deepEqual(plain(f.view), before);
  } finally { h.close(); }
});

test('retained multiline callbacks cannot change a different option or a closed editor', async () => {
  const f = fixture(), h = editor((url, init) => f.reply(url, init));
  try {
    await h.idle(); const old = find(h, '선택 옵션 제조원 여러 줄로 편집').props.onClick;
    h.select('blue'); await h.idle(); old();
    assert.equal(h.input('선택 옵션 제조원').type, 'input'); assert.equal(mutations(h).length, 0);
    const closed = find(h, '선택 옵션 제조원 여러 줄로 편집').props.onClick;
    h.close(); closed(); assert.equal(h.lateWrites, 0);
  } finally { h.close(); }
});
