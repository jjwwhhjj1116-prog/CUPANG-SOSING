import test from 'node:test';
import assert from 'node:assert/strict';
import { apiFixture, companies } from './helpers/supplier-hub-single-projection.mjs';
import { aiFixture } from './helpers/quotation-ai.mjs';
import { providedOptionModule as load } from './helpers/provided-option-quotation.mjs';

const { runSelectedPackagingWork: run } = load('app/batch-selected-packaging-work.ts');
const json = async response => { assert.equal(response.status, 200, await response.clone().text()); return response.json(); };
const qwen = packages => ({ choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: JSON.stringify({ packages }) } }] });
async function fixture(company = companies[0], count = 3) {
  const f = await apiFixture(company, aiFixture({ company }).snapshot), requests = [], models = [];
  const store = f.h.load('db/product-options.ts'), model = f.h.load('app/product-options.ts'), old = await store.readProductOptions('owner', f.id),
    product = await f.h.load('db/queries.ts').findProduct('owner', f.id);
  const inputs = Array.from({ length: count }, (_, index) => ({ ...model.optionInputs(old)[0], id: `synthetic-${index}`, originalName: `合成选项${index}`, translatedName: `합성 옵션 ${index}` }));
  const options = model.applyOptionRows(old, inputs, new Date(Date.parse(product.updated_at) + 1).toISOString());
  for (const row of options.rows) { row.packagedWeightG = 10; row.packagingUnitsPerPack = row.unitsPerPack; row.provenance.packagedWeightG = 'collected'; }
  assert.ok(await store.saveProductOptions('owner', options, old.revision, product.updated_at));
  f.h.bindings.SOURCEFLOW_QUOTATION_AI_PROVIDER = 'workers-ai'; f.h.bindings.SOURCEFLOW_QUOTATION_AI_FREE_ONLY = 'true';
  f.h.bindings.AI.run = async (model, input) => { models.push({ model, input }); const source = JSON.parse(input.messages[1].content.slice(0, -'\n/no_think'.length));
    return qwen(source.packages.map(({ index }) => ({ index, widthMm: 60, lengthMm: 80, heightMm: 15 }))); };
  const read = () => f.h.route(f.base + '/quotation-fields' + f.query).then(json);
  const fetcher = async (url, init = {}) => { requests.push({ url, method: init.method ?? 'GET', body: init.body ? JSON.parse(init.body) : undefined });
    return f.h.route(url, { method: init.method ?? 'GET', ...(init.body ? { body: JSON.parse(init.body) } : {}) }); };
  const optionsBefore = JSON.stringify(await store.readProductOptions('owner', f.id));
  let current = true, checks = 0;
  const controls = async extra => ({ view: await read(), signal: new AbortController().signal, fetcher,
    assertCurrent: () => { checks++; if (!current) throw Error('synthetic account/company changed'); }, ...extra });
  return { ...f, requests, models, read, controls, fetcher, store, optionsBefore, get checks() { return checks; }, setCurrent(value) { current = value; } };
}

for (const company of companies) test(`${company.code}: explicit automatic work saves three dimension drafts with non-measured provenance and preserves collected10g/options`, async () => {
  const f = await fixture(company);
  try {
    const before = await f.read(), result = await run(f.id, await f.controls()), after = await f.read();
    assert.equal(result.status, 'draft'); assert.equal(result.changed, 3); assert.equal(result.estimated, 3); assert.equal(result.fallback, 0); assert.equal(result.remaining, 0);
    assert.doesNotMatch(result.message, /입력란에 적용하고 저장해주세요/); assert.match(result.message, /실측값이 아닙니다/);
    assert.equal(result.recovered, false); assert.equal(result.view.inputFingerprint, after.inputFingerprint); assert.ok(after.revision > before.revision);
    assert.deepEqual(f.requests.map(call => call.method), ['POST', 'PUT']); assert.equal(f.models.length, 1); assert.ok(f.checks >= 7);
    for (const change of f.requests[1].body.changes) {
      assert.equal(change.value, '60*80*15'); const cell = after.resolved.rows.find(row => row.optionId === change.optionId).fields[change.fieldKey];
      assert.equal(cell.value, change.value); assert.ok(cell.reviewMessages.some(message => /AI 추정값.*실측값이 아닙니다/.test(message)));
      assert.deepEqual(after.packagingBasis.options[change.optionId][change.fieldKey].nonMeasuredDraft, { origin: 'ai-estimate', measured: false });
    }
    for (const row of after.resolved.rows.filter(row => row.included)) assert.equal(row.fields.packagedWeightG.value, '10');
    assert.equal(JSON.stringify(await f.store.readProductOptions('owner', f.id)), f.optionsBefore); assert.deepEqual(f.h.network, []);
    f.requests.length = 0; const again = await run(f.id, await f.controls()); assert.equal(again.status, 'unchanged'); assert.equal(again.changed, 0); assert.equal(f.requests.length, 0); assert.equal(f.models.length, 1);
  } finally { f.close(); }
});

