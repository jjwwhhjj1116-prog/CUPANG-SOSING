import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { createRequire } from 'node:module';
import { managedProductHarness, managedFixture } from './helpers/managed-products.mjs';

const native = createRequire(import.meta.url);
const companies = [{ code: 'A01464742', name: '와이홉' }, { code: 'A01526306', name: '유앤채' }];
const nodes = tree => Array.isArray(tree) ? tree.flatMap(nodes) : tree && typeof tree === 'object' ? [tree, ...nodes(tree.props?.children)] : [];
const text = tree => typeof tree === 'string' || typeof tree === 'number' ? String(tree) : Array.isArray(tree) ? tree.map(text).join('') : tree && typeof tree === 'object' ? text(tree.props?.children) : '';

function ui(fetcher) {
  const slots = [], effects = [], cleanups = new Map(), downloads = [], files = new Map(); let cursor = 0;
  const hooks = {
    useState(initial) { const index = cursor++; if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial;
      return [slots[index], value => { slots[index] = typeof value === 'function' ? value(slots[index]) : value; }]; },
    useRef(initial) { const index = cursor++; return slots[index] ?? (slots[index] = { current: initial }); },
    useEffect(fn, deps) { const index = cursor++, prior = slots[index]; if (!prior || deps.some((dep, i) => dep !== prior[i])) {
      slots[index] = deps; effects.push(() => { cleanups.get(index)?.(); cleanups.set(index, fn()); });
    } },
  };
  const table = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../app/managed-product-table.ts', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { exports: table, URLSearchParams, Error });
  class TestURL extends URL {
    static createObjectURL(blob) { const key = 'blob:history-' + files.size; files.set(key, blob); return key; }
    static revokeObjectURL() {}
  }
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../app/components/managed-products-panel.tsx', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, { exports, URL: TestURL, URLSearchParams, FormData, AbortController, Error, queueMicrotask,
    setTimeout(fn) { fn(); }, document: { createElement() { return { click() { downloads.push({ name: this.download, blob: files.get(this.href) }); } }; } },
    fetch: fetcher, require: name => name === 'react' ? hooks : name === '@/app/components/use-menu-dismissal' ? {usePopupDismissal(){}} : name === '@/app/managed-product-table' ? table
      : name === '@/app/components/managed-import-prices-panel' ? { ManagedImportPricesPanel: function ManagedImportPricesPanel() {} }
        : name === '@/app/components/managed-purchase-info-panel' ? { ManagedPurchaseInfoPanel: function ManagedPurchaseInfoPanel() {} }
          : name === '@/app/components/managed-product-barcode-panel' ? { ManagedProductBarcodePanel: function ManagedProductBarcodePanel() {} }
            : name === '@/app/components/managed-store-settings-panel' ? { ManagedStoreSettingsPanel: function ManagedStoreSettingsPanel() {} }
          : name.endsWith('.css') ? {} : native(name),
  });
  const render = () => { cursor = 0; const tree = exports.ManagedProductsPanel(); while (effects.length) effects.shift()(); return tree; };
  return { render, downloads,
    async settle() { for (let i = 0; i < 12; i++) { render(); await new Promise(resolve => setImmediate(resolve)); } },
    button(label) { const button = nodes(render()).find(node => node.type === 'button' && text(node) === label); assert.ok(button, 'missing button ' + label); return button; },
    find(label) { const element = nodes(render()).find(node => node.props?.['aria-label'] === label); assert.ok(element, 'missing control ' + label); return element; },
    rows() { return nodes(render()).filter(node => node.type === 'tr' && node.props['data-sku-id']); },
    cell(skuId, column) { const row = this.rows().find(row => row.props['data-sku-id'] === skuId); assert.ok(row, 'missing SKU ' + skuId);
      return nodes(row).find(node => node.type === 'td' && node.props['data-column'] === column); },
    close() { for (const cleanup of cleanups.values()) cleanup?.(); },
  };
}

