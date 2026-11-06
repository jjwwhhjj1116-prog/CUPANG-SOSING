import test from 'node:test';
import assert from 'node:assert/strict';
import { quotationAiApiFixture } from './helpers/quotation-ai-api.mjs';
import { curtain, provider, colors } from './helpers/quotation-generation-semantics.mjs';
const policy = 'option-notice-material-evidence-v2';
const json = async (response, status = 200) => { assert.equal(response.status, status, await response.clone().text()); return response.json(); };
async function sixOptions(source = curtain(), p = provider()) {
  const f = await quotationAiApiFixture();
  const profiles = f.h.load('db/category-profiles.ts'), profile = await profiles.getCategoryProfile('owner', f.profile.id);
  assert.ok(await profiles.updateCategoryProfile('owner', profile.id, profile.revision, { ...profile, hubSchema: source.snapshot }));
  const store = f.h.load('db/product-options.ts'), before = await store.readProductOptions('owner', f.id), model = f.h.load('app/product-options.ts');
  const options = model.applyOptionRows(before, source.options.rows, new Date().toISOString());
  options.rows.forEach(row => { row.provenance.color = 'collected'; }); // Match intake facts, not a manual option edit.
  assert.ok(await store.saveProductOptions('owner', options, before.revision, f.h.sqlite.prepare('SELECT updated_at FROM products WHERE id=?').get(f.id).updated_at));
  f.setProvider(p); return { f, p };
}

test('actual new-job route differentiates all six legal colors and client/server reject forged aggregate and unsupported material', async () => {
  const { f, p } = await sixOptions(); try {
    const state = await json(await f.request(undefined, 'GET')), body = f.requestBody(state), before = f.state();
    const out = await json(await f.request(body)), job = out.job;
    assert.equal(job.status, 'completed'); assert.equal(job.generationPolicy, policy);
    assert.deepEqual(Object.keys(job.generationFacts).sort(), ['material', 'options']);
    assert.deepEqual(job.generationFacts.material, []); assert.equal(job.generationFacts.options.length, 6);
    assert.equal(f.state(), before, 'generation never applies or writes product fields');
    const view = await json(await f.h.route(f.base + '/quotation-fields' + f.query));
    const color = view.resolved.schema.fields.find(field => field.label === '색상' && field.section === 'legal');
    const material = view.resolved.schema.fields.find(field => field.label === '제품 소재');
    for (let i = 0; i < 6; i++) assert.equal(job.result.changes.find(change => change.fieldKey === color.id && change.optionId === job.generationFacts.options[i].optionId)?.value, colors[i]);
    assert.ok(job.result.changes.every(change => change.fieldKey !== material.id));
    const client = f.h.load('app/quotation-ai-client.ts'); assert.ok(client.quotationAiProposalChanges(view, job, job.fingerprint).length);
    const original = f.jobs()[0], count = p.requests.length;
    for (const mode of ['material', 'aggregate']) {
      const bad = structuredClone(job); const field = mode === 'material' ? material : color;
      bad.result.changes = bad.result.changes.filter(change => change.fieldKey !== field.id);
      bad.result.changes.push({ optionId: job.generationFacts.options[0].optionId, fieldKey: field.id, value: mode === 'material' ? '실내용' : colors.join(', ') });
      assert.throws(() => client.quotationAiProposalChanges(view, bad, job.fingerprint), /재질|다른 옵션/);
      f.h.sqlite.prepare('UPDATE quotation_ai_jobs SET result=? WHERE id=?').run(JSON.stringify(bad.result), job.id);
      await json(await f.h.route(f.base + '/quotation-fields' + f.query, { method: 'PUT', body: { expectedRevision: view.revision, expectedInputFingerprint: view.inputFingerprint, changes: [], generatedAdoption: { jobId: job.id, targets: [{ optionId: bad.result.changes.at(-1).optionId, fieldKey: field.id }] } } }), 400);
      assert.equal(f.state(), before, mode + ' did not persist');
    }
    f.h.sqlite.prepare('UPDATE quotation_ai_jobs SET result=? WHERE id=?').run(original.result, job.id);
    const review = JSON.parse(original.review); review.plan.generationPolicy = 'forged';
    f.h.sqlite.prepare('UPDATE quotation_ai_jobs SET review=? WHERE id=?').run(JSON.stringify(review), job.id);
    const proposal = job.result.changes[0];
    await json(await f.h.route(f.base + '/quotation-fields' + f.query, { method: 'PUT', body: { expectedRevision: view.revision, expectedInputFingerprint: view.inputFingerprint, changes: [], generatedAdoption: { jobId: job.id, targets: [{ optionId: proposal.optionId, fieldKey: proposal.fieldKey }] } } }), 409);
    assert.equal(f.state(), before); assert.equal(p.requests.length, count); assert.equal(f.h.network.length, 0);
  } finally { f.close(); }
});

