import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { webcrypto } from 'node:crypto';

const plain = value => JSON.parse(JSON.stringify(value));
const line = (text = '中文商品说明'.repeat(5), confidence = 95, bbox = { x0: 30, y0: 30, x1: 290, y1: 110 }) => ({ text, confidence, bbox });
function fixture({ color = () => [240, 202, 172, 255], contextMissing = false, pixelFailure = false, lines = [line()] } = {}) {
  const reads = [], writes = [], cache = new Map(); let terminated = 0, recognized = 0;
  const context = { font: 'original font',
    measureText(text) { return { width: Array.from(text).length * Number(/([0-9.]+)px/u.exec(this.font)?.[1] ?? 10) }; },
    getImageData(x, y, width, height) {
      reads.push({ x, y, width, height }); if (pixelFailure) throw Error('Synthetic unreadable source pixels');
      assert.ok(x >= 0 && y >= 0 && x + width <= 400 && y + height <= 180);
      const data = new Uint8ClampedArray(width * height * 4);
      for (let py = 0; py < height; py++) for (let px = 0; px < width; px++) data.set(color(x + px, y + py), (py * width + px) * 4);
      return { data };
    },
    fillRect(...args) { writes.push(args); }, drawImage(...args) { writes.push(args); }, fillText(...args) { writes.push(args); },
  };
  const source = Object.freeze({ productId: 'product', sourceKey: 'owner/source.png', role: 'detail', width: 400, height: 180 });
  const editDocument = Object.freeze({ regions: Object.freeze([Object.freeze({ id: 'saved-manual', background: '#123456', foreground: '#abcdef', fontSize: 17, textAlign: 'right', translated: '직접 작성한 문구' })]) });
  const image = { source, editDocument, canvas: { getContext: () => contextMissing ? null : context }, width: 400, height: 180 };
  const data = { blocks: [{ paragraphs: [{ lines }] }] }, before = JSON.stringify({ source, editDocument, data });
  function load(file) {
    if (cache.has(file)) return cache.get(file); const exports = {}; cache.set(file, exports);
    vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../' + file, import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
      { exports, Error, Date, URL, URLSearchParams, Blob, File, FormData, Response, Request, Headers, AbortController, AbortSignal, TextEncoder, TextDecoder, Uint8Array, Uint8ClampedArray, DataView, structuredClone, crypto: webcrypto, setTimeout, clearTimeout,
        fetch() { throw Error('Network is forbidden in local OCR style tests'); },
        require(name) { assert.ok(name.startsWith('@/'), name); return load(name.slice(2) + '.ts'); } });
    return exports;
  }
  const client = load('app/free-image-translation-client.ts');
  const worker = async () => ({ recognize: async canvas => { assert.equal(canvas, image.canvas); recognized++; return { data }; }, terminate: async () => { terminated++; } });
  return { client, image, reads, writes, context, before, retained: () => JSON.stringify({ source, editDocument, data }),
    run: () => client.recognizeLocalFreeImage(image, 'zh', new AbortController().signal, () => {}, worker),
    counts: () => ({ recognized, terminated }) };
}

test('new local OCR defaults sample source colors and fit the real text without changing stored manual styles or source pixels', async () => {
  for (const [color, background, foreground] of [[() => [240, 202, 172, 255], '#f0caac', '#111111'], [() => [25, 30, 35, 255], '#191e23', '#ffffff']]) {
    const h = fixture({ color }), rows = await h.run(), row = rows[0];
    assert.equal(row.background, background); assert.equal(row.foreground, foreground); assert.equal(row.textAlign, 'center');
    assert.equal(row.id, 'ocr-1'); assert.equal(row.confidence, 95); assert.equal(row.text, line().text); assert.equal(row.translated, ''); assert.equal(row.translationProvenance, 'empty');
    assert.deepEqual(plain(row.box), { x: 30, y: 30, width: 260, height: 80 }); assert.equal(row.selected, true); assert.equal(row.issue, null);
    assert.ok(row.fontSize < 64); assert.ok(Array.from(row.text).length * row.fontSize <= 254); assert.deepEqual(plain(h.image.visionStyleIssues), []);
    assert.ok(h.reads.length > 0); assert.deepEqual(h.writes, []); assert.equal(h.retained(), h.before); assert.equal(h.context.font, 'original font');
    assert.deepEqual(h.counts(), { recognized: 1, terminated: 1 });
  }
});

test('complex, transparent and unreadable local backgrounds remain unselected with the existing automatic style gate', async () => {
  for (const [options, expected] of [
    [{ color: (x, y) => (x + y) % 2 ? [0, 0, 0, 255] : [255, 255, 255, 255] }, 'VISION_BACKGROUND_COMPLEX'],
    [{ color: () => [0, 0, 0, 0] }, 'VISION_BACKGROUND_UNAVAILABLE'],
    [{ contextMissing: true }, 'VISION_BACKGROUND_UNAVAILABLE'], [{ pixelFailure: true }, 'VISION_BACKGROUND_UNAVAILABLE'],
  ]) {
    const h = fixture(options), rows = await h.run();
    assert.equal(rows[0].selected, false); assert.match(rows[0].issue, new RegExp(expected)); assert.ok(h.image.visionStyleIssues.includes(expected));
    assert.equal(rows[0].text, line().text); assert.deepEqual(plain(rows[0].box), { x: 30, y: 30, width: 260, height: 80 });
    assert.equal(h.retained(), h.before); assert.deepEqual(h.writes, []); assert.deepEqual(h.counts(), { recognized: 1, terminated: 1 });
  }
});

test('low-confidence and overlapping local lines preserve identities and coordinates without becoming automatically selected', async () => {
  const h = fixture({ lines: [line('中文', 42), line('说明', 96, { x0: 40, y0: 40, x1: 150, y1: 80 })] }), rows = await h.run();
  assert.deepEqual(plain(rows.map(row => [row.id, row.confidence, row.selected])), [['ocr-1', 42, false], ['ocr-2', 96, false]]);
  assert.ok(h.image.visionStyleIssues.includes('VISION_REGION_OVERLAP')); assert.equal(h.retained(), h.before); assert.deepEqual(h.writes, []);
  const low = fixture({ lines: [line('中文', 42)] }), lowRows = await low.run(); assert.equal(lowRows[0].selected, false); assert.equal(lowRows[0].issue, null);
});

test('invalid local line bounds still reject before pixel sampling and terminate the worker', async () => {
  const h = fixture({ lines: [line('中文', 95, { x0: 30, y0: 30, x1: 401, y1: 80 })] });
  await assert.rejects(h.run(), /영역|좌표/u); assert.deepEqual(h.reads, []); assert.deepEqual(h.writes, []); assert.equal(h.retained(), h.before); assert.deepEqual(h.counts(), { recognized: 1, terminated: 1 });
});
