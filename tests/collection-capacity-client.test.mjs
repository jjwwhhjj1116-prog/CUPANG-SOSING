import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const url = '/api/collection-jobs/job/capacity';
const capacity = { usedSlots: 0, totalImages: 1, reusableIndices: [] };
const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function observe(promise) {
  let settled = false;
  const outcome = promise.then(value => { settled = true; return { value }; }, error => { settled = true; return { error }; });
  return { outcome, get settled() { return settled; } };
}
function fixture() {
  let now = 0, nextId = 0;
  const timers = new Map();
  const scheduled = [];
  const setTimer = (callback, delay = 0, ...args) => {
    const id = ++nextId;
    scheduled.push(delay);
    timers.set(id, { due: now + delay, callback, args });
    return id;
  };
  const clearTimer = id => timers.delete(id);
  const clock = {
    scheduled,
    get pending() { return timers.size; },
    async advance(milliseconds) {
      const target = now + milliseconds;
      for (;;) {
        const first = [...timers].filter(([, timer]) => timer.due <= target).sort((a, b) => a[1].due - b[1].due || a[0] - b[0])[0];
        if (!first) break;
        const [id, timer] = first;
        now = timer.due;
        timers.delete(id);
        timer.callback(...timer.args);
        await flush();
      }
      now = target;
      await flush();
    },
  };
  class Clock extends Date { static now() { return now; } }
  const modules = new Map();
  function load(file) {
    if (modules.has(file)) return modules.get(file);
    const exports = {};
    modules.set(file, exports);
    vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../' + file, import.meta.url), 'utf8'), {
      fileName: file,
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText, {
      exports, Error, TypeError, DOMException, Promise, Date: Clock,
      AbortController, AbortSignal, Response, Headers,
      setTimeout: setTimer, clearTimeout: clearTimer, queueMicrotask,
      require: name => load(name.slice(2) + '.ts'),
    });
    return exports;
  }
  return { ...load('app/collection-capacity-client.ts'), clock, wait: milliseconds => new Promise(resolve => setTimer(resolve, milliseconds)) };
}
function stalledBody(status = 200) {
  const body = deferred();
  const response = new Response(null, { status, headers: { 'x-capacity-proof': 'same-response' } });
  let reads = 0;
  response.json = () => { reads++; return body.promise; };
  return { response, body, get reads() { return reads; } };
}
function assertError(error, type) {
  assert.ok(error, 'the request must reject');
  assert.ok(error instanceof type, `the error must be ${type.name}`);
}
const options = { timeout: 2000 };

test('capacity default is five seconds and successful cached JSON clears the deadline and abort listener', options, async () => {
  const h = fixture();
  assert.equal(h.COLLECTION_CAPACITY_TIMEOUT_MS, 5000);
  const controller = new AbortController();
  const listeners = new Set();
  const add = controller.signal.addEventListener.bind(controller.signal);
  const remove = controller.signal.removeEventListener.bind(controller.signal);
  controller.signal.addEventListener = (type, listener, settings) => { if (type === 'abort') listeners.add(listener); return add(type, listener, settings); };
  controller.signal.removeEventListener = (type, listener, settings) => { if (type === 'abort') listeners.delete(listener); return remove(type, listener, settings); };
  const original = Response.json({ capacity });
  const read = original.json.bind(original);
  let reads = 0, fetchSignal;
  original.json = () => { reads++; return read(); };
  const response = await h.fetchCollectionCapacity(url, { signal: controller.signal, fetcher: async (path, init) => {
    assert.equal(path, url); fetchSignal = init.signal; return original;
  } });
  const first = await response.json();
  assert.deepEqual(first, { capacity });
  assert.equal(await response.json(), first);
  assert.equal(reads, 1);
  assert.equal(h.clock.pending, 0);
  assert.equal(listeners.size, 0);
  assert.ok(h.clock.scheduled.includes(5000));
  await h.clock.advance(5000);
  assert.equal(fetchSignal.aborted, false);
});

