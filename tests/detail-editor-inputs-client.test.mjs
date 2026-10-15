import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';
import sharp from 'sharp';
import { createRequire } from 'node:module';
import { createHash, webcrypto } from 'node:crypto';

const native = createRequire(import.meta.url), plain = value => JSON.parse(JSON.stringify(value));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const signal = () => new AbortController().signal;
const input = f => ({ productId: 'product', optionId: 'red', profileId: 'profile', view: f.view });
function loadClient(fetcher) {
  const cache = new Map();
  function load(file) {
    if (cache.has(file)) return cache.get(file); const exports = {}; cache.set(file, exports);
    vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../' + file, import.meta.url), 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText,
    { exports, Error, Date, URL, URLSearchParams, AbortController, AbortSignal, DOMException, Response, Headers, Blob, File,
      Uint8Array, DataView, TextEncoder, TextDecoder, structuredClone, crypto: webcrypto, fetch: fetcher,
      require(name) {
        if (name.startsWith('@/')) return load(name.slice(2) + '.ts');
        if (name.startsWith('./') || name.startsWith('../')) return load(path.posix.join(path.posix.dirname(file), name) + '.ts');
        return native(name);
      } });
    return exports;
  }
  return { load, helper: load('app/detail-editor-inputs-client.ts') };
}
async function fixture({ duplicate = false, sourceBytes, sourceWidth = 800, sourceHeight = 1 } = {}) {
  const one = sourceBytes ?? await sharp({ create: { width: sourceWidth, height: sourceHeight, channels: 4, background: '#123456' } }).png().toBuffer();
  const two = await sharp({ create: { width: 800, height: 2, channels: 4, background: '#654321' } }).png().toBuffer();
  const sourceRows = [{ key: 'owner/one.png', sha256: hash(one), width: sourceWidth, height: sourceHeight },
    { key: 'owner/two.png', sha256: hash(two), width: 800, height: 2 }];
  const images = duplicate ? [sourceRows[0], sourceRows[1], sourceRows[0]] : sourceRows;
  const height = images.reduce((sum, image) => sum + Math.max(1, Math.round(image.height * 800 / image.width)), 0);
  const output = await sharp({ create: { width: 800, height, channels: 4, background: '#abcdef' } }).png().toBuffer();
  const uploadId = 'a'.repeat(64), key = `owner/quotation-label-${uploadId}.png`, version = '2026-10-15T02:00:00.000Z';
  const field = (id, type, extra = {}) => ({ id, label: id, type, section: 'image', required: false, visibility: 'common',
    maxLength: type === 'images' ? 16000 : 150000, ...(type === 'images' ? { maxItems: 150 } : {}), ...extra });
  const fields = [field('additionalImages', 'images'), field('detailImages', 'images'), field('detailHtml', 'textarea'), field('altText', 'text'),
    field('wire-detail-images', 'images', { hubInput: 'detailImages', hubWire: { path: ['imagePage', 'details', 'detailedImage'] } }),
    field('wire-detail-html', 'textarea', { hubInput: 'detailHtml', hubWire: { path: ['imagePage', 'details', 'htmlProductDetailContent'] } })];
  const common = { additionalImages: 'owner/one.png', detailImages: key, 'wire-detail-images': key, detailHtml: '', 'wire-detail-html': '', altText: ' 공통 ALT ' };
  const red = { ...common, detailHtml: '<p>수동 HTML 보존</p>', 'wire-detail-html': '<p>수동 HTML 보존</p>', altText: '' };
  const blue = { ...common, detailImages: 'owner/two.png', 'wire-detail-images': 'owner/two.png', altText: ' 다른 옵션 ALT ' };
  const row = (optionId, values, included) => ({ optionId, optionLabel: optionId ?? '공통', included,
    fields: Object.fromEntries(Object.entries(values).map(([id, value]) => [id, { value, source: optionId ? 'manual-option' : 'manual-common', issues: [] }])) });
  const schema = { version: 1, categoryId: '81221', categoryPath: ['보관'], status: 'observed', fields, submissionReady: false };
  const rows = [row(null, common, true), row('red', red, true), row('blue', blue, false)];
  const view = { revision: 7, updatedAt: version, productVersion: version, contentRevision: 3, optionRevision: 4, inputFingerprint: 'b'.repeat(64),
    imageKeys: [key, 'owner/one.png', 'owner/two.png'], categoryContext: { categoryId: '81221', categoryPath: ['보관'], profileId: 'profile' },
    overrides: { common, options: { red, blue } }, resolved: { schema, rows, issues: [] }, automatic: { schema, rows: plain(rows), issues: [] },
    protectedDetailImageKeys: [], detailEditorInputs: { format: 'saved-detail-inputs-v1', categoryId: '81221',
      origin: { productId: 'source-product', sourceOptionId: 'source-option', uploadId, revision: 5 },
      output: { key, sha256: hash(output), bytes: output.length }, images: plain(images) } };
  const objects = new Map([[key, output], ['owner/one.png', one], ['owner/two.png', two]]), calls = [];
  const f = { view, key, objects, calls, sourceRows };
  f.request = async (url, init = {}) => {
    calls.push({ url, method: init.method ?? 'GET', signal: init.signal, cache: init.cache });
    assert.equal(init.method ?? 'GET', 'GET', 'preparation must never mutate');
    if (url.startsWith('/api/products/')) return Response.json(f.view);
    const imageKey = url.slice('/api/files/'.length).split('/').map(decodeURIComponent).join('/');
    const bytes = objects.get(imageKey); return bytes ? new Response(bytes, { headers: { 'content-type': 'image/png', 'content-length': String(bytes.length) } }) : new Response(null, { status: 404 });
  };
  return f;
}

