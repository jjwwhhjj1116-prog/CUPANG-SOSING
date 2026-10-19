import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';

const source = fs.readFileSync(new URL('../../extensions/supplier-hub/sales-content.js', import.meta.url), 'utf8');
function fakeClock() {
  let now = Date.parse('2026-10-05T10:00:00Z');
  let nextId = 0;
  const timers = new Map();
  const delays = [];
  class ClockDate extends Date {
    constructor(...args) { super(...(args.length ? args : [now])); }
    static now() { return now; }
  }
  const flush = async () => { for (let index = 0; index < 5; index++) await Promise.resolve(); };
  return {
    Date: ClockDate, delays, flush,
    setTimeout(callback, delay) { const id = ++nextId; delays.push(delay); timers.set(id, { callback, at: now + Number(delay) }); return id; },
    clearTimeout(id) { timers.delete(id); },
    async advance(milliseconds) {
      await flush();
      const target = now + milliseconds;
      while (true) {
        const next = [...timers].filter(([, timer]) => timer.at <= target).sort((a, b) => a[1].at - b[1].at)[0];
        if (!next) break;
        now = next[1].at;
        timers.delete(next[0]);
        next[1].callback();
        await flush();
      }
      now = target;
      await flush();
    },
  };
}

function fixture(manifestVersion, clock) {
  const requests = [];
  const listeners = [];
  const nodes = [];
  function createElement(tag) {
    const node = {
      tagName: tag, children: [], textContent: '', style: {}, dataset: {},
      append(...children) { this.children.push(...children); },
      replaceChildren(...children) { this.children = children; },
      toggleAttribute(name, value) { this[name] = value; },
      setAttribute(name, value) { this[name] = value; },
      addEventListener() {},
      attachShadow() { this.shadowRoot = createElement('shadow-root'); return this.shadowRoot; },
    };
    nodes.push(node);
    return node;
  }
  const context = {
    URL, Intl, setTimeout: clock?.setTimeout || setTimeout, clearTimeout: clock?.clearTimeout || clearTimeout, Map, WeakMap, Set, Date: clock?.Date || Date,
    location: { href: 'https://www.coupang.com/np/search?q=test', pathname: '/np/search', search: '?q=test' },
    document: { readyState: 'loading', addEventListener() {}, createElement, createTextNode: text => ({ textContent: text }), body: { append() {} } },
    chrome: { runtime: { id: 'test-extension', getManifest: () => ({ version: manifestVersion }), onMessage: { addListener: listener => listeners.push(listener) }, sendMessage(message, callback) {
      requests.push({ message, callback });
      if (message.type === 'YF_SALES_CANCEL') callback({ ok: true });
    } } },
  };
  const exposed = source.replace(/\}\)\(\);\s*$/, 'globalThis.testApi = {identity,normalizedResult,derived,csvCell,startLookup,stopLookup,records,createDock,updateDock,setDock:value=>{dock=value;},state:()=>({generation,running,completed,total})};})();');
  vm.runInNewContext(exposed, context);
  const dock = {
    statusBox: {}, panel: { classList: { toggle() {} } }, launcher: { setAttribute() {} },
    count: {}, start: {}, stop: {}, csv: {}, force: {}, bar: { style: {} },
    progress: { setAttribute(name, value) { this[name] = value; } }, status: { textContent: '' },
  };
  context.testApi.setDock(dock);
  return { ...context.testApi, requests, dock, nodes, listeners, createElement, runtime: context.chrome.runtime, startLookup(list, force) {
    list.forEach(item => context.testApi.records.set(context.testApi.identity(item.product), item));
    return context.testApi.startLookup(list, force);
  } };
}
const product = { productId: '123', itemId: '456', vendorItemId: '789', title: '테스트 상품', price: 8900 };
const result = { ...product, status: 'ok', monthlySales: 280, views: 4000, periodDays: 28, source: '쿠팡 Wing', scope: 'source-defined', matchedBy: 'item', sourceItemId: '456', asOf: '2026-10-05T10:30:00.000Z' };
const record = () => ({ product: { ...product }, mounts: new Set(), result: null, loading: false });

