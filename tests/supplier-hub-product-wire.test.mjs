import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createHash } from 'node:crypto';

const root = new URL('../', import.meta.url), read = file => fs.readFileSync(new URL(file, root), 'utf8');
const content = read('extensions/supplier-hub/handoff-content.js'), worker = read('extensions/supplier-hub/handoff-worker.mjs').replace(/^import .*;\r?\n/gm, '');
const origin = 'http://localhost:3000', outerId = 'f0abeef0-0728-4abe-8eee-000000000728', cases = [];
const plain = value => JSON.parse(JSON.stringify(value));
function bridge(version = '0.2.79') {
  const listeners = [], messages = [], replies = [], window = { addEventListener(type, listener) { if (type === 'message') listeners.push(listener); }, postMessage(message, target) { replies.push({ message: plain(message), target }); } };
  vm.runInNewContext(content, { window, location: { origin }, chrome: { runtime: { getManifest: () => ({ version }), onMessage: { addListener() {} },
    async sendMessage(message) { messages.push(message); return { ok: true, result: { remoteWrites: false, registered: false } }; } } } });
  return { window, messages, replies, async emit(type, payload, patch = {}) { return listeners[0]({ source: window, origin, data: { channel: 'YOOFAM_HUB_HANDOFF', requestId: outerId, type, payload }, ...patch }); } };
}
after(() => {
  const paths = ['extensions/supplier-hub/handoff-content.js', 'extensions/supplier-hub/handoff-worker.mjs', 'extensions/supplier-hub/manifest.json', 'scripts/package-supplier-hub-extension.mjs', 'tests/supplier-hub-product-wire.test.mjs'];
  fs.writeFileSync(new URL('outputs/step728-product-wire-proof.json', root), JSON.stringify({ sourceHashes: Object.fromEntries(paths.map(file => [file, createHash('sha256').update(read(file)).digest('hex')])), cases,
    boundary: 'Actual handoff-content and worker source executed in isolated VM. Message routing and manifest/download agreement only; no Chrome, Hub, 1688, native mutation or receipt.',
    externalRequests: 0, realProductWrites: 0, hubWrites: 0 }, null, 2) + '\n');
});

test('full product bridge keeps the nested whole-group packet and exact reply correlation', async () => {
  const f = bridge(), packet = { type: 'YOOFAM_PRODUCT_DOCUMENT_REQUEST', version: 1, requestId: outerId, createdAt: 1,
    review: { identity: { ownerId: 'owner' }, members: [{ optionId: 'one', documentIndex: 0 }, { optionId: 'two', documentIndex: 1 }], body: { jsonDocument: [{ saved: '' }, { saved: 'second' }] } } };
  const payload = { type: 'untrusted-override', action: 'preview', packet };
  await f.emit('PRODUCT_DOCUMENT', payload);
  assert.equal(f.messages.length, 1); assert.equal(f.messages[0].type, 'YOOFAM_PRODUCT_DOCUMENT_REQUEST'); assert.equal(f.messages[0].action, 'preview');
  assert.equal(f.messages[0].packet, packet); assert.equal(f.messages[0].packet.review.body.jsonDocument.length, 2); assert.equal(Object.hasOwn(f.messages[0], 'optionId'), false);
  assert.deepEqual(f.replies, [{ message: { channel: 'YOOFAM_HUB_HANDOFF_RESULT', requestId: outerId, result: { ok: true, result: { remoteWrites: false, registered: false } } }, target: origin }]);
  cases.push({ name: 'whole nested bridge', included: 2, scalarFallback: false, automaticAction: false });
});

test('foreign sources, origins, channels and malformed correlations never reach the worker', async () => {
  const f = bridge(), payload = { action: 'preview', packet: { type: 'YOOFAM_PRODUCT_DOCUMENT_REQUEST' } };
  for (const patch of [{ source: {} }, { origin: 'https://foreign.example' }, { data: { channel: 'other', type: 'PRODUCT_DOCUMENT', requestId: outerId, payload } },
    { data: { channel: 'YOOFAM_HUB_HANDOFF', type: 'PRODUCT_DOCUMENT', requestId: 'invalid', payload } }, { data: { channel: 'YOOFAM_HUB_HANDOFF', type: 'unknown', requestId: outerId, payload } }]) await f.emit('PRODUCT_DOCUMENT', payload, patch);
  assert.equal(f.messages.length, 0); assert.equal(f.replies.length, 0);
  cases.push({ name: 'source origin correlation', rejectedMessages: 5, workerCalls: 0 });
});

test('read-only PING advertises group preview only after the supporting installed manifest version', async () => {
  for (const [version, expected] of [['0.2.72', false], ['0.2.78', false], ['0.2.79', true], ['0.3.0', true], ['1.0.0', true]]) {
    const f = bridge(version); await f.emit('PING', null); assert.equal(f.messages.length, 0); assert.equal(f.replies[0].message.result.version, version);
    assert.equal(f.replies[0].message.result.productDocumentPreview, expected); assert.equal(Object.hasOwn(f.replies[0].message.result, 'productDocumentLiveVerified'), false);
  }
  cases.push({ name: 'installed release capability', versionsChecked: 5, remoteRequests: 0, nativeGateAdvertisement: false });
});

