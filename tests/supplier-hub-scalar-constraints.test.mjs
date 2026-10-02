import test from 'node:test';
import assert from 'node:assert/strict';
import { mobileIntakeHarness } from './helpers/mobile-intake.mjs';
import { hubSchemaSnapshot, schemaCompanies, schemaPath } from './helpers/hub-schema.mjs';

const plain = value => JSON.parse(JSON.stringify(value));
const h = mobileIntakeHarness(), quotes = h.load('app/quotation-schema.ts');
const scalar = h.load('app/quotation-scalar-constraints.ts');
test.after(() => h.close());
function snapshot(company = schemaCompanies[0], patch = () => {}) {
  const item = hubSchemaSnapshot(company), raw = JSON.parse(item.schemaString);
  const brand = raw.properties.productPage.properties.basicAttributes.properties.brand;
  Object.assign(brand, { minLength: 2, maxLength: 3 });
  raw.properties.productPage.properties.basicAttributes.properties.quantityChoice = {
    title: '숫자 선택', type: 'number', enum: [0.2, 0.3], multipleOf: 0.1,
  };
  raw.properties.logisticsPage.properties.calibrationOffset = {
    title: '보정값', type: 'number', exclusiveMinimum: -2, exclusiveMaximum: 2, multipleOf: 0.1,
  };
  raw.properties.legalPage.properties.emptyReference = { title: '빈 참조', type: 'string', maxLength: 0 };
  patch(raw);
  return { ...item, schemaString: JSON.stringify(raw) };
}
const schemaFor = item => quotes.getQuotationSchema(item.categoryId, schemaPath, item);
const byLabel = (schema, label) => schema.fields.find(field => field.label === label);
const change = (field, value) => [{ fieldKey: field.id, optionId: null, value }];

test('live scalar rules reach the editor validator and save validation, including zero maximum length', () => {
  const schema = schemaFor(snapshot()), brand = byLabel(schema, '브랜드'), empty = byLabel(schema, '빈 참조');
  assert.equal(schema.status, 'observed');
  assert.equal(brand.minLength, 2); assert.equal(brand.maxLength, 3); assert.equal(empty.maxLength, 0);
  assert.match(quotes.quotationValueIssues(brand, '가').join(), /최소 2자/);
  assert.throws(() => quotes.validateQuotationChanges(change(brand, '가'), { schema, optionIds: [] }), /최소 2자/);
  assert.throws(() => quotes.validateQuotationChanges(change(empty, 'a'), { schema, optionIds: [] }), /길이 제한/);
  assert.deepEqual(plain(quotes.validateQuotationChanges(change(empty, ''), { schema, optionIds: [] })), change(empty, ''));
  assert.deepEqual(plain(quotes.validateQuotationChanges(change(brand, ''), { schema, optionIds: [] })), change(brand, ''));
  assert.match(quotes.quotationValueIssues(brand, '').join(), /필수/);
  assert.match(quotes.quotationValueIssues({ ...brand, required: false }, '').join(), /최소 2자/);
  assert.match(quotes.quotationValueIssues(empty, ' ').join(), /0자 제한/);
  assert.deepEqual(plain(quotes.quotationValueIssues({ ...brand, required: false, choices: [{value:'', label:'해당사항없음'}] }, '')), []);
});

test('live string bounds count Unicode code points consistently; legacy Couplus field counting is unchanged', () => {
  const schema = schemaFor(snapshot()), brand = byLabel(schema, '브랜드');
  const value = '가😀나';
  assert.equal(value.length, 4); assert.equal(scalar.quotationValueLength(brand, value), 3);
  assert.deepEqual(plain(quotes.quotationValueIssues(brand, value)), []);
  assert.equal(quotes.validateQuotationChanges(change(brand, value), { schema, optionIds: [] })[0].value, value);
  const legacy = { ...brand, hubWire: undefined, minLength: undefined };
  assert.equal(scalar.quotationValueLength(legacy, value), 4);
  assert.match(quotes.quotationValueIssues(legacy, value).join(), /3자 제한/);
});

test('decimal steps are exact for exported JSON numbers without floating-point division tolerance', () => {
  const field = byLabel(schemaFor(snapshot()), '보정값');
  for (const value of ['0.3', '-0.3', '-3e-1', '0', '1.9']) assert.deepEqual(plain(quotes.quotationValueIssues(field, value)), [], value);
  for (const value of ['0.31', '0.300000000000001', '-0.15']) assert.match(quotes.quotationValueIssues(field, value).join(), /0.1의 배수/, value);
  assert.equal(scalar.isQuotationDecimalMultiple(0.3, 0.1), true);
  assert.equal(scalar.isQuotationDecimalMultiple(0.3, 0.2), false);
  assert.equal(scalar.isQuotationDecimalMultiple(5e-324, 5e-324), true);
  assert.equal(scalar.isQuotationDecimalMultiple(1e308, 0.01), true);
  assert.equal(scalar.isQuotationDecimalMultiple(0, 0), false);
});

