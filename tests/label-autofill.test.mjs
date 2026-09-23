import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
function load(file) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../' + file, import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
    { exports, Error, structuredClone, require: name => load(name.replace('@/', '') + '.ts') });
  return exports;
}
const { fillLabelDraft } = load('app/label-autofill.ts');
const { emptyProductContent, applyContentPatch, labelFields } = load('app/product-content.ts');
const { documentImagePlan } = load('app/document-image.ts');
const draftOf = content => Object.fromEntries(Object.entries(content.label).map(([key, field]) => [key, field.value]));

test('saved settings and SEO title fill label draft and reach document only after explicit save', () => {
  const content = emptyProductContent('p'); content.seo.title.value = '한국어 품명';
  const before = JSON.stringify(content);
  const next = fillLabelDraft(draftOf(content), content, '原文', { manufacturer: '제조사', importer: '수입원', serviceContact: '연락처' });
  assert.equal(next.label.productName, '한국어 품명'); assert.equal(next.label.manufacturer, '제조사');
  assert.equal(next.label.importer, '수입원'); assert.equal(next.label.contact, '연락처');
  assert.equal(JSON.stringify(content), before);
  const saved = applyContentPatch(content, { label: next.label }, 'now');
  const plan = documentImagePlan('label', saved, { productId: 'p' });
  assert.equal(plan.rows.find(row => row[0] === labelFields.manufacturer)[1], '제조사');
  for (const key of ['material', 'countryOfOrigin', 'certification', 'dimensions']) {
    assert.equal(next.label[key], '');
    assert.equal(plan.rows.find(row => row[0] === labelFields[key])[1], '[미입력]');
  }
});

test('manual values, deliberate empty saved fields and unsaved deletions are preserved', () => {
  const content = emptyProductContent('p');
  content.label.manufacturer.value = '이전 제조사';
  content.label.importer.provenance = 'manual';
  const draft = draftOf(content); draft.manufacturer = ''; draft.contact = '직접 입력';
  const result = fillLabelDraft(draft, content, '품명', { manufacturer: '새 제조사', importer: '새 수입원', serviceContact: '새 연락처' });
  assert.equal(result.label.manufacturer, ''); assert.equal(result.label.importer, ''); assert.equal(result.label.contact, '직접 입력');
});

test('missing and malformed settings never introduce demo or invented label defaults', () => {
  const content = emptyProductContent('p');
  for (const settings of [null, [], 'invalid', { manufacturer: 3, importer: 'x'.repeat(2001), serviceContact: '\u0000bad' }]) {
    const next = fillLabelDraft(draftOf(content), content, '저장 품명', settings);
    assert.equal(next.label.productName, '저장 품명');
    assert.equal(next.label.manufacturer, ''); assert.equal(next.label.importer, ''); assert.equal(next.label.contact, '');
  }
});