test('legacy saved generation plan retains request fingerprint, public shape, exact retry and owned adoption', async () => {
  const { f, p } = await sixOptions(); try {
    const state = await json(await f.request(undefined, 'GET')), body = f.requestBody(state), out = await json(await f.request(body)), job = out.job;
    const original = f.jobs()[0], review = JSON.parse(original.review); delete review.plan.generationPolicy;
    const requestFingerprint = await f.h.load('app/automation/model.ts').fingerprint({ owner: 'owner', productId: f.id, company: review.company, member: review.member, profileId: review.profileId,
      currentFingerprint: review.fingerprint, scope: review.scope, plan: { ...review.plan, createdAt: null }, model: job.result.model, ...(review.executionPolicy ? { executionPolicy: review.executionPolicy } : {}) });
    f.h.sqlite.prepare('UPDATE quotation_ai_jobs SET review=?,request_fingerprint=? WHERE id=?').run(JSON.stringify(review), requestFingerprint, job.id);
    const count = p.requests.length, retry = await json(await f.request(body));
    assert.equal(retry.reused, true); assert.equal(retry.job.id, job.id); assert.equal(p.requests.length, count);
    assert.equal(Object.hasOwn(retry.job, 'generationPolicy'), false); assert.equal(Object.hasOwn(retry.job, 'generationFacts'), false);
    assert.equal(f.jobs()[0].request_fingerprint, requestFingerprint); assert.equal(f.jobs()[0].review, JSON.stringify(review));
    const view = await json(await f.h.route(f.base + '/quotation-fields' + f.query)), proposal = job.result.changes[0];
    const saved = await json(await f.h.route(f.base + '/quotation-fields' + f.query, { method: 'PUT', body: { expectedRevision: view.revision, expectedInputFingerprint: view.inputFingerprint, changes: [], generatedAdoption: { jobId: job.id, targets: [{ optionId: proposal.optionId, fieldKey: proposal.fieldKey }] } } }));
    assert.equal(saved.resolved.rows.find(row => row.optionId === proposal.optionId).fields[proposal.fieldKey].value, proposal.value);
    assert.equal(p.requests.length, count);
  } finally { f.close(); }
});

