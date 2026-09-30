import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as parse5 from 'parse5';
import * as nodeCrypto from 'node:crypto';
import {parseProductJsonLd} from '../extensions/supplier-hub/product-jsonld.mjs';

function load(file) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../' + file, import.meta.url), 'utf8'), {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022}}).outputText,
    {exports, URL, URLSearchParams, Response, TextEncoder, TextDecoder, AbortController, structuredClone, setTimeout, clearTimeout,
      require: name => name === 'parse5' ? parse5 : name === 'node:crypto' ? nodeCrypto : name === '@/extensions/supplier-hub/product-jsonld.mjs' ? {parseProductJsonLd} : load(name.slice(2) + '.ts')});
  return exports;
}
const read = name => fs.readFileSync(new URL('fixtures/' + name, import.meta.url), 'utf8');
// Product-only excerpts actually received anonymously on 2026-09-30. Tracking,
// seller identities and transport tokens are excluded from these fixtures.
const mobile = JSON.parse(read('1688-mobile-813724060928.json'));
const skus = JSON.parse(read('1688-skus-813724060928.json'));
const detail = read('1688-description-813724060928.txt');
const sourceUrl = 'https://detail.1688.com/offer/813724060928.html';
const pageHtml = data => '<script>window.__GLOBAL_DADA={"isLogin":false};window.__INIT_DATA=' + JSON.stringify(data) + ';</script>';
const parser = load('app/alibaba-mobile-product.ts');
const receipt = () => parser.parseAlibabaMobileProduct(parser.parseAlibabaMobilePage(pageHtml(mobile), sourceUrl), skus, parser.parseAlibabaMobileDescription(detail));

test('observed live product retains all six actual SKUs, prices, stock and original image relations', () => {
  const result = receipt();
  assert.equal(result.offerId, '813724060928');
  assert.equal(result.provider, '1688-public-mobile-v1');
  assert.equal(result.options.length, 6);
  assert.deepEqual(Array.from(result.options, row => row.sku), ['5627721589405', '5627721589406', '5627721589409', '5627721589410', '5627721589407', '5627721589408']);
  assert.deepEqual(Array.from(result.options, row => row.unitPriceCny), [3.6, 5.5, 3.6, 5.5, 3.6, 5.5]);
  assert.deepEqual(Array.from(result.options, row => row.stock), [5623, 6621, 5697, 6605, 5472, 6360]);
  assert.ok(result.options.every(row => row.minimumOrder === 1));
  assert.equal(result.images.filter(row => row.role === 'detail').length, 11);
  assert.equal(result.attributes.length, 24);
  assert.ok(result.options.every(row => result.images[row.imageIndex].url.startsWith('https://cbu01.alicdn.com/')));
  assert.equal(result.options[0].imageIndex, result.options[1].imageIndex);
  assert.equal(result.options[0].color, '亮黑');
  assert.equal(result.options[1].size, '太阳镜 加005 盒子');
});

test('unloaded mobile component placeholders do not prevent collection or authorize foreign product attributes', () => {
  const changed = structuredClone(mobile);
  Object.assign(changed.data, {disabled: null, unloaded: {}, header: {componentType: 'text'}, empty: {data: {}}});
  const page = parser.parseAlibabaMobilePage(pageHtml(changed), sourceUrl);
  assert.equal(parser.parseAlibabaMobileProduct(page, skus).options.length, 6);
  const attributes = Object.values(changed.data).find(value => value?.data?.propsList).data;
  attributes.offerId = '999';
  assert.throws(() => parser.parseAlibabaMobilePage(pageHtml(changed), sourceUrl), /상품번호/);
});