test('dock header and launcher show the loaded extension version with a safe fallback', () => {
  for (const [version, expected] of [['2.0.2', '2.0.2'], [undefined, 'v2'], ['not-a-version', 'v2']]) {
    const api = fixture(version);
    api.createDock();
    assert.ok(api.nodes.some(node => node.tagName === 'b' && node.textContent === `YOOFAM PLUS ${expected}`));
    assert.ok(api.nodes.some(node => node.tagName === 'button' && node.title === `YOOFAM PLUS ${expected} · 판매량 조회`));
  }
});

test('28-day source numbers preserve zero and use a 7/28 weekly estimate', () => {
  const api = fixture();
  const clean = api.normalizedResult(result, product);
  assert.equal(clean.monthlySales, 280);
  assert.equal(clean.periodDays, 28);
  assert.equal(clean.scope, 'source-defined');
  const calculated = api.derived({ product, result: clean });
  assert.equal(calculated.weekly, 70);
  assert.equal(calculated.revenue, 2492000);
  assert.ok(Math.abs(calculated.conversion - 7) < 1e-10);
  assert.equal(api.normalizedResult({ ...result, monthlySales: 0, views: 0 }, product).status, 'ok');
  assert.equal(api.derived({ product, result: { monthlySales: 0, views: 0 } }).conversion, null);
});

test('incorrect periods, non-numeric source fields, and mismatched tuples are never presented as sales', () => {
  const api = fixture();
  for (const periodDays of [30, undefined, 7]) {
    const clean = api.normalizedResult({ ...result, periodDays }, product);
    assert.equal(clean.status, 'unavailable');
    assert.equal(clean.monthlySales, null);
    assert.equal(clean.views, null);
  }
  for (const monthlySales of ['280', Infinity, NaN, -1]) assert.equal(api.normalizedResult({ ...result, monthlySales }, product).monthlySales, null);
  for (const patch of [{ productId: '999' }, { itemId: '999' }, { vendorItemId: '999' }]) assert.equal(api.normalizedResult({ ...result, ...patch }, product), null);
  assert.equal(api.derived({ product: { ...product, price: null }, result }).revenue, null);
});

test('CSV fields retain commas, quotes, and newlines and neutralize formula prefixes', () => {
  const api = fixture();
  assert.equal(api.csvCell('한글,"상품"\n둘째 줄'), '"한글,""상품""\n둘째 줄"');
  for (const value of ['=1+1', '+SUM(A1)', '-1+2', '@SUM(A1)', ' \t=HYPERLINK(1)']) assert.equal(api.csvCell(value).startsWith('"\''), true);
  assert.equal(api.csvCell(null), '""');
  assert.equal(api.csvCell(0), '"0"');
});

test('healthy lookup continues through all 25 products in batches of ten, ten, and five', async () => {
  const api = fixture();
  assert.equal(api.requests.length, 0);
  const list = Array.from({ length: 25 }, (_, index) => ({ ...record(), product: { ...product, productId: String(index + 1) } }));
  const run = api.startLookup(list, true);
  assert.equal(api.requests.length, 1);
  assert.equal(api.requests[0].message.products.length, 10);
  assert.equal(api.requests[0].message.force, true);
  api.requests[0].callback({ ok: true, results: api.requests[0].message.products.map(p => ({ ...result, ...p })) });
  await Promise.resolve();
  assert.equal(api.requests.length, 2);
  assert.equal(api.requests[1].message.products.length, 10);
  api.requests[1].callback({ ok: true, results: api.requests[1].message.products.map(p => ({ ...result, ...p })) });
  await Promise.resolve();
  assert.equal(api.requests.length, 3);
  assert.equal(api.requests[2].message.products.length, 5);
  api.requests[2].callback({ ok: true, results: api.requests[2].message.products.map(p => ({ ...result, ...p })) });
  await run;
  assert.equal(api.state().completed, 25);
  assert.equal(api.state().running, false);
  assert.match(api.dock.status.textContent, /조회 완료 · 처리 25\/25개 · 지표 25개/);
  assert.equal(api.dock.bar.style.width, '100%');
});

test('stop sends backend cancellation, suppresses late results, and does not dispatch the next batch', async () => {
  const api = fixture();
  const list = Array.from({ length: 12 }, (_, index) => ({ ...record(), product: { ...product, productId: String(index + 1) } }));
  const run = api.startLookup(list, false);
  api.stopLookup('중지');
  assert.equal(api.requests[1].message.type, 'YF_SALES_CANCEL');
  api.requests[0].callback({ ok: true, results: api.requests[0].message.products.map(p => ({ ...result, ...p })) });
  await run;
  assert.equal(api.requests.filter(r => r.message.type === 'YF_SALES_LOOKUP').length, 1);
  assert.equal(list.every(item => item.result === null), true);
  assert.equal(api.state().running, false);
});

