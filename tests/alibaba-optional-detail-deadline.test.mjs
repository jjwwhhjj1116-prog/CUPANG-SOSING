import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as parse5 from 'parse5';

const plain = value => JSON.parse(JSON.stringify(value));
const read = name => fs.readFileSync(new URL('fixtures/' + name, import.meta.url), 'utf8');
// Inert retained product excerpts only. No test performs an external request.
const mobile = JSON.parse(read('1688-mobile-813724060928.json').replaceAll('813724060928', '628000000001'));
const sku = JSON.parse(read('1688-skus-813724060928.json').replaceAll('813724060928', '628000000001'));
const html = '<script>window.__INIT_DATA=' + JSON.stringify(mobile) + ';</script>';
const detail = read('1688-description-813724060928.txt');
const sourceUrl = 'https://detail.1688.com/offer/628000000001.html';

function fixture(detailResponse, {changeSku, changeMobile} = {}) {
  const timers = new Map(), timerDelays = [], calls = [], parent = new AbortController();
  let nextTimer = 0;
  const cache = new Map();
  function load(file) {
    if (cache.has(file)) return cache.get(file);
    const exports = {}; cache.set(file, exports);
    vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../' + file, import.meta.url), 'utf8'), {
      compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022},
    }).outputText, {exports, Error, URL, URLSearchParams, TextEncoder, TextDecoder, AbortController, structuredClone,
      setTimeout(fn, delay) { const id = ++nextTimer; timers.set(id, fn); timerDelays.push(delay); return id; },
      clearTimeout(id) { timers.delete(id); },
      require(name) { if (name === 'parse5') return parse5; if (name.startsWith('@/')) return load(name.slice(2) + '.ts'); throw Error('Unexpected inert module ' + name); },
    });
    return exports;
  }
  const collector = load('app/alibaba-mobile-collector.ts'), parser = load('app/alibaba-mobile-product.ts');
  const fetcher = async (target, init) => {
    const url = new URL(target); calls.push({url, init});
    assert.equal(init.redirect, 'manual'); assert.equal(init.credentials, 'omit'); assert.equal(init.cache, 'no-store');
    assert.equal(init.headers.cookie, undefined, 'description requests cannot reuse anonymous SKU cookies');
    if (url.hostname === 'm.1688.com') {
      const value = structuredClone(mobile); changeMobile?.(value);
      return new Response(changeMobile ? '<script>window.__INIT_DATA=' + JSON.stringify(value) + ';</script>' : html, {headers: {'content-type': 'text/html'}});
    }
    if (url.hostname === 'h5api.m.1688.com') { const value = structuredClone(sku); changeSku?.(value); return Response.json(value); }
    assert.equal(url.hostname, 'itemcdn.tmall.com');
    assert.notEqual(init.signal, parent.signal, 'optional detail owns a child deadline');
    return detailResponse(init);
  };
  const known = parser.parseAlibabaMobileProduct(parser.parseAlibabaMobilePage(html, sourceUrl), sku);
  const run = (extra = {}) => collector.collectAlibabaMobileProduct(sourceUrl, {fetcher, signal: parent.signal, ...extra});
  const capture = () => collector.collectAlibabaMobileCapture(sourceUrl, {fetcher, signal: parent.signal});
  return {collector, parser, run, capture, known, calls, timers, timerDelays, parent,
    fireDeadline() { assert.equal(timers.size, 1); [...timers.values()][0](); },
  };
}
async function until(check) {
  for (let i = 0; i < 100; i++) { if (check()) return; await Promise.resolve(); }
  assert.ok(check(), 'controlled detail request should have started');
}
function partial(f, result) {
  assert.equal(result.provider, '1688-public-mobile-partial-v1');
  for (const field of ['sourceUrl', 'offerId', 'title', 'description', 'images', 'attributes', 'options']) assert.deepEqual(plain(result[field]), plain(f.known[field]), field);
  assert.equal(result.images.some(image => image.role === 'detail'), false);
  assert.equal(f.calls.length, 3, 'verified source uses no retries, browser transport or alternate host');
  assert.equal(f.timers.size, 0, 'detail deadline is cleared');
  assert.equal(f.parent.signal.aborted, false, 'an optional failure cannot abort the parent source');
  assert.equal('detailUnavailable' in result, false, 'local timeout must not invent an HTTP 504 receipt');
}

test('fast successful optional detail retains all images and cleans its independent default budget', async () => {
  const f = fixture(() => new Response(detail, {headers: {'content-type': 'text/plain'}}));
  const result = await f.run();
  assert.equal(f.collector.OPTIONAL_DETAIL_TIMEOUT_MS, 5000); assert.deepEqual(f.timerDelays, [5000]);
  assert.equal(result.provider, '1688-public-mobile-v1'); assert.equal(result.images.filter(image => image.role === 'detail').length, 11);
  assert.deepEqual(plain(result.options), plain(f.known.options)); assert.equal(f.timers.size, 0);
});

test('optional detail fetch and body transport rejection preserve exact verified SKU and price facts', async () => {
  for (const response of [() => { throw Error('signed private source must not be exposed'); }, () => new Response(new ReadableStream({start(controller) { controller.error(Error('private transport body')); }}))]) {
    const f = fixture(response); partial(f, await f.run());
  }
  const raw = fixture(() => { throw Error('private network error'); });
  await assert.rejects(raw.capture(), error => /일시적/.test(error.message) && !/private|status|504/.test(error.message));
  assert.equal(raw.timers.size, 0, 'raw capture fails truthfully without fabricating Chrome partial HTTP evidence');
});

