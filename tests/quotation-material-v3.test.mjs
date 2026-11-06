import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mockProvider, aiModule } from './helpers/quotation-ai.mjs';
import { curtain, provider } from './helpers/quotation-generation-semantics.mjs';
import { fixture, materialProvider } from './helpers/quotation-receipt-source.mjs';
const policy = 'option-notice-material-evidence-v3';
const json = async (response, status = 200) => { assert.equal(response.status, status, await response.clone().text()); return response.json(); };

test('current actual API retains v3 canonicalization of supported raw Chinese material instead of failing after a reference fallback', async () => {
  const { f, h } = await fixture(); try {
    f.setProvider(materialProvider('涤纶（聚酯纤维）'));
    const state = await json(await f.request(undefined, 'GET')), before = f.state(), out = await json(await f.request(f.requestBody(state)));
    assert.equal(out.job.status, 'completed'); assert.equal(out.job.generationPolicy, 'couplus-common-legal-material-evidence-v4');
    assert.ok(out.job.result.changes.some(change => change.value === '폴리에스테르'));
    assert.ok(out.job.result.warnings.some(warning => /원문|출처/.test(warning) && /정규화/.test(warning)));
    assert.equal(f.state(), before); assert.equal(h.network.length, 0);
  } finally { f.close(); }
});

test('v2 exact Chinese response retains its prior AI_RESPONSE_EVIDENCE execution behavior', async () => {
  const { f, read, model } = await fixture(); try {
    const saved = await read(), plan = model.buildQuotationAiPlan(saved, { optionId: null, applyToAllOptions: true }, undefined, 'option-notice-material-evidence-v2');
    await assert.rejects(model.executeQuotationAi(plan, materialProvider('涤纶（聚酯纤维）')), error => error.code === 'AI_RESPONSE_EVIDENCE');
  } finally { f.close(); }
});

for (const value of ['실내용', '涤纶（聚酯纤维）', '폴리에스테르 100%']) test('v3 exact known source controls poor model material '+value, async () => {
  const { f, read, model } = await fixture(); try {
    const plan = model.buildQuotationAiPlan(await read(), { optionId: null, applyToAllOptions: true }, undefined, policy), field = plan.fields.find(field => field.section === 'legal' && field.label === '소재');
    const result = await model.executeQuotationAi(plan, materialProvider(value));
    assert.equal(result.changes.find(change => change.fieldKey === field.id)?.value, '폴리에스테르');
  } finally { f.close(); }
});

test('v3 omitted material is filled only from the whole unambiguous source', async () => {
  const { f, read, model } = await fixture(); try {
    const plan = model.buildQuotationAiPlan(await read(), { optionId: null, applyToAllOptions: true }, undefined, policy), field = plan.fields.find(field => field.section === 'legal' && field.label === '소재');
    const p = mockProvider({ mutate(result) { if(result.changes) result.changes = result.changes.filter(change => change.fieldKey !== field.id); return { response: JSON.stringify(result) }; } });
    assert.equal((await model.executeQuotationAi(plan, p)).changes.find(change => change.fieldKey === field.id)?.value, '폴리에스테르');
  } finally { f.close(); }
});

for (const raw of ['100D 涤纶', '未知', '涤纶和棉']) test('v3 unknown/unparsed source does not admit a Chinese reference fallback '+raw, async () => {
  const { f, read, model } = await fixture([{ name: '材质', value: raw }]); try {
    const plan = model.buildQuotationAiPlan(await read(), { optionId: null, applyToAllOptions: true }, undefined, policy), field = plan.fields.find(field => field.section === 'legal' && field.label === '소재');
    const result = await model.executeQuotationAi(plan, materialProvider(raw)); assert.ok(result.changes.every(change => change.fieldKey !== field.id));
    assert.ok(result.warnings.some(warning => warning.includes('소재')));
  } finally { f.close(); }
});

test('v1/v2 frozen sealed plan and request bytes remain exact while v3 alone changes generation semantics', async () => {
  const f = curtain(); f.snapshot.observedAt = 1791244800000; f.saved.source.productVersion = f.product.updated_at = '2026-10-06T00:00:00.000Z';
  f.saved.collectionSourceFacts = { jobId: 'sealed-source-job', offerId: '813724060928', fingerprint: 'a'.repeat(64), attributes: [{ name: 'material', value: '涤纶（聚酯纤维）', sourceName: '材质' }] };
  const expected = [
    ['option-notice-material-evidence-v1', '181c58dff43f355b1ebee1c8c721d6737c569589158b0149bcae934284b0e51e', '073b217affba167edd827454751731b1b72b76c04b0299428d1cba8634c212c6'],
    ['option-notice-material-evidence-v2', '0fa0a6f8310f8cf7ab0be8520f80178b3d6968cd4c1763e4704ee4360553d44d', 'c1a0f6cc477673c030ff4f2e9f949c3f5f9bfc601a9e7bd496500f7057cd37bb'],
  ], m = aiModule(), hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
  for(const [marker, planHash, requestHash] of expected) { const plan = m.buildQuotationAiPlan(f.saved, f.scope, undefined, marker), p = provider(); assert.equal(hash({ ...plan, createdAt: null }), planHash); await m.executeQuotationAi(plan, p); assert.equal(hash(p.requests), requestHash); }
});

