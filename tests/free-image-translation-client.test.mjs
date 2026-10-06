import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { webcrypto } from 'node:crypto';

const version = '2026-10-06T00:00:00.000Z';
const source = { productId: 'product', productVersion: version, contentRevision: 2, sourceKey: 'owner/original.png', sourceSha256: 'a'.repeat(64), role: 'detail', width: 20, height: 12 };
const plain = value => JSON.parse(JSON.stringify(value));
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const hash = async bytes => Buffer.from(await webcrypto.subtle.digest('SHA-256', bytes)).toString('hex');
const pixels = (width, height) => Uint8Array.from({ length: width * height * 4 }, (_, index) => index % 4 === 3 ? 255 : (index * 13) % 200);
function fixture({ imageWidth = 20, imageHeight = 12, decodeWait } = {}) {
  const objects = new Map(), revoked = [], canvases = [], operations = []; let sequence = 0;
  class ObjectURL extends URL { static createObjectURL(blob) { const url = 'blob:fixture-' + ++sequence; objects.set(url, blob); return url; } static revokeObjectURL(url) { revoked.push(url); objects.delete(url); } }
  class Image { set src(url) { if (!url) return; Promise.resolve(decodeWait).then(() => { if (!objects.has(url)) return; this.naturalWidth = imageWidth; this.naturalHeight = imageHeight; this.pixels = pixels(imageWidth, imageHeight); this.onload?.(); }); } }
  const document = { createElement(tag) {
    assert.equal(tag, 'canvas'); const output = { width: 0, height: 0, pixels: null }, clips = []; let clip = null;
    const rgba = hex => [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16), 255];
    const paint = (x, y, width, height, color) => {
      for (let py = Math.floor(y); py < y + height; py++) for (let px = Math.floor(x); px < x + width; px++) {
        if (px < 0 || py < 0 || px >= output.width || py >= output.height || clip && (px < clip.x || py < clip.y || px >= clip.x + clip.width || py >= clip.y + clip.height)) continue;
        output.pixels.set(color, (py * output.width + px) * 4);
      }
    };
    const context = { font: '10px Arial', fillStyle: '#000000', textBaseline: 'top',
      drawImage(image, x, y) { assert.equal(x, 0); assert.equal(y, 0); output.pixels = image.pixels.slice(); operations.push(['draw', output.width, output.height]); },
      measureText(text) { return { width: Array.from(text).length * Number.parseFloat(this.font) / 2 }; },
      save() { clips.push(clip); }, restore() { clip = clips.pop(); }, beginPath() {}, rect(x, y, width, height) { clip = { x, y, width, height }; }, clip() {},
      fillRect(x, y, width, height) { operations.push(['fill', x, y, width, height]); paint(x, y, width, height, rgba(this.fillStyle)); },
      fillText(text, x, y) { operations.push(['text', text, x, y, this.font]); paint(x, y, 1, 1, rgba(this.fillStyle)); },
    };
    output.getContext = kind => { assert.equal(kind, '2d'); return context; };
    output.toBlob = (callback, type) => { assert.equal(type, 'image/png'); callback(new Blob([output.pixels], { type })); };
    canvases.push(output); return output;
  } };
  const cache = new Map();
  function load(file) {
    if (cache.has(file)) return cache.get(file); const exports = {}; cache.set(file, exports);
    vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../' + file, import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
      { exports, Error, Date, URL: ObjectURL, URLSearchParams, Blob, File, FormData, Response, Request, Headers, Image, document,
        AbortController, AbortSignal, TextEncoder, TextDecoder, Uint8Array, DataView, CompressionStream, DecompressionStream, structuredClone,
        crypto: webcrypto, setTimeout, clearTimeout, fetch: () => { throw Error('Live network is forbidden'); },
        require(name) { assert.ok(name.startsWith('@/'), name); return load(name.slice(2) + '.ts'); } });
    return exports;
  }
  const client = load('app/free-image-translation-client.ts');
  return { client, canvases, operations, revoked, objects, document };
}
function image(h) { const value = h.document.createElement('canvas'); value.width = source.width; value.height = source.height; value.pixels = pixels(source.width, source.height); return { source, canvas: value, blob: new Blob(['original']), width: source.width, height: source.height }; }
const region = (id, box, translated = '한국어') => ({ id, text: '中文', box, confidence: 90, selected: true, translated, issue: null, translationProvenance: 'generated', background: '#ffffff', foreground: '#000000', fontSize: 3 });
const ocr = lines => ({ blocks: [{ paragraphs: [{ lines }] }] });
const line = (text, confidence, bbox = { x0: 1, y0: 1, x1: 12, y1: 8 }) => ({ text, confidence, bbox });

