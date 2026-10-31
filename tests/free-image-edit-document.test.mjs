import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {createHash} from 'node:crypto';

const modules = new Map();
function load(file) {
  if (modules.has(file)) return modules.get(file);
  assert.notEqual(file, 'app/free-image-translation-client.ts', 'the pure validator must not load the browser client at runtime');
  const exports = {}; modules.set(file, exports);
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../' + file, import.meta.url), 'utf8'), {
    fileName: file, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { exports, TextEncoder, require(name) {
    assert.ok(name.startsWith('@/'), 'pure document validation cannot fetch, render or load database modules');
    return load(name.slice(2) + '.ts');
  } });
  return exports;
}
const { validateFreeImageEditDocument: validate, MAX_FREE_IMAGE_EDIT_BYTES: byteLimit } = load('app/free-image-edit-document.ts');
const { createFreeImageBrush: brush } = load('app/free-image-brush.ts');
const plain = value => JSON.parse(JSON.stringify(value));
const bytes = value => new TextEncoder().encode(JSON.stringify(value)).byteLength;
const source = { width: 800, height: 600 };
function region(id = 'manual-1', patch = {}) {
  return { id, text: '  原文\nsecond line  ', box: { x: 1, y: 2, width: 100, height: 50 }, confidence: 49.5, selected: true,
    translated: '  직접 입력\n다음 줄  ', issue: null, translationProvenance: 'manual', background: '#Ff00aA', foreground: '#111111', fontSize: 20, ...patch };
}
function document(patch = {}) {
  return { format: 'free-image-edit-v1', width: source.width, height: source.height, sourceLanguage: 'zh', regions: [region()], ...patch };
}
function frozen(value) {
  for (const child of Object.values(value)) if (child && typeof child === 'object') frozen(child);
  return Object.freeze(value);
}
function rejected(patch, sourceValue = source) { assert.throws(() => validate(document(patch), sourceValue)); }

test('restoration mode is versioned, hashed and optional; canonical legacy bytes remain unchanged',()=>{
  const legacy=document(),canonical=JSON.stringify(validate(legacy,source));
  assert.equal(canonical,JSON.stringify(legacy));assert.equal(Object.hasOwn(validate(legacy,source).regions[0],'backgroundMode'),false);
  const restored=document({regions:[region('manual-1',{backgroundMode:'inpaint-telea-v1'})]});
  const result=validate(restored,source);assert.deepEqual(plain(result),restored);
  const sha=text=>createHash('sha256').update(text).digest('hex');assert.notEqual(sha(JSON.stringify(result)),sha(canonical));
  for(const backgroundMode of ['flat','inpaint',true,null,1])rejected({regions:[region('invalid',{backgroundMode})]});
  rejected({regions:[region('brush',{erase:true,...brush(4,[{x:5,y:6}],800,600),backgroundMode:'inpaint-telea-v1'})]});
});

test('full editable document preserves paint order, manual blanks, unselected text, whitespace and optional absence in an independent clone', () => {
  const drawing = brush(4, [{ x: 5, y: 6 }, { x: 5, y: 6 }, { x: 20, y: 15 }], 800, 600);
  drawing.brush.points.splice(1, 0, { x: 5, y: 6 });
  const input = document({ regions: [region('top', { selected: false, translated: '', translationProvenance: 'manual', issue: '' }),
    region('bottom', { ...drawing, erase: true, text: '', translated: '', selected: true })],
    crop: { x: 5, y: 4, width: 200, height: 100, sourceWidth: 800, sourceHeight: 600 } });
  const before = JSON.stringify(input); frozen(input);
  const result = validate(input, source);
  assert.deepEqual(plain(result), plain(input)); assert.equal(JSON.stringify(input), before);
  assert.notEqual(result, input); assert.notEqual(result.regions, input.regions); assert.notEqual(result.regions[0], input.regions[0]);
  assert.notEqual(result.regions[0].box, input.regions[0].box); assert.notEqual(result.crop, input.crop);
  assert.notEqual(result.regions[1].brush, input.regions[1].brush); assert.notEqual(result.regions[1].brush.points[0], input.regions[1].brush.points[0]);
  assert.deepEqual(plain(result.regions.map(item => item.id)), ['top', 'bottom']); assert.equal(result.regions[1].brush.points.length, 3);
  assert.ok(!Object.hasOwn(result.regions[0], 'fontFamily')); assert.equal(result.regions[0].translated, '');
  result.regions[1].brush.points[0].x = 100; result.regions[0].box.y = 99; result.crop.x = 8;
  assert.equal(JSON.stringify(input), before);
});