test('a stopped response cannot overwrite a restarted lookup', async () => {
  const api = fixture();
  const item = record();
  const oldRun = api.startLookup([item], false);
  api.stopLookup('중지');
  const newRun = api.startLookup([item], true);
  api.requests[2].callback({ ok: true, results: [{ ...result, monthlySales: 84 }] });
  await newRun;
  api.requests[0].callback({ ok: true, results: [{ ...result, monthlySales: 9999 }] });
  await oldRun;
  assert.equal(item.result.monthlySales, 84);
});

test('global preflight failure marks zero products attempted and leaves the whole queue pending', async () => {
  const api = fixture();
  const list = Array.from({ length: 12 }, (_, index) => ({ ...record(), product: { ...product, productId: String(index + 1) } }));
  const run = api.startLookup(list, false);
  api.requests[0].callback({ ok: false, error: '로그인이 필요합니다.' });
  await run;
  assert.equal(api.requests.length, 1);
  assert.equal(list.every(item => item.result === null && !item.loading), true);
  assert.equal(api.state().completed, 0);
  assert.equal(api.state().running, false);
  assert.match(api.dock.status.textContent, /조회 중단 · 처리 0\/12개/);
  assert.match(api.dock.status.textContent, /미조회 12개.*로그인이 필요합니다/);
  assert.doesNotMatch(api.dock.status.textContent, /실패 10개|조회 완료/);
  assert.equal(api.dock.bar.style.width, '0%');
});

test('unknown, duplicate, and missing product responses do not fabricate unavailable results', async () => {
  for (const results of [[{ ...result, productId: '999' }], [result, result], []]) {
    const api = fixture();
    const item = record();
    const run = api.startLookup([item], false);
    api.requests[0].callback({ ok: true, results });
    await run;
    assert.equal(item.result, null);
    assert.equal(item.loading, false);
    assert.equal(api.state().completed, 0);
    assert.match(api.dock.status.textContent, /조회 중단 · 처리 0\/1개/);
    assert.match(api.dock.status.textContent, /미조회 1개/);
  }
});

test('partial batch preserves success and marks only the one attempted error before halting', async () => {
  const api = fixture();
  const list = Array.from({ length: 12 }, (_, index) => ({ ...record(), product: { ...product, productId: String(index + 1) } }));
  const run = api.startLookup(list, false);
  const products = api.requests[0].message.products;
  api.requests[0].callback({ ok: true, results: [
    { ...result, ...products[0], monthlySales: 100 },
    { ...result, ...products[1], monthlySales: 200 },
    { ...products[2], status: 'error', monthlySales: null, views: null, periodDays: 28, error: 'Wing HTML 응답' },
  ], halt: { code: 'RESPONSE_TYPE', error: 'Wing HTML 응답' } });
  await run;
  assert.equal(api.requests.length, 1);
  assert.equal(list[0].result.monthlySales, 100);
  assert.equal(list[1].result.monthlySales, 200);
  assert.equal(list[2].result.status, 'error');
  assert.equal(list.slice(3).every(item => item.result === null), true);
  assert.equal(list.every(item => !item.loading), true);
  assert.equal(api.state().completed, 3);
  assert.match(api.dock.status.textContent, /조회 중단 · 처리 3\/12개 · 지표 2개 · 자료 없음 0개 · 실패 1개 · 미조회 9개/);
  assert.match(api.dock.status.textContent, /\[RESPONSE_TYPE\]/);
  assert.equal(api.dock.bar.style.width, '25%');
});

test('a fatal error in the second batch keeps first-batch success and suppresses every later batch', async () => {
  const api = fixture();
  const list = Array.from({ length: 25 }, (_, index) => ({ ...record(), product: { ...product, productId: String(index + 1) } }));
  const run = api.startLookup(list, false);
  api.requests[0].callback({ ok: true, results: api.requests[0].message.products.map(p => ({ ...result, ...p })) });
  await Promise.resolve();
  const products = api.requests[1].message.products;
  api.requests[1].callback({ ok: true, results: [
    { ...result, ...products[0] },
    { ...products[1], status: 'error', periodDays: 28, error: '요청 제한' },
  ], halt: { code: 'LOGIN', error: '로그인 확인 필요' } });
  await run;
  assert.equal(api.requests.length, 2);
  assert.equal(list.slice(0, 11).every(item => item.result?.status === 'ok'), true);
  assert.equal(list[11].result.status, 'error');
  assert.equal(list.slice(12).every(item => item.result === null), true);
  assert.equal(api.state().completed, 12);
  assert.match(api.dock.status.textContent, /조회 중단 · 처리 12\/25개 · 지표 11개 · 자료 없음 0개 · 실패 1개 · 미조회 13개/);
});

