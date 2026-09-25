import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { DatabaseSync } from 'node:sqlite';

function load(file, overrides = {}, mode = 'development') {
  const source = fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports = {};
  vm.runInNewContext(output, { exports, crypto, TextEncoder, structuredClone, Response,
    process: { env: { NODE_ENV: mode } }, require: name => {
      if (name in overrides) return overrides[name];
      if (name === 'next/server') return { NextResponse: Response };
      if (name === '@/app/chatgpt-auth') return { getChatGPTUser: async () => ({ userId: 'owner' }), getWorkspaceOwnerId: async () => 'owner' };
      if (name === '@/app/pricing') return load('app/pricing.ts');
      if (name === '@/app/workspace-settings') return load('app/workspace-settings.ts');
      if (name === '@/app/automation/model') return load('app/automation/model.ts');
      if (name === '@/app/automation/translation') return load('app/automation/translation.ts');
      if (name === '@/app/automation/image-edit') return load('app/automation/image-edit.ts');
      if (name === '@/app/product-content') return load('app/product-content.ts');
      if (name === '@/app/product-options') return load('app/product-options.ts');
      if (name === '@/db/product-options') return {readProductOptions:async(_owner,id)=>load('app/product-options.ts').emptyProductOptions(id)};
      if (name === '@/db/quotation-fields') return {readQuotationFields:async(_owner,id)=>({schemaVersion:1,productId:id,revision:0,overrides:{common:{},options:{}},updatedAt:null})};
      if (name === '@/db/product-content') return { readProductContent: async (_owner, id) => load('app/product-content.ts').emptyProductContent(id) };
      if (name === '@/db/translation-jobs') return { listTranslationJobs: async () => [] };
      if (name === 'cloudflare:workers') return { env: {} };
      throw Error(name);
    } }, { filename: file });
  return exports;
}
const model = load('app/automation/model.ts');
const settings = load('app/workspace-settings.ts').defaultSettings;
const version = '2026-09-22T00:00:00.000Z';
const product = { id: 'test', owner_id: 'owner', title: 'LOCAL TEST', source_url: 'synthetic', source_price_cny: 10,
  exchange_rate: 100, supply_margin: 0, coupang_margin: 0, pricing_policy: JSON.stringify({ exchangeRate: 100, supplyMargin: 0,
    coupangMargin: 0, minimumMargin: 0, msrpMultiple: 1, roundingUnit: 10 }), updated_at: version };
const command = (action = 'run', key = 'request_1234') => ({ action, expectedVersion: version, idempotencyKey: key, stages: [...model.automationStages] });
const context = { params: Promise.resolve({ id: 'test' }) };
const request = body => new Request('http://localhost/api/products/test/automation', { method: 'POST', body: JSON.stringify(body) });

function optionFixture(){
 const optionModel=load('app/product-options.ts');return {...optionModel.emptyProductOptions(product.id),revision:1,
 rows:[{...optionModel.emptyOptionInput('a'),originalName:'단품',included:true,unitCostCny:2},
 {...optionModel.emptyOptionInput('b'),originalName:'세트',included:true,unitCostCny:3,unitsPerPack:4},
 {...optionModel.emptyOptionInput('excluded'),originalName:'제외',included:false,unitCostCny:null}]};
}
test('automation calculates every included SKU with the quotation price engine and invalidates changed options',async()=>{
 const options=optionFixture();const before=JSON.stringify(options);
 const plan=await model.planAutomation(product,settings,null,null,null,version,options);
 const run=model.executeLocalAutomation(plan,product,settings,command(),version,options);
 const price=run.stages.find(stage=>stage.id==='pricing');
 assert.equal(price.status,'complete');assert.equal(price.artifacts.length,2);
 const expected=load('app/product-options.ts').calculateOptionPrices(options.rows,model.policyForProduct(product,settings)).filter(row=>row.included);
 assert.deepEqual(price.artifacts.map(a=>a.data.calculation.salePrice),expected.map(row=>row.calculation.salePrice));
 assert.equal(price.artifacts[1].data.sourceCostCny,12);assert.equal(price.artifacts[1].data.appliedToProduct,false);
 assert.equal(JSON.stringify(options),before);
 const unchanged=await model.planAutomation(product,settings,run,null,null,version,options);
 assert.equal(unchanged.stages.find(stage=>stage.id==='pricing').status,'complete');
 options.rows[1].unitsPerPack=5;options.revision++;
 const changed=await model.planAutomation(product,settings,run,null,null,version,options);
 assert.equal(changed.stages.find(stage=>stage.id==='pricing').status,'ready');
 assert.notEqual(changed.inputFingerprint,run.inputFingerprint);
 await assert.rejects(()=>model.planAutomation(product,settings,null,null,null,version,{...options,productId:'other'}));
});
test('partial invalid SKU input and an empty saved selection cannot complete representative pricing',async()=>{
 for(const scenario of ['invalid','excluded','deleted']){
 const options=optionFixture();
 if(scenario==='invalid')options.rows[1].unitCostCny=null;
 else if(scenario==='excluded')options.rows.forEach(row=>row.included=false);
 else options.rows=[];
 const plan=await model.planAutomation(product,settings,null,null,null,version,options);
 const price=model.executeLocalAutomation(plan,product,settings,command(),version,options).stages.find(stage=>stage.id==='pricing');
 assert.equal(price.status,'failed');
 if(scenario==='invalid'){assert.equal(price.artifacts.length,2);assert.equal(price.artifacts[0].data.calculation.salePrice,200);assert.ok(price.artifacts[1].data.error);}
 else assert.match(price.reason.message,/옵션/);
 }
});

