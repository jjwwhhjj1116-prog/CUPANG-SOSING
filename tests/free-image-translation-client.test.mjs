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
function fixture({ imageWidth = 20, imageHeight = 12, decodeWait, fonts } = {}) {
  const objects = new Map(), revoked = [], canvases = [], operations = [], measurements = []; let sequence = 0;
  class ObjectURL extends URL { static createObjectURL(blob) { const url = 'blob:fixture-' + ++sequence; objects.set(url, blob); return url; } static revokeObjectURL(url) { revoked.push(url); objects.delete(url); } }
  class Image { set src(url) { if (!url) return; Promise.resolve(decodeWait).then(() => { if (!objects.has(url)) return; this.naturalWidth = imageWidth; this.naturalHeight = imageHeight; this.pixels = pixels(imageWidth, imageHeight); this.onload?.(); }); } }
  const document = { createElement(tag) {
    assert.equal(tag, 'canvas'); const output = { width: 0, height: 0, pixels: null }, clips = []; let clip = null, path = [], dot = null;
    const rgba = hex => [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16), 255];
    const paint = (x, y, width, height, color) => {
      for (let py = Math.floor(y); py < y + height; py++) for (let px = Math.floor(x); px < x + width; px++) {
        if (px < 0 || py < 0 || px >= output.width || py >= output.height || clip && (px < clip.x || py < clip.y || px >= clip.x + clip.width || py >= clip.y + clip.height)) continue;
        output.pixels.set(color, (py * output.width + px) * 4);
      }
    };
    const textWidth = (font, text) => {
      const size = Number(/([0-9.]+)px/u.exec(font)?.[1]);
      return Array.from(text).length * size / 2 * (/\bbold\b/u.test(font) ? 1.25 : 1) * (/\bitalic\b/u.test(font) ? 1.1 : 1);
    };
    const paintPath = (points, radius, color) => {
      for (let y = 0; y < output.height; y++) for (let x = 0; x < output.width; x++) {
        const px = x + 0.5, py = y + 0.5;
        let distance = Math.hypot(px - points[0].x, py - points[0].y);
        for (let index = 1; index < points.length; index++) {
          const a = points[index - 1], b = points[index], dx = b.x - a.x, dy = b.y - a.y, length = dx * dx + dy * dy;
          const fraction = length ? Math.max(0, Math.min(1, ((px - a.x) * dx + (py - a.y) * dy) / length)) : 0;
          distance = Math.min(distance, Math.hypot(px - a.x - fraction * dx, py - a.y - fraction * dy));
        }
        if (distance <= radius) paint(x, y, 1, 1, color);
      }
    };
    const context = { font: '10px Arial', fillStyle: '#000000', textBaseline: 'top', textAlign: 'left',
      drawImage(image, x, y) { assert.equal(x, 0); assert.equal(y, 0); output.pixels = image.pixels.slice(); operations.push(['draw', output.width, output.height]); },
      measureText(text) { const width = textWidth(this.font, text); measurements.push({ text, font: this.font, width }); return { width }; },
      save() { clips.push(clip); }, restore() { clip = clips.pop(); }, beginPath() { path = []; dot = null; }, rect(x, y, width, height) { clip = { x, y, width, height }; }, clip() {},
      moveTo(x, y) { path.push({ x, y }); }, lineTo(x, y) { path.push({ x, y }); },
      stroke() { operations.push(['stroke', plain(path), this.lineWidth, this.lineCap, this.lineJoin]); paintPath(path, this.lineWidth / 2, rgba(this.strokeStyle)); },
      arc(x, y, radius, start, end) { assert.equal(start, 0); assert.equal(end, Math.PI * 2); dot = { x, y, radius }; },
      fill() { assert.ok(dot); operations.push(['dot', dot.x, dot.y, dot.radius]); paintPath([dot], dot.radius, rgba(this.fillStyle)); },
      fillRect(x, y, width, height) { operations.push(['fill', x, y, width, height]); paint(x, y, width, height, rgba(this.fillStyle)); },
      fillText(text, x, y) { operations.push(['text', text, x, y, this.font, this.textAlign]);
        const width = textWidth(this.font, text), left = x - (this.textAlign === 'center' ? width / 2 : this.textAlign === 'right' ? width : 0);
        paint(left, y, 1, 1, rgba(this.fillStyle)); },
    };
    output.getContext = kind => { assert.equal(kind, '2d'); return context; };
    output.toBlob = (callback, type) => { assert.equal(type, 'image/png'); callback(new Blob([output.pixels], { type })); };
    canvases.push(output); return output;
  } };
  if (fonts !== undefined) document.fonts = fonts;
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
  return { client, brush: load('app/free-image-brush.ts'), canvases, operations, measurements, revoked, objects, document };
}
function image(h) { const value = h.document.createElement('canvas'); value.width = source.width; value.height = source.height; value.pixels = pixels(source.width, source.height); return { source, canvas: value, blob: new Blob(['original']), width: source.width, height: source.height }; }
const region = (id, box, translated = '한국어') => ({ id, text: '中文', box, confidence: 90, selected: true, translated, issue: null, translationProvenance: 'generated', background: '#ffffff', foreground: '#000000', fontSize: 3 });
const ocr = lines => ({ blocks: [{ paragraphs: [{ lines }] }] });
const line = (text, confidence, bbox = { x0: 1, y0: 1, x1: 12, y1: 8 }) => ({ text, confidence, bbox });
const quotationRequest = (input = 'detailImages') => ({ kind: 'quotation', profileId: null, optionId: 'sku-a', input, fieldKey: 'wire-' + input, slotIndex: input === 'mainImage' ? 0 : 1,
  revision: 7, inputFingerprint: 'c'.repeat(64), optionRevision: 3, value: input === 'mainImage' ? 'owner/original.png' : 'owner/other.png\nowner/original.png' });

