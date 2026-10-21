import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import ts from 'typescript';
import { createRequire } from 'node:module';
import { createHash, webcrypto } from 'node:crypto';

// Execute the actual editor with the existing synthetic CAS fixture. Reuse only
// declarations, so importing this suite never registers another suite's cases.
const url = new URL('./product-label-editor.test.mjs', import.meta.url), source = fs.readFileSync(url, 'utf8');
const ast = ts.createSourceFile(url.pathname, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS), parts = [];
for (const statement of ast.statements) {
  if (ts.isImportDeclaration(statement)) continue;
  if (ts.isExpressionStatement(statement) && ts.isCallExpression(statement.expression) && statement.expression.expression.getText(ast) === 'test') break;
  parts.push(statement.getText(ast));
}
let helper = parts.join('\n').replaceAll('import.meta.url', JSON.stringify(url.href));
const adaptations = [
  ['renderer,attach}={}', 'renderer,attach,disabled=false,active=true}={}'],
  ['JSON.stringify(slots[i].deps)!==JSON.stringify(deps)', 'deps===undefined||slots[i].deps===undefined||slots[i].deps.length!==deps.length||deps.some((dep,index)=>!Object.is(dep,slots[i].deps[index]))'],
  ['{exports,Error,AbortController', '{exports,crypto:webcrypto,Error,AbortController'],
  ['version,profileId,refreshToken,onSaved()', 'version,profileId,refreshToken,disabled,active,onDirtyChange(value){dirtyEvents.push(value);},onSaved()'],
  ['get saved(){return saved;}', 'get dirtyEvents(){return dirtyEvents;},get focusCount(){return focusCount;},get selectCount(){return selectCount;},setDisabled(value){disabled=value;render();},setActive(value){active=value;render();},get saved(){return saved;}'],
  ['const slots=[],effects=[]', 'const dirtyEvents=[];let focusCount=0,selectCount=0;const slots=[],effects=[]'],
  ['function load(file){', "function renderNode(type,props){if(type==='input'&&props.ref)props.ref.current={focus(){focusCount++;},select(){selectCount++;}};return{type,props};}function load(file){"],
  ['jsx:(type,props)=>({type,props}),jsxs:(type,props)=>({type,props})', 'jsx:renderNode,jsxs:renderNode'],
];
for (const [before, after] of adaptations) { assert.ok(helper.includes(before), 'fixture adaptation: ' + before); helper = helper.replace(before, after); }
const context = { assert, fs, vm, path, ts, createRequire, createHash, webcrypto, Response, Blob, JSON, URL, Date, AbortController, structuredClone, TextEncoder, setImmediate, setTimeout, clearTimeout };
const base = vm.runInNewContext(helper + '\n({editor,fixture,nodes,text,definitions})', context);
Object.assign(context, base, { plain: value => JSON.parse(JSON.stringify(value)) });
const structureSource = fs.readFileSync(new URL('./product-label-structure-editor.test.mjs', import.meta.url), 'utf8');
const structureAst = ts.createSourceFile('structure.mjs', structureSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
const declaration = structureAst.statements.find(statement => ts.isFunctionDeclaration(statement) && statement.name?.text === 'setup');
assert.ok(declaration);
const setup = vm.runInNewContext(declaration.getText(structureAst) + '\nsetup', context), { nodes, text } = base;
const all = h => nodes(h.render());
const caption = (h, index) => all(h).find(node => node.type === 'button' && node.props['aria-label'] === `선택 옵션 표시사항 항목 ${index} 이름 편집`);
const input = (h, index = 2) => all(h).find(node => node.type === 'input' && node.props['aria-label'] === `선택 옵션 표시사항 항목 ${index} 이름`);
const cancel = (h, index = 2) => all(h).find(node => node.type === 'button' && node.props['aria-label'] === `선택 옵션 표시사항 항목 ${index} 이름 편집 취소`);
const label = (h, index = 2) => text(nodes(caption(h, index)).find(node => node.type === 'span'));
const child = h => all(h).find(node => typeof node.type === 'function' && node.type.name === 'ProductLabelReferenceEditor');
const key = (name, composing = false) => ({ key: name, nativeEvent: { isComposing: composing }, preventDefault() {} });
function open(h, index = 2) { const target = caption(h, index); assert.ok(target && !target.props.disabled); target.props.onClick(); return input(h, index); }
function type(h, value, index = 2) { input(h, index).props.onChange({ target: { value } }); return input(h, index); }

test('caption opens a focused candidate and blocks captured saves, generation and reference writes until explicit name commit', async () => {
  const { h, f, writes } = setup();
  try {
    await h.idle(); assert.equal(all(h).filter(node => node.type === 'input' && /표시사항 항목 [0-9]+ 이름$/.test(node.props['aria-label'] ?? '')).length, 0);
    assert.equal(all(h).filter(node => node.props?.className === 'product-label-name-caption').length, 9);
    h.edit('선택 옵션 제조원', '검토한 제조원\n두 번째 줄');
    const save = h.button('정보 저장하기').props.onClick, generate = h.button('한글 표시사항 생성 시작').props.onClick;
    const png = h.button('저장한 표시사항 PNG 미리보기').props.onClick, reload = h.button('입력 유지·최신 표시사항 조회').props.onClick;
    const oldReferenceGuard = child(h).props.beforeSave, count = h.calls.length;
    open(h); assert.equal(h.focusCount, 1); assert.equal(h.selectCount, 1); type(h, '  검토 제조원 명칭  ');
    assert.equal(h.render().props['data-workspace-dirty'], true); assert.equal(h.dirtyEvents.at(-1), true);
    for (const title of ['정보 저장하기', '한글 표시사항 생성 시작', '저장한 표시사항 PNG 미리보기', '표시사항 재작성']) assert.equal(h.button(title).props.disabled, true, title);
    assert.equal(child(h).props.disabled, true); assert.equal(oldReferenceGuard(), false);
    save(); generate(); png(); reload(); await h.idle(); assert.equal(h.calls.length, count); assert.equal(writes.length, 0);
    assert.equal(h.input('선택 옵션 제조원').props.value, '검토한 제조원\n두 번째 줄');
    const beforeBlur = input(h).props.onBlur; input(h).props.onKeyDown(key('Enter')); beforeBlur();
    assert.equal(input(h), undefined); assert.equal(label(h), '검토 제조원 명칭'); assert.equal(writes.length, 0);
    assert.equal(h.input('선택 옵션 검토 제조원 명칭').props.value, '검토한 제조원\n두 번째 줄');
    await h.click('정보 저장하기'); assert.equal(writes.length, 1); assert.equal(h.saved, 1);
    assert.equal(f.view.structure[1].label, '검토 제조원 명칭'); assert.deepEqual(writes[0].changes, [{ optionId: 'red', fieldKey: 'manufacturer', value: '검토한 제조원\n두 번째 줄' }]);
    assert.equal(h.render().props['data-workspace-dirty'], false);
    await h.click('저장한 표시사항 PNG 미리보기'); assert.deepEqual(h.plans.at(-1).rows.find(row => row[0] === '검토 제조원 명칭'), ['검토 제조원 명칭', '검토한 제조원\n두 번째 줄']);
  } finally { h.close(); }
});

test('Escape, unchanged names and blank blur discard only the candidate without a draft or network write', async () => {
  const { h, f, before, writes } = setup();
  try {
    await h.idle(); const count = h.calls.length;
    open(h); const escaped = type(h, '취소할 이름'); escaped.props.onKeyDown(key('Escape')); escaped.props.onBlur();
    assert.equal(label(h), '제조원'); assert.equal(h.render().props['data-workspace-dirty'], false); assert.equal(h.dirtyEvents.at(-1), false);
    open(h); type(h, '    ').props.onBlur(); assert.equal(label(h), '제조원'); assert.equal(h.render().props['data-workspace-dirty'], false);
    open(h); type(h, '  제조원  ').props.onKeyDown(key('Enter')); assert.equal(h.render().props['data-workspace-dirty'], false);
    await h.idle(); assert.equal(h.calls.length, count); assert.equal(writes.length, 0); assert.deepEqual(JSON.parse(JSON.stringify(f.view)), before);
    h.edit('선택 옵션 제조원', '먼저 수정한 내용'); open(h); type(h, '취소할 이름').props.onKeyDown(key('Escape'));
    assert.equal(h.render().props['data-workspace-dirty'], true); assert.equal(h.input('선택 옵션 제조원').props.value, '먼저 수정한 내용');
  } finally { h.close(); }
});

test('IME Enter leaves the candidate open and blur commits once; explicit cancel prevents blur from committing', async () => {
  const { h, writes } = setup();
  try {
    await h.idle(); open(h); type(h, '조합 중 이름').props.onKeyDown(key('Enter', true)); assert.ok(input(h));
    const stale = input(h); stale.props.onBlur(); stale.props.onBlur(); assert.equal(label(h), '조합 중 이름'); assert.equal(writes.length, 0);
    open(h); const candidate = type(h, '버릴 이름'), control = cancel(h); let prevented = false;
    control.props.onMouseDown({ preventDefault() { prevented = true; } }); assert.equal(prevented, true);
    control.props.onClick(); candidate.props.onBlur(); assert.equal(label(h), '조합 중 이름'); assert.equal(writes.length, 0);
  } finally { h.close(); }
});

test('source changes retain the visible candidate but reject old blur, Enter and save until cancellation and an explicit source read', async () => {
  const { h, f, writes } = setup();
  try {
    await h.idle(); open(h); const old = type(h, '최신 원본 검토 전 이름'), count = h.calls.length;
    h.source(f.source()); await h.idle(); assert.equal(input(h).props.value, '최신 원본 검토 전 이름'); assert.equal(input(h).props.disabled, true);
    old.props.onBlur(); old.props.onKeyDown(key('Enter')); input(h).props.onKeyDown(key('Enter')); await h.idle();
    assert.equal(h.calls.length, count); assert.equal(writes.length, 0); assert.equal(h.render().props['data-workspace-dirty'], true);
    assert.match(text(h.render()), /이름 편집을 취소한 뒤 최신 표시사항/u);
    cancel(h).props.onClick(); assert.equal(label(h), '제조원'); assert.equal(h.render().props['data-workspace-dirty'], false);
    await h.click('저장 표시사항 다시 조회'); assert.equal(h.button('정보 저장하기').props.disabled, false); assert.equal(writes.length, 0);
    old.props.onChange({ target: { value: '늦은 입력' } }); old.props.onBlur(); assert.equal(label(h), '제조원');
  } finally { h.close(); }
});

test('disabled and inactive epochs reject retained events, while the latest enabled input can commit', async () => {
  const { h, writes } = setup();
  try {
    await h.idle(); open(h); const old = type(h, '보존할 이름'); h.setDisabled(true); await h.idle();
    old.props.onBlur(); old.props.onKeyDown(key('Escape')); old.props.onChange({ target: { value: '덮어쓰면 안 됨' } });
    assert.equal(input(h).props.value, '보존할 이름'); assert.equal(input(h).props.disabled, true);
    h.setDisabled(false); await h.idle(); old.props.onBlur(); assert.ok(input(h), 'old pre-disable blur remains stale after unlocking');
    const enabled = input(h); h.setActive(false); await h.idle(); enabled.props.onBlur(); assert.equal(input(h).props.value, '보존할 이름');
    h.setActive(true); await h.idle(); enabled.props.onKeyDown(key('Enter')); assert.ok(input(h));
    input(h).props.onKeyDown(key('Enter')); assert.equal(label(h), '보존할 이름'); assert.equal(writes.length, 0);
  } finally { h.close(); }
});

test('option changes, reference activity and unmount cannot publish an old name candidate', async () => {
  const { h, writes } = setup();
  try {
    await h.idle(); open(h); const old = type(h, '다른 옵션으로 보내면 안 됨');
    child(h).props.onEditingChange(true); await h.idle(); old.props.onBlur(); assert.ok(input(h));
    child(h).props.onEditingChange(false); await h.idle(); old.props.onBlur(); assert.ok(input(h));
    h.select('blue'); await h.idle(); old.props.onKeyDown(key('Enter')); old.props.onBlur();
    assert.equal(input(h), undefined); assert.equal(label(h), '제조원'); assert.equal(h.render().props['data-workspace-dirty'], false); assert.equal(h.input('선택 옵션 제품명').props.value, '다른 옵션 제품명');
    h.select('red'); await h.idle(); assert.equal(input(h), undefined, 'returning to an option does not resurrect a discarded scope');
    open(h); const closing = type(h, '닫힌 입력'); h.close(); closing.props.onChange({ target: { value: '늦은 수정' } }); closing.props.onBlur(); closing.props.onKeyDown(key('Escape'));
    assert.equal(h.lateWrites, 0); assert.equal(writes.length, 0);
  } finally { h.close(); }
});