test('page extraction is inert and ignores strings, comments, templates and nested function assignments', () => {
  const literal = 'window.__INIT_DATA=' + JSON.stringify(mobile) + ';';
  for (const html of ['<!--<script>' + literal + '</script>-->', '<template><script>' + literal + '</script></template>', '<textarea><script>' + literal + '</script></textarea>', '<script>/* ' + literal + ' */</script>', '<script>const sample=' + JSON.stringify(literal) + ';</script>', '<script>function fake(){' + literal + '}</script>']) assert.throws(() => parser.parseAlibabaMobilePage(html, sourceUrl));
  assert.equal(parser.parseAlibabaMobilePage('<script>/* fake */ const sample="window.__INIT_DATA={}";</script>' + pageHtml(mobile), sourceUrl).offerId, '813724060928');
  assert.throws(() => parser.parseAlibabaMobilePage('<script>window.__INIT_DATA=(()=>{throw Error("must never execute")})();</script>', sourceUrl));
  assert.throws(() => parser.parseAlibabaMobileDescription('callback(' + detail + ')'));
});

test('mismatched products, private data, ambiguous snapshots and unbounded detail references cannot be imported', () => {
  for (const mutate of [m => m.globalData.tempModel.offerId = '999', m => m.globalData.offerBaseInfo.offerId = 999, m => m.globalData.isPricePrivate = true,
    m => m.globalData.detailModel.offerId = '999', m => m.globalData.detailModel.detailUrl = m.globalData.detailModel.detailUrl.replace('itemcdn.tmall.com', 'evil.test'),
    m => m.globalData.detailModel.detailUrl += '&offerId=999']) {
    const changed = structuredClone(mobile); mutate(changed); assert.throws(() => parser.parseAlibabaMobilePage(pageHtml(changed), sourceUrl));
  }
  const changed = structuredClone(mobile); changed.globalData.tempModel.offerTitle = 'different';
  assert.throws(() => parser.parseAlibabaMobilePage(pageHtml(mobile) + pageHtml(changed), sourceUrl));
  assert.throws(() => parser.parseAlibabaMobilePage('x'.repeat(2 * 1024 * 1024 + 1), sourceUrl));
  const page = parser.parseAlibabaMobilePage(pageHtml(mobile), sourceUrl);
  for (const mutate of [s => s.ret = ['FAIL_SYS_SESSION_EXPIRED'], s => s.data.result.data.offerBaseInfo.offerId = 999, s => s.data.result.data.offerBaseInfo.title = 'another product']) {
    const changed = structuredClone(skus); mutate(changed); assert.throws(() => parser.parseAlibabaMobileProduct(page, changed));
  }
});

test('missing SKU facts never inherit a headline, minimum price, stock or duplicate combination', () => {
  const page = parser.parseAlibabaMobilePage(pageHtml(mobile), sourceUrl);
  for (const mutate of [d => delete Object.values(d.skuModel.skuInfoMap)[0].price, d => Object.values(d.skuModel.skuInfoMap)[0].price = '3.6-5.5',
    d => delete Object.values(d.skuModel.skuInfoMap)[0].skuId, d => Object.values(d.skuModel.skuInfoMap)[0].canBookCount = -1,
    d => Object.values(d.skuModel.skuInfoMap)[0].specAttrs = 'not in properties', d => d.orderParamModel.orderParam.beginNum = null,
    d => { const entries = Object.entries(d.skuModel.skuInfoMap); entries[0][1].skuId = entries[1][1].skuId; }]) {
    const changed = structuredClone(skus); mutate(changed.data.result.data); assert.throws(() => parser.parseAlibabaMobileProduct(page, changed));
  }
  const changed = structuredClone(skus); Object.values(changed.data.result.data.skuModel.skuInfoMap)[0].canBookCount = 0;
  assert.equal(parser.parseAlibabaMobileProduct(page, changed).options.at(-1).stock, 0);
});

