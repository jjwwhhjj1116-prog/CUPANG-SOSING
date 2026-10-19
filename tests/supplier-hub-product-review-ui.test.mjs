import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { createRequire } from 'node:module';
import { webcrypto } from 'node:crypto';
import { singleDocumentIdentity } from '../extensions/supplier-hub/single-document.mjs';
import { dispatchSingleDocument } from '../extensions/supplier-hub/single-dispatch.mjs';

// Reuse the ordered hooks, keyed child remount, real Single client/dispatch and
// local fetch/bridge fixture declarations, without registering its test suite.
// Only the new GET-only product-document helper is mocked at its UI boundary.
const fixtureUrl = new URL('./supplier-hub-single-stage-ui.test.mjs', import.meta.url);
const source = fs.readFileSync(fixtureUrl, 'utf8');
const ast = ts.createSourceFile(fixtureUrl.pathname, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS), parts = [];
for (const statement of ast.statements) {
  if (ts.isImportDeclaration(statement)) continue;
  if (ts.isForOfStatement(statement) || ts.isExpressionStatement(statement) && ts.isCallExpression(statement.expression) && statement.expression.expression.getText(ast) === 'test') break;
  parts.push(statement.getText(ast));
}
const originalRequire = "require:name=>name==='react'?react:name.startsWith('@/')?load";
assert.equal(parts.join('\n').split(originalRequire).length - 1, 1, 'one explicit dependency boundary');
const declarations = parts.join('\n').replace(originalRequire,
  "require:name=>name==='@/app/supplier-hub-product-document'?productDocumentHelper:name==='react'?react:name.startsWith('@/')?load")
  .replaceAll('import.meta.url', JSON.stringify(fixtureUrl.href));
const plain = value => JSON.parse(JSON.stringify(value));
const text = value => Array.isArray(value) ? value.map(text).join('') : value && typeof value === 'object' ? text(value.props?.children) : value == null ? '' : String(value);
const walk = value => Array.isArray(value) ? value.flatMap(walk) : value && typeof value === 'object' ? [value, ...walk(value.props?.children)] : [];
const turn = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const openLabel = '포함 옵션 전체 문서 확인', closeLabel = '전체 문서 확인 닫기';

function fixture(company = { code: 'A01526306', name: '유앤채' }) {
  let h, helper;
  const groupCalls = [], productDocumentHelper = { async reviewCurrentSupplierHubProductDocument(input) {
    groupCalls.push(input); return helper(input);
  } };
  const { fixture: create } = vm.runInNewContext(declarations + '\n({fixture})', {
    assert, fs, vm, ts, createRequire, webcrypto, singleDocumentIdentity, dispatchSingleDocument, productDocumentHelper,
    Response, Request, URL, Date, Error, Intl, JSON, TextEncoder, TextDecoder, Uint8Array, AbortController, structuredClone, setImmediate, setTimeout, clearTimeout,
  });
  h = create(company);
  h.saved.prepared = true;
  const first = h.saved.payload.jsonDocument[0];
  first.startPage.productName = '검토 상품 <img src=x onerror=alert(1)>';
  first.productPage.modelNumber = 'M-검수';
  first.productPage.commonAttributes = { purchasePrice: '1100', coupangSalePrice: '2200', msrp: '3300' };
  const second = plain(first);
  second.startPage.productName = '직접 수정한 두 번째 상품';
  second.productPage.modelNumber = '';
  second.productPage.commonAttributes = { purchasePrice: '', coupangSalePrice: '12340', msrp: 0 };
  h.saved.payload.productName = first.startPage.productName;
  h.saved.payload.jsonDocument.push(second);
  h.saved.options.push({ optionId: 'option-second', optionLabel: '직접 수정한 파랑' });
  h.view.resolved.rows.push({ optionId: 'option-second', optionLabel: '직접 수정한 파랑', included: true },
    { optionId: 'option-excluded', optionLabel: '제외한 흰색', included: false });
  const review = () => ({ format: 'yoofam-supplier-hub-product-document-v1', type: 'YOOFAM_PRODUCT_DOCUMENT_REVIEW', registered: false, remoteWrites: false, submissionReady: false,
    identity: { productId: h.saved.productId, fingerprint: h.saved.fingerprint, inputFingerprint: h.saved.inputFingerprint, ownerId: h.actor.ownerId, company: plain(h.saved.company),
      profileId: h.saved.source.profileId, requestedProfileId: 'profile-656', categoryId: h.saved.payload.displayCategoryCode, schemaSha256: h.saved.schemaSha256, source: plain(h.saved.source) },
    members: h.saved.options.map((row, documentIndex) => ({ ...plain(row), documentIndex })), body: plain(h.saved.payload),
    originalBodySha256: 'e'.repeat(64), preparedBodySha256: 'f'.repeat(64), reviewDigest: '9'.repeat(64) });
  helper = async () => review();
  h.groupCalls = groupCalls; h.review = review; h.helper = value => { helper = value; };
  h.section = () => walk(h.render()).find(node => node.props?.['aria-label'] === '포함 옵션 전체 견적 문서');
  h.groupRows = () => walk(h.section()).filter(node => node.type === 'tr' && walk(node).some(child => child.type === 'td'))
    .map(row => walk(row).filter(node => node.type === 'td').map(text));
  h.selectNode = () => walk(h.render()).find(node => node.type === 'select');
  h.read = async () => { await h.idle(); await h.click('개별 견적 자료 검토'); };
  h.assertReadOnly = () => { assert.ok(h.calls.every(call => call.method === 'GET')); assert.equal(h.sent.length, 0); };
  return h;
}

