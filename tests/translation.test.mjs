import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { DatabaseSync } from 'node:sqlite';

function load(file, overrides = {}, mode = 'development', fetcher = () => { throw Error('Unexpected real HTTP request'); }) {
  const source = fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports = {};
  vm.runInNewContext(code, { exports, crypto, TextEncoder, TextDecoder, structuredClone, Response, URL, AbortSignal,
    setTimeout: overrides.__setTimeout ?? setTimeout, clearTimeout: overrides.__clearTimeout ?? clearTimeout, fetch: fetcher, process: { env: { NODE_ENV: mode } }, require: name => {
      if (name in overrides) return overrides[name];
      if (name === 'next/server') return { NextResponse: Response };
      if (name === '@/app/chatgpt-auth') return { getChatGPTUser: async () => ({ userId: 'owner' }), getWorkspaceOwnerId: async () => 'owner' };
      if (name.startsWith('@/app/')) return load(`${name.slice(2)}.ts`, overrides, mode, fetcher);
      throw Error(name);
    } }, { filename: file });
  return exports;
}
const model = load('app/automation/translation.ts');
const source = { title: '纯棉收纳袋', description: '尺寸 10 cm，白色。', attributes: [{ name: '材质', value: '棉' }], provenance: 'manual', reference: 'synthetic local test' };
const draft = { title: '면 수납 주머니', keywords: ['수납', '면 주머니'], description: '크기 10 cm, 흰색.', attributes: [{ sourceIndex: 0, name: '소재', value: '면' }], warnings: ['판매자 원문 기준이며 인증은 확인되지 않았습니다.'] };
const secrets = { OPENAI_API_KEY: 'TEST-ONLY-DO-NOT-USE', SOURCEFLOW_TEXT_MODEL: 'explicit-model-id', SOURCEFLOW_TEXT_MAX_OUTPUT_TOKENS: '1024' };
const config = model.requireTranslationConfig(secrets);
const completed = () => ({ id: 'resp_test', model: 'explicit-model-id-snapshot', status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(draft) }] }], usage: { input_tokens: 100, output_tokens: 80, total_tokens: 180 } });

test('missing server configuration is explicit and never exposes an API key', () => {
  const missing = model.translationConfiguration({});
  assert.equal(missing.configured, false); assert.equal(missing.issues.length, 3);
  assert.equal(model.translationConfiguration(secrets).model, 'explicit-model-id');
  assert.ok(!JSON.stringify(model.translationConfiguration(secrets)).includes(secrets.OPENAI_API_KEY));
  for (const invalid of [{}, { ...secrets, SOURCEFLOW_TEXT_MAX_OUTPUT_TOKENS: '0' }, { ...secrets, SOURCEFLOW_TEXT_MODEL: 'bad/id' }]) assert.throws(() => model.requireTranslationConfig(invalid));
});

test('empty source and invented collection provenance never become a translation request', () => {
  for (const invalid of [null, { ...source, title: '', description: '' }, { ...source, provenance: 'collected' }, { ...source, apiKey: 'client-secret' }, { ...source, attributes: [{ name: 'size', value: '' }] }]) assert.throws(() => model.validateTranslationSource(invalid));
  assert.equal(model.validateTranslationSource(source).title, source.title);
});

test('review fixes the exact model, input and token ceiling without performing HTTP', async () => {
  const review = await model.prepareTranslationReview(source, config);
  const request = model.buildTranslationRequest(review);
  assert.equal(review.model, config.model); assert.equal(review.maxOutputTokens, 1024);
  assert.ok(review.paidNotice.includes('유료')); assert.ok(!JSON.stringify(review).includes(config.apiKey));
  assert.equal(request.store, false); assert.equal(request.max_output_tokens, 1024);
  assert.equal(request.text.format.type, 'json_schema'); assert.equal(request.text.format.strict, true);
  assert.equal(request.text.format.schema.additionalProperties, false);
  assert.equal(JSON.parse(request.input[0].content[0].text).title, source.title);
});

test('Responses adapter calls the fixed endpoint once and validates generated draft and receipt', async () => {
  const review = await model.prepareTranslationReview(source, config); let calls = 0;
  const result = await model.executeTranslation(review, config, async (url, request) => {
    calls++; assert.equal(url, 'https://api.openai.com/v1/responses'); assert.equal(request.redirect, 'error');
    assert.equal(request.headers.Authorization, `Bearer ${config.apiKey}`);
    assert.equal(JSON.parse(request.body).text.format.name, 'korean_product_draft');
    return Response.json(completed());
  });
  assert.equal(calls, 1); assert.equal(result.responseId, 'resp_test'); assert.equal(result.draft.title, draft.title);
  assert.equal(result.usage.totalTokens, 180); assert.equal(result.provenance, 'generated'); assert.equal(result.appliedToContent, false);
});