test('automation API persists SKU calculations and GET marks changed option input stale',async()=>{
 const h=sqliteHarness();let options=optionFixture();
 try{
 h.sqlite.prepare('INSERT INTO product_options VALUES (?,?,?)').run(product.id,'owner',options.revision);
 const route=load('app/api/products/[id]/automation/route.ts',{
  '@/db/queries':{findProduct:async()=>product,getSettings:async()=>null},'@/db/automation':h.store,
  '@/db/product-options':{readProductOptions:async()=>options}});
 const response=await route.POST(request(command()),context);assert.equal(response.status,200);
 const saved=(await response.json()).workflow.stages.find(stage=>stage.id==='pricing');
 assert.equal(saved.artifacts.length,2);assert.equal(saved.artifacts[1].data.calculation.salePrice,1200);
 assert.equal((await (await route.GET(new Request('http://localhost'),context)).json()).stale,false);
 options={...options,revision:2,rows:options.rows.map(row=>({...row,unitsPerPack:2}))};
 assert.equal((await (await route.GET(new Request('http://localhost'),context)).json()).stale,true);
 }finally{h.sqlite.close();}
});

test('runs actual free price calculation while every unavailable preparation stage stays blocked', async () => {
  const plan = await model.planAutomation(product, settings);
  assert.equal(plan.status, 'ready');
  const run = model.executeLocalAutomation(plan, product, settings, command());
  const price = run.stages.find(stage => stage.id === 'pricing');
  assert.equal(price.status, 'complete'); assert.equal(price.attempts, 1);
  assert.equal(price.artifacts[0].data.calculation.salePrice, 1000);
  assert.equal(price.artifacts[0].data.appliedToProduct, false);
  assert.equal(price.artifacts[0].submissionReady, false);
  assert.ok(price.evidence.some(item => item.kind === 'localCalculation'));
  for (const stage of run.stages.filter(stage => stage.id !== 'pricing')) {
    assert.equal(stage.status, 'blocked'); assert.equal(stage.attempts, 0);
    assert.equal(stage.artifacts.length, 0); assert.ok(stage.reason.code);
  }
  assert.equal(run.status, 'blocked');
});

test('unchanged input preserves evidence and attempts; changed inputs invalidate prior results', async () => {
  const run = model.executeLocalAutomation(await model.planAutomation(product, settings), product, settings, command());
  const unchanged = await model.planAutomation(product, settings, run);
  const second = model.executeLocalAutomation(unchanged, product, settings, command());
  assert.equal(second.stages.find(stage => stage.id === 'pricing').attempts, 1);
  assert.equal(second.stages.find(stage => stage.id === 'pricing').revision, 1);
  for (const [edited, policy] of [[{ ...product, source_price_cny: 20 }, settings], [product, { ...settings, translationPrompt: 'new' }]]) {
    const updated = await model.planAutomation(edited, policy, run);
    const price = updated.stages.find(stage => stage.id === 'pricing');
    assert.equal(price.status, 'ready'); assert.equal(price.revision, 2);
    assert.equal(price.attempts, 0); assert.equal(price.artifacts.length, 0); assert.equal(price.evidence.length, 0);
  }
});

test('invalid stored price records a real failed attempt without fabricated output or futile retry', async () => {
  const invalid = { ...product, source_price_cny: 0 };
  const run = model.executeLocalAutomation(await model.planAutomation(invalid, settings), invalid, settings, command());
  const price = run.stages.find(stage => stage.id === 'pricing');
  assert.equal(price.status, 'failed'); assert.equal(price.retryable, false);
  assert.equal(price.artifacts.length, 0); assert.equal(price.attempts, 1);
  assert.equal(model.executeLocalAutomation(run, invalid, settings, command('retry')).stages.find(stage => stage.id === 'pricing').attempts, 1);
});

test('commands reject forged states, providers and payment approvals', () => {
  for (const input of [null, {}, { ...command(), action: 'submit' }, { ...command(), idempotencyKey: 'x' },
    { ...command(), stages: ['unknown'] }, { ...command(), stages: [] }, { ...command(), approved: true },
    { ...command(), artifacts: [] }, { ...command(), status: 'complete' }, { ...command(), provider: 'couplus' }]) {
    assert.throws(() => model.parseAutomationCommand(input));
  }
  assert.equal(model.parseAutomationCommand({ ...command(), stages: ['pricing', 'pricing'] }).stages.length, 1);
});

