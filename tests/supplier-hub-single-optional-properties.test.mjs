import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { syntheticSnapshot, projectionFixture, module } from './helpers/supplier-hub-single-projection.mjs';

const project = module('app/supplier-hub-single-projection.ts').projectSupplierHubSingleDocument;
const path = ['logisticsPage', 'optionalSelection'];
function fixture(node = { type: 'string', enum: ['Y', 'N'] }, required = false) {
  const snapshot = syntheticSnapshot(), raw = JSON.parse(snapshot.schemaString);
  raw.properties.logisticsPage.properties.optionalSelection = { title: '합성 선택 항목', ...node };
  if (required) raw.properties.logisticsPage.required.push('optionalSelection');
  snapshot.schemaString = JSON.stringify(raw);
  return projectionFixture(snapshot);
}
const projected = result => result.payload.jsonDocument[0].logisticsPage;
const errors = result => result.review.issues.filter(issue => issue.path?.join('.') === path.join('.') && issue.level === 'error');

test('an absent optional property is omitted instead of serialized as an invalid empty enum choice', async () => {
  const f = fixture(), before = JSON.stringify(f.input), out = await project(f.input);
  assert.equal(Object.hasOwn(projected(out), 'optionalSelection'), false);
  assert.equal(errors(out).length, 0);
  const entry = out.review.fields.find(field => field.path.join('.') === path.join('.'));
  assert.equal(entry.source, 'empty'); assert.equal(entry.savedValue, ''); assert.equal(entry.projected, false);
  assert.equal(JSON.stringify(f.input), before);
});

test('optional absent text can be omitted while pre-existing validation diagnostics remain visible', async () => {
  const f = fixture({ type: 'string', minLength: 1 });
  const id = f.set(path, undefined, '', 'empty');
  f.row.fields[id].validationIssues = ['최소 1자 이상 입력해주세요.', '수집된 값 확인이 필요합니다.'];
  const out = await project(f.input);
  assert.equal(Object.hasOwn(projected(out), 'optionalSelection'), false);
  assert.deepEqual(Array.from(errors(out), issue => issue.message), ['최소 1자 이상 입력해주세요.', '수집된 값 확인이 필요합니다.']);
  assert.equal(out.review.documentShapeComplete, false);
});

for (const source of ['manual-common', 'manual-option', 'couplus-default', 'schema', 'settings', 'content', 'option'])
  test(`a supplied optional blank remains invalid and is not silently omitted (${source})`, async () => {
    const f = fixture(); f.set(path, undefined, '', source);
    const out = await project(f.input);
    assert.ok(errors(out).some(issue => issue.code === 'TYPE_OR_CONSTRAINT'));
  });

test('required object properties and invalid nonblank optional selections retain exact enum validation', async () => {
  const required = fixture(undefined, true), requiredOut = await project(required.input);
  assert.ok(errors(requiredOut).some(issue => issue.code === 'TYPE_OR_CONSTRAINT'));
  const invalid = fixture(); invalid.set(path, undefined, '알 수 없는 선택', 'empty');
  assert.ok(errors(await project(invalid.input)).some(issue => issue.code === 'TYPE_OR_CONSTRAINT'));
});

for (const [enumValues, type, value] of [[['', 'Y'], 'string', ''], [[null, 'Y'], ['string', 'null'], null]])
  test(`an allowed empty or null enum choice remains present (${value === null ? 'null' : 'empty'})`, async () => {
    const f = fixture({ type, enum: enumValues }), out = await project(f.input);
    assert.equal(Object.hasOwn(projected(out), 'optionalSelection'), true);
    assert.equal(projected(out).optionalSelection, value);
    assert.equal(errors(out).length, 0);
  });

test('schema defaults cannot be mistaken for absent input, including null and empty strings', async () => {
  const explicit = fixture({ type: 'string', enum: ['Y', 'N'], default: 'Y' });
  assert.ok(errors(await project(explicit.input)).some(issue => issue.code === 'TYPE_OR_CONSTRAINT'));
  const nullable = fixture({ type: ['string', 'null'], default: null });
  nullable.set(path, undefined, '', 'schema');
  const fromSchema = await project(nullable.input);
  assert.equal(projected(fromSchema).optionalSelection, null); assert.equal(errors(fromSchema).length, 0);
  nullable.set(path, undefined, '', 'manual-option');
  assert.equal(projected(await project(nullable.input)).optionalSelection, '');
  const empty = fixture({ type: ['string', 'null'], default: '' }); empty.set(path, undefined, '', 'schema');
  assert.equal(projected(await project(empty.input)).optionalSelection, '');
});

test('an invalid null default still fails its declared type or exact enum constraint', async () => {
  for (const node of [{ type: 'string', default: null }, { type: ['string', 'null'], enum: ['Y', 'N'], default: null }]) {
    const f = fixture(node); f.set(path, undefined, '', 'schema');
    assert.ok(errors(await project(f.input)).some(issue => issue.code === 'TYPE_OR_CONSTRAINT'));
  }
});

test('named-array null defaults and explicit string clears retain their exact values', async () => {
  const f = projectionFixture(), namedPath = ['productPage', 'unexposedAttributes'];
  f.set(namedPath, '수동 공란', '', 'couplus-default');
  let out = await project(f.input);
  assert.equal(out.payload.jsonDocument[0].productPage.unexposedAttributes.find(item => item.attributeName === '수동 공란').attributeValue, null);
  f.set(namedPath, '수동 공란', '', 'manual-option'); out = await project(f.input);
  assert.equal(out.payload.jsonDocument[0].productPage.unexposedAttributes.find(item => item.attributeName === '수동 공란').attributeValue, '');
});

const recorded = new URL('../outputs/step650-official-81452-profile-after.json', import.meta.url);
test('retained actual Single schema omits absent optional enum properties without inferring regulatory choices', { skip: !fs.existsSync(recorded) }, async () => {
  const bytes = fs.readFileSync(recorded), before = createHash('sha256').update(bytes).digest('hex');
  const f = projectionFixture(JSON.parse(bytes).hubSchema), raw = JSON.parse(f.snapshot.schemaString), out = await project(f.input);
  const absent = [['legalPage', 'msds'], ...['shippedOnHanger', 'fashionYear', 'fashionSeason', 'temperature', 'livestock', 'producedAtManaged', 'manufacturedAtManaged'].map(key => ['logisticsPage', key])];
  for (const [page, key] of absent) {
    assert.ok(!raw.properties[page].required.includes(key));
    assert.equal(Object.hasOwn(out.payload.jsonDocument[0][page], key), false, page + '.' + key);
    assert.ok(!out.review.issues.some(issue => issue.level === 'error' && issue.path?.join('.') === [page, key].join('.')));
    const field = f.schema.fields.find(field => field.hubWire?.path.join('.') === [page, key].join('.'));
    assert.equal(field.draftDefault, undefined); assert.equal(field.schemaDefault, undefined);
  }
  // Human-facing requirement annotations are not the JSON required list.
  assert.equal(raw.properties.logisticsPage.properties.fashionYear.requirement, '필수');
  assert.ok(out.review.issues.some(issue => issue.code === 'TYPE_OR_CONSTRAINT' && issue.path?.join('.') === 'productPage.businessType'));
  // The prefilled notice-name default has its own source and is never omitted.
  assert.equal(Object.hasOwn(out.payload.jsonDocument[0].legalPage, 'productNoticeName'), true);
  assert.equal(createHash('sha256').update(fs.readFileSync(recorded)).digest('hex'), before);
});