test('legacy scalar and explicit agreement routing remain distinct from group preview', async () => {
  const f = bridge(), scalar = { action: 'preview', packet: { type: 'YOOFAM_SINGLE_DOCUMENT_TRANSPORT', optionId: 'one' } };
  await f.emit('SINGLE_DOCUMENT', scalar); assert.equal(f.messages[0].type, 'YOOFAM_SINGLE_DOCUMENT_REQUEST'); assert.equal(f.messages[0].packet, scalar.packet);
  const confirmation = { action: 'confirm-and-submit', userInitiated: true }, grouped = { action: 'confirm', packet: { type: 'YOOFAM_PRODUCT_DOCUMENT_REQUEST' }, confirmation };
  await f.emit('PRODUCT_DOCUMENT', grouped); assert.equal(f.messages[1].type, 'YOOFAM_PRODUCT_DOCUMENT_REQUEST'); assert.equal(f.messages[1].confirmation, confirmation);
  assert.equal(f.messages.length, 2); assert.equal(f.replies.length, 2);
  cases.push({ name: 'explicit independent lanes', implicitConfirmations: 0, implicitDispatches: 0 });
});

function workerFixture(error) {
  let handler; const calls = [], context = { chrome: { runtime: { onMessage: { addListener(listener) { handler = listener; } } } },
    dispatchProductDocument: async (message, sender) => { calls.push({ message, sender }); if (error) throw error; return { format: 'group-preview', remoteWrites: false, registered: false }; },
    dispatchSingleDocument: () => assert.fail('The group request used the scalar lane') };
  vm.runInNewContext(worker, context);
  return { calls, handler, async run(message, sender) { return new Promise(resolve => assert.equal(handler(message, sender, resolve), true)); } };
}
test('worker routes the exact group request and sender only to its separate dispatcher', async () => {
  const f = workerFixture(), message = { type: 'YOOFAM_PRODUCT_DOCUMENT_REQUEST', action: 'preview', packet: { review: { members: [{ optionId: 'one' }, { optionId: 'two' }] } } }, sender = { frameId: 0, tab: { id: 7, windowId: 17 } };
  const response = await f.run(message, sender); assert.deepEqual(plain(response), { ok: true, result: { format: 'group-preview', remoteWrites: false, registered: false } });
  assert.equal(f.calls.length, 1); assert.equal(f.calls[0].message, message); assert.equal(f.calls[0].sender, sender);
  assert.equal(f.handler({ type: 'unrecognized-group-request' }, sender, () => assert.fail()), undefined); assert.equal(f.calls.length, 1);
  cases.push({ name: 'isolated worker dispatcher', exactSenderPreserved: true, scalarCalls: 0, autoRetries: 0 });
});

test('worker preserves group failure identity without falling back or inferring success', async () => {
  const error = Object.assign(Error('전체 문서 검증 실패'), { code: 'PRODUCT_SOURCE_CHANGED' }), f = workerFixture(error);
  const response = await f.run({ type: 'YOOFAM_PRODUCT_DOCUMENT_REQUEST', action: 'preview', packet: {} }, { frameId: 0 });
  assert.deepEqual(plain(response), { ok: false, error: error.message, code: error.code }); assert.equal(f.calls.length, 1); assert.equal(Object.hasOwn(response, 'result'), false);
  cases.push({ name: 'group failure relay', retries: 0, falseReceipts: 0 });
});

test('unified release unions sales permissions while retaining quotation app origins, and all app downloads target the prepared release', () => {
  const manifest = JSON.parse(read('extensions/supplier-hub/manifest.json')); assert.match(manifest.version, /^\d+\.\d+\.\d+$/);
  assert.deepEqual(manifest.permissions, ['activeTab', 'scripting', 'tabs', 'webRequest', 'declarativeNetRequestWithHostAccess','cookies','storage']);
  assert.deepEqual(manifest.host_permissions, ['https://detail.1688.com/*', 'https://m.1688.com/*', 'https://h5api.m.1688.com/*', 'https://itemcdn.tmall.com/1688offer/*', 'https://supplier.coupang.com/*','https://www.coupang.com/*','https://wing.coupang.com/*']);
  assert.deepEqual(manifest.content_scripts.slice(0,2), [{matches:['https://detail.1688.com/offer/*.html*'],js:['page-collector.js'],run_at:'document_idle',all_frames:false},{ matches: ['https://sourceflow.jjwwhhjj1116.workers.dev/*', 'http://localhost:3000/*', 'http://127.0.0.1:3000/*'], js: ['handoff-content.js', 'single-confirmation.js', 'single-content.js','native-source-content.js'] }]);
  const download = '/downloads/yoofam-plus-supplier-hub-extension-' + manifest.version + '.zip';
  for (const file of ['app/components/intake-queue-panel.tsx', 'app/components/submission-package.tsx', 'app/components/supplier-hub-category-browser.tsx', 'app/components/supplier-hub-extension-check.tsx', 'app/components/source-inbox-panel.tsx']) {
    const code = read(file); assert.ok(code.includes(download), file); assert.equal(code.includes('0.2.78'), false, file);
  }
  const minimumCompatibleVersion=/info\.version\.localeCompare\('(\d+\.\d+\.\d+)'/.exec(read('app/components/supplier-hub-extension-check.tsx'))?.[1];
  assert.equal(minimumCompatibleVersion,'2.1.53');assert.ok(manifest.version.localeCompare(minimumCompatibleVersion,'en',{numeric:true})>=0);
  cases.push({ name: 'release and scope', version: manifest.version, minimumCompatibleVersion, newPermissions: 2, newHosts: 2, downloadComponents: 5 });
});
