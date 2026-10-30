import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { buildSync } from 'esbuild';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { parseFragment } from 'parse5';
import { optionPriceTableUI, priceTableCompanies, priceTableNodes, priceTableText } from './helpers/option-price-table-ui.mjs';

// Render the actual table with React, without a provider, browser or source URL.
const result = buildSync({ entryPoints: ['app/components/option-price-table.tsx'], bundle: true, write: false,
  platform: 'node', format: 'cjs', packages: 'external', loader: { '.css': 'empty' }, logLevel: 'silent' });
const compiled = { exports: {} };
vm.runInNewContext(result.outputFiles[0].text, { module: compiled, exports: compiled.exports, require: createRequire(import.meta.url) });
const { OptionPriceTable } = compiled.exports;
const nodes = node => [node, ...(node.childNodes ?? []).flatMap(nodes)];
const text = node => node.nodeName === '#text' ? node.value : (node.childNodes ?? []).map(text).join('');
const attribute = (node, name) => node.attrs?.find(value => value.name === name)?.value;
const originalRow = { id: 'captured-fixed-bundle', originalName: '합성 옵션', translatedName: '', supplierSku: 'source-sku',
  unitCostCny: 2.99, unitsPerPack: 3, stock: 4, included: true, imageKey: null };
function costCell(overrides = {}, ...rates) {
  const exchangeRate = rates.length ? rates[0] : 350;
  const row = { ...originalRow, ...overrides }, before = JSON.stringify(row);
  const calculation = { optionId: row.id, included: true, error: null, calculation: {
    costKrw: 9999, supplyPrice: 12000, salePrice: 20000, msrp: 26000, marginKrw: 2001, actualMargin: 16.675 } };
  const dom = parseFragment(renderToStaticMarkup(createElement(OptionPriceTable, { rows: [row], calculations: [calculation],
    selected: new Set(), exchangeRate, onSelect() { throw Error('display changed selection'); }, onChange() { throw Error('display changed source'); } })));
  assert.equal(JSON.stringify(row), before);
  return nodes(dom).find(node => node.tagName === 'td' && attribute(node, 'data-price-column') === 'cost');
}
const line = (cell, label) => nodes(cell).find(node => attribute(node, 'aria-label') === label);

test('current bundle quantity displays CNY total and general-rate KRW separately from the actual pricing cost', () => {
  const cell = costCell();
  assert.equal(text(line(cell, '가격 옵션 1 일반 환율 환산 원가')), '3,139.5원 · 일반 환율 환산');
  assert.equal(text(line(cell, '가격 옵션 1 구성 합계 위안 원가')), '(¥8.97 · 3개 합계)');
  assert.ok(!text(cell).includes('9,999'), 'integrated or fixed pricing cost is not relabeled as general conversion');
  assert.match(attribute(line(cell, '가격 옵션 1 일반 환율 환산 원가'), 'title'), /통합통관 매입가는 별도로/);
  assert.equal(attribute(nodes(cell).find(node => node.tagName === 'input'), 'value'), '2.99');
});

test('one-unit and explicitly changed bundle quantities use the current row without deriving another quantity', () => {
  let cell = costCell({ unitsPerPack: 1 });
  assert.equal(text(line(cell, '가격 옵션 1 일반 환율 환산 원가')), '1,046.5원 · 일반 환율 환산');
  assert.equal(line(cell, '가격 옵션 1 구성 합계 위안 원가'), undefined);
  cell = costCell({ unitsPerPack: 7 }, 310);
  assert.equal(text(line(cell, '가격 옵션 1 일반 환율 환산 원가')), '6,488.3원 · 일반 환율 환산');
  assert.equal(text(line(cell, '가격 옵션 1 구성 합계 위안 원가')), '(¥20.93 · 7개 합계)');
});

test('blank, invalid or overflowing source inputs omit comparisons instead of inventing zero', () => {
  for (const override of [{ unitCostCny: null }, { unitCostCny: NaN }, { unitCostCny: Infinity }, { unitCostCny: 0 },
    { unitCostCny: -1 }, { unitsPerPack: NaN }, { unitsPerPack: 0 }, { unitsPerPack: -2 }, { unitsPerPack: 1.5 },
    { unitsPerPack: Number.MAX_SAFE_INTEGER + 1 }, { unitCostCny: Number.MAX_VALUE, unitsPerPack: 2 }]) {
    const cell = costCell(override);
    assert.equal(line(cell, '가격 옵션 1 일반 환율 환산 원가'), undefined);
    assert.equal(line(cell, '가격 옵션 1 구성 합계 위안 원가'), undefined);
    assert.equal(text(cell), '');
  }
});

test('missing or invalid general rate omits only KRW and retains a known bundle CNY total', () => {
  for (const rate of [undefined, null, NaN, Infinity, 0, -1, Number.MAX_VALUE]) {
    const cell = costCell({}, rate);
    assert.equal(line(cell, '가격 옵션 1 일반 환율 환산 원가'), undefined);
    assert.equal(text(line(cell, '가격 옵션 1 구성 합계 위안 원가')), '(¥8.97 · 3개 합계)');
  }
});

for (const company of priceTableCompanies) test(`actual option editor shows current unsaved cost totals without any write (${company.code})`, async () => {
  const h = await optionPriceTableUI(company, { count: 2 });
  try {
    const before = JSON.stringify(await h.rows()), sourceBefore = h.protectedSnapshot();
    h.node('가격 옵션 1 구성 수량').props.onChange({ target: { value: '3', valueAsNumber: 3 } });
    const rendered = h.render();
    const total = priceTableNodes(rendered).find(node => node.props?.['aria-label'] === '가격 옵션 1 구성 합계 위안 원가');
    const general = priceTableNodes(rendered).find(node => node.props?.['aria-label'] === '가격 옵션 1 일반 환율 환산 원가');
    assert.equal(priceTableText(total), '(¥8.97 · 3개 합계)');
    assert.equal(priceTableText(general), '3,139.5원');
    assert.match(general.props.title,/통합통관 매입가는 별도로/);
    h.node('가격 옵션 1 개당 원가').props.onChange({ target: { value: '', valueAsNumber: NaN } });
    assert.equal(h.node('가격 옵션 1 개당 원가').props.value, '');
    assert.equal(priceTableNodes(h.render()).find(node => node.props?.['aria-label'] === '가격 옵션 1 일반 환율 환산 원가'), undefined);
    assert.equal(JSON.stringify(await h.rows()), before); assert.equal(h.protectedSnapshot(), sourceBefore);
    assert.equal(h.writes.length, 0); assert.ok(h.apiCalls.every(call => call.method === 'GET'));
  } finally { h.close(); }
});
