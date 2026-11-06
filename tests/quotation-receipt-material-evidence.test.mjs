import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { aiModule } from './helpers/quotation-ai.mjs';
import { curtain, provider } from './helpers/quotation-generation-semantics.mjs';
import { quotationAiApiFixture } from './helpers/quotation-ai-api.mjs';
import { mockProvider } from './helpers/quotation-ai.mjs';
const attributes = JSON.parse(fs.readFileSync(new URL('./fixtures/quotation-receipt-material-attributes.json', import.meta.url), 'utf8'));
const policy = 'option-notice-material-evidence-v2';
const plain = value => JSON.parse(JSON.stringify(value));
const stable = plan => plain({ ...plan, createdAt: null });
const json = async (response, status = 200) => { assert.equal(response.status, status, await response.clone().text()); return response.json(); };
async function fixture(pairs = attributes) {
  const f = await quotationAiApiFixture(), { h } = f;
  h.context.category = { ...f.profile }; h.sqlite.prepare('UPDATE collection_context SET payload=? WHERE job_id=?').run(JSON.stringify(h.context), 'job');
  h.sqlite.prepare('UPDATE products SET source_url=? WHERE id=?').run(h.sourceUrl, f.id);
  h.sqlite.exec(h.load('db/collection-jobs.ts').collectionProductSchema);
  h.sqlite.prepare('INSERT INTO collection_products(job_id,owner_id,product_id,created_at) VALUES(?,?,?,?)').run('job', 'owner', f.id, new Date().toISOString());
  const receipt = h.load('app/collection-result.ts').validateCollectionResult({ schemaVersion: 1, sourceUrl: h.sourceUrl, provider: 'chrome-public-mobile-v1', collectedAt: new Date().toISOString(),
    title: '商品原文', description: '', options: [{ sku: 'raw-one', name: '黑色', unitPriceCny: 7.1, minimumOrder: 1, stock: null }], images: [{ url: 'https://cbu01.alicdn.com/synthetic-material.png', role: 'main' }], attributes: pairs }, '813724060928');
  assert.equal((await h.load('db/collection-results.ts').storeCollectionResult('owner', 'job', receipt)).status, 'stored');
  const reader = h.load('app/exports/quotation-source.ts'), model = h.load('app/quotation-ai.ts');
  return { f, h, reader, model, receipt, read: () => reader.readMappedQuotationSource('owner', f.id, f.profile.id) };
}
const materialProvider = value => mockProvider({ mutate(result, request) { if (request.task !== 'ANALYZE_SCHEMA_ATTRIBUTES') {
  const change = result.changes?.find(change => request.fields.find(field => field.id === change.fieldKey)?.label === '소재'); if (change) change.value = value;
} return { response: JSON.stringify(result) }; } });

test('R6 actual linked receipt material reaches v2 with original value/provenance while untranslated content stays empty', async () => {
  const { f, h, read, model } = await fixture(); try {
    const saved = await read(); assert.equal(saved.content.categoryAttributes, undefined); assert.equal(saved.content.label.material.value, '');
    assert.equal(saved.collectionSourceFacts.attributes[0].value, '涤纶（聚酯纤维）');
    const plan = model.buildQuotationAiPlan(saved, { optionId: null, applyToAllOptions: true }, undefined, policy);
    const facts = h.load('app/quotation-ai-client.ts').quotationAiGenerationFacts(plan.facts);
    assert.ok(facts.material.some(pair => pair.value === '涤纶（聚酯纤维）' && pair.provenance === 'collection-source'));
    const field = plan.fields.find(field => field.section === 'legal' && field.label === '소재');
    const result = await model.executeQuotationAi(plan, materialProvider('폴리에스테르'));
    assert.ok(result.changes.some(change => change.fieldKey === field.id && change.value === '폴리에스테르'));
    const bad = await model.executeQuotationAi(plan, materialProvider('실내용'));
    assert.ok(bad.changes.every(change => change.fieldKey !== field.id));
    assert.equal((await read()).content.label.material.value, ''); assert.equal(h.network.length, 0);
  } finally { f.close(); }
});