test('never-settling headers time out at the default deadline and abort the underlying fetch', options, async () => {
  const h = fixture(), request = deferred();
  let signal;
  const pending = observe(h.fetchCollectionCapacity(url, { fetcher: async (_path, init) => { signal = init.signal; return request.promise; } }));
  await flush();
  await h.clock.advance(4999);
  assert.equal(pending.settled, false);
  assert.equal(signal.aborted, false);
  await h.clock.advance(1);
  assertError((await pending.outcome).error, h.CollectionCapacityTimeout);
  assert.equal(signal.aborted, true);
  assert.equal(h.clock.pending, 0);
});

test('never-settling successful JSON returns the known status with a cached timeout rejection', options, async () => {
  const h = fixture(), source = stalledBody();
  const pending = observe(h.fetchCollectionCapacity(url, { timeoutMs: 100, fetcher: async () => source.response }));
  await flush();
  assert.equal(source.reads, 1);
  await h.clock.advance(100);
  const { value: response, error } = await pending.outcome;
  assert.equal(error, undefined);
  assert.equal(response.status, 200);
  assert.equal(response.ok, true);
  const first = await response.json().catch(cause => cause);
  assertError(first, h.CollectionCapacityTimeout);
  assert.equal(await response.json().catch(cause => cause), first);
  assert.equal(h.clock.pending, 0);
});

test('one deadline covers delayed headers and the final JSON body without starting a second allowance', options, async () => {
  const h = fixture(), headers = deferred(), source = stalledBody();
  const pending = observe(h.fetchCollectionCapacity(url, { fetcher: async () => headers.promise }));
  await flush();
  await h.clock.advance(4000);
  headers.resolve(source.response);
  await flush();
  assert.equal(source.reads, 1);
  await h.clock.advance(999);
  assert.equal(pending.settled, false);
  await h.clock.advance(1);
  const { value: response } = await pending.outcome;
  assert.equal(response.status, 200);
  await assert.rejects(response.json(), h.CollectionCapacityTimeout);
  assert.equal(h.clock.scheduled.filter(delay => delay === 5000).length, 1);
});

test('retry backoff and a later stalled fetch share the original total deadline', options, async () => {
  const h = fixture(), first = deferred(), second = deferred();
  let calls = 0;
  const pending = observe(h.fetchCollectionCapacity(url, { attempts: 3, retryWait: h.wait, fetcher: async () => {
    calls++; return calls === 1 ? first.promise : second.promise;
  } }));
  await flush();
  await h.clock.advance(3000);
  first.resolve(new Response(null, { status: 503 }));
  await flush();
  await h.clock.advance(500);
  assert.equal(calls, 2);
  await h.clock.advance(1499);
  assert.equal(pending.settled, false);
  await h.clock.advance(1);
  assertError((await pending.outcome).error, h.CollectionCapacityTimeout);
  second.resolve(new Response(null, { status: 503 }));
  await flush();
  await h.clock.advance(10000);
  assert.equal(calls, 2);
  assert.equal(h.clock.pending, 0);
});

test('parent abort rejects immediately as cancellation and prevents a later retry after backoff settles', options, async () => {
  const h = fixture(), controller = new AbortController(), backoff = deferred();
  let calls = 0, signal;
  const pending = observe(h.fetchCollectionCapacity(url, { attempts: 3, signal: controller.signal, retryWait: () => backoff.promise,
    fetcher: async (_path, init) => { calls++; signal = init.signal; return new Response(null, { status: 503 }); },
  }));
  await flush();
  assert.equal(calls, 1);
  controller.abort();
  await flush();
  assertError((await pending.outcome).error, h.CollectionCapacityCancelled);
  assert.equal(signal.aborted, true);
  assert.equal(h.clock.pending, 0);
  backoff.resolve();
  await flush();
  await h.clock.advance(10000);
  assert.equal(calls, 1);
});

test('an already-aborted parent never starts a capacity request', options, async () => {
  const h = fixture(), controller = new AbortController();
  controller.abort();
  let calls = 0;
  await assert.rejects(h.fetchCollectionCapacity(url, { signal: controller.signal, fetcher: async () => { calls++; return Response.json({ capacity }); } }), h.CollectionCapacityCancelled);
  assert.equal(calls, 0);
  assert.equal(h.clock.pending, 0);
});

