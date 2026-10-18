import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as parse5 from 'parse5';

const sourceUrl = 'https://detail.1688.com/offer/90000000693.html';
const cache = new Map();
function load(file) {
  if (cache.has(file)) return cache.get(file);
  const exports = {}; cache.set(file, exports);
  const code = ts.transpileModule(fs.readFileSync(new URL('../' + file, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(code, { exports, URL, URLSearchParams, Date, Headers, Response, TextEncoder, TextDecoder,
    AbortController, structuredClone, setTimeout, clearTimeout,
    require: name => name === 'parse5' ? parse5 : load(name.slice(2) + '.ts'),
  });
  return exports;
}
const query = load('app/alibaba-mobile-collector.ts').queryAlibabaMobileSkus;
const parse = load('app/alibaba-mobile-product.ts').parseAlibabaPublicSkuProduct;
function payload(statuses) {
  // Retained product-only data is used locally; no recorded URL is requested.
  const value = JSON.parse(fs.readFileSync(new URL('./fixtures/1688-public-sku-813724060928.json', import.meta.url), 'utf8'));
  value.data.result.data.offerBaseInfo.offerId = '90000000693';
  value.ret = statuses;
  return value;
}
const queryWith = (fetcher, signal = new AbortController().signal) => query('90000000693', { fetcher, signal });

test('collector and direct parser accept only success-only status lists without mutating supplier facts', async () => {
  for (const statuses of [['SUCCESS'], ['SUCCESS::调用成功'], ['SUCCESS::调用成功', 'SUCCESS::same response']]) {
    const source = payload(statuses), before = JSON.stringify(source);
    let calls = 0;
    const result = await queryWith(async () => { calls++; return Response.json(source); });
    const receipt = parse(result, sourceUrl);
    assert.equal(calls, 1); assert.equal(receipt.options.length, 6); assert.equal(receipt.offerId, '90000000693');
    assert.equal(JSON.stringify(source), before);
  }
});

test('a success entry cannot conceal verification, session, access or retry errors in any order', async () => {
  for (const failure of ['FAIL_SYS_USER_VALIDATE::需要验证', 'FAIL_SYS_SESSION_EXPIRED::expired', 'FAIL_SYS_ILLEGAL_ACCESS', 'FAIL_SYS_TOKEN_EMPTY::refresh']) {
    for (const statuses of [['SUCCESS::调用成功', failure], [failure, 'SUCCESS::调用成功']]) {
      const source = payload(statuses), before = JSON.stringify(source);
      let calls = 0;
      await assert.rejects(queryWith(async () => { calls++; return Response.json(source, {
        headers: { 'set-cookie': '_m_h5_tk=localfixture_9999999999999; Path=/' },
      }); }), /상품 데이터를 반환/);
      assert.equal(calls, 1, 'mixed states cannot authorize a token refresh or another request');
      assert.throws(() => parse(source, sourceUrl), /성공/);
      assert.equal(JSON.stringify(source), before);
    }
  }
});

test('empty, malformed and success-like statuses cannot produce a receipt at either entry point', async () => {
  for (const statuses of [[], null, undefined, 'SUCCESS', ['SUCCESS_OTHER'], [' SUCCESS'], ['SUCCESS', ''], ['SUCCESS', null], ['SUCCESS', 1], ['SUCCESS', {}], [, 'SUCCESS']]) {
    const source = payload(statuses); let calls = 0;
    assert.throws(() => parse(source, sourceUrl), /성공/);
    await assert.rejects(queryWith(async () => { calls++; return Response.json(source); }));
    assert.equal(calls, 1);
  }
});

test('the original single TOKEN_EMPTY handshake still permits one refresh followed by an unambiguous success', async () => {
  const requests = [];
  const result = await queryWith(async (target, init) => {
    requests.push({ target: new URL(target), cookie: init.headers.cookie });
    if (requests.length === 1) return Response.json({ ret: ['FAIL_SYS_TOKEN_EMPTY::fixture'] }, {
      headers: { 'set-cookie': '_m_h5_tk=localfixture_9999999999999; Path=/' },
    });
    return Response.json(payload(['SUCCESS::调用成功']));
  });
  assert.equal(requests.length, 2); assert.equal(requests[0].cookie, undefined);
  assert.equal(requests[1].cookie, '_m_h5_tk=localfixture_9999999999999');
  assert.ok(requests.every(request => request.target.hostname === 'h5api.m.1688.com'));
  assert.equal(parse(result, sourceUrl).options.length, 6);
});

test('a refreshed response with contradictory success and failure terminates without a third request', async () => {
  let calls = 0;
  await assert.rejects(queryWith(async () => ++calls === 1
    ? Response.json({ ret: ['FAIL_SYS_TOKEN_EMPTY::fixture'] }, { headers: { 'set-cookie': '_m_h5_tk=localfixture_9999999999999; Path=/' } })
    : Response.json(payload(['SUCCESS::调用成功', 'FAIL_SYS_USER_VALIDATE::需要验证']))), /商品|상품 데이터를 반환/);
  assert.equal(calls, 2);
});

test('cancellation before a later explicit query does not consume any source response', async () => {
  const controller = new AbortController(); controller.abort();
  await assert.rejects(queryWith(async () => assert.fail('aborted query must not fetch'), controller.signal), /취소/);
});
