import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { createRequire } from 'node:module';
import { renderToStaticMarkup } from 'react-dom/server';

const native = createRequire(import.meta.url);
const nodes = value => Array.isArray(value) ? value.flatMap(nodes) : value && typeof value === 'object' ? [value, ...nodes(value.props?.children)] : [];
const text = value => Array.isArray(value) ? value.map(text).join('') : value && typeof value === 'object' ? text(value.props?.children) : value == null ? '' : String(value);

function moduleLoader(globals = {}) {
  const cache = new Map();
  function load(file) {
    if (cache.has(file)) return cache.get(file);
    const exports = {}; cache.set(file, exports);
    const source = fs.readFileSync(new URL('../' + file, import.meta.url), 'utf8') + (file.endsWith('/dashboard-client.tsx') ? '\nexport { LegacyQuotePanel, downloadQuote };' : '');
    vm.runInNewContext(ts.transpileModule(source, { fileName: file, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText,
      { exports, process, URL, URLSearchParams, Date, Intl, Error, AbortController, TextEncoder, TextDecoder, crypto, queueMicrotask, Blob, ...globals,
        require(name) {
          if (name === 'react' && globals.hooks) return globals.hooks;
          if (name.endsWith('.css')) return {};
          if (name.startsWith('@/app/components/')) return new Proxy({}, { get: () => () => null });
          return name.startsWith('@/') ? load(name.slice(2) + '.ts') : native(name);
        } });
    return exports;
  }
  return load;
}

test('observed option-number pattern formats its suffix with explicit valid display bounds',()=>{
  const {optionRegistrationNumber}=moduleLoader()('app/product-registration.ts'),parent='261015123001';
  assert.equal(optionRegistrationNumber(parent,0),'261015123001');assert.equal(optionRegistrationNumber(parent,1),'261015123002');assert.equal(optionRegistrationNumber(parent,998),'261015123999');
  for(const index of [-1,999,1.5,NaN,Infinity])assert.equal(optionRegistrationNumber(parent,index),null);
  for(const value of [undefined,'','26101512301','261015123001\n','YP-12345678'])assert.equal(optionRegistrationNumber(value,0),null);
});

test('persisted option display maps validate current identities, one parent prefix and unique nonzero suffixes',()=>{
  const {validOptionRegistrationNumbers,savedOptionRegistrationNumber,optionRegistrationLabel}=moduleLoader()('app/product-registration.ts');
  const rows=[{id:'uuid-a'},{id:'uuid-b'},{id:'legacy'}],parent='261015123001',numbers={'uuid-a':'261015123009','uuid-b':'261015123002'};
  assert.equal(validOptionRegistrationNumbers(undefined,rows,parent),true);assert.equal(validOptionRegistrationNumbers({},rows,parent),true);
  assert.equal(validOptionRegistrationNumbers(numbers,rows,parent),true);assert.equal(validOptionRegistrationNumbers(numbers,[...rows].reverse()),true);
  for(const value of [null,[],true,'261015123001',{'foreign':'261015123001'},{'uuid-a':'261015123000'},
    {'uuid-a':'261015123001\n'},{'uuid-a':'26101512301'},{'uuid-a':261015123001},
    {'uuid-a':'261015123001','uuid-b':'261015123001'},{'uuid-a':'261015123001','uuid-b':'261015124002'}])
    assert.equal(validOptionRegistrationNumbers(value,rows),false,JSON.stringify(value));
  assert.equal(validOptionRegistrationNumbers(numbers,rows,'261015124001'),false);
  assert.equal(validOptionRegistrationNumbers(numbers,rows,'YP-LEGACY'),false);
  assert.equal(validOptionRegistrationNumbers({'uuid-a':'261015123999'},rows,parent),true);
  const before=JSON.stringify({rows,numbers});
  assert.equal(savedOptionRegistrationNumber('uuid-a',numbers),'261015123009');assert.equal(savedOptionRegistrationNumber('legacy',numbers),'legacy');
  assert.equal(savedOptionRegistrationNumber('toString',numbers),'toString','prototype properties are never metadata');
  assert.equal(optionRegistrationLabel(null,'상품 공통값',numbers),'상품 공통값');
  assert.equal(optionRegistrationLabel('uuid-a','빨강',numbers),'261015123009 · 빨강');
  assert.equal(optionRegistrationLabel('uuid-a','uuid-a',numbers),'261015123009');
  assert.equal(optionRegistrationLabel('uuid-a','',numbers),'261015123009');
  assert.equal(optionRegistrationLabel('legacy','이전 옵션',numbers),'이전 옵션');
  assert.equal(JSON.stringify({rows,numbers}),before);
});

test('printable quote header displays registration metadata while its print action and CSV retain saved identity', async () => {
  const blobs = [], downloads = [], timers = []; let printed = 0;
  class BrowserURL extends URL {}
  BrowserURL.createObjectURL = blob => { blobs.push(blob); return 'blob:quote-test'; };
  BrowserURL.revokeObjectURL = () => {};
  const load = moduleLoader({ URL: BrowserURL, window: { print() { printed++; }, setTimeout(fn) { timers.push(fn); } },
    document: { createElement() { return { click() { downloads.push({ href: this.href, download: this.download }); } }; } } });
  const { LegacyQuotePanel, downloadQuote } = load('app/components/dashboard-client.tsx');
  const product = { id: '15b1f850-5443-49b2-bccd-849d90a2dc1a', registration_number: '261015012001', title: '검토 상품', source_url: 'https://detail.1688.com/offer/813724060928.html', options_count: 2,
    supply_price: 1400, sale_price: 2340, msrp: 3050, updated_at: '2026-10-15T01:00:00.000Z' }, settings = { importer: '검토 수입원' }, before = JSON.stringify(product);
  const tree = LegacyQuotePanel({ product, settings });
  assert.match(renderToStaticMarkup(tree), /<strong>261015012001<\/strong>/);
  assert.doesNotMatch(renderToStaticMarkup(tree), /YP-15B1F850/);
  nodes(tree).find(node => node.type === 'button' && text(node) === '견적서 인쇄 / PDF').props.onClick(); assert.equal(printed, 1);
  downloadQuote(product, settings);
  const csv = await blobs[0].text(); assert.match(csv, /"상품 ID","상품명","상품 URL"/); assert.ok(csv.includes('"' + product.id + '","검토 상품",')); assert.ok(!csv.includes(product.registration_number));
  assert.deepEqual(downloads, [{ href: 'blob:quote-test', download: 'YOOFAM-PLUS-quote-' + product.id + '.csv' }]); assert.equal(timers.length, 1); assert.equal(JSON.stringify(product), before);
  const legacy = { ...product }; delete legacy.registration_number;
  assert.match(renderToStaticMarkup(LegacyQuotePanel({ product: legacy, settings })), /<strong>YP-15B1F850<\/strong>/);
});

test('archive displays numbers only for product rows and searches and opens through the existing server and UUID contracts', async () => {
  const rows = [{ id: 'new-product-uuid', sourceKind: 'product', registration_number: '261015013001', title: '새 상품' },
    { id: '12345678-legacy', sourceKind: 'product', title: '기존 상품' }, { id: 'request-uuid', sourceKind: 'request', registration_number: '261015099001', title: '수집 요청' }]
    .map(row => ({ ...row, sourceUrl: 'https://detail.1688.com/offer/813724060928.html', offerId: '813724060928', createdAt: '2026-10-15T00:00:00.000Z', updatedAt: '2026-10-15T00:00:00.000Z', status: row.sourceKind === 'request' ? 'awaiting_connector' : '등록대기', supplierHubStatus: null, category: null }));
  const before = JSON.stringify(rows), slots = [], effects = [], requests = [], opened = []; let index = 0;
  const hooks = {
    useId: () => 'archive-test',
    useState(initial) { const slot = index++; if (!(slot in slots)) slots[slot] = typeof initial === 'function' ? initial() : initial; return [slots[slot], value => { slots[slot] = typeof value === 'function' ? value(slots[slot]) : value; }]; },
    useRef(initial) { const slot = index++; return slots[slot] ?? (slots[slot] = { current: initial }); },
    useCallback(fn, deps) { const slot = index++, old = slots[slot]; if (!old || deps.some((value, i) => !Object.is(value, old.deps[i]))) slots[slot] = { fn, deps }; return slots[slot].fn; },
    useEffect(fn, deps) { const slot = index++, old = slots[slot]; if (!old || deps.some((value, i) => !Object.is(value, old.deps[i]))) { const entry = { deps, cleanup: old?.cleanup }; slots[slot] = entry; effects.push(() => { entry.cleanup?.(); entry.cleanup = fn(); }); } },
  };
  const load = moduleLoader({ hooks, fetch: async (url, init) => { requests.push({ url, init }); return Response.json({ items: rows, nextCursor: null, range: 'all', from: null, to: null, query: '', limit: 50, timeZone: 'Asia/Seoul' }); } });
  const Archive = load('app/components/product-archive.tsx').ProductArchive;
  const render = () => { index = 0; const tree = Archive({ onOpenProduct: id => opened.push(id) }); effects.splice(0).forEach(fn => fn()); return tree; };
  const settle = async () => { for (let i = 0; i < 8; i++) { render(); await new Promise(resolve => setImmediate(resolve)); } };
  try {
    await settle(); let tree = render(); const html = renderToStaticMarkup(tree);
    assert.match(html, /등록번호 261015013001/); assert.match(html, /등록번호 YP-12345678/); assert.doesNotMatch(html, /261015099001|YP-REQUEST-/);
    const search = nodes(tree).find(node => node.type === 'input' && node.props.type === 'search'); search.props.onChange({ target: { value: '261015013001' } });
    tree = render(); nodes(tree).find(node => node.type === 'form').props.onSubmit({ preventDefault() {} }); await settle();
    assert.equal(new URL(requests.at(-1).url, 'https://app.test').searchParams.get('q'), '261015013001'); assert.equal(requests.at(-1).init.cache, 'no-store');
    const button = nodes(render()).find(node => node.type === 'button' && text(node) === '상품 작업 열기 →'); await button.props.onClick();
    assert.deepEqual(opened, ['new-product-uuid']); assert.equal(JSON.stringify(rows), before);
  } finally { slots.forEach(slot => slot?.cleanup?.()); }
});