test('owned source reads verify exact version, role, SHA-256 and raw/swapped visible dimensions before OCR', async () => {
  const bytes = new TextEncoder().encode('authenticated original bytes'), sha256 = await hash(bytes);
  for (const [width, height] of [[20, 12], [12, 20]]) {
    const h = fixture({ imageWidth: width, imageHeight: height }), calls = [];
    const loaded = await h.client.readFreeImageSource('product', version, source.sourceKey, 'detail', new AbortController().signal, async (url, init) => {
      calls.push(url); assert.equal(init.cache, 'no-store'); assert.equal(init.signal.aborted, false);
      return calls.length === 1 ? Response.json({ source: { ...source, sourceSha256: sha256 } }) : new Response(bytes);
    });
    assert.equal(calls.length, 2); assert.match(calls[0], /sourceKey=owner%2Foriginal.png&role=detail/); assert.equal(calls[1], '/api/files/owner/original.png');
    assert.equal(loaded.width, width); assert.equal(loaded.height, height); assert.deepEqual(loaded.canvas.pixels, pixels(width, height)); assert.equal(h.revoked.length, 1);
  }
  for (const change of [{ productId: 'another' }, { productVersion: '2026-10-06T00:00:01Z' }, { role: 'main' }, { sourceKey: 'owner/another.png' }, { sourceSha256: 'b'.repeat(64) }]) {
    const h = fixture(); let calls = 0;
    await assert.rejects(h.client.readFreeImageSource('product', version, source.sourceKey, 'detail', new AbortController().signal, async () => ++calls === 1 ? Response.json({ source: { ...source, sourceSha256: sha256, ...change } }) : new Response(bytes)));
    assert.equal(calls, change.sourceSha256 ? 2 : 1); assert.equal(h.canvases.length, 0);
  }
  const h = fixture({ imageWidth: 21, imageHeight: 12 });
  await assert.rejects(h.client.readFreeImageSource('product', version, source.sourceKey, 'detail', new AbortController().signal, async url => url.startsWith('/api/products/') ? Response.json({ source: { ...source, sourceSha256: sha256 } }) : new Response(bytes)), /크기/);
  assert.equal(h.canvases.length, 0);
});

test('OCR output uses bounded real line boxes, preserves low-confidence text unselected, and never guesses a full-image region', () => {
  const h = fixture(), rows = h.client.readOcrRegions(ocr([line('中文 005', 90), line(' uncertain ', 30)]), 20, 12);
  assert.deepEqual(plain(rows.map(row => [row.id, row.text, row.selected])), [['ocr-1', '中文 005', true], ['ocr-2', 'uncertain', false]]);
  assert.deepEqual(plain(rows[0].box), { x: 1, y: 1, width: 11, height: 7 });
  for (const data of [{ text: '中文', blocks: null }, ocr([]), ocr([line('中文', 90, { x0: -1, y0: 1, x1: 12, y1: 8 })]), ocr([line('中文', 90, { x0: 1, y0: 1, x1: 21, y1: 8 })]),
    ocr(Array.from({ length: 101 }, () => line('中文', 90))), ocr(Array.from({ length: 5 }, () => line('中'.repeat(5000), 90)))]) assert.throws(() => h.client.readOcrRegions(data, 20, 12));
  assert.throws(() => h.client.readOcrRegions(ocr([line('中文', 90)]), 4000, 4000), /1,200만/);
});