for (const prefix of ['', '상품속성: ', '商品属性：', '상품속성: 商品属性：']) test('R6 exact source material heading survives namespace '+prefix, async () => {
  const pairs = [{ name: prefix + '材质', value: '涤纶（聚酯纤维）' }, { name: prefix + '材质', value: '涤纶（聚酯纤维）' }, { name: '用途', value: '실내용' }];
  const { f, read, model } = await fixture(pairs); try {
    const saved = await read(), plan = model.buildQuotationAiPlan(saved, { optionId: null, applyToAllOptions: true }, undefined, policy);
    assert.equal(plan.facts.attributes.filter(pair => pair.provenance === 'collection-source').length, 2);
    assert.ok(plan.facts.attributes.filter(pair => pair.provenance === 'collection-source').every(pair => pair.value === '涤纶（聚酯纤维）' && pair.sourceName === prefix + '材质'));
  } finally { f.close(); }
});

test('R6 misleading unrelated values do not become material and v1/absent plans plus legacy export hashes ignore optional receipt facts', async () => {
  const { f, read, model, reader } = await fixture([{ name: '用途', value: '涤纶（聚酯纤维）' }, { name: '材质备注', value: '폴리에스테르' }]); try {
    const saved = await read(); assert.equal(saved.collectionSourceFacts, undefined);
    const plan = model.buildQuotationAiPlan(saved, { optionId: null, applyToAllOptions: true }, undefined, policy), field = plan.fields.find(field => field.section === 'legal' && field.label === '소재');
    assert.ok((await model.executeQuotationAi(plan, materialProvider('폴리에스테르'))).changes.every(change => change.fieldKey !== field.id));
    const raw = { ...saved, collectionSourceFacts: { jobId: 'job', offerId: '813724060928', fingerprint: 'a'.repeat(64), attributes: [{ name: 'material', value: '涤纶（聚酯纤维）', sourceName: '材质' }] } };
    for (const oldPolicy of [null, 'option-notice-material-evidence-v1']) assert.deepEqual(stable(model.buildQuotationAiPlan(raw, { optionId: null, applyToAllOptions: true }, undefined, oldPolicy)), stable(model.buildQuotationAiPlan(saved, { optionId: null, applyToAllOptions: true }, undefined, oldPolicy)));
    assert.equal(await reader.quotationExportFingerprint(raw, null), await reader.quotationExportFingerprint(saved, null));
  } finally { f.close(); }
});

test('R6 same-clock effective receipt changes alter new sealed plan and old owned result is rejected before product write', async () => {
  const { f, h, read, model } = await fixture(); try {
    f.setProvider(materialProvider('폴리에스테르'));
    const state = await json(await f.request(undefined, 'GET')), out = await json(await f.request(f.requestBody(state))), job = out.job;
    assert.equal(job.generationPolicy, policy);
    const before = await read(), original = h.sqlite.prepare('SELECT payload FROM collection_results WHERE job_id=?').get('job'), changed = JSON.parse(original.payload);
    changed.attributes.find(pair => pair.name === '材质').value = '硅胶'; h.sqlite.prepare('UPDATE collection_results SET payload=? WHERE job_id=?').run(JSON.stringify(changed), 'job');
    const after = await read(); assert.equal(after.product.updated_at, before.product.updated_at);
    assert.notEqual(after.collectionSourceFacts.fingerprint, before.collectionSourceFacts.fingerprint);
    assert.notDeepEqual(stable(model.buildQuotationAiPlan(after, job.scope, undefined, policy)), stable(model.buildQuotationAiPlan(before, job.scope, undefined, policy)));
    const view = await json(await h.route(f.base + '/quotation-fields' + f.query)), change = job.result.changes.find(change => view.resolved.schema.fields.find(field => field.id === change.fieldKey)?.label === '소재');
    const prior = f.state(); await json(await h.route(f.base + '/quotation-fields' + f.query, { method: 'PUT', body: { expectedRevision: view.revision, expectedInputFingerprint: view.inputFingerprint, changes: [], generatedAdoption: { jobId: job.id, targets: [{ optionId: change.optionId, fieldKey: change.fieldKey }] } } }), 409); assert.equal(f.state(), prior);
  } finally { f.close(); }
});

