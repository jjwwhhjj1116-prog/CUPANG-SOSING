import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import ts from 'typescript';
import { webcrypto, createHash } from 'node:crypto';
import { deflateSync } from 'node:zlib';
import { memoryDatabase } from '../scripts/check-db-schema.mjs';

function png(width = 3, height = 2, color = 200) {
  const chunk = (name, data) => {
    const label = Buffer.from(name), joined = Buffer.concat([label, data]); let crc = 0xffffffff;
    for (const byte of joined) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0); }
    const size = Buffer.alloc(4), check = Buffer.alloc(4); size.writeUInt32BE(data.length); check.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
    return Buffer.concat([size, joined, check]);
  };
  const header = Buffer.alloc(13); header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 6;
  const rows = Buffer.alloc(height * (width * 4 + 1), typeof color === 'number' ? color : 0);
  for (let row = 0; row < height; row++) {
    rows[row * (width * 4 + 1)] = 0;
    if (color instanceof Uint8Array) rows.set(color.subarray(row * width * 4, (row + 1) * width * 4), row * (width * 4 + 1) + 1);
  }
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(rows)), chunk('IEND', Buffer.alloc(0))]);
}
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
function fixture() {
  const sqlite = memoryDatabase(), objects = new Map(), cache = new Map(), translations = [], writes = [], deletions = [], drawings = [], measurements = [], fontLoads = [];
  const document = { fonts: {
    async load(descriptor, sample) { fontLoads.push({ descriptor, sample }); return [{ family: 'Gmarket Sans', status: 'loaded' }]; }, check: () => true,
  }, createElement(tag) {
    assert.equal(tag, 'canvas'); const canvas = { width: 0, height: 0, pixels: null }, clips = []; let clip = null;
    const textWidth = (font, text) => Array.from(text).length * Number(/([0-9.]+)px/u.exec(font)?.[1]) / 2
      * (/\bbold\b/u.test(font) ? 1.25 : 1) * (/\bitalic\b/u.test(font) ? 1.1 : 1);
    const context = {
      drawImage(image, x, y) { assert.equal(x, 0); assert.equal(y, 0); canvas.pixels = image.pixels.slice(); },
      save() { clips.push(clip); }, restore() { clip = clips.pop(); }, beginPath() {}, rect(x, y, width, height) { clip = { x, y, width, height }; }, clip() {},
      fillRect(x, y, width, height) {
        const color = [parseInt(this.fillStyle.slice(1, 3), 16), parseInt(this.fillStyle.slice(3, 5), 16), parseInt(this.fillStyle.slice(5, 7), 16), 255];
        for (let py = y; py < y + height; py++) for (let px = x; px < x + width; px++) {
          if (clip && (px < clip.x || py < clip.y || px >= clip.x + clip.width || py >= clip.y + clip.height)) continue;
          canvas.pixels.set(color, (py * canvas.width + px) * 4);
        }
      },
      measureText(text) { const width = textWidth(this.font, text); measurements.push({ text, font: this.font, width }); return { width }; },
      fillText(text, x, y) {
        drawings.push({ text, x, y, font: this.font, textAlign: this.textAlign });
        const width = textWidth(this.font, text), left = Math.floor(x - (this.textAlign === 'center' ? width / 2 : this.textAlign === 'right' ? width : 0));
        this.fillRect(left, Math.floor(y), 1, 1);
      },
    };
    canvas.getContext = kind => { assert.equal(kind, '2d'); return context; };
    canvas.toBlob = (callback, type) => { assert.equal(type, 'image/png'); callback(new Blob([png(canvas.width, canvas.height, canvas.pixels)], { type })); };
    return canvas;
  } };
  const controls = { verified: true, owner: 'owner', nodeEnv: 'production', putFailure: null, dbFailure: null, beforeAttachment: null, duringTranslation: null };
  const db = {
    prepare(sql) { let args = []; const q = { sql, bind(...values) { args = values; return q; }, execute() { return sqlite.prepare(sql).all(...args); },
      async all() { return { results: q.execute() }; }, async first() { return q.execute()[0] ?? null; }, async run() { return sqlite.prepare(sql).run(...args); } }; return q; },
    async batch(statements) {
      const attachment = statements.some(q => q.sql.includes('SELECT id,owner_id,?,?,? FROM products'));
      if (attachment && controls.beforeAttachment) { const mutate = controls.beforeAttachment; controls.beforeAttachment = null; await mutate(); }
      if (attachment && controls.dbFailure === 'before') { controls.dbFailure = null; throw Error('fixture DB acknowledgement failed before commit'); }
      sqlite.exec('BEGIN'); let result;
      try { result = statements.map(q => ({ results: q.execute() })); sqlite.exec('COMMIT'); }
      catch (error) { sqlite.exec('ROLLBACK'); throw error; }
      if (attachment && controls.dbFailure === 'after') { controls.dbFailure = null; throw Error('fixture committed DB acknowledgement lost'); }
      return result;
    },
  };
  const env = { DB: db, FILES: {
    async get(key) { const saved = objects.get(key); if (!saved) return null; return { size: saved.bytes.length, body: new Response(saved.bytes).body,
      httpMetadata: saved.httpMetadata, customMetadata: saved.customMetadata }; },
    async put(key, bytes, options) {
      writes.push(key); assert.equal(options.onlyIf.get('if-none-match'), '*');
      if (controls.putFailure === 'before') { controls.putFailure = null; throw Error('fixture R2 failed before commit'); }
      if (objects.has(key)) return null;
      objects.set(key, { bytes: new Uint8Array(bytes), ...options });
      if (controls.putFailure === 'after') { controls.putFailure = null; throw Error('fixture R2 acknowledgement lost'); }
      return {};
    },
    async delete(key) { deletions.push(key); throw Error('route must never delete potentially attached output'); },
  } };
  const deps = { 'cloudflare:workers': { env }, 'next/server': { NextResponse: Response },
    '@/app/chatgpt-auth': { getChatGPTUser: async () => ({ userId: controls.owner, verifiedAccess: controls.verified }), getWorkspaceOwnerId: async () => controls.owner },
    '@/app/automation/free-image-text': { translateImageRegions: async (regions, language) => { translations.push({ regions, language });
      if (controls.duringTranslation) await controls.duringTranslation();
      return { regions: regions.map(row => ({ id: row.id, original: row.text, translated: '검토한 문구', issue: null })), requests: 1, stoppedHttpStatus: null, warnings: [] }; } },
  };
  const load = file => {
    if (cache.has(file)) return cache.get(file); const exports = {}; cache.set(file, exports);
    vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../' + file, import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
      { exports, Error, URL, URLSearchParams, Request, Response, File, Blob, FormData, Headers, TextEncoder, TextDecoder, Uint8Array, DataView, document,
        Date, structuredClone, AbortController, AbortSignal, setTimeout, clearTimeout, crypto: webcrypto, process: { env: { get NODE_ENV() { return controls.nodeEnv; } } },
        fetch: async () => { throw Error('fixture route must not make an unstubbed external request'); },
        require(name) { if (name in deps) return deps[name]; return load(name.startsWith('@/') ? name.slice(2) + '.ts' : path.posix.join(path.posix.dirname(file), name) + '.ts'); } });
    return exports;
  };
  const key = 'owner/source.png', keys = [key, 'owner/first.png', 'owner/last.png', 'owner/main.png', 'owner/label.png'];
  for (const item of keys) objects.set(item, { bytes: png(), httpMetadata: { contentType: 'image/png' }, customMetadata: {} });
  const before = '2026-10-06T10:00:00.000Z';
  const prepare = async () => {
    await load('db/queries.ts').insertProduct({ id: 'product', owner_id: 'owner', source_url: 'https://detail.1688.com/offer/813724060928.html',
      title: '기존 작업 상품', source_price_cny: 5, exchange_rate: 350, supply_margin: 50, coupang_margin: 40, supply_price: 3500, sale_price: 5840, msrp: 7590,
      options_count: 1, seo_status: '완료', image_status: '완료', quote_status: '완료', registration_status: '등록대기', supplier_hub_status: '미전송',
      image_keys: JSON.stringify(keys), goal_stage: 'price', created_at: before, updated_at: before });
    const content = load('app/product-content.ts').applyContentPatch(load('app/product-content.ts').emptyProductContent('product'),
      { seo: { title: '수정한 SEO' }, label: { material: '확인한 재질' }, assets: { main: ['owner/main.png'], detail: ['owner/first.png', key, 'owner/last.png'], label: ['owner/label.png'] } }, before);
    await load('db/product-content.ts').saveProductContent('owner', content, 0);
  };
  const request = async (method = 'GET', body, options = {}) => {
    const url = 'https://app.test/api/products/' + (options.id ?? 'product') + '/image-text' + (method === 'GET' ? '?sourceKey=' + encodeURIComponent(options.key ?? key) + '&role=' + (options.role ?? 'detail') + (options.extra ?? '') : '');
    const headers = { ...(options.origin ? { origin: options.origin } : {}), ...(body instanceof FormData ? {} : method === 'POST' ? { 'content-type': 'application/json' } : {}), ...options.headers };
    return load('app/api/products/[id]/image-text/route.ts')[method](new Request(url, { method, headers, ...(body === undefined ? {} : { body: body instanceof FormData ? body : typeof body === 'string' ? body : JSON.stringify(body) }) }), { params: Promise.resolve({ id: options.id ?? 'product' }) });
  };
  const source = async options => { const res = await request('GET', undefined, options); assert.equal(res.status, 200, await res.clone().text()); return (await res.json()).source; };
  const applyBody = (source, bytes = png(3, 2, 90)) => { const form = new FormData(); form.set('action', 'apply'); form.set('source', JSON.stringify(source)); form.set('file', new File([bytes], 'translated.png', { type: 'image/png' })); return form; };
  const content = () => load('db/product-content.ts').readProductContent('owner', 'product');
  const product = () => sqlite.prepare('SELECT * FROM products WHERE id=?').get('product');
  const changeContent = async patch => { const current = await content(); await load('db/product-content.ts').saveProductContent('owner', load('app/product-content.ts').applyContentPatch(current, patch, '2026-10-06T10:00:01.000Z'), current.revision); };
  return { prepare, sqlite, objects, controls, env, translations, writes, deletions, drawings, measurements, fontLoads, keys, key, load, request, source, applyBody, content, product, changeContent, close() { sqlite.close(); } };
}
async function ready() { const h = fixture(); await h.prepare(); return h; }
const assertStatus = async (res, status) => assert.equal(res.status, status, await res.clone().text());

