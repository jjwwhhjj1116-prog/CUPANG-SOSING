import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { createHash, webcrypto } from 'node:crypto';
import { createProductDocumentPacket } from '../extensions/supplier-hub/product-document.mjs';
import { productDocumentIdentity } from '../extensions/supplier-hub/product-document-receiver.mjs';
import { singleDocumentIdentity } from '../extensions/supplier-hub/single-document.mjs';
import { singlePacket, SINGLE_COMPANIES, SINGLE_SENDER } from './helpers/supplier-hub-single-document.mjs';

const fixtureURL = new URL('./supplier-hub-product-client.test.mjs', import.meta.url), source = fs.readFileSync(fixtureURL, 'utf8');
const ast = ts.createSourceFile(fixtureURL.pathname, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS), parts = [];
for (const statement of ast.statements) {
  if (ts.isVariableStatement(statement) && statement.pos < source.indexOf('async function fixture(') || ts.isFunctionDeclaration(statement) && ['fixture', 'groupRecord', 'legacyRecord'].includes(statement.name?.text)) parts.push(statement.getText(ast));
}
const declarations = parts.join('\n').replaceAll('import.meta.url', JSON.stringify(fixtureURL.href));
const factory = vm.runInNewContext(declarations + '\n({fixture,groupRecord,legacyRecord})', { assert, fs, path, vm, ts, createRequire, fileURLToPath, createHash, webcrypto, createProductDocumentPacket, productDocumentIdentity, singleDocumentIdentity, singlePacket, SINGLE_COMPANIES, SINGLE_SENDER,
  URL, Response, Request, TextEncoder, TextDecoder, Uint8Array, AbortController, Date, JSON, Array, Object, Error, Intl, structuredClone, setImmediate });
const native = createRequire(import.meta.url), plain = value => JSON.parse(JSON.stringify(value)), cases = [];
const nodes = tree => Array.isArray(tree) ? tree.flatMap(nodes) : tree && typeof tree === 'object' ? [tree, ...nodes(tree.props?.children)] : [];
const text = tree => Array.isArray(tree) ? tree.map(text).join(' ') : tree && typeof tree === 'object' ? text(tree.props?.children) : tree == null ? '' : String(tree);
const turn = () => new Promise(resolve => setImmediate(resolve)), deferred = () => { let resolve; const promise = new Promise(done => resolve = done); return { promise, resolve }; };
const open = '전체 옵션 전송 자료 확인', start = '전체 상품 견적 등록 시작', close = '전송 자료 확인 닫기', recover = '같은 문서 저장 결과 확인';
after(() => fs.writeFileSync(new URL('../outputs/step728-product-transport-ui-proof.json', import.meta.url), JSON.stringify({ cases,
  boundary: 'Actual product transport component and actual app client/packet/receipt functions. React hook scheduling, window bridge, clock and local API are isolated; live:true is synthetic test ACK only. No Chrome/Hub/source collection/actual acceptance.',
  externalRequests: 0, realProductWrites: 0, hubWrites: 0, actualReceiptVerified: false }, null, 2) + '\n'));