for (const company of [{ code: 'A01526306', name: '유앤채' }, { code: 'A01464742', name: '와이홉' }]) {
  test(company.name + ': whole document compilation is explicit, renders every included option and preserves literal manual blanks', async () => {
    const h = fixture(company);
    try {
      await h.idle(); assert.equal(h.groupCalls.length, 0); assert.equal(h.button(openLabel), undefined);
      assert.equal(h.calls.filter(call => call.url.includes('/supplier-hub-single-package')).length, 0);
      await h.read(); assert.equal(h.groupCalls.length, 0); assert.ok(h.button(openLabel));
      const original = JSON.stringify(h.saved); await h.click(openLabel);
      assert.equal(h.groupCalls.length, 1); const input = h.groupCalls[0];
      assert.equal(input.productId, h.saved.productId); assert.equal(input.profileId, 'profile-656');
      assert.equal(input.packageView.fingerprint, h.saved.fingerprint); assert.equal(input.quotationView, h.view);
      assert.equal(input.signal.aborted, false); assert.equal(typeof input.fetcher, 'function');
      assert.deepEqual(h.groupRows(), [
        ['합성 검정', '검토 상품 <img src=x onerror=alert(1)>', 'M-검수', '1100', '2200', '3300'],
        ['직접 수정한 파랑', '직접 수정한 두 번째 상품', '', '', '12340', '0'],
      ]);
      assert.ok(!text(h.section()).includes('제외한 흰색')); assert.ok(!walk(h.section()).some(node => ['img', 'script'].includes(node.type)));
      assert.equal(JSON.stringify(h.saved), original); h.assertReadOnly();
      await h.click(closeLabel); assert.equal(h.section(), undefined); assert.equal(h.groupCalls.length, 1); h.assertReadOnly();
    } finally { h.close(); }
  });
}

test('double click and stale read/select callbacks cannot run another operation while the full-document helper is pending', async () => {
  const h = fixture(), gate = deferred();
  try {
    await h.read(); h.helper(() => gate.promise);
    const open = h.button(openLabel).props.onClick, oldRead = h.button('개별 견적 자료 검토').props.onClick;
    const select = h.selectNode().props.onChange; open(); open(); h.flush();
    await h.waitFor(() => h.groupCalls.length === 1);
    assert.equal(h.button(openLabel).props.disabled, true); assert.equal(h.selectNode().props.disabled, true);
    const count = h.calls.length; oldRead(); select({ target: { value: 'option-second' } }); h.flush();
    assert.equal(h.calls.length, count); assert.equal(h.selectNode().props.value, ''); assert.equal(h.groupCalls.length, 1);
    gate.resolve(h.review()); await h.idle(); assert.ok(h.section()); h.assertReadOnly();
  } finally { gate.resolve(h.review()); h.close(); }
});

test('disabled remount aborts a pending review and cannot adopt its late result or invoke an old callback', async () => {
  const h = fixture(), gate = deferred();
  try {
    await h.read(); h.helper(() => gate.promise); const oldOpen = h.button(openLabel).props.onClick;
    oldOpen(); await h.waitFor(() => h.groupCalls.length === 1); const signal = h.groupCalls[0].signal;
    h.change({ disabled: true }); assert.equal(signal.aborted, true); oldOpen();
    gate.resolve(h.review()); await h.idle(); assert.equal(h.section(), undefined); assert.equal(h.groupCalls.length, 1);
    assert.equal(h.button('개별 견적 자료 검토').props.disabled, true); h.assertReadOnly();
  } finally { gate.resolve(h.review()); h.close(); }
});