test('parent abort during JSON consumption rejects as cancellation despite already-known authority headers', options, async () => {
  const h = fixture(), controller = new AbortController(), source = stalledBody(403);
  const pending = observe(h.fetchCollectionCapacity(url, { signal: controller.signal, fetcher: async () => source.response }));
  await flush();
  assert.equal(source.reads, 1);
  controller.abort();
  await flush();
  assertError((await pending.outcome).error, h.CollectionCapacityCancelled);
  source.body.resolve({ error: 'denied' });
  await flush();
  assert.equal(h.clock.pending, 0);
});

test('stalled permission and validation bodies retain their original non-ok status instead of becoming outage responses', options, async () => {
  for (const status of [400, 401, 403, 409]) {
    const h = fixture(), source = stalledBody(status);
    let calls = 0;
    const pending = observe(h.fetchCollectionCapacity(url, { timeoutMs: 100, attempts: 3, fetcher: async () => { calls++; return source.response; } }));
    await flush();
    await h.clock.advance(100);
    const { value: response, error } = await pending.outcome;
    assert.equal(error, undefined);
    assert.equal(response.status, status);
    assert.equal(response.ok, false);
    assert.equal(response.headers.get('x-capacity-proof'), 'same-response');
    await assert.rejects(response.json(), h.CollectionCapacityTimeout);
    assert.equal(calls, 1);
    assert.equal(h.clock.pending, 0);
  }
});

test('settled malformed JSON preserves authority status and caches the original parse rejection', options, async () => {
  const h = fixture();
  let calls = 0;
  const response = await h.fetchCollectionCapacity(url, { attempts: 3, fetcher: async () => { calls++; return new Response('{', { status: 403 }); } });
  assert.equal(response.status, 403);
  assert.equal(response.ok, false);
  const error = await response.json().catch(cause => cause);
  assert.equal(error.name, 'SyntaxError');
  assert.equal(await response.json().catch(cause => cause), error);
  assert.equal(calls, 1);
  assert.equal(h.clock.pending, 0);
});

test('late fetch resolution and rejection after timeout cannot restart work or cause an unhandled rejection', options, async () => {
  const unhandled = [];
  const listener = error => unhandled.push(error);
  process.on('unhandledRejection', listener);
  try {
    for (const late of ['resolve', 'reject']) {
      const h = fixture(), request = deferred();
      let calls = 0;
      const pending = observe(h.fetchCollectionCapacity(url, { timeoutMs: 100, attempts: 3, fetcher: async () => { calls++; return request.promise; } }));
      await flush();
      await h.clock.advance(100);
      assertError((await pending.outcome).error, h.CollectionCapacityTimeout);
      if (late === 'resolve') request.resolve(Response.json({ capacity }));
      else request.reject(new Error('late transport rejection'));
      await flush();
      await h.clock.advance(10000);
      await new Promise(resolve => setImmediate(resolve));
      assert.equal(calls, 1);
      assert.equal(h.clock.pending, 0);
    }
    assert.deepEqual(unhandled, []);
  } finally { process.removeListener('unhandledRejection', listener); }
});

test('late body resolution and rejection cannot replace the cached timeout or cause an unhandled rejection', options, async () => {
  const unhandled = [];
  const listener = error => unhandled.push(error);
  process.on('unhandledRejection', listener);
  try {
    for (const late of ['resolve', 'reject']) {
      const h = fixture(), source = stalledBody();
      const pending = observe(h.fetchCollectionCapacity(url, { timeoutMs: 100, fetcher: async () => source.response }));
      await flush();
      await h.clock.advance(100);
      const { value: response } = await pending.outcome;
      const timeout = await response.json().catch(cause => cause);
      assertError(timeout, h.CollectionCapacityTimeout);
      if (late === 'resolve') source.body.resolve({ capacity });
      else source.body.reject(new Error('late JSON rejection'));
      await flush();
      await new Promise(resolve => setImmediate(resolve));
      assert.equal(await response.json().catch(cause => cause), timeout);
      assert.equal(source.reads, 1);
      assert.equal(h.clock.pending, 0);
    }
    assert.deepEqual(unhandled, []);
  } finally { process.removeListener('unhandledRejection', listener); }
});