async function fixture(company = SINGLE_COMPANIES[0], options = {}) {
  const f = await factory.fixture(company, options), slots = [], effects = [], refreshCalls = [], locks = []; let cursor = 0, sequence = 100000, props;
  const stored=options.stored??new Map(),storageListeners=new Set(),events=f.window.addEventListener,removeEvents=f.window.removeEventListener;
  f.window.localStorage={getItem:key=>{if(options.storageReadError)throw Error('storage unavailable');return stored.get(key)??null;},setItem:(key,value)=>{if(options.storageWriteError)throw Error('storage unavailable');stored.set(key,value);},removeItem:key=>stored.delete(key)};
  f.window.navigator={locks:{request:async(_name,_options,run)=>run()}};
  f.window.addEventListener=(type,fn)=>type==='storage'?storageListeners.add(fn):events(type,fn);
  f.window.removeEventListener=(type,fn)=>type==='storage'?storageListeners.delete(fn):removeEvents(type,fn);
  const originalBridge=f.bridge;
  f.bridge=async payload=>{const result=await originalBridge(payload);return result&&{...result,requestId:payload.packet.requestId};};
  const hook = (effect, deps, layout) => { const index = cursor++, old = slots[index]; if (!old || !deps || deps.some((dep, i) => !Object.is(dep, old.deps[i]))) { old?.cleanup?.(); slots[index] = { deps, cleanup: null }; const run = () => slots[index].cleanup = effect(); if (layout) run(); else effects.push(run); } };
  const react = { useState(initial) { const index = cursor++; if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial; return [slots[index], value => slots[index] = typeof value === 'function' ? value(slots[index]) : value]; }, useRef(value) { const index = cursor++; if (!(index in slots)) slots[index] = { current: value }; return slots[index]; }, useEffect: (fn, deps) => hook(fn, deps, false), useLayoutEffect: (fn, deps) => hook(fn, deps, true) };
  class LocalDate extends Date { static now() { return f.clock.now; } }
  const exports = {}, component = 'app/components/supplier-hub-product-transport.tsx';
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../' + component, import.meta.url), 'utf8'), { fileName: component, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText,
    { exports, Error, Date: LocalDate, window:f.window, AbortController, fetch: f.fetch, setTimeout: (fn, delay) => { const id = ++sequence; f.timers.set(id, { fn, due: f.clock.now + delay }); return id; }, clearTimeout: id => f.timers.delete(id),
      require: name => name === 'react' ? react : name === '@/app/supplier-hub-product-client' ? f.client : name.startsWith('@/') ? f.load(name.slice(2) + '.ts') : name.endsWith('product-document.mjs') ? {
        // Each fresh preview gets a different real UUID. Recovery must supply
        // its original UUID explicitly; a constant test seed cannot mask loss.
        createProductDocumentPacket: (review,value={}) => createProductDocumentPacket(review, { ...value,createdAt:value.createdAt??f.clock.now,now:f.clock.now }),
      } : native(name) });
  props = { review: f.review, disabled: false, refresh: async signal => { refreshCalls.push(signal); return f.refresh(signal); }, onLockChange: value => locks.push(value) };
  f.refresh = async () => { if (f.actor.ownerId !== f.review.identity.ownerId || JSON.stringify(f.actor.company) !== JSON.stringify(f.review.identity.company)) throw Error('현재 회원 회사가 변경되었습니다.'); return plain(f.review); };
  const render = (next = props) => { props = next; cursor = 0; return exports.SupplierHubProductTransport(props); };
  const flush = () => { render(); effects.splice(0).forEach(fn => fn()); };
  const h = { f, stored,refreshCalls, locks, render, flush, props: () => props, text: () => text(render()), button: label => nodes(render()).find(node => node.type === 'button' && node.props.children === label),storageChanged(key){for(const fn of storageListeners)fn({key});flush();},
    async wait(predicate) { for (let count = 0; count < 400; count++) { flush(); if (predicate()) return; await turn(); } assert.fail('Product UI boundary timeout'); },
    async idle() { await h.wait(() => !render().props['aria-busy']); }, async click(label) { const node = h.button(label); assert.ok(node, label); assert.equal(Boolean(node.props.disabled), false, label); node.props.onClick(); await h.idle(); },
    close() { for (const slot of slots) slot?.cleanup?.(); } };
  return h;
}

for (const company of SINGLE_COMPANIES) test(company.name + ': explicit preview rechecks before/after and retains all included options without live actions', async () => {
  const h = await fixture(company); try {
    await h.idle(); await h.wait(() => h.f.calls.length === 3); assert.equal(h.f.sent.length, 0); assert.equal(h.refreshCalls.length, 0);
    assert.ok(h.f.calls.every(call => call.method === 'GET')); await h.click(open);
    assert.equal(h.refreshCalls.length, 2); assert.deepEqual(plain(h.f.sent.map(message => message.payload.action)), ['preview']);
    const packet = h.f.sent[0].payload.packet; assert.equal(packet.review.members.length, 2); assert.equal(packet.review.body.jsonDocument.length, 2); assert.equal(Object.hasOwn(packet, 'optionId'), false);
    assert.equal(packet.review.body.jsonDocument[1].productPage.modelNumber, ''); assert.equal(h.button(start), undefined); assert.ok(h.text().includes(company.name)); assert.match(h.text(), /포함 옵션\s*2\s*개/);
    assert.ok(h.text().includes('현재 상품은 전송하지 않았습니다.')); assert.ok(h.button(close)); assert.equal(h.button(open).props.disabled, true);
    await h.click(close); assert.equal(h.button(open).props.disabled, false); assert.equal(h.f.sent.length, 1);
    cases.push({ name: 'explicit full preview ' + company.code, included: 2, refreshes: 2, nativeActions: 0 });
  } finally { h.close(); }
});

