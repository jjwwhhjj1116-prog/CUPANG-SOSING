import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

function load(file) {
  const source = ts.transpileModule(fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports = {};
  vm.runInNewContext(source, { exports, require(name) { if (name.startsWith('@/')) return load(`${name.slice(2)}.ts`); throw Error(name); } });
  return exports;
}
const model = load('app/product-options.ts'); const tools = load('app/option-editor-tools.ts');
const policy = { exchangeRate: 100, supplyMargin: 0, coupangMargin: 0, minimumMargin: 0, msrpMultiple: 1, roundingUnit: 10 };
const row = (id, extra = {}) => ({ ...model.emptyOptionInput(id), originalName: `原文-${id}`, translatedName: `옵션 ${id}`, supplierSku: `SKU-${id}`, unitCostCny: 0.1, unitsPerPack: 1, widthCm: 10, imageKey: 'owner/image.png', included: true, ...extra });

test('bulk quantity preview changes only chosen rows and recalculates actual supply price without mutating input', () => {
  const rows = [row('a'), row('b')]; const original = JSON.stringify(rows);
  const preview = tools.previewOptionBulk(rows, ['b'], { type: 'unitsPerPack', value: 3 }, policy);
  assert.equal(JSON.stringify(rows), original); assert.equal(preview.rows[0].unitsPerPack, 1); assert.equal(preview.rows[1].unitsPerPack, 3);
  assert.equal(preview.changes[0].beforePrice, 10); assert.equal(preview.changes[0].afterPrice, 30);
  assert.equal(preview.rows[1].supplierSku, 'SKU-b'); assert.equal(preview.rows[1].widthCm, 10); assert.equal(preview.rows[1].imageKey, 'owner/image.png');
  const applied = tools.applyOptionBulk(rows, preview); assert.equal(applied[1].unitsPerPack, 3); assert.notEqual(applied, preview.rows);
});

test('stale previews cannot overwrite subsequent edits or reordered options', () => {
  const rows = [row('a'), row('b')]; const preview = tools.previewOptionBulk(rows, ['a'], { type: 'unitCostCny', value: 12.5 }, policy);
  assert.throws(() => tools.applyOptionBulk([{ ...rows[0], translatedName: '이후 수정' }, rows[1]], preview), /미리보기/);
  assert.throws(() => tools.applyOptionBulk([...rows].reverse(), preview), /미리보기/);
  assert.equal(rows[0].unitCostCny, 0.1);
});

test('include/exclude/remove previews preserve facts, expose missing-cost calculation errors and permit cancellation without writes', () => {
  const rows = [row('a', { included: false, unitCostCny: null }), row('b')];
  const include = tools.previewOptionBulk(rows, ['a'], { type: 'include' }, policy);
  assert.equal(include.rows[0].included, true); assert.equal(include.rows[0].unitCostCny, null); assert.ok(include.changes[0].error);
  const exclude = tools.previewOptionBulk(rows, ['b'], { type: 'exclude' }, policy);
  assert.equal(exclude.rows[1].included, false); assert.equal(exclude.rows[1].supplierSku, 'SKU-b'); assert.equal(exclude.changes[0].afterPrice, null);
  const remove = tools.previewOptionBulk(rows, ['a'], { type: 'remove' }, policy);
  assert.deepEqual(Array.from(remove.rows, item => item.id), ['b']); assert.equal(remove.changes[0].after, null);
  assert.equal(rows.length, 2); assert.equal(rows[0].included, false);
});

test('batch numbers and selections are validated rather than accepting invalid bulk changes', () => {
  const rows = [row('a')];
  for (const action of [{ type: 'unitsPerPack', value: 0 }, { type: 'unitsPerPack', value: 1.5 }, { type: 'unitsPerPack', value: 1000001 }, { type: 'unitCostCny', value: 0 }, { type: 'unitCostCny', value: NaN }, { type: 'unitCostCny', value: Infinity }]) assert.throws(() => tools.previewOptionBulk(rows, ['a'], action, policy));
  for (const selected of [[], ['missing'], ['a', 'a']]) assert.throws(() => tools.previewOptionBulk(rows, selected, { type: 'include' }, policy));
});

test('reordering preserves row identity and duplication keeps facts but clears the unique supplier SKU and inclusion', () => {
  const rows = [row('a'), row('b'), row('c')];
  assert.deepEqual(Array.from(tools.moveOption(rows, 'b', -1), item => item.id), ['b', 'a', 'c']);
  assert.equal(tools.moveOption(rows, 'a', -1)[0], rows[0]); assert.equal(rows[0].id, 'a');
  const copied = tools.duplicateOption(rows, 'b', 'copy');
  assert.deepEqual(Array.from(copied, item => item.id), ['a', 'b', 'copy', 'c']); assert.equal(copied[2].supplierSku, ''); assert.equal(copied[2].included, false);
  for (const key of ['originalName', 'translatedName', 'unitCostCny', 'unitsPerPack', 'widthCm', 'imageKey']) assert.equal(copied[2][key], rows[1][key]);
  assert.throws(() => tools.duplicateOption(rows, 'b', 'a'));
});

test('asset list displays saved role order, supports assigned/unassigned filters and excludes unavailable references', () => {
  const assets = { main: ['m'], additional: ['b', 'a'], detail: ['d', 'missing'], size: [], label: [] };
  assert.deepEqual(Array.from(tools.orderedEditorImages(['a', 'b', 'm', 'unused', 'd'], assets, 'all')), ['m', 'b', 'a', 'd', 'unused']);
  assert.deepEqual(Array.from(tools.orderedEditorImages(['a', 'b', 'm', 'unused', 'd'], assets, 'additional')), ['b', 'a']);
  assert.deepEqual(Array.from(tools.orderedEditorImages(['a', 'b', 'm', 'unused', 'd'], assets, 'unassigned')), ['unused']);
  assets.additional.reverse(); assert.deepEqual(Array.from(tools.orderedEditorImages(['a', 'b'], assets, 'additional')), ['a', 'b']);
});
