import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { createRequire } from 'node:module';
import { webcrypto } from 'node:crypto';
import { nativeReviewFixture, companies, plain, json } from './helpers/native-source-review.mjs';
import { providedOptionModule } from './helpers/provided-option-quotation.mjs';
import { singleDocumentIdentity } from '../extensions/supplier-hub/single-document.mjs';
import { dispatchSingleDocument } from '../extensions/supplier-hub/single-dispatch.mjs';
import * as rejectionDetails from '../extensions/supplier-hub/rejection-details.mjs';

const native = createRequire(import.meta.url);
const nodes = tree => Array.isArray(tree) ? tree.flatMap(nodes) : tree && typeof tree === 'object' ? [tree, ...nodes(tree.props?.children)] : [];
const text = tree => Array.isArray(tree) ? tree.map(text).join('') : tree && typeof tree === 'object' ? text(tree.props?.children) : tree == null ? '' : String(tree);
const turn = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const readLabel = '저장한 견적 자료 다시 확인', openLabel = '견적서·첨부 파일 확인';
function TransportBoundary() { return null; }

// Execute the public routing component and its real primary child. The two
// wrappers use no hooks; each keyed leaf owns the hook state and cleanup. Only
// the separately tested transport is held at its explicit props boundary.
function primaryUi(initial, fetcher) {
  const slots = [], effects = [], modules = new Map(), calls = [];
  let cursor = 0, current = initial, mountedKey, closed = false;
  const hook = (effect, deps, layout) => {
    const index = cursor++, before = slots[index];
    if (!before || !deps || deps.some((value, i) => !Object.is(value, before.deps[i]))) {
      before?.cleanup?.(); slots[index] = { deps, cleanup: null };
      const run = () => { slots[index].cleanup = effect(); }; if (layout) run(); else effects.push(run);
    }
  };
  const hooks = {
    useState(value) { const index = cursor++; if (!(index in slots)) slots[index] = typeof value === 'function' ? value() : value; return [slots[index], next => { slots[index] = typeof next === 'function' ? next(slots[index]) : next; }]; },
    useRef(value) { const index = cursor++; if (!(index in slots)) slots[index] = { current: value }; return slots[index]; },
    useCallback(callback, deps) { const index = cursor++, before = slots[index]; if (!before || deps.some((value, i) => !Object.is(value, before.deps[i]))) slots[index] = { deps, callback }; return slots[index].callback; },
    useEffect: (effect, deps) => hook(effect, deps, false), useLayoutEffect: (effect, deps) => hook(effect, deps, true),
  };
  const load = file => {
    if (modules.has(file)) return modules.get(file); const exports = {}; modules.set(file, exports);
    vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../' + file, import.meta.url), 'utf8'), { fileName: file,
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText,
    { exports, Error, Date, URL, TextEncoder, TextDecoder, Uint8Array, AbortController, structuredClone, crypto: webcrypto,
      fetch: async (url, init) => { calls.push({ url, method: init?.method ?? 'GET', signal: init?.signal }); return fetcher(url, init); },
      require(name) {
        if (name === 'react') return hooks;
        if (name === '../../extensions/supplier-hub/rejection-details.mjs') return rejectionDetails;
        if (name === '@/app/components/supplier-hub-product-transport') return { SupplierHubProductTransport: TransportBoundary };
        if (name.startsWith('@/app/components/')) return load(name.slice(2) + '.tsx');
        if (name.startsWith('@/app/')) return providedOptionModule(name.slice(2) + '.ts');
        return native(name);
      } }); return exports;
  };
  function cleanup() { slots.forEach(slot => slot?.cleanup?.()); slots.length = 0; effects.length = 0; }
  function render(next = current) {
    assert.equal(closed, false); current = next; cursor = 0;
    let tree = load('app/components/supplier-hub-single-review.tsx').SupplierHubSingleReview(current);
    assert.equal(tree.type.name, 'SupplierHubNativeSourceReview', 'the public primary route must choose the native review component');
    tree = tree.type(tree.props);
    if (mountedKey !== undefined && mountedKey !== tree.key) cleanup(); mountedKey = tree.key; cursor = 0;
    return tree.type(tree.props);
  }
  const flush = () => { render(); effects.splice(0).forEach(run => run()); };
  const button = label => nodes(render()).find(node => node.type === 'button' && node.props.children === label);
  const idle = async () => { flush(); const until = Date.now() + 8000; while (render().props['aria-busy']) { if (Date.now() > until) throw Error('Primary routing UI timeout'); await turn(); flush(); } return render(); };
  const waitFor = async condition => { const until = Date.now() + 8000; while (!condition()) { if (Date.now() > until) throw Error('Primary routing condition timeout'); await turn(); flush(); } };
  return { calls, render, idle, waitFor, button, text: () => text(render()),
    transport: () => nodes(render()).find(node => node.type === TransportBoundary),
    change(next) { render({ ...current, ...next }); flush(); },
    async click(label) { const target = button(label); assert.ok(target, label); assert.equal(Boolean(target.props.disabled), false, label); target.props.onClick(); await idle(); },
    close() { if (!closed) { cleanup(); closed = true; } },
  };
}
const primaryProps = f => ({ primaryProduct: true, productId: f.id, profileId: f.profile.id, view: f.quotationView, disabled: false });
function assertReadOnlyPrimary(ui) {
  assert.ok(ui.calls.every(call => call.method === 'GET'));
  assert.ok(ui.calls.every(call => !/single-package|single-receipt|\/collect|\/translation|\/pricing/.test(call.url)));
  assert.equal(ui.button('이미지 전송 자료 준비'), undefined);
  assert.equal(ui.button('개별 전송 자료 확인'), undefined);
  assert.equal(ui.button('선택 옵션의 개별 견적 등록 시작'), undefined);
  assert.equal(nodes(ui.render()).some(node => node.type === 'select'), false);
}

