import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { webcrypto, createHash } from 'node:crypto';
import { assetApiFixture, companies, module, plain } from './helpers/supplier-hub-single-assets.mjs';
import { createProductDocumentPacket } from '../extensions/supplier-hub/product-document.mjs';
import { productDocumentIdentity } from '../extensions/supplier-hub/product-document-receiver.mjs';
import { dispatchProductDocument, PRODUCT_DOCUMENT_LIVE_VERIFIED } from '../extensions/supplier-hub/product-document-dispatch.mjs';
import { singleDocumentAppSourcePage } from '../extensions/supplier-hub/single-document-adapter.mjs';
import { SINGLE_SENDER } from './helpers/supplier-hub-single-document.mjs';
import { withProductDocumentChrome } from './helpers/product-document-preview.mjs';

const compiler = module('app/supplier-hub-product-document.ts'), origin = new URL(SINGLE_SENDER.url).origin;
const sourceCode = fs.readFileSync(new URL('../extensions/supplier-hub/single-content.js', import.meta.url), 'utf8');
const nativeSourceCode=fs.readFileSync(new URL('../extensions/supplier-hub/native-source-content.js',import.meta.url),'utf8');
const promptCode = fs.readFileSync(new URL('../extensions/supplier-hub/single-confirmation.js', import.meta.url), 'utf8');
const cases = [], cache = new Map(), json = async response => { assert.equal(response.status, 200, await response.clone().text()); return response.json(); };
after(() => {
  const paths = ['extensions/supplier-hub/single-content.js', 'extensions/supplier-hub/single-document-adapter.mjs', 'extensions/supplier-hub/single-confirmation.js', 'extensions/supplier-hub/product-document-adapter.mjs', 'extensions/supplier-hub/product-document-dispatch.mjs', 'tests/supplier-hub-product-source.test.mjs'];
  fs.writeFileSync(new URL('../outputs/step728-product-source-proof.json', import.meta.url), JSON.stringify({ sourceHashes: Object.fromEntries(paths.map(file => [file, createHash('sha256').update(fs.readFileSync(new URL('../' + file, import.meta.url))).digest('hex')])), cases,
    boundary: 'Actual app source verifier and isolated content/prompt code over local prepared packages and mock GET responses. No real Chrome/Hub/source collection/native mutation/receipt.', externalRequests: 0, realProductWrites: 0, hubWrites: 0, liveGate: PRODUCT_DOCUMENT_LIVE_VERIFIED }, null, 2) + '\n');
});
async function sample(company = companies[0], captured = false) {
  const key = company.code + ':' + captured; if (cache.has(key)) return plain(cache.get(key));
  const f = await assetApiFixture(company);
  try {
    if (captured) {
      const category = { name: f.profile.name, categoryId: f.profile.categoryId, categoryPath: f.profile.categoryPath, template: null, mappings: [], hubSchema: f.profile.hubSchema };
      // The fixture profile stores the same captured schema under hubSchema.
      if (!category.hubSchema) category.hubSchema = (await f.h.load('db/category-profiles.ts').findCategoryProfile('owner', f.profile.id))?.hubSchema;
      assert.ok(category.hubSchema, 'captured schema fixture');
      f.h.sqlite.prepare('UPDATE collection_context SET payload=? WHERE job_id=?').run(JSON.stringify({ ...plain(f.h.context), company: plain(company), category }), 'job');
      f.h.sqlite.prepare('UPDATE products SET source_url=? WHERE id=?').run(f.h.sourceUrl, f.id);
      f.h.sqlite.prepare('INSERT INTO collection_products VALUES(?,?,?,?)').run('job', 'owner', f.id, new Date().toISOString());
    }
    const query = captured ? '' : f.query, endpoint = f.base + '/supplier-hub-single-package' + query;
    const view = await json(await f.h.route(f.base + '/quotation-fields' + query)), candidate = await json(await f.h.route(endpoint));
    const prepared = await json(await f.h.route(endpoint, { method: 'POST', body: { action: 'prepare', expectedFingerprint: candidate.fingerprint } }));
    const before = f.state(), objects = f.objectState(), review = await compiler.compileSupplierHubProductDocument({ packageView: prepared, quotationView: view, ownerId: 'owner' });
    const packet = await createProductDocumentPacket(review), context = await productDocumentIdentity(packet, SINGLE_SENDER);
    assert.equal(f.state(), before); assert.equal(f.objectState(), objects); assert.deepEqual(f.h.network, []);
    const result = { packet: plain(packet), context: plain(context), prepared: plain(prepared), id: f.id }; cache.set(key, result); return plain(result);
  } finally { f.close(); }
}
const expected = f => ({ identity: f.context.identity, bodySha256: f.context.originalBodySha256, preparedBodySha256: f.context.bodySha256, packetDigest: f.context.packetDigest, requestId: f.packet.requestId, docId: null });
function sourceRuntime(f, { mutate, responsePatch } = {}) {
  const calls = [], actor = { ownerId: 'owner', company: plain(f.prepared.company) }, state = { actor, prepared: plain(f.prepared), blocked: false, native: { format: 'yoofam-native-receipt-history-v1', productId: f.id, receipts: [] } };
  const handlers=[];
  const scope = { crypto: webcrypto, TextEncoder, TextDecoder, Uint8Array, AbortController, Date, JSON, Array, Object, Error, Set, structuredClone, setTimeout, clearTimeout,
    location: { origin }, chrome: { runtime: { id: 'synthetic-extension', onMessage: { addListener(fn) { handlers.push(fn); } } } },
    fetch: async (path, init = {}) => {
      const url = new URL(path, origin); assert.equal(url.origin, origin); assert.ok(url.pathname.startsWith('/api/'));
      calls.push({ path: url.pathname + url.search, init }); await mutate?.(state, calls.length, url);
      const data = url.pathname.includes('catalog-context') ? state.actor : url.pathname.includes('supplier-hub-product-receipt') ? state.native : url.pathname.includes('supplier-hub-receipt') ? { history: { productId: f.id, blocked: state.blocked } } : url.pathname.endsWith('/native-assets')?{format:'yoofam-native-asset-source-plan-v1',sourcePlanSha256:'0'.repeat(64)}:state.prepared;
      const response = responsePatch?.(url, data) ?? Response.json(data); Object.defineProperty(response, 'url', { value: url.href }); return response;
    } };
  vm.runInNewContext(sourceCode, scope);
  vm.runInNewContext(nativeSourceCode,scope);
  return { scope, calls, state, page: (input = expected(f), group = true) => vm.runInNewContext(`(${singleDocumentAppSourcePage.toString()})(input,group)`, { ...scope, input, group }),
    async bridge(input = expected(f), type = 'YOOFAM_VERIFY_PRODUCT_DOCUMENT_SOURCE', sender = { id: 'synthetic-extension' }) {
      return new Promise(resolve => { for(const handler of handlers){const result = handler({ type, expected: input }, sender, reply => resolve(plain(reply)));if(result===true)return;}resolve(undefined); });
    } };
}
function previewChrome(runtime){
  const calls=[],appTab={id:SINGLE_SENDER.tab.id,windowId:SINGLE_SENDER.tab.windowId,url:SINGLE_SENDER.url,status:'complete'};
  const unexpected=name=>{calls.push({name});assert.fail('Preview cannot call '+name);};
  return{calls,api:{tabs:{
    get:async id=>{calls.push({name:'get',id});assert.equal(id,appTab.id);return plain(appTab);},
    create:()=>unexpected('create'),update:()=>unexpected('update'),query:()=>unexpected('query'),
    sendMessage:async(id,message,frame)=>{calls.push({name:'message',type:message.type});assert.equal(id,appTab.id);assert.equal(frame.frameId,0);return runtime.bridge(message.expected,message.type);},
  },scripting:{executeScript:async request=>{
    calls.push({name:'execute',func:request.func.name});assert.equal(request.target.tabId,appTab.id);assert.deepEqual(request.target.frameIds,[0]);
    const result=await vm.runInNewContext('('+request.func.toString()+')(...args)',{...runtime.scope,TextDecoder,args:request.args});return[{frameId:0,result:plain(result)}];
  }}}};
}