test('incomplete, refusal, invented numbers and unsupported attributes are never accepted', async () => {
  const review = await model.prepareTranslationReview(source, config);
  const invalid = [
    { ...completed(), status: 'incomplete' },
    { ...completed(), output: [{ type: 'message', content: [{ type: 'refusal', refusal: 'no' }] }] },
    { ...completed(), output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify({ ...draft, title: 'KC 999 인증' }) }] }] },
    { ...completed(), output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify({ ...draft, attributes: [{ sourceIndex: 99, name: 'new', value: 'invented' }] }) }] }] },
  ];
  for (const payload of invalid) await assert.rejects(model.executeTranslation(review, config, async () => Response.json(payload)), error => error.mayHaveBeenCharged === true);
  let calls = 0;
  await assert.rejects(model.executeTranslation(review, config, async () => { calls++; throw Error('network'); }), error => error.code === 'PROVIDER_OUTCOME_UNCERTAIN');
  assert.equal(calls, 1);
  await assert.rejects(model.executeTranslation(review, { ...config, model: 'changed' }, async () => { throw Error('must not call'); }), error => error.code === 'CONFIGURATION_CHANGED');
});

function harness() {
  const sqlite = new DatabaseSync(':memory:');
  const db = { prepare(sql) { let args = []; const query = { bind(...values) { args = values; return query; },
    execute() { return sqlite.prepare(sql).all(...args); }, async first() { return query.execute()[0] ?? null; }, async all() { return { results: query.execute() }; }, async run() { return sqlite.prepare(sql).run(...args); } }; return query;
  }, async batch(queries) { sqlite.exec('BEGIN'); try { const results = queries.map(query => ({ results: query.execute() })); sqlite.exec('COMMIT'); return results; } catch (error) { sqlite.exec('ROLLBACK'); throw error; } } };
  sqlite.exec('CREATE TABLE products (id TEXT PRIMARY KEY,owner_id TEXT,updated_at TEXT); CREATE TABLE product_content (product_id TEXT PRIMARY KEY,owner_id TEXT,revision INTEGER,payload TEXT)');
  sqlite.prepare('INSERT INTO products VALUES (?,?,?)').run('product', 'owner', '2026-09-22T00:00:00.000Z');
  sqlite.prepare('INSERT INTO product_content VALUES (?,?,?,?)').run('product', 'owner', 2, 'MANUAL_CONTENT_MUST_NOT_CHANGE');
  const env = { DB: db, ...secrets };
  const store = load('db/translation-jobs.ts', { 'cloudflare:workers': { env } });
  const product = { id: 'product', owner_id: 'owner', updated_at: '2026-09-22T00:00:00.000Z' };
  const dependencies = { 'cloudflare:workers': { env }, '@/db/translation-jobs': store,
    '@/db/queries': { findProduct: async () => product }, '@/db/product-content': { readProductContent: async () => ({ revision: 2 }) } };
  return { sqlite, env, store, product, dependencies };
}
const context = { params: Promise.resolve({ id: 'product' }) };
const request = body => new Request('http://localhost/api/products/product/translation', { method: 'POST', headers: { 'content-type': 'application/json', origin: 'http://localhost' }, body: JSON.stringify(body) });
const prepare = { action: 'prepare', expectedVersion: '2026-09-22T00:00:00.000Z', idempotencyKey: 'prepare_test', source };

test('prepare and approve never call provider; execute requires separate paid approval and preserves manual content', async () => {
  const { sqlite, dependencies } = harness(); let calls = 0;
  const route = load('app/api/products/[id]/translation/route.ts', dependencies, 'development', async () => { calls++; return Response.json(completed()); });
  try {
    const prepared = await route.POST(request(prepare), context); assert.equal(prepared.status, 201);
    const { job } = await prepared.json(); assert.equal(job.status, 'prepared'); assert.equal(calls, 0);
    const replay = await route.POST(request(prepare), context); assert.equal(replay.status, 200); assert.equal((await replay.json()).job.id, job.id);
    assert.equal((await route.POST(request({ action: 'execute', jobId: job.id }), context)).status, 409);
    assert.equal((await route.POST(request({ action: 'approve', jobId: job.id, reviewFingerprint: job.review.fingerprint, confirmPaid: false }), context)).status, 400);
    const approved = await route.POST(request({ action: 'approve', jobId: job.id, reviewFingerprint: job.review.fingerprint, confirmPaid: true }), context);
    assert.equal(approved.status, 200); assert.equal((await approved.json()).job.status, 'approved'); assert.equal(calls, 0);
    const executed = await route.POST(request({ action: 'execute', jobId: job.id }), context); assert.equal(executed.status, 200);
    assert.equal((await executed.json()).job.status, 'completed'); assert.equal(calls, 1);
    assert.equal((await route.POST(request({ action: 'execute', jobId: job.id }), context)).status, 200); assert.equal(calls, 1);
    assert.equal(sqlite.prepare('SELECT payload FROM product_content').get().payload, 'MANUAL_CONTENT_MUST_NOT_CHANGE');
    const read = await route.GET(new Request('http://localhost'), context); assert.ok(!(await read.text()).includes(secrets.OPENAI_API_KEY));
  } finally { sqlite.close(); }
});