const day = offset => new Date(Date.now() + offset * 86400000).toISOString();
async function fixture(company, mutate, count = 30, wrap) {
  const h = managedProductHarness();
  Object.assign(h.state.user.membership, { companyCode: company.code, companyName: company.name }); h.syncMember();
  const bytes = managedFixture(count, rows => {
    for (const [index, row] of rows.entries()) {
      row.상품명 = '이력 검토 상품 ' + index; row.노출ID = String(12000 + index); row.공급가 = String(8000 + index);
      row.발주가능상태 = index < 5 ? '품절' : index === 5 ? '' : index === 6 ? '판매중지' : '정상'; row.winner = index < 5 ? 'LOSER' : 'WINNER';
      row.productIdHistory = index < 12 ? JSON.stringify([
        { date: day(-10), productId: 'OLD-' + index },
        { date: day(1), ...(index === 11 ? {} : { productId: 'LATEST-' + index }), untouched: { nested: '원문 그대로' } },
        { date: day(-2), productId: 'EARLIER-' + index },
      ]) : '[]';
      row.priceHistory = index >= 6 && index < 21 ? JSON.stringify([
        { date: day(-1), price: 6000 + index, unknown: '보존' },
        { date: day(-10), price: 4000 + index },
      ]) : '[]';
      row.otherSellers = index >= 18 && index < 28 ? JSON.stringify({ hasOtherSellers: index === 27 ? 'false' : true,
        otherVendorNames: index === 27 ? [] : ['합성 판매자 ' + index, '<script>실행 금지</script>'], unknown: { keep: true } }) : JSON.stringify({ hasOtherSellers: false, otherVendorNames: [] });
      row.구매정보 = index === 29 ? JSON.stringify([{ 매칭상태: '매칭완료', 요청사항: '등록완료' }]) : '';
      row.매입정보 = index === 28 ? JSON.stringify([{ date: '2026-01-01', 매입가: 10 }]) : '';
      // A cached display cell cannot substantiate the actual import history.
      row.latestImportPrice = index === 28 ? '55555' : index === 0 ? '77777' : '';
    }
    mutate?.(rows);
  });
  try {
    const preview = await (await h.submit(bytes, { companyCode: company.code })).json();
    const imported = await h.submit(bytes, { action: 'import', sha256: preview.sha256, companyCode: company.code });
    assert.equal(imported.status, 201, await imported.clone().text());
    const original = JSON.stringify(h.sqlite.prepare('SELECT * FROM managed_products ORDER BY sku_id').all());
    const panel = ui(wrap ? wrap(h) : h.fetcher); await panel.settle();
    return { h, panel, original, bytes, close() { panel.close(); h.close(); } };
  } catch (error) { h.close(); throw error; }
}

const currentList = h => new URL(h.state.calls.filter(call => call.url.startsWith('/api/managed-products?')).at(-1).url, 'https://app.test').searchParams;
const currentExport = h => new URL(h.state.calls.filter(call => call.url.startsWith('/api/managed-products/export?')).at(-1).url, 'https://app.test').searchParams;