test('exclusive endpoints, integer rules and invalid numeric syntax are checked before save without rewriting values', () => {
  const schema = schemaFor(snapshot()), field = byLabel(schema, '보정값');
  assert.match(quotes.quotationValueIssues(field, '-2').join(), /-2보다 큰/);
  assert.match(quotes.quotationValueIssues(field, '2').join(), /2보다 작은/);
  for (const value of ['NaN', 'Infinity', '1e999', '1e-999', '0x10', ' 0.3', '0.3kg']) assert.throws(() => quotes.validateQuotationChanges(change(field, value), { schema, optionIds: [] }), /형식과 범위/, value);
  assert.equal(quotes.validateQuotationChanges(change(field, '-3e-1'), { schema, optionIds: [] })[0].value, '-3e-1');
  const integer = { ...field, integer: true, min: -1, max: 1, multipleOf: undefined };
  assert.deepEqual(plain(quotes.quotationValueIssues(integer, '-1')), []);
  assert.match(quotes.quotationValueIssues(integer, '0.5').join(), /형식과 범위/);
  const legacy = { ...field, hubWire: undefined, exclusiveMinimum: undefined, exclusiveMaximum: undefined, multipleOf: undefined };
  assert.equal(scalar.quotationNumericValue(legacy, '-0.3'), undefined);
  assert.equal(scalar.quotationNumericValue(legacy, '3e-1'), undefined);
});

test('numeric enums cannot bypass bounds/step checks by using a select control', () => {
  const schema = schemaFor(snapshot(schemaCompanies[0], raw => { raw.properties.productPage.properties.basicAttributes.properties.quantityChoice.multipleOf = 0.2; }));
  const field = byLabel(schema, '숫자 선택');
  assert.equal(field.type, 'select'); assert.equal(field.numericValue, true);
  assert.match(quotes.quotationValueIssues(field, '0.3').join(), /0.2의 배수/);
  assert.throws(() => quotes.validateQuotationChanges(change(field, '0.3'), { schema, optionIds: [] }), /0.2의 배수/);
  assert.deepEqual(plain(quotes.quotationValueIssues(field, '0.2')), []);
  assert.match(quotes.quotationValueIssues(field, '0.4').join(), /선택값/);
});

test('malformed rules, contradictory bounds and unrepresented unions keep transmission unconfirmed', () => {
  const patches = [
    raw => { raw.properties.logisticsPage.properties.calibrationOffset.multipleOf = 0; },
    raw => { raw.properties.logisticsPage.properties.calibrationOffset.multipleOf = '0.1'; },
    raw => { raw.properties.logisticsPage.properties.calibrationOffset.exclusiveMinimum = true; },
    raw => { raw.properties.logisticsPage.properties.calibrationOffset.minimum = '1'; },
    raw => { raw.properties.logisticsPage.properties.calibrationOffset.exclusiveMinimum = 2; },
    raw => { raw.properties.logisticsPage.properties.calibrationOffset.type = ['number', 'string']; },
    raw => { raw.properties.productPage.properties.basicAttributes.properties.brand.minLength = -1; },
    raw => { raw.properties.productPage.properties.basicAttributes.properties.brand.minLength = 4; },
    raw => { raw.properties.productPage.properties.basicAttributes.properties.brand.maxLength = 1.5; },
    raw => { raw.properties.productPage.properties.basicAttributes.properties.brand.pattern = '^x'; },
  ];
  for (const patch of patches) {
    const schema = schemaFor(snapshot(schemaCompanies[0], patch));
    assert.equal(schema.status, 'unconfirmed'); assert.ok(schema.unsupportedFields.length); assert.equal(schema.submissionReady, false);
  }
});

test('numeric constraints ignore inapplicable string keywords and number/integer union accepts decimals', () => {
  const schema = schemaFor(snapshot(schemaCompanies[0], raw => {
    Object.assign(raw.properties.logisticsPage.properties.calibrationOffset, { type: ['integer', 'number'], minLength: 10, maxLength: 0 });
  }));
  const field = byLabel(schema, '보정값');
  assert.equal(schema.status, 'observed'); assert.equal(field.integer, false); assert.equal(field.minLength, undefined);
  assert.deepEqual(plain(quotes.quotationValueIssues(field, '-0.3')), []);
});

