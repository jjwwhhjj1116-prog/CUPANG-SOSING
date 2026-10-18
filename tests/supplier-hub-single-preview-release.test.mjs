import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { createRequire } from 'node:module';
import { createHash, webcrypto } from 'node:crypto';
import { singleDocumentIdentity } from '../extensions/supplier-hub/single-document.mjs';
import { dispatchSingleDocument } from '../extensions/supplier-hub/single-dispatch.mjs';

// Reuse only the existing fixture declarations; importing the test module would
// register its entire suite twice. No vendor code or browser page executes.
const fixtureUrl = new URL('./supplier-hub-single-stage-ui.test.mjs', import.meta.url);
const source = fs.readFileSync(fixtureUrl, 'utf8'), ast = ts.createSourceFile(fixtureUrl.pathname, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS), parts = [];
for (const statement of ast.statements) {
  if (ts.isImportDeclaration(statement)) continue;
  if (ts.isForOfStatement(statement) || ts.isExpressionStatement(statement) && ts.isCallExpression(statement.expression) && statement.expression.expression.getText(ast) === 'test') break;
  parts.push(statement.getText(ast));
}
const { fixture, nodes, companies } = vm.runInNewContext(parts.join('\n').replaceAll('import.meta.url', JSON.stringify(fixtureUrl.href)) + '\n({fixture,nodes,companies})',
  { assert, fs, vm, ts, createRequire, webcrypto, singleDocumentIdentity, dispatchSingleDocument,
    Response, Request, URL, Date, Intl, JSON, TextEncoder, TextDecoder, Uint8Array, AbortController, structuredClone, setImmediate, setTimeout, clearTimeout });
const plain = value => JSON.parse(JSON.stringify(value)), select = h => nodes(h.render()).find(node => node.type === 'select');
const releaseLabel = '개별 자료 확인 닫기', proof = [];
const files = ['app/components/supplier-hub-single-review.tsx', 'app/supplier-hub-single-client.ts', 'tests/supplier-hub-single-stage-ui.test.mjs', 'tests/supplier-hub-single-preview-release.test.mjs'];
const sha = file => createHash('sha256').update(fs.readFileSync(new URL('../' + file, import.meta.url))).digest('hex');
const hashes = () => Object.fromEntries(files.map(file => [file, sha(file)])), frozen = hashes();
after(() => {
  assert.deepEqual(hashes(), frozen);
  if (proof.length) fs.writeFileSync(new URL('../outputs/step701-preview-ui-proof.json', import.meta.url), JSON.stringify({ format: 'single-preview-release-ui-proof-v1', sourceHashes: frozen, cases: proof,
    boundary: 'Actual React review callbacks, client packet and real dispatch preview; API, hooks, clock and window bridge are isolated fixtures. Verified=true is a test response, not production permission.',
    externalRequests: 0, browserActions: 0, productionWrites: 0, supplierHubWrites: 0 }, null, 2) + '\n');
});
function twoOptions(h) {
  h.saved.options.push({ optionId: 'option-second', optionLabel: '합성 흰색' });
  const document = plain(h.saved.payload.jsonDocument[0]); document.startPage.productName = '둘째 옵션의 직접 검토 상품';
  h.saved.payload.jsonDocument.push(document);
  h.saved.manifest.push({ ...plain(h.saved.manifest[0]), optionId: 'option-second' });
  h.view.resolved.rows.push({ optionId: 'option-second', optionLabel: '합성 흰색', included: true });
}
function chooseSecond(h) { assert.equal(Boolean(select(h).props.disabled), false); select(h).props.onChange({ target: { value: 'option-second' } }); h.flush(); }

for (const company of companies) test(`${company.code}: a preview can close locally and another exact option can be reviewed without preparation or transmission`, async () => {
  for (const verified of [false, true]) {
    const h = fixture(company, { verified });
    try {
      twoOptions(h); await h.prepare();
      const stored = JSON.stringify(h.saved), history = JSON.stringify(h.history), first = h.sent[0].snapshot.payload.packet, requests = h.calls.length;
      assert.equal(Boolean(select(h).props.disabled), true, h.text()); assert.ok(h.button(releaseLabel), h.text());
      await h.click(releaseLabel);
      assert.equal(h.sent.length, 1); assert.equal(h.calls.length, requests, 'closing is local and does not prepare, observe or submit');
      assert.equal(h.button(releaseLabel), undefined); assert.equal(Boolean(h.button('개별 견적 자료 검토').props.disabled), false);
      chooseSecond(h); await h.click('개별 전송 자료 확인');
      const second = h.sent[1].snapshot.payload.packet;
      assert.equal(second.optionId, 'option-second'); assert.equal(second.body.productName, '둘째 옵션의 직접 검토 상품');
      assert.equal(second.body.jsonDocument.length, 1); assert.notEqual(first.requestId, second.requestId);
      assert.equal(first.optionId, 'option-656'); assert.equal(first.body.productName, '직접 검토한 합성상품');
      assert.deepEqual(plain(second.company), plain(company)); assert.equal(second.ownerId, first.ownerId); assert.equal(second.fingerprint, first.fingerprint);
      assert.deepEqual(plain(second.body.jsonDocument[0].productPage), plain(first.body.jsonDocument[0].productPage));
      assert.equal(JSON.stringify(h.saved), stored); assert.equal(JSON.stringify(h.history), history);
      assert.deepEqual(plain(h.sent.map(call => call.snapshot.payload.action)), ['preview', 'preview']);
      assert.equal(h.calls.filter(call => call.method === 'POST').length, 1, 'only the original explicit image preparation');
      if (!verified) assert.equal(h.button('선택 옵션의 개별 견적 등록 시작'), undefined);
      proof.push({ company: plain(company), testVerifiedResponse: verified, packets: 2, options: [first.optionId, second.optionId], prepareRequests: 1, closeRequests: 0, mutationBridgeActions: 0, savedPackagePreserved: true, historyPreserved: true });
    } finally { h.close(); }
  }
});

