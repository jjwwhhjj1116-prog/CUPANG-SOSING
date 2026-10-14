import test from 'node:test';
import assert from 'node:assert/strict';
import { aiModule, aiFixture, companies, mockProvider, plain } from './helpers/quotation-ai.mjs';
const code = expected => error => error.code === expected && error.uncertain === false;

for (const company of companies) test(`${company.name}: exact owned schema/wires/choices and proposals never write the saved source`, async () => {
  const m = aiModule(), f = aiFixture({ company }), before = JSON.stringify(f.saved), plan = m.buildQuotationAiPlan(f.saved, f.scope);
  assert.deepEqual(plain(plan.company), company); assert.equal(plan.clocks.optionRevision, f.options.revision);
  assert.ok(plan.fields.every(field => field.hubWire.name && field.hubWire.path.length >= 2));
  assert.ok(plan.fields.every(field => !['image', 'logistics'].includes(field.section) && !/KC/u.test(field.label)));
  const provider = mockProvider(), result = await m.executeQuotationAi(plan, provider);
  assert.ok(result.changes.length); assert.equal(result.model, m.QUOTATION_AI_MODEL);
  assert.equal(JSON.stringify(f.saved), before); assert.ok(result.warnings.some(item => item.includes('추론')));
  assert.deepEqual(provider.calls.map(call => call.request.task), ['ANALYZE_SCHEMA_ATTRIBUTES', 'GET_COMMON_UNEXPOSED_ATTRIBUTES', 'GET_COMMON_OTHER_ATTRIBUTES', 'GET_DIFFERENTIATED_ATTRIBUTES_BATCH_1']);
});
test('21 exact option IDs are differentiated in sequential batches of 10,10,1; leading zeroes survive', async () => {
  const m = aiModule(), f = aiFixture({ count: 21 }), plan = m.buildQuotationAiPlan(f.saved, f.scope), provider = mockProvider();
  const result = await m.executeQuotationAi(plan, provider), batches = provider.calls.filter(call => call.request.task.startsWith('GET_DIFFERENTIATED'));
  assert.deepEqual(batches.map(call => call.request.targets.length), [10, 10, 1]);
  assert.equal(result.changes[0].optionId, '00000001'); assert.equal(result.changes.at(-1).optionId, '00000021');
  assert.deepEqual(batches.map(call => call.request.facts.options.map(item => item.optionId)), plain([plan.targets.slice(0, 10), plan.targets.slice(10, 20), plan.targets.slice(20)].map(items => items.map(item => item.optionId))));
});
test('selected option only; excluded and foreign options cannot enter the request or receive common proposals', async () => {
  const m = aiModule(), f = aiFixture({ count: 3 }), excluded = f.excluded(), chosen = f.options.rows[1].id;
  const plan = m.buildQuotationAiPlan(f.saved, { optionId: chosen, applyToAllOptions: false }), result = await m.executeQuotationAi(plan, mockProvider());
  assert.deepEqual(plain(plan.targets.map(item => item.optionId)), [chosen]); assert.ok(result.changes.every(item => item.optionId === chosen));
  assert.throws(() => m.buildQuotationAiPlan(f.saved, { optionId: excluded, applyToAllOptions: false }), code('AI_SCOPE'));
  assert.throws(() => m.buildQuotationAiPlan(f.saved, { optionId: 'foreign', applyToAllOptions: true }), code('AI_SCOPE'));
  assert.throws(() => m.buildQuotationAiPlan(f.saved, { optionId: null, applyToAllOptions: false }), code('OPTION_REQUIRED'));
});
test('hidden settings disabled skip hidden generation and do not propose hidden fields', async () => {
  const m = aiModule(), f = aiFixture({ hidden: false }), plan = m.buildQuotationAiPlan(f.saved, f.scope), provider = mockProvider();
  const result = await m.executeQuotationAi(plan, provider);
  assert.ok(plan.fields.every(field => field.group !== 'hidden')); assert.ok(!result.steps.some(item => item.task === 'GET_COMMON_UNEXPOSED_ATTRIBUTES'));
});
test('manual-common and manual-option blanks are protected independently; unchanged source is preserved', async () => {
  const m = aiModule(), f = aiFixture(), initial = m.buildQuotationAiPlan(f.saved, f.scope);
  const color = initial.fields.find(field => field.hubWire.name === '색상').id, size = initial.fields.find(field => field.hubWire.name === '사이즈').id;
  f.state.overrides.common[size] = ''; f.state.overrides.options[f.options.rows[0].id] = { [color]: '' };
  const plan = m.buildQuotationAiPlan(f.saved, f.scope), before = JSON.stringify(f.saved), result = await m.executeQuotationAi(plan, mockProvider());
  assert.ok(plan.targets.every(target => target.protectedValues.some(value => value.fieldKey === size && value.value === '')));
  assert.ok(!result.changes.some(item => item.fieldKey === size || item.fieldKey === color && item.optionId === f.options.rows[0].id));
  assert.ok(result.changes.some(item => item.fieldKey === color && item.optionId === f.options.rows[1].id)); assert.equal(JSON.stringify(f.saved), before);
});
test('manual option color and stage-six material blanks remain protected through automatic source bindings', async () => {
  const m = aiModule(), f = aiFixture(); f.options.rows[0].color = ''; f.options.rows[0].provenance.color = 'manual';
  f.content.label.material = { value: '', provenance: 'manual', updatedAt: f.product.updated_at };
  const plan = m.buildQuotationAiPlan(f.saved, f.scope), color = plan.fields.find(field => field.hubWire.name === '색상').id;
  const material = plan.fields.find(field => field.hubWire.name === '소재').id;
  assert.ok(plan.targets[0].protectedValues.some(item => item.fieldKey === color && item.value === ''));
  assert.ok(plan.targets.every(target => target.protectedValues.some(item => item.fieldKey === material && item.value === '')));
});
for (const change of ['company', 'metadata', 'category', 'source-clock', 'foreign-product', 'duplicate-option']) test(`source linkage fails closed before model: ${change}`, () => {
  const m = aiModule(), f = aiFixture();
  if (change === 'company') f.saved.company = companies[1];
  if (change === 'metadata') f.snapshot.metadata.version = 200;
  if (change === 'category') f.saved.categoryContext.categoryId = '80719';
  if (change === 'source-clock') f.saved.source.optionRevision++;
  if (change === 'foreign-product') f.content.productId = 'other';
  if (change === 'duplicate-option') f.options.rows[1].id = f.options.rows[0].id;
  assert.throws(() => m.buildQuotationAiPlan(f.saved, f.scope), error => error.name === 'QuotationAiError' && error.uncertain === false);
});
test('unsupported schema and altered post-build choices fail closed', async () => {
  const m = aiModule(), a = aiFixture(); a.raw.properties.productPage.properties.unexposedAttributes.allOf[0].contains.properties.attributeValue.pattern = '^X$'; a.syncSchema();
  assert.throws(() => m.buildQuotationAiPlan(a.saved, a.scope), code('AI_SCHEMA_UNSUPPORTED'));
  const f = aiFixture(), plan = plain(m.buildQuotationAiPlan(f.saved, f.scope)); plan.fields.find(field => field.choices)?.choices.push({ value: 'forged', label: 'forged' });
  const provider = mockProvider(); await assert.rejects(m.executeQuotationAi(plan, provider), code('AI_SCHEMA_IDENTITY')); assert.equal(provider.calls.length, 0);
});
for (const mutation of ['unknown-id', 'duplicate-id', 'protected-id', 'invalid-choice', 'bad-type', 'unknown-key', 'chinese']) test(`model proposals strictly reject ${mutation}`, async () => {
  const m = aiModule(), f = aiFixture(), plan = m.buildQuotationAiPlan(f.saved, f.scope);
  const provider = mockProvider({ mutate(result, request) {
    if (request.task === 'ANALYZE_SCHEMA_ATTRIBUTES') return { response: JSON.stringify(result) };
    if (request.task !== 'GET_COMMON_UNEXPOSED_ATTRIBUTES') return { response: JSON.stringify(result) };
    if (mutation === 'unknown-id') result.changes[0].fieldKey = 'unbound';
    if (mutation === 'duplicate-id') result.changes = [result.changes[0], result.changes[0]];
    if (mutation === 'protected-id') result.changes[0].fieldKey = 'mainImage';
    if (mutation === 'invalid-choice') result.changes.find(item => request.fields.find(field => field.id === item.fieldKey)?.choices).value = 'not-a-choice';
    if (mutation === 'bad-type') result.changes[0].value = 10;
    if (mutation === 'unknown-key') result.state = 'completed';
    if (mutation === 'chinese') result.changes[0].value = '材质';
    return { response: JSON.stringify(result) };
  } });
  await assert.rejects(m.executeQuotationAi(plan, provider), error => error.name === 'QuotationAiError' && error.uncertain === false);
  assert.equal(provider.calls.length, 2);
});
for (const mutation of ['foreign-option', 'duplicate-option', 'missing-option']) test(`differentiated result scope strictly rejects ${mutation}`, async () => {
  const m = aiModule(), f = aiFixture(), plan = m.buildQuotationAiPlan(f.saved, f.scope), provider = mockProvider({ mutate(result, request) {
    if (request.task.startsWith('GET_DIFFERENTIATED')) {
      if (mutation === 'foreign-option') result.options[0].optionId = 'foreign';
      if (mutation === 'duplicate-option') result.options[1].optionId = result.options[0].optionId;
      if (mutation === 'missing-option') result.options.pop();
    } return { response: JSON.stringify(result) };
  } }); await assert.rejects(m.executeQuotationAi(plan, provider), code('AI_RESPONSE_SCOPE'));
});
for (const response of ['prose {"differentiatedFieldIds":[]}', '{"differentiatedFieldIds":[],"differentiatedFieldIds":[]}', '{"differentiatedFieldIds":[],}', 'null', '{"__proto__":{}}'])
  test(`malformed/ambiguous whole JSON is rejected: ${response.slice(0, 25)}`, async () => {
    const m = aiModule(), f = aiFixture(), plan = m.buildQuotationAiPlan(f.saved, f.scope); let runs = 0;
    await assert.rejects(m.executeQuotationAi(plan, { async run() { runs++; return { response }; } }), error => error.name === 'QuotationAiError' && error.uncertain === false); assert.equal(runs, 1);
  });
