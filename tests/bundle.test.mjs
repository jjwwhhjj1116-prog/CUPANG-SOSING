import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
// Independent ZIP reader already present in the locked development toolchain.
// The application creates ZIP files without a runtime dependency on this package.
import { unzipSync } from 'fflate';

function load(file, overrides = {}, mode = 'development') {
  const source = ts.transpileModule(fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports = {};
  vm.runInNewContext(source, { exports, Response, TextEncoder, Uint8Array, ArrayBuffer, DataView, structuredClone, process: { env: { NODE_ENV: mode } }, require(name) {
    if (name in overrides) return overrides[name];
    if (name === 'next/server') return { NextResponse: Response };
    if (name === '@/app/chatgpt-auth') return { getChatGPTUser: async () => ({ userId: 'owner' }), getWorkspaceOwnerId: async () => 'owner' };
    const files = { '@/app/product-content': 'app/product-content.ts', '@/app/exports/zip': 'app/exports/zip.ts', '@/app/exports/review-bundle': 'app/exports/review-bundle.ts', '@/app/pricing': 'app/pricing.ts' };
    if (files[name]) return load(files[name], overrides, mode);
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

function routeWith({ find = async () => product, read = async () => contentWithAssets(), get = async () => ({ size: png.length, arrayBuffer: async () => png.slice().buffer }), mode } = {}) {
  return load('app/api/products/[id]/bundle/route.ts', {
    '@/db/queries': { findProduct: find }, '@/db/product-content': { readProductContent: read },
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
  for (const key of ['other/private.png', 'owner/unlinked.png']) {
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
