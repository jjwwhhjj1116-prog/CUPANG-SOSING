import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { createRequire } from 'node:module';
const native = createRequire(import.meta.url), cache = new Map();
function load(file) {
  if (cache.has(file)) return cache.get(file);
  const exports = {}; cache.set(file, exports);
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../' + file, import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
    { exports, Error, structuredClone, TextEncoder, require(name) { return name.startsWith('@/') ? load(name.slice(2) + '.ts') : native(name); } });
  return exports;
}
const { pricePolicy, calculatePrice } = load('app/pricing.ts'), options = load('app/product-options.ts');
const plain = value => JSON.parse(JSON.stringify(value));
const mode = 'couplus-stage-two-v1';
const observed = { exchangeRate: 350, supplyMargin: 50, coupangMargin: 40, minimumMargin: 3000, msrpMultiple: 1.3, roundingUnit: 10, roundingMode: 'nearest' };
const prices = calculation => [calculation.supplyPrice, calculation.salePrice, calculation.msrp];

test('missing stage-two mode preserves legacy policy bytes and initial worker examples', () => {
  for (const policy of [observed, { ...observed, roundingMode: 'up' }, { ...observed, useIntegratedRate: true, integratedRate: 300 }]) {
    const before = JSON.stringify(pricePolicy(policy));
    assert.equal(JSON.stringify(pricePolicy({ ...policy, recalculationMode: undefined })), before);
    assert.equal(Object.hasOwn(pricePolicy(policy), 'recalculationMode'), false);
    assert.deepEqual(plain(calculatePrice(25.6, policy)), plain(calculatePrice(25.6, { ...policy, recalculationMode: undefined })));
  }
  assert.deepEqual(prices(calculatePrice(25.6, observed)), [17920, 29870, 38830]);
  assert.deepEqual(prices(calculatePrice(5.23, observed)), [4830, 8050, 10470]);
});

test('only the explicit mode selects recorded stage-two cost plus minimum, including the normal low-cost branch', () => {
  const saved = pricePolicy({ ...observed, recalculationMode: mode });
  assert.equal(saved.recalculationMode, mode);
  assert.deepEqual(prices(calculatePrice(25.6, saved)), [11960, 19930, 25910]);
  assert.deepEqual(prices(calculatePrice(5.23, saved)), [4830, 8050, 10470]);
  assert.equal(calculatePrice(25.6, saved).marginKrw, 3000);
  assert.equal(calculatePrice(5.23, saved).marginKrw, 2999.5);
  for (const value of ['', null, false, true, 1, {}, 'worker', 'couplus-stage-two', 'COUPLUS-STAGE-TWO-V1']) assert.throws(() => pricePolicy({ ...observed, recalculationMode: value }), /재계산/);
});

test('disabled minimum retains ratio pricing while later explicit manual rounding remains usable', () => {
  for (const roundingMode of ['nearest', 'up']) {
    const policy = { ...observed, roundingMode, minimumMargin: 0 };
    assert.deepEqual(plain(calculatePrice(25.6, { ...policy, recalculationMode: mode })), plain(calculatePrice(25.6, policy)));
  }
  // The Couplus button selects nearest; a user's later up selection is an
  // existing manual feature, not an observed Couplus rounding example.
  const manual = pricePolicy({ ...observed, roundingMode: 'up', recalculationMode: mode });
  assert.equal(manual.roundingMode, undefined);
  assert.equal(manual.recalculationMode, mode);
  assert.deepEqual(prices(calculatePrice(5.23, manual)), [4840, 8070, 10500]);
});

test('integrated purchase cost charges handling once per pack before the explicit fixed margin', () => {
  const policy = { ...observed, useIntegratedRate: true, integratedRate: 275, recalculationMode: mode };
  const single = calculatePrice(10, policy), pack = calculatePrice(10, policy, 3);
  assert.equal(single.costKrw, 3355); assert.equal(pack.costKrw, 9405);
  assert.notEqual(pack.costKrw, single.costKrw * 3);
  assert.deepEqual(prices(pack), [12410, 20680, 26880]);
  assert.equal(pack.marginKrw, 3005);
  assert.equal(calculatePrice(5, { ...policy, integratedRate: 1, roundingUnit: 1 }).costKrw, 336);
});

test('fixed margin uses the reviewed pack quantity and exact decimal boundaries without rewriting inputs', () => {
  const policy = { ...observed, recalculationMode: mode }, rows = [
    { ...options.emptyOptionInput('pack'), originalName: '원문 묶음', unitCostCny: 25.6, unitsPerPack: 3, included: true },
    { ...options.emptyOptionInput('excluded'), included: false },
  ], before = JSON.stringify(rows), calculated = options.calculateOptionPrices(rows, policy);
  assert.deepEqual(prices(calculated[0].calculation), [29880, 49800, 64740]);
  assert.equal(calculated[0].calculation.costKrw, 26880); assert.equal(calculated[1].calculation, null);
  assert.equal(JSON.stringify(rows), before);
  for (const quantity of [0, -1, 1.5, NaN, Number.MAX_SAFE_INTEGER + 1]) assert.throws(() => calculatePrice(25.6, policy, quantity));
  assert.throws(() => calculatePrice(Number.MAX_VALUE, policy));
  assert.equal(calculatePrice(1, { ...policy, exchangeRate: 7, minimumMargin: 3.0000000000000004, roundingUnit: 1, roundingMode: 'up' }).supplyPrice, 11);
});

test('saved mode is authoritative across settings changes while old policies and manual quote prices remain unchanged', () => {
  const settings = { ...load('app/workspace-settings.ts').newWorkspaceSettings, ...observed, exchangeRate: 999 }, product = {
    id: 'local', source_url: 'https://detail.1688.com/offer/640000000011.html', title: '검토 상품', image_keys: '[]', source_price_cny: 25.6,
    exchange_rate: 350, supply_margin: 50, coupang_margin: 40, supply_price: 17920, sale_price: 29870, msrp: 38830,
    pricing_policy: JSON.stringify(pricePolicy({ ...observed, recalculationMode: mode })),
  };
  const selected = options.resolveOptionPricePolicy(product, settings);
  assert.equal(selected.policy.exchangeRate, 350); assert.equal(selected.policy.recalculationMode, mode);
  const old = options.resolveOptionPricePolicy({ ...product, pricing_policy: JSON.stringify(pricePolicy(observed)) }, settings);
  assert.equal(Object.hasOwn(old.policy, 'recalculationMode'), false); assert.deepEqual(prices(calculatePrice(25.6, old.policy)), [17920, 29870, 38830]);
  const rows = options.applyOptionRows(options.emptyProductOptions('local'), [{ ...options.emptyOptionInput('a'), originalName: '원문', unitCostCny: 25.6, included: true }], '2026-10-13T00:00:00.000Z');
  const content = load('app/product-content.ts').emptyProductContent('local'), overrides = { common: { msrp: '' }, options: { a: { salePrice: '50000' } } };
  const before = JSON.stringify({ product, settings, rows, content, overrides });
  const fields = load('app/quotation-schema.ts').resolveQuotationFields({ categoryId: '80719', product, settings, options: rows, content, overrides }).rows.find(row => row.optionId === 'a').fields;
  assert.equal(fields.supplyPrice.value, '11960'); assert.equal(fields.salePrice.value, '50000'); assert.equal(fields.salePrice.source, 'manual-option');
  assert.equal(fields.msrp.value, ''); assert.equal(fields.msrp.source, 'manual-common');
  assert.equal(JSON.stringify({ product, settings, rows, content, overrides }), before);
});
