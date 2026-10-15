import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import ts from 'typescript';
import { createRequire } from 'node:module';
import { companies, json } from './helpers/image-download-ui.mjs';
import { detailSaveFixture } from './helpers/detail-save-fixture.mjs';
import { hubSchemaSnapshot, schemaPath } from './helpers/hub-schema.mjs';

const native = createRequire(import.meta.url), modules = new Map(); let providerRequests = 0;
function load(file) {
  if (modules.has(file)) return modules.get(file);
  const exports = {}; modules.set(file, exports);
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../' + file, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { exports, structuredClone, TextEncoder, fetch() { providerRequests++; throw Error('No provider request is permitted'); }, require(name) {
    if (name.startsWith('@/')) return load(name.slice(2) + '.ts');
    if (name.startsWith('./')) return load(path.posix.join(path.posix.dirname(file), name) + '.ts');
    return native(name);
  } });
  return exports;
}
const compare = load('app/quotation-exposed-duplicates.ts').quotationExposedAttributeComparison;
const inspect = load('app/submission-review.ts').inspectSubmission;
const plain = value => JSON.parse(JSON.stringify(value));
const cell = value => ({ value, source: 'manual-option', issues: [], validationIssues: [], reviewMessages: [], needsReview: false });
const field = (id, label = id, more = {}) => ({ id, label, section: 'product', visibility: 'exposed', type: 'text', required: false, ...more });
const row = (id, values, included = true) => ({ optionId: id, optionLabel: `옵션명은 비교하지 않음 ${id}`, included,
  fields: Object.fromEntries(Object.entries(values).map(([id, value]) => [id, cell(value)])) });
const resolved = (fields = [field('color', '색상'), field('size', '사이즈')], rows = [row('one', { color: '검정', size: 'M' }), row('two', { color: '검정', size: 'M' })]) => ({
  schema: { categoryId: '80719', categoryPath: ['시험'], status: 'observed', fields }, rows, issues: [], validationIssues: [], reviewMessages: [],
});
const wire = (name, direct = false, keys = ['attributeName', 'attributeValue']) => ({ path: direct ? ['productPage', 'exposedAttributes'] : ['productPage', 'commonAttributes', 'exposedAttributes'], name, nameKey: keys[0], valueKey: keys[1] });

test('observed fallback compares included real options in original order without common, excluded or display names', () => {
  const value = resolved(undefined, [row(null, { color: '검정', size: 'M' }), row('z', { color: '검정', size: 'M' }), row('excluded', {}, false),
    row('different', { color: '하양', size: 'M' }), row('a', { color: '검정', size: 'M' }), row('b', { color: '하양', size: 'M' })]);
  const before = JSON.stringify(value), result = plain(compare(value));
  assert.deepEqual(result, { status: 'compared', fields: [{ fieldId: 'color', label: '색상' }, { fieldId: 'size', label: '사이즈' }], groups: [
    { optionIds: ['z', 'a'], values: [{ fieldId: 'color', value: '검정' }, { fieldId: 'size', value: 'M' }] },
    { optionIds: ['different', 'b'], values: [{ fieldId: 'color', value: '하양' }, { fieldId: 'size', value: 'M' }] },
  ] });
  assert.equal(JSON.stringify(value), before); assert.equal(providerRequests, 0);
});

test('known observed80719 fallback uses saved exposed color, quantity and size rather than a label guess', () => {
  const schema = load('app/quotation-schema.ts').getQuotationSchema('80719'), fields = schema.fields.filter(field => field.section === 'product' && field.visibility === 'exposed');
  assert.equal(schema.status, 'observed'); assert.deepEqual(plain(fields.map(field => field.id)), ['color', 'quantity', 'size']);
  const values = { color: '검정', quantity: '1', size: 'M' }, input = { ...resolved(schema.fields, [row('one', values), row('two', values)]), schema };
  assert.equal(compare(input).status, 'compared'); assert.equal(compare(input).groups.length, 1);
  input.rows[1].fields.quantity.value = '1.0'; assert.equal(compare(input).groups.length, 0);
  assert.equal(providerRequests, 0);
});

