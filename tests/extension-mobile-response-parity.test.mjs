import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { collectAlibabaMobileCapture } from '../extensions/supplier-hub/mobile-public.mjs';
import { mobileIntakeHarness } from './helpers/mobile-intake.mjs';

const sourceUrl = 'https://detail.1688.com/offer/628000000093.html';
const original = JSON.parse(fs.readFileSync(new URL('fixtures/1688-public-sku-813724060928.json', import.meta.url), 'utf8').replaceAll('813724060928', '628000000093'));
function fixture(payload = structuredClone(original)) {
  const calls = [];
  const fetcher = async (target, init) => {
    const url = new URL(target);
    calls.push(url.hostname);
    assert.equal(init.credentials, 'omit');
    assert.equal(init.redirect, 'manual');
    assert.equal(new Headers(init.headers).get('cookie'), null);
    if (url.hostname === 'm.1688.com') {
      assert.equal(url.pathname, '/offer/628000000093.html');
      return new Response('<html>No initial product data</html>', { headers: { 'content-type': 'text/html' } });
    }
    assert.equal(url.hostname, 'h5api.m.1688.com', 'only a synthetic public SKU response may be requested');
    return Response.json(payload);
  };
  return { payload, calls, run: () => collectAlibabaMobileCapture(sourceUrl, { fetcher, signal: new AbortController().signal }) };
}

test('generated Chrome bundle rejects mixed success/error results before returning source bytes', async () => {
  for (const ret of [
    ['SUCCESS::ok', 'FAIL_SYS_USER_VALIDATE::required'],
    ['FAIL_SYS_SESSION_EXPIRED::expired', 'SUCCESS::ok'],
    ['SUCCESS::ok', 'FAIL_SYS_TOKEN_EMPTY::empty'],
    ['SUCCESS::ok', 'unknown'],
    ['SUCCESS::ok', ''],
  ]) {
    const h = fixture(); h.payload.ret = ret;
    const before = JSON.stringify(h.payload);
    await assert.rejects(h.run(), /상품 데이터를 반환하지 않았습니다/);
    assert.deepEqual(h.calls, ['m.1688.com', 'h5api.m.1688.com']);
    assert.equal(JSON.stringify(h.payload), before);
  }
});

test('generated Chrome bundle accepts pure success while preserving the exact synthetic raw source', async () => {
  const h = fixture(), before = JSON.stringify(h.payload);
  const capture = await h.run();
  assert.equal(capture.format, '1688-public-sku-capture-v1');
  assert.equal(capture.sourceUrl, sourceUrl);
  assert.deepEqual(capture.skuPayload, h.payload);
  assert.deepEqual(Object.keys(capture).sort(), ['format', 'sourceUrl', 'skuPayload'].sort());
  assert.equal(JSON.stringify(h.payload), before);
  assert.deepEqual(h.calls, ['m.1688.com', 'h5api.m.1688.com']);
});

for (const mode of ['first-and-second', 'second-only', 'gallery']) test(`generated Chrome bundle validates option image fallback and server preserves its original references (${mode})`, async () => {
  const h = fixture(), data = h.payload.data.result.data, props = data.skuModel.skuProps;
  const first = props[0].value, second = props[1].value;
  second.forEach((value, index) => { value.imageUrl = `https://cbu01.alicdn.com/img/step693-second-${index}.png`; });
  if (mode !== 'first-and-second') first.forEach(value => { delete value.imageUrl; });
  if (mode === 'gallery') second.forEach(value => { delete value.imageUrl; });
  const before = JSON.stringify(h.payload), capture = await h.run();
  assert.deepEqual(capture.skuPayload, h.payload);
  assert.equal(JSON.stringify(h.payload), before);
  assert.deepEqual(h.calls, ['m.1688.com', 'h5api.m.1688.com']);
  const server = mobileIntakeHarness();
  try {
    const parsed = server.load('app/browser-product-capture.ts').parseBrowserProductCapture(capture, sourceUrl);
    assert.equal(parsed.options.length, 6);
    for (const option of parsed.options) {
      const expected = mode === 'gallery' ? data.offerBaseInfo.picUrl
        : mode === 'second-only' ? second.find(value => value.name === option.size).imageUrl
          : first.find(value => value.name === option.color).imageUrl;
      assert.equal(parsed.images[option.imageIndex].url, expected);
      if (mode === 'gallery') assert.equal(option.imageIndex, 0);
    }
    for (const candidate of [...first, ...second].flatMap(value => value.imageUrl ? [value.imageUrl] : [])) {
      assert.ok(parsed.images.some(image => image.url === candidate), 'both first and second originals remain available');
    }
    assert.deepEqual(server.network, []);
    assert.equal(server.sqlite.prepare('SELECT count(*) n FROM products').get().n, 0);
  } finally { server.close(); }
});

test('generated Chrome bundle rejects an unauthorized second image even when the first candidate is valid', async () => {
  const h = fixture();
  h.payload.data.result.data.skuModel.skuProps[1].value.forEach(value => { value.imageUrl = 'https://foreign.test/second.png'; });
  await assert.rejects(h.run(), /Alibaba CDN/);
  assert.deepEqual(h.calls, ['m.1688.com', 'h5api.m.1688.com']);
});
