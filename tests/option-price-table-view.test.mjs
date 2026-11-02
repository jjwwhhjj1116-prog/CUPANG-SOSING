import test from 'node:test';
import assert from 'node:assert/strict';
import { providedOptionModule } from './helpers/provided-option-quotation.mjs';

const view = providedOptionModule('app/option-price-table-view.ts');
const plain = value => JSON.parse(JSON.stringify(value));
const rows = [
  { row: { id: 'a', translatedName: '분홍 10', supplierSku: 'sku-a', originalName: '粉红', unitsPerPack: 1, stock: null, unitCostCny: 2.5 }, index: 0, result: { calculation: { costKrw: 500, supplyPrice: 1000, salePrice: 2000, marginKrw: 500 } } },
  { row: { id: 'b', translatedName: '검정 2', supplierSku: 'sku-b', originalName: '黑色', unitsPerPack: 2, stock: 0, unitCostCny: 10 }, index: 1, result: { calculation: { costKrw: 500, supplyPrice: 900, salePrice: 1000, marginKrw: 400 } } },
  { row: { id: 'c', translatedName: '분홍 2', supplierSku: 'sku-c', originalName: '粉红', unitsPerPack: 2, stock: 20, unitCostCny: 2.5 }, index: 2, result: { calculation: { costKrw: 500, supplyPrice: 1100, salePrice: 2000, marginKrw: 600 } } },
];
const ids = entries => plain(entries.map(entry => entry.row.id));

test('raw monetary condition bounds compose with token search and own-column filter omission', () => {
  const filters = { supply: { mode: 'conditions', conditions: [{ operator: 'gte', value: '1000' }, { operator: 'lte', value: '1100' }] }, quantity: { mode: 'values', values: ['2'] } };
  const before = JSON.stringify(rows);
  assert.deepEqual(ids(view.filterPriceTableRows(rows, '분홍 sku', filters)), ['c']);
  assert.deepEqual(ids(view.filterPriceTableRows(rows, '분홍 sku', filters, undefined, 'quantity')), ['a', 'c']);
  assert.deepEqual(ids(view.filterPriceTableRows(rows, '', { stock: { mode: 'values', values: [''] } })), ['a']);
  assert.deepEqual(ids(view.filterPriceTableRows(rows, '', { stock: { mode: 'conditions', conditions: [{ operator: 'eq', value: '0' }] } })), ['b']);
  assert.equal(view.priceColumnText(rows[0], 'supply'), '1000');
  assert.equal(JSON.stringify(rows), before);
});

test('three-key sorting gives newest key priority, stable ties and a removable third click', () => {
  let sort = [];
  for (const column of ['name', 'quantity', 'cost', 'sale']) sort = view.nextPriceTableSort(sort, column);
  assert.deepEqual(plain(sort), [{ column: 'sale', direction: 'ascending' }, { column: 'cost', direction: 'ascending' }, { column: 'quantity', direction: 'ascending' }]);
  assert.deepEqual(ids(view.sortPriceTableRows(rows, sort)), ['b', 'a', 'c']);
  sort = view.nextPriceTableSort(sort, 'sale');
  assert.deepEqual(ids(view.sortPriceTableRows(rows, sort)), ['a', 'c', 'b']);
  sort = view.nextPriceTableSort(sort, 'sale'); assert.deepEqual(plain(sort.map(value => value.column)), ['cost', 'quantity']);
  assert.deepEqual(ids(view.sortPriceTableRows(rows, [{ column: 'name', direction: 'ascending' }])), ['b', 'c', 'a']);
  assert.deepEqual(ids(rows), ['a', 'b', 'c']);
});

test('pin offsets include only visible prefix columns and start after the actual selection width', () => {
  const columns = [{ id: 'name', width: 200 }, { id: 'quantity', width: 60 }, { id: 'sale', width: 130 }];
  assert.deepEqual(plain([...view.pricePinnedOffsets(columns, 'quantity', 36)]), [['name', 36], ['quantity', 236]]);
  assert.deepEqual(plain([...view.pricePinnedOffsets(columns, 'sale', 52)]), [['name', 52], ['quantity', 252], ['sale', 312]]);
  assert.equal(view.pricePinnedOffsets(columns, 'stock', 36).size, 0);
});