function sqliteHarness(initialize = true) {
  const sqlite = new DatabaseSync(':memory:');
  const db = { prepare(sql) {
    let args = [];
    const query = { bind(...values) { args = values; return query; }, execute() { return sqlite.prepare(sql).all(...args); },
      async all() { return { results: query.execute() }; }, async first() { return query.execute()[0] ?? null; },
      async run() { return sqlite.prepare(sql).run(...args); } };
    return query;
  }, async batch(queries) {
    sqlite.exec('BEGIN');
    try { const results = queries.map(query => ({ results: query.execute() })); sqlite.exec('COMMIT'); return results; }
    catch (error) { sqlite.exec('ROLLBACK'); throw error; }
  } };
  if (initialize) {
    sqlite.exec('CREATE TABLE products (id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, updated_at TEXT NOT NULL)');
    sqlite.prepare('INSERT INTO products VALUES (?,?,?)').run('test', 'owner', version);
  }
  sqlite.exec('CREATE TABLE product_content (product_id TEXT PRIMARY KEY, owner_id TEXT, revision INTEGER, payload TEXT, updated_at TEXT)');
  sqlite.exec('CREATE TABLE product_options (product_id TEXT PRIMARY KEY, owner_id TEXT, revision INTEGER)');
  sqlite.exec('CREATE TABLE workspace_settings (owner_id TEXT PRIMARY KEY, payload TEXT)');
  sqlite.exec('CREATE TABLE product_quotation_fields (product_id TEXT PRIMARY KEY, owner_id TEXT, revision INTEGER)');
  return { sqlite, db, store: load('db/automation.ts', { 'cloudflare:workers': { env: { DB: db } } }) };
}

test('SQLite persists workflow, idempotency receipt and history atomically with owner and revision guards', async () => {
  const { sqlite, store } = sqliteHarness();
  try {
    const first = await model.planAutomation(product, settings);
    assert.ok(await store.saveAutomation('owner', first, null, command('plan'), 'fingerprint'));
    assert.equal((await store.getAutomation('owner', 'test')).revision, 1);
    assert.equal((await store.getAutomationHistory('owner', 'test')).length, 1);
    assert.equal((await store.getAutomationReceipt('owner', 'test', 'request_1234')).requestFingerprint, 'fingerprint');
    assert.equal(await store.getAutomation('other', 'test'), null);
    const second = await model.planAutomation(product, settings, first);
    assert.equal(await store.saveAutomation('other', second, null, command('plan', 'other_key'), 'other'), null);
    assert.equal(await store.saveAutomation('owner', second, null, command('plan', 'stale_key'), 'stale'), null);
    assert.equal(await store.saveAutomation('owner', second, 99, command('plan', 'stale_99'), 'stale'), null);
    await assert.rejects(store.saveAutomation('owner', second, 1, command('plan'), 'different'));
    assert.equal((await store.getAutomation('owner', 'test')).revision, 1);
    assert.equal((await store.getAutomationHistory('owner', 'test')).length, 1);
    assert.ok(await store.saveAutomation('owner', second, 1, command('plan', 'next_key'), 'next'));
    sqlite.prepare('UPDATE products SET updated_at=? WHERE id=?').run('2026-09-23T00:00:00.000Z', 'test');
    const third = await model.planAutomation(product, settings, second);
    assert.equal(await store.saveAutomation('owner', third, 2, command('plan', 'stale_product'), 'stale'), null);
    assert.equal((await store.getAutomationHistory('owner', 'test')).length, 2);
  } finally { sqlite.close(); }
});

test('API replays idempotent requests, rejects key reuse, and never repeats completed calculation', async () => {
  const { sqlite, store } = sqliteHarness();
  let current = product;
  const queries = { findProduct: async () => current, getSettings: async () => null };
  const route = load('app/api/products/[id]/automation/route.ts', { '@/db/queries': queries, '@/db/automation': store });
  try {
    const first = await route.POST(request(command()), context);
    assert.equal(first.status, 200); assert.equal((await first.json()).replayed, false);
    current = { ...product, updated_at: '2026-09-23T00:00:00.000Z' };
    const replay = await route.POST(request(command()), context);
    assert.equal(replay.status, 200); assert.equal((await replay.json()).replayed, true);
    assert.equal((await route.POST(request(command('plan')), context)).status, 409);
    assert.equal((await route.POST(request(command('run', 'new_stale_key')), context)).status, 409);
    current = product;
    const second = await route.POST(request(command('run', 'second_execution')), context);
    assert.equal(second.status, 200);
    assert.equal((await second.json()).workflow.stages.find(stage => stage.id === 'pricing').attempts, 1);
    const retry = await route.POST(request(command('retry', 'retry_blocked')), context);
    assert.equal(retry.status, 409); assert.equal((await retry.json()).code, 'NO_RETRYABLE_STAGES');
    assert.equal((await store.getAutomationHistory('owner', 'test')).length, 2);
    const read = await route.GET(new Request('http://localhost'), context);
    assert.equal(read.headers.get('cache-control'), 'no-store'); assert.equal((await read.json()).stale, false);
  } finally { sqlite.close(); }
});

test('simultaneous identical requests produce one history record and one calculation', async () => {
  const { sqlite, store } = sqliteHarness();
  const route = load('app/api/products/[id]/automation/route.ts', {
    '@/db/queries': { findProduct: async () => product, getSettings: async () => null }, '@/db/automation': store,
  });
  try {
    const responses = await Promise.all([route.POST(request(command()), context), route.POST(request(command()), context)]);
    const values = await Promise.all(responses.map(response => response.json()));
    assert.ok(responses.every(response => response.status === 200));
    assert.ok(values.some(value => value.replayed));
    assert.equal((await store.getAutomationHistory('owner', 'test')).length, 1);
    assert.equal((await store.getAutomation('owner', 'test')).stages.find(stage => stage.id === 'pricing').attempts, 1);
  } finally { sqlite.close(); }
});