test('blank, whitespace, numeric text and 해당사항없음 compare as exact strings with no normalization', () => {
  const values = ['', ' ', '해당사항없음', '1', '1.0', '01', '검정', '검정 '];
  const input = resolved([field('value', '수량', { type: 'number' })], values.flatMap((value, i) => [row(`left-${i}`, { value }), row(`right-${i}`, { value })]));
  const result = compare(input);
  assert.equal(result.groups.length, values.length);
  result.groups.forEach((group, i) => { assert.deepEqual(plain(group.optionIds), [`left-${i}`, `right-${i}`]); assert.equal(group.values[0].value, values[i]); });
  input.rows[1].fields.value.value = 0; assert.equal(compare(input).status, 'unavailable');
});

test('exact tuple grouping cannot collide on delimiters, embedded quotes or line breaks', () => {
  const input = resolved([field('first'), field('second')], [row('one', { first: 'a|b', second: 'c' }), row('two', { first: 'a', second: 'b|c' }),
    row('three', { first: 'a\n"b', second: '\u0000c' }), row('four', { first: 'a\n"b', second: '\u0000c' })]);
  assert.deepEqual(plain(compare(input).groups.map(group => group.optionIds)), [['three', 'four']]);
});

test('official named wires take precedence over fallback aliases and keep schema order', () => {
  const input = resolved([field('fallback-color', '색상'), field('official-size', '크기', { hubWire: wire('크기') }),
    field('official-color', '색상', { hubWire: wire('색상', true, ['name', 'value']) }), field('hidden', '숨김', { visibility: 'hidden' }),
    field('legal', '법적', { section: 'legal' })], [row('one', { 'official-size': 'M', 'official-color': '검정', 'fallback-color': '다른 alias' }),
    row('two', { 'official-size': 'M', 'official-color': '검정', 'fallback-color': '완전히 다른 alias' })]);
  const result = compare(input);
  assert.deepEqual(plain(result.fields), [{ fieldId: 'official-size', label: '크기' }, { fieldId: 'official-color', label: '색상' }]);
  assert.deepEqual(plain(result.groups[0].optionIds), ['one', 'two']);
  assert.equal(result.groups[0].values[0].fieldId, 'official-size');
});

test('both compiled official attribute key pairs and exposed path forms compare their exact saved value fields', () => {
  const model = load('app/quotation-schema.ts');
  for (const direct of [false, true]) for (const keys of [['name', 'value'], ['attributeName', 'attributeValue']]) {
    const snapshot = hubSchemaSnapshot(), raw = JSON.parse(snapshot.schemaString);
    const exposed = raw.properties.productPage.properties.commonAttributes.properties.exposedAttributes;
    for (const item of exposed.allOf) {
      const properties = item.contains.properties;
      item.contains.properties = { [keys[0]]: properties.name, [keys[1]]: properties.value };
    }
    if (direct) {
      raw.properties.productPage.properties.exposedAttributes = exposed;
      delete raw.properties.productPage.properties.commonAttributes.properties.exposedAttributes;
    }
    snapshot.schemaString = JSON.stringify(raw);
    const schema = model.getQuotationSchema(snapshot.categoryId, schemaPath, snapshot);
    assert.equal(schema.status, 'observed');
    const official = schema.fields.filter(field => field.section === 'product' && field.visibility === 'exposed' && field.hubWire);
    assert.equal(official.length, 2);
    const values = Object.fromEntries(official.map(field => [field.id, field.choices ? 'UV' : '검정']));
    const input = { ...resolved(schema.fields, [row('first', values), row('second', values)]), schema };
    const result = compare(input); assert.equal(result.status, 'compared'); assert.equal(result.groups.length, 1);
    assert.deepEqual(plain(result.fields.map(field => field.fieldId)), official.map(field => field.id));
    assert.equal(official[0].hubWire.nameKey, keys[0]); assert.equal(official[0].hubWire.valueKey, keys[1]);
  }
});

