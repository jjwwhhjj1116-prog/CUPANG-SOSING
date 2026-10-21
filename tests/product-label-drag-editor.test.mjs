import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import ts from 'typescript';
import { createRequire } from 'node:module';
import { createHash, webcrypto } from 'node:crypto';

// Run real editor callbacks; reuse only fixture declarations, never register old tests.
const fixtureUrl = new URL('./product-label-editor.test.mjs', import.meta.url);
const source = fs.readFileSync(fixtureUrl, 'utf8');
const ast = ts.createSourceFile(fixtureUrl.pathname, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS), parts = [];
for (const statement of ast.statements) {
  if (ts.isImportDeclaration(statement)) continue;
  if (ts.isExpressionStatement(statement) && ts.isCallExpression(statement.expression) && statement.expression.expression.getText(ast) === 'test') break;
  parts.push(statement.getText(ast));
}
let helpers = parts.join('\n').replaceAll('import.meta.url', JSON.stringify(fixtureUrl.href));
const substitutions = [
  ['renderer,attach}={}', 'renderer,attach,disabled=false,active=true}={}'],
  ['JSON.stringify(slots[i].deps)!==JSON.stringify(deps)', 'deps===undefined||slots[i].deps===undefined||slots[i].deps.length!==deps.length||deps.some((dep,index)=>!Object.is(dep,slots[i].deps[index]))'],
  ['{exports,Error,AbortController', '{exports,crypto:webcrypto,Error,AbortController'],
  ['version,profileId,refreshToken,onSaved()', 'version,profileId,refreshToken,disabled,active,onSaved()'],
  ['get saved(){return saved;}', 'get epoch(){return stateEpoch;},setDisabled(value){disabled=value;render();},setActive(value){active=value;render();},get saved(){return saved;}'],
];
for (const [before, next] of substitutions) { assert.ok(helpers.includes(before), 'fixture adaptation found: ' + before); helpers = helpers.replace(before, next); }
const context = { assert, fs, vm, path, ts, createRequire, createHash, webcrypto, Response, Blob, JSON, URL, Date, AbortController, structuredClone, TextEncoder, setImmediate, setTimeout, clearTimeout };
const base = vm.runInNewContext(helpers + '\n({editor,fixture,nodes,text,definitions})', context);
Object.assign(context, base, { plain: value => JSON.parse(JSON.stringify(value)) });
const structureSource = fs.readFileSync(new URL('./product-label-structure-editor.test.mjs', import.meta.url), 'utf8');
const structureAst = ts.createSourceFile('structure.mjs', structureSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
const setupDeclaration = structureAst.statements.find(statement => ts.isFunctionDeclaration(statement) && statement.name?.text === 'setup');
assert.ok(setupDeclaration);
const setup = vm.runInNewContext(setupDeclaration.getText(structureAst) + '\nsetup', context);
const { editor, fixture, nodes, text } = base, plain = context.plain;
const mime = 'application/x-yoofam-product-label-row', cases = [];
const files = ['app/components/product-label-editor.tsx', 'app/components/dashboard-client.tsx', 'app/globals.css', 'tests/product-label-drag-editor.test.mjs', 'tests/product-label-editor.test.mjs', 'tests/product-label-structure-editor.test.mjs'];
const hashes = () => Object.fromEntries(files.map(file => [file, createHash('sha256').update(fs.readFileSync(new URL('../' + file, import.meta.url))).digest('hex')]));
const frozen = hashes();
after(() => {
  assert.deepEqual(hashes(), frozen);
  fs.writeFileSync(new URL('../outputs/step710-label-drag-ui-proof.json', import.meta.url), JSON.stringify({
    format: 'product-label-drag-editor-proof-v1', sourceHashes: frozen, cases,
    boundary: 'Real primary React component callbacks with Object.is effect dependencies; isolated synthetic API/PNG/attachment. Child callbacks are invoked through actual JSX props; separate child and API tests cover their own execution. No browser pointer or pixel parity claim.',
    externalRequests: 0, productionWrites: 0, supplierHubWrites: 0,
  }, null, 2) + '\n');
});
const rows = h => nodes(h.render()).filter(node => node.props?.['data-label-sort-id']);
const order = h => plain(rows(h).map(node => node.props['data-label-sort-id']));
const row = (h, id) => rows(h).find(node => node.props['data-label-sort-id'] === id);
const handle = node => nodes(node).find(item => item.type === 'button' && item.props.className === 'product-label-reorder-handle');
const child = h => nodes(h.render()).find(node => typeof node.type === 'function' && node.type.name === 'ProductLabelReferenceEditor');
function transfer() {
  const data = new Map();
  return { setData(type, value) { data.set(type, value); }, getData(type) { return data.get(type) ?? ''; }, get types() { return [...data.keys()]; }, effectAllowed: '', dropEffect: '' };
}
function event(dataTransfer) { return { dataTransfer, prevented: false, stopped: false, preventDefault() { this.prevented = true; }, stopPropagation() { this.stopped = true; } }; }
function start(h, id) { const element = row(h, id), grip = handle(element), data = transfer(), beginning = event(data); assert.ok(grip && !grip.props.disabled); grip.props.onDragStart(beginning); return { data, beginning, grip, from: element }; }
function drop(h, gesture, target) { const destination = row(h, target), hover = event(gesture.data), ending = event(gesture.data); destination.props.onDragOver(hover); destination.props.onDrop(ending); h.render(); return { hover, ending }; }

test('required row drag stays local until explicit save, then preserves captions, values, PNG order and reopen', async () => {
  const { f, h, before, writes } = setup();
  try {
    await h.idle(); const original = order(h), gesture = start(h, 'productName');
    assert.equal(gesture.beginning.prevented, false); assert.equal(gesture.data.effectAllowed, 'move'); assert.ok(gesture.data.getData(mime));
    const result = drop(h, gesture, 'usageStandard'); await h.idle();
    assert.equal(result.hover.prevented, true); assert.equal(result.ending.stopped, true);
    assert.deepEqual(order(h), [...original.slice(1), 'productName']); assert.equal(writes.length, 0); assert.deepEqual(plain(f.view), before);
    assert.ok(nodes(row(h, 'productName')).find(node => node.props?.['aria-label']?.endsWith(' 삭제')).props.disabled);
    assert.equal(h.input('선택 옵션 내용량').props.value, ''); assert.equal(h.button('저장한 표시사항 PNG 미리보기').props.disabled, true);
    await h.click('정보 저장하기'); assert.equal(writes.length, 1); assert.deepEqual(writes[0].changes, []);
    assert.deepEqual(writes[0].structure.map(field => field.id), [...original.slice(1), 'productName']); assert.equal(writes[0].structure.at(-1).required, true);
    assert.deepEqual(plain(f.view.overrides), before.overrides); assert.deepEqual(plain(f.view.imageKeys), before.imageKeys);
    await h.click('저장한 표시사항 PNG 미리보기'); assert.equal(h.plans[0].rows.at(-1)[0], '제품명'); assert.equal(h.plans[0].rows[0][0], '제조원');
    await h.click('저장 표시사항 다시 조회'); assert.equal(order(h).at(-1), 'productName'); assert.equal(h.saved, 1);
    cases.push({ name: 'required row reorder', localUntilSave: true, valuesAndBlanksPreserved: true, savedAndReopened: true, pngOrder: true });
  } finally { h.close(); }
});

test('dragging renamed and added rows retains unsaved edits and stable IDs', async () => {
  const { f, h, before, writes } = setup();
  try {
    await h.idle(); await h.click('＋ 새 항목 추가');
    const custom = order(h).at(-1);
    if (!nodes(row(h, custom)).some(node => node.type === 'input')) nodes(row(h, custom)).find(node => node.props?.className === 'product-label-name-caption').props.onClick();
    nodes(row(h, custom)).find(node => node.type === 'input').props.onChange({ target: { value: '검토 안내' } });
    nodes(row(h, custom)).find(node => node.type === 'input').props.onKeyDown({ key: 'Enter', preventDefault() {} }); await h.idle();
    h.edit('선택 옵션 검토 안내', '선택 옵션 확인 내용'); h.edit('선택 옵션 제조원', ''); await h.idle();
    drop(h, start(h, custom), 'productName'); await h.idle();
    assert.equal(order(h)[0], custom); assert.equal(h.input('선택 옵션 검토 안내').props.value, '선택 옵션 확인 내용'); assert.equal(h.input('선택 옵션 제조원').props.value, ''); assert.equal(writes.length, 0);
    await h.click('정보 저장하기'); assert.deepEqual(writes[0].changes, [{ optionId: 'red', fieldKey: custom, value: '선택 옵션 확인 내용' }, { optionId: 'red', fieldKey: 'manufacturer', value: '' }]);
    assert.equal(f.view.structure[0].id, custom); assert.equal(f.view.structure[0].label, '검토 안내'); assert.deepEqual(plain(f.view.overrides.options.blue), before.overrides.options.blue);
    cases.push({ name: 'unsaved renamed custom row', stableId: true, retainedBlankAndText: true, explicitSave: true });
  } finally { h.close(); }
});

test('foreign transfers, wrong nonce and same-row drops never reorder or write', async () => {
  const { h, writes } = setup();
  try {
    await h.idle(); const original = order(h), target = row(h, 'countryOfOrigin'), foreign = transfer(); foreign.setData(mime, 'foreign');
    target.props.onDragOver(event(foreign)); target.props.onDrop(event(foreign)); assert.deepEqual(order(h), original);
    const gesture = start(h, 'productName'); gesture.data.setData(mime, 'changed'); target.props.onDrop(event(gesture.data)); assert.deepEqual(order(h), original); gesture.grip.props.onDragEnd();
    drop(h, start(h, 'productName'), 'productName'); await h.idle(); assert.deepEqual(order(h), original); assert.equal(writes.length, 0); assert.equal(h.render().props['data-workspace-dirty'], false);
    assert.ok(nodes(h.render()).filter(node => node.type === 'input' || node.type === 'textarea').every(node => !node.props.draggable));
    cases.push({ name: 'foreign and no-op drag', noWrites: true, normalInputsNotDraggable: true });
  } finally { h.close(); }
});

test('old drag callbacks cannot survive value edits, source or option switches, or active and disabled round trips', async () => {
  for (const mode of ['edit', 'source', 'option', 'active', 'disabled']) {
    const { f, h, writes } = setup();
    try {
      await h.idle(); const original = order(h), gesture = start(h, 'productName'), oldTarget = row(h, 'countryOfOrigin');
      if (mode === 'edit') h.edit('선택 옵션 제조원', '새 검토 제조원');
      if (mode === 'source') h.source(f.source());
      if (mode === 'option') { h.select('blue'); await h.idle(); h.select('red'); }
      if (mode === 'active') { h.setActive(false); await h.idle(); h.setActive(true); }
      if (mode === 'disabled') { h.setDisabled(true); await h.idle(); h.setDisabled(false); }
      await h.idle(); oldTarget.props.onDrop(event(gesture.data)); gesture.grip.props.onDragStart(event(gesture.data)); await h.idle();
      assert.deepEqual(order(h), original, mode); assert.equal(writes.length, 0, mode);
      if (mode === 'edit') assert.equal(h.input('선택 옵션 제조원').props.value, '새 검토 제조원');
      drop(h, start(h, 'productName'), 'manufacturer'); await h.idle(); assert.deepEqual(order(h).slice(0, 2), ['manufacturer', 'productName'], mode + ' allows fresh drag');
    } finally { h.close(); }
  }
  cases.push({ name: 'stale callbacks', transitions: ['value edit', 'source', 'option', 'active ABA', 'disabled ABA'], freshGestureRestored: true });
});

test('a failed same-version read invalidates an old drag and permits a fresh gesture after retry', async () => {
  let fail = false;
  const { h, writes } = setup((url, init, reply) => fail ? Response.json({ error: '검증용 조회 실패' }, { status: 503 }) : reply(url, init));
  try {
    await h.idle(); const original = order(h), gesture = start(h, 'productName'), target = row(h, 'countryOfOrigin');
    fail = true; await h.click('저장 표시사항 다시 조회'); assert.match(text(h.render()), /검증용 조회 실패/);
    target.props.onDrop(event(gesture.data)); await h.idle(); assert.deepEqual(order(h), original); assert.equal(writes.length, 0);
    fail = false; await h.click('저장 표시사항 다시 조회'); drop(h, start(h, 'productName'), 'countryOfOrigin'); await h.idle(); assert.equal(order(h)[3], 'productName');
    cases.push({ name: 'failed read lifetime', oldGestureRejected: true, sameVersionFreshGesture: true });
  } finally { h.close(); }
});

test('pending final-label selection blocks stale primary edits, PNG and drag while keeping child save/cancel enabled', async () => {
  const { h, writes } = setup();
  try {
    await h.idle(); await h.click('저장한 표시사항 PNG 미리보기');
    const oldAttach = h.button('PNG 업로드·견적에 연결').props.onClick, oldEdit = h.input('선택 옵션 제조원').props.onChange, oldGenerate = h.button('저장한 표시사항 PNG 미리보기').props.onClick;
    const original = order(h), gesture = start(h, 'productName'), oldDrop = row(h, 'countryOfOrigin').props.onDrop;
    child(h).props.onEditingChange(true); await h.idle();
    assert.equal(h.render().props['data-workspace-dirty'], true); assert.equal(child(h).props.disabled, false); assert.equal(child(h).props.beforeSave(), true);
    assert.equal(h.button('전체 공통·자동값 복원').props.disabled, true); assert.equal(h.button('PNG 업로드·견적에 연결').props.disabled, true);
    const count = h.calls.length, epoch = h.epoch;
    for (let i = 0; i < 6; i++) { child(h).props.onEditingChange(true); child(h).props.onBusyChange(false); h.render(); }
    assert.equal(h.epoch, epoch, 'repeated reports do not cause parent-render feedback');
    oldDrop(event(gesture.data)); oldEdit({ target: { value: '수정되면 안됨' } }); oldGenerate(); oldAttach(); await h.idle();
    assert.deepEqual(order(h), original); assert.equal(h.input('선택 옵션 제조원').props.value, '원천 제조사'); assert.equal(h.calls.length, count); assert.equal(h.attachments.length, 0); assert.equal(writes.length, 0);
    child(h).props.onEditingChange(false); await h.idle(); assert.equal(h.render().props['data-workspace-dirty'], false);
    drop(h, start(h, 'productName'), 'manufacturer'); await h.idle(); assert.deepEqual(order(h).slice(0, 2), ['manufacturer', 'productName']);
    cases.push({ name: 'pending references isolate primary', liveStaleCallbacksBlocked: true, childSaveNotDeadlocked: true, repeatedReportsStable: true });
  } finally { h.close(); }
});

test('old reference scope callbacks and unmounted drag handlers cannot mutate the new editor', async () => {
  const f = fixture(), h = editor((url, init) => f.reply(url, init));
  try {
    await h.idle(); const oldChild = child(h).props, gesture = start(h, 'productName'), destination = row(h, 'manufacturer');
    h.select('blue'); await h.idle(); child(h).props.onEditingChange(true); await h.idle();
    oldChild.onEditingChange(false); oldChild.onBusyChange(true); await h.idle();
    assert.equal(h.render().props['data-workspace-dirty'], true); assert.equal(h.render().props['data-workspace-saving'], false);
    child(h).props.onEditingChange(false); await h.idle(); const before = h.epoch;
    h.close(); destination.props.onDrop(event(gesture.data)); gesture.grip.props.onDragStart(event(gesture.data)); gesture.grip.props.onDragEnd();
    assert.equal(h.lateWrites, 0); assert.equal(h.epoch, before); assert.equal(h.calls.some(call => call.init?.method === 'PUT'), false);
    cases.push({ name: 'scope cleanup', staleReferenceReportsIgnored: true, unmountNoLateWrites: true });
  } finally { /* closed explicitly above */ }
});
