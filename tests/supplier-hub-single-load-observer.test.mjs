import test from 'node:test';
import assert from 'node:assert/strict';
import { observeSingleDraftLoad } from '../extensions/supplier-hub/single-load-observer.mjs';
import { SingleDocumentError } from '../extensions/supplier-hub/single-document.mjs';

const origin = 'https://supplier.coupang.com';
const names = ['onBeforeRequest', 'onCompleted', 'onErrorOccurred', 'onBeforeRedirect'];
const base = { tabId: 42, documentId: '11111111-2222-3333-4444-555555555555', docId: 'new-655', timeoutMs: 50 };
const deferred = () => { let resolve; return { promise: new Promise(done => { resolve = done; }), resolve: value => resolve(value) }; };
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const unconfirmed = error => error instanceof SingleDocumentError && error.code === 'LOAD_OBSERVATION_UNCONFIRMED';
const before = (overrides = {}) => ({ tabId: base.tabId, frameId: 0, documentId: base.documentId,
  documentLifecycle: 'active', frameType: 'outermost_frame', initiator: origin, method: 'GET', type: 'xmlhttprequest',
  url: origin + '/sr/draft/api/get-by-id/' + encodeURIComponent(String(base.docId)), requestId: 'request_655-1', timeStamp: 10000, ...overrides });
const completed = (overrides = {}) => ({ ...before(), timeStamp: 10001, statusCode: 200, fromCache: false,
  responseHeaders: [{ name: 'Content-Type', value: 'application/json; charset=utf-8' }], ...overrides });

/** Synthetic Chrome event bus only. It keeps callback identities/filter requests
 * for cleanup assertions, but does not retain any emitted headers or body. */
function bus({ failAdd, failAfterAdd = false, failRemove } = {}) {
  const registered = new Map(names.map(name => [name, new Set()])), adds = [], removes = [];
  const registrationError = Error('synthetic listener registration failure');
  const api = { webRequest: Object.fromEntries(names.map(name => [name, {
    addListener(callback, filter, extraInfoSpec) {
      adds.push({ name, callback, filter: structuredClone(filter), extraInfoSpec: extraInfoSpec && [...extraInfoSpec] });
      if (name === failAdd && !failAfterAdd) throw registrationError;
      registered.get(name).add(callback);
      if (name === failAdd) throw registrationError;
    },
    removeListener(callback) {
      removes.push({ name, callback });
      registered.get(name).delete(callback);
      if (name === failRemove) throw Error('synthetic listener cleanup failure');
    },
  }])) };
  return { api, adds, removes, registrationError, emit(name, details) { for (const listener of [...registered.get(name)]) listener(details); },
    count() { return [...registered.values()].reduce((sum, values) => sum + values.size, 0); } };
}
function start(b, dispatch, overrides = {}) { return observeSingleDraftLoad({ ...base, api: b.api, ...overrides }, dispatch); }
function good(b) { b.emit('onBeforeRequest', before()); b.emit('onCompleted', completed()); }
function clean(b) { assert.equal(b.count(), 0, 'all attempted listeners must be removed'); }

test('observing one exact direct response returns only load metadata and retains no sensitive headers/body', async () => {
  const b = bus(), loaded = { loaded: true, docId: base.docId }; let dispatches = 0;
  const secret = 'fixture-cookie-and-authorization-655';
  const result = await start(b, async () => {
    dispatches++; assert.equal(b.count(), 4, 'all listeners must precede the page click');
    b.emit('onBeforeRequest', before({ requestHeaders: [{ name: 'Cookie', value: secret }], requestBody: { raw: [{ bytes: secret }] } }));
    b.emit('onCompleted', completed({ responseHeaders: [{ name: 'Content-Type', value: 'application/json; charset=utf-8' },
      { name: 'Set-Cookie', value: secret }, { name: 'Authorization', value: secret }], responseBody: secret }));
    return loaded;
  });
  assert.deepEqual(result, { loaded, observation: { docId: base.docId, requestId: 'request_655-1', documentId: base.documentId,
    tabId: 42, frameId: 0, statusCode: 200, fromCache: false, contentType: 'application/json; charset=utf-8',
    url: origin + '/sr/draft/api/get-by-id/new-655' } });
  assert.equal(JSON.stringify(result).includes(secret), false); assert.equal(dispatches, 1);
  for (const registration of b.adds) {
    assert.deepEqual(registration.filter, { urls: [origin + '/sr/draft/api/get-by-id/*'], types: ['xmlhttprequest'], tabId: 42 });
    assert.deepEqual(registration.extraInfoSpec, registration.name === 'onCompleted' ? ['responseHeaders'] : undefined);
    assert.ok(!registration.extraInfoSpec?.some(value => ['requestHeaders', 'requestBody', 'blocking', 'extraHeaders'].includes(value)));
  }
  assert.deepEqual(b.removes.map(value => value.name), [...names].reverse()); clean(b);
});

