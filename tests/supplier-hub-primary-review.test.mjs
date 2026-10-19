import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { createRequire } from 'node:module';
import { webcrypto } from 'node:crypto';
import { singleDocumentIdentity } from '../extensions/supplier-hub/single-document.mjs';
import { dispatchSingleDocument } from '../extensions/supplier-hub/single-dispatch.mjs';

// Reuse the ordered hook fixture, not its tests. The component, current-package
// reader and whole-product compiler execute unmodified. Only the separately
// tested ProductTransport child is held at its explicit parent boundary.
const fixtureUrl = new URL('./supplier-hub-single-stage-ui.test.mjs', import.meta.url);
const fixtureSource = fs.readFileSync(fixtureUrl, 'utf8');
const ast = ts.createSourceFile(fixtureUrl.pathname, fixtureSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS), statements = [];
for (const statement of ast.statements) {
  if (ts.isImportDeclaration(statement)) continue;
  if (ts.isForOfStatement(statement) || ts.isExpressionStatement(statement) && ts.isCallExpression(statement.expression) && statement.expression.expression.getText(ast) === 'test') break;
  statements.push(statement.getText(ast));
}
function replaceOnce(source, before, after) {
  assert.equal(source.split(before).length - 1, 1, `one fixture boundary: ${before}`);
  return source.replace(before, after);
}
let declarations = statements.join('\n');
declarations = replaceOnce(declarations, "{SupplierHubProductTransport:()=>null}", '{SupplierHubProductTransport:TransportBoundary}');
declarations = replaceOnce(declarations, "props={productId:saved.productId,profileId:'profile-656',view,disabled:false,", "props={primaryProduct:options.primaryProduct===true,productId:saved.productId,profileId:options.queryless?undefined:'profile-656',view,disabled:options.disabled===true,");
declarations = replaceOnce(declarations, 'f.render();f.flush();return f;', 'setupFixture(f);f.render();f.flush();return f;');
declarations = declarations.replaceAll('import.meta.url', JSON.stringify(fixtureUrl.href));

const companies = [{ code: 'A01526306', name: '유앤채' }, { code: 'A01464742', name: '와이홉' }];
const plain = value => JSON.parse(JSON.stringify(value));
const walk = value => Array.isArray(value) ? value.flatMap(walk) : value && typeof value === 'object' ? [value, ...walk(value.props?.children)] : [];
const text = value => Array.isArray(value) ? value.map(text).join('') : value && typeof value === 'object' ? text(value.props?.children) : value == null ? '' : String(value);
const turn = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const packageCalls = h => h.calls.filter(call => String(call.url).includes('/supplier-hub-single-package'));
const openLabel = '포함 옵션 전체 문서 확인', refreshLabel = '저장한 견적 자료 다시 확인';
function TransportBoundary() { return null; }