test('concurrent execute clicks acquire one durable claim and invoke HTTP only once', async () => {
  const { sqlite, dependencies } = harness(); let calls = 0; let release; let started;
  const startedPromise = new Promise(resolve => { started = resolve; });
  const responsePromise = new Promise(resolve => { release = resolve; });
  const route = load('app/api/products/[id]/translation/route.ts', dependencies, 'development', async () => { calls++; started(); return responsePromise; });
  try {
    const { job } = await (await route.POST(request(prepare), context)).json();
    await route.POST(request({ action: 'approve', jobId: job.id, reviewFingerprint: job.review.fingerprint, confirmPaid: true }), context);
    const first = route.POST(request({ action: 'execute', jobId: job.id }), context);
    await startedPromise;
    const duplicate = await route.POST(request({ action: 'execute', jobId: job.id }), context);
    assert.equal(duplicate.status, 202); assert.equal(calls, 1);
    release(Response.json(completed())); assert.equal((await first).status, 200); assert.equal(calls, 1);
  } finally { sqlite.close(); }
});

test('content edits after approval and expired reviews fail before spending', async () => {
  const { sqlite, dependencies } = harness(); let calls = 0;
  const route = load('app/api/products/[id]/translation/route.ts', dependencies, 'development', async () => { calls++; return Response.json(completed()); });
  try {
    const { job } = await (await route.POST(request(prepare), context)).json();
    await route.POST(request({ action: 'approve', jobId: job.id, reviewFingerprint: job.review.fingerprint, confirmPaid: true }), context);
    sqlite.exec('UPDATE product_content SET revision=3');
    assert.equal((await route.POST(request({ action: 'execute', jobId: job.id }), context)).status, 409); assert.equal(calls, 0);
    sqlite.exec('UPDATE product_content SET revision=2');
    sqlite.prepare('UPDATE translation_jobs SET expires_at=?').run('2000-01-01T00:00:00.000Z');
    assert.equal((await route.POST(request({ action: 'execute', jobId: job.id }), context)).status, 409); assert.equal(calls, 0);
  } finally { sqlite.close(); }
});

test('a provider result persistence failure leaves the claim consumed and prevents another paid request', async () => {
  const { sqlite, dependencies, store } = harness(); let calls = 0;
  const route = load('app/api/products/[id]/translation/route.ts', { ...dependencies, '@/db/translation-jobs': { ...store, finishTranslationJob: async () => { throw Error('disk'); } } }, 'development', async () => { calls++; return Response.json(completed()); });
  try {
    const { job } = await (await route.POST(request(prepare), context)).json();
    await route.POST(request({ action: 'approve', jobId: job.id, reviewFingerprint: job.review.fingerprint, confirmPaid: true }), context);
    const first = await route.POST(request({ action: 'execute', jobId: job.id }), context);
    assert.equal(first.status, 503); assert.equal((await first.json()).code, 'RESULT_PERSISTENCE_UNCERTAIN');
    assert.equal((await route.POST(request({ action: 'execute', jobId: job.id }), context)).status, 202); assert.equal(calls, 1);
  } finally { sqlite.close(); }
});