for (const company of companies) test(`all eight history filters keep the actual query, page and XLSX scope (${company.code})`, async () => {
  const f = await fixture(company), { h, panel } = f;
  try {
    const filters = nodes(panel.render()).find(node => node.type === 'nav' && node.props['aria-label'] === '등록 상품 필터');
    assert.deepEqual(nodes(filters).filter(node => node.type === 'button').map(node => text(node)), [
      '전체 30', '노출ID변경 12', '공급가변경 15', '타사매칭 10', '아이템루저 5', '발주불가 7', '구매정보없음 29', '매입정보없음 29',
    ]);
    const idCell = panel.cell('1000000000', '노출ID');
    assert.match(idCell.props.title, /LATEST-0.*12000/u); assert.ok(!idCell.props.title.includes('EARLIER-0'));
    assert.ok(nodes(idCell).some(node => node.props?.['aria-label'] === '노출ID 변경 이력'));
    const priceCell = panel.cell('1000000006', '공급가');
    assert.match(priceCell.props.title, /6006.*8006/u);
    assert.ok(nodes(priceCell).some(node => node.props?.['aria-label'] === '공급가 변경 이력'));

    panel.find('SKU 1000000000 선택').props.onChange({ target: { checked: true } });
    panel.button('노출ID변경 12').props.onClick(); await panel.settle();
    assert.equal(currentList(h).get('filter'), 'product-id-changed'); assert.equal(panel.rows().length, 10);
    panel.button('다음').props.onClick(); await panel.settle(); assert.equal(panel.rows().length, 2);
    assert.match(panel.cell('1000000011', '노출ID').props.title, /이전값 미확인.*12011/u);
    panel.button('공급가변경 15').props.onClick(); await panel.settle();
    assert.equal(currentList(h).get('filter'), 'price-changed'); assert.equal(currentList(h).get('page'), '1');
    assert.match(text(panel.render()), /전체 결과 15개 · 선택 1개/u);
    panel.find('판매가 정렬').props.onClick(); await panel.settle();
    panel.find('공급가 열 필터').props.onClick(); panel.find('상품관리 열 필터 조건').props.onChange({ target: { value: 'gte' } });
    panel.find('상품관리 열 필터 값').props.onChange({ target: { value: '8010' } });
    nodes(panel.render()).find(node => node.type === 'form' && node.props.role === 'dialog').props.onSubmit({ preventDefault() {} }); await panel.settle();
    assert.match(text(panel.render()), /전체 결과 11개/u); assert.equal(panel.rows().length, 10);
    panel.button('다음').props.onClick(); await panel.settle(); assert.equal(panel.rows().length, 1);
    panel.button('상품DB 다운로드').props.onClick(); await panel.settle();
    assert.equal(panel.downloads.length, 1);
    const listParams = currentList(h), exportParams = currentExport(h);
    for (const key of ['filter', 'search', 'sort', 'direction', 'columnFilters']) assert.equal(exportParams.get(key), listParams.get(key), key);
    assert.equal(exportParams.has('page'), false, 'download must include every matching page');
    const exported = await h.load('app/managed-products.ts').parseManagedProductWorkbook(await panel.downloads[0].blob.arrayBuffer(), company);
    assert.equal(exported.rows.length, 11);
    assert.deepEqual(Array.from(exported.rows, row => row.skuId), Array.from({ length: 11 }, (_, index) => String(1000000010 + index)));
    assert.equal(exported.rows[0].values.priceHistory, JSON.parse(h.sqlite.prepare('SELECT source_payload FROM managed_products WHERE sku_id=?').get(exported.rows[0].skuId).source_payload).priceHistory);
    panel.button('열 필터 모두 해제').props.onClick(); await panel.settle();
    panel.button('타사매칭 10').props.onClick(); await panel.settle(); assert.equal(currentList(h).get('filter'), 'other-sellers');
    const titleCell = panel.cell('1000000018', '상품명');
    assert.match(titleCell.props.title, /합성 판매자 18/u); assert.ok(titleCell.props.title.includes('<script>실행 금지</script>'));
    assert.ok(nodes(titleCell).some(node => node.props?.['aria-label'] === '타사매칭'));
    const markerWithoutNames = panel.cell('1000000027', '상품명');
    assert.match(markerWithoutNames.props.title, /판매자명 미확인/u);
    assert.ok(nodes(markerWithoutNames).some(node => node.props?.['aria-label'] === '타사매칭'), 'the recorded marker uses JS truthiness even for the nonempty string false');
    assert.ok(!nodes(panel.render()).some(node => node.props?.dangerouslySetInnerHTML), 'seller names remain inert text');
    for (const [label, id, total] of [
      ['아이템루저 5', 'loser', 5], ['발주불가 7', 'unavailable', 7], ['구매정보없음 29', 'no-purchase', 29],
      ['매입정보없음 29', 'no-import', 29], ['전체 30', 'all', 30],
    ]) {
      panel.button(label).props.onClick(); await panel.settle();
      assert.equal(currentList(h).get('filter'), id); assert.equal(currentList(h).get('page'), '1');
      assert.match(text(panel.render()), new RegExp('전체 결과 ' + total + '개'));
      assert.equal(panel.rows().length, Math.min(total, 10));
      if (id === 'unavailable') {
        assert.ok(panel.rows().some(row => row.props['data-sku-id'] === '1000000005'), 'explicit blank status is not normal');
        assert.ok(panel.rows().some(row => row.props['data-sku-id'] === '1000000006'), 'stopped status is not normal');
      }
    }
    panel.button('타사매칭 10').props.onClick(); await panel.settle();
    const searchForm = nodes(panel.render()).find(node => node.type === 'form' && !node.props.role);
    nodes(searchForm).find(node => node.type === 'input').props.onChange({ target: { value: '상품 1' } });
    nodes(panel.render()).find(node => node.type === 'form' && !node.props.role).props.onSubmit({ preventDefault() {} }); await panel.settle();
    assert.equal(currentList(h).get('search'), '상품 1'); assert.equal(panel.rows().length, 2);
    panel.button('상품DB 다운로드').props.onClick(); await panel.settle();
    assert.equal(currentExport(h).get('filter'), 'other-sellers'); assert.equal(currentExport(h).get('search'), '상품 1');
    const searched = await h.load('app/managed-products.ts').parseManagedProductWorkbook(await panel.downloads[1].blob.arrayBuffer(), company);
    assert.deepEqual(Array.from(searched.rows, row => row.skuId), ['1000000018', '1000000019']);
    assert.equal(JSON.stringify(h.sqlite.prepare('SELECT * FROM managed_products ORDER BY sku_id').all()), f.original);
    for (const table of ['products', 'collection_jobs', 'supplier_hub_receipts', 'managed_purchase_info', 'managed_import_prices']) assert.equal(h.sqlite.prepare(`SELECT COUNT(*) n FROM ${table}`).get().n, 0);
  } finally { f.close(); }
});