test('saved final-slot source reads bind the exact quotation request before any file read', async () => {
  const bytes = new TextEncoder().encode('authenticated original bytes'), sha256 = await hash(bytes);
  for (const input of ['mainImage', 'additionalImages', 'detailImages']) {
    const h = fixture(), target = quotationRequest(input), role = input === 'mainImage' ? 'main' : input === 'additionalImages' ? 'additional' : 'detail', calls = [];
    const finalSource = { ...source, role, sourceSha256: sha256, quotationTarget: { ...target, bindingSha256: 'b'.repeat(64) } };
    const loaded = await h.client.readFreeImageSource('product', version, source.sourceKey, role, new AbortController().signal, async url => {
      calls.push(url); return calls.length === 1 ? Response.json({ source: finalSource }) : new Response(bytes);
    }, target);
    const query = new URL(calls[0], 'https://fixture.local').searchParams;
    assert.equal(query.get('target'), 'quotation'); assert.equal(query.get('optionId'), 'sku-a'); assert.equal(query.get('fieldKey'), 'wire-' + input);
    assert.equal(query.get('slotIndex'), input === 'mainImage' ? '0' : '1'); assert.equal(query.has('profileId'), false); assert.equal(query.has('value'), false);
    assert.deepEqual(plain(loaded.source.quotationTarget), finalSource.quotationTarget);
    for (const patch of [{ optionId: 'sku-b' }, { slotIndex: input === 'mainImage' ? 1 : 0 }, { fieldKey: input }, { revision: 8 }, { inputFingerprint: 'd'.repeat(64) }, { value: input === 'mainImage' ? 'owner/other.png' : 'owner/original.png' }, { profileId: 'profile' }]) {
      let reads = 0; await assert.rejects(h.client.readFreeImageSource('product', version, source.sourceKey, role, new AbortController().signal, async () => {
        reads++; return Response.json({ source: { ...finalSource, quotationTarget: { ...finalSource.quotationTarget, ...patch } } });
      }, target)); assert.equal(reads, 1, 'a different final slot proof never reads source bytes');
    }
    let reads = 0; await assert.rejects(h.client.readFreeImageSource('product', version, source.sourceKey, role, new AbortController().signal, async () => {
      reads++; return Response.json({ source: finalSource });
    })); assert.equal(reads, 1, 'common-role source reads cannot silently accept a quotation target');
  }
});

test('final-slot recovery submits only the identical PNG digest, verifies scope and does not upload or retry', async () => {
  const h = fixture(), finalSource = { ...source, quotationTarget: { ...quotationRequest(), bindingSha256: 'b'.repeat(64) } };
  const output = new Blob(['same final slot PNG'], { type: 'image/png' }), rendered = { source: finalSource, output, width: 20, height: 12 };
  const key = await h.client.expectedFreeImageOutputKey(rendered), bytes = await output.arrayBuffer(), calls = [];
  const good = { source: finalSource, key, productVersion: '2026-10-06T00:00:01Z', contentRevision: 2, optionRevision: 3,
    quotationRevision: 8, quotationInputFingerprint: 'd'.repeat(64), applied: true, replayed: true };
  for (const committed of [false, true]) {
    const result = await h.client.recoverFreeImageTranslation(rendered, new AbortController().signal, async (url, init) => {
      calls.push({ url, init }); assert.equal(init.method, 'POST'); assert.equal(init.headers['content-type'], 'application/json');
      assert.deepEqual(JSON.parse(init.body), { action: 'recover', source: finalSource, outputSha256: await hash(bytes), outputBytes: output.size });
      return Response.json(committed ? good : { source: finalSource, key, applied: false });
    }); assert.equal(result.applied, committed);
  }
  assert.equal(calls.length, 2); assert.equal(rendered.output, output);
  for (const bad of [{ source: { ...finalSource, quotationTarget: { ...finalSource.quotationTarget, slotIndex: 0 } }, key, applied: false },
    { source: finalSource, key: 'owner/other.png', applied: false }, { source: finalSource, key, applied: false, optionRevision: 4 },
    { ...good, contentRevision: 3 }, { ...good, optionRevision: 4 }, { ...good, quotationRevision: 7 }, { ...good, quotationInputFingerprint: undefined }]) {
    await assert.rejects(h.client.recoverFreeImageTranslation(rendered, new AbortController().signal, async () => Response.json(bad)), error => error.uncertain === true);
  }
  await assert.rejects(h.client.recoverFreeImageTranslation(rendered, new AbortController().signal, async () => Response.json({ error: 'slot changed' }, { status: 409 })), error => error.uncertain === true);
  let sent;
  await h.client.applyFreeImageTranslation(rendered, new AbortController().signal, async (_url, init) => {
    sent = init.body; return Response.json({ ...good, replayed: undefined });
  });
  assert.equal(sent.get('optionImageIds'), null); assert.deepEqual(JSON.parse(sent.get('source')), finalSource);
  assert.deepEqual(new Uint8Array(await sent.get('file').arrayBuffer()), new Uint8Array(bytes));
  for (const changes of [{ optionId: 'sku-b' }, { slotIndex: 0, value: 'owner/original.png\nowner/other.png' }, { fieldKey: 'detailImages' }]) {
    const changed = { ...rendered, source: { ...finalSource, quotationTarget: { ...finalSource.quotationTarget, ...changes } } };
    assert.notEqual(await h.client.expectedFreeImageOutputKey(changed), key, 'the same PNG is distinct for every final image binding');
  }
});

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