function fixture({ company = companies[0], prepared = false, primaryProduct = true, disabled = false, queryless = false, setup, onReceiptSaved } = {}) {
  const setupFixture = h => {
    h.saved.prepared = prepared;
    h.saved.humanAgreementsConfirmed = false;
    h.saved.requestedProfileId = queryless ? null : 'profile-656';
    const first = h.saved.payload.jsonDocument[0];
    first.startPage.productName = '직접 검토한 첫 상품';
    first.productPage.modelNumber = 'MODEL-FIRST';
    first.productPage.commonAttributes = { purchasePrice: '1200', coupangSalePrice: '2400', msrp: '3100' };
    const second = plain(first);
    second.startPage.productName = '직접 수정한 두 번째 상품';
    second.productPage.modelNumber = '';
    second.productPage.commonAttributes = { purchasePrice: '', coupangSalePrice: '3460', msrp: 0 };
    h.saved.payload.productName = first.startPage.productName;
    h.saved.payload.jsonDocument.push(second);
    h.saved.options.push({ optionId: 'option-second', optionLabel: '수정한 파랑' });
    h.view.resolved.rows.push({ optionId: 'option-second', optionLabel: '수정한 파랑', included: true }, { optionId: 'option-excluded', optionLabel: '제외한 흰색', included: false });
    setup?.(h);
  };
  const { fixture: create } = vm.runInNewContext(declarations + '\n({fixture})', {
    assert, fs, vm, ts, createRequire, webcrypto, singleDocumentIdentity, dispatchSingleDocument, setupFixture, TransportBoundary,
    Response, Request, URL, Date, Error, Intl, JSON, TextEncoder, TextDecoder, Uint8Array, AbortController, structuredClone, setImmediate, setTimeout, clearTimeout,
  });
  const h = create(company, { primaryProduct, disabled, queryless, onReceiptSaved });
  h.text = () => text(h.render());
  h.section = () => walk(h.render()).find(node => node.props?.['aria-label'] === '포함 옵션 전체 견적 문서');
  h.transport = () => walk(h.render()).find(node => node.type === TransportBoundary);
  h.groupRows = () => plain(walk(h.section()).filter(node => node.type === 'tr' && walk(node).some(child => child.type === 'td')).map(row => walk(row).filter(node => node.type === 'td').map(text)));
  h.assertNoLegacy = () => {
    assert.equal(walk(h.render()).filter(node => node.type === 'select').length, 0);
    assert.equal(h.calls.filter(call => String(call.url).includes('/supplier-hub-single-receipt')).length, 0);
    assert.equal(h.sent.length, 0);
    assert.ok(!h.text().includes('개별 전송 옵션'));
    assert.equal(h.button('개별 전송 자료 확인'), undefined);
    assert.equal(h.button('선택 옵션의 개별 견적 등록 시작'), undefined);
  };
  return h;
}

for (const company of companies) test(company.name + ': primary mount reads the current full package once; preparing images and whole-product review remain explicit', async () => {
  const h = fixture({ company });
  try {
    await h.idle();
    assert.equal(packageCalls(h).length, 1);
    assert.equal(packageCalls(h)[0].method, 'GET');
    assert.match(h.text(), /포함 옵션 2개/);
    assert.equal(h.button(openLabel), undefined);
    assert.ok(!h.transport()); h.assertNoLegacy();
    assert.ok(h.calls.every(call => call.method === 'GET'));
    const original = JSON.stringify(h.saved.payload);
    const prepare = h.button('이미지 전송 자료 준비');
    assert.ok(prepare); assert.equal(prepare.props.disabled, false);
    await h.click('이미지 전송 자료 준비');
    const writes = packageCalls(h).filter(call => call.method === 'POST');
    assert.equal(writes.length, 1); assert.deepEqual(plain(writes[0].body), { action: 'prepare', expectedFingerprint: h.saved.fingerprint });
    assert.ok(h.button(openLabel)); assert.ok(!h.transport());
    await h.click(openLabel);
    const transport = h.transport(); assert.ok(transport);
    assert.deepEqual(plain(transport.props.review.members), [
      { optionId: 'option-656', optionLabel: '합성 검정', documentIndex: 0 },
      { optionId: 'option-second', optionLabel: '수정한 파랑', documentIndex: 1 },
    ]);
    assert.deepEqual(h.groupRows(), [
      ['합성 검정', '직접 검토한 첫 상품', 'MODEL-FIRST', '1200', '2400', '3100'],
      ['수정한 파랑', '직접 수정한 두 번째 상품', '', '', '3460', '0'],
    ]);
    assert.ok(!h.text().includes('제외한 흰색'));
    assert.equal(transport.props.review.registered, false); assert.equal(transport.props.review.remoteWrites, false);
    assert.equal(transport.props.review.body.jsonDocument.length, 2);
    assert.equal(JSON.stringify(h.saved.payload), original);
    assert.equal(packageCalls(h).filter(call => call.method === 'GET').length, 3, 'mount plus two current full-package reads');
    h.assertNoLegacy();
  } finally { h.close(); }
});