test('default deadline ends a stalled fetch and cancels a late response without waiting for it', async () => {
  let resolveDetail, cancelled = 0;
  const f = fixture(() => new Promise(resolve => { resolveDetail = resolve; }));
  const pending = f.run(); await until(() => resolveDetail);
  assert.deepEqual(f.timerDelays, [5000]); f.fireDeadline();
  partial(f, await pending); assert.equal(f.calls.at(-1).init.signal.aborted, true);
  resolveDetail(new Response(new ReadableStream({cancel() { cancelled++; }})));
  await until(() => cancelled === 1); assert.equal(cancelled, 1); assert.equal(f.timers.size, 0);
});

test('deadline includes a stalled body, cancels its pending reader and releases the body lock', async () => {
  let response, cancelled = 0;
  const f = fixture(() => response = new Response(new ReadableStream({cancel() { cancelled++; }})));
  const pending = f.run({optionalDetailTimeoutMs: 7}); await until(() => response?.body.locked);
  assert.deepEqual(f.timerDelays, [7]); f.fireDeadline(); partial(f, await pending);
  await until(() => !response.body.locked); assert.equal(cancelled, 1); assert.equal(response.body.locked, false);
});

test('user abort and parent abort immediately after timeout cannot become partial source success', async () => {
  for (const afterDeadline of [false, true]) {
    let response, cancelled = 0;
    const f = fixture(() => response = new Response(new ReadableStream({cancel() { cancelled++; }})));
    const pending = f.run(); await until(() => response?.body.locked);
    if (afterDeadline) f.fireDeadline();
    f.parent.abort(); await assert.rejects(pending, /취소/);
    await until(() => !response.body.locked); assert.equal(cancelled, 1); assert.equal(f.timers.size, 0);
    assert.equal(f.calls.at(-1).init.signal.aborted, true);
  }
});

test('HTTP authority errors and redirects remain hard failures and never follow a Location', async () => {
  for (const status of [401, 403, 302, 404, 429, 500]) {
    const f = fixture(() => new Response('', {status, headers: {location: 'https://private.invalid/challenge'}}));
    await assert.rejects(f.run(), /정상 응답/); assert.equal(f.calls.length, 3); assert.equal(f.timers.size, 0);
  }
});

test('terminal authority and decoder failures cancel their unread streams and retire the child signal', async () => {
  for (const mode of ['authority', 'charset']) {
    let response, cancelled = 0;
    const f = fixture(() => response = new Response(new ReadableStream({cancel() { cancelled++; }}), mode === 'authority'
      ? {status: 403} : {headers: {'content-type': 'text/plain;charset=unsupported-private-encoding'}}));
    await assert.rejects(f.run());
    await until(() => cancelled === 1 && !response.body.locked);
    assert.equal(cancelled, 1); assert.equal(response.body.locked, false);
    assert.equal(f.calls.at(-1).init.signal.aborted, true); assert.equal(f.parent.signal.aborted, false);
    assert.equal(f.timers.size, 0);
  }
});

test('successful but malformed, oversized, invalidly encoded or challenge detail bytes cannot become partial receipts', async () => {
  const responses = [
    () => new Response('malformed callback'),
    () => new Response('<html><title>Verification</title><form action="/login">captcha</form></html>'),
    () => new Response('x'.repeat(2 * 1024 * 1024 + 1)),
    () => new Response(new Uint8Array([0xc3, 0x28]), {headers: {'content-type': 'text/plain;charset=utf-8'}}),
    () => new Response(detail, {headers: {'content-type': 'text/plain;charset=unsupported-private-encoding'}}),
  ];
  for (const response of responses) {
    const f = fixture(response); await assert.rejects(f.run()); assert.equal(f.timers.size, 0);
  }
});

test('offer contradictions and private SKU facts stop before any optional detail request', async () => {
  for (const changes of [
    {changeSku: value => { value.data.result.data.offerBaseInfo.offerId = '999'; }},
    {changeSku: value => { value.data.result.data.skuModel.isPricePrivate = true; }},
    {changeMobile: value => { value.globalData.isPicPrivate = true; }},
  ]) {
    const f = fixture(() => assert.fail('unverified facts cannot authorize detail'), changes);
    await assert.rejects(f.run()); assert.ok(f.calls.length <= 2); assert.equal(f.timers.size, 0);
  }
});

test('timeout limits reject malformed values without a detail request and existing HTTP partial captures remain truthful', async () => {
  for (const value of [0, -1, 30001, Infinity, NaN, '5']) {
    const f = fixture(() => assert.fail('invalid deadline cannot fetch detail'));
    await assert.rejects(f.run({optionalDetailTimeoutMs: value}), /제한 시간/); assert.equal(f.calls.length, 2); assert.equal(f.timers.size, 0);
  }
  for (const status of [502, 503, 504]) {
    const f = fixture(() => new Response('', {status}));
    const capture = await f.capture(); assert.deepEqual(plain(capture.detailUnavailable), {status});
    assert.equal(capture.format, '1688-public-mobile-partial-capture-v1'); assert.equal(f.timers.size, 0);
  }
});