test('Google 429 recovery retains mixed original bindings and validates each bounded Workers status',()=>{
  const h=fixture(),requested=[{id:'google',text:'中文一'},{id:'workers-a',text:'中文二'},{id:'workers-b',text:'中文三'},{id:'ignored',text:'123'}];
  for(const [status,requests,translatedRegions,sourceRegions]of [['completed',1,2,2],['partial',1,1,2],['failed',1,0,2],['limited',0,0,2],['timeout',1,0,2],['invalid-response',1,0,2]]){
    const rows=requested.map((row,index)=>({id:row.id,original:row.text,translated:index===0?'Google 성공':index>0&&index<=translatedRegions?'서버 성공 '+index:null,issue:index===0||index>0&&index<=translatedRegions?null:'원문 유지'}));
    const reply={source,regions:rows.reverse(),requests:1,stoppedHttpStatus:429,warnings:[],workersRecovery:{provider:'workers-ai',status,requests,sourceRegions,translatedRegions}};
    const before=JSON.stringify(reply),result=h.client.readFreeImageTranslationReply(reply,source,requested);
    assert.equal(result.regions[0].translated,'Google 성공');assert.deepEqual(plain(result.regions.map(row=>row.original)),requested.map(row=>row.text));
    assert.deepEqual(plain(result.workersRecovery),reply.workersRecovery);assert.equal(JSON.stringify(reply),before,'does not mutate source, Google success or recovery metadata');
  }
  const many=Array.from({length:31},(_,index)=>({id:'r'+index,text:'中文'+index}));
  const result=h.client.readFreeImageTranslationReply({source,regions:many.map(row=>({id:row.id,original:row.text,translated:null,issue:'입력 한도'})),requests:1,stoppedHttpStatus:429,warnings:[],workersRecovery:{provider:'workers-ai',status:'input-limit',requests:0,sourceRegions:31,translatedRegions:0}},source,many);
  assert.equal(result.workersRecovery.requests,0);assert.equal(result.regions.filter(row=>row.translated!==null).length,0);
});

test('unconfirmed 429, foreign providers, impossible calls or counts and malformed Workers metadata cannot replace a draft',()=>{
  const h=fixture(),requested=[{id:'r1',text:'中文一'},{id:'r2',text:'中文二'}];
  const reply={source,regions:requested.map(row=>({id:row.id,original:row.text,translated:'번역문',issue:null})),requests:1,stoppedHttpStatus:429,warnings:[],workersRecovery:{provider:'workers-ai',status:'completed',requests:1,sourceRegions:2,translatedRegions:2}};
  for(const patch of [{provider:'openai'},{status:'unknown'},{requests:2},{requests:0},{sourceRegions:0},{sourceRegions:3},{translatedRegions:3},{translatedRegions:-1},{translatedRegions:1},{status:'partial'},{status:'failed'},{status:'limited'},{status:'input-limit'},{billing:'unexpected'}])
    assert.throws(()=>h.client.readFreeImageTranslationReply({...reply,workersRecovery:{...reply.workersRecovery,...patch}},source,requested));
  for(const patch of [{stoppedHttpStatus:null},{stoppedHttpStatus:503},{requests:0},{workersRecovery:null},{workersRecovery:undefined},{regions:[{...reply.regions[0],translated:null,issue:'실패'},reply.regions[1]]}])
    assert.throws(()=>h.client.readFreeImageTranslationReply({...reply,...patch},source,requested));
});