test('one local worker uses packaged assets and terminates on success, cancellation and late initialization', async () => {
  const h = fixture(), loaded = image(h), logs = []; let terminated = 0;
  const rows = await h.client.recognizeFreeImage(loaded, 'zh', new AbortController().signal, message => logs.push(message), async (languages, oem, options) => {
    assert.deepEqual(plain(languages), ['chi_sim', 'eng']); assert.equal(oem, 1);
    assert.equal(options.workerPath, '/ocr/7.0.0/worker.min.js'); assert.equal(options.corePath, '/ocr/7.0.0/core'); assert.equal(options.langPath, '/ocr/7.0.0/lang'); assert.equal(options.workerBlobURL, false);
    return { recognize: async (canvas, config, output) => { assert.equal(canvas, loaded.canvas); assert.equal(config.rotateAuto, false); assert.equal(output.blocks, true); options.logger({ status: 'recognizing text', progress: 0.5 }); return { data: ocr([line('中文', 90)]) }; }, terminate: async () => { terminated++; } };
  });
  assert.equal(rows.length, 1); assert.equal(terminated, 1); assert.deepEqual(logs, ['문구 인식 50%']);
  const ready = deferred(), controller = new AbortController(); let started = 0, cancelledTerminations = 0;
  const pending = h.client.recognizeFreeImage(loaded, 'en', controller.signal, () => {}, async languages => {
    assert.deepEqual(plain(languages), ['eng']); return { recognize: () => { started++; return ready.promise; }, terminate: async () => { cancelledTerminations++; } };
  });
  await new Promise(resolve => setImmediate(resolve)); controller.abort(); await assert.rejects(pending);
  assert.equal(started, 1); assert.equal(cancelledTerminations, 1); ready.resolve({ data: ocr([line('late', 90)]) });
  const starting = deferred(), lateController = new AbortController(); let lateTerminations = 0, recognitions = 0;
  const late = h.client.recognizeFreeImage(loaded, 'zh', lateController.signal, () => {}, () => starting.promise);
  await new Promise(resolve => setImmediate(resolve));
  lateController.abort(); await assert.rejects(late);
  let replacementStarts = 0;
  const replacement = h.client.recognizeFreeImage(loaded, 'en', new AbortController().signal, () => {}, async () => {
    replacementStarts++; return { recognize: async () => ({ data: ocr([line('replacement', 90)]) }), terminate: async () => {} };
  });
  await new Promise(resolve => setImmediate(resolve)); assert.equal(replacementStarts, 0, 'next local engine waits for cancelled initialization to terminate');
  starting.resolve({ recognize: async () => { recognitions++; return { data: ocr([line('late', 90)]) }; }, terminate: async () => { lateTerminations++; } });
  await replacement; assert.equal(replacementStarts, 1); assert.equal(recognitions, 0); assert.equal(lateTerminations, 1);
});

test('translation echoes bind by exact ID and original despite reordered rows; malformed/foreign rows retain the draft', async () => {
  const h = fixture(), requested = [{ id: 'r1', text: '中文 005' }, { id: 'r2', text: '规格' }];
  const reply = { source, regions: [{ id: 'r2', original: '规格', translated: null, issue: '번역 미완료' }, { id: 'r1', original: '中文 005', translated: '한국어 005', issue: null }], requests: 1, stoppedHttpStatus: 429, warnings: ['일부 원문 유지'] };
  const result = await h.client.translateFreeImageRegions(source, 'zh', requested, new AbortController().signal, async (url, init) => {
    assert.equal(url, '/api/products/product/image-text'); assert.equal(init.method, 'POST');
    assert.deepEqual(JSON.parse(init.body), { action: 'translate', source, sourceLanguage: 'zh', regions: requested }); return Response.json(reply);
  });
  assert.deepEqual(plain(result.regions.map(row => row.id)), ['r1', 'r2']);
  for (const changed of [ { source: { ...source, contentRevision: 3 } }, { regions: reply.regions.slice(1) }, { regions: [reply.regions[0], reply.regions[0]] },
    { regions: [{ ...reply.regions[0], id: 'foreign' }, reply.regions[1]] }, { regions: [{ ...reply.regions[0], original: 'different' }, reply.regions[1]] },
    { regions: [{ ...reply.regions[0], translated: '' }, reply.regions[1]] }, { requests: 50 }, { stoppedHttpStatus: 400 }, { warnings: [null] } ]) {
    assert.throws(() => h.client.readFreeImageTranslationReply({ ...reply, ...changed }, source, requested));
  }
  const before = JSON.stringify(reply); assert.equal(JSON.stringify(reply), before);
});

