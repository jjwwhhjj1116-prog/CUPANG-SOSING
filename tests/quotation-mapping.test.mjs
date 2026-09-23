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

test('category changes refresh only session automatic mappings and preserve manual disconnections', () => {
  const { refreshCategoryMappings: refresh } = load('app/quotation-mapping.ts');
  const headers = ['상품명', '뚜껑 포함여부', '공급가', '판매가'];
  const automatic = suggest(headers, '80719').mappings;
  const original = plain(automatic);
  const manual = { column: 2, field: 'constant', required: true, constant: '직접 입력' };
  const current = [...automatic.filter(item => item.column < 2), manual];
  const changed = refresh(headers, '77442', current, automatic, new Set([2, 3]));
  assert.deepEqual(plain(changed.mappings.map(item => item.column)), [0, 2]);
  assert.deepEqual(plain(changed.mappings[1]), manual);
  const restored = refresh(headers, '80719', changed.mappings, changed.automatic, new Set([2, 3]));
  assert.deepEqual(plain(restored.mappings.map(item => item.field)), ['title', 'lidIncluded', 'constant']);
  assert.deepEqual(plain(automatic), original);
});

test('saved mappings and edited required flags are never inferred to be automatic', () => {
  const { refreshCategoryMappings: refresh } = load('app/quotation-mapping.ts');
  const headers = ['뚜껑 포함여부', '상품명'];
  const saved = suggest(headers, '80719').mappings;
  assert.deepEqual(plain(refresh(headers, '77442', saved, [], new Set()).mappings), plain(saved));
  const edited = saved.map(item => ({ ...item, required: !item.required }));
  assert.deepEqual(plain(refresh(headers, '77442', edited, saved, new Set()).mappings), plain(edited));
  const unknown = refresh(headers, '', saved, saved, new Set());
  assert.equal(unknown.mappings.some(item => item.field === 'lidIncluded'), false);
});

test('a category-specific dropdown maps and exports only for the selected category', () => {
  const schema = load('app/quotation-schema.ts').getQuotationSchema('80714');
  const field = schema.fields.find(field => field.visibility === 'hidden' && field.type === 'select');
  const result = suggest([field.label, '색상', '수량', '사이즈'], '80714');
  assert.deepEqual(plain(result.mappings.map(item => item.field)), [field.id, 'color', 'quantity']);
  assert.deepEqual(plain(result.unmatchedColumns), [3]);
  const profiles = load('app/category-profiles.ts');
  const draft = {name: '홀더', categoryId: '80714', categoryPath: schema.categoryPath, template: {name: 'test.csv', format: 'csv', sha256: 'a'.repeat(64), sheetName: '', headerRow: 1, headers: [field.label]}, mappings: [result.mappings[0]]};
  const value = field.choices.find(choice => choice.value).value;
  assert.equal(profiles.mapQuotationRow(draft, {[field.id]: value}).values[0], value);
  assert.throws(() => profiles.validateCategoryProfile({...draft, categoryId: '80715'}), /다른 카테고리/);
  assert.deepEqual(plain(suggest([field.label], 'unknown').mappings), []);
});

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