test('an empty halt preserves prior results and never reports ten artificial failures', async () => {
  const api = fixture();
  const list = Array.from({ length: 12 }, (_, index) => ({ ...record(), product: { ...product, productId: String(index + 1) } }));
  const previous = { ...result, ...list[0].product, monthlySales: 84 };
  list[0].result = previous;
  const run = api.startLookup(list, true);
  api.requests[0].callback({ ok: true, results: [], halt: { code: 'LOGIN', error: '로그인 확인 필요' } });
  await run;
  assert.equal(list[0].result, previous);
  assert.equal(list.slice(1).every(item => item.result === null), true);
  assert.equal(api.state().completed, 0);
  assert.equal(api.requests.length, 1);
  assert.match(api.dock.status.textContent, /조회 중단 · 처리 0\/12개.*미조회 12개/);
  assert.doesNotMatch(api.dock.status.textContent, /실패/);
});

test('explicit unavailable results count as attempted and do not stop a healthy next batch', async () => {
  const api = fixture();
  const list = Array.from({ length: 11 }, (_, index) => ({ ...record(), product: { ...product, productId: String(index + 1) } }));
  const run = api.startLookup(list, false);
  const rows = api.requests[0].message.products.map(p => ({ ...result, ...p }));
  rows[0] = { ...rows[0], status: 'unavailable', monthlySales: null, views: null, error: '제공 자료 없음' };
  api.requests[0].callback({ ok: true, results: rows });
  await Promise.resolve();
  assert.equal(api.requests.length, 2);
  api.requests[1].callback({ ok: true, results: api.requests[1].message.products.map(p => ({ ...result, ...p })) });
  await run;
  assert.equal(list[0].result.status, 'unavailable');
  assert.equal(api.state().completed, 11);
  assert.match(api.dock.status.textContent, /조회 완료 · 처리 11\/11개 · 지표 10개 · 자료 없음 1개/);
  assert.doesNotMatch(api.dock.status.textContent, /미조회|실패/);
});

test('a preflight failure during refresh leaves previously confirmed values unchanged', async () => {
  const api = fixture();
  const item = record();
  const previous = { ...result, monthlySales: 84 };
  item.result = previous;
  const run = api.startLookup([item], true);
  api.requests[0].callback({ ok: false, error: 'Wing 탭을 열어주세요.' });
  await run;
  assert.equal(item.result, previous);
  assert.equal(api.state().completed, 0);
  assert.match(api.dock.status.textContent, /상품 조회 중단 · 처리 0\/1개.*미조회 1개/);
});

test('unknown halt codes are not surfaced as diagnostic data', async () => {
  for (const code of ['<html>private-marker</html>', 'PRIVATE_SESSION_TOKEN']) {
    const api = fixture();
    const run = api.startLookup([record()], false);
    api.requests[0].callback({ ok: true, results: [], halt: { code, error: '조회 연결을 확인해주세요.' } });
    await run;
    assert.match(api.dock.status.textContent, /조회 연결을 확인해주세요/);
    assert.ok(!api.dock.status.textContent.includes(code));
  }
});