test('render paints only selected clipped rectangles and keeps every outside pixel intact without changing originals', async () => {
  const h = fixture(), original = image(h), before = original.canvas.pixels.slice();
  const selected = region('r1', { x: 3, y: 2, width: 8, height: 6 }), ignored = { ...region('r2', { x: 14, y: 2, width: 4, height: 4 }), selected: false, translated: '' };
  const rendered = await h.client.renderFreeImageTranslation(original, [selected, ignored], new AbortController().signal), after = new Uint8Array(await rendered.output.arrayBuffer());
  for (let y = 0; y < 12; y++) for (let x = 0; x < 20; x++) if (!(x >= 3 && x < 11 && y >= 2 && y < 8)) {
    const offset = (y * 20 + x) * 4; assert.deepEqual(after.slice(offset, offset + 4), before.slice(offset, offset + 4), `outside selected box ${x},${y}`);
  }
  assert.deepEqual(original.canvas.pixels, before); assert.notDeepEqual(after, before);
  assert.deepEqual(h.operations.filter(operation => operation[0] === 'fill'), [['fill', 3, 2, 8, 6]]);
  assert.equal(rendered.width, 20); assert.equal(rendered.height, 12); assert.equal(rendered.output.type, 'image/png');
  for (const changed of [{ box: { x: 19, y: 0, width: 2, height: 1 } }, { translated: '' }, { background: 'red' }, { foreground: '#fff' }, { fontSize: 201 }]) {
    await assert.rejects(h.client.renderFreeImageTranslation(original, [{ ...selected, ...changed }], new AbortController().signal));
  }
  const stopped = new AbortController(); stopped.abort(); await assert.rejects(h.client.renderFreeImageTranslation(original, [selected], stopped.signal));
  assert.deepEqual(original.canvas.pixels, before);
});

test('uncertain apply keeps exact PNG/proof for explicit retry, binds the deterministic key and accepts only proven replay revision advances', async () => {
  const h = fixture(), output = new Blob(['same PNG bytes'], { type: 'image/png' }), rendered = { source, output, width: 20, height: 12 };
  const expected = await h.client.expectedFreeImageOutputKey(rendered), sent = []; let calls = 0;
  const request = async (url, init) => {
    calls++; assert.equal(url, '/api/products/product/image-text'); assert.equal(init.method, 'POST'); assert.equal(init.headers, undefined);
    sent.push([init.body.get('source'), new Uint8Array(await init.body.get('file').arrayBuffer())]);
    if (calls === 1) throw Error('saved acknowledgement lost');
    return Response.json({ source, key: expected, productVersion: '2026-10-06T00:00:01Z', contentRevision: 5, applied: true, replayed: true });
  };
  await assert.rejects(h.client.applyFreeImageTranslation(rendered, new AbortController().signal, request), error => error.uncertain === true);
  assert.equal(calls, 1, 'no automatic save retry');
  const saved = await h.client.applyFreeImageTranslation(rendered, new AbortController().signal, request); assert.equal(saved.replayed, true); assert.equal(calls, 2);
  assert.equal(sent[0][0], sent[1][0]); assert.deepEqual(sent[0][1], sent[1][1]);
  const good = { source, key: expected, productVersion: '2026-10-06T00:00:01Z', contentRevision: 3, applied: true };
  for (const changed of [{ key: 'owner/unrelated.png' }, { key: expected.replace('owner/', 'foreign/') }, { source: { ...source, role: 'main' } },
    { productVersion: version }, { contentRevision: 4 }, { replayed: true, contentRevision: 2 }, { applied: false }]) {
    assert.throws(() => h.client.readFreeImageApplyReply({ ...good, ...changed }, rendered, expected), error => error.uncertain === true);
  }
  await assert.rejects(h.client.applyFreeImageTranslation(rendered, new AbortController().signal, async () => Response.json({ error: 'source changed' }, { status: 409 })), error => error.uncertain === false);
  assert.equal(await h.client.expectedFreeImageOutputKey({ ...rendered, source: { height: 12, width: 20, role: 'detail', sourceSha256: source.sourceSha256, sourceKey: source.sourceKey, contentRevision: 2, productVersion: version, productId: 'product' } }), expected, 'source JSON key order never changes artifact identity');
});