test('duplicate labels get stable field IDs while duplicate IDs or exact named wire identities are unavailable', () => {
  const input = resolved([field('first', '수량'), field('second', '수량')], [row('one', { first: '1', second: '2' }), row('two', { first: '1', second: '2' })]);
  assert.deepEqual(plain(compare(input).fields.map(field => field.label)), ['수량 (first)', '수량 (second)']);
  input.schema.fields[1].id = 'first'; assert.equal(compare(input).status, 'unavailable');
  input.schema.fields = [field('one', '색상', { hubWire: wire('색상') }), field('two', '다른 라벨', { hubWire: wire('색상') })];
  assert.equal(compare(input).status, 'unavailable');
  input.schema.fields = [field('one', '색상', { hubWire: wire('색상') }), field('one', '별칭')]; assert.equal(compare(input).status, 'unavailable');
});

test('unconfirmed category, missing fields/cells, malformed included IDs and unsupported wires never look clean', () => {
  const mutations = [input => input.schema.status = 'unconfirmed', input => input.schema.categoryId = null, input => input.schema.fields = [],
    input => delete input.rows[0].fields.size, input => input.rows[0].fields.size.value = null, input => input.rows[0].optionId = '',
    input => input.rows[0].optionId = 'bad/id', input => input.rows[1].optionId = 'one', input => input.schema.fields[0].type = 'images',
    input => input.schema.fields[0].hubWire = { path: ['productPage', 'unexposedAttributes'], name: '색상', nameKey: 'name', valueKey: 'value' },
    input => input.schema.fields[0].hubWire = { path: ['productPage', 'exposedAttributes'] },
    input => input.schema.fields[0].hubWire = { ...wire('색상'), valueKey: 'attributeName' }];
  for (const mutate of mutations) {
    const input = resolved(); mutate(input); const result = compare(input);
    assert.equal(result.status, 'unavailable'); assert.deepEqual(plain(result.groups), []); assert.deepEqual(plain(result.fields), []);
  }
});

test('draft reader compares only scalar included cells, supports undo and handles rejected reads without changing saved input', () => {
  const input = resolved(), before = JSON.stringify(input), calls = [], draft = new Map([['two:size', 'L']]);
  const read = (optionId, fieldId) => { calls.push([optionId, fieldId]); return draft.get(`${optionId}:${fieldId}`) ?? input.rows.find(row => row.optionId === optionId).fields[fieldId].value; };
  assert.equal(compare(input, read).groups.length, 0); assert.deepEqual(calls, [['one', 'color'], ['one', 'size'], ['two', 'color'], ['two', 'size']]);
  draft.clear(); assert.equal(compare(input, read).groups.length, 1); assert.equal(JSON.stringify(input), before);
  assert.equal(compare(input, () => { throw Error('late unavailable draft'); }).status, 'unavailable');
  assert.equal(compare(input, () => 1).status, 'unavailable'); assert.equal(providerRequests, 0);
});

test('200 included rows and 400 exposed fields are bounded exactly with no partial groups on overflow', () => {
  const fields = Array.from({ length: 400 }, (_, i) => field(`f-${i}`)), values = Object.fromEntries(fields.map(field => [field.id, '']));
  const input = resolved(fields, Array.from({ length: 200 }, (_, i) => row(`row-${i}`, values)));
  const result = compare(input); assert.equal(result.status, 'compared'); assert.equal(result.fields.length, 400); assert.equal(result.groups[0].optionIds.length, 200);
  input.rows.push(row('overflow', values)); assert.equal(compare(input).status, 'unavailable'); input.rows.pop();
  input.schema.fields.push(field('extra')); assert.equal(compare(input).status, 'unavailable');
  assert.equal(providerRequests, 0);
});