test('valid abstention and rejected10cube produce incomplete review with no save or automatic provider retry', async () => {
  for (const mode of ['abstain', 'boundary', 'partial']) {
    const f = await fixture(); try {
      f.h.bindings.AI.run = async (_model, input) => { f.models.push({ input }); const source = JSON.parse(input.messages[1].content.slice(0, -'\n/no_think'.length));
        return qwen(source.packages.map(({ index }) => mode === 'boundary' ? { index, widthMm: 10, lengthMm: 10, heightMm: 10 }
          : mode === 'partial' && index === 0 ? { index, widthMm: 60, lengthMm: 80, heightMm: 15 } : { index })); };
      const before = f.state(), result = await run(f.id, await f.controls());
      assert.equal(result.status, 'incomplete'); assert.equal(result.changed, mode === 'partial' ? 1 : 0); assert.equal(result.remaining, mode === 'partial' ? 2 : 3);
      assert.equal(result.fallback, 0); assert.match(result.message, /완료되지 않았습니다/); assert.equal(f.models.length, 1);
      assert.equal(f.requests.filter(call => call.method === 'PUT').length, mode === 'partial' ? 1 : 0);
      if (mode !== 'partial') assert.equal(f.state(), before);
      assert.equal(JSON.stringify(await f.store.readProductOptions('owner', f.id)), f.optionsBefore);
    } finally { f.close(); }
  }
});

test('provider failure may store only the existing explicitly marked Couplus fallback, never an AI estimate or measured source', async () => {
  const f = await fixture(); try {
    f.h.bindings.AI.run = async () => { f.models.push({ attempted: true }); throw Error('synthetic provider delivery unknown'); };
    const result = await run(f.id, await f.controls()); assert.equal(result.status, 'draft'); assert.equal(result.estimated, 0); assert.equal(result.fallback, 3);
    assert.match(result.message, /쿠플러스 방식 기본 초안 3개/); assert.match(result.message, /실측값이 아닙니다/); assert.equal(f.models.length, 1);
    const saved = await f.read(); for (const row of saved.resolved.rows.filter(row => row.included)) {
      assert.equal(row.fields.packagedWeightG.value, '10');
      assert.ok(Object.values(saved.packagingBasis.options[row.optionId]).every(value => value.value === '100*100*100' && value.nonMeasuredDraft.origin === 'couplus-fallback'));
    }
  } finally { f.close(); }
});

test('missing weight seals both exact g fields with the same AI provenance without populating supplier option facts', async () => {
  const f = await fixture(); try {
    const row = f.h.sqlite.prepare('SELECT payload FROM product_options WHERE product_id=?').get(f.id), options = JSON.parse(row.payload);
    for (const option of options.rows) { option.packagedWeightG = null; option.provenance.packagedWeightG = 'unverified'; }
    f.h.sqlite.prepare('UPDATE product_options SET payload=? WHERE product_id=?').run(JSON.stringify(options), f.id);
    const provider = f.h.bindings.AI.run;
    f.h.bindings.AI.run = async (...args) => { const raw = await provider(...args), body = JSON.parse(raw.choices[0].message.content);
      body.packages.forEach(item => { item.weightG = 35; }); raw.choices[0].message.content = JSON.stringify(body); return raw; };
    const before = JSON.stringify(await f.store.readProductOptions('owner', f.id)), result = await run(f.id, await f.controls());
    assert.equal(result.status, 'draft'); assert.equal(result.changed, 6); assert.equal(result.estimated, 6);
    const put = f.requests.find(call => call.method === 'PUT'); assert.equal(put.body.changes.length, 9); assert.equal(put.body.packagingDrafts.length, 9);
    for (const row of result.view.resolved.rows.filter(row => row.included)) {
      const peer = f.h.load('app/quotation-packaged-weight.ts').quotationPackagedWeightPeer(result.view.resolved.schema.fields, 'packagedWeightG'); assert.ok(peer);
      for (const id of ['packagedWeightG', peer]) { assert.equal(row.fields[id].value, '35');
        assert.deepEqual(result.view.packagingBasis.options[row.optionId][id].nonMeasuredDraft, { origin: 'ai-estimate', measured: false }); }
    }
    assert.equal(JSON.stringify(await f.store.readProductOptions('owner', f.id)), before);
  } finally { f.close(); }
});

test('collection-selected requests keep profileId null instead of changing the captured source/fingerprint selection', async () => {
  const f = await fixture(); try {
    const controls = await f.controls(); controls.view.categoryContext.source = 'collection';
    controls.fetcher = async (_url, init) => { assert.equal(init.method, 'POST'); assert.equal(JSON.parse(init.body).profileId, null); throw Error('synthetic request inspected'); };
    await assert.rejects(run(f.id, controls), /synthetic request inspected/); assert.equal(f.models.length, 0);
  } finally { f.close(); }
});