test('API distinguishes inaccessible products, production auth, malformed input and storage failure', async () => {
  for (const [dependencies, expected] of [
    [{ '@/db/queries': { findProduct: async () => null }, '@/db/automation': {} }, 404],
    [{ '@/db/queries': { findProduct: async () => { throw Error('private secret'); } }, '@/db/automation': {} }, 503],
  ]) {
    const route = load('app/api/products/[id]/automation/route.ts', dependencies);
    const response = await route.POST(request(command()), context);
    assert.equal(response.status, expected); assert.ok(!(await response.text()).includes('private secret'));
  }
  const route = load('app/api/products/[id]/automation/route.ts', { '@/db/queries': {}, '@/db/automation': {} });
  assert.equal((await route.POST(request({}), context)).status, 400);
  const production = load('app/api/products/[id]/automation/route.ts', { '@/db/queries': {}, '@/db/automation': {} }, 'production');
  assert.equal((await production.POST(request(command()), context)).status, 503);
  assert.equal((await production.GET(new Request('http://localhost'), context)).status, 503);
});

test('a failed persist never returns a successful calculation response', async () => {
  const route = load('app/api/products/[id]/automation/route.ts', {
    '@/db/queries': { findProduct: async () => product, getSettings: async () => null },
    '@/db/automation': { getAutomationReceipt: async () => null, getAutomation: async () => null, saveAutomation: async () => { throw Error('storage failed'); } },
  });
  const response = await route.POST(request(command()), context);
  assert.equal(response.status, 503); assert.equal((await response.json()).workflow, undefined);
});

test('manual content changes invalidate outputs and GET staleness without claiming AI completion', async () => {
  const { sqlite, store } = sqliteHarness();
  const contentModel = load('app/product-content.ts');
  let content = contentModel.emptyProductContent(product.id);
  const dependencies = {
    '@/db/queries': { findProduct: async () => product, getSettings: async () => null }, '@/db/automation': store,
    '@/db/product-content': { readProductContent: async () => content },
  };
  const route = load('app/api/products/[id]/automation/route.ts', dependencies);
  try {
    assert.equal((await route.POST(request(command()), context)).status, 200);
    const before = await store.getAutomation('owner', product.id);
    assert.equal(before.contentRevision, 0);
    content = contentModel.applyContentPatch(content, { seo: { title: '직접 편집한 제목' } }, version);
    const response = await route.GET(new Request('http://localhost'), context);
    assert.equal((await response.json()).stale, true);
    const plan = await model.planAutomation(product, settings, before, content);
    assert.equal(plan.contentRevision, 1);
    assert.equal(plan.stages.find(stage => stage.id === 'pricing').status, 'ready');
    assert.equal(plan.stages.find(stage => stage.id === 'pricing').artifacts.length, 0);
    assert.equal(plan.stages.find(stage => stage.id === 'seo').status, 'draft');
    assert.equal(plan.stages.find(stage => stage.id === 'seo').artifacts[0].data.providerExecutionVerified, false);
    assert.equal(plan.stages.find(stage => stage.id === 'seo').attempts, 0);
    assert.equal(plan.stages.find(stage => stage.id === 'quotation').status, 'blocked');
    await assert.rejects(model.planAutomation(product, settings, before, { ...content, productId: 'other' }));
  } finally { sqlite.close(); }
});

test('a concurrent content update with an unchanged product timestamp prevents workflow persistence', async () => {
  const { sqlite, store } = sqliteHarness();
  const content = load('app/product-content.ts').emptyProductContent(product.id);
  try {
    const plan = await model.planAutomation(product, settings, null, content);
    sqlite.prepare('INSERT INTO product_content VALUES (?,?,?,?,?)').run(product.id, 'owner', 1, '{}', version);
    assert.equal(await store.saveAutomation('owner', plan, null, command(), 'content_changed'), null);
    assert.equal(await store.getAutomation('owner', product.id), null);
    assert.equal(await store.getAutomationReceipt('owner', product.id, command().idempotencyKey), null);
    assert.equal((await store.getAutomationHistory('owner', product.id)).length, 0);
  } finally { sqlite.close(); }
});

test('actual price update between planning and D1 commit blocks stale results atomically', async () => {
  const { sqlite, db, store } = sqliteHarness(false);
  const queries = load('db/queries.ts', { 'cloudflare:workers': { env: { DB: db } } });
  try {
    await queries.ensureDatabase();
    // Future timestamps also have to advance; this models a rapid second editor.
    const future = '2999-01-01T00:00:00.000Z';
    sqlite.prepare(`INSERT INTO products(id,owner_id,source_url,title,source_price_cny,exchange_rate,supply_margin,coupang_margin,supply_price,sale_price,msrp,created_at,updated_at)
      VALUES ('test','owner','synthetic','TEST',10,100,0,0,1000,1000,1000,?,?)`).run(future, future);
    const snapshot = await queries.findProduct('owner', 'test');
    const originalCommand = { ...command(), expectedVersion: future };
    const plan = await model.planAutomation(snapshot, settings);
    const calculated = model.executeLocalAutomation(plan, snapshot, settings, originalCommand);
    const policy = { exchangeRate: 200, supplyMargin: 0, coupangMargin: 0, minimumMargin: 0, msrpMultiple: 1, roundingUnit: 10 };
    const pricing = load('app/pricing.ts');
    assert.ok(await queries.applyProductPrice('owner', 'test', future, { ...policy, ...pricing.calculatePrice(10, policy) }, policy));
    assert.equal(await store.saveAutomation('owner', calculated, null, originalCommand, 'price_changed'), null);
    assert.equal(await store.getAutomation('owner', 'test'), null);
    assert.equal((await store.getAutomationHistory('owner', 'test')).length, 0);
    assert.equal((await queries.findProduct('owner', 'test')).supply_price, 2000);
  } finally { sqlite.close(); }
});