test('prepared primary package never republishes files, dispatches a scalar packet or opens a whole-document session merely by mounting', async () => {
  const h = fixture({ prepared: true });
  try {
    await h.idle(); const original = JSON.stringify(h.saved);
    assert.ok(h.button(openLabel)); assert.equal(h.button('이미지 전송 자료 준비').props.disabled, true);
    assert.equal(packageCalls(h).length, 1); assert.ok(h.calls.every(call => call.method === 'GET'));
    assert.ok(!h.transport()); h.assertNoLegacy();
    await h.click(refreshLabel);
    assert.equal(packageCalls(h).length, 2); assert.equal(JSON.stringify(h.saved), original);
    assert.ok(!h.transport()); h.assertNoLegacy();
  } finally { h.close(); }
});

test('disabled or dirty parent performs no package or legacy-history read until explicitly enabled', async () => {
  const h = fixture({ disabled: true, prepared: true });
  try {
    await h.idle(); assert.equal(h.calls.length, 0); assert.equal(h.button(refreshLabel).props.disabled, true); h.assertNoLegacy();
    h.change({ disabled: false }); await h.idle(); assert.equal(packageCalls(h).length, 1);
    await h.click(openLabel); assert.ok(h.transport());
    const refresh = h.transport().props.refresh, calls = h.calls.length;
    h.change({ disabled: true }); await h.idle();
    assert.equal(h.transport(), undefined); await assert.rejects(refresh(new AbortController().signal), /검토가 변경/);
    assert.equal(h.calls.length, calls); h.assertNoLegacy();
  } finally { h.close(); }
});

test('queryless captured category remains queryless throughout mount, preparation, full review and refresh', async () => {
  const h = fixture({ queryless: true });
  try {
    await h.idle(); await h.click('이미지 전송 자료 준비'); await h.click(openLabel);
    const transport = h.transport(); assert.ok(transport);
    assert.equal(transport.props.review.identity.profileId, 'profile-656');
    assert.equal(transport.props.review.identity.requestedProfileId, null);
    await transport.props.refresh(new AbortController().signal);
    assert.ok(packageCalls(h).every(call => !String(call.url).includes('?')));
    assert.deepEqual(plain(packageCalls(h).map(call => call.method)), ['GET', 'POST', 'GET', 'GET', 'GET', 'GET']); h.assertNoLegacy();
  } finally { h.close(); }
});

test('double-clicked preparation creates one explicit POST and a stale callback cannot create another while that acknowledgement is pending', async () => {
  const gate = deferred(); let held;
  const h = fixture({ setup(h) {
    const original = h.fetch;
    h.fetch = (url, init) => String(url).includes('/supplier-hub-single-package') && init?.method === 'POST'
      ? (held = init.signal, gate.promise.then(() => original(url, init))) : original(url, init);
  } });
  try {
    await h.idle(); const click = h.button('이미지 전송 자료 준비').props.onClick;
    click(); click(); await h.waitFor(() => Boolean(held));
    assert.equal(packageCalls(h).filter(call => call.method === 'POST').length, 1);
    assert.equal(h.button('이미지 전송 자료 준비').props.disabled, true);
    const oldRead = h.button(refreshLabel).props.onClick; oldRead();
    assert.equal(packageCalls(h).length, 2);
    gate.resolve(); await h.idle(); click(); await h.idle();
    assert.equal(packageCalls(h).filter(call => call.method === 'POST').length, 1); h.assertNoLegacy();
  } finally { gate.resolve(); h.close(); }
});