test('R6 stored R5 v1 plan/provider request bytes and exact retry remain unchanged after the v2 admission change', async () => {
  const pure = curtain(); pure.snapshot.observedAt = 1791244800000; pure.saved.source.productVersion = pure.product.updated_at = '2026-10-06T00:00:00.000Z';
  const m = aiModule(), p = provider(), oldPlan = m.buildQuotationAiPlan(pure.saved, pure.scope, undefined, 'option-notice-material-evidence-v1');
  const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
  assert.equal(hash({ ...oldPlan, createdAt: null }), '181c58dff43f355b1ebee1c8c721d6737c569589158b0149bcae934284b0e51e');
  await m.executeQuotationAi(oldPlan, p); assert.equal(hash(p.requests), '073b217affba167edd827454751731b1b72b76c04b0299428d1cba8634c212c6');
  const { f, h, read, model } = await fixture(); try {
    f.setProvider(materialProvider('폴리에스테르'));
    const state = await json(await f.request(undefined, 'GET')), body = f.requestBody(state), out = await json(await f.request(body)), original = f.jobs()[0], review = JSON.parse(original.review), saved = await read();
    review.plan = model.buildQuotationAiPlan(saved, review.scope, review.plan.resultPolicy, 'option-notice-material-evidence-v1');
    const result = await model.executeQuotationAi(review.plan, materialProvider('실내용'));
    const requestFingerprint = await h.load('app/automation/model.ts').fingerprint({ owner: 'owner', productId: f.id, company: review.company, member: review.member, profileId: review.profileId,
      currentFingerprint: review.fingerprint, scope: review.scope, plan: { ...review.plan, createdAt: null }, model: result.model, ...(review.executionPolicy ? { executionPolicy: review.executionPolicy } : {}) });
    h.sqlite.prepare('UPDATE quotation_ai_jobs SET review=?,result=?,request_fingerprint=? WHERE id=?').run(JSON.stringify(review), JSON.stringify(result), requestFingerprint, out.job.id);
    const before = f.jobs()[0], count = f.provider.calls.length, retry = await json(await f.request(body));
    assert.equal(retry.reused, true); assert.equal(retry.job.generationPolicy, 'option-notice-material-evidence-v1'); assert.deepEqual(retry.job.generationFacts.material, []);
    assert.equal(f.jobs()[0].review, before.review); assert.equal(f.jobs()[0].result, before.result); assert.equal(f.jobs()[0].request_fingerprint, before.request_fingerprint); assert.equal(f.provider.calls.length, count);
    const currentState = await json(await f.request(undefined, 'GET')); assert.equal(currentState.fingerprint, state.fingerprint);
    const fresh = await json(await f.request(f.requestBody(currentState))); assert.equal(fresh.job.generationPolicy, policy); assert.notEqual(fresh.job.id, retry.job.id);
    const oldStored = f.jobs().find(row => row.id === retry.job.id); assert.equal(oldStored.review, before.review); assert.equal(oldStored.result, before.result); assert.equal(oldStored.request_fingerprint, before.request_fingerprint);
    assert.ok(f.provider.calls.length > count); assert.equal(f.jobs().length, 2);
  } finally { f.close(); }
});

test('R6 receipt material never replaces manual blank/value or a higher-priority independent detail material', async () => {
  const { f, h, read, model } = await fixture(); try {
    const store = h.load('db/product-content.ts');
    for (const value of ['', '직접 검토한 재질']) {
      const content = await store.readProductContent('owner', f.id); content.label.material = { value, provenance: 'manual', updatedAt: new Date().toISOString() }; content.revision++;
      assert.ok(await store.saveProductContent('owner', content, content.revision - 1));
      const saved = await read(), plan = model.buildQuotationAiPlan(saved, { optionId: null, applyToAllOptions: true }, undefined, policy), field = plan.fields.find(field => field.section === 'legal' && field.label === '소재');
      assert.ok(plan.targets.every(target => target.protectedValues.some(cell => cell.fieldKey === field.id && cell.value === value)));
      assert.ok((await model.executeQuotationAi(plan, materialProvider('폴리에스테르'))).changes.every(change => change.fieldKey !== field.id));
    }
    const content = await store.readProductContent('owner', f.id); content.label.material = { value: '', provenance: 'unverified', updatedAt: null }; content.detail = { description: { value: '재질: 硅胶', provenance: 'collected', updatedAt: null } }; content.revision++;
    assert.ok(await store.saveProductContent('owner', content, content.revision - 1));
    const saved = await read(), plan = model.buildQuotationAiPlan(saved, { optionId: null, applyToAllOptions: true }, undefined, policy), field = plan.fields.find(field => field.section === 'legal' && field.label === '소재');
    assert.ok((await model.executeQuotationAi(plan, materialProvider('폴리에스테르'))).changes.every(change => change.fieldKey !== field.id));
    assert.ok((await model.executeQuotationAi(plan, materialProvider('실리콘'))).changes.some(change => change.fieldKey === field.id && change.value === '실리콘'));
  } finally { f.close(); }
});