test('only a stored completed translation matching current inputs produces SEO draft evidence', async () => {
  const content = load('app/product-content.ts').emptyProductContent(product.id);
  const translation = { id: 'translation-job', productId: product.id, productVersion: product.updated_at, contentRevision: 0,
    status: 'completed', createdAt: version, review: { fingerprint: 'source-hash', source: { provenance: 'manual' } },
    result: { draft: { title: '번역 초안' }, responseId: 'resp_actual_receipt', model: 'configured-model', generatedAt: version, provenance: 'generated' } };
  const plan = await model.planAutomation(product, settings, null, content, translation);
  const seo = plan.stages.find(stage => stage.id === 'seo');
  assert.equal(seo.status, 'draft'); assert.equal(seo.reason.code, 'TRANSLATION_DRAFT_NOT_APPLIED'); assert.equal(seo.artifacts[0].data.appliedToContent, false);
  assert.equal(seo.artifacts[0].submissionReady, false); assert.equal(seo.evidence[0].kind, 'providerReceipt');
  assert.equal(plan.stages.find(stage => stage.id === 'quotation').status, 'blocked');
  for (const invalid of [{ ...translation, status: 'prepared' }, { ...translation, contentRevision: 1 }, { ...translation, productVersion: 'stale' }, { ...translation, productId: 'other' }]) {
    const stale = await model.planAutomation(product, settings, plan, content, invalid);
    assert.equal(stale.stages.find(stage => stage.id === 'seo').status, 'blocked');
  }
});

test('saved size/label images and edited SEO appear as review drafts with actual revision evidence and no AI claim', async () => {
  const contentModel=load('app/product-content.ts');
  const content=contentModel.applyContentPatch(contentModel.emptyProductContent(product.id),{
    seo:{title:'직접 저장한 상품명',description:'직접 확인해 입력한 설명',keywords:['수동 검색어']},
    assets:{main:['owner/main.png'],additional:['owner/additional.png'],detail:['owner/detail.png'],size:['owner/browser-size.png'],label:['owner/browser-label.png']},
  },version);
  // A generated role provenance describes the saved field, not proof of any AI service call.
  content.assets.size.provenance='generated';
  const savedProduct={...product,image_keys:JSON.stringify(Object.values(content.assets).flatMap(field=>field.value))};
  const before=JSON.stringify(content);
  const planned=await model.planAutomation(savedProduct,settings,null,content);
  for(const id of ['seo','mainImage','additionalImages','detailImage','sizeChart','koreanLabel']){
    const stage=planned.stages.find(item=>item.id===id);
    assert.equal(stage.status,'draft');assert.equal(stage.attempts,0);assert.equal(stage.reason.code,'SAVED_DRAFT_REVIEW_REQUIRED');
    assert.ok(stage.evidence.some(item=>item.kind==='savedContent'&&item.reference===`${product.id}:content@1`));
    assert.ok(stage.evidence.some(item=>item.kind==='storedProduct'&&item.reference===`${product.id}@${version}`));
    assert.ok(stage.evidence.every(item=>item.kind!=='providerReceipt'));
    for(const artifact of stage.artifacts){assert.equal(artifact.submissionReady,false);assert.equal(artifact.data.providerExecutionVerified,false);assert.equal(artifact.data.sourceCollectionVerified,false);assert.equal(artifact.data.contentRevision,1);assert.equal(artifact.data.productVersion,version);}
  }
  const size=planned.stages.find(stage=>stage.id==='sizeChart').artifacts[0];
  assert.equal(size.storageKey,'owner/browser-size.png');assert.equal(size.data.provenance,'generated');assert.equal(size.data.provenanceScope,'savedRoleAssignment');assert.equal(size.data.assetOrigin,'unverified');assert.equal(size.data.fileContentVerified,false);
  assert.equal(planned.stages.find(stage=>stage.id==='quotation').status,'blocked');
  const executed=model.executeLocalAutomation(planned,savedProduct,settings,command());
  assert.equal(executed.stages.find(stage=>stage.id==='sizeChart').status,'draft');assert.equal(executed.stages.find(stage=>stage.id==='sizeChart').attempts,0);
  assert.equal(executed.status,'blocked');
  const repeated=await model.planAutomation(savedProduct,settings,planned,content);
  assert.equal(repeated.stages.find(stage=>stage.id==='sizeChart').artifacts.length,1);
  assert.equal(repeated.stages.find(stage=>stage.id==='sizeChart').revision,1);
  assert.equal(JSON.stringify(content),before);
});

