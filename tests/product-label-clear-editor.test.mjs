import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import ts from 'typescript';
import { createRequire } from 'node:module';
import { createHash, webcrypto } from 'node:crypto';

// Reuse only fixture declarations, never import/register the older suites.
const fixtureUrl = new URL('./product-label-editor.test.mjs', import.meta.url), fixtureText = fs.readFileSync(fixtureUrl, 'utf8');
const ast = ts.createSourceFile(fixtureUrl.pathname, fixtureText, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS), parts = [];
for (const statement of ast.statements) {
  if (ts.isImportDeclaration(statement)) continue;
  if (ts.isExpressionStatement(statement) && ts.isCallExpression(statement.expression) && statement.expression.expression.getText(ast) === 'test') break;
  parts.push(statement.getText(ast));
}
const structureUrl = new URL('./product-label-structure-editor.test.mjs', import.meta.url), structureText = fs.readFileSync(structureUrl, 'utf8');
const structureAst = ts.createSourceFile(structureUrl.pathname, structureText, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
const setupDeclaration = structureAst.statements.find(statement => ts.isFunctionDeclaration(statement) && statement.name?.text === 'setup');
assert.ok(setupDeclaration);
const helper = parts.join('\n').replaceAll('import.meta.url', JSON.stringify(fixtureUrl.href))
  .replace('{exports,Error,AbortController', '{exports,crypto:webcrypto,Error,AbortController');
const { setup, nodes, text, deferred } = vm.runInNewContext(helper + '\n' + setupDeclaration.getText(structureAst) + '\n({setup,nodes,text,deferred})',
  { assert, fs, vm, path, ts, createRequire, createHash, webcrypto, Response, Blob, JSON, URL, Date, AbortController, structuredClone, TextEncoder, setImmediate, setTimeout, clearTimeout });
const plain = value => JSON.parse(JSON.stringify(value)), proofs = [];
const files = ['app/components/product-label-editor.tsx', 'app/product-label.ts', 'app/product-label-proof.ts',
  'tests/product-label-editor.test.mjs', 'tests/product-label-structure-editor.test.mjs', 'tests/product-label-clear-editor.test.mjs'];
const hashes = () => Object.fromEntries(files.map(file => [file, createHash('sha256').update(fs.readFileSync(new URL('../' + file, import.meta.url))).digest('hex')]));
const frozen = hashes();
after(() => {
  assert.deepEqual(hashes(), frozen);
  fs.writeFileSync(new URL('../outputs/step703-clear-ui-proof.json', import.meta.url), JSON.stringify({
    format: 'product-label-clear-editor-proof-v1', sourceHashes: frozen, cases: proofs,
    boundary: 'Actual component callbacks and model guards; API, hooks, raster and attachment are local fixtures. No live product is read or written.',
    externalRequests: 0, operatingProductWrites: 0, supplierHubWrites: 0,
  }, null, 2) + '\n');
});
const inputs = h => nodes(h.render()).filter(node => node.type === 'textarea');

test('clear all is an unsaved required-only draft and preserves archived common and other-option facts after save', async () => {
  const { h, f, before, writes } = setup();
  try {
    await h.idle(); await h.click('전체 삭제');
    assert.equal(writes.length, 0); assert.deepEqual(plain(f.view), before);
    assert.equal(inputs(h).length, 1); assert.equal(h.input('선택 옵션 제품명').props.value, '');
    assert.equal(h.render().props['data-workspace-dirty'], true);
    assert.equal(h.button('한글 표시사항 생성 시작').props.disabled, true);
    await h.click('정보 저장하기'); assert.equal(h.saved, 1, text(h.render()));
    assert.deepEqual(writes[0].structure, [{ id: 'productName', label: '제품명', required: true }]);
    assert.deepEqual(writes[0].changes, [{ optionId: 'red', fieldKey: 'productName', value: '' }]);
    assert.deepEqual(plain(f.view.overrides.common), before.overrides.common);
    assert.deepEqual(plain(f.view.overrides.options.blue), before.overrides.options.blue);
    assert.equal(f.view.overrides.options.red.precautions, before.overrides.options.red.precautions);
    await h.click('한글 표시사항 생성 시작'); assert.equal(h.plans.length, 0); assert.match(text(h.render()), /한 항목 이상/u);
    await h.click('기본 9항목 구조로 복원'); assert.equal(writes.length, 1);
    await h.click('정보 저장하기'); assert.equal(h.saved, 2, text(h.render()));
    assert.equal(inputs(h).length, 9); assert.equal(h.input('선택 옵션 제품명').props.value, '');
    assert.equal(h.input('선택 옵션 원료명 및 성분명(재질)').props.value, before.overrides.common.material);
    assert.equal(h.input('선택 옵션 사용 시 주의사항').props.value, before.overrides.options.red.precautions);
    proofs.push({ name: 'clear/save/restore', writes: 2, requiredRowsAfterClear: 1, currentProductNameBlank: true, otherOptionAndArchivePreserved: true, emptyRasterBlocked: true });
  } finally { h.close(); }
});

test('discarding a clear draft reloads the original structure and values with no write', async () => {
  const { h, f, before, writes } = setup();
  try {
    await h.idle(); await h.click('한글 표시사항 생성 시작'); assert.equal(h.plans.length, 1);
    await h.click('전체 삭제'); assert.equal(nodes(h.render()).some(node => node.type === 'a'), false);
    await h.click('입력 취소·저장 표시사항 다시 조회');
    assert.equal(inputs(h).length, 9); assert.equal(h.input('선택 옵션 제품명').props.value, before.rows.find(row => row.optionId === 'red').values.productName);
    assert.equal(h.render().props['data-workspace-dirty'], false); assert.equal(writes.length, 0); assert.deepEqual(plain(f.view), before);
    proofs.push({ name: 'cancel clear', writes: 0, oldPreviewHidden: true, originalValuesAndStructureRestored: true });
  } finally { h.close(); }
});

test('a committed clear with lost acknowledgement recovers the exact structure and blank without duplicate PUT', async () => {
  let lose = true;
  const { h, writes } = setup((url, init, reply) => { const result = reply(url, init); if (init?.method === 'PUT' && lose) { lose = false; throw Error('합성 응답 유실'); } return result; });
  try {
    await h.idle(); await h.click('전체 삭제'); await h.click('정보 저장하기');
    assert.equal(h.saved, 0); assert.equal(writes.length, 1); assert.equal(h.render().props['data-workspace-dirty'], true);
    await h.click('입력 유지·최신 표시사항 조회');
    assert.equal(h.saved, 1, text(h.render())); assert.equal(writes.length, 1);
    assert.equal(inputs(h).length, 1); assert.equal(h.input('선택 옵션 제품명').props.value, '');
    assert.equal(h.render().props['data-workspace-dirty'], false);
    proofs.push({ name: 'lost clear ACK', writes: 1, recoveryWrites: 0, exactBlankAndStructureRecovered: true });
  } finally { h.close(); }
});

test('clear callbacks are blocked during a write and cannot affect another option or a closed editor', async () => {
  const held = deferred(); let pending;
  const { h, writes, reply } = setup((url, init, originalReply) => {
    if (init?.method === 'PUT') { pending = { url, init }; return held.promise; } return originalReply(url, init);
  });
  try {
    await h.idle(); const clear = h.button('전체 삭제').props.onClick;
    h.edit('선택 옵션 제품명', '검수 중 입력'); h.button('정보 저장하기').props.onClick();
    clear(); assert.equal(inputs(h).length, 9); assert.equal(h.input('선택 옵션 제품명').props.value, '검수 중 입력');
    held.resolve(reply(pending.url, pending.init)); await h.idle(); assert.equal(writes.length, 1); assert.equal(h.saved, 1, text(h.render()));
    const oldClear = h.button('전체 삭제').props.onClick;
    h.select('blue'); await h.idle(); oldClear();
    assert.equal(inputs(h).length, 9); assert.equal(h.input('선택 옵션 제품명').props.value, '다른 옵션 제품명');
    assert.equal(h.render().props['data-workspace-dirty'], false); h.close(); oldClear(); assert.equal(h.lateWrites, 0);
    proofs.push({ name: 'clear lifecycle', heldWritePreserved: true, otherOptionPreserved: true, staleAndUnmountCallbacksIgnored: true });
  } finally { h.close(); }
});