test('after 20 confirmed products, 429 waits for its deadline then automatically resumes only the 12 unfinished products', async () => {
  const clock = fakeClock();
  const api = fixture(undefined, clock);
  const list = Array.from({ length: 32 }, (_, index) => ({ ...record(), product: { ...product, productId: String(index + 1) } }));
  const firstRun = api.startLookup(list, false);
  for (let index = 0; index < 2; index++) {
    api.requests[index].callback({ ok: true, results: api.requests[index].message.products.map(p => ({ ...result, ...p })) });
    await Promise.resolve();
  }
  api.requests[2].callback({ ok: true, results: [], halt: { code: 'RATE_LIMIT', error: '조회 제한', retryAfterMs: 60000 } });
  await clock.flush();
  assert.equal(api.state().completed, 20);
  assert.equal(api.state().running, true);
  assert.equal(list.slice(0, 20).every(item => item.result.status === 'ok'), true);
  assert.equal(list.slice(20).every(item => item.result === null), true);
  assert.match(api.dock.start.textContent, /60초 후 자동 계속/);
  assert.match(api.dock.status.textContent, /20\/32개 확인 · 남은 12개/);
  assert.doesNotMatch(api.dock.status.textContent, /실패|오류/);
  const retained = list.slice(0, 20).map(item => item.result);
  await clock.advance(59000);
  assert.equal(api.requests.length, 3);
  assert.match(api.dock.start.textContent, /1초 후 자동 계속/);
  await clock.advance(999);
  assert.equal(api.requests.length, 3);
  await clock.advance(1);
  assert.equal(api.requests.length, 4);
  assert.equal(api.state().total, 32);
  assert.deepEqual(Array.from(api.requests[3].message.products, p => p.productId), Array.from({ length: 10 }, (_, index) => String(index + 21)));
  api.requests[3].callback({ ok: true, results: api.requests[3].message.products.map(p => ({ ...result, ...p })) });
  await Promise.resolve();
  assert.deepEqual(Array.from(api.requests[4].message.products, p => p.productId), ['31', '32']);
  api.requests[4].callback({ ok: true, results: api.requests[4].message.products.map(p => ({ ...result, ...p })) });
  await firstRun;
  assert.equal(api.state().completed, 32);
  assert.equal(api.requests.length, 5);
  retained.forEach((value, index) => assert.equal(list[index].result, value));
  assert.equal(list.every(item => item.result.status === 'ok'), true);

  await api.startLookup(list, false);
  assert.equal(api.requests.length, 5);
  assert.match(api.dock.status.textContent, /모든 상품을 이미 확인했습니다.*저장된 결과 새로 확인/);
  assert.equal(api.state().running, false);

  const refreshed = api.startLookup(list, true);
  for (let index = 5; index < 9; index++) {
    assert.equal(api.requests[index].message.force, true);
    api.requests[index].callback({ ok: true, results: api.requests[index].message.products.map(p => ({ ...result, ...p })) });
    await Promise.resolve();
  }
  await refreshed;
  assert.equal(api.state().completed, 32);
  assert.deepEqual(api.requests.slice(5).flatMap(request => Array.from(request.message.products, p => p.productId)), Array.from({ length: 32 }, (_, index) => String(index + 1)));
});

test('resume skips both confirmed and unavailable records while retrying errors and pending records', async () => {
  const api = fixture();
  const list = Array.from({ length: 4 }, (_, index) => ({ ...record(), product: { ...product, productId: String(index + 1) } }));
  list[0].result = { ...result, ...list[0].product };
  list[1].result = { ...result, ...list[1].product, status: 'unavailable', monthlySales: null, views: null };
  list[2].result = { ...result, ...list[2].product, status: 'error', monthlySales: null, views: null };
  const run = api.startLookup(list, false);
  assert.deepEqual(Array.from(api.requests[0].message.products, p => p.productId), ['3', '4']);
  assert.equal(api.state().total, 2);
  api.requests[0].callback({ ok: true, results: api.requests[0].message.products.map(p => ({ ...result, ...p })) });
  await run;
  assert.equal(list[1].result.status, 'unavailable');

  await api.startLookup([list[1]], false);
  assert.equal(api.requests.length, 1);
  const singleRefresh = api.startLookup([list[1]], true);
  assert.deepEqual(Array.from(api.requests[1].message.products, p => p.productId), ['2']);
  assert.equal(api.requests[1].message.force, true);
  api.requests[1].callback({ ok: true, results: [{ ...result, ...list[1].product }] });
  await singleRefresh;
  assert.equal(list[1].result.status, 'ok');
});

test('dock labels a partial run as resumable and switches to full refresh when requested', () => {
  const api = fixture();
  const list = [record(), { ...record(), product: { ...product, productId: '999' } }];
  list.forEach(item => {
    item.mounts.add({ host: { isConnected: true } });
    api.records.set(api.identity(item.product), item);
  });
  api.updateDock();
  assert.equal(api.dock.start.textContent, '📈 판매량 조회');
  list[0].result = { ...result };
  api.updateDock();
  assert.equal(api.dock.start.textContent, '남은 상품 이어서 조회');
  api.dock.force.checked = true;
  api.updateDock();
  assert.equal(api.dock.start.textContent, '📈 판매량 다시 조회');
  api.dock.force.checked = false;
  list[1].result = { ...result, ...list[1].product, status: 'unavailable' };
  api.updateDock();
  assert.equal(api.dock.start.textContent, '📈 판매량 다시 조회');
  list[1].result.status = 'error';
  api.updateDock();
  assert.equal(api.dock.start.textContent, '남은 상품 이어서 조회');
});