test('canonical property order is independent of incoming object order while region and point order remains exact', () => {
  const input = document({ regions: [region('A', { fontFamily: 'gmarket', italic: false, bold: true, textAlign: 'right', lineHeight: 1.7, erase: false })],
    crop: { x: 0, y: 0, width: 800, height: 600, sourceWidth: 800, sourceHeight: 600 } });
  const reversed = value => Array.isArray(value) ? value.map(reversed) : value && typeof value === 'object'
    ? Object.fromEntries(Object.entries(value).reverse().map(([key, child]) => [key, reversed(child)])) : value;
  assert.equal(JSON.stringify(validate(input, source)), JSON.stringify(validate(reversed(input), source)));
  assert.deepEqual(Object.keys(validate(input, source)), ['format', 'width', 'height', 'sourceLanguage', 'regions', 'crop']);
});

test('a rotated decoded canvas and its crop use document coordinates, never the raw orientation or final crop dimensions', () => {
  const input = document({ width: 600, height: 800, regions: [region('edge', { box: { x: 590, y: 790, width: 10, height: 10 } })],
    crop: { x: 580, y: 780, width: 20, height: 20, sourceWidth: 600, sourceHeight: 800 } });
  assert.deepEqual(plain(validate(input, source)), input);
  rejected({ ...input, crop: { x: 0, y: 0, width: 20, height: 20, sourceWidth: 800, sourceHeight: 600 } });
  rejected({ ...input, crop: { ...input.crop, x: 581 } });
  rejected({ ...input, width: 20, height: 20 });
  rejected({ ...input, regions: [region('edge', { box: { x: 600, y: 0, width: 1, height: 1 } })] });
});

test('empty and crop-only documents are valid editable states without manufacturing regions or style defaults', () => {
  for (const sourceLanguage of ['zh', 'en']) {
    const input = document({ sourceLanguage, regions: [] }); assert.deepEqual(plain(validate(input, source)), input);
    input.crop = { x: 0, y: 0, width: 1, height: 1, sourceWidth: 800, sourceHeight: 600 };
    assert.deepEqual(plain(validate(input, source)), input);
  }
});

test('source and canvas limits are exact at twelve million pixels, sixteen thousand per side and matching raw or rotated dimensions', () => {
  for (const [width, height] of [[4000, 3000], [3000, 4000], [16000, 1], [1, 16000], [1, 1]]) {
    const input = document({ width, height, regions: [] }); assert.equal(validate(input, { width, height }).width, width);
    assert.equal(validate(input, { width: height, height: width }).height, height);
  }
  for (const [width, height] of [[0, 1], [1, 0], [16001, 1], [1, 16001], [4000, 3001], [1.5, 2], [NaN, 1], [Infinity, 1], ['800', 600]]) {
    rejected({ width, height, regions: [] }, { width, height }); rejected({}, { width, height });
  }
  for (const value of [null, undefined, {}, { width: 800 }, []]) assert.throws(() => validate(document(), value));
  rejected({ width: 799 }); rejected({ height: 599 });
});

test('every region is checked even when unselected or erase-only; boolean and provenance coercion is refused', () => {
  for (const patch of [{ text: 1 }, { translated: null }, { issue: false }, { confidence: -0.1 }, { confidence: 100.1 },
    { confidence: NaN }, { confidence: Infinity }, { confidence: '50' }, { selected: 1 }, { selected: 'false' },
    { translationProvenance: null }, { translationProvenance: 'translated' }, { translationProvenance: ['manual'] },
    { erase: 'true' }, { erase: null }, { background: 'white' }, { background: '#fff' }, { foreground: '#12345g' },
    { foreground: null }, { fontSize: 0 }, { fontSize: 201 }, { fontSize: 1.5 }, { fontSize: '20' }]) {
    rejected({ regions: [region('bad', { selected: false, ...patch })] });
    rejected({ regions: [region('bad', { erase: true, selected: false, ...patch })] });
  }
  for (const confidence of [0, 0.1, 50, 100]) assert.equal(validate(document({ regions: [region('ok', { confidence })] }), source).regions[0].confidence, confidence);
  for (const translationProvenance of ['empty', 'generated', 'manual']) {
    const row = region('empty', { text: '', translated: '', selected: false, translationProvenance });
    assert.equal(validate(document({ regions: [row] }), source).regions[0].translated, '');
  }
});

