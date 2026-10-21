import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { createRequire } from 'node:module';

// Reuse the real component harness declarations without registering its cases.
const url = new URL('./content-editor-requests.test.mjs', import.meta.url), source = fs.readFileSync(url, 'utf8');
const ast = ts.createSourceFile(url.pathname, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS), parts = [];
for (const statement of ast.statements) {
  if (ts.isImportDeclaration(statement)) continue;
  if (ts.isExpressionStatement(statement) && ts.isCallExpression(statement.expression) && statement.expression.expression.getText(ast) === 'test') break;
  parts.push(statement.getText(ast));
}
let helper = parts.join('\n').replaceAll('import.meta.url', JSON.stringify(url.href));
for (const [before, after] of [
  ['function harness(handle, focusedAssetRole, lifecycle=false, initialize=()=>{})', 'function harness(handle, focusedAssetRole, lifecycle=false, initialize=()=>{},autoFillLabel=true)'],
  ["section,focusedAssetRole,onSaved()", "section,autoFillLabel,focusedAssetRole,onSaved()"],
  ['return{render,button,model,load,', "return{render,button,model,load,setAutoFillLabel(value){autoFillLabel=value;return render('표시사항');},"],
]) { assert.ok(helper.includes(before), before); helper = helper.replace(before, after); }
const { harness, nodes, settle } = vm.runInNewContext(helper + '\n({harness,nodes,settle})',
  { assert, fs, vm, ts, createRequire, URL, AbortController, Response, structuredClone, TextEncoder, crypto, setImmediate });
const text = tree => Array.isArray(tree) ? tree.map(text).join('') : tree && typeof tree === 'object' ? text(tree.props?.children) : tree == null ? '' : String(tree);
const inputs = h => nodes(h.render('표시사항')).filter(node => node.type === 'textarea' && node.props.maxLength === 2000);
const field = (h, label) => {
  const wrapper = nodes(h.render('표시사항')).find(node => node.type === 'label' && nodes(node).some(child => child.type === 'span' && text(child).startsWith(label)) && nodes(node).some(child => child.type === 'textarea'));
  assert.ok(wrapper, label); return nodes(wrapper).find(node => node.type === 'textarea');
};
const dirty = h => nodes(h.render('표시사항')).find(node => node.props?.['data-quotation-source-step'] === '표시사항').props['data-workspace-dirty'];
const defaults = { settings: { manufacturer: '검토 제조사', importer: '검토 수입사', serviceContact: '검토 연락처' }, categoryId: '80719' };

test('disabled entry stays clean without reading label defaults, while the explicit fill button still stages a reviewable draft', async () => {
  const calls = [], h = harness((url, init) => { calls.push({url, init}); if (url.endsWith('/registration-settings')) return Response.json(defaults); }, undefined, true, () => {}, false);
  try {
    await h.start(); h.render('표시사항'); await h.flush(); h.render('표시사항'); await h.flush();
    assert.equal(calls.filter(call => call.url.endsWith('/registration-settings')).length, 0);
    assert.ok(inputs(h).every(input => input.props.value === '')); assert.equal(dirty(h), false);
    h.button('상품명·저장 기본설정으로 빈 표시사항 채우기', '표시사항').props.onClick(); await settle();
    assert.equal(calls.filter(call => call.url.endsWith('/registration-settings')).length, 1);
    assert.equal(field(h, '제조사').props.value, '검토 제조사'); assert.equal(dirty(h), true);
    assert.equal(calls.some(call => call.init?.method && call.init.method !== 'GET'), false);
    assert.equal(h.notices, 0);
  } finally { h.unmount(); }
});

test('omitted opt-out preserves standalone automatic review behavior without saving', async () => {
  let reads = 0, writes = 0;
  const h = harness((url, init) => { if (url.endsWith('/registration-settings')) { reads++; return Response.json(defaults); } if (init?.method === 'PATCH') writes++; }, undefined, true);
  try {
    await h.start(); h.render('표시사항'); await h.flush();
    assert.equal(reads, 1); assert.equal(field(h, '제조사').props.value, '검토 제조사');
    assert.equal(dirty(h), true); assert.equal(writes, 0); assert.equal(h.notices, 0);
  } finally { h.unmount(); }
});

test('turning automatic fill off preserves existing manual label text and explicit blanks', async () => {
  let reads = 0;
  const h = harness(url => { if (url.endsWith('/registration-settings')) { reads++; return Response.json(defaults); } }, undefined, true, () => {}, false);
  try {
    await h.start(); h.render('표시사항'); await h.flush();
    field(h, '제조사').props.onChange({target:{value:'직접 검토한 제조원'}});
    field(h, '수입·판매원').props.onChange({target:{value:''}});
    h.setAutoFillLabel(true); await h.flush(); h.setAutoFillLabel(false); await h.flush();
    assert.equal(field(h, '제조사').props.value, '직접 검토한 제조원'); assert.equal(field(h, '수입·판매원').props.value, '');
    assert.equal(dirty(h), true); assert.equal(reads, 0);
    h.button('상품명·저장 기본설정으로 빈 표시사항 채우기', '표시사항').props.onClick(); await settle();
    assert.equal(field(h, '제조사').props.value, '직접 검토한 제조원'); assert.equal(field(h, '수입·판매원').props.value, '');
    assert.equal(reads, 1); assert.equal(h.notices, 0);
  } finally { h.unmount(); }
});

test('a pending automatic response cannot create a hidden draft after opt-out, including a false/true transition', async () => {
  for (const restore of [false, true]) {
    let resolve, reads = 0; const pending = new Promise(done => { resolve = done; });
    const h = harness(url => { if (url.endsWith('/registration-settings')) { reads++; return pending; } }, undefined, true);
    try {
      await h.start(); h.render('표시사항'); await h.flush(); assert.equal(reads, 1);
      h.setAutoFillLabel(false); await h.flush();
      if (restore) { h.setAutoFillLabel(true); await h.flush(); }
      resolve(Response.json(defaults)); await settle(); h.render('표시사항'); await h.flush();
      assert.ok(inputs(h).every(input => input.props.value === '')); assert.equal(dirty(h), false);
      assert.equal(reads, 1); assert.equal(h.notices, 0);
      assert.doesNotMatch(text(h.render('표시사항')), /입력을 채웠습니다/);
    } finally { h.unmount(); }
  }
});