test('pending preview locks once, ignores old callback duplicates and suppresses stale owner/fingerprint results', async () => {
  const h = await fixture(), held = deferred(); try {
    await h.idle(); h.f.refresh = () => held.promise; const oldOpen = h.button(open).props.onClick; oldOpen(); oldOpen(); h.flush(); assert.equal(h.refreshCalls.length, 1); assert.equal(h.button(open).props.disabled, true);
    const changed = { ...h.props().review, identity: { ...h.props().review.identity, ownerId: 'other-owner' }, reviewDigest: 'e'.repeat(64) };
    h.render({ ...h.props(), review: changed }); held.resolve(changed); await h.idle(); oldOpen(); h.flush(); assert.equal(h.f.sent.length, 0); assert.equal(h.refreshCalls.length, 1);
    assert.equal(h.button(close), undefined); cases.push({ name: 'stale props and callbacks', duplicatePreviews: 0, staleResultAdoptions: 0 });
  } finally { h.close(); }
});

test('late disabled preview and changed fresh review never expose a session', async () => {
  for (const mode of ['disabled', 'changed', 'owner']) { const h = await fixture(), held = deferred(); try {
    await h.idle(); h.f.refresh = () => held.promise; h.button(open).props.onClick(); h.flush();
    if (mode === 'disabled') h.render({ ...h.props(), disabled: true });
    if (mode === 'owner') h.f.actor.ownerId = 'different';
    held.resolve(mode === 'changed' ? { ...h.f.review, reviewDigest: 'e'.repeat(64) } : mode === 'owner' ? Promise.reject(Error('회원 회사 변경')) : plain(h.f.review));
    await h.idle(); assert.equal(h.f.sent.length, 0); assert.equal(h.button(close), undefined);
  } finally { h.close(); } }
  cases.push({ name: 'disabled/changed/member preflight', noSession: true, nativeActions: 0 });
});

test('changed post-preview fresh data rejects even a valid extension ACK', async () => {
  const h = await fixture(); try {
    await h.idle(); let count = 0; h.f.refresh = async () => ++count === 2 ? { ...h.f.review, preparedBodySha256: 'e'.repeat(64) } : plain(h.f.review);
    await h.click(open); assert.equal(h.f.sent.length, 1); assert.equal(h.button(close), undefined); assert.ok(h.text().includes('바뀌었습니다'));
    cases.push({ name: 'post ACK fresh source', staleSessionAdoptions: 0 });
  } finally { h.close(); }
});

test('missing start ACK retains the same request and only offers read recovery, never a second start', async () => {
  const h = await fixture(SINGLE_COMPANIES[0], { verified: true }); try {
    await h.idle(); await h.click(open); const oldStart = h.button(start).props.onClick;
    h.f.bridge = async () => undefined; oldStart(); h.flush(); await h.wait(() => h.f.sent.length === 2); h.f.advance(60001); await h.idle();
    assert.equal(h.button(start), undefined); assert.ok(h.button(recover)); oldStart(); h.flush(); assert.equal(h.f.sent.length, 2);
    assert.equal(h.f.sent[0].payload.packet.requestId, h.f.sent[1].payload.packet.requestId); assert.equal(h.button(close), undefined);
    cases.push({ name: 'missing mutation ACK', sameRequestRetained: true, duplicateStarts: 0 });
  } finally { h.close(); }
});

test('disabling while start ACK is pending still retains uncertainty after re-enable', async () => {
  const h = await fixture(SINGLE_COMPANIES[0], { verified: true }); try {
    await h.idle(); await h.click(open); h.f.bridge = async () => undefined; h.button(start).props.onClick(); h.flush(); await h.wait(() => h.f.sent.length === 2);
    h.render({ ...h.props(), disabled: true }); h.f.advance(60001); await h.idle(); h.render({ ...h.props(), disabled: false }); h.flush();
    assert.equal(h.button(start), undefined, 'an unresolved native request must never be advertised as a new start'); assert.ok(h.button(recover)); assert.equal(h.f.sent.length, 2);
    cases.push({ name: 'disabled in flight', sameRequestUncertaintyRetained: true });
  } finally { h.close(); }
});