test('explicit common range-price model applies the tier at MOQ rather than the cheapest bulk tier', () => {
  const changed = structuredClone(skus), data = changed.data.result.data;
  data.orderParamModel.orderParam.beginNum = 2;
  data.orderParamModel.orderParam.skuParam = {skuPriceType: 'rangePrice', skuRangePrices: [{beginAmount: 1, price: '3.60'}, {beginAmount: 200, price: '2.50'}]};
  for (const item of Object.values(data.skuModel.skuInfoMap)) delete item.price;
  const page = parser.parseAlibabaMobilePage(pageHtml(mobile), sourceUrl), result = parser.parseAlibabaMobileProduct(page, changed);
  assert.ok(result.options.every(row => row.unitPriceCny === 3.6 && row.minimumOrder === 2));
  data.orderParamModel.orderParam.skuParam.skuRangePrices.reverse();
  assert.throws(() => parser.parseAlibabaMobileProduct(page, changed));
});

function transportFixture({failure, changeSku, signal = new AbortController().signal, wrappedSignal = false} = {}) {
  const calls = [], transientToken = 'anonymousOnly_1700000000000';
  let skuRequests = 0, requestSignal;
  const fetcher = async (target, init) => {
    const url = new URL(target); calls.push({url, init});
    assert.equal(init.redirect, 'manual'); assert.equal(init.credentials, 'omit');
    requestSignal ??= init.signal;
    assert.equal(init.signal, requestSignal);
    if (!wrappedSignal) assert.equal(init.signal, signal);
    if (url.hostname === 'detail.1688.com') return new Response('<script>window._config_={"action":"noop"};</script>', {headers: {'content-type': 'text/html'}});
    if (url.hostname === 'm.1688.com') return new Response(pageHtml(mobile), {headers: {'content-type': 'text/html'}});
    if (url.hostname === 'itemcdn.tmall.com') return new Response(detail, {headers: {'content-type': 'text/plain'}});
    assert.equal(url.origin + url.pathname, 'https://h5api.m.1688.com/h5/mtop.mbox.fc.common.gateway/1.0/');
    const params = Object.fromEntries(url.searchParams), token = skuRequests++ ? 'anonymousOnly' : 'undefined';
    assert.equal(params.appKey, '12574478'); assert.equal(params.sign, nodeCrypto.createHash('md5').update(`${token}&${params.t}&12574478&${params.data}`).digest('hex'));
    assert.deepEqual(JSON.parse(JSON.parse(params.data).params), {offerId: '813724060928'});
    if (failure) return Response.json({ret: [failure]});
    if (skuRequests === 1) {
      assert.equal(init.headers.cookie, undefined);
      const response = Response.json({ret: ['FAIL_SYS_TOKEN_EMPTY::令牌为空']});
      response.headers.append('set-cookie', '_m_h5_tk=' + transientToken + '; Path=/; HttpOnly');
      response.headers.append('set-cookie', '_m_h5_tk_enc=anonymousEncrypted; Path=/');
      response.headers.append('set-cookie', 'unrelated_session=neverReuse; Path=/');
      return response;
    }
    assert.equal(init.headers.cookie, '_m_h5_tk=' + transientToken + '; _m_h5_tk_enc=anonymousEncrypted');
    const payload = structuredClone(skus); changeSku?.(payload); return Response.json(payload);
  };
  return {calls, fetcher, signal};
}

test('URL collection uses the official mobile source after a JSON-LD-less PC page and retains no transport cookies', async () => {
  const h = transportFixture({wrappedSignal: true});
  const result = await load('app/public-product-collector.ts').collectPublicProduct(sourceUrl + '?tracking=1', {fetcher: h.fetcher, signal: h.signal});
  assert.equal(result.options.length, 6); assert.equal(result.images.filter(row => row.role === 'detail').length, 11);
  assert.equal(h.calls.length, 5); assert.equal(h.calls[0].url.href, sourceUrl);
  assert.equal(h.calls.filter(call => call.url.hostname === 'h5api.m.1688.com').length, 2);
  assert.ok(!JSON.stringify(result).includes('anonymousOnly')); assert.ok(!JSON.stringify(result).includes('neverReuse'));
  assert.ok(h.calls.filter(call => call.url.hostname !== 'h5api.m.1688.com').every(call => !call.init.headers.cookie));
});