test('missing, foreign and malformed image references cannot produce phantom saved-image success', async () => {
  const contentModel=load('app/product-content.ts');
  for(const image_keys of ['[]','["other/size.png"]','not-json']){
    const content=contentModel.applyContentPatch(contentModel.emptyProductContent(product.id),{assets:{size:['owner/missing.png'],label:['other/label.png']}},version);
    const planned=await model.planAutomation({...product,image_keys},settings,null,content);
    for(const id of ['sizeChart','koreanLabel']){
      const stage=planned.stages.find(item=>item.id===id);assert.equal(stage.status,'blocked');assert.equal(stage.artifacts.length,0);assert.equal(stage.reason.code,'SAVED_ASSET_REFERENCE_MISSING');
    }
  }
  const content=contentModel.applyContentPatch(contentModel.emptyProductContent(product.id),{assets:{additional:['owner/valid.png','owner/missing.png']}},version);
  const planned=await model.planAutomation({...product,image_keys:'["owner/valid.png"]'},settings,null,content);
  const partial=planned.stages.find(stage=>stage.id==='additionalImages');
  assert.equal(partial.status,'blocked');assert.equal(partial.artifacts.length,1);assert.equal(partial.artifacts[0].storageKey,'owner/valid.png');
  assert.equal(model.explainProviderAvailability(planned,{translationProvider:true,imageProvider:true}).stages.find(stage=>stage.id==='additionalImages').reason.code,'SAVED_ASSET_REFERENCE_MISSING');
});

test('content edits and removed product references invalidate stored draft artifacts instead of preserving stale success', async () => {
  const contentModel=load('app/product-content.ts');
  const content=contentModel.applyContentPatch(contentModel.emptyProductContent(product.id),{seo:{title:'이전 제목'},assets:{size:['owner/size.png'],label:['owner/label.png']}},version);
  const savedProduct={...product,image_keys:'["owner/size.png","owner/label.png"]'};
  const first=await model.planAutomation(savedProduct,settings,null,content);
  const removed=await model.planAutomation({...savedProduct,image_keys:'["owner/label.png"]'},settings,first,content);
  const staleSize=removed.stages.find(stage=>stage.id==='sizeChart');assert.equal(staleSize.status,'blocked');assert.equal(staleSize.artifacts.length,0);assert.equal(staleSize.revision,2);assert.notEqual(removed.inputFingerprint,first.inputFingerprint);
  const changed=contentModel.applyContentPatch(content,{seo:{title:''},assets:{size:[],label:[]}},'2026-09-23T00:00:00.000Z');
  const cleared=await model.planAutomation(savedProduct,settings,first,changed);
  for(const id of ['seo','sizeChart','koreanLabel']){const stage=cleared.stages.find(item=>item.id===id);assert.equal(stage.status,'blocked');assert.equal(stage.artifacts.length,0);assert.equal(stage.evidence.length,0);assert.equal(stage.revision,2);}
  assert.equal(cleared.contentRevision,2);
});

test('current translation receipts coexist with saved SEO fields and disappear after content changes', async () => {
  const contentModel=load('app/product-content.ts');
  const content=contentModel.applyContentPatch(contentModel.emptyProductContent(product.id),{seo:{title:'보존할 수동 제목'}},version);
  const translation={id:'current-provider-job',productId:product.id,productVersion:version,contentRevision:1,status:'completed',createdAt:version,
    review:{fingerprint:'actual-source-fingerprint',source:{provenance:'manual'}},result:{draft:{title:'검토 중인 AI 초안'},responseId:'actual-response',model:'configured-model',generatedAt:version,provenance:'generated'}};
  const first=await model.planAutomation(product,settings,null,content,translation);
  const seo=first.stages.find(stage=>stage.id==='seo');assert.equal(seo.status,'draft');assert.equal(seo.reason.code,'TRANSLATION_DRAFT_NOT_APPLIED');assert.equal(seo.artifacts.length,2);assert.equal(seo.attempts,1);
  assert.equal(seo.artifacts[0].data.providerExecutionVerified,true);assert.equal(seo.artifacts[1].data.providerExecutionVerified,false);
  assert.equal(seo.artifacts[1].data.draft.title.value,'보존할 수동 제목');assert.equal(seo.artifacts[1].data.draft.title.provenance,'manual');
  assert.ok(seo.evidence.some(item=>item.kind==='providerReceipt'));assert.ok(seo.evidence.some(item=>item.kind==='savedContent'));
  const repeated=await model.planAutomation(product,settings,first,content,translation);assert.equal(repeated.stages.find(stage=>stage.id==='seo').artifacts.length,2);
  const changed=contentModel.applyContentPatch(content,{seo:{title:'다음 수동 제목'}},'2026-09-23T00:00:00.000Z');
  const replanned=await model.planAutomation(product,settings,first,changed,translation);const current=replanned.stages.find(stage=>stage.id==='seo');
  assert.equal(current.status,'draft');assert.equal(current.attempts,0);assert.equal(current.artifacts.length,1);assert.ok(current.evidence.every(item=>item.kind!=='providerReceipt'));
  assert.equal(replanned.stages.find(stage=>stage.id==='quotation').status,'blocked');
});