test('a forced refresh preserves its own pending queue through a partial 429 response', async () => {
  const clock = fakeClock();
  const api = fixture(undefined, clock);
  const list = Array.from({ length: 3 }, (_, index) => ({ ...record(), product: { ...product, productId: String(index + 1) } }));
  list.forEach(item => { item.result = { ...result, ...item.product, monthlySales: 999 }; });
  const run = api.startLookup(list, true);
  api.requests[0].callback({ ok: true, results: [{ ...result, ...list[0].product, monthlySales: 100 }], halt: { code: 'RATE_LIMIT', retryAfterMs: 90000 } });
  await clock.flush();
  assert.equal(api.state().completed, 1);
  assert.equal(list[0].result.monthlySales, 100);
  assert.equal(list[1].result.monthlySales, 999);
  await clock.advance(89999);
  assert.equal(api.requests.length, 1);
  await clock.advance(1);
  assert.deepEqual(Array.from(api.requests[1].message.products, p => p.productId), ['2', '3']);
  api.requests[1].callback({ ok: true, results: api.requests[1].message.products.map(p => ({ ...result, ...p, monthlySales: 200 })) });
  await run;
  assert.equal(api.state().completed, 3);
  assert.equal(list[1].result.monthlySales, 200);
});

test('Stop resolves the cooldown immediately and no old countdown can start a new request', async () => {
  const clock = fakeClock();
  const api = fixture(undefined, clock);
  const item = record();
  const run = api.startLookup([item], false);
  api.requests[0].callback({ ok: true, results: [], halt: { code: 'RATE_LIMIT', retryAfterMs: 5000 } });
  await clock.flush();
  await clock.advance(1000);
  assert.match(api.dock.start.textContent, /4초 후 자동 계속/);
  assert.equal(api.dock.stop.disabled, false);
  api.stopLookup('검색 화면이 변경되어 조회를 중지했습니다.');
  await run;
  assert.equal(api.state().running, false);
  assert.equal(api.requests[1].message.type, 'YF_SALES_CANCEL');
  assert.equal(item.result, null);
  const restarted = api.startLookup([item], true);
  api.requests[2].callback({ ok: true, results: [{ ...result, monthlySales: 84 }] });
  await restarted;
  await clock.advance(900000);
  assert.equal(api.requests.filter(request => request.message.type === 'YF_SALES_LOOKUP').length, 2);
  assert.equal(item.result.monthlySales, 84);
});

test('three no-progress automatic retries end in a resumable pause without a failed product', async () => {
  const clock = fakeClock();
  const api = fixture(undefined, clock);
  const item = record();
  const run = api.startLookup([item], false);
  for (let index = 0; index < 4; index++) {
    assert.equal(api.requests.length, index + 1);
    api.requests[index].callback({ ok: true, results: [], halt: { code: 'RATE_LIMIT', retryAfterMs: 60000 } });
    await clock.flush();
    if (index < 3) await clock.advance(60000);
  }
  await run;
  assert.equal(api.state().running, false);
  assert.equal(api.state().completed, 0);
  assert.equal(item.result, null);
  assert.match(api.dock.status.textContent, /조회 일시정지.*미조회 1개/);
  assert.match(api.dock.status.textContent, /남은 상품 이어서 조회/);
  assert.doesNotMatch(api.dock.status.textContent, /실패/);
  await clock.advance(900000);
  assert.equal(api.requests.length, 4);
});