test('a partial Workers response is accepted after one explicit translate transport and never triggers a client fallback or retry',async()=>{
  const h=fixture(),requested=[{id:'r1',text:'中文一'},{id:'r2',text:'中文二'}];let calls=0;
  const result=await h.client.translateFreeImageRegions(source,'zh',requested,new AbortController().signal,async(url,init)=>{
    calls++;assert.equal(url,'/api/products/product/image-text');const body=JSON.parse(init.body);assert.deepEqual(body.regions,requested);assert.ok(!('image' in body)&&!('file' in body));
    return Response.json({source,regions:[{id:'r1',original:'中文一',translated:'성공한 한국어',issue:null},{id:'r2',original:'中文二',translated:null,issue:'완료하지 못함'}],requests:1,stoppedHttpStatus:429,warnings:[],workersRecovery:{provider:'workers-ai',status:'partial',requests:1,sourceRegions:2,translatedRegions:1}});
  });await Promise.resolve();assert.equal(calls,1);assert.equal(result.regions[1].translated,null);assert.equal(result.workersRecovery.status,'partial');
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

test('overlapping text layers visibly follow forward/back order and removing or readding a layer restores the expected pixels', async () => {
  const h = fixture(), original = image(h), before = original.canvas.pixels.slice();
  const back = { ...region('back', { x: 3, y: 2, width: 8, height: 6 }, 'A'), background: '#abcdef', foreground: '#112233', fontSize: 2 };
  const front = { ...region('front', { x: 3, y: 2, width: 4, height: 4 }, 'B'), background: '#987654', foreground: '#334455', fontSize: 2 };
  const untouched = JSON.stringify([back, front]);
  const render = async rows => {
    const output = await h.client.renderFreeImageTranslation(original, rows, new AbortController().signal);
    assert.equal(output.source, source); const bytes = new Uint8Array(await output.output.arrayBuffer());
    for (let y = 0; y < 12; y++) for (let x = 0; x < 20; x++) if (!(x >= 3 && x < 11 && y >= 2 && y < 8)) {
      const offset = (y * 20 + x) * 4; assert.deepEqual(bytes.slice(offset, offset + 4), before.slice(offset, offset + 4), `outside layers ${x},${y}`);
    }
    assert.deepEqual(original.canvas.pixels, before); return bytes;
  };
  const pixel = (bytes, x, y) => Array.from(bytes.slice((y * 20 + x) * 4, (y * 20 + x + 1) * 4));
  const forward = await render([back, front]);
  assert.deepEqual(pixel(forward, 3, 2), [0x33, 0x44, 0x55, 255], 'front text covers back text');
  assert.deepEqual(pixel(forward, 4, 3), [0x98, 0x76, 0x54, 255], 'front background covers the overlap');
  assert.deepEqual(pixel(forward, 9, 6), [0xab, 0xcd, 0xef, 255], 'back layer is visible outside the front rectangle');
  const backward = await render([front, back]);
  assert.deepEqual(pixel(backward, 3, 2), [0x11, 0x22, 0x33, 255]); assert.deepEqual(pixel(backward, 4, 3), [0xab, 0xcd, 0xef, 255]);
  assert.notDeepEqual(forward, backward);
  assert.deepEqual(await render([back]), backward, 'removing the top layer reveals the bottom layer');
  assert.deepEqual(await render([back, front]), forward, 'readding it at the front restores its pixels');
  const frontOnly = await render([front]); assert.deepEqual(pixel(frontOnly, 9, 6), pixel(before, 9, 6), 'removing the back layer restores source pixels');
  assert.deepEqual(await render([back, front]), forward, 'moving back behind the existing front restores the original composition');
  const created = h.canvases.length;
  await assert.rejects(h.client.renderFreeImageTranslation(original, [back, { ...front, id: back.id }], new AbortController().signal));
  assert.equal(h.canvases.length, created, 'readding cannot introduce duplicate selected IDs'); assert.equal(JSON.stringify([back, front]), untouched);
});

test('overlapping erase and text layers clear or restore the same wording according to their selected order', async () => {
  const h = fixture(), original = image(h), before = original.canvas.pixels.slice();
  const text = { ...region('text', { x: 3, y: 2, width: 8, height: 6 }, 'A'), background: '#ffffff', foreground: '#cc1122', fontSize: 2 };
  const erase = { ...region('erase', { x: 3, y: 2, width: 4, height: 4 }, ''), text: '', erase: true, background: '#234567' };
  const render = async rows => new Uint8Array(await (await h.client.renderFreeImageTranslation(original, rows, new AbortController().signal)).output.arrayBuffer());
  const pixel = (bytes, x, y) => Array.from(bytes.slice((y * 20 + x) * 4, (y * 20 + x + 1) * 4));
  const covered = await render([text, erase]), visible = await render([erase, text]);
  assert.deepEqual(pixel(covered, 3, 2), [0x23, 0x45, 0x67, 255], 'erase on top removes the lower text');
  assert.deepEqual(pixel(covered, 4, 3), [0x23, 0x45, 0x67, 255]);
  assert.deepEqual(pixel(visible, 3, 2), [0xcc, 0x11, 0x22, 255], 'text on top restores visible wording');
  assert.deepEqual(pixel(visible, 4, 3), [255, 255, 255, 255]);
  assert.deepEqual(await render([text]), visible); assert.deepEqual(await render([text, erase]), covered);
  assert.deepEqual(await render([text, { ...erase, selected: false }]), visible, 'an unselected erase layer cannot cover text');
  const eraseOnly = await render([erase]); assert.deepEqual(pixel(eraseOnly, 9, 6), pixel(before, 9, 6));
  for (const bytes of [covered, visible, eraseOnly]) for (let y = 0; y < 12; y++) for (let x = 0; x < 20; x++) if (!(x >= 3 && x < 11 && y >= 2 && y < 8)) {
    assert.deepEqual(pixel(bytes, x, y), pixel(before, x, y), `outside selected layers ${x},${y}`);
  }
  const created = h.canvases.length;
  await assert.rejects(h.client.renderFreeImageTranslation(original, [text, { ...erase, id: text.id }], new AbortController().signal));
  assert.equal(h.canvases.length, created); assert.deepEqual(original.canvas.pixels, before); assert.equal(text.translated, 'A'); assert.equal(erase.translated, '');
});

test('brush strokes draw only round paths and dots, preserve source/off-path pixels and never load retained text fonts', async () => {
  const h = fixture({ fonts: { load() { throw Error('brush cannot load text font'); }, check() { throw Error('brush cannot check text font'); } } }), original = image(h), before = original.canvas.pixels.slice();
  const path = h.brush.createFreeImageBrush(2, [{ x: 3, y: 3 }, { x: 9, y: 9 }], 20, 12);
  const selected = { ...region('stroke', path.box, ''), ...path, erase: true, text: '', background: '#234567', fontFamily: 'gmarket' };
  const bytes = new Uint8Array(await (await h.client.renderFreeImageTranslation(original, [selected], new AbortController().signal)).output.arrayBuffer());
  const pixel = (data, x, y) => Array.from(data.slice((y * 20 + x) * 4, (y * 20 + x + 1) * 4));
  for (const [x, y] of [[2, 2], [3, 3], [6, 6], [9, 9]]) assert.deepEqual(pixel(bytes, x, y), [0x23, 0x45, 0x67, 255]);
  for (const [x, y] of [[2, 9], [9, 2], [1, 1], [10, 10]]) assert.deepEqual(pixel(bytes, x, y), pixel(before, x, y), 'off-path pixels remain source pixels even inside the bounding rectangle');
  for (let y = 0; y < 12; y++) for (let x = 0; x < 20; x++) if (x < path.box.x || y < path.box.y || x >= path.box.x + path.box.width || y >= path.box.y + path.box.height) {
    assert.deepEqual(pixel(bytes, x, y), pixel(before, x, y));
  }
  assert.deepEqual(h.operations.filter(value => value[0] === 'stroke'), [['stroke', [{ x: 3, y: 3 }, { x: 9, y: 9 }], 2, 'round', 'round']]);
  assert.equal(h.operations.filter(value => value[0] === 'fill').length, 0); assert.equal(h.measurements.length, 0); assert.deepEqual(original.canvas.pixels, before);
  const dot = h.brush.createFreeImageBrush(4, [{ x: 0, y: 0 }], 20, 12);
  const dotted = new Uint8Array(await (await h.client.renderFreeImageTranslation(original, [{ ...selected, ...dot }], new AbortController().signal)).output.arrayBuffer());
  assert.deepEqual(pixel(dotted, 0, 0), [0x23, 0x45, 0x67, 255]); assert.deepEqual(pixel(dotted, 1, 1), pixel(before, 1, 1));
  assert.deepEqual(h.operations.filter(value => value[0] === 'dot'), [['dot', 0, 0, 2]]); assert.deepEqual(original.canvas.pixels, before);
});

test('reviewed region IDs, colors, text, modes and geometry stay fixed while a different layer waits for its font', async () => {
  for (const mutation of ['brush-as-rectangle', 'brush-as-text', 'text-as-erase']) {
  const loading = deferred(), h = fixture({ fonts: { load: () => loading.promise, check: () => true } }), original = image(h);
  const stroke = h.brush.createFreeImageBrush(2, [{ x: 3, y: 3 }, { x: 9, y: 9 }], 20, 12);
  const brush = { ...region('brush', stroke.box, ''), ...stroke, erase: true, background: '#234567' };
  const text = { ...region('font', { x: 14, y: 1, width: 4, height: 4 }, 'A'), fontFamily: 'gmarket', fontSize: 1 };
  const pending = h.client.renderFreeImageTranslation(original, [brush, text], new AbortController().signal);
  await new Promise(resolve => setImmediate(resolve)); assert.equal(h.canvases.length, 1);
  brush.brush.points[0].x = 15; brush.id = 'changed-brush'; brush.background = '#ffffff';
  brush.box = { x: 0, y: 0, width: 20, height: 12 }; brush.translated = '검토하지 않은 문구'; brush.text = 'changed original';
  brush.erase = mutation !== 'brush-as-text'; brush.fontSize = 200;
  if (mutation === 'text-as-erase') {
    text.id = 'changed-text'; text.background = '#ff00ff'; text.foreground = '#0000ff'; text.translated = '검토하지 않은 번역';
    text.text = 'unreviewed source'; text.fontSize = 200; text.erase = true; text.selected = false;
    text.box = { x: 0, y: 0, width: 20, height: 12 };
  }
  loading.resolve([{}]); const rendered = await pending, bytes = new Uint8Array(await rendered.output.arrayBuffer());
  assert.deepEqual(Array.from(bytes.slice((3 * 20 + 3) * 4, (3 * 20 + 4) * 4)), [0x23, 0x45, 0x67, 255]);
  assert.deepEqual(h.operations.filter(value => value[0] === 'stroke')[0][1], [{ x: 3, y: 3 }, { x: 9, y: 9 }]);
  assert.deepEqual(h.operations.filter(value => value[0] === 'fill'), [['fill', 14, 1, 4, 4]], 'the original text rectangle alone is filled');
  assert.deepEqual(h.operations.filter(value => value[0] === 'text'), [['text', 'A', 14, 1, '1px "Gmarket Sans", sans-serif', 'left']]);
  const before = pixels(20, 12);
  for (let y = 0; y < 12; y++) for (let x = 0; x < 20; x++) if (!(x >= 2 && x < 10 && y >= 2 && y < 10) && !(x >= 14 && x < 18 && y >= 1 && y < 5)) {
    const offset = (y * 20 + x) * 4; assert.deepEqual(bytes.slice(offset, offset + 4), before.slice(offset, offset + 4), `outside reviewed regions ${mutation}: ${x},${y}`);
  }
  assert.equal(rendered.source, source); assert.deepEqual(original.canvas.pixels, pixels(20, 12));
  }
});

test('brush selection and layer order preserve other text, while false erase, wrong bounds, duplicate IDs and oversized point budgets fail before painting', async () => {
  const h = fixture(), original = image(h), dot = h.brush.createFreeImageBrush(4, [{ x: 3, y: 3 }], 20, 12);
  const brush = { ...region('brush', dot.box, ''), ...dot, erase: true, background: '#234567' };
  const text = { ...region('text', { x: 3, y: 3, width: 8, height: 6 }, 'A'), fontSize: 2, foreground: '#cc1122' };
  const render = async rows => new Uint8Array(await (await h.client.renderFreeImageTranslation(original, rows, new AbortController().signal)).output.arrayBuffer());
  const pixel = data => Array.from(data.slice((3 * 20 + 3) * 4, (3 * 20 + 4) * 4));
  assert.deepEqual(pixel(await render([text, brush])), [0x23, 0x45, 0x67, 255]);
  assert.deepEqual(pixel(await render([brush, text])), [0xcc, 0x11, 0x22, 255]);
  assert.deepEqual(await render([text, { ...brush, selected: false }]), await render([text]));
  for (const changed of [{ erase: false, translated: 'A' }, { erase: undefined, translated: 'A' }, { brush: null },
    { box: { ...brush.box, width: brush.box.width + 1 } }, { brush: { ...brush.brush, extra: true } }, { brush: { size: 201, points: [{ x: 3, y: 3 }] } }]) {
    const created = h.canvases.length; await assert.rejects(render([{ ...brush, ...changed }])); assert.equal(h.canvases.length, created);
  }
  await assert.rejects(render([brush, { ...text, id: brush.id }]));
  const stopped = new AbortController(); stopped.abort(); const created = h.canvases.length;
  await assert.rejects(h.client.renderFreeImageTranslation(original, [brush], stopped.signal)); assert.equal(h.canvases.length, created);
  const maximum = Array.from({ length: 4 }, (_, index) => ({ ...brush, id: 'large-' + index, brush: { size: 4, points: Array.from({ length: 2048 }, () => ({ x: 3, y: 3 })) } }));
  await render(maximum); const capacity = h.canvases.length;
  await assert.rejects(render([...maximum, { ...brush, id: 'overflow' }])); assert.equal(h.canvases.length, capacity);
  await render([...maximum, { ...brush, id: 'ignored-overflow', selected: false }]);
  assert.deepEqual(original.canvas.pixels, pixels(20, 12));
});

test('unset text style keeps the original pixels, font string, left anchor and 1.2 line spacing', async () => {
  const outputs = [];
  for (const style of [{}, { fontFamily: 'sans', bold: false, italic: false, textAlign: 'left', lineHeight: 1.2 }]) {
    const h = fixture(), original = image(h), chosen = { ...region('default', { x: 3, y: 2, width: 8, height: 6 }, 'A\nB'), fontSize: 2, ...style };
    const rendered = await h.client.renderFreeImageTranslation(original, [chosen], new AbortController().signal);
    assert.deepEqual(h.operations.filter(operation => operation[0] === 'text'),
      [['text', 'A', 3, 2, '2px Arial, "Noto Sans KR", sans-serif', 'left'], ['text', 'B', 3, 4.4, '2px Arial, "Noto Sans KR", sans-serif', 'left']]);
    const expected = original.canvas.pixels.slice();
    for (let y = 2; y < 8; y++) for (let x = 3; x < 11; x++) expected.set([255, 255, 255, 255], (y * 20 + x) * 4);
    for (const y of [2, 4, 5]) expected.set([0, 0, 0, 255], (y * 20 + 3) * 4);
    const bytes = new Uint8Array(await rendered.output.arrayBuffer()); assert.deepEqual(bytes, expected);
    outputs.push(bytes); assert.equal(rendered.source, source);
  }
  assert.deepEqual(outputs[0], outputs[1]);
});

test('text style validation rejects malformed selected styles before creating any output canvas and erase leaves unused styles intact', async () => {
  const h = fixture(), original = image(h), chosen = region('valid', { x: 3, y: 2, width: 8, height: 6 });
  for (const bad of [{ fontFamily: null }, { fontFamily: 'Sans' }, { fontFamily: '__proto__' }, { fontFamily: 'url(https://foreign.test/font)' },
    { bold: 1 }, { bold: 'true' }, { italic: null }, { italic: 'false' }, { textAlign: null }, { textAlign: 'start' },
    { lineHeight: null }, { lineHeight: '1.2' }, { lineHeight: 0.79 }, { lineHeight: 3.01 }, { lineHeight: NaN }, { lineHeight: Infinity }]) {
    await assert.rejects(h.client.renderFreeImageTranslation(original, [chosen, { ...chosen, id: 'invalid', ...bad }], new AbortController().signal));
    assert.equal(h.canvases.length, 1, 'invalid styles cannot start painting even when a valid row comes first');
    assert.equal(h.operations.length, 0);
  }
  await assert.rejects(h.client.renderFreeImageTranslation(original, [{ ...chosen, translated: '', bold: true }], new AbortController().signal));
  const erased = { ...chosen, erase: true, translated: '보존한 번역', fontFamily: 'retained-unrecognized', bold: 'retained', italic: null, textAlign: 'start', lineHeight: NaN };
  await h.client.renderFreeImageTranslation(original, [erased], new AbortController().signal);
  assert.equal(h.measurements.length, 0); assert.equal(h.operations.filter(value => value[0] === 'text').length, 0);
  assert.equal(erased.translated, '보존한 번역'); assert.equal(erased.fontFamily, 'retained-unrecognized'); assert.ok(Number.isNaN(erased.lineHeight));
  await assert.rejects(h.client.renderFreeImageTranslation(original, [{ ...erased, erase: false }], new AbortController().signal));
  let fontLoads = 0;
  const fontFixture = fixture({ fonts: { load: async () => { fontLoads++; return [{}]; }, check: () => true } }), fontImage = image(fontFixture);
  await assert.rejects(fontFixture.client.renderFreeImageTranslation(fontImage,
    [{ ...chosen, fontFamily: 'gmarket' }, { ...chosen, id: 'invalid-after-font', bold: 'true' }], new AbortController().signal));
  assert.equal(fontLoads, 0, 'every selected style is validated before starting font loading'); assert.equal(fontFixture.canvases.length, 1);
});

test('styled text fits using bold/italic widths and line spacing, and tight spacing leaves room for the last glyph', async () => {
  for (const [style, expectedFont, expectedLines] of [[{}, 4, ['ABCD']], [{ bold: true, italic: true }, 3, ['ABC', 'D']],
    [{ bold: true, italic: true, lineHeight: 3 }, 2, ['ABCD']]]) {
    const h = fixture(), original = image(h), chosen = { ...region('fit', { x: 3, y: 2, width: 8, height: 8 }, 'ABCD'), fontSize: 8, ...style };
    await h.client.renderFreeImageTranslation(original, [chosen], new AbortController().signal);
    const written = h.operations.filter(value => value[0] === 'text');
    assert.deepEqual(written.map(value => value[1]), expectedLines);
    assert.ok(written.every(value => value[4].includes(`${expectedFont}px `)));
    assert.ok(h.measurements.some(value => value.font.includes('8px ')), 'font fitting starts from the reviewed size');
    assert.ok(h.measurements.some(value => value.font.includes(`${expectedFont}px `)), 'final font is measured before drawing');
  }
  for (const [translated, expectedFont] of [['A', 8], ['A\nB', 4]]) {
    const h = fixture(), original = image(h), chosen = { ...region('tight', { x: 1, y: 1, width: 18, height: 10 }, translated), fontSize: 20, lineHeight: 0.8 };
    await h.client.renderFreeImageTranslation(original, [chosen], new AbortController().signal);
    const written = h.operations.filter(value => value[0] === 'text');
    assert.ok(written.every(value => value[4] === `${expectedFont}px Arial, "Noto Sans KR", sans-serif`));
    assert.ok(written.at(-1)[3] + expectedFont <= chosen.box.y + chosen.box.height - 1, 'last glyph fits above the bottom padding');
  }
});

test('Gmarket waits for the exact font before any canvas/measurement and loads identical styles only once', async () => {
  const waiting = deferred(), loads = [], checks = []; let available = false;
  const h = fixture({ fonts: { load(descriptor, sample) { loads.push({ descriptor, sample }); return waiting.promise; },
    check(descriptor, sample) { checks.push({ descriptor, sample }); return available; } } }), original = image(h);
  const chosen = { ...region('gmarket', { x: 1, y: 1, width: 8, height: 6 }, 'A'), fontFamily: 'gmarket', bold: true, italic: true };
  const pending = h.client.renderFreeImageTranslation(original, [chosen, { ...chosen, id: 'same-font', box: { x: 10, y: 1, width: 8, height: 6 } },
    { ...chosen, id: 'erase-font', erase: true, bold: false, italic: false }], new AbortController().signal);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.canvases.length, 1, 'no output canvas until requested font is loaded'); assert.equal(h.measurements.length, 0); assert.equal(h.operations.length, 0);
  assert.deepEqual(loads, [{ descriptor: 'italic bold 20px "Gmarket Sans"', sample: '가나다 ABC 123' }]);
  available = true; waiting.resolve([{ family: 'Gmarket Sans', status: 'loaded' }]); const rendered = await pending;
  assert.equal(loads.length, 1, 'same font weight/style loads once despite multiple regions'); assert.deepEqual(checks, loads);
  assert.equal(h.operations.filter(value => value[0] === 'text').length, 2);
  assert.ok(h.measurements.every(value => value.font === 'italic bold 3px "Gmarket Sans", sans-serif'));
  assert.equal(rendered.source, source); assert.equal(rendered.output.type, 'image/png');
});

test('Gmarket cancellation and unverified/unavailable fonts cannot draw fallback PNGs, while erase needs no text font', async () => {
  const chosen = { ...region('gmarket', { x: 3, y: 2, width: 8, height: 6 }, 'A'), fontFamily: 'gmarket' };
  const delayed = deferred(), stopped = new AbortController(), h = fixture({ fonts: { load: () => delayed.promise, check: () => true } }), original = image(h);
  const pending = h.client.renderFreeImageTranslation(original, [chosen], stopped.signal); await new Promise(resolve => setImmediate(resolve));
  stopped.abort(); await assert.rejects(pending); delayed.resolve([{ family: 'Gmarket Sans', status: 'loaded' }]); await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.canvases.length, 1); assert.equal(h.measurements.length, 0); assert.equal(h.operations.length, 0);
  for (const fonts of [undefined, { load: async () => [], check: () => true }, { load: async () => [{}], check: () => false },
    { load: async () => { throw Error('font unavailable'); }, check: () => true }]) {
    const failed = fixture({ fonts }), loaded = image(failed);
    await assert.rejects(failed.client.renderFreeImageTranslation(loaded, [chosen], new AbortController().signal), /글꼴|Gmarket/u);
    assert.equal(failed.canvases.length, 1); assert.equal(failed.operations.length, 0); assert.equal(failed.measurements.length, 0);
  }
  const erased = fixture(), loaded = image(erased); await erased.client.renderFreeImageTranslation(loaded, [{ ...chosen, erase: true }], new AbortController().signal);
  assert.equal(erased.measurements.length, 0); assert.equal(erased.operations.filter(value => value[0] === 'text').length, 0);
  assert.equal(chosen.translated, 'A'); assert.equal(chosen.fontFamily, 'gmarket');
});