test('P2 actual new-job API accepts own raw black synonym and still rejects a foreign white component at adoption', async () => {
  const source = curtain(); source.options.rows = source.options.rows.slice(0, 2);
  Object.assign(source.options.rows[0], { color: '黑色', translatedName: '검정 커튼' });
  Object.assign(source.options.rows[1], { color: '黑白', translatedName: '블랙 화이트 커튼' });
  const requests = [], p = { requests, async run(_model, input) {
    const r = JSON.parse(input.messages[1].content); requests.push(r);
    const out = r.task === 'ANALYZE_SCHEMA_ATTRIBUTES' ? { differentiatedFieldIds: [] }
      : r.task.startsWith('GET_DIFFERENTIATED') ? { options: r.targets.map(target => ({ optionId: target.optionId, changes: r.fields.filter(field => target.writableFieldIds.includes(field.id)).map(field => ({ fieldKey: field.id, value: target.optionId === source.options.rows[0].id ? '블랙' : '블랙 화이트' })) })) }
      : { changes: [] };
    return { response: JSON.stringify(out) };
  } };
  const { f } = await sixOptions(source, p); try {
    const state = await json(await f.request(undefined, 'GET')), out = await json(await f.request(f.requestBody(state))), job = out.job;
    const view = await json(await f.h.route(f.base + '/quotation-fields' + f.query));
    const field = view.resolved.schema.fields.find(field => field.section === 'legal' && field.label === '색상');
    const own = source.options.rows[0].id, proposal = job.result.changes.find(change => change.optionId === own && change.fieldKey === field.id);
    assert.equal(proposal?.value, '블랙');
    const client = f.h.load('app/quotation-ai-client.ts'); assert.ok(client.quotationAiProposalChanges(view, job, job.fingerprint).some(change => change.optionId === own && change.value === '블랙'));
    const bad = structuredClone(job); bad.result.changes.find(change => change.optionId === own && change.fieldKey === field.id).value = '블랙 화이트';
    assert.throws(() => client.quotationAiProposalChanges(view, bad, job.fingerprint), /다른 옵션/);
    const original = f.jobs()[0], count = requests.length, before = f.state();
    const body = { expectedRevision: view.revision, expectedInputFingerprint: view.inputFingerprint, changes: [], generatedAdoption: { jobId: job.id, targets: [{ optionId: own, fieldKey: field.id }] } };
    f.h.sqlite.prepare('UPDATE quotation_ai_jobs SET result=? WHERE id=?').run(JSON.stringify(bad.result), job.id);
    await json(await f.h.route(f.base + '/quotation-fields' + f.query, { method: 'PUT', body }), 400); assert.equal(f.state(), before);
    f.h.sqlite.prepare('UPDATE quotation_ai_jobs SET result=? WHERE id=?').run(original.result, job.id);
    const saved = await json(await f.h.route(f.base + '/quotation-fields' + f.query, { method: 'PUT', body }));
    assert.equal(saved.resolved.rows.find(row => row.optionId === own).fields[field.id].value, '블랙');
    assert.equal(requests.length, count); assert.equal(f.h.network.length, 0);
  } finally { f.close(); }
});

test('P3 actual API accepts a full own-supported rose gold phrase but rejects standalone and extra foreign gold', async () => {
  const source = curtain(); source.options.rows = source.options.rows.slice(0, 2);
  Object.assign(source.options.rows[0], { color: '玫瑰金', translatedName: '장미금 커튼' });
  Object.assign(source.options.rows[1], { color: '金色', translatedName: '골드 커튼' });
  const requests = [], p = { requests, async run(_model, input) {
    const r = JSON.parse(input.messages[1].content); requests.push(r);
    const out = r.task === 'ANALYZE_SCHEMA_ATTRIBUTES' ? { differentiatedFieldIds: [] }
      : r.task.startsWith('GET_DIFFERENTIATED') ? { options: r.targets.map(target => ({ optionId: target.optionId, changes: r.fields.filter(field => target.writableFieldIds.includes(field.id)).map(field => ({ fieldKey: field.id, value: target.optionId === source.options.rows[0].id ? '로즈 골드' : '골드' })) })) }
      : { changes: [] };
    return { response: JSON.stringify(out) };
  } };
  const { f } = await sixOptions(source, p); try {
    const state = await json(await f.request(undefined, 'GET')), out = await json(await f.request(f.requestBody(state))), job = out.job;
    const view = await json(await f.h.route(f.base + '/quotation-fields' + f.query));
    const field = view.resolved.schema.fields.find(field => field.section === 'legal' && field.label === '색상');
    const own = source.options.rows[0].id, proposal = job.result.changes.find(change => change.optionId === own && change.fieldKey === field.id);
    assert.equal(proposal?.value, '로즈 골드');
    const client = f.h.load('app/quotation-ai-client.ts'); assert.ok(client.quotationAiProposalChanges(view, job, job.fingerprint).some(change => change.optionId === own && change.value === '로즈 골드'));
    const original = f.jobs()[0], count = requests.length, before = f.state();
    const body = { expectedRevision: view.revision, expectedInputFingerprint: view.inputFingerprint, changes: [], generatedAdoption: { jobId: job.id, targets: [{ optionId: own, fieldKey: field.id }] } };
    for (const value of ['골드', '로즈 골드 골드']) {
      const bad = structuredClone(job); bad.result.changes.find(change => change.optionId === own && change.fieldKey === field.id).value = value;
      assert.throws(() => client.quotationAiProposalChanges(view, bad, job.fingerprint), /다른 옵션/);
      f.h.sqlite.prepare('UPDATE quotation_ai_jobs SET result=? WHERE id=?').run(JSON.stringify(bad.result), job.id);
      await json(await f.h.route(f.base + '/quotation-fields' + f.query, { method: 'PUT', body }), 400); assert.equal(f.state(), before);
    }
    f.h.sqlite.prepare('UPDATE quotation_ai_jobs SET result=? WHERE id=?').run(original.result, job.id);
    const saved = await json(await f.h.route(f.base + '/quotation-fields' + f.query, { method: 'PUT', body }));
    assert.equal(saved.resolved.rows.find(row => row.optionId === own).fields[field.id].value, '로즈 골드');
    assert.equal(requests.length, count); assert.equal(f.h.network.length, 0);
  } finally { f.close(); }
});