test('GET returns the exact owned role and validated bytes, not another product or role', async () => {
  const h = await ready(); try {
    const source = await h.source(); assert.equal(source.sourceSha256, sha(png())); assert.equal(source.width, 3); assert.equal(source.height, 2);
    assert.equal(source.productVersion, h.product().updated_at); assert.equal(source.contentRevision, 1); assert.equal(source.role, 'detail');
    await assertStatus(await h.request('GET', undefined, { role: 'main' }), 409);
    await assertStatus(await h.request('GET', undefined, { key: 'other/source.png' }), 404);
    await assertStatus(await h.request('GET', undefined, { key: 'owner/unattached.png' }), 404);
    await assertStatus(await h.request('GET', undefined, { role: 'label' }), 400);
    await assertStatus(await h.request('GET', undefined, { extra: '&role=main' }), 400);
    await assertStatus(await h.request('GET', undefined, { extra: '&unexpected=1' }), 400);
    assert.equal(h.writes.length, 0); assert.equal(h.translations.length, 0);
  } finally { h.close(); }
});
test('production authentication and owner isolation fail before file reads, writes or translation', async () => {
  const h = await ready(); try {
    h.controls.verified = false; await assertStatus(await h.request(), 503); h.controls.verified = true; h.controls.owner = 'foreign';
    await assertStatus(await h.request(), 404); assert.equal(h.writes.length, 0); assert.equal(h.translations.length, 0);
  } finally { h.close(); }
});
test('native authentication enabled in development rejects an unverified identity before any database access', async () => {
  const h = fixture(); try {
    h.controls.nodeEnv = 'development'; h.controls.verified = false; h.env.YOOFAM_AUTH_ENABLED = 'true';
    await assertStatus(await h.request(), 503);
    const source = { productId: 'product', productVersion: '2026-10-06T10:00:00.000Z', contentRevision: 0, sourceKey: h.key, sourceSha256: sha(png()), role: 'detail', width: 3, height: 2 };
    await assertStatus(await h.request('POST', { action: 'translate', source, sourceLanguage: 'zh', regions: [{ id: 'r1', text: '尺寸' }] }), 503);
    assert.deepEqual(h.sqlite.prepare("SELECT name FROM sqlite_schema WHERE type='table'").all(), []);
    assert.equal(h.writes.length, 0); assert.equal(h.translations.length, 0);
  } finally { h.close(); }
});
test('translation accepts corrected OCR text only on the exact fresh source and rechecks after the external result', async () => {
  const h = await ready(); try {
    const source = await h.source(), input = { action: 'translate', source, sourceLanguage: 'zh', regions: [{ id: 'line-1', text: '尺寸 12cm' }] };
    const res = await h.request('POST', input, { origin: 'https://app.test' }); await assertStatus(res, 200);
    assert.equal((await res.json()).regions[0].translated, '검토한 문구'); assert.deepEqual(JSON.parse(JSON.stringify(h.translations[0])), { regions: input.regions, language: 'zh' });
    h.controls.duringTranslation = () => h.changeContent({ label: { material: '번역 중 바꾼 재질' } });
    await assertStatus(await h.request('POST', input), 409); assert.equal((await h.content()).label.material.value, '번역 중 바꾼 재질');
    assert.equal(h.writes.length, 0); assert.equal(h.product().supplier_hub_status, '미전송');
  } finally { h.close(); }
});
test('malformed, cross-site, excessive or stale translation requests never contact translation', async () => {
  const h = await ready(); try {
    const source = await h.source(), input = { action: 'translate', source, sourceLanguage: 'en', regions: [{ id: 'r1', text: 'Material' }] };
    for (const value of [ { ...input, extra: true }, { ...input, sourceLanguage: 'auto' }, { ...input, source: { ...source, productId: 'other' } },
      { ...input, regions: [{ id: 'r1', text: '' }] }, { ...input, regions: [input.regions[0], input.regions[0]] },
      { ...input, regions: Array.from({ length: 101 }, (_, i) => ({ id: 'r' + i, text: 'value' })) },
      { ...input, regions: Array.from({ length: 5 }, (_, i) => ({ id: 'r' + i, text: 'v'.repeat(5000) })) } ]) await assertStatus(await h.request('POST', value), 400);
    await assertStatus(await h.request('POST', input, { origin: 'https://other.test' }), 400);
    await assertStatus(await h.request('POST', input, { headers: { 'sec-fetch-site': 'cross-site' } }), 400);
    await assertStatus(await h.request('POST', ' '.repeat(96 * 1024 + 1)), 413);
    h.objects.get(h.key).bytes = png(3, 2, 1); await assertStatus(await h.request('POST', input), 409);
    h.objects.get(h.key).bytes = png(); await h.changeContent({ assets: { detail: [] } }); await assertStatus(await h.request('POST', input), 409);
    assert.equal(h.translations.length, 0); assert.equal(h.writes.length, 0);
  } finally { h.close(); }
});
test('image size, pixels, unsupported bytes and dishonest storage length are bounded before hashing', async () => {
  const h = await ready(); try {
    const original = h.objects.get(h.key).bytes;
    h.objects.get(h.key).bytes = new Uint8Array(10 * 1024 * 1024 + 1); await assertStatus(await h.request(), 413);
    const large = png(); large.writeUInt32BE(4000, 16); large.writeUInt32BE(4000, 20); h.objects.get(h.key).bytes = large; await assertStatus(await h.request(), 413);
    h.objects.get(h.key).bytes = Buffer.from('<svg/>'); await assertStatus(await h.request(), 415);
    h.objects.get(h.key).bytes = original; const get = h.load('app/api/products/[id]/image-text/route.ts'); assert.ok(get.GET);
    assert.equal(h.translations.length, 0); assert.equal(h.writes.length, 0);
  } finally { h.close(); }
});
test('actual erase renderer PNG applies through the exact saved source, survives failed storage and retries without translating or removing originals', async () => {
  const h = await ready(); try {
    const source = await h.source(), before = await h.content(), original = h.objects.get(h.key).bytes.slice(), client = h.load('app/free-image-translation-client.ts');
    const loaded = { source, canvas: { pixels: new Uint8Array(3 * 2 * 4).fill(200) }, blob: new Blob([original], { type: 'image/png' }), width: 3, height: 2 };
    const rendered = await client.renderFreeImageTranslation(loaded, [{ id: 'manual-clear', text: '', translated: '', erase: true,
      box: { x: 1, y: 0, width: 1, height: 2 }, confidence: 0, selected: true, issue: null, translationProvenance: 'empty', background: '#234567', foreground: '#111111', fontSize: 1 }], new AbortController().signal);
    const output = new Uint8Array(await rendered.output.arrayBuffer()), expectedPixels = new Uint8Array(3 * 2 * 4).fill(200);
    for (let y = 0; y < 2; y++) expectedPixels.set([0x23, 0x45, 0x67, 255], (y * 3 + 1) * 4);
    assert.deepEqual(Buffer.from(output), png(3, 2, expectedPixels));
    assert.equal(h.measurements.length, 0); assert.equal(h.drawings.length, 0, 'erase cannot measure or draw retained wording'); assert.equal(h.fontLoads.length, 0);
    const send = async (url, init) => {
      assert.equal(url, '/api/products/product/image-text'); assert.equal(init.method, 'POST');
      assert.deepEqual([...init.body.keys()], ['action', 'source', 'file']);
      assert.deepEqual(JSON.parse(init.body.get('source')), source); return h.request('POST', init.body);
    };
    h.controls.putFailure = 'before';
    await assert.rejects(client.applyFreeImageTranslation(rendered, new AbortController().signal, send), error => error.uncertain === true);
    assert.deepEqual(await h.content(), before); assert.deepEqual(h.objects.get(h.key).bytes, original); assert.equal(h.objects.size, h.keys.length);
    const saved = await client.applyFreeImageTranslation(rendered, new AbortController().signal, send), after = await h.content();
    assert.deepEqual(h.objects.get(saved.key).bytes, output); assert.equal(h.objects.get(saved.key).customMetadata.freeImageOutputSha256, sha(output));
    assert.deepEqual(Array.from(after.assets.detail.value), ['owner/first.png', saved.key, 'owner/last.png']);
    for (const role of ['main', 'additional', 'detailTop', 'detailBottom', 'size', 'label']) assert.deepEqual(after.assets[role], before.assets[role]);
    assert.deepEqual(after.seo, before.seo); assert.deepEqual(after.label, before.label); assert.deepEqual(h.objects.get(h.key).bytes, original);
    assert.ok(JSON.parse(h.product().image_keys).includes(h.key)); assert.equal(h.deletions.length, 0); assert.equal(h.translations.length, 0);
    const replay = await client.applyFreeImageTranslation(rendered, new AbortController().signal, send);
    assert.equal(replay.replayed, true); assert.deepEqual(await h.content(), after); assert.equal(h.writes.length, 2, 'one failed storage attempt and one successful write');
    const fresh = await h.source({ key: saved.key }); assert.equal(fresh.sourceSha256, sha(output)); assert.equal(fresh.productVersion, saved.productVersion);
  } finally { h.close(); }
});