test('intentional manual blanks are incomplete but protected and do not trigger another model request', async () => {
  const f = await fixture(); try {
    const view = await f.read(), fields = view.resolved.schema.fields.filter(field => f.h.load('app/quotation-packaged-dimensions.ts').isPackagedDimensionsMmField(field));
    await json(await f.h.route(f.base + '/quotation-fields' + f.query, { method: 'PUT', body: { expectedRevision: view.revision, expectedInputFingerprint: view.inputFingerprint,
      changes: view.resolved.rows.filter(row => row.included).flatMap(row => fields.map(field => ({ optionId: row.optionId, fieldKey: field.id, value: '' }))) } }));
    const before = f.state(), result = await run(f.id, await f.controls()); assert.equal(result.status, 'incomplete'); assert.equal(result.remaining, 3);
    assert.equal(result.changed, 0); assert.equal(f.requests.length, 0); assert.equal(f.models.length, 0); assert.equal(f.state(), before);
  } finally { f.close(); }
});

test('lost PUT acknowledgement recovers the exact values and provenance with one GET and no repeated generation or write', async () => {
  const f = await fixture(); try {
    const fetcher = async (url, init) => { const response = await f.fetcher(url, init); if (init.method === 'PUT') throw Error('synthetic lost save acknowledgement'); return response; };
    const result = await run(f.id, await f.controls({ fetcher }));
    assert.equal(result.status, 'draft'); assert.equal(result.recovered, true); assert.equal(result.changed, 3); assert.equal(result.remaining, 0);
    assert.deepEqual(f.requests.map(call => call.method), ['POST', 'PUT', 'GET']); assert.equal(f.models.length, 1);
  } finally { f.close(); }
});

test('uncertain generation or unapplied save never becomes success and is never replayed', async () => {
  for (const failure of ['POST', 'PUT']) {
    const f = await fixture(); try {
      const before = f.state(), fetcher = async (url, init) => {
        if (init.method === failure) { f.requests.push({ url, method: init.method }); throw Error('synthetic uncertain ' + failure); }
        return f.fetcher(url, init);
      };
      await assert.rejects(run(f.id, await f.controls({ fetcher })), new RegExp('synthetic uncertain ' + failure));
      assert.deepEqual(f.requests.map(call => call.method), failure === 'POST' ? ['POST'] : ['POST', 'PUT', 'GET']);
      assert.equal(f.state(), before); assert.equal(f.models.length, failure === 'POST' ? 0 : 1);
    } finally { f.close(); }
  }
});

test('changed company, product fingerprint and stale option quantity cannot save a packaging draft', async () => {
  for (const boundary of ['company', 'fingerprint', 'quantity']) {
    const f = await fixture(); try {
      const controls = await f.controls(), before = f.state(); let actorState;
      if (boundary === 'fingerprint') controls.view.inputFingerprint = 'f'.repeat(64);
      else {
        const provider = f.h.bindings.AI.run;
        f.h.bindings.AI.run = async (...args) => { const value = await provider(...args);
          if (boundary === 'company') { f.setCurrent(false); f.h.setCompany(companies[1]); }
          else { const row = f.h.sqlite.prepare('SELECT payload FROM product_options WHERE product_id=?').get(f.id), options = JSON.parse(row.payload); options.rows[0].unitsPerPack = 3;
            f.h.sqlite.prepare('UPDATE product_options SET payload=? WHERE product_id=?').run(JSON.stringify(options), f.id); }
          actorState = f.state(); return value;
        };
      }
      await assert.rejects(run(f.id, controls)); assert.equal(f.requests.filter(call => call.method === 'PUT').length, 0);
      assert.equal(f.state(), actorState ?? before); assert.deepEqual(f.h.network, []);
    } finally { f.close(); }
  }
});

test('malformed draft metadata, another product and unverified save provenance cannot be adopted', async () => {
  for (const boundary of ['product', 'model', 'provenance']) {
    const f = await fixture(); try {
      const fetcher = async (url, init) => {
        const response = await f.fetcher(url, init); if (!response.ok) return response; const body = await response.json();
        if (init.method === 'POST' && boundary === 'product') body.productId = 'another-product';
        if (init.method === 'POST' && boundary === 'model') body.aiRequests = 0;
        if (boundary === 'provenance' && ['GET', 'PUT'].includes(init.method)) delete body.packagingBasis;
        return Response.json(body);
      };
      await assert.rejects(run(f.id, await f.controls({ fetcher })));
      assert.equal(f.requests.filter(call => call.method === 'PUT').length, boundary === 'provenance' ? 1 : 0);
      assert.equal(f.models.length, 1);
    } finally { f.close(); }
  }
});