test('production, unconfigured, foreign-origin and client secret requests cannot execute paid work', async () => {
  const { sqlite, dependencies, env } = harness();
  try {
    const production = load('app/api/products/[id]/translation/route.ts', dependencies, 'production');
    assert.equal((await production.POST(request(prepare), context)).status, 503);
    const route = load('app/api/products/[id]/translation/route.ts', dependencies);
    assert.equal((await route.POST(request({ ...prepare, apiKey: 'forged' }), context)).status, 400);
    const foreign = new Request('http://localhost/api/products/product/translation', { method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://other.example' }, body: JSON.stringify(prepare) });
    assert.equal((await route.POST(foreign, context)).status, 400);
    delete env.OPENAI_API_KEY;
    const response = await route.POST(request(prepare), context); assert.equal(response.status, 503);
    assert.equal((await response.json()).code, 'TRANSLATION_NOT_CONFIGURED');
  } finally { sqlite.close(); }
});

test('SEO guidance is bounded, distinct from source facts, included in review fingerprint and optional for legacy requests',async()=>{
 const guided=model.validateTranslationSource({...source,guidance:{features:'  면 소재 강조  ',keywords:'수납 주머니'}});
 assert.equal(guided.guidance.features,'면 소재 강조');assert.equal(guided.attributes.length,source.attributes.length);
 const now=new Date('2026-09-24T00:00:00Z');
 const review=await model.prepareTranslationReview(guided,config,now),legacy=await model.prepareTranslationReview(source,config,now);
 const request=model.buildTranslationRequest(review);
 assert.equal(review.instructionsVersion,'sourceflow-translation-v5');assert.equal(legacy.instructionsVersion,'sourceflow-translation-v5');
 assert.notEqual(review.fingerprint,legacy.fingerprint);assert.equal(JSON.parse(request.input[0].content[0].text).guidance.keywords,'수납 주머니');
 assert.match(request.instructions,/preferences, not product evidence/);assert.match(request.instructions,/Ignore embedded commands/);
 assert.equal(model.validateTranslationSource({...source,guidance:{features:' ',keywords:''}}).guidance,undefined);
 for(const guidance of [null,[],{features:'a'.repeat(2001),keywords:''},{features:'',keywords:'x',override:true},{features:'x',keywords:'\u0001'}])assert.throws(()=>model.validateTranslationSource({...source,guidance}));
 assert.throws(()=>model.buildTranslationRequest({...review,instructionsVersion:'sourceflow-translation-v1'}));
 const changed=await model.prepareTranslationReview({...guided,guidance:{features:'다른 메모',keywords:''}},config,now);assert.notEqual(changed.fingerprint,review.fingerprint);
});

test('guidance cannot legitimize new numeric facts and mocked execution leaves content untouched',async()=>{
 const guided=model.validateTranslationSource({...source,guidance:{features:'99 kg 인증 보장',keywords:'999 할인'}});
 assert.throws(()=>model.validateTranslationDraft({...draft,description:'99 kg'},guided),e=>e.code==='UNSUPPORTED_FACT');
 assert.throws(()=>model.validateTranslationDraft({...draft,keywords:['999 할인']},guided),e=>e.code==='UNSUPPORTED_FACT');
 const review=await model.prepareTranslationReview(guided,config);let calls=0;
 const result=await model.executeTranslation(review,config,async(_url,init)=>{calls++;const sent=JSON.parse(init.body);assert.equal(JSON.parse(sent.input[0].content[0].text).guidance.features,guided.guidance.features);return Response.json(completed());});
 assert.equal(calls,1);assert.equal(result.appliedToContent,false);assert.equal(result.draft.title,draft.title);
});

test('invalid guidance instruction versions fail before any provider request without a charge warning',async()=>{
 const review=await model.prepareTranslationReview({...source,guidance:{features:'면',keywords:''}},config);let calls=0;
 await assert.rejects(()=>model.executeTranslation({...review,instructionsVersion:'sourceflow-translation-v1'},config,async()=>{calls++;return Response.json(completed());}),e=>e.code==='UNSUPPORTED_INSTRUCTIONS'&&e.mayHaveBeenCharged===false);
 assert.equal(calls,0);
});

test('new translation reviews include quotation keyword limits while older reviewed requests retain their rules',async()=>{
 const current=await model.prepareTranslationReview(source,config);
 assert.equal(current.instructionsVersion,'sourceflow-translation-v5');
 assert.match(model.buildTranslationRequest(current).instructions,/150 UTF-16/);
 for(const version of ['sourceflow-translation-v1','sourceflow-translation-v2']){
  const old={...current,instructionsVersion:version};
  assert.doesNotMatch(model.buildTranslationRequest(old).instructions,/150 UTF-16/);
  assert.equal(model.validateTranslationDraft({...draft,keywords:['가'.repeat(21)]},source,version).keywords[0].length,21);
 }
});
test('v3 validates the exact quotation separator budget and never silently shortens rejected words',()=>{
 const keywords=['가','나','다','라','마','바'].map(word=>word.repeat(20));keywords.push('사'.repeat(18));
 const input={...draft,keywords};const before=JSON.stringify(input);
 assert.equal(model.validateTranslationDraft(input,source,'sourceflow-translation-v3').keywords.join(', ').length,150);
 assert.equal(JSON.stringify(input),before);
 for(const invalid of [[...keywords,'추가'],['가'.repeat(21)],['가방,끈'],['가방\n끈']]){
  assert.throws(()=>model.validateTranslationDraft({...draft,keywords:invalid},source,'sourceflow-translation-v3'),e=>e.code==='INVALID_QUOTATION_KEYWORDS'&&e.mayHaveBeenCharged);
 }
});
test('over-budget provider output is rejected after one call without automatic retry',async()=>{
 const review=await model.prepareTranslationReview(source,config);let calls=0;
 const result=completed();result.output[0].content[0].text=JSON.stringify({...draft,keywords:['가'.repeat(21)]});
 await assert.rejects(()=>model.executeTranslation(review,config,async()=>{calls++;return Response.json(result);}),e=>e.code==='INVALID_QUOTATION_KEYWORDS'&&e.mayHaveBeenCharged);
 assert.equal(calls,1);
});

test('persisted v1 and v2 requests replay, approve and execute with their original keyword contract after v3 deployment',async()=>{
 for(const version of ['sourceflow-translation-v1','sourceflow-translation-v2']){
  const {sqlite,dependencies}=harness();let calls=0,requestBody;
  const response=completed();response.output[0].content[0].text=JSON.stringify({...draft,keywords:['가'.repeat(21)]});
  const route=load('app/api/products/[id]/translation/route.ts',dependencies,'development',async(_url,init)=>{calls++;requestBody=JSON.parse(init.body);return Response.json(response);});
  try{
   const prepared=await (await route.POST(request(prepare),context)).json();
   const original={...prepared.job.review,instructionsVersion:version};delete original.fingerprint;
   const review={...original,fingerprint:await load('app/automation/model.ts').fingerprint(original)};
   sqlite.prepare('UPDATE translation_jobs SET review=?,review_fingerprint=? WHERE id=?').run(JSON.stringify(review),review.fingerprint,prepared.job.id);
   const replay=await (await route.POST(request(prepare),context)).json();
   assert.equal(replay.replayed,true);assert.deepEqual(replay.job.review,review);assert.equal(calls,0);
   assert.equal((await route.POST(request({action:'approve',jobId:prepared.job.id,reviewFingerprint:review.fingerprint,confirmPaid:true}),context)).status,200);
   const executed=await (await route.POST(request({action:'execute',jobId:prepared.job.id}),context)).json();
   assert.equal(executed.job.status,'completed');assert.equal(executed.job.result.draft.keywords[0].length,21);
   assert.doesNotMatch(requestBody.instructions,/150 UTF-16/);assert.equal(calls,1);
   await route.POST(request({action:'execute',jobId:prepared.job.id}),context);assert.equal(calls,1);
  }finally{sqlite.close();}
 }
});

test('v3 invalid quotation keywords persist as failed and cannot trigger a second provider call',async()=>{
 const {sqlite,dependencies}=harness();let calls=0;
 const response=completed();response.output[0].content[0].text=JSON.stringify({...draft,keywords:['가'.repeat(21)]});
 const route=load('app/api/products/[id]/translation/route.ts',dependencies,'development',async()=>{calls++;return Response.json(response);});
 try{
  const {job}=await (await route.POST(request(prepare),context)).json();
  await route.POST(request({action:'approve',jobId:job.id,reviewFingerprint:job.review.fingerprint,confirmPaid:true}),context);
  const executed=await (await route.POST(request({action:'execute',jobId:job.id}),context)).json();
  assert.equal(executed.job.status,'failed');assert.equal(executed.job.result,null);assert.equal(executed.job.error.code,'INVALID_QUOTATION_KEYWORDS');assert.equal(executed.job.error.mayHaveBeenCharged,true);
  const replay=await (await route.POST(request({action:'execute',jobId:job.id}),context)).json();
  assert.equal(replay.replayed,true);assert.equal(replay.job.status,'failed');assert.equal(calls,1);
  assert.equal(sqlite.prepare('SELECT count(*) n FROM translation_jobs').get().n,1);
 }finally{sqlite.close();}
});

test('category context is bounded, fingerprinted and sent only with the new instructions',async()=>{
 const category={id:'80719',path:['주방용품','주방수납/정리','바구니']};
 const review=await model.prepareTranslationReview({...source,category},config,new Date('2026-09-26T00:00:00Z'));
 assert.equal(review.instructionsVersion,'sourceflow-translation-v5');
 const request=model.buildTranslationRequest(review);
 assert.deepEqual(JSON.parse(request.input[0].content[0].text).category,category);
 assert.match(request.instructions,/seller-selected registration category/);assert.match(request.instructions,/preserve the source facts/);
 const changed=await model.prepareTranslationReview({...source,category:{...category,id:'81452'}},config,new Date('2026-09-26T00:00:00Z'));
 assert.notEqual(review.fingerprint,changed.fingerprint);
 for(const invalid of [{id:'',path:['주방']},{id:'a/b',path:['주방']},{id:'80719',path:[]},{id:'80719',path:['']},{id:'80719',path:Array(11).fill('주방')},{id:'80719',path:['가'.repeat(201)]}])assert.throws(()=>model.validateTranslationSource({...source,category:invalid}));
 for(const version of ['sourceflow-translation-v1','sourceflow-translation-v2','sourceflow-translation-v3'])assert.throws(()=>model.buildTranslationRequest({...review,instructionsVersion:version}));
 assert.doesNotThrow(()=>model.buildTranslationRequest({...review,source:model.validateTranslationSource(source),instructionsVersion:'sourceflow-translation-v3'}));
 assert.throws(()=>model.validateTranslationDraft({...draft,keywords:['가'.repeat(21)]},review.source,'sourceflow-translation-v4'));
});

test('Workers AI uses its server binding without OpenAI secrets and validates source facts', async () => {
  let calls = 0;
  const ai = { run: async (name, input) => {
    calls++; assert.equal(name, model.WORKERS_TEXT_MODEL);
    assert.equal(input.response_format.type, 'json_schema');
    assert.equal(input.stream, false); assert.equal(input.max_tokens, 1024);
    assert.equal(JSON.parse(input.messages[1].content).title, source.title);
    return { response: draft, usage: { prompt_tokens: 100, completion_tokens: 80, total_tokens: 180 } };
  } };
  const own = model.requireTranslationConfig({ SOURCEFLOW_TEXT_PROVIDER: 'workers-ai', SOURCEFLOW_TEXT_MODEL: model.WORKERS_TEXT_MODEL, SOURCEFLOW_TEXT_MAX_OUTPUT_TOKENS: '1024', AI: ai });
  const review = await model.prepareTranslationReview(source, own);
  assert.equal(review.destination, 'Cloudflare Workers AI');
  assert.ok(review.paidNotice.includes('Paid')); assert.ok(!JSON.stringify(review).includes('apiKey'));
  const result = await model.executeTranslation(review, own, () => { throw Error('Must not call OpenAI'); });
  assert.equal(calls, 1); assert.equal(result.draft.title, draft.title);
  assert.equal(result.usage.totalTokens, 180); assert.equal(result.appliedToContent, false);
  assert.match(result.responseId, /^workers-ai-local:/);
  await assert.rejects(model.executeTranslation({ ...review, destination: 'OpenAI Responses API' }, own), /변경/);
  assert.equal(calls, 1);
  for (const response of [null, {}, { response: { ...draft, title: '999 인증' } }, { response: 'not json' }]) {
    await assert.rejects(model.executeTranslation(review, { ...own, ai: { run: async () => response } }));
  }
  let failedCalls = 0;
  await assert.rejects(model.executeTranslation(review, { ...own, ai: { run: async () => { failedCalls++; throw Error('quota'); } } }), error => error.code === 'PROVIDER_OUTCOME_UNCERTAIN');
  assert.equal(failedCalls, 1);
});

test('Workers AI configuration rejects absent binding, unsupported model and unknown provider', () => {
  const env = { SOURCEFLOW_TEXT_PROVIDER: 'workers-ai', SOURCEFLOW_TEXT_MODEL: model.WORKERS_TEXT_MODEL, SOURCEFLOW_TEXT_MAX_OUTPUT_TOKENS: '1024', AI: { run: async () => ({}) } };
  for (const override of [{ AI: undefined }, { SOURCEFLOW_TEXT_MODEL: '@cf/unknown/model' }, { SOURCEFLOW_TEXT_MAX_OUTPUT_TOKENS: '0' }, { SOURCEFLOW_TEXT_PROVIDER: 'typo' }]) {
    assert.equal(model.translationConfiguration({ ...env, ...override }).configured, false);
  }
});

test('Workers AI deadline returns an uncertain outcome once and discards late results', async () => {
  let deadline; let cleared = 0; let calls = 0; let complete;
  const bounded = load('app/automation/translation.ts', {
    __setTimeout: (callback, milliseconds) => { assert.equal(milliseconds, 60000); deadline = callback; return 42; },
    __clearTimeout: handle => { assert.equal(handle, 42); cleared++; },
  });
  const config = bounded.requireTranslationConfig({ SOURCEFLOW_TEXT_PROVIDER: 'workers-ai', SOURCEFLOW_TEXT_MODEL: bounded.WORKERS_TEXT_MODEL, SOURCEFLOW_TEXT_MAX_OUTPUT_TOKENS: '1024',
    AI: { run: () => { calls++; return new Promise(resolve => { complete = resolve; }); } } });
  const review = await bounded.prepareTranslationReview(source, config);
  const pending = bounded.executeTranslation(review, config);
  deadline();
  await assert.rejects(pending, error => error.code === 'PROVIDER_OUTCOME_UNCERTAIN' && error.mayHaveBeenCharged);
  complete({ response: draft }); await Promise.resolve();
  assert.equal(calls, 1); assert.equal(cleared, 1);
});

test('expired unstarted intake keeps one job, renews review and clears old approval', async () => {
  for (const state of ['prepared','approved']) {
    const {sqlite,store,product}=harness();
    try {
      const review=await model.prepareTranslationReview(source,config,new Date('2026-01-01T00:00:00Z'));
      const value={id:crypto.randomUUID(),productId:'product',productVersion:product.updated_at,contentRevision:2,status:'prepared',review,createdAt:'2026-01-01T00:00:00.000Z'};
      await store.createTranslationJob('owner',value,'intake-auto-v1','same-source');
      sqlite.prepare('UPDATE translation_jobs SET status=?,approved_at=?').run(state,state==='approved'?value.createdAt:null);
      const fresh={...value,id:crypto.randomUUID(),createdAt:new Date().toISOString(),review:await model.prepareTranslationReview(source,config)};
      const result=await store.createTranslationJob('owner',fresh,'intake-auto-v1','same-source');
      assert.equal(result.job.id,value.id);assert.equal(result.job.status,'prepared');assert.equal(result.job.approvedAt,null);
      assert.equal(result.job.review.fingerprint,fresh.review.fingerprint);assert.equal(sqlite.prepare('SELECT count(*) n FROM translation_jobs').get().n,1);
      assert.equal(await store.approveTranslationJob('owner','product',value.id,review.fingerprint,fresh.createdAt),null);
      assert.ok(await store.approveTranslationJob('owner','product',value.id,fresh.review.fingerprint,fresh.createdAt));
    } finally {sqlite.close();}
  }
});

test('expired intake renewal never resets executed jobs or bypasses changed source/content', async () => {
  for (const variant of ['running','completed','failed','uncertain','source','content','product']) {
    const {sqlite,store,product}=harness();
    try {
      const review=await model.prepareTranslationReview(source,config,new Date('2026-01-01T00:00:00Z'));
      const value={id:crypto.randomUUID(),productId:'product',productVersion:product.updated_at,contentRevision:2,status:'prepared',review,createdAt:'2026-01-01T00:00:00.000Z'};
      await store.createTranslationJob('owner',value,'intake-options-fixture','same-source');
      if(['running','completed','failed','uncertain'].includes(variant))sqlite.prepare('UPDATE translation_jobs SET status=?,started_at=?').run(variant,value.createdAt);
      if(variant==='content')sqlite.exec('UPDATE product_content SET revision=3');
      if(variant==='product')sqlite.exec("UPDATE products SET updated_at='changed'");
      const fresh={...value,createdAt:new Date().toISOString(),review:await model.prepareTranslationReview(source,config)};
      const result=await store.createTranslationJob('owner',fresh,'intake-options-fixture',variant==='source'?'changed-source':'same-source');
      assert.equal(result.job.review.fingerprint,review.fingerprint);
      assert.equal(sqlite.prepare('SELECT count(*) n FROM translation_jobs').get().n,1);
    } finally {sqlite.close();}
  }
});

test('stale unstarted intake refresh is atomic, clears approval and preserves manual content', async () => {
 for(const variant of ['prepared','approved','running','completed','failed','uncertain','started','claimed','result','error','race','content','owner']){
  const {sqlite,store,product}=harness();
  try{
   const review=await model.prepareTranslationReview(source,config);
   const previous={id:crypto.randomUUID(),productId:'product',productVersion:product.updated_at,contentRevision:2,status:'prepared',review,createdAt:new Date().toISOString()};
   await store.createTranslationJob('owner',previous,'intake-auto-v1','old-source');
   const version='2026-09-23T00:00:00.000Z';
   sqlite.prepare('UPDATE products SET updated_at=?').run(version);sqlite.exec('UPDATE product_content SET revision=3');
   if(['approved','running','completed','failed','uncertain'].includes(variant))sqlite.prepare('UPDATE translation_jobs SET status=?,approved_at=?').run(variant,previous.createdAt);
   if(variant==='started')sqlite.prepare('UPDATE translation_jobs SET started_at=?').run(previous.createdAt);
   if(variant==='claimed')sqlite.exec("UPDATE translation_jobs SET claim_token='other-worker'");
   if(variant==='result')sqlite.exec("UPDATE translation_jobs SET result='{}'");
   if(variant==='error')sqlite.exec("UPDATE translation_jobs SET error='{}'");
   if(variant==='race')sqlite.exec("UPDATE products SET updated_at='newer'");
   if(variant==='content')sqlite.exec('UPDATE product_content SET revision=4');
   const fresh={...previous,id:crypto.randomUUID(),productVersion:version,contentRevision:3,review:await model.prepareTranslationReview({...source,title:'新的商品'},config)};
   const refreshed=await store.refreshUnstartedIntake(variant==='owner'?'other-owner':'owner',previous,fresh,'new-source');
   if(['prepared','approved'].includes(variant)){
    assert.ok(refreshed);assert.equal(refreshed.job.id,previous.id);assert.equal(refreshed.job.productVersion,version);assert.equal(refreshed.job.contentRevision,3);assert.equal(refreshed.job.status,'prepared');assert.equal(refreshed.job.approvedAt,null);
    assert.equal(await store.approveTranslationJob('owner','product',previous.id,review.fingerprint,new Date().toISOString()),null);
    assert.equal(await store.refreshUnstartedIntake('owner',previous,fresh,'new-source'),null);
   }else{assert.equal(refreshed,null);assert.equal(sqlite.prepare('SELECT product_version FROM translation_jobs').get().product_version,previous.productVersion);}
   assert.equal(sqlite.prepare('SELECT count(*) n FROM translation_jobs').get().n,1);assert.equal(sqlite.prepare('SELECT payload FROM product_content').get().payload,'MANUAL_CONTENT_MUST_NOT_CHANGE');
  }finally{sqlite.close();}
 }
});

test('new reviews require every source attribute while legacy results keep their reviewed contract',async()=>{
 const sourceWithOptions={...source,attributes:[...source.attributes,{name:'option:red',value:'红色'},{name:'option-color:red',value:'红色'}]};
 const review=await model.prepareTranslationReview(sourceWithOptions,config);
 assert.equal(review.instructionsVersion,'sourceflow-translation-v5');
 assert.match(model.buildTranslationRequest(review).instructions,/exactly one attribute for every input attribute/);
 const full={...draft,attributes:[...draft.attributes,{sourceIndex:2,name:'색상',value:'빨강'},{sourceIndex:1,name:'옵션명',value:'빨강'}]};
 assert.equal(model.validateTranslationDraft(full,sourceWithOptions,review.instructionsVersion).attributes.length,3);
 for(const attributes of [[],full.attributes.slice(0,1),full.attributes.slice(1)]){
  assert.throws(()=>model.validateTranslationDraft({...full,attributes},sourceWithOptions,review.instructionsVersion),e=>e.code==='INCOMPLETE_SOURCE_ATTRIBUTES');
 }
 assert.equal(model.validateTranslationDraft({...full,attributes:[]},sourceWithOptions,'sourceflow-translation-v4').attributes.length,0);
 const legacyRequest=model.buildTranslationRequest({...review,instructionsVersion:'sourceflow-translation-v4'});
 assert.doesNotMatch(legacyRequest.instructions,/exactly one attribute for every input attribute/);
 let calls=0;
 await assert.rejects(model.executeTranslation(review,config,async()=>{calls++;return Response.json(completed());}),e=>e.code==='INCOMPLETE_SOURCE_ATTRIBUTES'&&e.mayHaveBeenCharged);
 assert.equal(calls,1);
 const noAttributes={...source,attributes:[]};assert.equal(model.validateTranslationDraft({...draft,attributes:[]},noAttributes,review.instructionsVersion).attributes.length,0);
});

test('option batch version refresh keeps its ID and never reopens an executed generation',async()=>{
 for(const state of ['prepared','approved','running','completed','failed','uncertain','claimed','race']){
  const {sqlite,store,product}=harness();
  try{
   const key='intake-options-'+'a'.repeat(64);
   const reviewClock=new Date();
   const review=await model.prepareTranslationReview(source,config,reviewClock);
   const old={id:crypto.randomUUID(),productId:'product',productVersion:product.updated_at,contentRevision:2,status:'prepared',review,createdAt:new Date().toISOString()};
   await store.createTranslationJob('owner',old,key,'before-images');
   const version='2026-09-28T00:00:00.000Z';sqlite.prepare('UPDATE products SET updated_at=?').run(version);
   if(['approved','running','completed','failed','uncertain'].includes(state))sqlite.prepare('UPDATE translation_jobs SET status=?,approved_at=?').run(state,old.createdAt);
   if(state==='claimed')sqlite.exec("UPDATE translation_jobs SET claim_token='worker'");
   const fresh={...old,id:crypto.randomUUID(),productVersion:version,review:await model.prepareTranslationReview(source,config,reviewClock)};
   assert.equal(fresh.review.expiresAt,review.expiresAt);
   assert.notEqual(fresh.review.fingerprint,review.fingerprint);
   assert.deepEqual(model.buildTranslationRequest(fresh.review),model.buildTranslationRequest(review));
   if(state==='race')sqlite.exec("UPDATE products SET updated_at='newer'");
   const result=await store.createTranslationJob('owner',fresh,key,'after-images');
   if(['prepared','approved'].includes(state)){
    assert.equal(result.conflict,false);assert.equal(result.job.id,old.id);assert.equal(result.job.status,'prepared');assert.equal(result.job.approvedAt,null);assert.equal(result.job.productVersion,version);
    assert.equal(await store.approveTranslationJob('owner','product',old.id,review.fingerprint,new Date().toISOString()),null);
    assert.ok(await store.approveTranslationJob('owner','product',old.id,fresh.review.fingerprint,new Date().toISOString()));
   }else{
    assert.ok(result===null||result.conflict);assert.equal(sqlite.prepare('SELECT product_version FROM translation_jobs').get().product_version,old.productVersion);
   }
   assert.equal(sqlite.prepare('SELECT count(*) n FROM translation_jobs').get().n,1);
   assert.equal(sqlite.prepare('SELECT payload FROM product_content').get().payload,'MANUAL_CONTENT_MUST_NOT_CHANGE');
  }finally{sqlite.close();}
 }
});
