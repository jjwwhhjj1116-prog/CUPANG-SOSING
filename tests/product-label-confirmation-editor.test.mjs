import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import ts from 'typescript';
import { createRequire } from 'node:module';
import { createHash, webcrypto } from 'node:crypto';

const fixtureUrl = new URL('./product-label-editor.test.mjs', import.meta.url), fixtureSource = fs.readFileSync(fixtureUrl, 'utf8');
const ast = ts.createSourceFile(fixtureUrl.pathname, fixtureSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS), parts = [];
for (const statement of ast.statements) {
  if (ts.isImportDeclaration(statement)) continue;
  if (ts.isExpressionStatement(statement) && ts.isCallExpression(statement.expression) && statement.expression.expression.getText(ast) === 'test') break;
  parts.push(statement.getText(ast));
}
let helper = parts.join('\n').replaceAll('import.meta.url', JSON.stringify(fixtureUrl.href));
for (const [before, replacement] of [
  ['renderer,attach}={}', 'renderer,attach,active=true,disabled=false}={}'],
  ['JSON.stringify(slots[i].deps)!==JSON.stringify(deps)', 'deps===undefined||slots[i].deps===undefined||slots[i].deps.length!==deps.length||deps.some((dep,index)=>!Object.is(dep,slots[i].deps[index]))'],
  ['{exports,Error,AbortController', '{exports,crypto:webcrypto,Error,AbortController'],
  ['version,profileId,refreshToken,onSaved()', 'version,profileId,refreshToken,active,disabled,onSaved()'],
  ['get saved(){return saved;}', 'setActive(value){active=value;render();},setDisabled(value){disabled=value;render();},setProfile(value){profileId=value;render();},setProduct(value){productId=value;render();},get saved(){return saved;}'],
]) { assert.ok(helper.includes(before), before); helper = helper.replace(before, replacement); }
let confirmation = () => true;
const prompts = [], browserWindow = { confirm(message) { prompts.push(message); return confirmation(message); } };
const context = { assert, fs, vm, path, ts, createRequire, createHash, webcrypto, browserWindow, Response, Blob, JSON, URL, Date, AbortController, structuredClone, TextEncoder, setImmediate, setTimeout, clearTimeout };
const base = vm.runInNewContext(helper + '\n({editor,fixture,nodes,text,definitions,deferred})', context);
Object.assign(context, base, { plain: value => JSON.parse(JSON.stringify(value)) });
const structureSource = fs.readFileSync(new URL('./product-label-structure-editor.test.mjs', import.meta.url), 'utf8');
const structureAst = ts.createSourceFile('structure.mjs', structureSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
const setupDeclaration = structureAst.statements.find(statement => ts.isFunctionDeclaration(statement) && statement.name?.text === 'setup');
assert.ok(setupDeclaration);
const setupBase = vm.runInNewContext(setupDeclaration.getText(structureAst) + '\nsetup', context), { nodes, deferred } = base;
function setup(intercept) { prompts.length = 0; confirmation = () => true; return setupBase(intercept); }
const plain = value => JSON.parse(JSON.stringify(value)), cases = [];
const inputs = h => nodes(h.render()).filter(node => node.type === 'textarea');
const action = (h, index, name) => nodes(h.render()).find(node => node.type === 'button' && node.props['aria-label'] === `선택 옵션 표시사항 항목 ${index} ${name}`);
const heading = (h, index) => nodes(h.render()).find(node => node.type === 'input' && node.props['aria-label'] === `선택 옵션 표시사항 항목 ${index} 이름`);
const caption = (h, index) => nodes(h.render()).find(node => node.type === 'button' && node.props['aria-label'] === `선택 옵션 표시사항 항목 ${index} 이름 편집`);
const child = h => nodes(h.render()).find(node => typeof node.type === 'function' && node.type.name === 'ProductLabelReferenceEditor');
function rename(h, index, value) {
  if (!heading(h, index)) caption(h, index).props.onClick();
  heading(h, index).props.onChange({ target: { value } }); heading(h, index).props.onKeyDown({ key: 'Enter', preventDefault() {} }); h.render();
}
const files = ['app/components/product-label-editor.tsx', 'tests/product-label-editor.test.mjs', 'tests/product-label-confirmation-editor.test.mjs'];
const hashes = () => Object.fromEntries(files.map(file => [file, createHash('sha256').update(fs.readFileSync(new URL('../' + file, import.meta.url))).digest('hex')])), frozen = hashes();
after(() => {
  assert.deepEqual(hashes(), frozen);
  fs.writeFileSync(new URL('../outputs/step760-label-confirmation-ui-proof.json', import.meta.url), JSON.stringify({
    sourceHashes: frozen, cases, retainedRouteSha256: '5b92873c674c4b76c0e6ce4961caedbf8728ca86f6a15b6d9dc8cdfce80ad1d9',
    originalRanges: { removeItem: [150411, 150565], addNewItem: [150566, 150838], resetToDefault: [150839, 151758], initializeData: [148733, 149597], clearAll: [151759, 151920] },
    boundary: 'Actual React component callbacks/model checks with synthetic API, canvas and confirmation. No operating product, browser, remote file deletion or Supplier Hub write.',
    externalRequests: 0, operatingProductWrites: 0, remoteFileDeletes: 0,
  }, null, 2) + '\n');
});

test('cancelled delete, saved-default restore and supplementary clear/restore actions preserve text, structure and preview without writes', async () => {
  const { h, f, before, writes } = setup(); try {
    await h.idle(); await h.click('저장한 표시사항 PNG 미리보기'); const url = h.urls[0], count = h.calls.length;
    confirmation = () => false;
    for (const button of [action(h, 2, '삭제'), h.button('기본값 복원'), h.button('기본 9항목 구조로 복원'), h.button('전체 삭제'), h.button('전체 공통·자동값 복원'), h.button('제조원 비우기'), h.button('제조원 공통·자동값 복원')]) {
      button.props.onClick(); await h.idle(); assert.equal(inputs(h).length, 9); assert.equal(h.render().props['data-workspace-dirty'], false);
      assert.equal(nodes(h.render()).find(node => node.type === 'a').props.href, url);
    }
    assert.equal(prompts.length, 7); assert.equal(prompts[0], '"제조원" 항목을 삭제하시겠습니까?'); assert.equal(prompts[1], '모든 항목을 기본값으로 복원하시겠습니까?'); assert.equal(prompts[3], '모든 항목을 삭제하시겠습니까? (필수 항목 제외)');
    assert.equal(h.calls.length, count); assert.equal(writes.length, 0); assert.deepEqual(plain(f.view), before);
    cases.push({ name: 'cancel all destructive controls', confirmations: 7, writes: 0, previewPreserved: true });
  } finally { h.close(); }
});

test('confirmed row removal and required-only clearing remain local until the existing explicit save', async () => {
  const { h, f, before, writes } = setup(); try {
    await h.idle(); action(h, 1, '삭제').props.onClick(); assert.equal(prompts.length, 0); assert.equal(inputs(h).length, 9);
    action(h, 2, '삭제').props.onClick(); assert.equal(inputs(h).length, 8); assert.equal(h.input('선택 옵션 제조원'), undefined); assert.equal(writes.length, 0);
    await h.click('전체 삭제'); assert.equal(inputs(h).length, 1); assert.equal(h.input('선택 옵션 제품명').props.value, ''); assert.equal(h.render().props['data-workspace-dirty'], true);
    assert.deepEqual(plain(f.view), before); await h.click('정보 저장하기'); assert.equal(writes.length, 1); assert.equal(h.saved, 1);
    assert.deepEqual(writes[0].structure, [{ id: 'productName', label: '제품명', required: true }]); assert.deepEqual(writes[0].changes, [{ optionId: 'red', fieldKey: 'productName', value: '' }]);
    assert.deepEqual(plain(f.view.overrides.common), before.overrides.common); assert.deepEqual(plain(f.view.overrides.options.blue), before.overrides.options.blue);
    cases.push({ name: 'confirmed delete/clear', localChangesBeforeSave: true, writes: 1, otherScopesPreserved: true });
  } finally { h.close(); }
});

test('saved-default restoration restores saved custom names, order, manual blanks and values rather than deleting overrides', async () => {
  const { h, f, writes } = setup(); try {
    await h.idle(); await h.click('＋ 표시사항 항목 추가'); assert.ok(heading(h, 10), 'new row immediately enters name editing');
    rename(h, 10, '저장된 사용자 항목'); h.edit('선택 옵션 저장된 사용자 항목', '저장한 첫 줄\n두 번째 줄'); await h.click('정보 저장하기');
    const before = plain(f.view), count = h.calls.length;
    rename(h, 2, '취소할 제조원 이름'); h.edit('선택 옵션 제품명', ''); action(h, 9, '삭제').props.onClick();
    await h.click('기본값 복원'); assert.equal(prompts.at(-1), '모든 항목을 기본값으로 복원하시겠습니까?');
    assert.equal(inputs(h).length, 10); assert.equal(h.input('선택 옵션 제조원').props.value, before.rows.find(row => row.optionId === 'red').values.manufacturer);
    assert.equal(h.input('선택 옵션 제품명').props.value, before.rows.find(row => row.optionId === 'red').values.productName); assert.equal(h.input('선택 옵션 내용량').props.value, '');
    assert.equal(h.input('선택 옵션 저장된 사용자 항목').props.value, '저장한 첫 줄\n두 번째 줄'); assert.equal(h.render().props['data-workspace-dirty'], false);
    assert.equal(writes.length, 1); assert.equal(h.calls.length, count); assert.deepEqual(plain(f.view), before);
    await h.click('기본 9항목 구조로 복원'); assert.equal(inputs(h).length, 9); assert.equal(h.render().props['data-workspace-dirty'], true); assert.equal(writes.length, 1);
    assert.equal(h.input('선택 옵션 원료명 및 성분명(재질)').props.value, before.rows.find(row => row.optionId === 'red').values.material);
    cases.push({ name: 'saved defaults differ from nine-row structure', archivedCustomPreserved: true, manualBlankPreserved: true, automaticWrites: 0 });
  } finally { h.close(); }
});

test('new-row name editing keeps its local row on Escape and preserves the existing Enter/blur save flow', async () => {
  const { h, writes } = setup(); try {
    await h.idle(); await h.click('＋ 표시사항 항목 추가'); const input = heading(h, 10); assert.ok(input); assert.equal(input.props.value, '새 항목');
    input.props.onChange({ target: { value: '취소할 이름' } }); heading(h, 10).props.onKeyDown({ key: 'Escape', preventDefault() {} }); input.props.onBlur();
    assert.equal(heading(h, 10), undefined); assert.equal(h.input('선택 옵션 새 항목').props.value, ''); assert.equal(h.render().props['data-workspace-dirty'], true); assert.equal(writes.length, 0);
    rename(h, 10, '확정한 이름'); h.edit('선택 옵션 확정한 이름', '확인한 내용\n공란 유지'); await h.click('정보 저장하기');
    assert.equal(writes.length, 1); assert.equal(h.saved, 1); assert.equal(h.input('선택 옵션 확정한 이름').props.value, '확인한 내용\n공란 유지');
    cases.push({ name: 'add enters inline name', escapeKeepsNewRow: true, explicitSave: true });
  } finally { h.close(); }
});

const transitions = ['option', 'profile', 'product', 'source', 'refresh', 'active', 'disabled', 'active roundtrip', 'disabled roundtrip', 'draft', 'name', 'reference busy', 'reference dirty', 'unmount'];
for (const [index, mode] of transitions.entries()) test(`destructive confirmation rechecks ${mode} before applying a local change`, async () => {
  const { h, f, before, writes } = setup(); try {
    await h.idle(); const destructive = index % 3 === 0 ? h.button('전체 삭제') : index % 3 === 1 ? h.button('기본값 복원') : action(h, 2, '삭제');
    confirmation = () => {
      if (mode === 'option') h.select('blue'); if (mode === 'profile') h.setProfile('other-profile'); if (mode === 'product') h.setProduct('other-product');
      if (mode === 'source') h.source(f.source()); if (mode === 'refresh') h.source(f.view.productVersion, 'next');
      if (mode === 'active' || mode === 'active roundtrip') { h.setActive(false); if (mode.endsWith('roundtrip')) h.setActive(true); }
      if (mode === 'disabled' || mode === 'disabled roundtrip') { h.setDisabled(true); if (mode.endsWith('roundtrip')) h.setDisabled(false); }
      if (mode === 'draft') h.edit('선택 옵션 제품명', '확인 중 새 입력');
      if (mode === 'name') caption(h, 2).props.onClick();
      if (mode === 'reference busy') child(h).props.onBusyChange(true); if (mode === 'reference dirty') child(h).props.onEditingChange(true);
      if (mode === 'unmount') h.close(); return true;
    };
    destructive.props.onClick();
    if (mode === 'reference busy') { assert.equal(h.render().props['data-workspace-saving'], true); assert.equal(f.view.structure, undefined); child(h).props.onBusyChange(false); }
    if (mode !== 'unmount') await h.idle();
    assert.equal(prompts.length, 1); assert.equal(writes.length, 0); assert.equal(h.calls.some(call => call.init?.method && call.init.method !== 'GET'), false);
    assert.deepEqual(plain(f.view.overrides), before.overrides); assert.equal(f.view.structure, undefined); assert.equal(h.lateWrites, 0);
    if (mode === 'draft') assert.equal(h.input('선택 옵션 제품명').props.value, '확인 중 새 입력');
    if (mode === 'name') assert.ok(heading(h, 2));
    if (mode === 'option') assert.equal(h.input('선택 옵션 제품명').props.value, '다른 옵션 제품명');
    cases.push({ name: 'confirmation transition: ' + mode, destructiveChangeApplied: false, writes: 0 });
  } finally { h.close(); }
});

test('a save started during confirmation owns its draft and cannot be replaced by the destructive action', async () => {
  const held = deferred(); let pending;
  const { h, writes, reply } = setup((url, init, send) => { if (init?.method === 'PUT') { pending = { url, init }; return held.promise; } return send(url, init); });
  try {
    await h.idle(); confirmation = () => { h.edit('선택 옵션 제품명', '확인 도중 저장할 입력'); h.button('정보 저장하기').props.onClick(); return true; };
    h.button('전체 삭제').props.onClick(); assert.equal(h.render().props['data-workspace-saving'], true); assert.equal(h.calls.filter(call => call.init?.method === 'PUT').length, 1);
    held.resolve(reply(pending.url, pending.init)); await h.idle(); assert.equal(inputs(h).length, 9); assert.equal(h.input('선택 옵션 제품명').props.value, '확인 도중 저장할 입력');
    assert.equal(Object.hasOwn(writes[0], 'structure'), false); assert.equal(h.saved, 1); assert.equal(prompts.length, 1);
    cases.push({ name: 'confirmation save race', ordinarySaves: 1, destructiveChangeApplied: false });
  } finally { held.resolve(Response.json({})); h.close(); }
});