test('saved input preparation keeps duplicate positions and origin identity, reads unique actual files, and never writes', async () => {
  const f = await fixture({ duplicate: true }), before = JSON.stringify(f.view), { helper } = loadClient(f.request);
  const result = await helper.prepareSavedDetailInputs(input(f), signal(), f.request);
  assert.deepEqual(plain(result.keys), ['owner/one.png', 'owner/two.png', 'owner/one.png']);
  assert.equal(result.inputs.origin.productId, 'source-product'); assert.equal(result.inputs.origin.sourceOptionId, 'source-option');
  assert.equal(JSON.stringify(f.view), before); assert.equal(result.view, f.view);
  assert.equal(f.calls.filter(call => call.url === '/api/files/owner/one.png').length, 1);
  assert.equal(f.calls.filter(call => call.url.startsWith('/api/products/')).length, 2);
  assert.equal(f.calls[0].url, '/api/products/product/quotation-fields?profileId=profile');
  assert.ok(f.calls.every(call => call.method === 'GET' && call.cache === 'no-store' && call.signal instanceof AbortSignal));
});

test('final composite SHA, byte count, PNG type and scaled dimensions must all agree before inputs are offered', async () => {
  for (const corrupt of ['sha', 'bytes', 'width', 'height', 'type']) {
    const f = await fixture(), doc = f.view.detailEditorInputs;
    if (corrupt === 'sha') doc.output.sha256 = 'c'.repeat(64);
    if (corrupt === 'bytes') doc.output.bytes++;
    if (corrupt === 'width' || corrupt === 'height' || corrupt === 'type') {
      const builder = sharp({ create: { width: corrupt === 'width' ? 799 : 800, height: corrupt === 'height' ? 5 : 3, channels: 4, background: '#abcdef' } });
      const bytes = await (corrupt === 'type' ? builder.jpeg() : builder.png()).toBuffer();
      f.objects.set(f.key, bytes); doc.output.sha256 = hash(bytes); doc.output.bytes = bytes.length;
    }
    const { helper } = loadClient(f.request), before = JSON.stringify(f.view);
    await assert.rejects(helper.prepareSavedDetailInputs(input(f), signal(), f.request));
    assert.equal(JSON.stringify(f.view), before); assert.equal(f.calls.filter(call => call.url.includes('/one.png')).length, 0, corrupt);
  }
});

