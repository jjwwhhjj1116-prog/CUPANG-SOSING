import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const compiled = ts.transpileModule(fs.readFileSync(new URL('../app/pricing.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const pricing = {};
vm.runInNewContext(compiled, { exports: pricing });
const plain = value => JSON.parse(JSON.stringify(value));
const policy = Object.freeze({ exchangeRate:350, supplyMargin:50, coupangMargin:40, minimumMargin:3000,
  recalculationMinimumEnabled:true, msrpMultiple:1.3, roundingUnit:10, roundingMode:'nearest', arithmeticMode:'couplus-number-v1' });
const prices = value => [value.supplyPrice, value.salePrice, value.msrp];

// Static source evidence, not vendor execution: retained current main.a878a60f.js
// SHA256 36a8e3252cba8096da3e9b06eaf3c338699dce35280a0080484a5c7181d20fb7.
// calculatePricing [164142,166051), method SHA b2dfcb25080ebe5131abc543131dddd6f27e46fa2ddfad653c809acf49d9c442;
// purchaseCost [295962,296209), method SHA ff4758a83240482f3558face2d95f172e7c4db7c9f47a842530bd14780df5b5e.
// Explicit stage-two recalculateOption: chunk-36123f1a.155d5b9e.js
// SHA256 2fb15d370c331f65d982a886f2888b813ccae67277e87f806182c70032821664,
// [177626,179414), method SHA 26015eb6c5cde9542738b38d8b29fbf62e4a672d8bac977996a4ab5fb7431632.
// Expected money below is fixed from the independently transcribed operations;
// this suite loads only our calculator and does not evaluate those artifacts.
test('initial general-rate draft keeps the recorded Number boundary and rounded-margin guard', () => {
  const result = pricing.calculatePrice(8.95, policy);
  assert.equal(result.costKrw, 3132.4999999999995);
  assert.deepEqual(prices(result), [6260,10430,13560]);
  assert.equal(result.marginKrw, 3127.5000000000005);
  assert.equal(result.actualMargin, 49.96006389776358);
  // Initial worker retains ratio pricing above its minimum; explicit Stage 2
  // instead directly adds the enabled minimum even for the same product.
  assert.deepEqual(prices(pricing.calculatePrice(32.3, policy)), [22610,37680,48980]);
});

test('explicit Stage 2 directly adds the enabled minimum in original Number order', () => {
  const result = pricing.calculatePrice(32.3, { ...policy, recalculationMode:'couplus-stage-two-v1' });
  assert.equal(result.costKrw, 11304.999999999998);
  assert.deepEqual(prices(result), [14300,23830,30980]);
  assert.equal(result.marginKrw, 2995.000000000002);
  assert.deepEqual(prices(pricing.calculatePrice(8.95, { ...policy, recalculationMode:'couplus-stage-two-v1' })), [6130,10220,13290]);
});

test('recorded initial minimum correction is rounded once without a second ceiling', () => {
  for (const [source, cost, expected] of [
    [3.42,1197,[4200,7000,9100]],
    [5.23,1830.5000000000002,[4830,8050,10470]],
    [2.99,1046.5,[4050,6750,8780]],
  ]) {
    const result = pricing.calculatePrice(source, policy);
    assert.equal(result.costKrw, cost);
    assert.deepEqual(prices(result), expected);
  }
  assert.equal(pricing.calculatePrice(5.23, policy).marginKrw, 2999.5);
});

test('minimum off preserves the realistic 0.35 CNY boundary; enabled zero is distinct in Stage 2', () => {
  const off = { ...policy, minimumMargin:0, recalculationMinimumEnabled:false };
  const result = pricing.calculatePrice(0.35, off);
  assert.equal(result.costKrw, 122.49999999999999);
  assert.deepEqual(prices(result), [240,400,520]);
  assert.deepEqual(prices(pricing.calculatePrice(0.35, { ...off, recalculationMode:'couplus-stage-two-v1' })), [240,400,520]);
  assert.deepEqual(prices(pricing.calculatePrice(0.35, { ...off, recalculationMinimumEnabled:true, recalculationMode:'couplus-stage-two-v1' })), [120,200,260]);
});

test('integrated purchase cost charges handling once per complete selling pack before VAT rounding', () => {
  const integrated = { ...policy, useIntegratedRate:true, integratedRate:290 };
  for (const [source, units, cost, initial, stageTwo] of [
    [0.35,1,442,[3440,5730,7450],[3440,5730,7450]],
    [2.99,1,1284,[4280,7130,9270],[4280,7130,9270]],
    [2.99,3,3191,[6380,10630,13820],[6190,10320,13420]],
    [8.95,1,3185,[6370,10620,13810],[6190,10320,13420]],
    [8.95,3,8895,[17790,29650,38550],[11900,19830,25780]],
    [32.3,1,10634,[21270,35450,46090],[13630,22720,29540]],
  ]) {
    const value = pricing.calculatePrice(source, integrated, units);
    assert.equal(value.costKrw, cost);
    assert.deepEqual(prices(value), initial);
    assert.deepEqual(prices(pricing.calculatePrice(source, { ...integrated, recalculationMode:'couplus-stage-two-v1' }, units)), stageTwo);
  }
  assert.notEqual(pricing.calculatePrice(2.99, integrated, 3).costKrw, pricing.calculatePrice(2.99, integrated).costKrw * 3);
});

test('general pack multiplication and every supported currency unit precede the next price stage', () => {
  // 4.5 × 200 / (1 - .55) then sale / (1 - .20), rounded at each stage.
  for (const [roundingUnit, expected] of [[1,[2000,2500,2750]], [10,[2000,2500,2750]], [100,[2000,2500,2800]], [1000,[2000,3000,3000]]]) {
    const input = { ...policy, exchangeRate:200, supplyMargin:55, coupangMargin:20, minimumMargin:0,
      recalculationMinimumEnabled:false, msrpMultiple:1.1, roundingUnit };
    assert.deepEqual(prices(pricing.calculatePrice(1.5, input, 3)), expected);
  }
});

test('Stage 2 MSRP uses the same opted-in Number multiplication and nearest unit', () => {
  // Recorded calculateMsrpValue [185881,186031), method SHA
  // 31fa548a9e5f9cc99deeba9483974e137691a973f53c452c22606125273424ba.
  assert.equal(pricing.calculateStageTwoMsrp(10430, policy), 13560);
  assert.equal(pricing.calculateStageTwoMsrp(23830, policy), 30980);
  assert.equal(pricing.calculateStageTwoMsrp(6300, { ...policy, msrpMultiple:1.15 }), 7240);
  assert.equal(pricing.calculateStageTwoMsrp(6300, { ...policy, msrpMultiple:1.15, arithmeticMode:undefined }), 7250);
  assert.equal(pricing.calculateStageTwoMsrp(6300, { ...policy, msrpMultiple:1.15, roundingMode:'up' }), 7250);
});

test('strict policy parsing retains an explicit mode and rejects every unknown arithmetic enum', () => {
  assert.deepEqual(plain(pricing.pricePolicy(policy)), policy);
  for (const arithmeticMode of ['', 'rational', 'couplus-number-v2', null, false, 1, {}, []]) {
    assert.throws(() => pricing.pricePolicy({ ...policy, arithmeticMode }), /가격 계산 방식/);
  }
  assert.throws(() => pricing.calculatePrice(8.95, { ...policy, arithmeticMode:'couplus-number-v2' }), /가격 계산 방식/);
  assert.throws(() => pricing.calculateStageTwoMsrp(6300, { ...policy, arithmeticMode:'couplus-number-v2' }), /가격 계산 방식/);
});

test('absent mode and explicit up remain the persisted rational contracts', () => {
  const { arithmeticMode, ...legacy } = policy;
  assert.equal(arithmeticMode, 'couplus-number-v1');
  assert.equal(Object.hasOwn(pricing.pricePolicy(legacy), 'arithmeticMode'), false);
  assert.deepEqual(prices(pricing.calculatePrice(8.95, legacy)), [6270,10450,13590]);
  assert.deepEqual(prices(pricing.calculatePrice(32.3, { ...legacy, recalculationMode:'couplus-stage-two-v1' })), [14310,23850,31010]);
  const off = { ...legacy, minimumMargin:0, recalculationMinimumEnabled:false };
  assert.equal(pricing.calculatePrice(0.35, off).supplyPrice, 250);
  assert.equal(pricing.calculatePrice(0.35, { ...off, arithmeticMode:'couplus-number-v1', roundingMode:'up' }).supplyPrice, 250);
  assert.equal(pricing.calculatePrice(0.35, { ...off, arithmeticMode:'couplus-number-v1', roundingMode:undefined }).supplyPrice, 250);
  assert.deepEqual(plain(pricing.pricePolicy({ ...off, arithmeticMode:'couplus-number-v1', roundingMode:'up' })), plain({ ...off, arithmeticMode:'couplus-number-v1', roundingMode:undefined }));
});

test('source, policy, quantity and MSRP input validation remain active in Number mode', () => {
  for (const source of [0, -1, NaN, Infinity, -Infinity, null, undefined, '8.95']) assert.throws(() => pricing.calculatePrice(source, policy), /상품 원가/);
  for (const quantity of [0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, '2']) assert.throws(() => pricing.calculatePrice(8.95, policy, quantity), /구성 수량/);
  for (const sale of [0, -1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, '6300']) assert.throws(() => pricing.calculateStageTwoMsrp(sale, policy), /판매가/);
  for (const patch of [{ exchangeRate:0 }, { supplyMargin:100 }, { coupangMargin:100 }, { minimumMargin:-1 }, { msrpMultiple:0.9 }, { roundingUnit:5 }, { useIntegratedRate:true }, { useIntegratedRate:true, integratedRate:0 }, { recalculationMinimumEnabled:false }]) {
    assert.throws(() => pricing.calculatePrice(8.95, { ...policy, ...patch }));
  }
});

test('zero-rounded supply and unsafe or overflowed money are rejected before returning prices', () => {
  const small = { ...policy, exchangeRate:1, supplyMargin:0, coupangMargin:0, minimumMargin:0, recalculationMinimumEnabled:false, msrpMultiple:1, roundingUnit:1 };
  assert.throws(() => pricing.calculatePrice(0.01, small), /공급가가 0원/);
  assert.throws(() => pricing.calculatePrice(Number.MIN_VALUE, { ...small, exchangeRate:Number.MIN_VALUE }), /공급가가 0원/);
  const unsafe = /계산 가능한 가격 범위/;
  assert.throws(() => pricing.calculatePrice(Number.MAX_VALUE, policy, 2), unsafe);
  assert.throws(() => pricing.calculatePrice(Number.MAX_VALUE, policy), unsafe);
  assert.throws(() => pricing.calculatePrice(Number.MAX_SAFE_INTEGER, { ...small, exchangeRate:2 }), unsafe);
  assert.throws(() => pricing.calculatePrice(1, { ...small, supplyMargin:99.99999999999999 }), unsafe);
  assert.throws(() => pricing.calculatePrice(1, { ...small, coupangMargin:99.99999999999999 }), unsafe);
  assert.throws(() => pricing.calculatePrice(1, { ...small, msrpMultiple:Number.MAX_VALUE }), unsafe);
  assert.throws(() => pricing.calculatePrice(1, { ...policy, minimumMargin:Number.MAX_VALUE }), unsafe);
  assert.throws(() => pricing.calculatePrice(Number.MAX_VALUE, { ...policy, useIntegratedRate:true, integratedRate:290 }), unsafe);
  assert.throws(() => pricing.calculateStageTwoMsrp(Number.MAX_SAFE_INTEGER, { ...policy, msrpMultiple:2, roundingUnit:1 }), unsafe);
  assert.equal(pricing.calculatePrice(Number.MAX_SAFE_INTEGER, small).supplyPrice, Number.MAX_SAFE_INTEGER);
});

test('calculating and normalizing never modify the caller or promote a legacy policy', () => {
  const input = Object.freeze({ ...policy });
  const before = JSON.stringify(input);
  pricing.calculatePrice(8.95, input);
  pricing.calculateStageTwoMsrp(10430, input);
  pricing.pricePolicy(input);
  assert.equal(JSON.stringify(input), before);
  const legacy = Object.freeze({ ...policy, arithmeticMode:undefined });
  pricing.calculatePrice(8.95, legacy);
  assert.equal(legacy.arithmeticMode, undefined);
});