test('N1 actual API differentiates original-name-only saved-page colors and rejects aggregate adoption', async () => {
  const source = curtain(); source.options.rows = source.options.rows.slice(0, 2);
  Object.assign(source.options.rows[0], { color: '', originalName: '玫红&gt;100*200cm', translatedName: '로즈레드 / 100*200cm' });
  Object.assign(source.options.rows[1], { color: '', originalName: '黑色>100*200cm', translatedName: '검정 / 100*200cm' });
  const requests = [], p = { requests, async run(_model, input) {
    const r = JSON.parse(input.messages[1].content); requests.push(r);
    const out = r.task === 'ANALYZE_SCHEMA_ATTRIBUTES' ? { differentiatedFieldIds: [] }
      : r.task.startsWith('GET_DIFFERENTIATED') ? { options: r.targets.map(target => ({ optionId: target.optionId, changes: r.fields.filter(field => target.writableFieldIds.includes(field.id)).map(field => ({ fieldKey: field.id, value: target.optionId === source.options.rows[0].id ? '로즈레드' : '검정' })) })) }
      : { changes: [] };
    return { response: JSON.stringify(out) };
  } };
  const { f } = await sixOptions(source, p); try {
    const state = await json(await f.request(undefined, 'GET')), out = await json(await f.request(f.requestBody(state))), job = out.job;
    const view = await json(await f.h.route(f.base + '/quotation-fields' + f.query));
    const field = view.resolved.schema.fields.find(field => field.section === 'legal' && field.label === '색상');
    const own = source.options.rows[0].id, proposal = job.result.changes.find(change => change.optionId === own && change.fieldKey === field.id);
    assert.equal(proposal?.value, '로즈레드');
    const client = f.h.load('app/quotation-ai-client.ts'); assert.ok(client.quotationAiProposalChanges(view, job, job.fingerprint).some(change => change.optionId === own && change.value === '로즈레드'));
    const original = f.jobs()[0], count = requests.length, before = f.state();
    const body = { expectedRevision: view.revision, expectedInputFingerprint: view.inputFingerprint, changes: [], generatedAdoption: { jobId: job.id, targets: [{ optionId: own, fieldKey: field.id }] } };
    for (const value of ['검정', '로즈레드, 검정']) {
      const bad = structuredClone(job); bad.result.changes.find(change => change.optionId === own && change.fieldKey === field.id).value = value;
      assert.throws(() => client.quotationAiProposalChanges(view, bad, job.fingerprint), /다른 옵션/);
      f.h.sqlite.prepare('UPDATE quotation_ai_jobs SET result=? WHERE id=?').run(JSON.stringify(bad.result), job.id);
      await json(await f.h.route(f.base + '/quotation-fields' + f.query, { method: 'PUT', body }), 400); assert.equal(f.state(), before);
    }
    f.h.sqlite.prepare('UPDATE quotation_ai_jobs SET result=? WHERE id=?').run(original.result, job.id);
    const saved = await json(await f.h.route(f.base + '/quotation-fields' + f.query, { method: 'PUT', body }));
    assert.equal(saved.resolved.rows.find(row => row.optionId === own).fields[field.id].value, '로즈레드');
    assert.equal(requests.length, count); assert.equal(f.h.network.length, 0);
    assert.ok((await f.h.load('db/product-options.ts').readProductOptions('owner', f.id)).rows.every(row => row.color === ''), 'no inferred color facts written');
  } finally { f.close(); }
});