test('confirmed progress resets the automatic retry budget', async () => {
  const clock = fakeClock();
  const api = fixture(undefined, clock);
  const list = [record(), { ...record(), product: { ...product, productId: '999' } }];
  const run = api.startLookup(list, false);
  for (let index = 0; index < 3; index++) {
    api.requests[index].callback({ ok: true, results: [], halt: { code: 'RATE_LIMIT', retryAfterMs: 60000 } });
    await clock.advance(60000);
  }
  api.requests[3].callback({ ok: true, results: [result], halt: { code: 'RATE_LIMIT', retryAfterMs: 60000 } });
  await clock.flush();
  assert.equal(api.state().completed, 1);
  assert.equal(api.state().running, true);
  await clock.advance(60000);
  assert.deepEqual(Array.from(api.requests[4].message.products, p => p.productId), ['999']);
  api.requests[4].callback({ ok: true, results: [{ ...result, ...list[1].product }] });
  await run;
  assert.equal(api.state().completed, 2);
  assert.match(api.dock.status.textContent, /조회 완료/);
});

test('automatic cooldown uses exact valid remaining delays and defaults invalid values to one minute', async () => {
  for (const [retryAfterMs, expected] of [[undefined, 60000], [1, 1], [500, 500], [-1, 60000], [NaN, 60000], [Infinity, 60000], [900000, 900000]]) {
    const clock = fakeClock();
    const api = fixture(undefined, clock);
    const run = api.startLookup([record()], false);
    api.requests[0].callback({ ok: true, results: [], halt: { code: 'RATE_LIMIT', retryAfterMs } });
    await clock.flush();
    assert.match(api.dock.start.textContent, new RegExp(`${Math.ceil(expected / 1000)}초 후 자동 계속`));
    await clock.advance(expected - 1);
    assert.equal(api.requests.length, 1);
    await clock.advance(1);
    assert.equal(api.requests.length, 2);
    api.requests[1].callback({ ok: true, results: [result] });
    await run;
    assert.equal(api.state().completed, 1);
  }
});

test('a fifteen-second wait followed by a five-second residual resumes without restarting a minute or repeating confirmed products', async () => {
  const clock = fakeClock();
  const api = fixture(undefined, clock);
  const list = Array.from({ length: 3 }, (_, index) => ({ ...record(), product: { ...product, productId: String(index + 1) } }));
  const run = api.startLookup(list, false);
  api.requests[0].callback({ ok: true, results: [{ ...result, ...list[0].product, monthlySales: 37 }], halt: { code: 'RATE_LIMIT', retryAfterMs: 15000 } });
  await clock.flush();
  const retained = list[0].result;
  assert.equal(api.state().completed, 1);
  assert.match(api.dock.start.textContent, /15초 후 자동 계속/);
  await clock.advance(14999);
  assert.equal(api.requests.length, 1);
  await clock.advance(1);
  assert.equal(api.requests.length, 2);
  assert.deepEqual(Array.from(api.requests[1].message.products, p => p.productId), ['2', '3']);
  api.requests[1].callback({ ok: true, results: [], halt: { code: 'RATE_LIMIT', retryAfterMs: 5000 } });
  await clock.flush();
  assert.match(api.dock.start.textContent, /5초 후 자동 계속/);
  await clock.advance(4999);
  assert.equal(api.requests.length, 2);
  await clock.advance(1);
  assert.equal(api.requests.length, 3);
  assert.deepEqual(Array.from(api.requests[2].message.products, p => p.productId), ['2', '3']);
  api.requests[2].callback({ ok: true, results: api.requests[2].message.products.map(p => ({ ...result, ...p })) });
  await run;
  assert.equal(api.state().completed, 3);
  assert.equal(list[0].result, retained);
  assert.equal(api.requests.flatMap(request => Array.from(request.message.products, p => p.productId)).filter(id => id === '1').length, 1);
});

test('zero remaining cooldown resumes without adding another timer delay', async () => {
  const clock = fakeClock();
  const api = fixture(undefined, clock);
  const run = api.startLookup([record()], false);
  api.requests[0].callback({ ok: true, results: [], halt: { code: 'RATE_LIMIT', retryAfterMs: 0 } });
  await clock.flush();
  assert.equal(api.requests.length, 2);
  api.requests[1].callback({ ok: true, results: [result] });
  await run;
  assert.equal(api.state().completed, 1);
});

test('a server delay longer than fifteen minutes is never shortened into an early automatic request', async () => {
  const clock = fakeClock();
  const api = fixture(undefined, clock);
  const item = record();
  const run = api.startLookup([item], false);
  api.requests[0].callback({ ok: true, results: [], halt: { code: 'RATE_LIMIT', retryAfterMs: 1800000 } });
  await run;
  assert.equal(api.state().running, false);
  assert.equal(item.result, null);
  assert.match(api.dock.status.textContent, /조회 일시정지.*긴 대기 시간.*1,800초 뒤/);
  assert.doesNotMatch(api.dock.status.textContent, /실패/);
  await clock.advance(900000);
  assert.equal(api.requests.length, 1);
  await clock.advance(900000);
  assert.equal(api.requests.length, 1);
});