test('detail stage follows full quotation image order and blocks missing top or bottom references',async()=>{
 const contentModel=load('app/product-content.ts');
 const content=contentModel.applyContentPatch(contentModel.emptyProductContent(product.id),{assets:{detailTop:['owner/top.png'],detail:['owner/body.png'],detailBottom:['owner/bottom.png']}},version);
 content.assets.detailTop.provenance='generated';const before=JSON.stringify(content);
 const saved={...product,image_keys:JSON.stringify(['owner/top.png','owner/body.png','owner/bottom.png'])};
 const first=await model.planAutomation(saved,settings,null,content);const detail=first.stages.find(stage=>stage.id==='detailImage');
 assert.equal(detail.status,'draft');assert.deepEqual(Array.from(detail.artifacts,artifact=>artifact.storageKey),Array.from(contentModel.contentDetailImageKeys(content)));
 assert.equal(detail.artifacts[0].data.provenance,'generated');assert.equal(detail.artifacts[1].data.provenance,'manual');assert.ok(detail.artifacts.every(artifact=>!artifact.submissionReady));
 for(const missing of ['owner/top.png','owner/bottom.png']){
  const updated=await model.planAutomation({...saved,image_keys:JSON.stringify(JSON.parse(saved.image_keys).filter(key=>key!==missing))},settings,first,content);
  const stage=updated.stages.find(stage=>stage.id==='detailImage');assert.equal(stage.status,'blocked');assert.equal(stage.reason.code,'SAVED_ASSET_REFERENCE_MISSING');assert.equal(stage.artifacts.length,2);assert.ok(!stage.artifacts.some(artifact=>artifact.storageKey===missing));
 }
 const banners=contentModel.applyContentPatch(content,{assets:{detail:[]}},'2026-09-24T00:00:00Z');
 const bannerPlan=await model.planAutomation(saved,settings,first,banners);assert.equal(bannerPlan.stages.find(stage=>stage.id==='detailImage').status,'draft');assert.equal(bannerPlan.stages.find(stage=>stage.id==='detailImage').artifacts.length,2);
 const cleared=contentModel.applyContentPatch(banners,{assets:{detailTop:[],detailBottom:[]}},'2026-09-24T00:00:01Z');
 const clearedPlan=await model.planAutomation(saved,settings,bannerPlan,cleared);assert.equal(clearedPlan.stages.find(stage=>stage.id==='detailImage').status,'blocked');assert.equal(clearedPlan.stages.find(stage=>stage.id==='detailImage').artifacts.length,0);
 assert.equal(JSON.stringify(content),before);
});

 test('saved label text follows layout and coexists with images without claiming image or legal verification', async () => {
  const cm=load('app/product-content.ts');
  const content=cm.applyContentPatch(cm.emptyProductContent(product.id), {
    label:{productName:'저장 품명',material:'나일론',certification:'숨긴 내용'},
    labelLayout:{order:['material','productName'],hidden:['certification']},
    customLabels:[{id:'custom-one',name:'추가 항목',value:'내용',visible:true},{id:'custom-hidden',name:'비공개',value:'숨김',visible:false}],
  },version);
  const before=JSON.stringify(content);
  const first=await model.planAutomation(product,settings,null,content);
  const stage=first.stages.find(item=>item.id==='koreanLabel');
  assert.equal(stage.status,'draft');assert.equal(stage.attempts,0);
  const artifact=stage.artifacts[0];
  assert.equal(artifact.submissionReady,false);assert.equal(artifact.data.imageMatchesTextVerified,false);assert.equal(artifact.data.legalCorrectnessVerified,false);
  assert.deepEqual(Array.from(artifact.data.labelRows[0]),['material','재질','나일론']);
  assert.ok(artifact.data.labelRows.some(row=>row[0]==='custom-one'));
  assert.ok(!artifact.data.labelRows.some(row=>['certification','custom-hidden'].includes(row[0])));
  assert.ok(stage.evidence.some(item=>item.kind==='savedContent'));
  const repeat=await model.planAutomation(product,settings,first,content);
  assert.equal(repeat.stages.find(item=>item.id==='koreanLabel').artifacts.length,1);
  const imaged=cm.applyContentPatch(content,{assets:{label:['owner/label.png']}},version);
  const valid=await model.planAutomation({...product,image_keys:'["owner/label.png"]'},settings,first,imaged);
  assert.equal(valid.stages.find(item=>item.id==='koreanLabel').artifacts.length,2);
  const broken=await model.planAutomation({...product,image_keys:'[]'},settings,valid,imaged);
  const blocked=broken.stages.find(item=>item.id==='koreanLabel');
  assert.equal(blocked.status,'blocked');assert.equal(blocked.reason.code,'SAVED_ASSET_REFERENCE_MISSING');
  assert.equal(blocked.artifacts.length,1);assert.equal(blocked.artifacts[0].kind,'text');
  const cleared=cm.applyContentPatch(content,{label:{productName:'',material:''},customLabels:[]},version);
  const empty=await model.planAutomation(product,settings,first,cleared);
  assert.equal(empty.stages.find(item=>item.id==='koreanLabel').status,'blocked');
  assert.equal(empty.stages.find(item=>item.id==='koreanLabel').artifacts.length,0);
  assert.equal(JSON.stringify(content),before);
 });

