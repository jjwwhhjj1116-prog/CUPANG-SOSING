import test from 'node:test';
import assert from 'node:assert/strict';
import { syntheticSnapshot, projectionFixture, module, plain } from './helpers/supplier-hub-single-projection.mjs';

const project = module('app/supplier-hub-single-projection.ts').projectSupplierHubSingleDocument;
const path = ['logisticsPage', 'skuUnitBoxWeight'];
function fixture(value = '10', node = {}) {
  const snapshot = syntheticSnapshot(), raw = JSON.parse(snapshot.schemaString);
  raw.properties.logisticsPage.properties.skuUnitBoxWeight = { type: 'string', title: '한 개 단품 포장 무게', minLength: 1, ...node };
  raw.properties.logisticsPage.required.push('skuUnitBoxWeight');
  snapshot.schemaString = JSON.stringify(raw);
  const f = projectionFixture(snapshot), wireId = f.set(path, undefined, value);
  f.row.fields.packagedWeightG = { value, source: 'manual-option', needsReview: true, issues: [], validationIssues: [] };
  return { ...f, wireId };
}
const unbound = out => out.review.issues.filter(issue => issue.code === 'UNBOUND_SAVED_FIELD' && issue.fieldId === 'packagedWeightG');

test('the saved 10g compatibility input is represented by each exact native wire without a duplicate unbound blocker', async () => {
  const f = fixture();
  f.resolved.rows.push(...['two', 'three'].map(id => ({ ...plain(f.row), optionId: id })));
  const before = JSON.stringify(f.input), out = await project(f.input);
  assert.deepEqual(Array.from(out.payload.jsonDocument, document => document.logisticsPage.skuUnitBoxWeight), ['10', '10', '10']);
  assert.equal(unbound(out).length, 0);
  for (const row of f.resolved.rows) {
    const actual = out.review.fields.filter(field => field.optionId === row.optionId && field.fieldId === f.wireId);
    assert.equal(actual.length, 1); assert.equal(actual[0].projected, true); assert.equal(actual[0].savedValue, '10');
    assert.equal(out.review.fields.find(field => field.optionId === row.optionId && field.fieldId === 'packagedWeightG').savedValue, '10');
  }
  assert.equal(JSON.stringify(f.input), before);
});

for (const mode of ['conflict', 'blank', 'legacy-validation', 'wire-validation', 'invalid-number', 'wire-constraint', 'missing-wire-value'])
  test(`an unproven weight pair keeps its native blockers (${mode})`, async () => {
    const f = fixture(mode === 'blank' ? '' : mode === 'invalid-number' ? 'not-a-weight' : '10', mode === 'wire-constraint' ? { minLength: 3 } : {});
    if (mode === 'conflict') f.row.fields[f.wireId].value = '20';
    if (mode === 'legacy-validation') f.row.fields.packagedWeightG.validationIssues.push('포장 수량이 변경됐습니다.');
    if (mode === 'wire-validation') f.row.fields[f.wireId].validationIssues.push('현재 포장 수량을 확인해주세요.');
    if (mode === 'missing-wire-value') delete f.row.fields[f.wireId];
    const before = JSON.stringify(f.input), out = await project(f.input);
    assert.equal(unbound(out).length, 1); assert.equal(unbound(out)[0].level, 'error');
    if (mode === 'blank' || mode === 'wire-constraint') assert.ok(out.review.issues.some(issue => issue.fieldId === f.wireId && issue.code === 'TYPE_OR_CONSTRAINT'));
    if (mode === 'wire-validation') assert.ok(out.review.issues.some(issue => issue.fieldId === f.wireId && issue.code === 'VALUE_INVALID'));
    if (mode === 'missing-wire-value') assert.ok(out.review.issues.some(issue => issue.fieldId === f.wireId && issue.code === 'VALUE_MISSING'));
    if (mode === 'conflict') assert.equal(out.payload.jsonDocument[0].logisticsPage.skuUnitBoxWeight, '20');
    assert.equal(JSON.stringify(f.input), before);
  });

for (const mode of ['wrong-unit', 'read-only', 'ambiguous-peer', 'same-label-only'])
  test(`weight alias recognition does not infer a different or ambiguous physical field (${mode})`, async () => {
    const f = fixture(), wire = f.schema.fields.find(field => field.id === f.wireId);
    if (mode === 'wrong-unit') wire.unit = 'kg';
    if (mode === 'read-only') wire.readOnly = true;
    if (mode === 'ambiguous-peer') f.schema.fields.push({ ...f.schema.fields.find(field => field.id === 'packagedWeightG') });
    if (mode === 'same-label-only') { delete wire.numericText; delete wire.hubInput; }
    const out = await project(f.input);
    assert.ok(unbound(out).length >= 1);
    assert.equal(out.payload.jsonDocument[0].logisticsPage.skuUnitBoxWeight, '10');
  });

test('one valid option cannot prove a conflicting or unprojected weight in another option', async () => {
  const f = fixture(), second = { ...plain(f.row), optionId: 'second' }, third = { ...plain(f.row), optionId: 'third' };
  second.fields[f.wireId].value = '20'; delete third.fields[f.wireId]; f.resolved.rows.push(second, third);
  const out = await project(f.input);
  assert.deepEqual(Array.from(unbound(out), issue => issue.optionId), ['second', 'third']);
  assert.equal(out.payload.jsonDocument[0].logisticsPage.skuUnitBoxWeight, '10');
});