test('safe unique ids and the one hundred total region limit include unselected entries and reject sparse arrays', () => {
  const rows = Array.from({ length: 100 }, (_, index) => region('region_' + index, { text: '', translated: '', selected: false }));
  assert.equal(validate(document({ regions: rows }), source).regions.length, 100);
  rejected({ regions: [...rows, region('extra')] }); rejected({ regions: [region('same'), region('same', { selected: false })] });
  for (const id of ['', 'a'.repeat(81), '../other', '한글', 'a b', 'a\n', 3, null]) rejected({ regions: [region(id)] });
  assert.equal(validate(document({ regions: [region('a'.repeat(80))] }), source).regions[0].id.length, 80);
  rejected({ regions: new Array(1) }); rejected({ regions: [null] }); rejected({ regions: [true] }); rejected({ regions: {} });
});

test('text limits apply independently to all original and translated values, preserving exact newlines, blanks and whitespace', () => {
  const rows = Array.from({ length: 4 }, (_, index) => region('text-' + index, { text: '原'.repeat(5000), translated: '가'.repeat(5000), selected: false }));
  assert.equal(validate(document({ regions: rows }), source).regions.length, 4);
  rejected({ regions: [...rows, region('extra-original', { text: 'a', translated: '' })] });
  rejected({ regions: [...rows, region('extra-translation', { text: '', translated: 'a' })] });
  rejected({ regions: [region('long', { text: 'a'.repeat(5001) })] }); rejected({ regions: [region('long', { translated: 'a'.repeat(5001) })] });
  assert.equal(validate(document({ regions: [region('multiline', { text: ' \t\r\n ', translated: ' \t\r\n ' })] }), source).regions[0].text, ' \t\r\n ');
  for (const control of ['\u0000', '\u0008', '\u000b', '\u000c', '\u000e', '\u001f', '\u007f', '\u0085', '\u009f']) {
    for (const key of ['text', 'translated', 'issue']) rejected({ regions: [region('control', { [key]: 'keep' + control, selected: false })] });
  }
});

test('provider issue strings retain null/empty values and their existing two thousand character bound', () => {
  for (const issue of [null, '', '오류'.repeat(1000)]) assert.equal(validate(document({ regions: [region('issue', { issue })] }), source).regions[0].issue, issue);
  rejected({ regions: [region('issue', { issue: 'x'.repeat(2001) })] });
});

test('all font families, style boundaries and false options survive without conversion to resolved CSS', () => {
  for (const fontFamily of ['sans', 'serif', 'mono', 'gmarket']) for (const textAlign of ['left', 'center', 'right']) {
    const input = document({ regions: [region('styled', { fontFamily, bold: false, italic: true, textAlign, lineHeight: 0.8, fontSize: 1 }),
      region('maximum', { lineHeight: 3, fontSize: 200, erase: true, selected: false })] });
    assert.deepEqual(plain(validate(input, source)), input);
  }
  for (const patch of [{ fontFamily: 'Arial' }, { fontFamily: '__proto__' }, { fontFamily: null }, { bold: 1 }, { italic: 'false' },
    { textAlign: 'start' }, { lineHeight: 0.79 }, { lineHeight: 3.01 }, { lineHeight: NaN }, { lineHeight: Infinity }, { lineHeight: '1.2' }]) {
    rejected({ regions: [region('unselected-style', { ...patch, selected: false, erase: true })] });
  }
});

test('brush paths preserve duplicate positions and exact paint order while enforcing shared individual and aggregate caps across unselected regions', () => {
  const points = Array.from({ length: 2048 }, () => ({ x: 10, y: 10 }));
  const bounds = brush(4, [{ x: 10, y: 10 }], 800, 600).box;
  const rows = Array.from({ length: 4 }, (_, index) => region('brush-' + index, { erase: true, selected: false, text: '', translated: '',
    box: bounds, brush: { size: 4, points: plain(points) } }));
  const result = validate(document({ regions: rows }), source);
  assert.equal(result.regions.reduce((sum, item) => sum + item.brush.points.length, 0), 8192);
  assert.deepEqual(plain(result.regions[2].brush.points), points);
  rejected({ regions: [...rows, region('one-more', { erase: true, box: bounds, brush: { size: 4, points: [{ x: 10, y: 10 }] } })] });
  rejected({ regions: [region('too-long', { erase: true, box: bounds, brush: { size: 4, points: [...points, { x: 10, y: 10 }] } })] });
});

