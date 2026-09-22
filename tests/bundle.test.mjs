import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { webcrypto } from 'node:crypto';
// Independent ZIP reader already present in the locked development toolchain.
// The application creates ZIP files without a runtime dependency on this package.
import { unzipSync } from 'fflate';

function load(file, overrides = {}, mode = 'development', cache = new Map()) {
  if (cache.has(file)) return cache.get(file);
  const source = ts.transpileModule(fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports = {}; cache.set(file, exports);
  vm.runInNewContext(source, { exports, Error, Response, URL, TextEncoder, TextDecoder, Uint8Array, ArrayBuffer, DataView, structuredClone, crypto: webcrypto, process: { env: { NODE_ENV: mode } }, require(name) {
    if (name in overrides) return overrides[name];
    if (name === 'next/server') return { NextResponse: Response };
    if (name === '@/app/chatgpt-auth') return { getChatGPTUser: async () => ({ userId: 'owner' }), getWorkspaceOwnerId: async () => 'owner' };
    if (name.startsWith('@/')) return load(`${name.slice(2)}.ts`, overrides, mode, cache);
    throw Error(name);
  } });
  return exports;
}
const model = load('app/product-content.ts');
const bundle = load('app/exports/review-bundle.ts');
const zip = load('app/exports/zip.ts');
const png = new Uint8Array(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2RkcAAAAASUVORK5CYII=', 'base64'));
const product = {
  id: 'product-1', owner_id: 'owner', title: '원문 상품', source_price_cny: 12.5, supply_price: 5000, sale_price: 8000, msrp: 10000,
  options_count: 3, updated_at: '2026-09-22T00:00:00.000Z', image_keys: '["owner/main.png","owner/detail.png"]', pricing_policy: '{"roundingUnit":10}',
};
const context = { params: Promise.resolve({ id: product.id }) };
const decode = bytes => new TextDecoder().decode(bytes);
function contentWithAssets() {
  return model.applyContentPatch(model.emptyProductContent(product.id), {
    seo: { title: '노출 상품명', description: '제품 설명', keywords: ['키워드'] },
    assets: { main: ['owner/main.png'], detail: ['owner/detail.png'] },
  }, product.updated_at);
}
function readArchive(bytes) { return unzipSync(bytes); }

test('review archive opens with independent ZIP parser and retains binary assets and revision metadata', () => {
  const content = contentWithAssets();
  const archive = readArchive(bundle.createReviewBundle(product, content, [
    { key: 'owner/main.png', name: 'assets/image-001.png', data: png },
    { key: 'owner/detail.png', name: 'assets/image-002.png', data: png },
  ]));
  assert.equal(Object.keys(archive).length, 8);
  assert.deepEqual(archive['assets/image-001.png'], png);
  assert.deepEqual(archive['assets/image-002.png'], png);
  const manifest = JSON.parse(decode(archive['manifest.json']));
  assert.equal(manifest.submissionReady, false); assert.equal(manifest.contentRevision, 1);
  assert.equal(manifest.productUpdatedAt, product.updated_at); assert.equal(manifest.pricePolicy.roundingUnit, 10);
  assert.deepEqual(manifest.assets.main, ['assets/image-001.png']); assert.deepEqual(manifest.assets.detail, ['assets/image-002.png']);
  assert.ok(decode(archive['detail-review.html']).includes('src="assets/image-002.png"'));
  assert.ok(!decode(archive['detail-review.html']).includes('src="assets/image-001.png"'));
  assert.equal(JSON.parse(decode(archive['content.json'])).seo.title.provenance, 'manual');
  assert.ok(decode(archive['quotation-review.csv']).includes('"5000"'));
});

test('HTML and label SVG escape user markup while CSV neutralizes spreadsheet formulas', () => {
  const content = model.applyContentPatch(model.emptyProductContent(product.id), {
    seo: { title: '=HYPERLINK("evil")', description: '<script>alert("x")</script> & <img src=x onerror="bad">', keywords: ['<b>키워드</b>'] },
    label: { productName: '</text><script>x</script>', manufacturer: 'A&B "제조사"' },
  }, product.updated_at);
  const files = readArchive(bundle.createReviewBundle(product, content, []));
  const html = decode(files['detail-review.html']); const svg = decode(files['label-review.svg']); const csv = decode(files['quotation-review.csv']);
  assert.ok(!html.includes('<script>')); assert.ok(!html.includes('<img src=x'));
  assert.ok(html.includes('&lt;script&gt;')); assert.ok(html.includes('&amp;')); assert.ok(html.includes('&lt;b&gt;키워드&lt;/b&gt;'));
  assert.ok(!svg.includes('<script>')); assert.ok(svg.includes('&lt;/text&gt;&lt;script&gt;'));
  assert.ok(svg.includes('A&amp;B &quot;제조사&quot;'));
  assert.ok(csv.includes('"\'=HYPERLINK(""evil"")"'));
});

test('empty fields remain missing, unverified content stays unverified, and missing mapped assets fail', () => {
  const empty = model.emptyProductContent(product.id);
  const files = readArchive(bundle.createReviewBundle(product, empty, []));
  const manifest = JSON.parse(decode(files['manifest.json']));
  assert.ok(manifest.missing.includes('대표 이미지')); assert.ok(manifest.missing.includes('노출 상품명'));
  assert.equal(JSON.parse(decode(files['content.json'])).label.countryOfOrigin.value, '');
  assert.equal(JSON.parse(decode(files['content.json'])).label.countryOfOrigin.provenance, 'unverified');
  assert.ok(decode(files['label-review.svg']).includes('[미입력]'));
  assert.ok(decode(files['detail-review.html']).includes(product.title));
  assert.throws(() => bundle.createReviewBundle(product, contentWithAssets(), []), /첨부/);
});

test('ZIP writer protects extraction paths and CRC implementation matches standard vector', () => {
  assert.equal(zip.crc32(new TextEncoder().encode('123456789')), 0xcbf43926);
  for (const name of ['../outside.txt', '/absolute.txt', 'assets/../../outside.txt', 'assets\\evil.txt', 'assets//evil.txt']) {
    assert.throws(() => zip.zipFiles([{ name, data: 'x' }]));
  }
  assert.throws(() => zip.zipFiles([{ name: 'same.txt', data: '1' }, { name: 'same.txt', data: '2' }]));
  assert.throws(() => zip.zipFiles([{ name: 'too-large.bin', data: new Uint8Array(31 * 1024 * 1024) }]));
});

test('image export recognizes supported signatures including bounded AVIF brands and rejects active content', () => {
  assert.equal(bundle.imageExtension(png), 'png');
  assert.equal(bundle.imageExtension(new Uint8Array([255, 216, 255, 224])), 'jpg');
  assert.equal(bundle.imageExtension(new TextEncoder().encode('GIF89a000')), 'gif');
  assert.equal(bundle.imageExtension(new TextEncoder().encode('RIFF0000WEBP')), 'webp');
  const avif = new Uint8Array(24); new DataView(avif.buffer).setUint32(0, 24); avif.set(new TextEncoder().encode('ftypmif1'), 4); avif.set(new TextEncoder().encode('avif'), 16);
  assert.equal(bundle.imageExtension(avif), 'avif');
  new DataView(avif.buffer).setUint32(0, 1000); assert.throws(() => bundle.imageExtension(avif));
  for (const value of ['<svg onload="alert(1)"></svg>', '<html>bad</html>', 'pretend.png']) assert.throws(() => bundle.imageExtension(new TextEncoder().encode(value)));
});

function routeWith({ find = async () => product, read = async () => contentWithAssets(), get = async () => ({ size: png.length, arrayBuffer: async () => png.slice().buffer }), mode,
  readFields = async () => ({ schemaVersion: 1, productId: product.id, revision: 0, overrides: { common: {}, options: {} }, updatedAt: null }),
  readOptions = async () => ({ schemaVersion: 1, productId: product.id, revision: 0, rows: [], updatedAt: null }), readSettings = async () => null,
  readProfile = async () => null, readCollection = async () => null, sourcesCurrent = async () => true,
} = {}) {
  return load('app/api/products/[id]/bundle/route.ts', {
    '@/db/queries': { findProduct: find, getSettings: readSettings }, '@/db/product-content': { readProductContent: read },
    '@/db/product-options': { readProductOptions: readOptions }, '@/db/category-profiles': { getCategoryProfile: readProfile },
    '@/db/quotation-fields': { readQuotationFields: readFields, readQuotationCollectionSource: readCollection, quotationSourcesCurrent: sourcesCurrent },
    'cloudflare:workers': { env: { FILES: { get } } },
  }, mode);
}
const getRequest = () => new Request('http://localhost/api/products/product-1/bundle');

test('bundle route returns a private downloadable ZIP containing only assigned owner assets', async () => {
  const requested = [];
  const route = routeWith({ get: async key => { requested.push(key); return { size: png.length, arrayBuffer: async () => png.slice().buffer }; } });
  const response = await route.GET(getRequest(), context);
  assert.equal(response.status, 200); assert.equal(response.headers.get('content-type'), 'application/zip');
  assert.equal(response.headers.get('cache-control'), 'no-store'); assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  assert.ok(response.headers.get('content-disposition').includes('attachment'));
  assert.deepEqual(requested, ['owner/main.png', 'owner/detail.png']);
  const files = readArchive(new Uint8Array(await response.arrayBuffer()));
  assert.deepEqual(files['assets/image-001.png'], png);
  assert.ok(files['manifest.json']);
});

test('bundle route rejects missing products, foreign/unlinked keys, absent objects, oversized and wrong-format images', async () => {
  let reads = 0;
  const missing = routeWith({ find: async () => null, read: async () => { reads++; } });
  assert.equal((await missing.GET(getRequest(), context)).status, 404); assert.equal(reads, 0);
  for (const key of ['other/private.png', 'owner/unlinked.png', 'owner/../private.png']) {
    const content = model.emptyProductContent(product.id); content.assets.main.value = [key];
    const response = await routeWith({ read: async () => content, get: async () => { throw Error('must not read unowned asset'); } }).GET(getRequest(), context);
    assert.equal(response.status, 409);
  }
  assert.equal((await routeWith({ get: async () => null }).GET(getRequest(), context)).status, 409);
  assert.equal((await routeWith({ get: async () => ({ size: 21 * 1024 * 1024, arrayBuffer: async () => { throw Error('must not allocate oversized file'); } }) }).GET(getRequest(), context)).status, 413);
  const svg = new TextEncoder().encode('<svg onload="bad"></svg>');
  assert.equal((await routeWith({ get: async () => ({ size: svg.length, arrayBuffer: async () => svg.buffer }) }).GET(getRequest(), context)).status, 400);
});

test('bundle route is closed in production and hides storage error details', async () => {
  const production = routeWith({ mode: 'production', find: async () => { throw Error('do not access production data'); } });
  assert.equal((await production.GET(getRequest(), context)).status, 503);
  const failed = await routeWith({ get: async () => { throw Error('secret token or bucket data'); } }).GET(getRequest(), context);
  assert.equal(failed.status, 503); assert.ok(!(await failed.text()).includes('secret token'));
});

test('bundle route detects content or price edits during asset download rather than exporting mixed versions', async () => {
  for (const changed of ['content', 'price', 'deleted']) {
    let downloadsStarted = false;
    const route = routeWith({
      find: async () => downloadsStarted && changed === 'deleted' ? null : { ...product, updated_at: downloadsStarted && changed === 'price' ? '2026-09-22T01:00:00.000Z' : product.updated_at },
      read: async () => ({ ...contentWithAssets(), revision: downloadsStarted && changed === 'content' ? 2 : 1 }),
      get: async () => { downloadsStarted = true; return { size: png.length, arrayBuffer: async () => png.slice().buffer }; },
    });
    const response = await route.GET(getRequest(), context);
    assert.equal(response.status, 409); assert.ok((await response.json()).error.includes('변경'));
  }
});

test('bundle limits cover cumulative image bytes and role reference count before allocating the archive', async () => {
  let arraysRead = 0;
  const route = routeWith({ get: async () => ({ size: 11 * 1024 * 1024, arrayBuffer: async () => { arraysRead++; return png.slice().buffer; } }) });
  assert.equal((await route.GET(getRequest(), context)).status, 413);
  assert.equal(arraysRead, 1);
  const content = model.emptyProductContent(product.id);
  content.assets.detail.value = Array.from({ length: 51 }, (_, index) => `owner/${index}.png`);
  const tooMany = routeWith({ find: async () => ({ ...product, image_keys: JSON.stringify(content.assets.detail.value) }), read: async () => content,
    get: async () => { throw Error('must not fetch oversized image list'); },
  });
  assert.equal((await tooMany.GET(getRequest(), context)).status, 409);
});

test('CRC table preserves standard CRC for arbitrary offsets and full-byte-range binary data',()=>{
  const bytes=new Uint8Array(8193); for(let i=0;i<bytes.length;i++)bytes[i]=(i*37+i%13)&255;
  const reference=bytes=>{let crc=0xffffffff;for(const byte of bytes){crc^=byte;for(let bit=0;bit<8;bit++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}return(crc^0xffffffff)>>>0;};
  for(const view of [bytes,bytes.subarray(3,7777),new Uint8Array(),new Uint8Array([0,255,128])])assert.equal(zip.crc32(view),reference(view));
  const files=unzipSync(zip.zipFiles([{name:'arbitrary.bin',data:bytes.subarray(3,7777)}]));assert.deepEqual(files['arbitrary.bin'],bytes.subarray(3,7777));
});

test('plain bundle preserves final quotation overrides and rejects changes in every export source',async()=>{
  const state={schemaVersion:1,productId:product.id,revision:2,updatedAt:null,overrides:{common:{title:'견적용 이름',model:'새 모델'},options:{removed:{color:'저장한 색상'}}}};
  const route=routeWith({readFields:async()=>state});const response=await route.GET(getRequest(),context);assert.equal(response.status,200);
  const files=readArchive(new Uint8Array(await response.arrayBuffer()));const doc=JSON.parse(decode(files['quotation-fields.json']));
  assert.equal(doc.rows.filter(row=>row.included)[0].fields.title.value,'견적용 이름');assert.equal(doc.rows[0].fields.title.source,'manual-common');assert.equal(doc.quotationRevision,2);
  assert.equal(doc.overrides.options.removed.color,'저장한 색상');assert.ok(decode(files['quotation-overrides.csv']).includes('저장한 색상'));assert.ok(files['quotation-fields.csv']);
  for(const changed of ['fields','settings','options']){
    let downloaded=false;
    const modifying=routeWith({readFields:async()=>({...state,revision:downloaded&&changed==='fields'?3:2}),
      readSettings:async()=>downloaded&&changed==='settings'?{payload:JSON.stringify({...load('app/workspace-settings.ts').defaultSettings,brand:'새 브랜드'})}:null,
      readOptions:async()=>({schemaVersion:1,productId:product.id,revision:downloaded&&changed==='options'?1:0,rows:[],updatedAt:null}),
      get:async()=>{downloaded=true;return{size:png.length,arrayBuffer:async()=>png.slice().buffer};}});
    assert.equal((await modifying.GET(getRequest(),context)).status,409,changed);
  }
});

test('bundle uses only the owned selected or captured category and tracks collection-context changes',async()=>{
  const profile={id:'chosen',revision:1,name:'관찰한 카테고리',categoryId:'80719',categoryPath:['주방용품'],template:null,mappings:[]};
  const chosen=new Request('http://localhost/api/products/product-1/bundle?profileId=chosen');
  assert.equal((await routeWith().GET(chosen,context)).status,404);
  const response=await routeWith({readProfile:async()=>profile}).GET(chosen,context);assert.equal(response.status,200);
  let doc=JSON.parse(decode(readArchive(new Uint8Array(await response.arrayBuffer()))['quotation-fields.json']));assert.equal(doc.categoryContext.source,'profile');assert.equal(doc.schema.status,'observed');
  const sourceProduct={...product,source_url:'https://detail.1688.com/offer/100001.html'};
  const captured={id:'job',payload:JSON.stringify({category:profile}),updatedAt:product.updated_at};
  const fromCollection=await routeWith({find:async()=>sourceProduct,readCollection:async()=>captured}).GET(getRequest(),context);
  assert.equal(fromCollection.status,200);doc=JSON.parse(decode(readArchive(new Uint8Array(await fromCollection.arrayBuffer()))['quotation-fields.json']));assert.equal(doc.categoryContext.source,'collection');assert.equal(doc.schema.categoryId,'80719');
  let downloaded=false;
  const changed=routeWith({find:async()=>sourceProduct,readCollection:async()=>downloaded?{...captured,payload:JSON.stringify({category:{...profile,categoryId:'unknown-new'}})}:captured,
    get:async()=>{downloaded=true;return{size:png.length,arrayBuffer:async()=>png.slice().buffer};}});
  assert.equal((await changed.GET(getRequest(),context)).status,409);
});

test('ZIP preflight covers central-directory bytes and UTF-8 text without mutating binary inputs',()=>{
  const text='한글🙂\\uD800'+String.fromCharCode(0xd800)+'tail';const data=new TextEncoder().encode(text);
  assert.equal(zip.utf8ByteLength(text),data.length);
  const binary=new Uint8Array([1,2,3,255]);const files=readArchive(zip.zipFiles([{name:'unicode.txt',data:text},{name:'binary.dat',data:binary}]));
  assert.deepEqual(files['unicode.txt'],data);assert.deepEqual(binary,new Uint8Array([1,2,3,255]));
  assert.throws(()=>zip.zipFiles([{name:'exact.bin',data:new Uint8Array(zip.MAX_ZIP_BYTES-31)}]),error=>error.status===413);
});
