import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';

const cache = new Map();
function load(file) {
  if (cache.has(file)) return cache.get(file);
  const exports = {}; cache.set(file, exports);
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../' + file, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { exports, Error, require(name) {
    if (name.startsWith('@/')) return load(name.slice(2) + '.ts');
    if (name.startsWith('.')) return load(path.posix.join(path.posix.dirname(file), name) + '.ts');
    throw Error('Unexpected dependency: ' + name);
  } }); return exports;
}
const { effectiveGridPrices } = load('app/option-price-grid.ts');
const plain = value => JSON.parse(JSON.stringify(value));
const fields = ['supplyPrice', 'salePrice', 'msrp'].flatMap((input, index) => [
  { id: input, type: 'number' },
  { id: 'hub-' + input, type: 'number', hubInput: input, hubWire: { path: ['productPage', 'commonAttributes', ['purchasePrice', 'coupangSalePrice', 'msrp'][index]] } },
]);
function fixture() {
  const rows = ['a', 'b'].map(id => ({ id, included: true, unitCostCny: 10, unitsPerPack: 1 }));
  const calculations = rows.map(row => ({ optionId: row.id, included: true, error: null, sourceCostCny: 10,
    calculation: { costKrw: 1000, supplyPrice: 3000, salePrice: 5000, msrp: 6500, marginKrw: 2000, actualMargin: 2000 / 3000 * 100 } }));
  const view = { overrides: { common: {}, options: {} }, resolved: { schema: { fields: plain(fields) }, rows: rows.map(row => ({ optionId: row.id, included: true, fields: {} })) },
    automatic: { rows: rows.map(row => ({ optionId: row.id, fields: Object.fromEntries(fields.map(field => [field.id, { value: '777777', source: 'pricing' }])) })) } };
  return { rows, calculations, view };
}
const changes = (optionId, fieldKey, value) => ({ optionId, fieldKey, value });
const grid = (f, edits = []) => effectiveGridPrices(f.rows, f.calculations, f.view, edits);

test('automatic prices use the current draft core calculation without mutating any source or reading stale automatic snapshot values', () => {
  const f = fixture(); f.calculations[0].calculation = { costKrw: 1500, supplyPrice: 4500, salePrice: 7500, msrp: 9750, marginKrw: 3000, actualMargin: 3000 / 4500 * 100 };
  const before = JSON.stringify(f), values = grid(f);
  assert.deepEqual([values.get('a').supply, values.get('a').sale, values.get('a').msrp], ['4500', '7500', '9750']);
  assert.equal(values.get('a').manual, false); assert.equal(values.get('a').calculation.costKrw, 1500);
  assert.equal(values.get('b').supply, '3000'); assert.equal(JSON.stringify(f), before);
});

test('saved exact primary manual option values beat common values and effective margins use the unchanged current cost', () => {
  const f = fixture(); f.view.overrides.common = { 'hub-supplyPrice': '4000', 'hub-salePrice': '6000' };
  f.view.overrides.options.a = { 'hub-supplyPrice': '4200' }; const values = grid(f);
  assert.deepEqual([values.get('a').supply, values.get('b').supply], ['4200', '4000']);
  assert.equal(values.get('a').sale, '6000'); assert.equal(values.get('a').manual, true);
  assert.equal(values.get('a').calculation.marginKrw, 3200); assert.equal(values.get('a').calculation.actualMargin, 3200 / 4200 * 100);
  assert.equal(values.get('a').calculation.costKrw, 1000);
});

test('pending own empty values stay empty and null restore falls through common manual values then current draft automatic prices', () => {
  const f = fixture(); f.view.overrides.common['hub-supplyPrice'] = '4000'; f.view.overrides.options.a = { 'hub-supplyPrice': '4200' };
  const blank = grid(f, [changes('a', 'hub-supplyPrice', '')]).get('a');
  assert.equal(blank.supply, ''); assert.equal(blank.manual, true); assert.equal(blank.calculation, null); assert.match(blank.error, /공급가/);
  assert.equal(grid(f, [changes('a', 'hub-supplyPrice', null)]).get('a').supply, '4000');
  const restored = grid(f, [changes('a', 'hub-supplyPrice', null), changes(null, 'hub-supplyPrice', null)]).get('a');
  assert.equal(restored.supply, '3000'); assert.equal(restored.manual, false);
});