test('a callback from an earlier preview cannot close or start a newly selected option', async () => {
  const h = fixture(companies[0], { verified: true });
  try {
    twoOptions(h); await h.prepare(); const oldClose = h.button(releaseLabel).props.onClick, oldStart = h.button('선택 옵션의 개별 견적 등록 시작').props.onClick;
    await h.click(releaseLabel); chooseSecond(h); await h.click('개별 전송 자료 확인');
    const sent = h.sent.length, calls = h.calls.length;
    oldClose(); oldStart(); await h.idle();
    assert.equal(h.sent.length, sent); assert.equal(h.calls.length, calls); assert.ok(h.button(releaseLabel)); assert.equal(Boolean(select(h).props.disabled), true);
    await h.click('선택 옵션의 개별 견적 등록 시작');
    assert.equal(h.sent.at(-1).snapshot.payload.action, 'start'); assert.equal(h.sent.at(-1).snapshot.payload.packet.optionId, 'option-second');
    assert.equal(h.button(releaseLabel), undefined);
    proof.push({ name: 'preview identity changes', staleCloseAndStartIgnored: true, newStartOption: 'option-second', actualHubRequests: 0 });
  } finally { h.close(); }
});

test('a preview-close callback cannot discard an active consent document', async () => {
  const h = fixture(companies[0], { verified: true });
  try {
    await h.prepare(); const oldClose = h.button(releaseLabel).props.onClick;
    await h.click('선택 옵션의 개별 견적 등록 시작'); const sent = h.sent.length;
    oldClose(); await h.idle();
    assert.equal(h.sent.length, sent); assert.equal(h.button(releaseLabel), undefined); assert.equal(Boolean(select(h).props.disabled), true);
    assert.ok(h.button('현재 단계 동의 확인 · 계속')); assert.equal(h.button('현재 단계 동의 확인 · 계속').props.disabled, true);
  } finally { h.close(); }
});

test('pending start and lost acknowledgement keep the original request recoverable instead of releasing the preview', async () => {
  const h = fixture(companies[1], { verified: true }); let answer;
  try {
    await h.prepare(); const oldClose = h.button(releaseLabel).props.onClick;
    h.bridge = () => new Promise(resolve => { answer = resolve; });
    h.button('선택 옵션의 개별 견적 등록 시작').props.onClick(); await h.waitFor(() => Boolean(answer));
    oldClose(); assert.equal(Boolean(select(h).props.disabled), true); assert.equal(h.sent.length, 2);
    await h.advance(60001); await h.idle(); oldClose(); await h.idle();
    assert.ok(h.button('개별 요청 저장 결과 확인')); assert.equal(h.button(releaseLabel), undefined); assert.equal(Boolean(select(h).props.disabled), true);
    answer(h.result('awaiting-stage-consent', h.challenge())); await new Promise(resolve => setImmediate(resolve)); h.flush();
    assert.ok(h.button('개별 요청 저장 결과 확인')); assert.equal(h.sent.length, 2);
    assert.equal(new Set(h.sent.map(call => call.snapshot.payload.packet.requestId)).size, 1);
  } finally { h.close(); }
});

test('disabled, changed-source and unmounted preview callbacks cannot release a later review scope', async () => {
  for (const mode of ['disabled', 'source', 'unmount']) {
    const h = fixture();
    try {
      await h.prepare(); const oldClose = h.button(releaseLabel).props.onClick, before = h.sent.length;
      if (mode === 'disabled') h.change({ disabled: true });
      else if (mode === 'source') h.change({ view: { ...h.view, contentRevision: h.view.contentRevision + 1 } });
      else h.close();
      oldClose(); await new Promise(resolve => setImmediate(resolve));
      assert.equal(h.sent.length, before); assert.equal(h.calls.filter(call => call.method === 'POST').length, 1);
    } finally { h.close(); }
  }
});