for (const [fontFamily, css] of [['serif', 'Georgia, "Noto Serif KR", serif'], ['gmarket', '"Gmarket Sans", sans-serif']]) test(`styled renderer PNG (${fontFamily}) keeps exact bytes/source through route attachment and a different alignment cannot reuse its stale source`, async () => {
  const h = await ready(); try {
    const source = await h.source(), before = await h.content(), original = h.objects.get(h.key).bytes.slice(), client = h.load('app/free-image-translation-client.ts');
    const loaded = { source, canvas: { pixels: new Uint8Array(3 * 2 * 4).fill(200) }, blob: new Blob([original], { type: 'image/png' }), width: 3, height: 2 };
    const chosen = { id: 'style', text: 'A', translated: 'A', box: { x: 1, y: 0, width: 2, height: 2 }, confidence: 90, selected: true,
      issue: null, translationProvenance: 'manual', background: '#abcdef', foreground: '#123456', fontSize: 1,
      fontFamily, bold: true, italic: true, textAlign: 'right', lineHeight: 0.8 };
    const rendered = await client.renderFreeImageTranslation(loaded, [chosen], new AbortController().signal);
    const bytes = new Uint8Array(await rendered.output.arrayBuffer()), expectedPixels = new Uint8Array(3 * 2 * 4).fill(200);
    for (let y = 0; y < 2; y++) for (let x = 1; x < 3; x++) expectedPixels.set([0xab, 0xcd, 0xef, 255], (y * 3 + x) * 4);
    expectedPixels.set([0x12, 0x34, 0x56, 255], 2 * 4);
    assert.deepEqual(Buffer.from(bytes), png(3, 2, expectedPixels));
    assert.deepEqual(h.drawings, [{ text: 'A', x: 3, y: 0, font: `italic bold 1px ${css}`, textAlign: 'right' }]);
    assert.ok(h.measurements.every(row => row.font === h.drawings[0].font));
    assert.deepEqual(h.fontLoads, fontFamily === 'gmarket' ? [{ descriptor: 'italic bold 20px "Gmarket Sans"', sample: '가나다 ABC 123' }] : []);
    const send = async (url, init) => {
      assert.equal(url, '/api/products/product/image-text'); assert.deepEqual([...init.body.keys()], ['action', 'source', 'file']);
      assert.deepEqual(JSON.parse(init.body.get('source')), source); return h.request('POST', init.body);
    };
    const saved = await client.applyFreeImageTranslation(rendered, new AbortController().signal, send), after = await h.content();
    assert.deepEqual(h.objects.get(saved.key).bytes, bytes); assert.equal(h.objects.get(saved.key).customMetadata.freeImageOutputSha256, sha(bytes));
    assert.deepEqual(Array.from(after.assets.detail.value), ['owner/first.png', saved.key, 'owner/last.png']);
    assert.deepEqual(after.seo, before.seo); assert.deepEqual(after.label, before.label); assert.deepEqual(h.objects.get(h.key).bytes, original);
    const different = await client.renderFreeImageTranslation(loaded, [{ ...chosen, textAlign: 'left' }], new AbortController().signal);
    assert.notEqual(await client.expectedFreeImageOutputKey(different), saved.key, 'different reviewed style output has its own digest key');
    await assert.rejects(client.applyFreeImageTranslation(different, new AbortController().signal, send), error => error.uncertain === false);
    assert.deepEqual(await h.content(), after); assert.equal(h.writes.length, 1); assert.equal(h.translations.length, 0); assert.equal(h.deletions.length, 0);
    assert.equal((await client.applyFreeImageTranslation(rendered, new AbortController().signal, send)).replayed, true);
    assert.equal(h.writes.length, 1);
  } finally { h.close(); }
});