test('changed input bytes and dimensions, missing files and the accumulated 30MiB positional cap fail without a write', async () => {
  for (const corrupt of ['sha', 'dimensions', 'missing', 'total']) {
    const f = await fixture(), doc = f.view.detailEditorInputs;
    if (corrupt === 'sha') f.objects.set('owner/one.png', await sharp({ create: { width: 800, height: 1, channels: 4, background: '#999999' } }).png().toBuffer());
    if (corrupt === 'dimensions') {
      const bytes = await sharp({ create: { width: 400, height: 1, channels: 4, background: '#123456' } }).png().toBuffer();
      f.objects.set('owner/one.png', bytes); doc.images.filter(image => image.key === 'owner/one.png').forEach(image => { image.sha256 = hash(bytes); });
    }
    if (corrupt === 'missing') f.objects.delete('owner/one.png');
    if (corrupt === 'total') {
      const bytes = Buffer.concat([f.objects.get('owner/one.png'), Buffer.alloc(8 * 1024 * 1024)]);
      doc.images = Array.from({ length: 4 }, (_, index) => ({ ...f.sourceRows[0], key: `owner/large-${index}.png`, sha256: hash(bytes) }));
      for (const image of doc.images) { f.objects.set(image.key, bytes); f.view.imageKeys.push(image.key); }
      const output = await sharp({ create: { width: 800, height: 4, channels: 4, background: '#abcdef' } }).png().toBuffer();
      f.objects.set(f.key, output); doc.output.sha256 = hash(output); doc.output.bytes = output.length;
    }
    const { helper } = loadClient(f.request), before = JSON.stringify(f.view);
    await assert.rejects(helper.prepareSavedDetailInputs(input(f), signal(), f.request));
    assert.equal(JSON.stringify(f.view), before); assert.ok(f.calls.every(call => call.method === 'GET'));
    if (corrupt === 'total') assert.equal(f.calls.filter(call => call.url.includes('/large-')).length, 4, 'the whole ordered input size is capped');
  }
});

test('the exact quotation is checked both before and after file reads and stale results cannot replace current data', async () => {
  for (const staleAt of [1, 2]) {
    const f = await fixture(), before = JSON.stringify(f.view); let reads = 0;
    const fetcher = async (url, init) => {
      const response = await f.request(url, init);
      if (url.startsWith('/api/products/') && ++reads === staleAt) return Response.json({ ...f.view, revision: f.view.revision + 1 });
      return response;
    };
    const { helper } = loadClient(fetcher); await assert.rejects(helper.prepareSavedDetailInputs(input(f), signal(), fetcher));
    assert.equal(JSON.stringify(f.view), before);
    assert.equal(f.calls.filter(call => call.url.startsWith('/api/files/')).length, staleAt === 1 ? 0 : 3);
  }
});

test('aborting before or during preparation never continues to another file or to a save', async () => {
  for (const preAborted of [true, false]) {
    const f = await fixture(), controller = new AbortController(); if (preAborted) controller.abort();
    const fetcher = async (url, init) => { const response = await f.request(url, init); if (url.startsWith('/api/files/')) controller.abort(); return response; };
    const { helper } = loadClient(fetcher); await assert.rejects(helper.prepareSavedDetailInputs(input(f), controller.signal, fetcher));
    assert.equal(f.calls.length, preAborted ? 0 : 2); assert.ok(f.calls.every(call => call.method === 'GET'));
  }
});

test('missing metadata, read-only aliases, foreign files and mismatched option/profile bindings are unavailable before any fetch', async () => {
  for (const corrupt of ['missing', 'readonly', 'alias', 'foreign', 'option', 'profile']) {
    const f = await fixture(); let selected = input(f);
    if (corrupt === 'missing') delete f.view.detailEditorInputs;
    if (corrupt === 'readonly') f.view.resolved.schema.fields.find(field => field.id === 'wire-detail-images').readOnly = true;
    if (corrupt === 'alias') f.view.resolved.rows.find(row => row.optionId === 'red').fields['wire-detail-images'].value = 'owner/one.png';
    if (corrupt === 'foreign') f.view.detailEditorInputs.images[0].key = 'someone-else/private.png';
    if (corrupt === 'option') selected = { ...selected, optionId: 'absent' };
    if (corrupt === 'profile') selected = { ...selected, profileId: 'other-profile' };
    const { helper } = loadClient(f.request); assert.equal(helper.canEditSavedDetailInputs(selected), false, corrupt);
    await assert.rejects(helper.prepareSavedDetailInputs(selected, signal(), f.request)); assert.equal(f.calls.length, 0);
  }
});