test('automation commit rejects option and settings races atomically and accepts unchanged owned snapshots', async () => {
 const h=sqliteHarness();
 try {
  h.sqlite.prepare('INSERT INTO product_options VALUES (?,?,?)').run(product.id,'owner',1);
  h.sqlite.prepare('INSERT INTO workspace_settings VALUES (?,?)').run('owner','{"brand":"new"}');
  const plan=await model.planAutomation(product,settings);
  for(const [key,source] of [
   ['options_changed',{optionRevision:0,settingsPayload:'{"brand":"new"}'}],
   ['settings_changed',{optionRevision:1,settingsPayload:'{"brand":"old"}'}],
   ['settings_inserted',{optionRevision:1,settingsPayload:null}],
  ]) {
   assert.equal(await h.store.saveAutomation('owner',plan,null,command('run',key),key,source),null);
   assert.equal(await h.store.getAutomationReceipt('owner',product.id,key),null);
   assert.equal((await h.store.getAutomationHistory('owner',product.id)).length,0);
   assert.equal(await h.store.getAutomation('owner',product.id),null);
  }
  h.sqlite.prepare('INSERT INTO workspace_settings VALUES (?,?)').run('other','unrelated');
  assert.ok(await h.store.saveAutomation('owner',plan,null,command('run','current_inputs'),'current',{optionRevision:1,settingsPayload:'{"brand":"new"}'}));
  const second=await model.planAutomation(product,settings,plan);
  h.sqlite.prepare('DELETE FROM workspace_settings WHERE owner_id=?').run('owner');
  assert.equal(await h.store.saveAutomation('owner',second,1,command('run','settings_deleted'),'deleted',{optionRevision:1,settingsPayload:'{"brand":"new"}'}),null);
  assert.equal((await h.store.getAutomationHistory('owner',product.id)).length,1);
  assert.ok(await h.store.saveAutomation('owner',second,1,command('run','current_null'),'null',{optionRevision:1,settingsPayload:null}));
 } finally { h.sqlite.close(); }
});

test('category quotation saves invalidate workflows without implying a mapped file or submission',async()=>{
 const quote={schemaVersion:1,productId:product.id,revision:1,updatedAt:version,overrides:{common:{model:''},options:{}},categoryOverrides:{'category:80719':{common:{brand:'브랜드'},options:{red:{color:'빨강',size:''}}},'category:123':{common:{model:'다른 분류'},options:{}}}};
 const before=JSON.stringify(quote);
 const first=await model.planAutomation(product,settings,null,null,null,version,null,quote);
 const stage=first.stages.find(stage=>stage.id==='quotation');
 assert.equal(stage.status,'blocked');assert.equal(stage.artifacts.length,1);assert.equal(stage.artifacts[0].submissionReady,false);
 const scopes=stage.artifacts[0].data.quotationScopes;
 assert.equal(scopes.length,3);assert.equal(scopes[0].explicitBlankCount,1);
 assert.equal(scopes[1].scope,'category:80719');assert.equal(scopes[1].optionFieldCount,2);assert.equal(scopes[1].explicitBlankCount,1);
 assert.equal(stage.artifacts[0].data.currentCategoryVerified,false);assert.equal(stage.artifacts[0].data.submitted,false);
 const same=await model.planAutomation(product,settings,first,null,null,version,null,quote);
 assert.equal(same.inputFingerprint,first.inputFingerprint);assert.equal(same.stages.find(stage=>stage.id==='quotation').artifacts.length,1);
 const cleared={...quote,revision:2,overrides:{common:{},options:{}},categoryOverrides:{}};
 const second=await model.planAutomation(product,settings,first,null,null,version,null,cleared);
 assert.notEqual(first.inputFingerprint,second.inputFingerprint);assert.equal(second.stages.find(stage=>stage.id==='quotation').artifacts.length,0);
 await assert.rejects(()=>model.planAutomation(product,settings,null,null,null,version,null,{...quote,productId:'other'}));
 assert.equal(JSON.stringify(quote),before);
});

test('automation API reports stale quotation edits and rejects concurrent quotation saves',async()=>{
 const h=sqliteHarness();let quotation={schemaVersion:1,productId:product.id,revision:0,updatedAt:null,overrides:{common:{},options:{}}};let race=false;
 try {
  const route=load('app/api/products/[id]/automation/route.ts',{
   '@/db/queries':{findProduct:async()=>product,getSettings:async()=>null},
   '@/db/quotation-fields':{readQuotationFields:async()=>quotation},
   '@/db/automation':{...h.store,saveAutomation:async(...args)=>{if(race)h.sqlite.prepare('UPDATE product_quotation_fields SET revision=2 WHERE product_id=?').run(product.id);return h.store.saveAutomation(...args);}},
  });
  assert.equal((await route.POST(request(command()),context)).status,200);
  assert.equal((await (await route.GET(new Request('http://localhost'),context)).json()).stale,false);
  quotation={...quotation,revision:1,overrides:{common:{model:'저장됨'},options:{}}};
  h.sqlite.prepare('INSERT INTO product_quotation_fields VALUES (?,?,?)').run(product.id,'owner',1);
  assert.equal((await (await route.GET(new Request('http://localhost'),context)).json()).stale,true);
  race=true;
  const rejected=await route.POST(request(command('run','quote_race')),context);
  assert.equal(rejected.status,409);assert.equal(await h.store.getAutomationReceipt('owner',product.id,'quote_race'),null);
  assert.equal((await h.store.getAutomationHistory('owner',product.id)).length,1);
 } finally {h.sqlite.close();}
});
