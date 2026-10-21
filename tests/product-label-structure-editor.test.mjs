import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import ts from 'typescript';
import { createRequire } from 'node:module';
import { createHash, webcrypto } from 'node:crypto';

// Reuse fixture declarations without registering the existing tests twice.
const fixtureUrl = new URL('./product-label-editor.test.mjs', import.meta.url);
const source = fs.readFileSync(fixtureUrl, 'utf8');
const ast = ts.createSourceFile(fixtureUrl.pathname, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS), parts = [];
for (const statement of ast.statements) {
  if (ts.isImportDeclaration(statement)) continue;
  if (ts.isExpressionStatement(statement) && ts.isCallExpression(statement.expression) && statement.expression.expression.getText(ast) === 'test') break;
  parts.push(statement.getText(ast));
}
const helpers = parts.join('\n').replaceAll('import.meta.url', JSON.stringify(fixtureUrl.href))
  .replace('{exports,Error,AbortController', '{exports,crypto:webcrypto,Error,AbortController');
const { editor, fixture, nodes, text, definitions } = vm.runInNewContext(helpers + '\n({editor,fixture,nodes,text,definitions})',
  { assert, fs, vm, path, ts, createRequire, webcrypto, Response, Blob, JSON, URL, Date, AbortController, structuredClone, TextEncoder, setImmediate, setTimeout, clearTimeout });
const plain = value => JSON.parse(JSON.stringify(value));
const cases = [];
const files = ['app/components/product-label-editor.tsx', 'app/product-label.ts', 'tests/product-label-structure-editor.test.mjs', 'tests/product-label-editor.test.mjs'];
const hashes = () => Object.fromEntries(files.map(file => [file, createHash('sha256').update(fs.readFileSync(new URL('../' + file, import.meta.url))).digest('hex')]));
const frozen = hashes();
after(() => {
  assert.deepEqual(hashes(), frozen);
  if (cases.length) fs.writeFileSync(new URL('../' + (process.env.STEP702_UI_PROOF_PATH || 'outputs/step702-structure-ui-proof.json'), import.meta.url), JSON.stringify({
    format: 'product-label-structure-editor-proof-v1', sourceHashes: frozen, cases,
    boundary: 'Actual component callbacks and model verification; synthetic API, renderer and attachment. Actual API coverage is reported separately.',
    externalRequests: 0, productionWrites: 0, supplierHubWrites: 0,
  }, null, 2) + '\n');
});
function setup(intercept) {
  const f = fixture(), originals = plain(f.view.rows), before = plain(f.view), writes = [];
  function reply(url, init) {
    if (init?.method === 'PUT') {
      const body = JSON.parse(init.body); writes.push(body);
      if (body.expectedRevision !== f.view.revision || body.expectedInputFingerprint !== f.view.inputFingerprint) return Response.json({ error: '표시사항 동시 수정' }, { status: 409 });
      if (body.structure !== undefined) f.view.structure = body.structure.map(field => ({ ...field, label: field.label.trim() }));
      for (const change of body.changes) {
        const target = change.optionId === null ? f.view.overrides.common : (f.view.overrides.options[change.optionId] ??= {});
        if (change.value === null) delete target[change.fieldKey]; else target[change.fieldKey] = change.value;
      }
      f.view.revision++; f.view.productVersion = new Date(Date.parse(f.view.productVersion) + 1).toISOString(); f.view.updatedAt = f.view.productVersion;
      f.view.inputFingerprint = createHash('sha256').update(JSON.stringify([f.view.revision, body])).digest('hex');
      const structure = f.view.structure ?? definitions.map(([id, label]) => ({ id, label, required: id === 'productName' }));
      f.view.rows = originals.map(old => {
        const automatic = {}, values = {}, sources = {};
        for (const field of structure) {
          const key = field.id, specific = old.optionId === null ? undefined : f.view.overrides.options[old.optionId];
          automatic[key] = old.automatic[key] ?? '';
          if (specific && Object.hasOwn(specific, key)) { values[key] = specific[key]; sources[key] = 'manual-option'; }
          else if (Object.hasOwn(f.view.overrides.common, key)) { values[key] = f.view.overrides.common[key]; sources[key] = 'manual-common'; }
          else { values[key] = automatic[key]; sources[key] = old.sources[key]?.startsWith('manual-') ? (automatic[key] ? 'content' : 'empty') : old.sources[key] ?? 'empty'; }
        }
        return { ...old, automatic, values, sources };
      });
    }
    return Response.json(f.view);
  }
  const h = editor((url, init) => intercept ? intercept(url, init, reply, f) : reply(url, init));
  return { f, h, before, writes, reply };
}
const heading = (h, index) => nodes(h.render()).find(node => node.type === 'input' && node.props['aria-label'] === `선택 옵션 표시사항 항목 ${index} 이름`);
const caption = (h, index) => nodes(h.render()).find(node => node.type === 'button' && node.props['aria-label'] === `선택 옵션 표시사항 항목 ${index} 이름 편집`);
const labelName = (h, index) => text(nodes(caption(h, index)).find(node => node.type === 'span'));
function openHeading(h, index) { if (!heading(h, index)) caption(h, index).props.onClick(); return heading(h, index); }
function rename(h, index, value) { openHeading(h, index).props.onChange({ target: { value } }); heading(h, index).props.onKeyDown({ key: 'Enter', preventDefault() {} }); h.render(); }
const action = (h, index, name) => nodes(h.render()).find(node => node.type === 'button' && node.props['aria-label'] === `선택 옵션 표시사항 항목 ${index} ${name}`);

