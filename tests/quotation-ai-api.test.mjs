import test from 'node:test';
import assert from 'node:assert/strict';
import { quotationAiApiFixture, companies, plain } from './helpers/quotation-ai-api.mjs';
import { mockProvider } from './helpers/quotation-ai.mjs';
const json = async (response, status = 200) => { assert.equal(response.status, status, await response.clone().text()); return response.json(); };
const unchanged = (f, state) => { assert.equal(f.state(), state); assert.deepEqual(f.h.network, []); assert.equal(f.h.aiSources.length, 0); assert.equal(f.h.objects.size, 0); };
const view = f => f.request(undefined, 'GET').then(response => json(response));
test('GET exposes deterministic saved-source proposals alongside unchanged initial notices without any writes/model calls',async()=>{
 const f=await quotationAiApiFixture();try{
  const model=f.h.load('app/product-content.ts'),store=f.h.load('db/product-content.ts'),before=await store.readProductContent('owner',f.id);
  const content=model.applyContentPatch(before,{label:{material:'직접 확인한 스펀지'}},new Date().toISOString());
  const schema=f.h.load('app/quotation-schema.ts').getQuotationSchema(f.snapshot.categoryId,f.snapshot.categoryPath,f.snapshot);
  content.initialLegalNotices=f.h.load('app/initial-legal-notices.ts').createInitialLegalNotices(schema,{},new Date().toISOString());
  assert.ok(await store.saveProductContent('owner',content,before.revision));
  const original=f.state(),out=await view(f),field=schema.fields.find(field=>field.label==='소재'&&field.section==='legal');
  assert.deepEqual(out.knownChanges,[{optionId:'synthetic-one',fieldKey:field.id,value:'직접 확인한 스펀지'}]);
  assert.equal(f.provider.calls.length,0);assert.equal(f.jobs().length,0);unchanged(f,original);
  assert.equal((await store.readProductContent('owner',f.id)).initialLegalNotices.fields.find(item=>item.fieldId===field.id).value,'해당사항없음');
 }finally{f.close();}
});
test('actual separate stage-six label storage is used over generated/empty content and fenced by the product clock',async()=>{
 const f=await quotationAiApiFixture();try{
  const model=f.h.load('app/product-content.ts'),contentStore=f.h.load('db/product-content.ts'),before=await contentStore.readProductContent('owner',f.id);
  const content=model.applyContentPatch(before,{seo:{description:'별도 표시사항 회귀검사'}},new Date().toISOString());
  const schema=f.h.load('app/quotation-schema.ts').getQuotationSchema(f.snapshot.categoryId,f.snapshot.categoryPath,f.snapshot);
  content.initialLegalNotices=f.h.load('app/initial-legal-notices.ts').createInitialLegalNotices(schema,{},new Date().toISOString());
  await contentStore.saveProductContent('owner',content,before.revision);
  const source=await f.h.load('app/exports/quotation-source.ts').readMappedQuotationSource('owner',f.id,f.profile.id),labels=f.h.load('db/product-labels.ts');
  const previousLabels=await labels.readProductLabels('owner',f.id);
  assert.ok(await labels.saveProductLabels('owner',f.id,{common:{material:'별도 저장한 스펀지'},options:{}},previousLabels.revision,{...source.source,quotationRevision:source.state.revision}));
  const original=f.state(),out=await view(f),field=schema.fields.find(field=>field.label==='소재'&&field.section==='legal');
  assert.deepEqual(out.knownChanges,[{optionId:'synthetic-one',fieldKey:field.id,value:'별도 저장한 스펀지'}]);
  assert.equal((await contentStore.readProductContent('owner',f.id)).label.material.value,'');
  unchanged(f,original);assert.equal(f.provider.calls.length,0);
 }finally{f.close();}
});
test('default editor without profileId uses the captured category profile for one AI request', async () => {
  const f = await quotationAiApiFixture(); try {
    const offer = '700000000794', url = `https://detail.1688.com/offer/${offer}.html`;
    f.h.sqlite.prepare('UPDATE products SET source_url=? WHERE id=?').run(url, f.id);
    f.h.sqlite.prepare('UPDATE collection_jobs SET source_url=?,offer_id=? WHERE id=?').run(url, offer, 'job');
    f.h.context.category = f.profile;
    f.h.sqlite.prepare('UPDATE collection_context SET payload=? WHERE job_id=?').run(JSON.stringify(f.h.context), 'job');
    f.h.sqlite.prepare('INSERT INTO collection_products(job_id,owner_id,product_id,created_at) VALUES(?,?,?,?)').run('job', 'owner', f.id, new Date().toISOString());
    const initial = await json(await f.request(undefined, 'GET', '')), state = f.state();
    assert.equal(initial.profileId, f.profile.id);
    const body = { ...f.requestBody(initial), profileId: null };
    const out = await json(await f.request(body, 'POST', ''));
    assert.equal(out.job.status, 'completed'); assert.equal(out.job.profileId, f.profile.id);
    assert.equal(out.sourceCurrent, true); assert.ok(f.provider.calls.length > 0);
    assert.equal(f.jobs().length, 1); unchanged(f, state);
  } finally { f.close(); }
});
test('an unbound legacy product cannot guess a profile when the editor omits it', async () => {
  const f = await quotationAiApiFixture(); try {
    const state = f.state(); await json(await f.request(undefined, 'GET', ''), 409);
    assert.equal(f.provider.calls.length, 0); assert.equal(f.jobs().length, 0); unchanged(f, state);
  } finally { f.close(); }
});
for (const company of companies) test(`actual approved session generates owned proposal once with source/history untouched (${company.code})`, async () => {
  const f = await quotationAiApiFixture(company); try {
    const initial = await view(f), state = f.state(); assert.equal(initial.configuration.configured, true); assert.equal(initial.jobs.length, 0);
    const body = f.requestBody(initial), out = await json(await f.request(body)); assert.equal(out.job.status, 'completed'); assert.equal(out.sourceCurrent, true); assert.equal(out.job.applied, false);
    assert.equal(out.job.fingerprint, initial.fingerprint); assert.equal(out.job.profileId, f.profile.id); assert.ok(out.job.result.changes.length);
    assert.ok(out.job.result.changes.every(change => change.optionId === 'synthetic-one')); assert.ok(f.provider.calls.length >= 2);
    const persisted = f.jobs()[0], review = JSON.parse(persisted.review); assert.deepEqual(plain(review.company), company); assert.equal(review.member.id, 'owner');
    assert.ok(f.authReads.every(member => member?.status === 'approved' && member.companyCode === company.code));
    const count = f.provider.calls.length, created = persisted.created_at, result = persisted.result;
    // Force a different request timestamp while retaining the same saved input.
    await new Promise(resolve => setTimeout(resolve, 4));
    const repeat = await json(await f.request(body)); assert.equal(repeat.reused, true); assert.equal(repeat.job.id, out.job.id); assert.equal(repeat.job.status, 'completed');
    assert.equal(f.provider.calls.length, count); assert.equal(f.jobs().length, 1); assert.equal(f.jobs()[0].created_at, created); assert.equal(f.jobs()[0].result, result);
    const history = await json(await f.request(undefined, 'GET', f.query + '&jobId=' + out.job.id)); assert.equal(history.jobs[0].id, out.job.id);
    assert.equal(f.h.sqlite.prepare('SELECT requests FROM quotation_ai_daily').get().requests, count); unchanged(f, state);
  } finally { f.close(); }
});
test('concurrent distinct requests claim one job and invoke no second model', async () => {
  const f = await quotationAiApiFixture(); try {
    const initial = await view(f), state = f.state(), real = mockProvider(); let release, started;
    const pending = new Promise(resolve => { release = resolve; }), entered = new Promise(resolve => { started = resolve; }); let held = false;
    f.setProvider({ calls: real.calls, async run(...args) { if (!held) { held = true; started(); await pending; } return real.run(...args); } });
    const first = f.request(f.requestBody(initial)); await entered;
    const count = real.calls.length, second = await json(await f.request(f.requestBody(initial)), 409); assert.equal(second.code, 'QUOTATION_AI_BUSY'); assert.equal(real.calls.length, count);
    assert.equal(f.jobs().filter(job => job.status === 'running').length, 1); release(); const out = await json(await first); assert.equal(out.job.status, 'completed');
    assert.equal(f.jobs().filter(job => job.status === 'completed').length, 1); assert.equal(f.jobs().filter(job => job.status === 'prepared').length, 1); unchanged(f, state);
  } finally { f.close(); }
});
test('same UUID while running returns that exact job without another provider call', async () => {
  const f = await quotationAiApiFixture(); try {
    const initial = await view(f), state = f.state(), body = f.requestBody(initial), real = mockProvider(); let release, started;
    const pending = new Promise(resolve => { release = resolve; }), entered = new Promise(resolve => { started = resolve; }); let held = false;
    f.setProvider({ calls: real.calls, async run(...args) { if (!held) { held = true; started(); await pending; } return real.run(...args); } });
    const first = f.request(body); await entered; const repeat = await json(await f.request(body)); assert.equal(repeat.reused, true); assert.equal(repeat.job.status, 'running');
    assert.equal(f.jobs().length, 1); assert.equal(real.calls.length, 0); release(); const completed = await json(await first); assert.equal(completed.job.id, repeat.job.id); unchanged(f, state);
  } finally { f.close(); }
});
test('provider uncertainty is durable and blocks implicit retry until an explicit confirmed close', async () => {
  const f = await quotationAiApiFixture(); try {
    const initial = await view(f), state = f.state(); let calls = 0;
    f.setProvider({ calls: [], async run() { calls++; throw Error('synthetic provider ACK lost'); } });
    const body = f.requestBody(initial), failure = await json(await f.request(body), 409); assert.equal(failure.code, 'AI_PROVIDER'); assert.equal(calls, 1);
    const durable = f.jobs()[0]; assert.equal(durable.status, 'uncertain'); assert.equal(JSON.parse(durable.error).uncertain, true);
    const replay = await json(await f.request(body)); assert.equal(replay.reused, true); assert.equal(replay.job.status, 'uncertain'); assert.equal(calls, 1);
    await json(await f.request(f.requestBody(initial)), 409); assert.equal(calls, 1);
    await json(await f.request({ action: 'close-uncertain', jobId: durable.id, confirmed: false }), 400); assert.equal(f.jobs().find(job => job.id === durable.id).status, 'uncertain');
    const closed = await json(await f.request({ action: 'close-uncertain', jobId: durable.id, confirmed: true })); assert.equal(closed.job.status, 'failed');
    f.setProvider(mockProvider()); const later = await json(await f.request(f.requestBody(initial))); assert.equal(later.job.status, 'completed'); unchanged(f, state);
  } finally { f.close(); }
});
test('explicit close cannot stop a fresh running job; older than five minutes is closable', async () => {
  const f = await quotationAiApiFixture(); try {
    const initial = await view(f), state = f.state(), body = f.requestBody(initial), real = mockProvider(); let release, started;
    const pending = new Promise(resolve => { release = resolve; }), entered = new Promise(resolve => { started = resolve; }); let held = false;
    f.setProvider({ calls: real.calls, async run(...args) { if (!held) { held = true; started(); await pending; } return real.run(...args); } });
    const active = f.request(body); await entered; const running = f.jobs()[0];
    await json(await f.request({ action: 'close-uncertain', jobId: running.id, confirmed: true }), 409); assert.equal(f.jobs()[0].status, 'running');
    f.h.sqlite.prepare('UPDATE quotation_ai_jobs SET started_at=? WHERE id=?').run('2000-01-01T00:00:00.000Z', running.id);
    const closed = await json(await f.request({ action: 'close-uncertain', jobId: running.id, confirmed: true })); assert.equal(closed.job.status, 'failed');
    release(); const late = await json(await active, 503); assert.equal(late.code, 'QUOTATION_AI_RESULT_UNCERTAIN'); assert.equal(f.jobs()[0].status, 'failed'); unchanged(f, state);
  } finally { f.close(); }
});
test('account-wide daily quota refuses before model and remains durable failed without fallback', async () => {
  const f = await quotationAiApiFixture(); try {
    const initial = await view(f), state = f.state(), day = new Date().toISOString().slice(0, 10);
    f.h.sqlite.prepare('INSERT INTO quotation_ai_daily(day,requests) VALUES(?,40)').run(day);
    const body = f.requestBody(initial), out = await json(await f.request(body), 409); assert.equal(out.code, 'QUOTATION_AI_LIMIT'); assert.equal(f.provider.calls.length, 0);
    assert.equal(f.jobs()[0].status, 'failed'); assert.equal(f.h.sqlite.prepare('SELECT requests FROM quotation_ai_daily').get().requests, 40);
    const repeat = await json(await f.request(body)); assert.equal(repeat.reused, true); assert.equal(repeat.job.status, 'failed'); assert.equal(f.provider.calls.length, 0); unchanged(f, state);
  } finally { f.close(); }
});
test('bad profile, foreign owner/company and non-approved session refuse before job/model', async () => {
  for (const kind of ['profile', 'owner', 'company', 'suspended']) {
    const f = await quotationAiApiFixture(); try {
      const initial = await view(f), body = f.requestBody(initial), state = f.state();
      if (kind === 'profile') body.profileId = 'foreign-profile';
      if (kind === 'owner') f.setOwner('same-company-different-owner');
      if (kind === 'company') f.mutateMember('company'); if (kind === 'suspended') f.mutateMember('status');
      // Native account binding rejects an email's unauthorized company switch
      // at session lookup, before the downstream saved-schema company check.
      await json(await f.request(body), kind === 'profile' ? 404 : 403);
      assert.equal(f.jobs().length, 0); assert.equal(f.provider.calls.length, 0); unchanged(f, state);
    } finally { f.close(); }
  }
});
test('wrong fingerprint/revision/config or ambiguous query cannot create a job', async () => {
  const f = await quotationAiApiFixture(); try {
    const initial = await view(f), state = f.state(), body = f.requestBody(initial);
    await json(await f.request({ ...body, expectedFingerprint: 'a'.repeat(64) }), 409);
    await json(await f.request({ ...body, expectedQuotationRevision: initial.quotationRevision + 1 }), 409);
    delete f.h.bindings.SOURCEFLOW_QUOTATION_AI_FREE_ONLY; await json(await f.request(body), 503);
    for (const query of ['?profileId=x&profileId=y', '?jobId=bad', '?unknown=1']) await json(await f.request(undefined, 'GET', query), 400);
    assert.equal(f.jobs().length, 0); assert.equal(f.provider.calls.length, 0); unchanged(f, state);
  } finally { f.close(); }
});
test('source/current quotation clocks changed before an exact claim block all model calls', async () => {
  const f = await quotationAiApiFixture(); try {
    const initial = await view(f), state = f.state(); let actorState;
    f.controls.beforeFirst = sql => { if (!sql.startsWith('UPDATE quotation_ai_jobs SET status=\'running\'')) return;
      f.controls.beforeFirst = null; f.h.sqlite.prepare('UPDATE products SET updated_at=? WHERE id=?').run('2099-01-01T00:00:00.000Z', f.id); actorState = f.state(); };
    const out = await json(await f.request(f.requestBody(initial)), 409); assert.equal(out.code, 'QUOTATION_AI_BUSY'); assert.equal(f.provider.calls.length, 0);
    assert.notEqual(actorState, state); assert.equal(f.jobs()[0].status, 'prepared'); unchanged(f, actorState);
  } finally { f.close(); }
});
for (const operation of ['create', 'claim']) test(`membership suspension at atomic ${operation} cannot start model`, async () => {
  const f = await quotationAiApiFixture(); try {
    const initial = await view(f), state = f.state(), hook = operation === 'create' ? 'beforeRun' : 'beforeFirst';
    f.controls[hook] = sql => { if (!sql.startsWith(operation === 'create' ? 'INSERT OR IGNORE INTO quotation_ai_jobs' : "UPDATE quotation_ai_jobs SET status='running'")) return;
      f.controls[hook] = null; f.mutateMember('status'); };
    await json(await f.request(f.requestBody(initial)), 409); assert.equal(f.provider.calls.length, 0);
    assert.equal(f.jobs().filter(job => job.status === 'running').length, 0); if (operation === 'create') assert.equal(f.jobs().length, 0); unchanged(f, state);
  } finally { f.close(); }
});
test('source change after final provider answer records proposal but marks sourceCurrent false without applying it', async () => {
  const f = await quotationAiApiFixture(); try {
    const initial = await view(f); let actorState;
    const real = mockProvider(); f.setProvider({ calls: real.calls, async run(...args) {
      const result = await real.run(...args), task = JSON.parse(args[1].messages[1].content).task;
      if (task === 'GET_COMMON_OTHER_ATTRIBUTES') { f.h.sqlite.prepare('UPDATE products SET updated_at=? WHERE id=?').run('2099-01-01T00:00:00.000Z', f.id); actorState = f.state(); }
      return result;
    } });
    const out = await json(await f.request(f.requestBody(initial))); assert.equal(out.job.status, 'completed'); assert.equal(out.sourceCurrent, false); assert.ok(actorState);
    assert.equal(out.job.applied, false); unchanged(f, actorState);
  } finally { f.close(); }
});