for (const company of companies) test(`${company.code}: both source verifiers retain every included document with no Hub or file mutation`, async () => {
  const f = await sample(company), runtime = sourceRuntime(f), before = JSON.stringify(f);
  const page = await runtime.page(); assert.equal(page.current, true); assert.equal(page.bodySha256, f.context.originalBodySha256); assert.deepEqual(plain(page.identity.members), f.packet.review.members);
  const proof = await runtime.bridge(); assert.equal(proof.ok, true); assert.equal(proof.current, true); assert.ok(proof.sessionId); assert.equal(proof.identity.members.length, 2); assert.equal(Object.hasOwn(proof.identity, 'optionId'), false);
  assert.equal(JSON.stringify(proof).includes('synthetic-excluded'), false); assert.equal(runtime.calls.length, 8);
  assert.ok(runtime.calls.every(call => (call.init.method ?? 'GET') === 'GET' && call.init.credentials === 'same-origin' && call.init.redirect === 'error' && call.init.body === undefined));
  assert.equal(JSON.stringify(f), before);
  cases.push({ name: 'actual full source ' + company.code, included: 2, excluded: 1, readRequests: 8, hubRequests: 0 });
});

test('captured nullable profile remains queryless in both independent source verifiers', async () => {
  const f = await sample(companies[0], true); assert.equal(f.context.identity.profileId, null); assert.equal(f.context.identity.requestedProfileId, null);
  const runtime = sourceRuntime(f); await runtime.page(); assert.equal((await runtime.bridge()).current, true);
  const reads = runtime.calls.filter(call => call.path.includes('supplier-hub-single-package')); assert.equal(reads.length, 2); assert.ok(reads.every(call => !call.path.includes('?')));
  cases.push({ name: 'captured queryless source', implicitLiveProfileQueries: 0 });
});