test('primary label structure renames, reorders, removes and adds rows, then saves the selected values independently', async () => {
  const { f, h, before, writes } = setup();
  try {
    await h.idle();
    assert.equal(action(h, 1, '삭제').props.disabled, true);
    action(h, 1, '삭제').props.onClick(); await h.idle();
    assert.equal(nodes(h.render()).filter(node => ['input', 'textarea'].includes(node.type) && node.props.className === 'product-label-value-input').length, 9);
    rename(h, 2, '  검토 제조원  ');
    action(h, 2, '위로').props.onClick(); await h.idle();
    action(h, 9, '삭제').props.onClick(); await h.click('＋ 표시사항 항목 추가');
    rename(h, 9, '추가 안내');
    h.edit('선택 옵션 추가 안내', '옵션에서 확인한 내용');
    assert.equal(h.render().props['data-workspace-dirty'], true);
    assert.equal(h.button('저장한 표시사항 PNG 미리보기').props.disabled, true);
    await h.click('정보 저장하기');
    assert.equal(h.saved, 1, text(h.render()));
    assert.deepEqual(f.view.structure.slice(0, 2).map(field => field.id), ['manufacturer', 'productName']);
    assert.equal(f.view.structure[0].label, '검토 제조원');
    assert.ok(!f.view.structure.some(field => field.id === 'usageStandard'));
    const custom = f.view.structure.at(-1).id;
    assert.match(custom, /^custom_/u);
    assert.deepEqual(writes[0].changes, [{ optionId: 'red', fieldKey: custom, value: '옵션에서 확인한 내용' }]);
    assert.equal(f.view.rows.find(row => row.optionId === 'blue').values[custom], '');
    assert.deepEqual(plain(f.view.overrides.common), before.overrides.common);
    assert.deepEqual(plain(f.view.overrides.options.blue), before.overrides.options.blue);
    await h.click('저장한 표시사항 PNG 미리보기');
    assert.deepEqual(h.plans[0].rows.slice(0, 2).map(row => row[0]), ['검토 제조원', '제품명']);
    assert.deepEqual(h.plans[0].rows.at(-1), ['추가 안내', '옵션에서 확인한 내용']);
    await h.click('저장 표시사항 다시 조회');
    assert.equal(labelName(h, 1), '검토 제조원');
    assert.equal(h.input('선택 옵션 추가 안내').props.value, '옵션에서 확인한 내용');
    cases.push({ name: 'structure and selected values', rows: 9, reordered: true, renamed: true, deleted: true, added: true, otherOptionPreserved: true, planAndReopenVerified: true });
  } finally { h.close(); }
});

test('metadata-only lost acknowledgement is recovered inline by GET before mocked completion without another write', async () => {
  let lose = true;
  const { h, writes } = setup((url, init, reply) => { const result = reply(url, init); if (init?.method === 'PUT' && lose) { lose = false; throw Error('합성 응답 유실'); } return result; });
  try {
    await h.idle(); rename(h, 2, '직접 바꾼 이름');
    await h.click('정보 저장하기');
    assert.equal(h.saved, 1); assert.equal(writes.length, 1); assert.deepEqual(writes[0].changes, []);
    const recovery = h.calls.slice(h.calls.findIndex(call => call.init?.method === 'PUT') + 1);
    assert.ok(recovery.length > 0); assert.ok(recovery.every(call => (call.init?.method ?? 'GET') === 'GET'), 'lost ACK recovery only reads before the mocked completion boundary');
    assert.equal(labelName(h, 2), '직접 바꾼 이름');
    assert.equal(h.saved, 1, text(h.render())); assert.equal(writes.length, 1);
    assert.equal(h.render().props['data-workspace-dirty'], false);
    cases.push({ name: 'metadata lost ACK', writes: 1, inlineReadOnlyRecovery: true, completionBoundary: 'mocked', exactStructureRecovered: true });
  } finally { h.close(); }
});