for (const field of ['productVersion', 'inputFingerprint']) {
  test('a changed ' + field + ' remount rejects an old result even when product ID is unchanged', async () => {
    const h = fixture(), gate = deferred();
    try {
      await h.read(); const oldOpen = h.button(openLabel).props.onClick; h.helper(() => gate.promise);
      oldOpen(); await h.waitFor(() => h.groupCalls.length === 1);
      const changed = { ...h.view, [field]: field === 'inputFingerprint' ? 'e'.repeat(64) : '2026-10-14T00:00:00.001Z' };
      h.change({ view: changed }); assert.equal(h.groupCalls[0].signal.aborted, true);
      oldOpen(); gate.resolve(h.review()); await h.idle(); assert.equal(h.section(), undefined); assert.equal(h.groupCalls.length, 1);
      await h.click('개별 견적 자료 검토'); assert.match(h.text(), /최신 견적 입력/); assert.equal(h.button(openLabel), undefined); h.assertReadOnly();
    } finally { gate.resolve(h.review()); h.close(); }
  });
}

test('new helper rejection for changed account/settings remains an error and cannot create a transport or receipt', async () => {
  const h = fixture();
  try {
    await h.read(); h.helper(async () => { throw Error('현재 회원 회사·저장 설정이 변경되었습니다.'); });
    await h.click(openLabel); assert.equal(h.section(), undefined); assert.match(h.text(), /현재 회원 회사·저장 설정/); h.assertReadOnly();
    h.helper(async () => h.review()); await h.click(openLabel); assert.ok(h.section()); h.assertReadOnly();
  } finally { h.close(); }
});

for (const change of ['fingerprint', 'inputFingerprint', 'company', 'productId']) {
  test('a helper result with another ' + change + ' cannot replace the currently reviewed saved package', async () => {
    const h = fixture();
    try {
      await h.read(); h.helper(async () => { const value = h.review(); value.identity[change] = change === 'company' ? { code: 'A01464742', name: '와이홉' } : 'mismatched'; return value; });
      await h.click(openLabel); assert.equal(h.section(), undefined); assert.match(h.text(), /현재 저장 자료가 다릅니다/); h.assertReadOnly();
    } finally { h.close(); }
  });
}

test('a close callback from an earlier review cannot clear a newly compiled review or interrupt its pending replacement', async () => {
  const h = fixture(), gate = deferred();
  try {
    await h.read(); await h.click(openLabel); const oldClose = h.button(closeLabel).props.onClick;
    await h.click(closeLabel); await h.click(openLabel); assert.ok(h.section()); oldClose(); h.flush(); assert.ok(h.section());
    h.helper(() => gate.promise); h.button(openLabel).props.onClick(); h.flush(); oldClose();
    assert.equal(h.section(), undefined); assert.equal(h.button(openLabel).props.disabled, true);
    gate.resolve(h.review()); await h.idle(); assert.ok(h.section()); assert.equal(h.groupCalls.length, 3); h.assertReadOnly();
  } finally { gate.resolve(h.review()); h.close(); }
});

test('legacy option preview still uses exactly one document and the false live gate; full review cannot enter while it is connected', async () => {
  const h = fixture();
  try {
    await h.read(); await h.click(openLabel); const oldOpen = h.button(openLabel).props.onClick;
    h.select(); await h.click('개별 전송 자료 확인'); assert.equal(h.section(), undefined);
    assert.equal(h.sent.length, 1); assert.equal(h.sent[0].snapshot.payload.action, 'preview');
    assert.equal(h.sent[0].snapshot.payload.packet.body.jsonDocument.length, 1); assert.equal(h.button('선택 옵션의 개별 견적 등록 시작'), undefined);
    assert.equal(h.button(openLabel).props.disabled, true); oldOpen(); await h.idle(); assert.equal(h.groupCalls.length, 1); assert.equal(h.sent.length, 1);
    await h.click('개별 자료 확인 닫기'); await h.click(openLabel); assert.ok(h.section()); assert.equal(h.groupCalls.length, 2);
    assert.ok(h.calls.every(call => call.method === 'GET')); assert.equal(h.calls.filter(call => call.method === 'POST').length, 0);
  } finally { h.close(); }
});

test('unmount aborts the pending new helper and discards its eventual success without dispatch or saving', async () => {
  const h = fixture(), gate = deferred();
  await h.read(); h.helper(() => gate.promise); h.button(openLabel).props.onClick(); await h.waitFor(() => h.groupCalls.length === 1);
  const signal = h.groupCalls[0].signal; h.close(); assert.equal(signal.aborted, true);
  gate.resolve(h.review()); await turn(); await turn(); assert.equal(h.groupCalls.length, 1); h.assertReadOnly();
});