test('changed second document, order, membership and fingerprints fail both verifiers without writes', async () => {
  const f = await sample(), mutations = [state => { state.prepared.payload.jsonDocument[1].productPage.modelNumber = 'unsaved'; },
    state => { state.prepared.payload.jsonDocument[1].productPage.commonAttributes.coupangSalePrice = '999'; }, state => { state.prepared.options.reverse(); },
    state => { state.prepared.options[1].optionLabel = 'changed'; }, state => { state.prepared.inputFingerprint = 'd'.repeat(64); },
    state => { state.prepared.source.quotationRevision++; }, state => { state.prepared.payload.jsonDocument.pop(); }];
  for (const mutate of mutations) {
    const runtime = sourceRuntime(f, { mutate: (state, count) => { if (count === 1) mutate(state); } }); await assert.rejects(runtime.page());
    const bridge = sourceRuntime(f, { mutate: (state, count) => { if (count === 1) mutate(state); } }); assert.equal((await bridge.bridge()).ok, false);
    assert.ok([...runtime.calls, ...bridge.calls].every(call => (call.init.method ?? 'GET') === 'GET'));
  }
  cases.push({ name: 'whole source identity failures', mutations: mutations.length, scalarFallbacks: 0, writes: 0 });
});

test('group and scalar trusted message contracts cannot be swapped', async () => {
  const f = await sample(), runtime = sourceRuntime(f);
  const scalar = await runtime.bridge(expected(f), 'YOOFAM_VERIFY_SINGLE_DOCUMENT_SOURCE'); assert.equal(scalar.ok, false); assert.equal(runtime.calls.length, 0);
  const mixed = plain(expected(f)); mixed.identity.optionId = 'synthetic-one'; const rejected = await runtime.bridge(mixed); assert.equal(rejected.ok, false); assert.equal(runtime.calls.length, 0);
  await assert.rejects(runtime.page(expected(f), false)); await assert.rejects(runtime.page(mixed, true));
  assert.equal(await runtime.bridge(expected(f), 'YOOFAM_VERIFY_PRODUCT_DOCUMENT_SOURCE', { id: 'foreign-extension' }), undefined);
  cases.push({ name: 'trusted group source lane', scalarContractSwitches: 0, foreignExtensionReads: 0 });
});