test('only exact active request progress renders a card early and final counts never double-count it', async () => {
  const api = fixture();
  const list = [record(), { ...record(), product: { ...product, productId: '999' } }];
  const binding = Object.fromEntries(['host', 'box', 'state', 'monthly', 'weekly', 'revenue', 'views', 'conversion', 'source', 'lookup', 'error'].map(key => [key, api.createElement('div')]));
  binding.host.isConnected = true;
  list[0].mounts.add(binding);
  const run = api.startLookup(list, false);
  const requestId = api.requests[0].message.requestId;
  assert.match(requestId, /^[A-Za-z0-9_-]{1,80}$/);
  const sendProgress = (patch = {}, sender = 'test-extension') => api.listeners[0]({ type: 'YF_SALES_PROGRESS', requestId, result: { ...result, monthlySales: 37 }, ...patch }, { id: sender }, () => {});
  sendProgress({ requestId: 'stale-request' });
  sendProgress({}, 'other-extension');
  sendProgress({ result: { ...result, productId: '777' } });
  assert.equal(list[0].result, null);
  sendProgress();
  assert.equal(list[0].result.monthlySales, 37);
  assert.equal(list[0].loading, false);
  assert.equal(binding.state.textContent, '최근 28일');
  assert.equal(binding.monthly.children[0].textContent, '37');
  assert.equal(api.state().running, true);
  assert.equal(api.state().completed, 0);
  assert.equal(api.dock.bar.style.width, '50%');
  assert.match(api.dock.start.textContent, /1\/2/);
  sendProgress();
  assert.equal(api.dock.bar.style.width, '50%');
  api.requests[0].callback({ ok: true, results: [{ ...result, monthlySales: 38 }, { ...result, ...list[1].product }] });
  await run;
  assert.equal(api.state().completed, 2);
  assert.equal(api.dock.bar.style.width, '100%');
  assert.equal(list[0].result.monthlySales, 38);
  sendProgress({ result: { ...result, monthlySales: 9999 } });
  assert.equal(list[0].result.monthlySales, 38);
});

test('a fresh page uses a different request nonce and stale progress during cooldown is ignored', async () => {
  const clock = fakeClock();
  const first = fixture(undefined, clock);
  const item = record();
  const run = first.startLookup([item], false);
  const requestId = first.requests[0].message.requestId;
  first.requests[0].callback({ ok: true, results: [], halt: { code: 'RATE_LIMIT', retryAfterMs: 60000 } });
  await clock.flush();
  first.listeners[0]({ type: 'YF_SALES_PROGRESS', requestId, result }, { id: 'test-extension' }, () => {});
  assert.equal(item.result, null);
  first.stopLookup('중지');
  await run;
  const second = fixture(undefined, clock);
  const restarted = second.startLookup([record()], false);
  assert.notEqual(second.requests[0].message.requestId, requestId);
  second.requests[0].callback({ ok: true, results: [result] });
  await restarted;
});

test('confirmed card progress survives a dropped final port reply and is counted exactly once', async () => {
  const api = fixture();
  const list = [record(), { ...record(), product: { ...product, productId: '999' } }];
  const run = api.startLookup(list, false);
  const message = { type: 'YF_SALES_PROGRESS', requestId: api.requests[0].message.requestId, result: { ...result, monthlySales: 37 } };
  api.listeners[0](message, { id: 'test-extension' }, () => {});
  api.listeners[0](message, { id: 'test-extension' }, () => {});
  api.runtime.lastError = { message: 'The message port closed before a response was received.' };
  api.requests[0].callback(undefined);
  delete api.runtime.lastError;
  await run;
  assert.equal(list[0].result.monthlySales, 37);
  assert.equal(list[1].result, null);
  assert.equal(api.state().completed, 1);
  assert.equal(api.state().running, false);
  assert.match(api.dock.status.textContent, /조회 중단 · 처리 1\/2개 · 지표 1개 · 자료 없음 0개 · 미조회 1개/);
  assert.equal(api.dock.bar.style.width, '50%');
  assert.equal(api.requests.length, 1);
});

