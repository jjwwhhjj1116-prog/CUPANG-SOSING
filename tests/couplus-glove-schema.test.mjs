import * as parse5 from 'parse5';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import ts from 'typescript';

const cache = new Map();
function load(file) {
  if (cache.has(file)) return cache.get(file);
  const exports = {};
  const compiled = ts.transpileModule(fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(compiled, { exports, structuredClone, TextEncoder, require(name) {
    if (name === 'parse5') return parse5;
    if (name.startsWith('./')) return load(path.posix.join(path.posix.dirname(file), name) + '.ts');
    if (!name.startsWith('@/app/')) throw Error(name);
    return load(name.slice(2) + '.ts');
  } });
  cache.set(file, exports); return exports;
}
const model = load('app/quotation-schema.ts');
const contentModel = load('app/product-content.ts');
const optionModel = load('app/product-options.ts');
test('81221 uses the observed glove form without borrowing kitchen or brace fields', () => {
  const schema = model.getQuotationSchema('81221');
  assert.deepEqual(Array.from(schema.categoryPath), ['스포츠/레져', '스포츠 잡화', '스포츠 장갑']);
  assert.equal(schema.fields.filter(f => f.visibility === 'exposed').length, 3);
  assert.equal(schema.fields.filter(f => f.visibility === 'hidden').length, 13);
  assert.equal(schema.fields.filter(f => f.section === 'legal' && !['kcMarkType','kcCertificationNumber','emcCertificationNumber','safetyDeclarationNumber'].includes(f.id)).length, 12);
  assert.equal(schema.fields.some(f => f.id === 'kcsCertificationNumber'), false);
  assert.equal(schema.fields.some(f => f.id.startsWith('brace_')), false);
  assert.equal(schema.fields.find(f => f.id === 'glove_touch').choices[0].value, '');
  assert.equal(schema.fields.find(f => f.id === 'glove_touch').choices[1].value, '터치 가능');
  assert.equal(schema.submissionReady, false);
  assert.match(schema.evidence, /Supplier Hub 공식 규격은 미확인/);
  const changes = model.validateQuotationChanges([{ fieldKey: 'glove_touch', optionId: null, value: '터치 가능' }], { schema, optionIds: [] });
  assert.ok(changes);
});

test('stage-six model reaches glove quotation and export while manual overrides remain authoritative', () => {
  const settings = load('app/workspace-settings.ts').defaultSettings;
  const content = contentModel.emptyProductContent('glove-test');
  content.label.model = {value:'GF-100',provenance:'manual',updatedAt:'2026-09-27T00:00:00.000Z'};
  const input = { categoryId:'81221', content, settings,
    product:{id:'glove-test',title:'개발 검증 장갑',source_price_cny:4.4,image_keys:'[]'},
    options:optionModel.emptyProductOptions('glove-test') };
  let resolved = model.resolveQuotationFields(input);
  assert.equal(resolved.rows[0].fields.glove_model.value,'GF-100');
  assert.equal(resolved.rows[0].fields.glove_model.source,'content');
  const exported = load('app/exports/quotation-fields.ts').resolvedQuotationRows(input,resolved,[])[0];
  assert.equal(exported.glove_model,'GF-100');
  input.overrides = {common:{glove_model:'직접 수정한 품번'},options:{}};
  resolved = model.resolveQuotationFields(input);
  assert.equal(resolved.rows[0].fields.glove_model.value,'직접 수정한 품번');
  input.overrides.common.glove_model = '';
  assert.equal(model.resolveQuotationFields(input).rows[0].fields.glove_model.value,'');
  delete input.overrides.common.glove_model;
  content.label.model.value = '';
  assert.equal(model.resolveQuotationFields(input).rows[0].fields.glove_model.value,'');
});

test('every glove-specific field is available to quotation template mappings', () => {
  const mappingFields = load('app/category-profiles.ts').categoryFields;
  const specific = model.getQuotationSchema('81221').fields.filter(field => field.id.startsWith('glove_'));
  assert.equal(specific.length,17);
  for (const field of specific) assert.ok(Object.hasOwn(mappingFields,field.id),field.id);
});