test('a changed live field constraint invalidates reusable attribute rules rather than retaining an old signature', () => {
  const before = schemaFor(snapshot()), field = byLabel(before, '브랜드'), rules = h.load('app/quotation-attribute-rules.ts');
  const input = JSON.stringify({ format: 'sourceflow-attribute-rules-v1', categoryId: before.categoryId,
    rules: [{ sourceName: '상품속성: 브랜드', fieldId: field.id, fieldSignature: JSON.stringify(field) }] });
  assert.equal(rules.readAttributeRules(input, before).rules[0].fieldId, field.id);
  const after = schemaFor(snapshot(schemaCompanies[0], raw => { raw.properties.productPage.properties.basicAttributes.properties.brand.minLength = 3; }));
  assert.throws(() => rules.readAttributeRules(input, after), /양식이 변경/);
});

test('both companies preserve URL drafts and manual overrides while save/export share scalar rules and frozen category snapshots', async () => {
  for (const company of schemaCompanies) {
    const local = mobileIntakeHarness({ companyCode: company.code, companyName: company.name });
    try {
      const snap = snapshot(company), input = { name: '시험 최종분류', categoryId: snap.categoryId, categoryPath: schemaPath, template: null, mappings: [], hubSchema: snap };
      const api = local.load('app/api/category-profiles/route.ts');
      const post = await api.POST(new Request('https://app.test/api/category-profiles', { method: 'POST', headers: { 'content-type': 'application/json', 'Idempotency-Key': crypto.randomUUID() }, body: JSON.stringify(input) }));
      assert.equal(post.status, 201, await post.clone().text()); const { profile } = await post.json();
      local.context.category = profile;
      local.sqlite.prepare('UPDATE collection_context SET payload=? WHERE job_id=?').run(JSON.stringify(local.context), 'job');
      assert.match(await local.intake(), /상품 초안 저장됨/);
      const product = local.sqlite.prepare('SELECT * FROM products').get(), path = '/api/products/' + product.id + '/quotation-fields';
      let view = await (await local.route(path)).json();
      const brand = byLabel(view.resolved.schema, '브랜드'), number = byLabel(view.resolved.schema, '보정값'), choice = byLabel(view.resolved.schema, '숫자 선택');
      const save = changes => local.route(path, { method: 'PUT', body: { expectedRevision: view.revision, expectedInputFingerprint: view.inputFingerprint, changes } });
      const invalid = await save(change(number, '0.31')); assert.equal(invalid.status, 400);
      assert.equal((await (await local.route(path)).json()).revision, view.revision);
      const put = await save([...change(brand, '가😀나'), ...change(number, '-3e-1'), ...change(choice, '0.3')]);
      assert.equal(put.status, 200, await put.clone().text()); view = await (await local.route(path)).json();
      assert.equal(view.resolved.rows[0].fields[number.id].value, '-3e-1');
      assert.equal(view.resolved.rows[0].fields[brand.id].source, 'manual-common');
      const source = await local.load('app/exports/quotation-source.ts').readQuotationExportSource('owner', product.id, profile.id);
      const resolved = local.load('app/exports/quotation-source.ts').resolveQuotationExport(source);
      const rows = local.load('app/exports/quotation-fields.ts').resolvedQuotationRows(source, resolved, []);
      assert.equal(rows.length, 6); assert.equal(rows[0][brand.id], '가😀나');
      assert.equal(rows[0][number.id], -0.3); assert.equal(rows[0][choice.id], 0.3); assert.equal(typeof rows[0][choice.id], 'number');
      const next = snapshot(company, raw => { raw.properties.logisticsPage.properties.calibrationOffset.multipleOf = 0.2; });
      const update = await api.PUT(new Request('https://app.test/api/category-profiles', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: profile.id, expectedRevision: profile.revision, profile: { ...input, hubSchema: next } }) }));
      assert.equal(update.status, 200, await update.clone().text());
      const unchanged = await (await local.route(path)).json();
      assert.equal(byLabel(unchanged.resolved.schema, '보정값').multipleOf, 0.1);
      assert.equal(unchanged.resolved.rows[0].fields[number.id].value, '-3e-1');
      assert.deepEqual(unchanged.resolved.rows[0].fields[number.id].validationIssues, []);
      assert.ok(!local.network.includes('supplier.coupang.com'));
    } finally { local.close(); }
  }
});