test('explicit JSON fences are parsed as a whole document, not extracted from prose', async () => {
  const m = aiModule(), f = aiFixture(), plan = m.buildQuotationAiPlan(f.saved, f.scope), provider = mockProvider({ mutate(result) { return { response: '```json\n' + JSON.stringify(result) + '\n```' }; } });
  assert.ok((await m.executeQuotationAi(plan, provider)).changes.length);
});
test('own provider response usage metadata is ignored without weakening model JSON validation', async () => {
  const m = aiModule(), f = aiFixture(), plan = m.buildQuotationAiPlan(f.saved, f.scope), provider = mockProvider({ mutate(result) {
    return { response: JSON.stringify(result), usage: { prompt_tokens: 17, completion_tokens: 9 } };
  } }); assert.ok((await m.executeQuotationAi(plan, provider)).changes.length);
});
test('caller mutation during a held provider response cannot alter the captured option scope', async () => {
  const m = aiModule(), f = aiFixture(), plan = m.buildQuotationAiPlan(f.saved, f.scope); let first = true;
  const provider = mockProvider({ mutate(result) { if (first) { first = false; plan.targets[0].optionId = 'foreign'; plan.fields[0].choices = [{ value: 'forged', label: 'forged' }]; }
    return { response: JSON.stringify(result) };
  } }); const result = await m.executeQuotationAi(plan, provider); assert.ok(result.changes.every(item => item.optionId !== 'foreign'));
});
test('source excerpts are disclosed; raw URLs, price, assets and tokens never enter AI facts', () => {
  const m = aiModule(), f = aiFixture(); f.content.seo.description.value = '길'.repeat(9000);
  const plan = m.buildQuotationAiPlan(f.saved, f.scope);
  assert.equal(plan.facts.description.length, 6000); assert.ok(plan.warnings.some(item => item.includes('앞 6000자')));
  assert.ok(!JSON.stringify(plan.facts).includes('synthetic://')); assert.ok(!JSON.stringify(plan.facts).includes('unitCostCny'));
});
test('provider failure is uncertain and never automatically retried; no proposals are partially returned', async () => {
  const m = aiModule(), f = aiFixture(), plan = m.buildQuotationAiPlan(f.saved, f.scope); let runs = 0;
  await assert.rejects(m.executeQuotationAi(plan, { async run() { runs++; throw Error('transport unavailable'); } }), error => error.code === 'AI_PROVIDER' && error.uncertain === true); assert.equal(runs, 1);
});
test('missing facts may be omitted; unknown values do not become invented packaging or filled certification', async () => {
  const m = aiModule(), f = aiFixture(), plan = m.buildQuotationAiPlan(f.saved, f.scope), provider = mockProvider({ mutate(result, request) {
    if (request.task !== 'ANALYZE_SCHEMA_ATTRIBUTES') result = request.task.startsWith('GET_DIFFERENTIATED')
      ? { options: request.targets.map(target => ({ optionId: target.optionId, changes: [] })) } : { changes: [] };
    return { response: JSON.stringify(result) };
  } }); const result = await m.executeQuotationAi(plan, provider); assert.equal(result.changes.length, 0);
  assert.ok(result.warnings.some(item => item.includes('기존 값을 유지')));
});
test('when every candidate is directly saved, no provider request runs and protected blanks stay protected', async () => {
  const m = aiModule(), f = aiFixture(), before = m.buildQuotationAiPlan(f.saved, f.scope);
  for (const field of before.fields) f.state.overrides.common[field.id] = '';
  const plan = m.buildQuotationAiPlan(f.saved, f.scope), provider = mockProvider(), result = await m.executeQuotationAi(plan, provider);
  assert.equal(provider.calls.length, 0); assert.equal(result.changes.length, 0); assert.equal(result.steps.length, 0);
});
test('same-label fields use distinct exact wire IDs; no response label is a routing authority', async () => {
  const m = aiModule(), f = aiFixture(); const exposed = f.raw.properties.productPage.properties.commonAttributes.properties.exposedAttributes.allOf[0];
  const named = structuredClone(exposed); named.contains.properties.attributeName.enum = ['색상'];
  f.raw.properties.productPage.properties.unexposedAttributes.allOf.push(named); f.syncSchema();
  const plan = m.buildQuotationAiPlan(f.saved, f.scope), colors = plan.fields.filter(field => field.hubWire.name === '색상');
  assert.equal(colors.length, 2); assert.notEqual(colors[0].id, colors[1].id);
  const result = await m.executeQuotationAi(plan, mockProvider()); assert.ok(colors.every(field => result.changes.some(item => item.fieldKey === field.id)));
});
test('oversized raw provider result is rejected without another request or partial return', async () => {
  const m = aiModule(), f = aiFixture(), plan = m.buildQuotationAiPlan(f.saved, f.scope); let runs = 0;
  await assert.rejects(m.executeQuotationAi(plan, { async run() { runs++; return { response: 'x'.repeat(100000) }; } }), code('AI_RESPONSE_LIMIT')); assert.equal(runs, 1);
});
test('timeout is uncertain, no retry, no writes, and timer is owned by this operation', async () => {
  const m = aiModule({ instantTimeout: true }), f = aiFixture(), plan = m.buildQuotationAiPlan(f.saved, f.scope), before = JSON.stringify(f.saved); let runs = 0;
  await assert.rejects(m.executeQuotationAi(plan, { async run() { runs++; return await new Promise(() => {}); } }), error => error.code === 'AI_TIMEOUT' && error.uncertain === true);
  assert.equal(runs, 1); assert.equal(m.timerCount(), 1); assert.equal(JSON.stringify(f.saved), before);
});