test('main-image source and translation echoes bind the exact sorted option scope and revision', async () => {
  const h = fixture(), bytes = new TextEncoder().encode('authenticated original bytes');
  const original = { ...source, role: 'main', sourceSha256: await hash(bytes), optionImages: { revision: 7, optionIds: ['sku-a', 'sku-b'] } };
  const loaded = await h.client.readFreeImageSource('product', version, source.sourceKey, 'main', new AbortController().signal,
    async url => url.startsWith('/api/products/') ? Response.json({ source: original }) : new Response(bytes));
  assert.deepEqual(plain(loaded.source.optionImages), original.optionImages);
  for (const change of [
    { optionImages: { revision: -1, optionIds: ['sku-a'] } }, { optionImages: { revision: 7.5, optionIds: ['sku-a'] } },
    { optionImages: { revision: 7, optionIds: ['sku-b', 'sku-a'] } }, { optionImages: { revision: 7, optionIds: ['sku-a', 'sku-a'] } },
    { optionImages: { revision: 7, optionIds: ['bad/id'] } }, { optionImages: { revision: 7, optionIds: ['sku-a'], foreign: true } },
    { role: 'detail' },
  ]) {
    let reads = 0;
    await assert.rejects(h.client.readFreeImageSource('product', version, source.sourceKey, 'main', new AbortController().signal,
      async () => { reads++; return Response.json({ source: { ...original, ...change } }); }));
    assert.equal(reads, 1, 'invalid option proof never starts the original-file read');
  }
  const requested = [{ id: 'r1', text: '中文' }], reply = { source: original,
    regions: [{ id: 'r1', original: '中文', translated: '한국어', issue: null }], requests: 1, stoppedHttpStatus: null, warnings: [] };
  assert.equal(h.client.readFreeImageTranslationReply(reply, original, requested).regions[0].translated, '한국어');
  for (const optionImages of [undefined, { revision: 8, optionIds: ['sku-a', 'sku-b'] }, { revision: 7, optionIds: ['sku-a'] }]) {
    assert.equal(h.client.sameFreeImageSource({ ...original, optionImages }, original), false);
    assert.throws(() => h.client.readFreeImageTranslationReply({ ...reply, source: { ...original, optionImages } }, original, requested));
  }
});

test('preview freezes the chosen main-image option subset and separates artifact keys despite identical PNG bytes', async () => {
  const h = fixture(), loaded = image(h); loaded.source = { ...source, role: 'main', optionImages: { revision: 7, optionIds: ['sku-a', 'sku-b', 'sku-c'] } };
  const selected = ['sku-b', 'sku-a'], row = region('r1', { x: 3, y: 2, width: 8, height: 6 });
  const rendered = await h.client.renderFreeImageTranslation(loaded, [row], new AbortController().signal, selected);
  selected.splice(0, selected.length, 'sku-c');
  assert.deepEqual(plain(rendered.optionImageIds), ['sku-a', 'sku-b'], 'later checkbox edits cannot change the earlier PNG apply scope');
  const all = [undefined, ['sku-a'], ['sku-b'], ['sku-a', 'sku-b']];
  const keys = await Promise.all(all.map(optionImageIds => h.client.expectedFreeImageOutputKey({ ...rendered, optionImageIds })));
  assert.equal(new Set(keys).size, all.length, 'common-only, each option and both options have distinct apply identities');
  assert.equal(await h.client.expectedFreeImageOutputKey({ ...rendered, optionImageIds: ['sku-b', 'sku-a'] }), keys[3], 'selection order is not artifact identity');
  const output = new Uint8Array(await rendered.output.arrayBuffer()), before = loaded.canvas.pixels;
  for (let y = 0; y < 12; y++) for (let x = 0; x < 20; x++) if (!(x >= 3 && x < 11 && y >= 2 && y < 8)) {
    const offset = (y * 20 + x) * 4; assert.deepEqual(output.slice(offset, offset + 4), before.slice(offset, offset + 4));
  }
  const count = h.canvases.length;
  for (const ids of [['foreign'], ['sku-a', 'sku-a'], ['sku/a']]) {
    await assert.rejects(h.client.renderFreeImageTranslation(loaded, [row], new AbortController().signal, ids));
  }
  await assert.rejects(h.client.renderFreeImageTranslation({ ...loaded, source }, [row], new AbortController().signal, ['sku-a']));
  assert.equal(h.canvases.length, count, 'an invalid option scope does not render or mutate a new image');
});