test('Gmarket normal, bold and italic variants each verify their own font before drawing while repeated variants reuse the check', async () => {
  const loads = [], h = fixture({ fonts: { load: async descriptor => { loads.push(descriptor); return [{}]; }, check: () => true } }), original = image(h);
  const chosen = { ...region('normal', { x: 3, y: 2, width: 8, height: 6 }, 'A'), fontFamily: 'gmarket' };
  await h.client.renderFreeImageTranslation(original, [chosen, { ...chosen, id: 'bold', bold: true }, { ...chosen, id: 'italic', italic: true },
    { ...chosen, id: 'repeat-bold', bold: true }, { ...chosen, id: 'erased-variant', erase: true, bold: true, italic: true }], new AbortController().signal);
  assert.deepEqual(loads, ['20px "Gmarket Sans"', 'bold 20px "Gmarket Sans"', 'italic 20px "Gmarket Sans"']);
  assert.deepEqual(h.operations.filter(value => value[0] === 'text').map(value => value[4]),
    ['3px "Gmarket Sans", sans-serif', 'bold 3px "Gmarket Sans", sans-serif', 'italic 3px "Gmarket Sans", sans-serif', 'bold 3px "Gmarket Sans", sans-serif']);
});

test('styled text uses its chosen font before fitting and keeps center/right anchors inside the selected clip', async () => {
  for (const [fontFamily, css] of [['sans', 'Arial, "Noto Sans KR", sans-serif'], ['serif', 'Georgia, "Noto Serif KR", serif'], ['mono', '"Courier New", monospace'], ['gmarket', '"Gmarket Sans", sans-serif']]) {
    for (const [textAlign, anchor] of [['left', 4], ['center', 9], ['right', 14]]) {
      const h = fixture({ fonts: { load: async () => [{}], check: () => true } }), original = image(h), before = original.canvas.pixels.slice();
      const chosen = { ...region('style', { x: 3, y: 1, width: 12, height: 10 }, 'AB\nCD'), fontSize: 4,
        fontFamily, bold: true, italic: true, textAlign, lineHeight: 0.8 };
      const rendered = await h.client.renderFreeImageTranslation(original, [chosen], new AbortController().signal);
      const after = new Uint8Array(await rendered.output.arrayBuffer()), text = h.operations.filter(operation => operation[0] === 'text');
      assert.deepEqual(text.map(operation => [operation[1], operation[2], operation[3], operation[4], operation[5]]),
        [['AB', anchor, 2, `italic bold 4px ${css}`, textAlign], ['CD', anchor, 5.2, `italic bold 4px ${css}`, textAlign]]);
      assert.ok(h.measurements.length); assert.ok(h.measurements.every(value => value.font === `italic bold 4px ${css}`), 'wrapping and fitting measure the selected font');
      for (let y = 0; y < 12; y++) for (let x = 0; x < 20; x++) if (!(x >= 3 && x < 15 && y >= 1 && y < 11)) {
        const offset = (y * 20 + x) * 4; assert.deepEqual(after.slice(offset, offset + 4), before.slice(offset, offset + 4), `outside ${fontFamily}/${textAlign}: ${x},${y}`);
      }
      assert.deepEqual(original.canvas.pixels, before); assert.equal(rendered.source, source);
    }
  }
});