for (const change of ['disabled', 'productVersion', 'inputFingerprint', 'profileId', 'unmount']) test('pending primary mount GET is aborted and its old result is ignored after ' + change, async () => {
  const gate = deferred(); let heldSignal, first = true;
  const h = fixture({ prepared: true, setup(h) {
    const original = h.fetch;
    h.fetch = (url, init) => {
      if (String(url).includes('/supplier-hub-single-package') && first) { first = false; heldSignal = init.signal; return gate.promise; }
      return original(url, init);
    };
  } });
  try {
    await h.waitFor(() => Boolean(heldSignal)); const oldRead = h.button(refreshLabel).props.onClick;
    if (change === 'unmount') h.close();
    else if (change === 'disabled') h.change({ disabled: true });
    else if (change === 'profileId') h.change({ profileId: 'different-profile' });
    else h.change({ view: { ...h.view, [change]: change === 'productVersion' ? '2026-10-14T00:00:00.001Z' : 'e'.repeat(64) } });
    assert.equal(heldSignal.aborted, true);
    const calls = h.calls.length; oldRead(); assert.equal(h.calls.length, calls, 'old callback cannot synchronously enqueue a read');
    gate.resolve(Response.json(h.saved)); await turn();
    if (change !== 'unmount') {
      await h.idle(); assert.equal(h.transport(), undefined); assert.equal(h.section(), undefined);
      assert.equal(h.button(openLabel), undefined);
      h.assertNoLegacy();
    }
    const settledCalls = h.calls.length; oldRead(); await turn();
    assert.equal(h.calls.length, settledCalls, 'old mounted read callback cannot enqueue a request after the current read settles');
  } finally { gate.resolve(Response.json(h.saved)); h.close(); }
});

for (const change of ['company', 'owner']) test('actual whole-product reader rejects a changed ' + change + ' during compilation without opening a transport', async () => {
  let catalogReads = 0, armed = false;
  const h = fixture({ prepared: true, setup(h) {
    const original = h.fetch;
    h.fetch = (url, init) => {
      if (armed && url === '/api/supplier-hub/catalog-context' && ++catalogReads === 2) h.actor = change === 'company' ? { ...h.actor, company: companies[1] } : { ...h.actor, ownerId: 'different-owner' };
      return original(url, init);
    };
  } });
  try {
    await h.idle(); armed = true; await h.click(openLabel);
    assert.equal(h.transport(), undefined); assert.match(h.text(), /회원 회사|승인 회사/);
    assert.ok(h.calls.every(call => call.method === 'GET')); h.assertNoLegacy();
  } finally { h.close(); }
});

test('a retained full-review refresh cannot fetch after replacement, closure or source-key remount', async () => {
  const h = fixture({ prepared: true });
  try {
    await h.idle(); await h.click(openLabel); const oldTransport = h.transport(), oldRefresh = oldTransport.props.refresh;
    await h.click('전체 문서 확인 닫기'); let calls = h.calls.length;
    await assert.rejects(oldRefresh(new AbortController().signal), /검토가 변경/); assert.equal(h.calls.length, calls);
    await h.click(openLabel); const currentRefresh = h.transport().props.refresh;
    h.change({ view: { ...h.view, productVersion: '2026-10-14T00:00:00.002Z' } }); await h.idle(); calls = h.calls.length;
    await assert.rejects(currentRefresh(new AbortController().signal), /검토가 변경/); assert.equal(h.calls.length, calls);
    assert.equal(h.transport(), undefined); h.assertNoLegacy();
  } finally { h.close(); }
});