test('verification, login, redirects and incorrect SKU identities stop before details or receipt creation', async () => {
  for (const failure of ['FAIL_SYS_USER_VALIDATE::验证', 'FAIL_SYS_SESSION_EXPIRED::登录', 'FAIL_SYS_ILLEGAL_ACCESS::访问']) {
    const h = transportFixture({failure});
    await assert.rejects(load('app/alibaba-mobile-collector.ts').collectAlibabaMobileProduct(sourceUrl, h), /상품 데이터를 반환/);
    assert.equal(h.calls.length, 2); assert.ok(!h.calls.some(call => call.url.hostname === 'itemcdn.tmall.com'));
  }
  const h = transportFixture({changeSku: value => value.data.result.data.offerBaseInfo.offerId = 999});
  await assert.rejects(load('app/alibaba-mobile-collector.ts').collectAlibabaMobileProduct(sourceUrl, h), /상품이 다릅니다/);
  assert.ok(!h.calls.some(call => call.url.hostname === 'itemcdn.tmall.com'));
  await assert.rejects(load('app/alibaba-mobile-collector.ts').collectAlibabaMobileProduct(sourceUrl, {signal: h.signal, fetcher: async () => new Response('', {status: 302, headers: {'content-type': 'text/html', location: 'https://login.1688.com/'}})}));
});

test('cancelled and malformed anonymous handshakes cannot leak a signed request or create extra requests', async () => {
  const controller = new AbortController(); controller.abort(); const h = transportFixture({signal: controller.signal});
  await assert.rejects(load('app/alibaba-mobile-collector.ts').collectAlibabaMobileProduct(sourceUrl, h), /취소/); assert.equal(h.calls.length, 0);
  const collector = load('app/alibaba-mobile-collector.ts');
  await assert.rejects(collector.queryAlibabaMobileSkus('813724060928', {signal: new AbortController().signal, fetcher: async () => {throw Error('signed-url?secret=must-not-leak');}}), error => !error.message.includes('must-not-leak'));
  await assert.rejects(collector.queryAlibabaMobileSkus('813724060928', {signal: new AbortController().signal, fetcher: async () => Response.json({ret: ['FAIL_SYS_TOKEN_EMPTY']})}), /준비하지 못했습니다/);
});

test('recorded source prices populate six editable options and the captured category quotation using existing margin rules', () => {
  const result = receipt(), settings = load('app/workspace-settings.ts').defaultSettings;
  // 80719 is used solely to verify form linkage. This sunglasses/basket
  // comparison is not a valid commercial quotation and is never transmitted.
  const job = {id: 'job', offer_id: result.offerId, goal: 'price', context: {category: {id: 'selected-profile', categoryId: '80719', categoryPath: ['주방용품', '주방수납/정리', '주방수납바구니/바스켓']}, settings, features: '', keywords: ''}};
  const draft = load('app/collection-product.ts').prepareCollectionProduct('owner', job, result, 'draft', new Date().toISOString());
  assert.equal(draft.options.rows.length, 6); assert.equal(draft.options.rows[0].supplierSku, '5627721589405');
  const quotation = load('app/quotation-schema.ts').resolveQuotationFields({categoryId: '80719', product: draft.product, content: draft.content, options: draft.options, settings});
  const optionRows = quotation.rows.filter(row => row.optionId !== null);
  assert.equal(optionRows.length, 6);
  const policy = load('app/pricing.ts').pricePolicy({...settings, minimumMargin: settings.minimumMarginEnabled ? settings.minimumMargin : 0});
  for (let index = 0; index < 6; index++) {
    const price = load('app/pricing.ts').calculatePrice(result.options[index].unitPriceCny, policy);
    assert.equal(optionRows[index].fields.supplyPrice.value, String(price.supplyPrice));
    assert.equal(optionRows[index].fields.salePrice.value, String(price.salePrice));
  }
  assert.equal(draft.product.supplier_hub_status, '미전송');
  assert.ok(Object.values(draft.content.assets).every(field => field.value.length === 0));
});