for (const company of companies) test(`${company.code}: actual primary route reads native originals, then explicitly reviews all members without publishing or opening a scalar session`, async () => {
  const f = await nativeReviewFixture(company); let ui;
  try {
    const before = f.state(), images = f.objectState(), receiptSaved = () => {};
    ui = primaryUi({ ...primaryProps(f), onReceiptSaved: receiptSaved }, f.request); await ui.idle();
    assert.equal(ui.calls.filter(call => call.url === f.sourcePath).length, 1);
    assert.equal(ui.button(openLabel).props.disabled, false); assert.equal(ui.transport(), undefined); assertReadOnlyPrimary(ui);
    await ui.click(openLabel); const transport = ui.transport(); assert.ok(transport);
    assert.equal(transport.props.onReceiptSaved, receiptSaved);
    assert.equal(transport.props.review.identity.fingerprint, f.sourcePlan.sourcePlanSha256);
    assert.deepEqual(plain(transport.props.review.body), f.sourcePlan.body);
    assert.deepEqual(plain(transport.props.review.members), f.sourcePlan.identity.members);
    assert.equal(transport.props.review.members.length, 2); assert.equal(transport.props.review.registered, false);
    const fresh = await transport.props.refresh(new AbortController().signal); assert.equal(fresh.reviewDigest, transport.props.review.reviewDigest);
    assert.equal(ui.calls.filter(call => call.url === f.sourcePath).length, 5); assertReadOnlyPrimary(ui);
    assert.equal(f.state(), before); assert.equal(f.objectState(), images); assert.deepEqual(f.h.network, []);
    assert.equal([...f.h.objects.keys()].some(key => key.startsWith('quotation-public-detail/')), false);
  } finally { ui?.close(); f.close(); }
});