test('account changes and prior transmission block group proof while keeping source values untouched', async () => {
  const f = await sample();
  for (const mode of ['owner', 'company', 'after']) {
    const runtime = sourceRuntime(f, { mutate: (state, count) => { if (mode === 'after' ? count === 3 : count === 1) state.actor = mode === 'company' ? { ownerId: 'owner', company: companies[1] } : { ownerId: 'other-owner', company: companies[0] }; } });
    await assert.rejects(runtime.page());
  }
  const prior = sourceRuntime(f, { mutate: state => { state.blocked = true; } }); assert.equal((await prior.bridge()).ok, false);
  const malformed = sourceRuntime(f, { responsePatch: () => new Response('<html>login</html>', { headers: { 'content-type': 'text/html' } }) }); await assert.rejects(malformed.page());
  assert.ok([...prior.calls, ...malformed.calls].every(call => (call.init.method ?? 'GET') === 'GET'));
  cases.push({ name: 'account and history proof', accountVariants: 3, priorTransmissionBlocked: true, htmlRejected: true });
});

test('native receipt history rejects malformed or other operations and permits only exact document recovery', async () => {
  const f = await sample(), input = expected(f); input.docId = 'synthetic-current-document';
  const observation = { format: f.packet.review.format, requestId: f.packet.requestId, identity: f.context.identity, identityDigest: f.context.identityDigest, packetDigest: f.context.packetDigest,
    originalBodySha256: f.context.originalBodySha256, preparedBodySha256: f.context.bodySha256, state: 'pending', docId: input.docId, registered: false, success: false, needsRecovery: false,
    receipt: { state: 'pending', sourceStatus: 'SUBMITTED', docId: input.docId, company: f.prepared.company, identityDigest: f.context.identityDigest, preparedBodySha256: f.context.bodySha256,
      observedAt: Date.now(), receiptId: 'synthetic-qvt-current', qvtRequestId: 'synthetic-qvt-current', evidence: 'document-receipt', registered: false } };
  const receipt = { ...plain(await module('app/supplier-hub-product-receipt.ts').validateProductReceiptObservation(observation, f.packet.review, origin)), recordedAt: new Date().toISOString() };
  const exact = sourceRuntime(f); exact.state.native.receipts = [receipt]; assert.equal((await exact.bridge(input)).current, true);
  const mutations = [state => { state.native.format = 'unknown'; }, state => { state.native.receipts = {}; }, state => { state.native.receipts = [{ ...receipt, requestId: 'other-operation' }]; },
    state => { state.native.receipts = [{ ...receipt, packetDigest: 'e'.repeat(64) }]; }, state => { state.native.receipts = [{ ...receipt, docId: 'protected-prior-document' }]; },
    state => { state.native.receipts = [{ ...receipt, format: 'yoofam-single-receipt-v1', packetDigest: 'e'.repeat(64) }]; }];
  for (const mutate of mutations) { const runtime = sourceRuntime(f); mutate(runtime.state); assert.equal((await runtime.bridge(input)).ok, false); assert.ok(runtime.calls.every(call => (call.init.method ?? 'GET') === 'GET')); }
  const rejectedObservation=plain(observation);rejectedObservation.requestId='00000728-0728-4728-8728-000000000001';rejectedObservation.docId='synthetic-rejected-document';rejectedObservation.state='rejected';
  Object.assign(rejectedObservation.receipt,{docId:rejectedObservation.docId,state:'rejected',sourceStatus:'REJECTED',receiptId:'synthetic-rejected-qvt',qvtRequestId:'synthetic-rejected-qvt'});
  const rejected={...plain(await module('app/supplier-hub-product-receipt.ts').validateProductReceiptObservation(rejectedObservation,f.packet.review,origin)),recordedAt:new Date().toISOString()};
  const resubmit=sourceRuntime(f);resubmit.state.native.receipts=[rejected];assert.equal((await resubmit.bridge(expected(f))).current,true,'a coherent rejected native document permits a new request');
  const fakeRejections=[row=>{row.receipt.sourceStatus='FINISHED';},row=>{row.receipt.state='pending';},row=>{row.receipt.qvtRequestId='other-file';},row=>{row.receipt.docId='protected-other-document';},
    row=>{row.receipt.company=companies[1];},row=>{delete row.receipt.evidence;},row=>{row.receipt.registered=true;},row=>{row.receipt.skuId='invented';}];
  for(const mutate of fakeRejections){const runtime=sourceRuntime(f),row=plain(rejected);mutate(row);runtime.state.native.receipts=[row];assert.equal((await runtime.bridge(expected(f))).ok,false);}
  cases.push({name:'known rejected native resubmission',validRejectionAllowsNewRequest:true,fakeRejectionsBlocked:fakeRejections.length,pendingOrFinishedOtherOperationStillBlocked:true});
  cases.push({ name: 'native receipt scope', malformedAndOtherOperationsRejected: mutations.length, sameRequestDigestDocumentRecovery: true, writes: 0 });
});