test('mixed native history labels group versus scalar documents without a SKU registration claim', async () => {
  const h = await fixture(); try {
    h.f.history = [await factory.groupRecord(h.f, 'FINISHED'), await factory.legacyRecord(h.f)]; await h.idle(); await h.wait(() => h.text().includes('보관된 문서 확인 이력'));
    assert.ok(h.text().includes('포함 옵션 2개 · 문서 1개')); assert.ok(h.text().includes('개별 옵션 문서')); assert.ok(h.text().includes('파일 처리 완료 · SKU 확인 전'));
    assert.equal(h.text().includes('등록 완료'), false); assert.equal(h.f.sent.length, 0); assert.ok(h.f.calls.every(call => call.method === 'GET'));
    cases.push({ name: 'mixed receipt labels', groupAndScalarDistinct: true, skuClaim: false, nativeActions: 0 });
  } finally { h.close(); }
});

test('unmount and an expired envelope restore the original operation UUID for explicit read recovery only',async()=>{
 const stored=new Map(),first=await fixture(SINGLE_COMPANIES[0],{verified:true,stored});let original;
 try{
  await first.idle();await first.click(open);first.f.bridge=async()=>undefined;first.button(start).props.onClick();first.flush();await first.wait(()=>first.f.sent.length===2);
  original=first.f.sent[1].payload.packet;first.f.advance(60001);await first.idle();assert.equal(stored.size,1);assert.equal(first.button(start),undefined);
 }finally{first.close();}
 const next=await fixture(SINGLE_COMPANIES[0],{verified:true,stored});try{
  next.f.clock.now=original.createdAt+240001;await next.idle();assert.equal(next.f.sent.length,0,'mount never dispatches a preview/start/recovery');
  assert.notEqual(next.f.packet.requestId,original.requestId,'a new mount has a different default UUID');assert.equal(next.button(start),undefined);assert.ok(next.button('이전 문서 전송 자료 확인'));
  next.f.bridge=async payload=>payload.action==='preview'?{...next.f.preview(),requestId:payload.packet.requestId}:{...next.f.state('created'),requestId:original.requestId};
  await next.click('이전 문서 전송 자료 확인');assert.deepEqual(plain(next.f.sent.map(row=>row.payload.action)),['preview']);assert.ok(next.button(recover));assert.equal(next.button(start),undefined);
  await next.click(recover);assert.deepEqual(plain(next.f.sent.map(row=>row.payload.action)),['preview','recover']);assert.ok(next.f.sent.every(row=>row.payload.packet.requestId===original.requestId));
  assert.ok(next.f.sent[0].payload.packet.createdAt>original.createdAt+120000);assert.equal(JSON.parse([...stored.values()][0]).createdAt,original.createdAt,'audit timestamp is not renewed');
  assert.equal(next.f.calls.some(row=>row.method==='POST'),false);assert.equal(stored.size,1,'an in-progress operation remains reserved');
 }finally{next.close();}
});

test('storage failure and cross-tab descriptor replacement block a new native mutation',async()=>{
 const broken=await fixture(SINGLE_COMPANIES[0],{verified:true,storageWriteError:true});try{
  await broken.idle();await broken.click(open);await broken.click(start);assert.deepEqual(plain(broken.f.sent.map(row=>row.payload.action)),['preview']);assert.equal(broken.stored.size,0);
 }finally{broken.close();}
 const h=await fixture(SINGLE_COMPANIES[0],{verified:true});try{
  await h.idle();await h.click(open);h.f.bridge=async()=>undefined;h.button(start).props.onClick();h.flush();await h.wait(()=>h.f.sent.length===2);
  const [key,raw]=[...h.stored][0],other={...JSON.parse(raw),requestId:'00000000-0000-4000-8000-000000000739'};h.stored.set(key,JSON.stringify(other));h.storageChanged(key);await h.idle();
  assert.match(h.text(),/다른 탭/);assert.equal(h.f.sent.length,2);assert.equal(h.button(start),undefined);h.button(recover)?.props.onClick();await h.idle();assert.equal(h.f.sent.length,2);
 }finally{h.close();}
});