test('v3 source canonicalization respects detail composition and protected manual blanks/values', async () => {
  const { f, h, read, model } = await fixture([{ name: '材质', value: '80% 聚酯纤维' }]); try {
    const store = h.load('db/product-content.ts'); let content = await store.readProductContent('owner', f.id);
    content.detail = { description: { value: '85% 棉，10% 氨纶，5% 锦纶', provenance: 'collected', updatedAt: null } }; content.revision++;
    assert.ok(await store.saveProductContent('owner', content, content.revision - 1));
    let plan = model.buildQuotationAiPlan(await read(), { optionId: null, applyToAllOptions: true }, undefined, policy), field = plan.fields.find(field => field.section === 'legal' && field.label === '소재');
    assert.equal((await model.executeQuotationAi(plan, materialProvider('폴리에스테르 80%'))).changes.find(change => change.fieldKey === field.id)?.value, '면 85%, 스판덱스 10%, 나일론 5%');
    for(const value of ['', '직접 확인 재질']) { content = await store.readProductContent('owner', f.id); content.label.material = { value, provenance: 'manual', updatedAt: new Date().toISOString() }; content.revision++; assert.ok(await store.saveProductContent('owner', content, content.revision - 1));
      plan = model.buildQuotationAiPlan(await read(), { optionId: null, applyToAllOptions: true }, undefined, policy); assert.ok(plan.targets.every(target => target.protectedValues.some(cell => cell.fieldKey === field.id && cell.value === value)));
      assert.ok((await model.executeQuotationAi(plan, materialProvider('면 100%'))).changes.every(change => change.fieldKey !== field.id));
    }
  } finally { f.close(); }
});

test('v3 contradictory source pairs abstain and client/server validators reject tampered proposals instead of normalizing them', async () => {
  const conflict = await fixture([{ name: '材质', value: '涤纶' }, { name: '材质', value: '棉' }]); try {
    const plan = conflict.model.buildQuotationAiPlan(await conflict.read(), { optionId: null, applyToAllOptions: true }, undefined, policy), field = plan.fields.find(field => field.section === 'legal' && field.label === '소재');
    assert.ok((await conflict.model.executeQuotationAi(plan, materialProvider('실내용'))).changes.every(change => change.fieldKey !== field.id));
  } finally { conflict.f.close(); }
  const { f, h, read, model } = await fixture(); try {
    f.setProvider(materialProvider('실내용')); const state = await json(await f.request(undefined, 'GET')), out = await json(await f.request(f.requestBody(state))), job = out.job;
    const view = await json(await h.route(f.base + '/quotation-fields' + f.query)), field = view.resolved.schema.fields.find(field => field.section === 'legal' && field.label === '소재'), bad = structuredClone(job);
    const change = bad.result.changes.find(change => change.fieldKey === field.id); change.value = '실내용';
    assert.throws(() => h.load('app/quotation-ai-client.ts').quotationAiProposalChanges(view, bad, job.fingerprint), /정규화|재질/);
    const plan = model.buildQuotationAiPlan(await read(), job.scope, undefined, policy), beforeValue = change.value;
    assert.throws(() => model.validateCurrentQuotationResult(plan, [change]), /정규화|재질/); assert.equal(change.value, beforeValue);
    h.sqlite.prepare('UPDATE quotation_ai_jobs SET result=? WHERE id=?').run(JSON.stringify(bad.result), job.id); const before = f.state();
    await json(await h.route(f.base + '/quotation-fields' + f.query, { method: 'PUT', body: { expectedRevision: view.revision, expectedInputFingerprint: view.inputFingerprint, changes: [], generatedAdoption: { jobId: job.id, targets: [{ optionId: change.optionId, fieldKey: field.id }] } } }), 400); assert.equal(f.state(), before);
  } finally { f.close(); }
});