test('submission integration adds option-specific review reminders without adding errors or changing gating', () => {
  const input = resolved(), baseline = inspect({ ...input, rows: [input.rows[0]] }, []), report = inspect(input, []);
  const issues = report.issues.filter(issue => issue.code === 'DUPLICATE_EXPOSED_ATTRIBUTES');
  assert.equal(report.errorCount, baseline.errorCount); assert.equal(report.reviewCount, baseline.reviewCount + 2);
  assert.equal(report.submissionReady, false); assert.equal(report.transport, 'not-connected');
  assert.deepEqual(plain(issues.map(issue => [issue.kind, issue.optionId, issue.fieldId])), [['review', 'one', 'color'], ['review', 'two', 'color']]);
  assert.ok(issues.every(issue => issue.message.includes('2개') && issue.message.includes('상품 속성')));
  input.rows[1].fields.size.value = 'L'; assert.equal(inspect(input, []).issues.some(issue => issue.code === 'DUPLICATE_EXPOSED_ATTRIBUTES'), false);
});

for (const company of companies) test(`saved quotation duplicate reviews flow through real API, preview and XLSX/ZIP unchanged (${company.companyCode})`, async () => {
  const f = await detailSaveFixture(company);
  try {
    const fields = f.view.resolved.schema.fields.filter(field => field.section === 'product' && field.visibility === 'exposed' && field.hubWire);
    assert.equal(fields.length, 2);
    const ids = f.view.resolved.rows.flatMap(row => row.optionId ? [row.optionId] : []), changes = ids.flatMap(optionId => fields.map(field => ({ optionId, fieldKey: field.id, value: field.choices ? 'UV' : '검정' })));
    f.view = await json(await f.api.route(f.qurl, { method: 'PUT', body: { expectedRevision: f.view.revision, expectedInputFingerprint: f.view.inputFingerprint, changes } }));
    const included = f.view.resolved.rows.filter(row => row.optionId && row.included).map(row => row.optionId), retained = f.retained(), networks = f.api.network.length, providers = f.api.aiSources.length;
    const comparison = compare(f.view.resolved); assert.equal(comparison.status, 'compared'); assert.deepEqual(plain(comparison.groups[0].optionIds), included);
    const review = await json(await f.api.route(f.base + '/submission-review?profileId=' + f.view.categoryContext.profileId));
    const duplicateIssues = review.issues.filter(issue => issue.code === 'DUPLICATE_EXPOSED_ATTRIBUTES');
    assert.deepEqual(duplicateIssues.map(issue => issue.optionId), included); assert.ok(duplicateIssues.every(issue => issue.kind === 'review' && issue.fieldId === fields[0].id));
    const preview = await json(await f.api.route(f.base + '/quotation', { method: 'POST', body: { action: 'preview', profileId: f.view.categoryContext.profileId } }));
    assert.deepEqual(preview.submissionReview.issues.filter(issue => issue.code === 'DUPLICATE_EXPOSED_ATTRIBUTES'), duplicateIssues);
    assert.equal(f.retained(), retained, 'comparison, review and preview never mutate saved state');
    const exported = await f.exportQuote(), archivedReview = JSON.parse(new TextDecoder().decode(exported.archive.get('submission-review.json')));
    assert.deepEqual(archivedReview.issues.filter(issue => issue.code === 'DUPLICATE_EXPOSED_ATTRIBUTES'), duplicateIssues);
    for (const row of exported.document.rows) for (const field of fields) assert.equal(row.fields[field.id].value, field.choices ? 'UV' : '검정');
    assert.equal(f.retained(), retained); assert.equal(f.api.network.length, networks); assert.equal(f.api.aiSources.length, providers);
    const fix = included[0]; f.view = await json(await f.api.route(f.qurl));
    f.view = await json(await f.api.route(f.qurl, { method: 'PUT', body: { expectedRevision: f.view.revision, expectedInputFingerprint: f.view.inputFingerprint,
      changes: [{ optionId: fix, fieldKey: fields[0].id, value: fields[0].choices ? '' : '서로 다른 실제 속성' }] } }));
    const after = await json(await f.api.route(f.base + '/submission-review?profileId=' + f.view.categoryContext.profileId));
    assert.ok(!after.issues.some(issue => issue.code === 'DUPLICATE_EXPOSED_ATTRIBUTES' && issue.optionId === fix));
  } finally { f.api.close(); }
});