test('selected-option apply retains exact PNG/scope after a lost ACK and rejects expanded scope or unproven revisions', async () => {
  const h = fixture(), original = { ...source, role: 'main', optionImages: { revision: 7, optionIds: ['sku-a', 'sku-b', 'sku-c'] } };
  const rendered = { source: original, output: new Blob(['same selected PNG'], { type: 'image/png' }), width: 20, height: 12, optionImageIds: ['sku-b', 'sku-a'] };
  const expected = await h.client.expectedFreeImageOutputKey(rendered), sent = []; let calls = 0;
  const good = { source: original, key: expected, productVersion: '2026-10-06T00:00:01Z', contentRevision: 3,
    optionImageIds: ['sku-a', 'sku-b'], optionRevision: 8, applied: true };
  const request = async (url, init) => {
    assert.equal(url, '/api/products/product/image-text'); assert.equal(init.method, 'POST');
    sent.push({ source: init.body.get('source'), ids: init.body.get('optionImageIds'), file: new Uint8Array(await init.body.get('file').arrayBuffer()) });
    if (++calls === 1) throw Error('saved ACK lost');
    return Response.json({ ...good, contentRevision: 5, optionRevision: 10, replayed: true });
  };
  await assert.rejects(h.client.applyFreeImageTranslation(rendered, new AbortController().signal, request), error => error.uncertain === true);
  assert.equal(calls, 1, 'uncertain save never automatically retries');
  const result = await h.client.applyFreeImageTranslation(rendered, new AbortController().signal, request);
  assert.equal(result.replayed, true); assert.equal(calls, 2);
  assert.equal(sent[0].source, sent[1].source); assert.equal(sent[0].ids, sent[1].ids); assert.deepEqual(JSON.parse(sent[0].ids), ['sku-a', 'sku-b']);
  assert.deepEqual(sent[0].file, sent[1].file); assert.deepEqual(JSON.parse(sent[0].source).optionImages, original.optionImages);
  for (const change of [
    { optionImageIds: undefined }, { optionImageIds: ['sku-a'] }, { optionImageIds: ['sku-b', 'sku-a'] },
    { optionImageIds: ['sku-a', 'sku-c'] }, { optionImageIds: ['sku-a', 'sku-b', 'sku-c'] },
    { optionRevision: undefined }, { optionRevision: 7 }, { optionRevision: 9 }, { replayed: true, optionRevision: 7 },
    { source: { ...original, optionImages: { revision: 8, optionIds: ['sku-a', 'sku-b', 'sku-c'] } } },
    { source: { ...original, optionImages: { revision: 7, optionIds: ['sku-a', 'sku-b'] } } },
    { key: await h.client.expectedFreeImageOutputKey({ ...rendered, optionImageIds: ['sku-a'] }) },
  ]) assert.throws(() => h.client.readFreeImageApplyReply({ ...good, ...change }, rendered, expected), error => error.uncertain === true);
  const common = { ...rendered, optionImageIds: [] }, commonKey = await h.client.expectedFreeImageOutputKey(common);
  let commonCalls = 0;
  await h.client.applyFreeImageTranslation(common, new AbortController().signal, async (url, init) => {
    commonCalls++; assert.equal(init.body.get('optionImageIds'), null, 'common-only apply omits option mutation scope');
    return Response.json({ source: original, key: commonKey, productVersion: good.productVersion, contentRevision: 3, applied: true });
  }); assert.equal(commonCalls, 1);
  assert.throws(() => h.client.readFreeImageApplyReply({ source: original, key: commonKey, productVersion: good.productVersion,
    contentRevision: 3, optionImageIds: ['sku-a'], optionRevision: 8, applied: true }, common, commonKey), error => error.uncertain === true,
  'an unselected preview cannot accept an ACK claiming an additional option mutation');
});