for(const company of companies)test(`${company.code}: group preview independently verifies the current legacy app source without touching Hub or creating a receiver`,async()=>{
  const f=await sample(company),before=JSON.stringify(f),runtime=sourceRuntime(f),chrome=previewChrome(runtime);
  const preview=await withProductDocumentChrome(chrome.api,()=>dispatchProductDocument({type:'YOOFAM_PRODUCT_DOCUMENT_REQUEST',action:'preview',packet:f.packet},SINGLE_SENDER));
  assert.equal(preview.productId,f.id);assert.deepEqual(preview.members,f.packet.review.members);assert.equal(preview.preparedBodySha256,f.context.bodySha256);
  assert.equal(preview.draftPreparationAvailable,false);assert.equal(preview.preparedLifecycleAvailable,false);assert.deepEqual(Object.keys(preview).sort(),['format','requestId','identity','fingerprint','productId','members','identityDigest','packetDigest','reviewDigest','preparedBodySha256','originalBodySha256','liveVerified','draftPreparationAvailable','preparedLifecycleAvailable','remoteWrites','registered'].sort());
  assert.equal(preview.liveVerified,false);assert.equal(preview.remoteWrites,false);assert.equal(preview.registered,false);
  assert.equal(chrome.calls.filter(call=>call.name==='message').length,5);assert.ok(chrome.calls.some(call=>call.type==='YOOFAM_READ_LEGACY_PRODUCT_DOCUMENT_SOURCE'));assert.equal(chrome.calls.some(call=>call.name==='execute'),false);
  assert.ok(chrome.calls.every(call=>['get','message','execute'].includes(call.name)));assert.ok(runtime.calls.length>8);
  assert.ok(runtime.calls.every(call=>(call.init.method??'GET')==='GET'&&call.init.body===undefined));assert.equal(JSON.stringify(f),before);
  cases.push({name:'current legacy preview '+company.code,readRequests:runtime.calls.length,hubRequests:0,remoteWrites:0,receiversCreated:0});
});

test('changed legacy source or prior receipt rejects preview instead of returning a packet-only success',async()=>{
  const f=await sample();
  for(const change of [state=>{state.actor.ownerId='other-owner';},state=>{state.actor.company=companies[1];},state=>{state.blocked=true;},state=>{state.prepared.source.quotationRevision++;},state=>{state.prepared.payload.jsonDocument[1].productPage.modelNumber='new-unsaved';}]){
    const runtime=sourceRuntime(f,{mutate:(state,count)=>{if(count===1)change(state);}}),chrome=previewChrome(runtime);
    await assert.rejects(withProductDocumentChrome(chrome.api,()=>dispatchProductDocument({type:'YOOFAM_PRODUCT_DOCUMENT_REQUEST',action:'preview',packet:f.packet},SINGLE_SENDER)),{code:'SOURCE_CHANGED'});
    assert.ok(chrome.calls.every(call=>['get','message','execute'].includes(call.name)));assert.ok(runtime.calls.every(call=>(call.init.method??'GET')==='GET'));
  }
});