for (const mode of ['owner', 'company', 'job', 'source-url']) test('R6 source receipt authority fails closed for '+mode, async () => {
  const { f, h, read } = await fixture(); try {
    if (mode === 'owner') { h.sqlite.prepare('UPDATE collection_results SET owner_id=? WHERE job_id=?').run('foreign-owner', 'job'); assert.equal((await read()).collectionSourceFacts, undefined); }
    else if (mode === 'company') { const context = structuredClone(h.context); context.company = { code: 'A01526306', name: '유앤채' }; if (context.company.code === f.profile.hubSchema.company.code) context.company = { code: 'A01464742', name: '와이홉' }; h.sqlite.prepare('UPDATE collection_context SET payload=? WHERE job_id=?').run(JSON.stringify(context), 'job'); await assert.rejects(read(), /회사/); }
    else if (mode === 'job') { h.sqlite.prepare('UPDATE collection_jobs SET offer_id=? WHERE id=?').run('999999999999', 'job'); await assert.rejects(read(), /원문/); }
    else { const row = h.sqlite.prepare('SELECT payload FROM collection_results WHERE job_id=?').get('job'), changed = JSON.parse(row.payload); changed.sourceUrl = 'https://detail.1688.com/offer/999999999999.html'; h.sqlite.prepare('UPDATE collection_results SET payload=? WHERE job_id=?').run(JSON.stringify(changed), 'job'); await assert.rejects(read(), /URL/); }
  } finally { f.close(); }
});

for (const when of [2, 3]) test('R6 independent reader receipt fence rejects a same-clock mutation at read '+when, async () => {
  const { f, h, read } = await fixture(); try {
    let reads = 0; f.controls.beforeFirst = async sql => { if (!sql.includes('FROM collection_results r')) return; if (++reads !== when) return;
      const row = h.sqlite.prepare('SELECT payload FROM collection_results WHERE job_id=?').get('job'), changed = JSON.parse(row.payload); changed.attributes.find(pair => pair.name === '材质').value = '硅胶'; h.sqlite.prepare('UPDATE collection_results SET payload=? WHERE job_id=?').run(JSON.stringify(changed), 'job');
    };
    await assert.rejects(read(), /변경|카테고리/);
  } finally { f.close(); }
});

test('R6 a normal accepted supplement advances the product clock and invalidates the public source fingerprint', async () => {
  const { f, h, read, receipt, reader } = await fixture([]); try {
    const before = await read(), fingerprint = await reader.quotationExportFingerprint(before, null), captured = { ...receipt, attributes };
    const merged = h.load('app/collection-source-supplement.ts').supplementCollectionSource(receipt, captured);
    assert.ok(await h.load('db/collection-source-supplements.ts').storeCollectionSupplement('owner', 'job', receipt, captured, merged, before.product));
    const after = await read(); assert.notEqual(after.product.updated_at, before.product.updated_at); assert.notEqual(await reader.quotationExportFingerprint(after, null), fingerprint);
    assert.equal(after.collectionSourceFacts.attributes[0].value, '涤纶（聚酯纤维）');
  } finally { f.close(); }
});