for (const change of ['disabled', 'source', 'unmount']) test('pending actual primary full-review read cannot expose an old transport after ' + change, async () => {
  const gate = deferred(); let armed = false, heldSignal;
  const h = fixture({ prepared: true, setup(h) {
    const original = h.fetch;
    h.fetch = (url, init) => {
      if (armed && String(url).includes('/supplier-hub-single-package')) {
        armed = false; heldSignal = init.signal; return gate.promise;
      }
      return original(url, init);
    };
  } });
  try {
    await h.idle(); armed = true; const oldOpen = h.button(openLabel).props.onClick;
    oldOpen(); oldOpen(); await h.waitFor(() => Boolean(heldSignal));
    assert.equal(packageCalls(h).length, 2, 'one initial read plus one in-flight whole-review read');
    if (change === 'unmount') h.close();
    else if (change === 'disabled') h.change({ disabled: true });
    else h.change({ view: { ...h.view, revision: 5, inputFingerprint: 'e'.repeat(64) } });
    assert.equal(heldSignal.aborted, true); const before = h.calls.length; oldOpen(); assert.equal(h.calls.length, before);
    gate.resolve(Response.json(h.saved)); await turn();
    if (change !== 'unmount') { await h.idle(); assert.equal(h.transport(), undefined); assert.equal(h.section(), undefined); h.assertNoLegacy(); }
    assert.ok(h.calls.every(call => call.method === 'GET')); assert.equal(h.sent.length, 0);
  } finally { gate.resolve(Response.json(h.saved)); h.close(); }
});

for (const change of ['company', 'owner']) test('changed pinned ' + change + ' blocks explicit preparation before any publishing POST', async () => {
  const h = fixture();
  try {
    await h.idle(); const initialPackages = packageCalls(h).length;
    h.actor = change === 'company' ? { ...h.actor, company: companies[1] } : { ...h.actor, ownerId: 'different-owner' };
    await h.click('이미지 전송 자료 준비');
    assert.equal(packageCalls(h).length, initialPackages);
    assert.equal(packageCalls(h).filter(call => call.method === 'POST').length, 0);
    assert.equal(h.button(openLabel), undefined); assert.equal(h.transport(), undefined);
    assert.match(h.text(), /회원 회사가 변경/); h.assertNoLegacy();
  } finally { h.close(); }
});

test('primary mount refuses a package belonging to another company before exposing preparation or document review', async () => {
  const h = fixture({ prepared: true, setup(h) { h.saved.company = plain(companies[1]); } });
  try {
    await h.idle(); assert.match(h.text(), /회원·회사와 견적서의 회사 연결/);
    assert.equal(h.button(openLabel), undefined); assert.equal(h.button('이미지 전송 자료 준비').props.disabled, true);
    assert.ok(!h.text().includes('수정한 파랑')); assert.equal(h.transport(), undefined);
    assert.ok(h.calls.every(call => call.method === 'GET')); h.assertNoLegacy();
  } finally { h.close(); }
});

for (const scope of ['missing', 'another-profile', null]) test('primary scoped request refuses a package with requested profile ' + String(scope), async () => {
  const h = fixture({ prepared: true, setup(h) {
    if (scope === 'missing') delete h.saved.requestedProfileId;
    else h.saved.requestedProfileId = scope;
  } });
  try {
    await h.idle(); assert.equal(h.button(openLabel), undefined);
    assert.equal(h.button('이미지 전송 자료 준비').props.disabled, true); assert.equal(h.transport(), undefined);
    assert.ok(h.calls.every(call => call.method === 'GET')); h.assertNoLegacy();
  } finally { h.close(); }
});

test('legacy mode keeps its explicit read, existing history and scalar selector behavior; primary is opt-in', async () => {
  const h = fixture({ primaryProduct: false, prepared: true });
  try {
    await h.idle(); assert.equal(packageCalls(h).length, 0);
    assert.equal(h.calls.filter(call => String(call.url).includes('/supplier-hub-single-receipt')).length, 1);
    assert.ok(h.button('개별 견적 자료 검토')); assert.equal(h.button(refreshLabel), undefined);
    await h.click('개별 견적 자료 검토');
    const select = walk(h.render()).find(node => node.type === 'select');
    assert.ok(select); assert.equal(select.props['aria-label'], '개별 전송 옵션');
    assert.ok(h.button('개별 전송 자료 확인')); assert.equal(h.sent.length, 0);
    assert.ok(h.calls.every(call => call.method === 'GET'));
  } finally { h.close(); }
});