test('invalid names and failed saves retain structure drafts and block PNG generation', async () => {
  let fail = true;
  const { h, writes } = setup((url, init, reply) => init?.method === 'PUT' && fail ? (fail = false, Response.json({ error: '합성 저장 실패' }, { status: 503 })) : reply(url, init));
  try {
    await h.idle(); openHeading(h, 2).props.onChange({ target: { value: '' } });
    assert.equal(heading(h, 2).props.value, ''); assert.equal(h.button('정보 저장하기').props.disabled, true);
    heading(h, 2).props.onChange({ target: { value: '보관할 항목명' } });
    heading(h, 2).props.onKeyDown({ key: 'Enter', preventDefault() {} });
    h.edit('선택 옵션 보관할 항목명', '보관할 내용'); await h.click('정보 저장하기');
    assert.equal(h.saved, 0); assert.equal(h.render().props['data-workspace-dirty'], true);
    assert.equal(h.input('선택 옵션 보관할 항목명').props.value, '보관할 내용');
    assert.equal(h.button('저장한 표시사항 PNG 미리보기').props.disabled, true);
    await h.click('정보 저장하기'); assert.equal(h.saved, 1, text(h.render())); assert.equal(writes.length, 1);
    assert.equal(h.input('선택 옵션 보관할 항목명').props.value, '보관할 내용');
  } finally { h.close(); }
});

test('default restoration preserves archived custom and other-option values and makes no automatic write', async () => {
  const { f, h, writes } = setup();
  try {
    await h.idle(); await h.click('＋ 표시사항 항목 추가');
    rename(h, 10, '추가 안내'); h.edit('선택 옵션 추가 안내', '보관할 추가값');
    await h.click('정보 저장하기'); const custom = f.view.structure.at(-1).id;
    await h.click('기본 9항목 구조로 복원'); assert.equal(writes.length, 1);
    await h.click('정보 저장하기'); assert.equal(h.saved, 2, text(h.render()));
    assert.equal(f.view.structure.length, 9); assert.equal(f.view.overrides.options.red[custom], '보관할 추가값');
    assert.equal(h.input('선택 옵션 추가 안내'), undefined);
    assert.deepEqual(f.view.structure.slice(0,3).map(field=>field.id),['productName','importer','manufacturer']);
    await h.click('저장한 표시사항 PNG 미리보기'); assert.deepEqual(h.plans.at(-1).rows.map(row => row[0]), ['제품명', '수입 및 판매원', '제조원', '제조국', '원료명 및 성분명(재질)', '사용 시 주의사항']);
  } finally { h.close(); }
});

test('stale structure controls cannot alter a different option or an unmounted editor', async () => {
  const { h, writes } = setup();
  try {
    await h.idle(); const oldHeading = openHeading(h, 2).props.onChange, oldMove = action(h, 2, '위로').props.onClick;
    h.select('blue'); await h.idle();
    oldHeading({ target: { value: '이전 옵션의 늦은 항목명' } }); oldMove(); await h.idle();
    assert.equal(h.render().props['data-workspace-dirty'], false); assert.equal(writes.length, 0);
    h.close(); oldHeading({ target: { value: '닫힌 화면' } }); oldMove(); assert.equal(h.lateWrites, 0);
  } finally { h.close(); }
});

test('a conflicting structure preserves local edits until explicit cancellation loads the newest structure', async () => {
  const { f, h, reply } = setup();
  try {
    await h.idle(); const oldHeading = openHeading(h, 2).props.onChange;
    oldHeading({ target: { value: '보관할 내 항목명' } }); heading(h, 2).props.onKeyDown({ key: 'Enter', preventDefault() {} });
    const structure = definitions.map(([id, label]) => ({ id, label: id === 'manufacturer' ? '다른 창의 항목명' : label, required: id === 'productName' }));
    await reply('/product-labels', { method: 'PUT', body: JSON.stringify({ expectedRevision: f.view.revision, expectedInputFingerprint: f.view.inputFingerprint, changes: [], structure }) });
    await h.click('입력 유지·최신 표시사항 조회');
    assert.match(text(h.render()), /항목 구성/u); assert.equal(labelName(h, 2), '보관할 내 항목명');
    await h.click('입력 취소·저장 표시사항 다시 조회');
    assert.equal(labelName(h, 2), '다른 창의 항목명', text(h.render()));
    assert.equal(h.render().props['data-workspace-dirty'], false);
    oldHeading({ target: { value: '취소 후 옛 입력' } });
    assert.equal(labelName(h, 2), '다른 창의 항목명');
    cases.push({ name: 'structure conflict cancellation', draftRetainedBeforeCancel: true, explicitCancelReadsNewStructure: true, staleInputIgnored: true });
  } finally { h.close(); }
});
