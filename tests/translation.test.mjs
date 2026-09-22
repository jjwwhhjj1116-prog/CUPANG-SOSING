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
    fetch: fetcher, process: { env: { NODE_ENV: mode } }, require: name => {
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
