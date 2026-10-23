import test from 'node:test';
import assert from 'node:assert/strict';
import { syntheticSnapshot, projectionFixture, module, plain } from './helpers/supplier-hub-single-projection.mjs';

const project = module('app/supplier-hub-single-projection.ts').projectSupplierHubSingleDocument;
const validate = module('app/quotation-schema.ts').quotationValueIssues;
const path = ['logisticsPage', 'skuUnitBoxDimension'];
function fixture({ node = {}, required = true, value = '', source = 'manual-option', validation = true } = {}) {
  const snapshot = syntheticSnapshot(), raw = JSON.parse(snapshot.schemaString);
  raw.properties.logisticsPage.properties.skuUnitBoxDimension = { type: 'string', title: '한 개 단품 포장 사이즈', minLength: 1, ...node };
  if (required) raw.properties.logisticsPage.required.push('skuUnitBoxDimension');
  snapshot.schemaString = JSON.stringify(raw);
  const f = projectionFixture(snapshot), id = f.set(path, undefined, value, source);
  const field = f.schema.fields.find(field => field.id === id);
  if (validation) f.row.fields[id].validationIssues = validate(field, value, [], source);
  return { ...f, id };
}
const errors = out => out.review.issues.filter(issue => issue.level === 'error' && issue.path?.join('.') === path.join('.'));
const projected = out => out.payload.jsonDocument[0].logisticsPage.skuUnitBoxDimension;

test('three required blank packaging dimensions each keep one required blocker without a duplicate length error', async () => {
  const f = fixture();
  assert.equal(f.id, 'packagedDimensionsMm');
  f.resolved.rows.push(...['two', 'three'].map(optionId => ({ ...plain(f.row), optionId })));
  const before = JSON.stringify(f.input), out = await project(f.input);
  assert.deepEqual(Array.from(errors(out), issue => [issue.optionId, issue.code, issue.message]), f.resolved.rows.map(row => [row.optionId, 'VALUE_INVALID', '필수 값이 비어 있습니다.']));
  assert.deepEqual(Array.from(out.payload.jsonDocument, document => document.logisticsPage.skuUnitBoxDimension), ['', '', '']);
  assert.equal(out.review.documentShapeComplete, false);
  assert.equal(JSON.stringify(f.input), before);
});

for (const validation of [undefined, [], ['다른 항목을 확인해주세요.']]) test(`an unvalidated required blank retains the raw length blocker (${JSON.stringify(validation)})`, async () => {
  const f = fixture({ validation: false }); f.row.fields[f.id].validationIssues = validation;
  const out = await project(f.input);
  assert.ok(errors(out).some(issue => issue.code === 'TYPE_OR_CONSTRAINT'));
  assert.equal(out.review.documentShapeComplete, false);
});

for (const source of ['manual-option', 'manual-common', 'schema', 'couplus-default', 'empty']) test(`an already validated required blank stays blocked once (${source})`, async () => {
  const f = fixture({ source }), out = await project(f.input);
  assert.deepEqual(Array.from(errors(out), issue => issue.code), ['VALUE_INVALID']);
  assert.equal(out.review.documentShapeComplete, false);
});

test('optional manual empty strings retain raw minLength validation even with an unrelated required-message diagnostic', async () => {
  const f = fixture({ required: false }); f.row.fields[f.id].validationIssues.push('필수 값이 비어 있습니다.');
  const out = await project(f.input);
  assert.equal(projected(out), '');
  assert.ok(errors(out).some(issue => issue.code === 'TYPE_OR_CONSTRAINT'));
  assert.equal(out.review.documentShapeComplete, false);
});

for (const value of ['1', '100*100*100']) test(`nonempty string constraints remain enforced (${value})`, async () => {
  const f = fixture({ node: { minLength: 3, maxLength: 7 }, value });
  // Even a retained required notice cannot suppress a real nonempty violation.
  f.row.fields[f.id].validationIssues.push('필수 값이 비어 있습니다.');
  const out = await project(f.input);
  assert.equal(projected(out), value);
  assert.ok(errors(out).some(issue => issue.code === 'TYPE_OR_CONSTRAINT'));
});

test('allowed empty and null choices keep their exact primitive values without invented required blockers', async () => {
  for (const [node, expected] of [[{ enum: ['', '100*100*100'], minLength: 0 }, ''], [{ type: ['string', 'null'], enum: [null, '100*100*100'] }, null]]) {
    const f = fixture({ node }), out = await project(f.input);
    assert.equal(projected(out), expected);
    assert.equal(errors(out).length, 0);
  }
});

test('an allowed empty enum that violates minLength still fails the raw constraint', async () => {
  const f = fixture({ node: { enum: ['', '100*100*100'] } }), out = await project(f.input);
  assert.equal(f.row.fields[f.id].validationIssues.length, 0);
  assert.ok(errors(out).some(issue => issue.code === 'TYPE_OR_CONSTRAINT'));
});

test('required blank enum and invalid null type errors are never hidden by a required-value diagnostic', async () => {
  for (const node of [{ enum: ['100*100*100'] }, { default: null }]) {
    const f = fixture({ node, source: 'schema' }), out = await project(f.input);
    assert.ok(errors(out).some(issue => issue.code === 'VALUE_INVALID'));
    assert.ok(errors(out).some(issue => issue.code === 'TYPE_OR_CONSTRAINT'));
  }
});
