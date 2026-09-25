import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
function load(file) { const exports = {}; vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../' + file, import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, { exports, require: name => load(name.slice(2) + '.ts') }); return exports; }
const { applyObservedPricePreset } = load('app/observed-price-preset.ts');
const { defaultSettings, validateSettings } = load('app/workspace-settings.ts');
const { calculatePrice } = load('app/pricing.ts');
test('observed account preset reproduces the supplied 25.6 CNY example without changing non-price inputs', () => {
  const original = { ...defaultSettings, brand: '', manufacturer: '직접 입력 제조사', importer: '', serviceContact: '직접 입력 연락처', topImageKey: 'owner/banner.png', bundleEnabled: true, translationPrompt: '수동 지침', removeBackground: false };
  const before = JSON.stringify(original);
  const next = validateSettings(applyObservedPricePreset(original));
  const result = calculatePrice(25.6, { ...next, minimumMargin: next.minimumMarginEnabled ? next.minimumMargin : 0 });
  assert.deepEqual([result.supplyPrice, result.salePrice, result.msrp], [17920, 29870, 38830]);
  const changed = new Set(['exchangeRate', 'supplyMargin', 'coupangMargin', 'roundingUnit', 'roundingMode', 'msrpMultiple', 'minimumMarginEnabled', 'minimumMargin']);
  for (const key of Object.keys(original)) if (!changed.has(key)) assert.equal(next[key], original[key], key);
  assert.equal(JSON.stringify(original), before);
});
