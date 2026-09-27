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
  assert.deepEqual(Array.from(schema.categoryPath), ['스포츠/레져', '스포츠잡화', '스포츠장갑']);
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