for (const company of companies) test(`empty and malformed history remain distinct without a false change badge (${company.code})`, async () => {
  const f = await fixture(company, rows => {
    for (const row of rows) { row.productIdHistory = ''; row.priceHistory = '[]'; row.otherSellers = ''; }
    rows[0].노출ID = ''; rows[0].productId = '43210';
    rows[1].productIdHistory = '{damaged'; rows[1].priceHistory = '[{"date":"not-a-date","price":7000}]';
    rows[1].otherSellers = '[{"hasOtherSellers":true,"otherVendorNames":["확인되지 않은 판매자"]}]';
  }, 2);
  try {
    assert.ok(f.panel.button('노출ID변경 0')); assert.ok(f.panel.button('공급가변경 0')); assert.ok(f.panel.button('타사매칭 0'));
    for (const skuId of ['1000000000', '1000000001']) {
      assert.ok(!nodes(f.panel.cell(skuId, '노출ID')).some(node => node.props?.['aria-label'] === '노출ID 변경 이력'));
      assert.ok(!nodes(f.panel.cell(skuId, '공급가')).some(node => node.props?.['aria-label'] === '공급가 변경 이력'));
      assert.ok(!nodes(f.panel.cell(skuId, '상품명')).some(node => node.props?.['aria-label'] === '타사매칭'));
    }
    assert.match(f.panel.cell('1000000000', '노출ID').props.title, /없음/u);
    assert.equal(text(f.panel.cell('1000000000', '노출ID')), '43210', 'the observed current ID fallback is read from the verified raw DTO');
    assert.match(f.panel.cell('1000000001', '노출ID').props.title, /미확인/u);
    assert.match(f.panel.cell('1000000001', '공급가').props.title, /미확인/u);
    assert.ok(!f.panel.cell('1000000001', '상품명').props.title.includes('확인되지 않은 판매자'));
    f.panel.button('노출ID변경 0').props.onClick(); await f.panel.settle(); assert.equal(f.panel.rows().length, 0);
    assert.equal(JSON.stringify(f.h.sqlite.prepare('SELECT * FROM managed_products ORDER BY sku_id').all()), f.original);
  } finally { f.close(); }
});

for (const company of companies) test(`a stale owned history page and download cannot publish the prior account (${company.code})`, async () => {
  let held, release, hold = false;
  const f = await fixture(company, undefined, 30, h => async (url, init = {}) => {
    const response = await h.fetcher(url, init);
    if (hold && url.startsWith('/api/managed-products?') && new URL(url, 'https://app.test').searchParams.get('filter') === 'product-id-changed') {
      hold = false; held = init.signal; return new Promise(resolve => { release = () => resolve(response); });
    }
    return response;
  });
  try {
    const savedDownload = f.panel.button('상품DB 다운로드').props.onClick;
    hold = true; f.panel.button('노출ID변경 12').props.onClick(); await f.panel.settle(); assert.ok(release);
    const old = f.h.state.user;
    f.h.state.user = { ...old, userId: 'other-history-owner', membership: { ...old.membership, id: 'other-history-owner' } }; f.h.syncMember();
    f.panel.button('전체 30').props.onClick(); await f.panel.settle(); assert.equal(held.aborted, true);
    release(); await f.panel.settle(); assert.equal(f.panel.rows().length, 0); assert.match(text(f.panel.render()), /전체 결과 0개/u);
    savedDownload(); await f.panel.settle(); assert.equal(f.panel.downloads.length, 0);
    assert.equal(JSON.stringify(f.h.sqlite.prepare('SELECT * FROM managed_products ORDER BY sku_id').all()), f.original);
  } finally { f.close(); }
});