test('disabled public primary route performs no source read, and disabling a reviewed scope invalidates retained refresh without a request', async () => {
  const f = await nativeReviewFixture(); let ui;
  try {
    ui = primaryUi({ ...primaryProps(f), disabled: true }, f.request); await ui.idle(); assert.equal(ui.calls.length, 0);
    ui.change({ disabled: false }); await ui.idle(); await ui.click(openLabel); const refresh = ui.transport().props.refresh;
    ui.change({ disabled: true }); await ui.idle(); const before = ui.calls.length;
    assert.equal(ui.transport(), undefined); await assert.rejects(refresh(new AbortController().signal)); assert.equal(ui.calls.length, before);
    assert.equal(ui.button(openLabel).props.disabled, true);
  } finally { ui?.close(); f.close(); }
});

test('queryless captured primary scope remains queryless through native review and transport refresh', async () => {
  const f = await nativeReviewFixture(); let ui;
  try {
    f.h.context.category = f.profile; f.h.context.company = { ...companies[0] };
    f.h.sqlite.prepare('UPDATE collection_context SET payload=? WHERE job_id=?').run(JSON.stringify(f.h.context), 'job');
    f.h.sqlite.prepare('UPDATE products SET source_url=? WHERE id=?').run(f.h.sourceUrl, f.id);
    f.h.sqlite.prepare('INSERT INTO collection_products(job_id,owner_id,product_id,created_at) VALUES(?,?,?,?)').run('job', 'owner', f.id, new Date().toISOString());
    const path = f.base + '/native-assets', context = f.context;
    const view = await json(await f.h.route(f.base + '/quotation-fields'));
    const api = f.h.load('app/api/products/[id]/native-assets/route.ts');
    const fetcher = (url, init) => url === path ? api.GET(new Request('https://app.test' + url, { signal: init.signal }), context) : f.request(url, init);
    ui = primaryUi({ primaryProduct: true, productId: f.id, view, disabled: false }, fetcher); await ui.idle();
    assert.equal(ui.button(openLabel).props.disabled, false); await ui.click(openLabel); const transport = ui.transport(); assert.ok(transport);
    assert.equal(transport.props.review.identity.requestedProfileId, null);
    assert.equal(transport.props.review.identity.profileId, f.profile.id);
    await transport.props.refresh(new AbortController().signal);
    assert.ok(ui.calls.filter(call => call.url.includes('/native-assets')).every(call => call.url === path)); assertReadOnlyPrimary(ui);
    assert.deepEqual(f.h.network, []);
  } finally { ui?.close(); f.close(); }
});

for (const change of ['disabled', 'profile', 'source', 'unmount']) test(`pending primary source read and retained callbacks cannot expose an old review after ${change}`, async () => {
  const f = await nativeReviewFixture(); const gate = deferred(); let ui, held, first = true;
  try {
    const fetcher = (url, init) => { if (first && url === f.sourcePath) { first = false; held = init.signal; return gate.promise; } return f.request(url, init); };
    ui = primaryUi(primaryProps(f), fetcher); await ui.waitFor(() => Boolean(held)); const oldRead = ui.button(readLabel).props.onClick;
    if (change === 'unmount') ui.close();
    else if (change === 'disabled') ui.change({ disabled: true });
    else if (change === 'profile') ui.change({ profileId: 'different-profile' });
    else ui.change({ view: { ...plain(f.quotationView), inputFingerprint: 'f'.repeat(64) } });
    assert.equal(held.aborted, true); const before = ui.calls.length; oldRead(); assert.equal(ui.calls.length, before);
    gate.resolve(Response.json(f.sourcePlan)); await turn();
    if (change !== 'unmount') { await ui.idle(); assert.equal(ui.transport(), undefined); assertReadOnlyPrimary(ui); }
    const settled = ui.calls.length; oldRead(); await turn(); assert.equal(ui.calls.length, settled);
  } finally { gate.resolve(Response.json(f.sourcePlan)); ui?.close(); f.close(); }
});