test('explicit erase renders only the chosen background rectangle without text or outside pixel changes', async () => {
  const h = fixture(), original = image(h), before = original.canvas.pixels.slice();
  const cleared = { ...region('erase', { x: 3, y: 2, width: 8, height: 6 }, ''), text: '', erase: true, background: '#234567' };
  const ignored = { ...region('ignored', { x: 14, y: 1, width: 4, height: 4 }, ''), selected: false, erase: true };
  const rendered = await h.client.renderFreeImageTranslation(original, [cleared, ignored], new AbortController().signal);
  const after = new Uint8Array(await rendered.output.arrayBuffer());
  for (let y = 0; y < 12; y++) for (let x = 0; x < 20; x++) {
    const offset = (y * 20 + x) * 4, inside = x >= 3 && x < 11 && y >= 2 && y < 8;
    assert.deepEqual(after.slice(offset, offset + 4), inside ? Uint8Array.of(0x23, 0x45, 0x67, 255) : before.slice(offset, offset + 4), `pixel ${x},${y}`);
  }
  assert.deepEqual(h.operations.filter(operation => operation[0] === 'fill'), [['fill', 3, 2, 8, 6]]);
  assert.equal(h.operations.filter(operation => operation[0] === 'text').length, 0);
  assert.deepEqual(original.canvas.pixels, before); assert.equal(rendered.source, source);
  assert.equal(rendered.width, original.width); assert.equal(rendered.height, original.height);
});