test('all live group operations remain unavailable without touching Chrome', async () => {
  const f = await sample(); const saved = Object.getOwnPropertyDescriptor(globalThis,'chrome'); let apiAccesses = 0;
  Object.defineProperty(globalThis, 'chrome', { configurable: true, get() { apiAccesses++; throw Error('unexpected Chrome operation'); } });
  try {
    for (const action of ['start', 'resume', 'recover', 'observe', 'confirm']) await assert.rejects(dispatchProductDocument({ type: 'YOOFAM_PRODUCT_DOCUMENT_REQUEST', action, packet: f.packet,
      ...(action === 'confirm' ? { confirmation: {} } : {}) }, SINGLE_SENDER), { code: 'PRODUCT_LIVE_CONTRACT_UNVERIFIED' });
    await assert.rejects(dispatchProductDocument({ type: 'YOOFAM_PRODUCT_DOCUMENT_REQUEST', action: 'start', packet: f.packet, liveVerified: true }, SINGLE_SENDER), { code: 'PRODUCT_ACTION' });
    await assert.rejects(dispatchProductDocument({ type: 'YOOFAM_PRODUCT_DOCUMENT_REQUEST', action: 'preview', packet: f.packet }, { ...SINGLE_SENDER, frameId: 1 }), { code: 'SENDER' });
    assert.equal(apiAccesses, 0); assert.equal(PRODUCT_DOCUMENT_LIVE_VERIFIED, false);
  } finally { if(saved)Object.defineProperty(globalThis,'chrome',saved);else delete globalThis.chrome; }
  cases.push({ name: 'release gate unchanged', members: 2, liveActionsRejected: 5, chromeReads: apiAccesses, falseReceipt: false });
});

class Bus {
  listeners = new Map(); addEventListener(type, fn) { const set = this.listeners.get(type) ?? new Set(); set.add(fn); this.listeners.set(type, set); }
  removeEventListener(type, fn) { this.listeners.get(type)?.delete(fn); }
  emit(type, props = {}) { for (const fn of this.listeners.get(type) ?? []) fn({ target: this, isTrusted: false, ...props }); }
}
test('actual closed-shadow human prompt describes the whole group and requires its own trusted choices', async () => {
  const f = await sample(), nodes = [], window = new Bus(), document = new Bus(); let closedRoot;
  class Node extends Bus {
    constructor(tag) { super(); this.tag = tag; this.children = []; this.checked = false; this.disabled = false; nodes.push(this); }
    get isConnected() { return this === document.documentElement || Boolean(this.parentNode?.isConnected); }
    get textContent() { return this._text ?? this.children.map(child => child.textContent).join(''); }
    set textContent(value) { this._text = String(value); }
    set innerHTML(value) { assert.fail('HTML insertion: ' + value); }
    appendChild(node) { node.parentNode = this; this.children.push(node); return node; }
    setAttribute() {} attachShadow(options) { assert.equal(options.mode, 'closed'); closedRoot = new Node('#shadow'); closedRoot.parentNode = this; return closedRoot; }
    focus() {} remove() { this.parentNode.children = this.parentNode.children.filter(child => child !== this); this.parentNode = null; }
  }
  document.documentElement = new Node('html'); document.createElement = tag => new Node(tag); document.visibilityState = 'visible';
  const scope = { document, window, Promise, Set, Object, Date, setTimeout, clearTimeout }; vm.runInNewContext(promptCode + '\nglobalThis.productPrompt=yoofamSingleConfirmation;', scope);
  const challenge = { stage: 'productPage', docId: 'synthetic-new-group-doc', expiresAt: Date.now() + 120000, items: [{ key: 'agreement', text: '<약관 원문>', title: '가격 약관', termsText: '<script>실행하지 않는 원문</script>', required: true }] };
  const result = scope.productPrompt.prompt({ identity: f.context.identity, challenge });
  assert.ok(closedRoot.textContent.includes('포함 옵션 2개')); assert.equal(closedRoot.textContent.includes('옵션 undefined'), false); assert.ok(closedRoot.textContent.includes(challenge.items[0].termsText));
  assert.equal(nodes.some(node => node.tag === 'script'), false);
  const box = nodes.find(node => node.tag === 'input'), confirm = nodes.find(node => node.tag === 'button' && node.textContent === '동의하고 다음 단계 계속'); assert.equal(box.checked, false); assert.equal(confirm.disabled, true);
  box.checked = true; box.emit('click'); assert.equal(box.checked, false); assert.equal(confirm.disabled, true);
  box.checked = true; box.emit('click', { isTrusted: true }); assert.equal(confirm.disabled, false); confirm.emit('click'); assert.equal(document.documentElement.children.length, 1);
  confirm.emit('click', { isTrusted: true }); assert.equal(await result, true); assert.equal(document.documentElement.children.length, 0);
  cases.push({ name: 'whole group human prompt', includedLabel: 2, implicitAgreement: false, untrustedClicksAccepted: false, htmlExecuted: false });
});