test('common explicit empty values and current common edits are preserved independently of another own override', () => {
  const f = fixture(); f.view.overrides.common['hub-supplyPrice'] = ''; f.view.overrides.options.a = { 'hub-supplyPrice': '4500' };
  const values = grid(f, [changes(null, 'hub-salePrice', '7000')]);
  assert.equal(values.get('a').supply, '4500'); assert.equal(values.get('a').sale, '7000');
  assert.equal(values.get('b').supply, ''); assert.equal(values.get('b').calculation, null);
  assert.equal(values.get('b').manual, true);
});

test('canonical and Hub price mismatches stay separate and unrelated resolved provenance never replaces current automatic prices', () => {
  const f = fixture(); f.view.overrides.common = { supplyPrice: '9000', 'hub-supplyPrice': '4000' };
  f.view.resolved.rows[0].fields['hub-salePrice'] = { value: '123456', source: 'manual-option' };
  const before = JSON.stringify(f), value = grid(f).get('a');
  assert.equal(value.supply, '4000'); assert.equal(value.sale, '5000'); assert.equal(f.view.overrides.common.supplyPrice, '9000');
  assert.equal(grid(f, [changes('a', 'supplyPrice', '11000')]).get('a').supply, '4000', 'the canonical-only edit does not silently rewrite the primary wire');
  assert.equal(JSON.stringify(f), before);
});

test('zero, unsafe and invalid numeric inputs do not fall back, and sale below supply cannot produce effective margins', () => {
  const f = fixture();
  for (const value of ['0', '-1', '1.5', 'NaN', 'Infinity', '0x10', String(Number.MAX_SAFE_INTEGER + 1)]) {
    const current = grid(f, [changes('a', 'hub-supplyPrice', value)]).get('a');
    assert.equal(current.supply, value); assert.equal(current.calculation, null); assert.ok(current.error);
  }
  const tooLow = grid(f, [changes('a', 'hub-salePrice', '2999')]).get('a');
  assert.equal(tooLow.sale, '2999'); assert.equal(tooLow.calculation, null); assert.match(tooLow.error, /작을 수/);
});

test('optional MSRP empty preserves the text and nullable calculation while invalid MSRP, excluded rows and unknown cost remain distinct', () => {
  const f = fixture(); const empty = grid(f, [changes('a', 'hub-msrp', '')]).get('a');
  assert.equal(empty.msrp, ''); assert.equal(empty.calculation.msrp, null); assert.equal(empty.error, null);
  assert.equal(grid(f, [changes('a', 'hub-msrp', '0')]).get('a').calculation, null);
  f.rows[1].included = false; const excluded = grid(f).get('b'); assert.equal(excluded.calculation, null); assert.equal(excluded.error, null);
  f.calculations[0] = { ...f.calculations[0], calculation: null, error: '원문 원가 미확인' };
  const unavailable = grid(f, [changes('a', 'hub-supplyPrice', '4000'), changes('a', 'hub-salePrice', '6000')]).get('a');
  assert.equal(unavailable.supply, '4000'); assert.equal(unavailable.calculation, null); assert.equal(unavailable.error, '원문 원가 미확인');
});

test('missing view uses current prices, OSRP-only exact binding works, and ambiguous wires or duplicate edits fail without mutations', () => {
  const f = fixture(); assert.equal(effectiveGridPrices(f.rows, f.calculations, null).get('a').supply, '3000');
  f.view.resolved.schema.fields.find(field => field.id === 'hub-msrp').hubWire.path[2] = 'osrp';
  assert.equal(grid(f, [changes('a', 'hub-msrp', '8000')]).get('a').msrp, '8000');
  const before = JSON.stringify(f); assert.throws(() => grid(f, [changes('a', 'hub-salePrice', '6000'), changes('a', 'hub-salePrice', '7000')]), /중복/);
  assert.equal(JSON.stringify(f), before);
  f.view.resolved.schema.fields.push(plain(f.view.resolved.schema.fields.find(field => field.id === 'hub-supplyPrice')));
  assert.throws(() => grid(f), /연결/);
});
