import test from 'node:test';
import assert from 'node:assert/strict';
import { mobileIntakeHarness } from './helpers/mobile-intake.mjs';
const png = new Uint8Array(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2RkcAAAAASUVORK5CYII=', 'base64'));
const json = async response => { assert.equal(response.status, 200, await response.clone().text()); return response.json(); };
async function fixture() {
  const h = mobileIntakeHarness(); await h.intake();
  const product = h.sqlite.prepare('SELECT * FROM products').get(), base = '/api/products/' + product.id, get = h.bindings.FILES.get;
  h.bindings.FILES.get = async (key, options) => { const object = await get(key), bytes = h.objects.get(key); if (!object || !bytes) return object;
    const start = options?.range?.offset ?? 0, end = options?.range?.length === undefined ? bytes.length : start + options.range.length; return { ...object, body: new Response(bytes.slice(start, end)).body }; };
  h.bindings.SOURCEFLOW_QUOTATION_AI_PROVIDER = 'workers-ai'; h.bindings.SOURCEFLOW_QUOTATION_AI_FREE_ONLY = 'true'; let ai = 0, renderFailure = false;
  h.bindings.AI.run = async () => { ai++; return { response: JSON.stringify({ content: '1개', material: '실리콘', type: '합성 시험 유형' }) }; };
  const source = JSON.parse(h.sqlite.prepare('SELECT payload FROM collection_results').get().payload); source.attributes.push({ name: '材质', value: '硅胶' }, { name: '包装数量', value: '1个' });
  h.sqlite.prepare('UPDATE collection_results SET payload=?').run(JSON.stringify(source));
  const calls = [], renders = [], controller = new AbortController(), request = async (url, init = {}) => {
    calls.push({ url, method: init.method ?? 'GET' });
    if (url === '/api/files') return h.load('app/api/files/route.ts').POST(new Request('https://app.test/api/files', { method: 'POST', body: init.body }));
    return h.route(url, { method: init.method ?? 'GET', ...(init.body ? { body: JSON.parse(init.body) } : {}) });
  }, read = () => request(base + '/product-labels').then(json), quote = () => request(base + '/quotation-fields').then(json),
    run = () => h.load('app/batch-selected-label-work.ts').runSelectedLabelWork(product.id, { signal: controller.signal, fetcher: request, assertCurrent() {},
      render: async plan => { renders.push(plan); if (renderFailure) throw Error('saved result must not require a local canvas'); return { blob: new Blob([png], { type: 'image/png' }), width: 800, height: 500 }; } }),
    tables = () => JSON.stringify(h.sqlite.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(({ name }) => [name, h.sqlite.prepare('SELECT * FROM ' + name + ' ORDER BY rowid').all()]));
  const first = await run(); assert.equal(first.status, 'draft', first.message); assert.equal(first.completedOptions, 6);
  return { h, product, base, calls, renders, run, read, quote, tables, request, get ai() { return ai; }, failRender() { renderFailure = true; },
    reset() { calls.length = 0; renders.length = 0; }, async edit(optionId, fieldKey, value) { const view = await read(); return request(base + '/product-labels', { method: 'PUT', body: JSON.stringify({ expectedRevision: view.revision, expectedInputFingerprint: view.inputFingerprint, changes: [{ optionId, fieldKey, value }] }) }).then(json); } };
}

test('fresh Stage6 reuses all exact saved option PNGs with zero renderer, provider or write calls after unrelated quotation work', async () => {
  const f = await fixture(); try {
    const view = await f.quote(); await json(await f.h.route(f.base + '/quotation-fields', { method: 'PUT', body: { expectedRevision: view.revision, expectedInputFingerprint: view.inputFingerprint, changes: [{ optionId: null, fieldKey: 'model', value: '다른 견적 모델' }] } }));
    const before = f.tables(), objects = [...f.h.objects.keys()], ai = f.ai, network = f.h.network.length; f.reset(); f.failRender(); const result = await f.run();
    assert.equal(result.status, 'draft', result.message); assert.equal(result.completedOptions, 6); assert.equal(result.uncertain, false); assert.match(result.message, /기존|재사용/);
    assert.equal(f.renders.length, 0); assert.equal(f.ai, ai); assert.ok(f.calls.every(call => call.method === 'GET')); assert.equal(f.tables(), before); assert.deepEqual([...f.h.objects.keys()], objects); assert.equal(f.h.network.length, network);
  } finally { f.h.close(); }
});

test('one changed option renders and relinks only its own label while exact sibling PNGs are reused', async () => {
  const f = await fixture(); try {
    const beforeQuote = await f.quote(), view = await f.read(), changed = view.rows.find(row => row.optionId && row.included).optionId;
    await f.edit(changed, 'material', '직접 검토한 재질'); const ai = f.ai; f.reset(); const result = await f.run(), saved = await f.quote();
    assert.equal(result.status, 'draft', result.message); assert.equal(result.completedOptions, 6); assert.equal(f.renders.length, 1); assert.equal(f.ai, ai);
    assert.equal(f.calls.filter(call => call.url === '/api/files' && call.method === 'POST').length, 1);
    for (const row of saved.resolved.rows.filter(row => row.optionId)) {
      const old = beforeQuote.resolved.rows.find(old => old.optionId === row.optionId).fields.labelImages.value;
      assert.equal(row.fields.labelImages.value === old, row.optionId !== changed);
    }
  } finally { f.h.close(); }
});

test('linked SEO title edits reopen the label stage, and only changed plans get new PNGs', async () => {
  const f = await fixture(); try {
    const labels = await f.read(), options = labels.rows.filter(row => row.optionId && row.included), kept = options[0];
    assert.equal(options[1].sources.productName, 'quotation');
    await f.request(f.base + '/product-labels', {method:'PUT',body:JSON.stringify({
      expectedRevision:labels.revision,expectedInputFingerprint:labels.inputFingerprint,
      changes:Object.entries(kept.values).map(([fieldKey,value])=>({optionId:kept.optionId,fieldKey,value})),
    })}).then(json);
    const getProduct = () => f.h.route(f.base).then(json).then(body => body.product);
    const summary = async () => {
      const product = f.h.sqlite.prepare('SELECT * FROM products WHERE id=?').get(f.product.id);
      return (await f.h.load('db/product-content.ts').readRegistrationSummaries('owner', [product]))[f.product.id];
    };
    const beforeQuote = await f.quote(), target = f.h.load('app/quotation-seo-targets.ts').exactPrimaryQuotationTarget(beforeQuote.resolved.schema.fields, 'labelImages');
    const refs = view => Object.fromEntries(view.resolved.rows.filter(row => row.optionId).map(row => [row.optionId, row.fields[target.primary].value]));
    const before = refs(beforeQuote);
    const initialStage = (await summary()).stages.koreanLabel;
    assert.equal(initialStage.state, 'complete', initialStage.detail);
    const content = (await f.h.route(f.base + '/content').then(json)).content, title = '새로 저장한 연결 상품명';
    await f.h.route(f.base + '/content', {method: 'PATCH', body: {expectedRevision: content.revision, patch: {seo: {title}}}}).then(json);
    const edited = await f.read();
    assert.equal(edited.rows.find(row => row.optionId === kept.optionId).values.productName, kept.values.productName);
    assert.ok(edited.rows.find(row => row.optionId === options[1].optionId).values.productName.startsWith(title));
    const tables = f.tables();
    assert.equal((await summary()).stages.koreanLabel.state, 'pending');
    assert.equal((await getProduct()).content_summary.stages.koreanLabel.state, 'pending');
    assert.equal(f.tables(), tables, 'freshness checks only read the attached label');
    assert.deepEqual(refs(await f.quote()), before);
    f.reset(); const run = await f.run(), after = refs(await f.quote());
    assert.equal(run.status, 'draft', run.message);
    assert.equal(run.completedOptions, options.length);
    assert.equal(f.renders.length, options.length - 1);
    assert.ok(f.renders.every(plan => plan.rows.some(([label, value]) => label === '제품명' && value.startsWith(title))));
    for (const row of options) {
      assert.equal(after[row.optionId] === before[row.optionId], row.optionId === kept.optionId);
      assert.ok(f.h.objects.has(before[row.optionId]), 'the historical file is retained');
    }
    assert.equal((await getProduct()).content_summary.stages.koreanLabel.state, 'complete');
  } finally { f.h.close(); }
});

test('listing checks unique generated label objects with one shared snapshot and preserves an unmarked legacy PNG', async t => {
  const f = await fixture(); try {
    const original = await f.quote(), rows = original.resolved.rows.filter(row => row.optionId);
    const target = f.h.load('app/quotation-seo-targets.ts').exactPrimaryQuotationTarget(original.resolved.schema.fields, 'labelImages');
    const manual = original.imageKeys.find(key => !/\/quotation-label-[a-f0-9]{64}\.png$/.test(key));
    assert.ok(manual);
    const select = async (generated, fallback = manual) => {
      const view = await f.quote();
      await f.h.route(f.base + '/quotation-fields', {method:'PUT',body:{
        expectedRevision:view.revision,expectedInputFingerprint:view.inputFingerprint,
        changes:rows.flatMap((row,index)=>target.linked.map(fieldKey=>({optionId:row.optionId,fieldKey,value:index<generated?row.fields[target.primary].value:fallback}))),
      }}).then(json);
    };
    const prepare = f.h.db.prepare, head = f.h.bindings.FILES.head;
    const measure = async () => {
      const product = f.h.sqlite.prepare('SELECT * FROM products WHERE id=?').get(f.product.id), counts = {sql:0,head:0};
      f.h.db.prepare = sql => { counts.sql++; return prepare(sql); };
      f.h.bindings.FILES.head = async key => { counts.head++; return head(key); };
      try {
        const result = await f.h.load('db/product-content.ts').readRegistrationSummaries('owner',[product]);
        return {...counts,state:result[f.product.id].stages.koreanLabel.state};
      } finally { f.h.db.prepare = prepare; f.h.bindings.FILES.head = head; }
    };
    const measured = [];
    for (const count of [0,1,2]) { await select(count); measured.push(await measure()); }
    assert.deepEqual(measured.map(row => row.head),[0,1,2]);
    assert.deepEqual(measured.map(row => row.state),['complete','complete','complete']);
    assert.equal(measured[1].sql,measured[2].sql,'generated options share one current quotation/label source read');
    t.diagnostic(JSON.stringify(measured));

    const generatedKey = rows[0].fields[target.primary].value, savedFile = f.h.objects.get(generatedKey);
    assert.ok(savedFile); f.h.objects.delete(generatedKey);
    assert.equal((await measure()).state,'pending','an absent generated-style file cannot show as complete');
    f.h.objects.set(generatedKey,savedFile);

    const form = new FormData(); form.set('file',new File([png],'sourceflow-quotation-label.png',{type:'image/png'}));
    form.set('labelUploadId','f'.repeat(64));
    const response = await f.request('/api/files',{method:'POST',body:form}); assert.equal(response.status,201);
    const {key} = await response.json(), current = await f.quote();
    await f.h.route(f.base + '/attachments',{method:'POST',body:{key,role:null,expectedVersion:current.productVersion,expectedContentRevision:current.contentRevision}}).then(json);
    await select(0,key);
    assert.deepEqual(await measure(),{sql:measured[0].sql,head:1,state:'complete'},'an existing unmarked file stays manual without loading label plans');
  } finally { f.h.close(); }
});

test('reuse keeps excluded options untouched and preserves an explicitly blank manual label value', async () => {
  const f = await fixture(); try {
    const current = await json(await f.h.route(f.base + '/options')), rows = f.h.load('app/product-options.ts').optionInputs(current.options), excluded = rows.at(-1).id; rows.at(-1).included = false;
    await json(await f.h.route(f.base + '/options', { method: 'PATCH', body: { expectedRevision: current.options.revision, expectedProductVersion: current.productVersion, rows } }));
    const before = await f.read(), blank = before.rows.find(row => row.optionId && row.included).optionId; await f.edit(blank, 'material', '');
    const excludedBefore = before.rows.find(row => row.optionId === excluded), quoteBefore = await f.quote(); f.reset(); const result = await f.run(), after = await f.read(), quoteAfter = await f.quote();
    assert.equal(result.status, 'draft', result.message); assert.equal(result.totalOptions, 5); assert.equal(result.completedOptions, 5); assert.equal(f.renders.length, 1);
    assert.equal(after.rows.find(row => row.optionId === blank).values.material, ''); assert.deepEqual(after.rows.find(row => row.optionId === excluded), excludedBefore);
    assert.equal(quoteAfter.resolved.rows.find(row => row.optionId === excluded).fields.labelImages.value, quoteBefore.resolved.rows.find(row => row.optionId === excluded).fields.labelImages.value);
  } finally { f.h.close(); }
});

test('a company change cannot reuse or replace the original company label artifacts', async () => {
  const f = await fixture(); try {
    const before = f.tables(), ai = f.ai; f.h.setCompany({ code: 'A01526306', name: '유앤채' }); f.reset(); const result = await f.run();
    assert.ok(['blocked', 'failed'].includes(result.status)); assert.equal(result.completedOptions, 0); assert.equal(f.renders.length, 0); assert.equal(f.ai, ai); assert.ok(f.calls.every(call => call.method === 'GET')); assert.equal(f.tables(), before);
    const {product} = await f.h.route(f.base).then(json);
    assert.equal(product.content_summary.stages.koreanLabel.state, 'pending');
  } finally { f.h.close(); }
});

test('a current-result read racing a manual value edit cannot hide the changed label or begin a new render', async () => {
  const f = await fixture(); try {
    const native = f.h.bindings.FILES.head, view = await f.read(), optionId = view.rows.find(row => row.optionId && row.included).optionId; let changed = false, competing;
    f.h.bindings.FILES.head = async key => { const object = await native(key); if (!changed && key.includes('/quotation-label-')) { changed = true; await f.edit(optionId, 'material', '다른 창의 직접 수정'); competing = f.tables(); } return object; };
    f.reset(); const result = await f.run(); assert.equal(changed, true); assert.ok(['blocked', 'failed'].includes(result.status)); assert.equal(result.completedOptions, 0); assert.equal(f.renders.length, 0); assert.equal(f.tables(), competing);
  } finally { f.h.close(); }
});