test('mixed erase and text preserve retained wording and require explicit boolean mode with the same geometry bounds', async () => {
  const h = fixture(), original = image(h), before = original.canvas.pixels.slice();
  const cleared = { ...region('erase', { x: 1, y: 1, width: 5, height: 5 }, '보존한 문구'), erase: true, background: '#abcdef' };
  const written = region('text', { x: 10, y: 2, width: 8, height: 7 }, '문구');
  const rendered = await h.client.renderFreeImageTranslation(original, [cleared, written], new AbortController().signal);
  const after = new Uint8Array(await rendered.output.arrayBuffer());
  assert.deepEqual(h.operations.filter(operation => operation[0] === 'text').map(operation => operation[1]), ['문구']);
  for (let y = 0; y < 12; y++) for (let x = 0; x < 20; x++) {
    const offset = (y * 20 + x) * 4, erased = x >= 1 && x < 6 && y >= 1 && y < 6, text = x >= 10 && x < 18 && y >= 2 && y < 9;
    if (erased) assert.deepEqual(after.slice(offset, offset + 4), Uint8Array.of(0xab, 0xcd, 0xef, 255));
    else if (!text) assert.deepEqual(after.slice(offset, offset + 4), before.slice(offset, offset + 4));
  }
  assert.equal(cleared.translated, '보존한 문구'); assert.deepEqual(original.canvas.pixels, before);
  h.operations.length = 0;
  await h.client.renderFreeImageTranslation(original, [{ ...cleared, erase: false }], new AbortController().signal);
  assert.equal(h.operations.some(operation => operation[0] === 'text'), true, 'turning erase off uses retained wording');
  for (const patch of [{ erase: 'true' }, { erase: 1 }, { erase: null }, { id: 'bad/id' }, { background: '#fff' },
    { box: { x: 19, y: 1, width: 5, height: 5 } }]) {
    await assert.rejects(h.client.renderFreeImageTranslation(original, [{ ...cleared, ...patch }], new AbortController().signal));
  }
  for (const erase of [undefined, false]) await assert.rejects(h.client.renderFreeImageTranslation(original,
    [{ ...written, erase, translated: '' }], new AbortController().signal), 'normal text cannot be blank');
  await assert.rejects(h.client.renderFreeImageTranslation(original, [cleared, { ...written, id: cleared.id }], new AbortController().signal));
  await assert.rejects(h.client.renderFreeImageTranslation(original, [{ ...cleared, erase: false, translated: 'bad\u0000text' }], new AbortController().signal));
  await assert.rejects(h.client.renderFreeImageTranslation(original, Array.from({ length: 101 }, (_, i) => ({ ...cleared, id: 'erase-' + i })), new AbortController().signal));
  const stopped = new AbortController(); stopped.abort(); await assert.rejects(h.client.renderFreeImageTranslation(original, [cleared], stopped.signal));
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
