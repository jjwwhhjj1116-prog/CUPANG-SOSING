import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const cache = new Map();
function load(file) {
  if (cache.has(file)) return cache.get(file); const exports = {}; cache.set(file, exports);
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../' + file, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { exports, require(name) { assert.ok(name.startsWith('@/')); return load(name.slice(2) + '.ts'); } });
  return exports;
}
const { createFreeImageBrush: create, validateFreeImageBrush: validate, MAX_FREE_IMAGE_BRUSH_POINTS: limit,
  MAX_FREE_IMAGE_BRUSH_TOTAL_POINTS: total } = load('app/free-image-brush.ts');
const plain = value => JSON.parse(JSON.stringify(value));

test('completed strokes dedupe only consecutive idle moves and own their points and exact clipped radius bounds', () => {
  const points = [{ x: 1, y: 1 }, { x: 1, y: 1 }, { x: 5, y: 3 }, { x: 1, y: 1 }], before = plain(points);
  const result = create(2, points, 9, 7);
  assert.deepEqual(plain(result), { brush: { size: 2, points: [{ x: 1, y: 1 }, { x: 5, y: 3 }, { x: 1, y: 1 }] }, box: { x: 0, y: 0, width: 6, height: 4 } });
  assert.deepEqual(points, before); assert.notEqual(result.brush.points[0], points[0]);
  points[0].x = 8; assert.equal(result.brush.points[0].x, 1);
  const raw = { size: 2, points: [{ x: 1, y: 1 }, { x: 1, y: 1 }, { x: 5, y: 3 }] }, accepted = validate(raw, result.box, 9, 7);
  assert.equal(accepted.brush.points.length, 3, 'validation does not normalize an existing path');
  accepted.brush.points[0].y = 6; assert.equal(raw.points[0].y, 1); assert.notEqual(accepted.box, result.box);
});

test('single dots and large diameters keep positive exact boxes at every image edge including a 1x1 source', () => {
  for (const [size, point, width, height, box] of [[1, { x: 0, y: 0 }, 9, 7, { x: 0, y: 0, width: 1, height: 1 }],
    [3, { x: 0, y: 0 }, 9, 7, { x: 0, y: 0, width: 2, height: 2 }],
    [4, { x: 8, y: 6 }, 9, 7, { x: 6, y: 4, width: 3, height: 3 }],
    [200, { x: 0, y: 0 }, 1, 1, { x: 0, y: 0, width: 1, height: 1 }]]) {
    const created = create(size, [point], width, height); assert.deepEqual(plain(created.box), box);
    assert.deepEqual(plain(validate(created.brush, box, width, height)), plain(created));
  }
});

test('brush sizes, points, dimension/point limits and exact object/box shapes reject malformed or unrelated data', () => {
  for (const size of [0, 201, 1.5, NaN, Infinity, '2', null]) assert.throws(() => create(size, [{ x: 1, y: 1 }], 9, 7));
  for (const points of [[], new Array(2), [{ x: 9, y: 1 }], [{ x: 1, y: 7 }], [{ x: -1, y: 1 }], [{ x: 1.5, y: 1 }],
    [{ x: NaN, y: 1 }], [{ x: 1, y: Infinity }], [{ x: '1', y: 1 }], [{ x: 1, y: 1, extra: true }], [null], [[1, 1]],
    Array.from({ length: 2049 }, () => ({ x: 1, y: 1 }))]) assert.throws(() => create(2, points, 9, 7));
  for (const [width, height] of [[0, 7], [9, 0], [1.5, 7], [16001, 1], [1, 16001], [4000, 4000]]) assert.throws(() => create(2, [{ x: 0, y: 0 }], width, height));
  const valid = create(2, [{ x: 1, y: 1 }], 9, 7);
  for (const brush of [null, [], { ...valid.brush, extra: true }, { size: 2 }, { ...valid.brush, size: '2' }]) assert.throws(() => validate(brush, valid.box, 9, 7));
  for (const box of [null, { ...valid.box, x: 1 }, { ...valid.box, width: 3 }, { ...valid.box, height: '2' }, { ...valid.box, extra: true }]) assert.throws(() => validate(valid.brush, box, 9, 7));
  assert.equal(limit, 2048); assert.equal(total, 8192);
  const maximum = create(200, Array.from({ length: limit }, (_, i) => ({ x: i % 100, y: Math.floor(i / 100) })), 100, 100);
  assert.equal(maximum.brush.points.length, limit); assert.deepEqual(plain(maximum.box), { x: 0, y: 0, width: 100, height: 100 });
});
