import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as parse5 from 'parse5';
import { webcrypto, createHash } from 'node:crypto';

function modules(env = {}) {
  const cache = new Map();
  function load(file) {
    if (cache.has(file)) return cache.get(file);
    const code = ts.transpileModule(fs.readFileSync(new URL('../' + file, import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    const exports = {}; cache.set(file, exports);
    vm.runInNewContext(code, { exports, Error, URL, Headers, Response, Request, TextEncoder, TextDecoder, Uint8Array, ArrayBuffer, DataView, structuredClone, crypto: webcrypto,
      require(name) {
        if (name === 'parse5') return parse5;
        if (name === 'cloudflare:workers') return { env };
        if (name.startsWith('@/')) return load(name.slice(2) + '.ts');
        throw Error(name);
      } }, { filename: file });
    return exports;
  }
  return load;
}
const load = modules();
const api = load('app/quotation-public-detail.ts');
const { emptyProductContent, applyContentPatch } = load('app/product-content.ts');
const { emptyProductOptions, emptyOptionInput, applyOptionRows } = load('app/product-options.ts');
const { resolveQuotationFields } = load('app/quotation-schema.ts');
const { defaultSettings } = load('app/workspace-settings.ts');
const config = { secret: 'a1'.repeat(32), origin: 'https://example.com' };
const keys = ['owner/top.png', 'owner/body.png', 'owner/bottom.png', 'owner/replacement.png'];
const product = { id: 'test', title: 'SEO fallback', source_url: 'https://detail.1688.com/offer/813724060928.html', image_keys: JSON.stringify(keys), pricing_policy: null, source_price_cny: 3.6, supply_price: 4260, sale_price: 7100, msrp: 9230 };
const options = applyOptionRows(emptyProductOptions('test'), [
  { ...emptyOptionInput('first'), originalName: 'first', unitCostCny: 3.6, included: true },
  { ...emptyOptionInput('second'), originalName: 'second', unitCostCny: 5.5, included: true },
  { ...emptyOptionInput('excluded'), originalName: 'excluded', unitCostCny: 3.6, included: false },
], '2026-09-30T00:00:00.000Z');
const content = applyContentPatch(emptyProductContent('test'), { seo: { title: 'SEO unrelated' }, detail: { description: '<문구>&\n두 번째', altText: '검토 "이미지"' }, assets: { detailTop: [keys[0]], detail: [keys[1]], detailBottom: [keys[2]] } }, '2026-09-30T00:00:00.000Z');
function resolved(overrides = { common: {}, options: {} }) { return resolveQuotationFields({ categoryId: '80719', product, content, options, settings: defaultSettings, overrides }); }
const png = new Uint8Array(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2RkcAAAAASUVORK5CYII=', 'base64'));
const assets = keys.map((key, index) => ({ key, name: `assets/image-${index}.png`, data: png }));
const plain = value => JSON.parse(JSON.stringify(value));
function bucket() {
  const objects = new Map(), writes = [], reads = [];
  return { objects, writes, reads,
    async put(key, value, settings) {
      assert.equal(settings.onlyIf.get('if-none-match'), '*');
      assert.equal(settings.sha256, createHash('sha256').update(value).digest('hex'));
      writes.push(key); if (objects.has(key)) return null;
      const stored = { size: value.length, data: new Uint8Array(value), customMetadata: settings.customMetadata, httpMetadata: settings.httpMetadata };
      objects.set(key, stored); return stored;
    },
    async head(key) { reads.push(key); return objects.get(key) ?? null; },
    async get(key) { reads.push(key); const object = objects.get(key); return object ? { ...object, body: new Response(object.data).body } : null; },
  };
}

test('public-detail configuration is explicit, HTTPS only, and never exposes its key in version metadata', async () => {
  assert.equal(api.publicDetailConfig({}), null);
  assert.deepEqual(plain(api.publicDetailConfig({ YOOFAM_DETAIL_IMAGE_SECRET: config.secret, YOOFAM_DETAIL_IMAGE_ORIGIN: config.origin })), config);
  for (const origin of ['http://example.com', 'https://user@example.com', 'https://example.com/a', 'https://example.com/?a=b', 'https://example.com/#a', 'https://localhost', 'https://127.0.0.1', 'https://example.com:8443'])
    assert.throws(() => api.publicDetailConfig({ YOOFAM_DETAIL_IMAGE_SECRET: config.secret, YOOFAM_DETAIL_IMAGE_ORIGIN: origin }));
  assert.throws(() => api.publicDetailConfig({ YOOFAM_DETAIL_IMAGE_ORIGIN: config.origin }));
  assert.throws(() => api.publicDetailConfig({ YOOFAM_DETAIL_IMAGE_SECRET: 'weak', YOOFAM_DETAIL_IMAGE_ORIGIN: config.origin }));
  const version = await api.publicDetailVersion(config);
  assert.ok(!JSON.stringify(version).includes(config.secret));
  assert.notEqual(version.keyId, (await api.publicDetailVersion({ ...config, secret: 'b2'.repeat(32) })).keyId);
});

test('5th-stage top/body/bottom selections and description reach option HTML without publication or saved-state mutation', async () => {
  const before = JSON.stringify({ content, options });
  const result = await api.resolvePublicDetail(resolved(), content, 'owner', keys, config);
  assert.deepEqual(Array.from(result.images, image => image.key), keys.slice(0, 3));
  const html = result.resolved.rows[0].fields.detailHtml.value;
  assert.ok(html.includes('&lt;문구&gt;&amp;<br>두 번째'));
  assert.ok(html.includes('alt="검토 &quot;이미지&quot; 1"'));
  assert.ok(!html.includes('SEO unrelated'));
  for (let i = 0; i < 3; i++) {
    assert.match(result.images[i].token, /^[a-f0-9]{64}$/);
    assert.ok(html.includes(result.images[i].url));
    if (i) assert.ok(html.indexOf(result.images[i-1].url) < html.indexOf(result.images[i].url));
  }
  assert.ok(!html.includes('owner/'));
  assert.equal(JSON.stringify({ content, options }), before);
  const repeat = await api.resolvePublicDetail(resolved(), content, 'owner', keys, config);
  assert.equal(repeat.resolved.rows[0].fields.detailHtml.value, html);
});

test('final option image overrides determine HTML order; excluded-only images are not published', async () => {
  const result = await api.resolvePublicDetail(resolved({ common: {}, options: {
    first: { detailImages: keys[1] + '\n' + keys[0], altText: '' }, second: { detailImages: '' }, excluded: { detailImages: keys[3] },
  } }), content, 'owner', keys, config);
  assert.deepEqual(new Set(Array.from(result.images, image => image.key)), new Set([keys[1], keys[0]]));
  const first = result.resolved.rows.find(row => row.optionId === 'first').fields.detailHtml.value;
  assert.match(first, /alt=""/);
  assert.ok(first.indexOf(result.images.find(image => image.key === keys[1]).url) < first.indexOf(result.images.find(image => image.key === keys[0]).url));
  assert.equal(result.resolved.rows.find(row => row.optionId === 'second').fields.detailHtml.value, '<p>&lt;문구&gt;&amp;<br>두 번째</p>');
  assert.equal(result.resolved.rows.find(row => row.optionId === 'excluded').included, false);
});

test('direct HTML and deliberate blanks are authoritative, including an empty common override', async () => {
  for (const value of ['', '<img src="https://manual.example/a.png">']) {
    const result = await api.resolvePublicDetail(resolved({ common: { detailHtml: value }, options: {} }), content, 'owner', keys, config);
    assert.ok(result.resolved.rows.every(row => row.fields.detailHtml.value === value));
    assert.equal(result.images.length, 0);
  }
  const result = await api.resolvePublicDetail(resolved({ common: {}, options: { first: { detailHtml: '' } } }), content, 'owner', keys, config);
  assert.equal(result.resolved.rows.find(row => row.optionId === 'first').fields.detailHtml.value, '');
  assert.match(result.resolved.rows.find(row => row.optionId === 'second').fields.detailHtml.value, /<img /);
});

test('no configuration retains legacy paragraph behavior; image capabilities differ by owner and signing key', async () => {
  const original = resolved();
  assert.equal((await api.resolvePublicDetail(original, content, 'owner', keys, null)).resolved, original);
  const a = await api.resolvePublicDetail(original, content, 'owner', keys, config);
  const b = await api.resolvePublicDetail(original, content, 'owner', keys, { ...config, secret: 'b2'.repeat(32) });
  assert.notEqual(a.images[0].token, b.images[0].token);
  const other = structuredClone(original); other.rows.forEach(row => { row.fields.detailImages.value = 'other/top.png'; });
  const c = await api.resolvePublicDetail(other, content, 'other', ['other/top.png'], config);
  assert.notEqual(a.images[0].token, c.images[0].token);
});

test('foreign, removed, repeated and excessive detail references remain editable and cannot become public links', async () => {
  for (const value of ['other/image.png', 'owner/missing.png', keys[0] + '\n' + keys[0], Array.from({ length: 31 }, (_, i) => `owner/${i}.png`).join('\n')]) {
    const data = resolved(); data.rows[0].fields.detailImages.value = value;
    const result = await api.resolvePublicDetail(data, content, 'owner', keys, config);
    assert.ok(!result.resolved.rows[0].fields.detailHtml.value.includes('/media/quotation/'));
    assert.match(result.resolved.rows[0].fields.detailHtml.validationIssues.join(' '), /이미지/);
  }
});

test('a removed image on an excluded option does not prevent preparing included option HTML', async () => {
  const result = await api.resolvePublicDetail(resolved({ common: {}, options: { excluded: { detailImages: 'owner/removed.png' } } }), content, 'owner', keys, config);
  assert.equal(result.images.length, 3);
  assert.match(result.resolved.rows.find(row => row.optionId === 'first').fields.detailHtml.value, /<img /);
  const excluded = result.resolved.rows.find(row => row.optionId === 'excluded');
  assert.equal(excluded.included, false); assert.match(excluded.fields.detailHtml.validationIssues.join(' '), /이미지/);
});

test('an explicit publication copies only referenced image bytes and retries without rewriting the URL contents', async () => {
  const b = bucket(), detail = await api.resolvePublicDetail(resolved(), content, 'owner', keys, config);
  await api.publishPublicDetail(detail.images, assets, b);
  assert.equal(b.objects.size, 3);
  assert.ok([...b.objects.keys()].every(key => key.startsWith(api.PUBLIC_DETAIL_PREFIX)));
  assert.ok(!JSON.stringify([...b.objects.values()].map(object => object.customMetadata)).includes('owner/'));
  await api.publishPublicDetail(detail.images, assets, b);
  assert.equal(b.objects.size, 3);
  const changed = { ...assets[0], data: new Uint8Array([...png, 1]) };
  await assert.rejects(api.publishPublicDetail([detail.images[0]], [changed], b), /저장 파일/);
  assert.deepEqual(b.objects.get(api.PUBLIC_DETAIL_PREFIX + detail.images[0].token).data, png);
});

test('all attachment bytes are checked before any publication, and storage failures do not confirm an export', async () => {
  const detail = await api.resolvePublicDetail(resolved(), content, 'owner', keys, config);
  for (const invalid of [assets.slice(0, 2), [assets[0], { ...assets[1], data: new Uint8Array(Buffer.from('GIF89a')) }, assets[2]], [assets[0], { ...assets[1], data: new Uint8Array(10*1024*1024 + 1) }, assets[2]]]) {
    const b = bucket(); await assert.rejects(api.publishPublicDetail(detail.images, invalid, b)); assert.equal(b.writes.length, 0);
  }
  await assert.rejects(api.publishPublicDetail([detail.images[0]], assets, { put: async () => null, head: async () => null }), /저장 파일/);
});

test('actual GIF bytes are reported for included generated HTML despite opaque image URLs', async () => {
  const detail = await api.resolvePublicDetail(resolved({ common: {}, options: { first: { detailHtml: '' } } }), content, 'owner', keys, config);
  const gifAssets = assets.map(asset => ({ ...asset, data: new Uint8Array(Buffer.from('GIF89a')) }));
  const issues = api.publicDetailMediaIssues(detail.resolved, detail.images, gifAssets);
  assert.equal(issues.length, 1); assert.equal(issues[0].optionId, 'second');
  assert.equal(issues[0].code, 'HTML_MEDIA_UNSUPPORTED'); assert.equal(issues[0].fieldId, 'detailHtml');
});

test('public route serves an explicitly published image without a login and never resolves arbitrary private keys', async () => {
  const b = bucket(), detail = await api.resolvePublicDetail(resolved(), content, 'owner', keys, config);
  const route = modules({ FILES: b })('app/media/quotation/[token]/route.ts');
  const request = new Request(detail.images[0].url), context = { params: Promise.resolve({ token: detail.images[0].token }) };
  assert.equal((await route.GET(request, context)).status, 404);
  await api.publishPublicDetail([detail.images[0]], assets, b);
  const response = await route.GET(request, context);
  assert.equal(response.status, 200); assert.equal(response.headers.get('content-type'), 'image/png');
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff'); assert.match(response.headers.get('x-robots-tag'), /noindex/);
  assert.deepEqual(new Uint8Array(await response.arrayBuffer()), png);
  for (const token of ['../owner/top.png', 'owner/top.png', 'a'.repeat(63), 'A'.repeat(64), 'a'.repeat(64) + '/a']) {
    const count = b.reads.length; assert.equal((await route.GET(request, { params: Promise.resolve({ token }) })).status, 404); assert.equal(b.reads.length, count);
  }
});

test('public route rejects unsigned namespace objects, tampered bytes, wrong MIME, oversized and active content', async () => {
  const b = bucket(), token = 'c'.repeat(64), key = api.PUBLIC_DETAIL_PREFIX + token;
  const route = modules({ FILES: b })('app/media/quotation/[token]/route.ts');
  const valid = { data: png, size: png.length, customMetadata: { publication: api.PUBLIC_DETAIL_FORMAT, sha256: createHash('sha256').update(png).digest('hex') }, httpMetadata: { contentType: 'image/png' } };
  for (const change of [{ customMetadata: {} }, { data: new Uint8Array([...png, 1]) }, { httpMetadata: { contentType: 'text/html' } }, { size: 10*1024*1024+1 }, { data: new TextEncoder().encode('<script>bad</script>') }]) {
    b.objects.set(key, { ...valid, ...change });
    assert.equal((await route.GET(new Request('https://example.com'), { params: Promise.resolve({ token }) })).status, 404);
  }
});

test('image-only public host rejects application/private paths and writes, while GET and HEAD serve the same published bytes', async () => {
  const b = bucket(), detail = await api.resolvePublicDetail(resolved(), content, 'owner', keys, config);
  const worker = modules({ FILES: b })('deployment/public-detail-worker.ts').default;
  await api.publishPublicDetail([detail.images[0]], assets, b);
  for (const path of ['/', '/api/products', '/api/files/owner/top.png', '/media/quotation/owner/top.png', '/media/quotation/' + 'A'.repeat(64), '/media/quotation/' + detail.images[0].token + '/extra']) {
    const reads = b.reads.length;
    const response = await worker.fetch(new Request(config.origin + path));
    assert.equal(response.status, 404); assert.equal(response.headers.get('cache-control'), 'no-store'); assert.equal(b.reads.length, reads);
  }
  for (const method of ['POST', 'PUT', 'DELETE', 'OPTIONS']) {
    const reads = b.reads.length;
    const response = await worker.fetch(new Request(detail.images[0].url, { method }));
    assert.equal(response.status, 405); assert.equal(response.headers.get('allow'), 'GET, HEAD'); assert.equal(b.reads.length, reads);
  }
  const response = await worker.fetch(new Request(detail.images[0].url));
  assert.equal(response.status, 200); assert.deepEqual(new Uint8Array(await response.arrayBuffer()), png);
  const head = await worker.fetch(new Request(detail.images[0].url, { method: 'HEAD' }));
  assert.equal(head.status, 200); assert.equal(head.headers.get('content-length'), String(png.length)); assert.equal((await head.arrayBuffer()).byteLength, 0);
});