for (const kind of ['owner', 'company']) test(`changed current ${kind} blocks the public primary review before exposing a transport`, async () => {
  const f = await nativeReviewFixture(); let ui, armed = false;
  try {
    const fetcher = (url, init) => armed && url === '/api/supplier-hub/catalog-context'
      ? Response.json(kind === 'owner' ? { ownerId: 'other-owner', company: companies[0] } : { ownerId: 'owner', company: companies[1] }) : f.request(url, init);
    ui = primaryUi(primaryProps(f), fetcher); await ui.idle(); armed = true; await ui.click(openLabel);
    assert.equal(ui.transport(), undefined); assert.match(ui.text(), /회원 회사|저장한 상품|승인 회원/); assertReadOnlyPrimary(ui);
  } finally { ui?.close(); f.close(); }
});

test('closing a primary full review makes its retained refresh read nothing', async () => {
  const f = await nativeReviewFixture(); let ui;
  try {
    ui = primaryUi(primaryProps(f), f.request); await ui.idle(); await ui.click(openLabel); const refresh = ui.transport().props.refresh;
    await ui.click('전체 문서 확인 닫기'); const before = ui.calls.length;
    await assert.rejects(refresh(new AbortController().signal)); assert.equal(ui.calls.length, before); assert.equal(ui.transport(), undefined);
  } finally { ui?.close(); f.close(); }
});

// Keep the former scalar fixture only for the deliberately retained legacy
// primaryProduct=false contract. Do not give it a synthetic native provider.
function legacyFixture(company) {
  const fixtureUrl = new URL('./supplier-hub-single-stage-ui.test.mjs', import.meta.url), source = fs.readFileSync(fixtureUrl, 'utf8');
  const ast = ts.createSourceFile(fixtureUrl.pathname, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS), statements = [];
  for (const statement of ast.statements) {
    if (ts.isImportDeclaration(statement)) continue;
    if (ts.isForOfStatement(statement) || ts.isExpressionStatement(statement) && ts.isCallExpression(statement.expression) && statement.expression.expression.getText(ast) === 'test') break;
    statements.push(statement.getText(ast));
  }
  const boundary = 'props={productId:saved.productId,profileId:';
  let declarations = statements.join('\n'); assert.equal(declarations.split(boundary).length - 1, 1);
  declarations = declarations.replace(boundary, 'props={primaryProduct:false,productId:saved.productId,profileId:').replaceAll('import.meta.url', JSON.stringify(fixtureUrl.href));
  const context = { assert, fs, vm, ts, createRequire, webcrypto, singleDocumentIdentity, dispatchSingleDocument,
    Response, Request, URL, Date, Error, Intl, JSON, TextEncoder, TextDecoder, Uint8Array, AbortController, structuredClone, setImmediate, setTimeout, clearTimeout };
  return vm.runInNewContext(declarations + '\n({fixture})', context).fixture(company);
}
for (const company of companies) test(`${company.code}: explicit legacy mode retains history, scalar selection and one explicit public prepare`, async () => {
  const ui = legacyFixture(company);
  try {
    await ui.idle(); assert.equal(ui.calls.filter(call => call.url.includes('single-package')).length, 0);
    assert.equal(ui.calls.filter(call => call.url.includes('single-receipt')).length, 1);
    assert.equal(ui.button(readLabel), undefined); assert.ok(ui.button('개별 견적 자료 검토'));
    await ui.click('개별 견적 자료 검토'); await ui.click('이미지 전송 자료 준비');
    const packages = ui.calls.filter(call => call.url.includes('single-package'));
    assert.deepEqual(plain(packages.map(call => call.method)), ['GET', 'POST']);
    assert.equal(packages[1].body.action, 'prepare'); assert.equal(packages[1].body.expectedFingerprint, ui.saved.fingerprint);
    const selector = nodes(ui.render()).find(node => node.type === 'select'); assert.equal(selector.props['aria-label'], '개별 전송 옵션');
    assert.ok(ui.button('개별 전송 자료 확인')); assert.equal(ui.sent.length, 0);
    assert.ok(ui.calls.every(call => !call.url.includes('/native-assets')));
  } finally { ui.close(); }
});