test('brush strict shapes, erase requirement, derived boxes and pixel bounds cannot be bypassed by deselection', () => {
  const drawing = brush(3, [{ x: 0, y: 0 }, { x: 799, y: 599 }], 800, 600);
  for (const patch of [{ erase: false }, { erase: undefined }, { box: { ...drawing.box, width: 799 } },
    { brush: null }, { brush: { ...drawing.brush, other: true } }, { brush: { size: 3, points: [] } },
    { brush: { size: 0, points: drawing.brush.points } }, { brush: { size: 3, points: [{ x: 800, y: 0 }] } },
    { brush: { size: 3, points: [{ x: 0, y: 0, other: true }] } }, { brush: { size: 3, points: new Array(1) } }]) {
    rejected({ regions: [region('bad-brush', { ...drawing, erase: true, selected: false, ...patch })] });
  }
});

test('unknown keys, missing required fields and non-object values are refused at every document depth', () => {
  for (const value of [null, undefined, true, [], 'document']) assert.throws(() => validate(value, source));
  rejected({ format: 'free-image-edit-v2' }); rejected({ sourceLanguage: 'ko' }); rejected({ sourceLanguage: null }); rejected({ extra: true });
  const base = document();
  for (const key of ['format', 'width', 'height', 'sourceLanguage', 'regions']) { const input = plain(base); delete input[key]; assert.throws(() => validate(input, source)); }
  for (const key of Object.keys(base.regions[0])) { const input = plain(base); delete input.regions[0][key]; assert.throws(() => validate(input, source)); }
  rejected({ regions: [region('extra', { other: true })] }); rejected({ regions: [region('box', { box: { x: 1, y: 2, width: 3, height: 4, other: true } })] });
  rejected({ crop: { x: 1, y: 2, width: 3, height: 4, sourceWidth: 800, sourceHeight: 600, other: true } });
  rejected({ crop: { x: 1, y: 2, width: 3, sourceWidth: 800, sourceHeight: 600 } });
  const symbolic = document(); symbolic[Symbol('unknown')] = 1; assert.throws(() => validate(symbolic, source));
  const arrayProperty = document(); arrayProperty.regions.other = true; assert.throws(() => validate(arrayProperty, source));
  const inherited = document(); inherited.regions = [Object.create(region())]; assert.throws(() => validate(inherited, source));
});

test('all rectangle coordinates are required integer pixels inside the original canvas regardless of selection', () => {
  for (const box of [null, [], { x: -1, y: 0, width: 1, height: 1 }, { x: 800, y: 0, width: 1, height: 1 },
    { x: 0, y: 600, width: 1, height: 1 }, { x: 799, y: 599, width: 2, height: 1 }, { x: 1.5, y: 0, width: 1, height: 1 },
    { x: 0, y: 0, width: 0, height: 1 }, { x: 0, y: 0, width: 1, height: NaN }, { x: 0, y: 0, width: '1', height: 1 },
    { x: 0, y: 0, width: 1 }, { y: 0, width: 1, height: 1 }]) rejected({ regions: [region('outside', { box, selected: false })] });
  const input = document({ regions: [region('last-pixel', { box: { x: 799, y: 599, width: 1, height: 1 } })] });
  assert.deepEqual(plain(validate(input, source)), input);
});

test('the exact 512KiB UTF-8 limit includes full unselected issue strings and rejects one additional byte', () => {
  assert.equal(byteLimit, 512 * 1024);
  const input = document({ regions: Array.from({ length: 100 }, (_, index) => region('bytes-' + index, { text: '', translated: '', issue: '', selected: false })) });
  let remaining = byteLimit - bytes(validate(input, source));
  for (const row of input.regions) {
    const korean = Math.min(2000, Math.floor(remaining / 3)); row.issue = '가'.repeat(korean); remaining -= korean * 3;
    const ascii = Math.min(2000 - korean, remaining); row.issue += 'a'.repeat(ascii); remaining -= ascii;
  }
  assert.equal(remaining, 0); assert.equal(bytes(input), byteLimit);
  const accepted = validate(input, source); assert.equal(bytes(accepted), byteLimit);
  input.regions.find(row => row.issue.length < 2000).issue += 'a';
  assert.equal(bytes(input), byteLimit + 1); assert.throws(() => validate(input, source), /512KB/u);
  assert.equal(bytes(accepted), byteLimit, 'rejected future edits cannot mutate the prior accepted document');
});