test('terminal failed v2 request is recovered without replay and a fresh same-basis UUID creates current v4', async () => {
  const { f, h, read, model } = await fixture(); try {
    f.setProvider(materialProvider('涤纶（聚酯纤维）')); const state = await json(await f.request(undefined, 'GET')), body = f.requestBody(state), saved = await read(), selected = h.load('app/quotation-text-execution.ts').quotationTextConfiguration(h.bindings), user = await f.user();
    const scope = { optionId: null, applyToAllOptions: true }, plan = model.buildQuotationAiPlan(saved, scope, undefined, 'option-notice-material-evidence-v2');
    const member = { id: user.membership.id, email: user.membership.email, role: user.membership.role }, review = { fingerprint: state.fingerprint, quotationRevision: saved.state.revision, profileId: saved.categoryContext.profileId, source: structuredClone(saved.source), company: saved.company, member, scope, plan, ...(selected.executionPolicy ? { executionPolicy: selected.executionPolicy } : {}) };
    const requestFingerprint = await h.load('app/automation/model.ts').fingerprint({ owner: 'owner', productId: f.id, company: saved.company, member, profileId: review.profileId, currentFingerprint: state.fingerprint, scope, plan: { ...plan, createdAt: null }, model: selected.model, ...(selected.executionPolicy ? { executionPolicy: selected.executionPolicy } : {}) });
    assert.ok(await h.load('db/quotation-ai-jobs.ts').createQuotationAiJob('owner', f.id, body.idempotencyKey, requestFingerprint, review));
    const failed = await json(await f.request(body), 409); assert.equal(failed.code, 'AI_RESPONSE_EVIDENCE'); const count = f.provider.calls.length, old = f.jobs()[0]; assert.equal(old.status, 'failed'); assert.equal(old.result, null);
    const retry = await json(await f.request(body)); assert.equal(retry.reused, true); assert.equal(retry.job.status, 'failed'); assert.equal(retry.job.generationPolicy, 'option-notice-material-evidence-v2'); assert.equal(f.provider.calls.length, count); assert.equal(f.jobs()[0].review, old.review); assert.equal(f.jobs()[0].error, old.error);
    const current = await json(await f.request(undefined, 'GET')); assert.equal(current.fingerprint, state.fingerprint); const fresh = await json(await f.request(f.requestBody(current)));
    assert.equal(fresh.job.status, 'completed'); assert.equal(fresh.job.generationPolicy, 'couplus-common-legal-material-evidence-v4'); assert.notEqual(fresh.job.id, old.id); assert.ok(f.provider.calls.length > count);
    assert.equal(f.jobs().find(row => row.id === old.id).error, old.error); assert.equal(h.network.length, 0);
  } finally { f.close(); }
});

test('v3 unresolved mandatory hidden material still fails and source canonicalization cannot bypass choices', async () => {
  const f = curtain(); f.saved.collectionSourceFacts = { jobId: 'source', offerId: '813724060928', fingerprint: 'a'.repeat(64), attributes: [{ name: 'material', value: '未知', sourceName: '材质' }] };
  f.raw.properties.productPage.properties.unexposedAttributes = { type: 'array', allOf: [{ contains: { type: 'object', properties: { attributeName: { type: 'string', enum: ['소재'], mandatory: true, requirement: '필수' }, attributeValue: { type: ['string', 'null'] } } } }] }; f.syncSchema();
  const m = aiModule(), plan = m.buildQuotationAiPlan(f.saved, f.scope, undefined, policy), omitted = { async run(_model, input) { const r = JSON.parse(input.messages[1].content); return { response: JSON.stringify(r.task === 'ANALYZE_SCHEMA_ATTRIBUTES' ? { differentiatedFieldIds: [] } : r.task.startsWith('GET_DIFFERENTIATED') ? { options: r.targets.map(target => ({ optionId: target.optionId, changes: [] })) } : { changes: [] }) }; } };
  await assert.rejects(m.executeQuotationAi(plan, omitted), error => error.code === 'AI_MANDATORY_UNEXPOSED');
  const c = curtain(); c.saved.collectionSourceFacts = { ...f.saved.collectionSourceFacts, attributes: [{ name: 'material', value: '涤纶', sourceName: '材质' }] };
  c.raw.properties.legalPage.properties.notices.allOf.find(item => item.contains.properties.noticeItemName.enum[0] === '제품 소재').contains.properties.noticeItemValue.enum = ['면']; c.syncSchema();
  const limited = m.buildQuotationAiPlan(c.saved, c.scope, undefined, policy), field = limited.fields.find(field => field.label === '제품 소재');
  assert.ok((await m.executeQuotationAi(limited, provider({ material: '면' }))).changes.every(change => change.fieldKey !== field.id));
  assert.deepEqual(Array.from(field.choices, choice => choice.value), ['면']);
});