test('positive numeric document IDs and encoded string IDs preserve the exact requested identity', async () => {
  for (const docId of [655, 'new owned/id']) {
    const b = bus(), url = origin + '/sr/draft/api/get-by-id/' + encodeURIComponent(String(docId));
    const result = await start(b, () => { b.emit('onBeforeRequest', before({ url })); b.emit('onCompleted', completed({ url })); return 'loaded'; }, { docId });
    assert.equal(result.observation.docId, docId); assert.equal(result.observation.url, url); clean(b);
  }
});

for (const [field, value] of [['url', origin + '/sr/draft/api/get-by-id/existing-other'], ['url', origin + '/sr/draft/api/get-by-id/new-655?other=1'],
  ['documentId', 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'], ['documentLifecycle', 'prerender'], ['frameType', 'sub_frame'],
  ['initiator', 'chrome-extension://synthetic'], ['initiator', 'https://other.test'], ['method', 'POST'], ['type', 'main_frame']]) {
  test(`a mismatching request ${field}=${value} never produces a load observation`, async () => {
    const b = bus(); await assert.rejects(start(b, () => { b.emit('onBeforeRequest', before({ [field]: value })); b.emit('onCompleted', completed()); return true; }), unconfirmed); clean(b);
  });
}

test('other tabs and child frames are ignored without poisoning a later exact top-frame response', async () => {
  const b = bus(); const result = await start(b, () => {
    for (const scope of [{ tabId: 99 }, { frameId: 1 }, { tabId: 99, frameId: 1 }]) for (const name of names) b.emit(name,
      name === 'onCompleted' ? completed({ ...scope, statusCode: 500 }) : before({ ...scope, url: origin + '/sr/draft/api/get-by-id/other' }));
    good(b); return true;
  }); assert.equal(result.observation.tabId, 42); assert.equal(result.observation.frameId, 0); clean(b);
});

for (const overrides of [{ tabId: 99 }, { frameId: 1 }]) test(`wrong ${Object.keys(overrides)[0]} cannot satisfy the selected page's timeout`, async () => {
  const b = bus(); await assert.rejects(start(b, () => { b.emit('onBeforeRequest', before(overrides)); b.emit('onCompleted', completed(overrides)); return true; }, { timeoutMs: 5 }), unconfirmed); clean(b);
});

for (const [name, overrides] of [
  ['wrong document UUID', { documentId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee' }], ['wrong request ID', { requestId: 'another' }],
  ['wrong initiator', { initiator: 'https://other.test' }], ['wrong method', { method: 'POST' }], ['wrong type', { type: 'fetch' }],
  ['wrong document URL', { url: origin + '/sr/draft/api/get-by-id/other' }], ['inactive document', { documentLifecycle: 'cached' }],
  ['not outermost frame', { frameType: 'sub_frame' }], ['status 201', { statusCode: 201 }], ['redirect status', { statusCode: 302 }],
  ['cache response', { fromCache: true }], ['unknown cache flag', { fromCache: undefined }],
  ['HTML response', { responseHeaders: [{ name: 'Content-Type', value: 'text/html' }] }],
  ['JSON prefix only', { responseHeaders: [{ name: 'Content-Type', value: 'application/jsonp' }] }],
  ['missing Content-Type', { responseHeaders: [] }], ['missing headers', { responseHeaders: undefined }],
  ['nonstring content type', { responseHeaders: [{ name: 'Content-Type', value: 655 }] }],
  ['duplicate Content-Type', { responseHeaders: [{ name: 'Content-Type', value: 'application/json' }, { name: 'content-type', value: 'application/json' }] }],
]) test(`completion refuses ${name}`, async () => {
  const b = bus(); await assert.rejects(start(b, () => { b.emit('onBeforeRequest', before()); b.emit('onCompleted', completed(overrides)); return true; }), unconfirmed); clean(b);
});

test('header name/MIME case is supported while malformed non-header entries are discarded', async () => {
  const b = bus(); const result = await start(b, () => {
    b.emit('onBeforeRequest', before()); b.emit('onCompleted', completed({ responseHeaders: [null, undefined, { name: 7 },
      { name: 'content-TYPE', value: 'APPLICATION/JSON; charset=UTF-8' }] })); return true;
  }); assert.equal(result.observation.contentType, 'APPLICATION/JSON; charset=UTF-8'); clean(b);
});

for (const value of [0, -1, NaN, Infinity, '10000']) test(`invalid request timestamp ${String(value)} cannot establish an observation`, async () => {
  const b = bus(); await assert.rejects(start(b, () => { b.emit('onBeforeRequest', before({ timeStamp: value })); b.emit('onCompleted', completed()); return true; }), unconfirmed); clean(b);
});

for (const value of [0, -1, NaN, Infinity, '10001', 9999]) test(`invalid or preceding completion timestamp ${String(value)} is refused`, async () => {
  const b = bus(); await assert.rejects(start(b, () => { b.emit('onBeforeRequest', before()); b.emit('onCompleted', completed({ timeStamp: value })); return true; }), unconfirmed); clean(b);
});

for (const value of ['', 'bad.request', 'x'.repeat(201), 655]) test(`malformed request identifier ${String(value).slice(0, 20)} is refused`, async () => {
  const b = bus(); await assert.rejects(start(b, () => { b.emit('onBeforeRequest', before({ requestId: value })); b.emit('onCompleted', completed()); return true; }), unconfirmed); clean(b);
});

test('completion before start and repeated start events never resolve as successful', async () => {
  for (const emit of [b => b.emit('onCompleted', completed()), b => { b.emit('onBeforeRequest', before()); b.emit('onBeforeRequest', before()); b.emit('onCompleted', completed()); }]) {
    const b = bus(); await assert.rejects(start(b, () => { emit(b); return true; }), unconfirmed); clean(b);
  }
});

for (const name of ['onBeforeRequest', 'onCompleted', 'onErrorOccurred', 'onBeforeRedirect']) test(`a later ${name} event before page dispatch resolves invalidates a completed observation`, async () => {
  const b = bus(), gate = deferred(); let settled = false;
  const operation = start(b, async () => { good(b); await gate.promise; return true; });
  operation.then(() => { settled = true; }, () => { settled = true; }); await wait(0); assert.equal(settled, false);
  b.emit(name, name === 'onCompleted' ? completed({ timeStamp: 10002 }) : before({ timeStamp: 10002 }));
  gate.resolve(); await assert.rejects(operation, unconfirmed); clean(b);
});

for (const name of ['onBeforeRedirect', 'onErrorOccurred']) test(`${name} rejects a selected-page load both before and after its start event`, async () => {
  for (const started of [false, true]) {
    const b = bus(); await assert.rejects(start(b, () => { if (started) b.emit('onBeforeRequest', before()); b.emit(name, before()); return true; }), unconfirmed); clean(b);
  }
});

test('a dispatch exception propagates only after every observer listener is removed', async () => {
  const b = bus(), cause = Error('synthetic read-only page callback failed');
  await assert.rejects(start(b, async () => { throw cause; }), error => error === cause); clean(b);
  assert.deepEqual(b.removes.map(value => value.name), [...names].reverse());
});

test('timeout removes all listeners when the page returns without a matching load response', async () => {
  const b = bus(); await assert.rejects(start(b, () => 'page callback returned', { timeoutMs: 5 }), unconfirmed); clean(b);
});

test('absolute timeout returns and cleans listeners even while the page dispatch remains unresolved', async () => {
  const b = bus(), gate = deferred(); const operation = start(b, () => gate.promise, { timeoutMs: 5 });
  const settled = operation.then(() => ({ success: true }), error => ({ error }));
  try {
    const result = await Promise.race([settled, wait(250).then(() => ({ hung: true }))]);
    assert.equal(result.hung, undefined, 'deadline must not wait for dispatch to finish'); assert.ok(unconfirmed(result.error)); clean(b);
    assert.equal(b.removes.length, 4, 'cleanup precedes delayed page dispatch completion');
  } finally { gate.resolve('late page return'); await settled; }
});

test('late dispatch rejection after timeout is contained and never recreates listeners', async () => {
  const b = bus(); let fail; const dispatch = new Promise((_, reject) => { fail = reject; });
  await assert.rejects(start(b, () => dispatch, { timeoutMs: 5 }), unconfirmed); clean(b);
  fail(Error('late callback failure')); await wait(0); clean(b);
});

for (const scenario of ['wrong identity', 'redirect', 'error', 'duplicate completion']) test(`${scenario} stops and cleans immediately while dispatch remains pending`, async () => {
  const b = bus(), gate = deferred(); const operation = start(b, () => gate.promise, { timeoutMs: 1000 });
  const settled = operation.then(() => ({ success: true }), error => ({ error }));
  try {
    if (scenario === 'duplicate completion') { good(b); b.emit('onCompleted', completed({ timeStamp: 10002 })); }
    else if (scenario === 'wrong identity') b.emit('onBeforeRequest', before({ documentId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee' }));
    else b.emit(scenario === 'redirect' ? 'onBeforeRedirect' : 'onErrorOccurred', before());
    const result = await Promise.race([settled, wait(150).then(() => ({ hung: true }))]);
    assert.equal(result.hung, undefined, 'known invalid observation must not wait for dispatch or its one-second deadline');
    assert.ok(unconfirmed(result.error)); clean(b); assert.equal(b.removes.length, 4);
  } finally { gate.resolve('late dispatch'); await settled; }
});

for (const invalid of [{ api: {} }, { tabId: -1 }, { tabId: 1.5 }, { documentId: 'not-a-document-uuid' }, { docId: 0 }, { docId: '' },
  { docId: ' new-655' }, { docId: 'x'.repeat(201) }, { timeoutMs: 0 }, { timeoutMs: 30001 }, { timeoutMs: NaN }]) {
  test(`unavailable API or invalid ${Object.keys(invalid)[0]} stops before listener installation or page dispatch`, async () => {
    const b = bus(); let dispatched = 0; await assert.rejects(start(b, () => { dispatched++; }, invalid), unconfirmed);
    assert.equal(dispatched, 0); assert.equal(b.adds.length, 0); clean(b);
  });
}

test('missing one event method and a nonfunction dispatch cannot install a partial observer', async () => {
  for (const event of names) for (const method of ['addListener', 'removeListener']) {
    const b = bus(); delete b.api.webRequest[event][method]; await assert.rejects(start(b, () => assert.fail('unavailable API cannot dispatch')), unconfirmed); assert.equal(b.adds.length, 0); clean(b);
  }
  const b = bus(); await assert.rejects(start(b, null), unconfirmed); assert.equal(b.adds.length, 0); clean(b);
});

for (const name of names) test(`partial registration failure at ${name} cleans all earlier listeners and does not dispatch`, async () => {
  const b = bus({ failAdd: name }); let dispatched = 0;
  await assert.rejects(start(b, () => { dispatched++; }), error => error === b.registrationError);
  assert.equal(dispatched, 0); clean(b); assert.equal(b.removes.length, names.indexOf(name) + 1, 'cleanup includes the attempted registration');
  assert.deepEqual(b.removes.map(value => value.name), names.slice(0, names.indexOf(name) + 1).reverse());
});

test('registration that throws after subscribing still removes the attempted callback', async () => {
  const b = bus({ failAdd: 'onErrorOccurred', failAfterAdd: true }); let dispatched = 0;
  await assert.rejects(start(b, () => { dispatched++; }), error => error === b.registrationError);
  assert.equal(dispatched, 0); clean(b);
});

test('listener cleanup failure rejects completion but still attempts every remaining removal', async () => {
  const b = bus({ failRemove: 'onErrorOccurred' }); await assert.rejects(start(b, () => { good(b); return true; }), unconfirmed);
  assert.deepEqual(b.removes.map(value => value.name), [...names].reverse()); clean(b);
});