test('manual PNG adoption replaces the exact detail slot atomically and preserves original, SEO, labels, other roles and status', async () => {
  const h = await ready(); try {
    const source = await h.source(), before = await h.content(), res = await h.request('POST', h.applyBody(source)); await assertStatus(res, 200);
    const saved = await res.json(), after = await h.content(), keys = JSON.parse(h.product().image_keys);
    assert.equal(saved.applied, true); assert.equal(saved.replayed, undefined); assert.equal(after.revision, source.contentRevision + 1);
    assert.deepEqual(Array.from(after.assets.detail.value), ['owner/first.png', saved.key, 'owner/last.png']);
    for (const role of ['main', 'additional', 'detailTop', 'detailBottom', 'size', 'label']) assert.deepEqual(after.assets[role], before.assets[role]);
    assert.deepEqual(after.seo, before.seo); assert.deepEqual(after.label, before.label); assert.ok(keys.includes(h.key)); assert.ok(keys.includes(saved.key));
    assert.equal(h.product().quote_status, '대기'); assert.equal(h.product().supplier_hub_status, '미전송'); assert.equal(h.writes.length, 1); assert.equal(h.deletions.length, 0);
    assert.equal(h.objects.get(saved.key).customMetadata.freeImageOutputSha256, sha(png(3, 2, 90)));
    const again = await h.request('POST', h.applyBody(source)); await assertStatus(again, 200); assert.equal((await again.json()).replayed, true);
    assert.equal((await h.content()).revision, after.revision); assert.equal(h.writes.length, 1);
  } finally { h.close(); }
});
test('the same owned source is applied only to its selected main, additional, top, detail or bottom role', async () => {
  for (const role of ['main', 'additional', 'detailTop', 'detail', 'detailBottom']) {
    const h = await ready(); try {
      if (role !== 'detail') await h.changeContent({ assets: { detail: [], [role]: ['additional'].includes(role) ? ['owner/first.png', h.key, 'owner/last.png'] : [h.key] } });
      const source = await h.source({ role }), before = await h.content(), res = await h.request('POST', h.applyBody(source)); await assertStatus(res, 200);
      const key = (await res.json()).key, after = await h.content();
      assert.deepEqual(Array.from(after.assets[role].value), Array.from(before.assets[role].value, value => value === h.key ? key : value));
      for (const name of ['main', 'additional', 'detailTop', 'detail', 'detailBottom', 'size', 'label'].filter(name => name !== role)) assert.deepEqual(after.assets[name], before.assets[name]);
      assert.ok(JSON.parse(h.product().image_keys).includes(h.key)); assert.equal(h.deletions.length, 0);
    } finally { h.close(); }
  }
});
test('PNG application accepts EXIF-swapped dimensions but rejects other sizes, MIME, fields and duplicate files', async () => {
  for (const mutation of [form => form.set('action', 'other'), form => form.append('file', new File([png()], 'extra.png', { type: 'image/png' })),
    form => form.set('file', new File([png()], 'wrong.jpg', { type: 'image/jpeg' })), form => form.set('file', new File([png(2, 2)], 'wrong.png', { type: 'image/png' })),
    form => form.set('extra', 'no'), form => form.set('source', JSON.stringify({ productId: 'missing' })) ]) {
    const h = await ready(); try { const form = h.applyBody(await h.source()); mutation(form); assert.ok([400, 415].includes((await h.request('POST', form)).status)); assert.equal(h.writes.length, 0); } finally { h.close(); }
  }
  const h = await ready(); try { const res = await h.request('POST', h.applyBody(await h.source(), png(2, 3))); await assertStatus(res, 200); } finally { h.close(); }
});
for (const storage of ['R2', 'DB']) for (const timing of ['before', 'after']) test(`${storage} ${timing}-commit failures preserve original and allow only verified deterministic retry`, async () => {
  const h = await ready(); try {
    const source = await h.source(), before = await h.content(); h.controls[storage === 'R2' ? 'putFailure' : 'dbFailure'] = timing;
    const first = await h.request('POST', h.applyBody(source)); await assertStatus(first, timing === 'after' ? 200 : 503);
    if (timing === 'before') assert.deepEqual(await h.content(), before);
    const second = await h.request('POST', h.applyBody(source)); await assertStatus(second, 200); const saved = await second.json();
    assert.equal((await h.content()).revision, before.revision + 1); assert.ok(JSON.parse(h.product().image_keys).includes(saved.key));
    assert.equal(h.objects.size, h.keys.length + 1); assert.equal(h.deletions.length, 0);
    if (timing === 'after') assert.equal(saved.replayed, true);
  } finally { h.close(); }
});
test('a concurrent content save wins the atomic guard; the orphan PNG is retained and cannot claim a completed attachment', async () => {
  const h = await ready(); try {
    const source = await h.source(); h.controls.beforeAttachment = () => h.changeContent({ label: { material: '동시 변경한 재질' } });
    await assertStatus(await h.request('POST', h.applyBody(source)), 409);
    assert.equal((await h.content()).label.material.value, '동시 변경한 재질'); assert.ok((await h.content()).assets.detail.value.includes(h.key));
    assert.equal(JSON.parse(h.product().image_keys).length, h.keys.length); assert.equal(h.objects.size, h.keys.length + 1); assert.equal(h.deletions.length, 0);
    await assertStatus(await h.request('POST', h.applyBody(source)), 409); assert.equal(h.writes.length, 1);
  } finally { h.close(); }
});
test('replay cannot resurrect a removed role, changed original or forged output metadata', async () => {
  for (const mode of ['removed-role', 'changed-original', 'metadata', 'output-bytes']) {
    const h = await ready(); try {
      const source = await h.source(), applied = await h.request('POST', h.applyBody(source)); await assertStatus(applied, 200); const saved = await applied.json();
      if (mode === 'removed-role') await h.changeContent({ assets: { detail: [] } });
      if (mode === 'changed-original') h.objects.get(h.key).bytes = png(3, 2, 33);
      if (mode === 'metadata') h.objects.get(saved.key).customMetadata.freeImageSourceSha256 = '0'.repeat(64);
      if (mode === 'output-bytes') h.objects.get(saved.key).bytes = png(3, 2, 34);
      const before = await h.content(); await assertStatus(await h.request('POST', h.applyBody(source)), 409); assert.deepEqual(await h.content(), before); assert.equal(h.writes.length, 1);
    } finally { h.close(); }
  }
});
test('full original capacity and stale product/content/source snapshots stop before storing a result', async () => {
  const h = await ready(); try {
    const source = await h.source(); h.sqlite.prepare('UPDATE products SET image_keys=? WHERE id=?').run(JSON.stringify([...h.keys, ...Array.from({ length: 45 }, (_, i) => 'owner/extra-' + i + '.png')]), 'product');
    await assertStatus(await h.request('POST', h.applyBody(source)), 400); assert.equal(h.writes.length, 0);
    h.sqlite.prepare('UPDATE products SET updated_at=? WHERE id=?').run('2026-10-06T10:00:02.000Z', 'product');
    await assertStatus(await h.request('POST', h.applyBody(source)), 409); assert.equal(h.writes.length, 0);
  } finally { h.close(); }
});