test('R6 explicit detail cotton composition defeats conflicting receipt/category polyester and rejects invented ratios', async () => {
  const { f, h, read, model } = await fixture([{ name: '材质', value: '80% 聚酯纤维' }]); try {
    const store = h.load('db/product-content.ts'), content = await store.readProductContent('owner', f.id);
    content.detail = { description: { value: '85% 棉，10% 氨纶，5% 锦纶', provenance: 'collected', updatedAt: null } };
    content.categoryAttributes = { categoryId: f.profile.categoryId, jobId: 'translated-job', values: [{ name: '재질', value: '폴리에스테르 80%', sourceName: '材质' }] }; content.revision++;
    assert.ok(await store.saveProductContent('owner', content, content.revision - 1));
    const saved = await read(), plan = model.buildQuotationAiPlan(saved, { optionId: null, applyToAllOptions: true }, undefined, policy), field = plan.fields.find(field => field.section === 'legal' && field.label === '소재');
    const evidence = h.load('app/quotation-ai-client.ts').quotationAiGenerationFacts(plan.facts).material;
    assert.ok(evidence.length); assert.ok(evidence.every(pair => pair.provenance === 'detail-explicit' && pair.value === '85% 棉，10% 氨纶，5% 锦纶'));
    for (const value of ['폴리에스테르 80%', '면 100%', '면 85%, 스판덱스 15%']) assert.ok((await model.executeQuotationAi(plan, materialProvider(value))).changes.every(change => change.fieldKey !== field.id), value);
    assert.ok((await model.executeQuotationAi(plan, materialProvider('면 85%, 스판덱스 10%, 나일론 5%'))).changes.some(change => change.fieldKey === field.id && change.value === '면 85%, 스판덱스 10%, 나일론 5%'));
    assert.equal(saved.collectionSourceFacts.attributes[0].value, '80% 聚酯纤维', 'raw receipt is preserved, not rewritten into the detail fact');
  } finally { f.close(); }
});

test('R6 source-clock mutation during receipt read fails before a plan can be returned', async () => {
  const { f, h, read } = await fixture(); try {
    let changed = false; f.controls.beforeFirst = async sql => { if (changed || !sql.includes('FROM collection_results r')) return; changed = true;
      const product = h.sqlite.prepare('SELECT updated_at FROM products WHERE id=?').get(f.id); h.sqlite.prepare('UPDATE products SET updated_at=? WHERE id=?').run(new Date(Date.parse(product.updated_at) + 1).toISOString(), f.id);
    };
    await assert.rejects(read(), /변경|버전/); assert.equal(changed, true);
  } finally { f.close(); }
});

test('R6 explicit receipt material does not justify an invented percentage', async () => {
  const { f, read, model } = await fixture(); try {
    const saved = await read(), plan = model.buildQuotationAiPlan(saved, { optionId: null, applyToAllOptions: true }, undefined, policy), field = plan.fields.find(field => field.section === 'legal' && field.label === '소재');
    assert.ok((await model.executeQuotationAi(plan, materialProvider('폴리에스테르 100%'))).changes.every(change => change.fieldKey !== field.id));
  } finally { f.close(); }
});

for (const [raw, value, allowed] of [
  ['100% 涤纶', '폴리에스테르 100%', true], ['100％ 涤纶', '폴리에스테르 100%', true],
  ['100D 涤纶', '폴리에스테르 100%', false], ['100D 涤纶', '폴리에스테르 100D', true],
  ['80% 涤纶，20% 棉', '폴리에스테르 100%', false], ['80% 涤纶，20% 棉', '폴리에스테르 20%, 면 80%', false],
  ['80% 涤纶，20% 棉', '폴리에스테르 80%, 면 20%', true],
]) test(`R6 receipt material numeric/qualifier evidence ${raw} → ${value} (${allowed})`, async () => {
  const { f, h, read, model } = await fixture([{ name: '材质', value: raw }]); try {
    const saved = await read(), plan = model.buildQuotationAiPlan(saved, { optionId: null, applyToAllOptions: true }, undefined, policy), field = plan.fields.find(field => field.section === 'legal' && field.label === '소재');
    const result = await model.executeQuotationAi(plan, materialProvider(value)); assert.equal(result.changes.some(change => change.fieldKey === field.id && change.value === value), allowed);
    const helper = h.load('app/quotation-ai-client.ts'), issue = helper.quotationAiGenerationIssue(field, plan.targets[0].optionId, value, helper.quotationAiGenerationFacts(plan.facts));
    assert.equal(issue === null, allowed);
    if(!allowed) assert.throws(() => model.validateCurrentQuotationResult(plan, [{ optionId: plan.targets[0].optionId, fieldKey: field.id, value }]), /원문|상세페이지|재질|단위|숫자|성분/);
    assert.equal(saved.collectionSourceFacts.attributes[0].value, raw);
  } finally { f.close(); }
});