test('durably saved terminal rejection clears only its operation so a later proposal is not falsely blocked',async()=>{
 const stored=new Map(),h=await fixture(SINGLE_COMPANIES[0],{verified:true,stored});try{
  await h.idle();await h.click(open);h.f.bridge=async payload=>({...h.f.observation('REJECTED'),requestId:payload.packet.requestId});
  await h.click(start);assert.equal(h.f.calls.filter(row=>row.method==='POST').length,1);assert.equal(stored.size,0);assert.match(h.text(),/반려/);
 }finally{h.close();}
 const reopened=await fixture(SINGLE_COMPANIES[0],{verified:true,stored});try{
  await reopened.idle();assert.ok(reopened.button(open));assert.equal(reopened.button('이전 문서 전송 자료 확인'),undefined);assert.equal(reopened.f.sent.length,0);
 }finally{reopened.close();}
});

test('owner changes while the descriptor lock is pending cannot dispatch a stale start',async()=>{
 const h=await fixture(SINGLE_COMPANIES[0],{verified:true}),held=deferred();try{
  await h.idle();await h.click(open);let locked;
  h.f.window.navigator.locks.request=async(_name,_options,run)=>{locked=run;await held.promise;return run();};
  h.button(start).props.onClick();h.flush();await h.wait(()=>Boolean(locked));h.f.actor.ownerId='different-member';held.resolve();await h.idle();
  assert.deepEqual(plain(h.f.sent.map(row=>row.payload.action)),['preview']);assert.equal(h.stored.size,1,'unconfirmed intent is retained rather than discarded');assert.equal(h.button(start),undefined);assert.match(h.text(),/회원 회사/);
 }finally{h.close();}
});

test('changed source on remount keeps the old descriptor and cannot preview or start a new operation',async()=>{
 const stored=new Map(),h=await fixture(SINGLE_COMPANIES[0],{verified:true,stored});try{
  await h.idle();await h.click(open);h.f.bridge=async()=>undefined;h.button(start).props.onClick();h.flush();await h.wait(()=>h.f.sent.length===2);h.f.advance(60001);await h.idle();
 }finally{h.close();}
 const next=await fixture(SINGLE_COMPANIES[0],{verified:true,stored});try{
  const changed={...next.props().review,reviewDigest:'e'.repeat(64)};next.render({...next.props(),review:changed});await next.idle();
  assert.match(next.text(),/이전 저장값/);assert.equal(next.f.sent.length,0);assert.equal(next.button(start),undefined);assert.equal(stored.size,1);
 }finally{next.close();}
});

test('late rejected history cannot delete the descriptor under a connected recovery session',async()=>{
 const stored=new Map(),first=await fixture(SINGLE_COMPANIES[0],{verified:true,stored});let original;
 try{await first.idle();await first.click(open);first.f.bridge=async()=>undefined;first.button(start).props.onClick();first.flush();await first.wait(()=>first.f.sent.length===2);original=first.f.sent[1].payload.packet;first.f.advance(60001);await first.idle();}finally{first.close();}
 const held=deferred(),next=await fixture(SINGLE_COMPANIES[0],{verified:true,stored,historyResponse:()=>held.promise});try{
  await next.idle();await next.click('이전 문서 전송 자료 확인');assert.ok(next.button(recover));
  const rejected=await factory.groupRecord(next.f,'REJECTED');rejected.requestId=original.requestId;
  held.resolve(Response.json({format:'yoofam-native-receipt-history-v1',productId:next.f.review.identity.productId,receipts:[rejected]}));
  await next.wait(()=>next.text().includes('보관된 문서 확인 이력'));await turn();next.flush();assert.equal(stored.size,1);assert.ok(next.button(recover));
  next.f.bridge=async payload=>({...next.f.observation('REJECTED'),requestId:payload.packet.requestId});await next.click(recover);
  assert.equal(stored.size,0);assert.equal(next.f.sent.filter(row=>row.payload.action==='start').length,0);assert.match(next.text(),/반려/);
 }finally{next.close();}
});
