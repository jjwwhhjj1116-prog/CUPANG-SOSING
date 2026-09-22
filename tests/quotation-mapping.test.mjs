import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';

const cache = new Map();
function load(file) {
  if (cache.has(file)) return cache.get(file);
  const exports = {};
  const compiled = ts.transpileModule(fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(compiled, { exports, structuredClone, require(name) {
    if (name.startsWith('@/')) return load(name.slice(2) + '.ts');
    if (name.startsWith('./')) return load(path.posix.join(path.posix.dirname(file), name) + '.ts');
    throw Error(name);
  } });
  cache.set(file, exports); return exports;
}
const { suggestQuotationMappings: suggest } = load('app/quotation-mapping.ts');
const plain = value => JSON.parse(JSON.stringify(value));

test('maps exact category fields, formatting marks and known aliases to editable column drafts', () => {
  const result = suggest(['상품명 *', '쿠팡 판매가', '뚜껑 포함여부', '수량', '박스 내 SKU 수량', '수입 및 판매원'], '80719');
  assert.deepEqual(plain(result.mappings.map(item => item.field)), ['title', 'salePrice', 'lidIncluded', 'quantity', 'boxSkuQuantity', 'importer']);
  assert.equal(result.mappings[0].required, true);
  assert.equal(result.mappings[4].required, true);
  assert.deepEqual(plain(result.unmatchedColumns), []);
});

test('never copies basket attributes or legal notice fields into another category', () => {
  const result = suggest(['상품명', '바구니 형태', '수량', '품명 및 모델명', '재질'], 'unobserved');
  assert.deepEqual(plain(result.mappings.map(item => item.field)), ['title']);
  assert.deepEqual(plain(result.unmatchedColumns), [1, 2, 3, 4]);
});

test('ambiguous duplicate headers and unrecognized unit-bearing headers remain unassigned', () => {
  const result = suggest(['상품명', '상품명 *', '', '무게', '포장 무게 kg', '한 개 단품 포장 무게', '중량', '가로길이(mm)'], '80719');
  assert.deepEqual(plain(result.ambiguousColumns), [0, 1]);
  assert.deepEqual(plain(result.unmatchedColumns), [2, 3, 4, 7]);
  assert.deepEqual(plain(result.mappings.map(item => item.field)), ['packagedWeightG', 'weight']);
});