test('individual-only representative translation requires selected options and exactly zero content revision change', async () => {
  const h = fixture(), loaded = image(h); loaded.source = { ...source, sourceKey: 'owner/individual.png', role: 'main',
    optionImages: { revision: 7, optionIds: ['sku-a', 'sku-b'], commonAssigned: false } };
  const row = region('r1', { x: 3, y: 2, width: 8, height: 6 }), count = h.canvases.length;
  await assert.rejects(h.client.renderFreeImageTranslation(loaded, [row], new AbortController().signal, []));
  assert.equal(h.canvases.length, count, 'an individual-only source never renders a common-only apply');
  const rendered = await h.client.renderFreeImageTranslation(loaded, [row], new AbortController().signal, ['sku-b']);
  assert.deepEqual(plain(rendered.optionImageIds), ['sku-b']); assert.equal(rendered.source.optionImages.commonAssigned, false);
  const key = await h.client.expectedFreeImageOutputKey(rendered), commonSource = { ...loaded.source,
    optionImages: { revision: 7, optionIds: ['sku-a', 'sku-b'] } };
  assert.equal(h.client.sameFreeImageSource(commonSource, loaded.source), false);
  assert.notEqual(await h.client.expectedFreeImageOutputKey({ ...rendered, source: commonSource }), key,
    'the same bytes/option subset cannot be mistaken for a source assigned to common main');
  const good = { source: loaded.source, key, productVersion: '2026-10-06T00:00:01Z', contentRevision: source.contentRevision,
    optionImageIds: ['sku-b'], optionRevision: 8, applied: true };
  assert.equal(h.client.readFreeImageApplyReply(good, rendered, key).contentRevision, 2);
  for (const change of [{ contentRevision: 3 }, { contentRevision: 1 }, { contentRevision: '2' }, { source: commonSource },
    { optionImageIds: ['sku-a'] }, { optionRevision: 7 }, { optionRevision: 9 }, { replayed: true, contentRevision: 1 }]) {
    assert.throws(() => h.client.readFreeImageApplyReply({ ...good, ...change }, rendered, key), error => error.uncertain === true);
  }
  assert.equal(h.client.readFreeImageApplyReply({ ...good, replayed: true, contentRevision: 5, optionRevision: 10 }, rendered, key).replayed, true,
    'proven replay can acknowledge unrelated later content edits without inventing a new common-image apply');
  let attempts = 0; const sent = [];
  const request = async (url, init) => {
    assert.equal(url, '/api/products/product/image-text');
    sent.push({ source: init.body.get('source'), ids: init.body.get('optionImageIds'), output: new Uint8Array(await init.body.get('file').arrayBuffer()) });
    if (++attempts === 1) throw Error('individual apply ACK lost');
    return Response.json({ ...good, replayed: true });
  };
  await assert.rejects(h.client.applyFreeImageTranslation(rendered, new AbortController().signal, request), error => error.uncertain === true);
  assert.equal(attempts, 1); await h.client.applyFreeImageTranslation(rendered, new AbortController().signal, request);
  assert.equal(attempts, 2); assert.deepEqual(sent[0], sent[1]);
  assert.equal(JSON.parse(sent[0].source).optionImages.commonAssigned, false); assert.deepEqual(JSON.parse(sent[0].ids), ['sku-b']);
  const noOptions = { ...rendered, optionImageIds: [] }; let network = 0;
  await assert.rejects(h.client.applyFreeImageTranslation(noOptions, new AbortController().signal, async () => { network++; return Response.json(good); }));
  assert.equal(network, 0, 'a removed option-only preview scope is rejected before transmission');
});
