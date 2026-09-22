import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { DatabaseSync } from 'node:sqlite';
import { deflateSync } from 'node:zlib';

function load(file, overrides = {}, mode = 'development', fetcher = () => { throw Error('Unexpected real HTTP request'); }) {
  const code = ts.transpileModule(fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports = {};
  vm.runInNewContext(code, { exports, crypto, TextEncoder, TextDecoder, structuredClone, Response, URL, AbortSignal, Blob, FormData, atob,
    fetch: fetcher, process: { env: { NODE_ENV: mode } }, require: name => {
      if (name in overrides) return overrides[name];
      if (name === 'next/server') return { NextResponse: Response };
      if (name === '@/app/chatgpt-auth') return { getChatGPTUser: async () => ({ userId: 'owner' }), getWorkspaceOwnerId: async () => 'owner' };
      if (name.startsWith('@/app/')) return load(`${name.slice(2)}.ts`, overrides, mode, fetcher);
      throw Error(name);
    } }, { filename: file });
  return exports;
}
const crc32 = load('app/exports/zip.ts').crc32;
// Actual PNG fixtures containing only synthetic blank pixels; no product data or remote files.
function png(width, height, value = 0) {
  function chunk(type, data) { const name = Buffer.from(type); const length = Buffer.alloc(4); length.writeUInt32BE(data.length); const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([name, data]))); return Buffer.concat([length, name, data, crc]); }
  const header = Buffer.alloc(13); header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 6;
  const rows = Buffer.alloc(height * (width * 4 + 1), value); for (let row = 0; row < height; row++) rows[row * (width * 4 + 1)] = 0;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(rows)), chunk('IEND', Buffer.alloc(0))]);
}
const original = png(2, 2); const output = png(1024, 1024);
const model = load('app/automation/image-edit.ts');
const secrets = { OPENAI_API_KEY: 'TEST-ONLY-NOT-A-REAL-KEY', SOURCEFLOW_IMAGE_MODEL: 'gpt-image-1.5' };
const config = model.requireImageConfig(secrets);
const input = { sourceKey: 'owner/source.png', prompt: '보이는 문구만 한국어로 번역하고 상품 형태를 보존해 주세요.', purpose: 'translate', size: '1024x1024', quality: 'low' };
const response = () => Response.json({ data: [{ b64_json: output.toString('base64') }], output_format: 'png', size: '1024x1024', quality: 'low', usage: { input_tokens: 20, output_tokens: 30, total_tokens: 50 } }, { headers: { 'x-request-id': 'req_fixture' } });

test('image configuration has no implicit model and exposes no key', () => {
  assert.equal(model.imageConfiguration({}).issues.length, 2);
  assert.equal(model.imageConfiguration(secrets).configured, true);
  assert.ok(!JSON.stringify(model.imageConfiguration(secrets)).includes(secrets.OPENAI_API_KEY));
  assert.throws(() => model.requireImageConfig({ ...secrets, SOURCEFLOW_IMAGE_MODEL: 'dall-e-2' }));
});

test('image recipes apply saved settings by purpose without inventing copyright owners or replacing manual requests', async () => {
  const settings = model.imageProcessingSettings({translateImages:true,removeBackground:true,addCopyright:true,translationPrompt:'읽을 수 있는 재질명은 일상적인 한국어로 번역해주세요.',brand:'NOT-A-VERIFIED-RIGHTS-OWNER'});
  const thumbnail = await model.prepareImageReview({...input,prompt:'제품을 화면 중앙에 배치해주세요.',purpose:'thumbnail'},await model.imageMetadata(original),config.model,settings);
  assert.equal(thumbnail.recipe.find(step=>step.key==='background').status,'applied');
  assert.equal(thumbnail.recipe.find(step=>step.key==='translation').status,'applied');
  assert.equal(thumbnail.recipe.find(step=>step.key==='translationPrompt').status,'applied');
  assert.equal(thumbnail.recipe.find(step=>step.key==='copyright').status,'skipped');
  assert.ok(thumbnail.effectivePrompt.includes(settings.translationPrompt));
  assert.ok(thumbnail.effectivePrompt.includes('제품을 화면 중앙에 배치해주세요.'));
  assert.ok(!thumbnail.effectivePrompt.includes('NOT-A-VERIFIED-RIGHTS-OWNER'));
  assert.ok(thumbnail.effectivePrompt.includes('Never infer a copyright owner'));
  for (const purpose of ['translate','detail']) {
    const review = await model.prepareImageReview({...input,purpose},await model.imageMetadata(original),config.model,settings);
    assert.equal(review.recipe.find(step=>step.key==='background').status,'skipped');
    assert.ok(review.effectivePrompt.includes('Preserve the original background'));
  }
  const disabled = model.imageProcessingSettings({...settings,translateImages:false,removeBackground:false});
  const detail = await model.prepareImageReview({...input,prompt:'',purpose:'detail'},await model.imageMetadata(original),config.model,disabled);
  assert.equal(detail.recipe.find(step=>step.key==='translation').status,'skipped');
  assert.equal(detail.recipe.find(step=>step.key==='translationPrompt').status,'skipped');
  assert.ok(!detail.effectivePrompt.includes(settings.translationPrompt));
  assert.ok(detail.effectivePrompt.includes('Do not translate or rewrite it'));
  const explicit = await model.prepareImageReview(input,await model.imageMetadata(original),config.model,disabled);
  assert.equal(explicit.recipe.find(step=>step.key==='translation').status,'applied');
  assert.ok(explicit.recipe.find(step=>step.key==='translation').description.includes('직접 선택한'));
  assert.equal(model.validateImageEditInput({...input,prompt:''},'owner',[input.sourceKey]).prompt,'');
  assert.throws(()=>model.imageProcessingSettings({...settings,translateImages:'true'}));
});

test('free image review fingerprint binds exact relevant settings but excludes unrelated workspace fields', async () => {
  const now = new Date('2026-09-22T00:00:00.000Z');
  const metadata = await model.imageMetadata(original);
  const settings = model.imageProcessingSettings();
  const first = await model.prepareImageReview(input,metadata,config.model,settings,now);
  for (const change of [{translateImages:false},{removeBackground:false},{addCopyright:false},{translationPrompt:'Keep exact measurements.'}]) {
    const changed = await model.prepareImageReview(input,metadata,config.model,{...settings,...change},now);
    assert.notEqual(changed.settingsFingerprint,first.settingsFingerprint);
    assert.notEqual(changed.fingerprint,first.fingerprint);
  }
  const unchanged = await model.prepareImageReview(input,metadata,config.model,model.imageProcessingSettings({...settings,brand:'different',exchangeRate:999}),now);
  assert.equal(unchanged.fingerprint,first.fingerprint);
});
test('original file validation rejects foreign assets, wrong MIME, truncation and excessive dimensions', async () => {
  assert.throws(() => model.validateImageEditInput({ ...input, sourceKey: 'other/source.png' }, 'owner', ['other/source.png']));
  assert.throws(() => model.validateImageEditInput({ ...input, size: 'auto' }, 'owner', [input.sourceKey]));
  const metadata = await model.imageMetadata(original, 'image/png'); assert.equal(metadata.width, 2); assert.equal(metadata.sha256.length, 64);
  await assert.rejects(model.imageMetadata(original, 'image/jpeg'));
  assert.throws(() => model.inspectImage(original.subarray(0, 40)));
  assert.throws(() => model.inspectImage(Buffer.from('<svg onload="bad"/>')));
  const excessive = Buffer.from(original); excessive.writeUInt32BE(16001, 16); assert.throws(() => model.inspectImage(excessive));
});
test('Images Edits adapter sends one reviewed multipart image and validates PNG output', async () => {
  const review = await model.prepareImageReview(input, await model.imageMetadata(original), config.model); let calls = 0;
  const result = await model.executeImageEdit(review, config, original, async (url, request) => {
    calls++; assert.equal(url, 'https://api.openai.com/v1/images/edits'); assert.equal(request.redirect, 'error');
    assert.equal(request.headers.Authorization, `Bearer ${config.apiKey}`); assert.equal(request.headers['Content-Type'], undefined);
    assert.equal(request.body.get('n'), '1'); assert.equal(request.body.get('model'), config.model); assert.equal(request.body.get('output_format'), 'png');
    assert.equal(request.body.get('prompt'), review.effectivePrompt); assert.equal(request.body.get('image').type, 'image/png');
    assert.equal((await request.body.get('image').arrayBuffer()).byteLength, original.length);
    return response();
  });
  assert.equal(calls, 1); assert.equal(result.metadata.width, 1024); assert.equal(result.metadata.height, 1024);
  assert.equal(result.providerRequestId, 'req_fixture'); assert.equal(result.usage.total_tokens, 50);
  assert.equal(Buffer.compare(Buffer.from(result.bytes), output), 0);
});
test('changed original, invalid encoding, remote URL-only output and wrong dimensions never become results', async () => {
  const review = await model.prepareImageReview(input, await model.imageMetadata(original), config.model); let calls = 0;
  await assert.rejects(model.executeImageEdit(review, config, png(2, 2, 1), async () => { calls++; return response(); }), error => error.code === 'SOURCE_IMAGE_CHANGED'); assert.equal(calls, 0);
  for (const payload of [{ data: [{ b64_json: '!!!' }] }, { data: [{ url: 'https://example.invalid/never-fetch' }] }, { data: [{ b64_json: original.toString('base64') }] }, { data: [{ b64_json: output.toString('base64') }, { b64_json: output.toString('base64') }] }]) {
    await assert.rejects(model.executeImageEdit(review, config, original, async () => Response.json(payload)), error => error.mayHaveBeenCharged === true);
  }
  await assert.rejects(model.executeImageEdit(review, config, original, async () => { throw Error('timeout'); }), error => error.code === 'PROVIDER_OUTCOME_UNCERTAIN');
});

function harness() {
  const sqlite = new DatabaseSync(':memory:');
  const db = { prepare(sql) { let args = []; const query = { bind(...values) { args = values; return query; }, execute() { return sqlite.prepare(sql).all(...args); }, async first() { return query.execute()[0] ?? null; }, async all() { return { results: query.execute() }; }, async run() { return sqlite.prepare(sql).run(...args); } }; return query; },
    async batch(queries) { sqlite.exec('BEGIN'); try { const result = queries.map(query => ({ results: query.execute() })); sqlite.exec('COMMIT'); return result; } catch (error) { sqlite.exec('ROLLBACK'); throw error; } } };
  sqlite.exec("CREATE TABLE products(id TEXT PRIMARY KEY,owner_id TEXT,updated_at TEXT,image_keys TEXT,quote_status TEXT DEFAULT '대기'); CREATE TABLE product_content(product_id TEXT PRIMARY KEY,owner_id TEXT,revision INTEGER,payload TEXT); CREATE TABLE workspace_settings(owner_id TEXT PRIMARY KEY,payload TEXT NOT NULL,updated_at TEXT NOT NULL)");
  sqlite.prepare('INSERT INTO products(id,owner_id,updated_at,image_keys) VALUES (?,?,?,?)').run('product', 'owner', '2026-09-22T00:00:00.000Z', JSON.stringify([input.sourceKey]));
  sqlite.prepare('INSERT INTO product_content VALUES (?,?,?,?)').run('product', 'owner', 2, 'MANUAL_ROLES_MUST_NOT_CHANGE');
  const objects = new Map([[input.sourceKey, { bytes: original, type: 'image/png' }]]);
  const files = { async get(key) { const value = objects.get(key); return value ? { size: value.bytes.length, httpMetadata: { contentType: value.type }, async arrayBuffer() { return Uint8Array.from(value.bytes).buffer; } } : null; },
    async put(key, bytes, options) { objects.set(key, { bytes: Uint8Array.from(bytes), type: options.httpMetadata.contentType }); return {}; } };
  const env = { DB: db, FILES: files, ...secrets };
  const store = load('db/image-jobs.ts', { 'cloudflare:workers': { env } });
  const dependencies = { 'cloudflare:workers': { env }, '@/db/image-jobs': store,
    '@/db/queries': { findProduct: async (owner, id) => sqlite.prepare('SELECT * FROM products WHERE owner_id=? AND id=?').get(owner, id) ?? null, getSettings: async owner => sqlite.prepare('SELECT payload FROM workspace_settings WHERE owner_id=?').get(owner) ?? null },
    '@/db/product-content': { readProductContent: async () => ({ revision: 2 }) } };
  function settings(patch) {
    const current = sqlite.prepare('SELECT payload FROM workspace_settings WHERE owner_id=?').get('owner');
    sqlite.prepare('INSERT INTO workspace_settings VALUES (?,?,?) ON CONFLICT(owner_id) DO UPDATE SET payload=excluded.payload,updated_at=excluded.updated_at').run('owner',JSON.stringify({...JSON.parse(current?.payload ?? '{}'),...patch}),new Date().toISOString());
  }
  return { sqlite, env, files, objects, store, dependencies, settings };
}
const context = { params: Promise.resolve({ id: 'product' }) };
const request = body => new Request('http://localhost/api/products/product/image-generation', { method: 'POST', headers: { 'content-type': 'application/json', origin: 'http://localhost' }, body: JSON.stringify(body) });
const prepare = { action: 'prepare', expectedVersion: '2026-09-22T00:00:00.000Z', idempotencyKey: 'fixture_prepare', ...input };
async function approvedJob(route) { const prepared = await route.POST(request(prepare), context); assert.equal(prepared.status, 201); const { job } = await prepared.json(); const approved = await route.POST(request({ action: 'approve', jobId: job.id, reviewFingerprint: job.review.fingerprint, confirmPaid: true }), context); assert.equal(approved.status, 200); return job; }

test('image prepare/approve are free; execute appends one owned R2 result and preserves original roles', async () => {
  const { sqlite, objects, dependencies } = harness(); let calls = 0;
  const route = load('app/api/products/[id]/image-generation/route.ts', dependencies, 'development', async () => { calls++; return response(); });
  try {
    const job = await approvedJob(route); assert.equal(calls, 0);
    const replay = await route.POST(request(prepare), context); assert.equal(replay.status, 200); assert.equal((await replay.json()).job.id, job.id);
    const executed = await route.POST(request({ action: 'execute', jobId: job.id }), context); assert.equal(executed.status, 200);
    const saved = (await executed.json()).job; assert.equal(saved.status, 'completed'); assert.equal(saved.result.attached, true); assert.equal(saved.result.assignedRole, false);
    assert.equal(saved.result.provenance, 'generated'); assert.equal(calls, 1); assert.ok(objects.has(saved.result.storageKey));
    assert.match(saved.result.storageKey, /^owner\/ai-[a-f0-9-]+\.png$/);
    const keys = JSON.parse(sqlite.prepare('SELECT image_keys FROM products').get().image_keys);
    assert.equal(keys[0], input.sourceKey); assert.equal(keys[1], saved.result.storageKey); assert.equal(keys.length, 2);
    assert.equal(sqlite.prepare('SELECT payload FROM product_content').get().payload, 'MANUAL_ROLES_MUST_NOT_CHANGE');
    assert.equal((await route.POST(request({ action: 'execute', jobId: job.id }), context)).status, 200); assert.equal(calls, 1);
  } finally { sqlite.close(); }
});

test('API reads saved settings into review and permits optional additional instructions without charging', async () => {
  const {sqlite,dependencies,settings} = harness(); let calls = 0;
  settings({translateImages:false,removeBackground:true,addCopyright:true,translationPrompt:'DO-NOT-APPLY-WHEN-TRANSLATION-DISABLED',brand:'NO-COPYRIGHT-INFERENCE'});
  const route = load('app/api/products/[id]/image-generation/route.ts',dependencies,'development',async()=>{calls++;return response();});
  try {
    const view = await (await route.GET(new Request('http://localhost'),context)).json();
    assert.equal(view.settings.translateImages,false); assert.equal(view.settingsFingerprint.length,64);
    const prepared = await route.POST(request({...prepare,purpose:'thumbnail',prompt:''}),context); assert.equal(prepared.status,201);
    const {job} = await prepared.json();
    assert.equal(job.review.settingsFingerprint,view.settingsFingerprint);
    assert.equal(job.review.settingsSnapshot.translationPrompt,'DO-NOT-APPLY-WHEN-TRANSLATION-DISABLED');
    assert.equal(job.review.recipe.find(step=>step.key==='background').status,'applied');
    assert.ok(!job.review.effectivePrompt.includes('DO-NOT-APPLY-WHEN-TRANSLATION-DISABLED'));
    assert.ok(!job.review.effectivePrompt.includes('NO-COPYRIGHT-INFERENCE'));
    assert.equal(calls,0);
  } finally {sqlite.close();}
});

test('every relevant setting change invalidates approval and approved execution before any paid call', async () => {
  for (const changed of [{translateImages:false},{removeBackground:false},{addCopyright:false},{translationPrompt:'새 번역 지침'}]) {
    for (const phase of ['approve','execute']) {
      const {sqlite,dependencies,settings} = harness(); let calls=0;
      const route=load('app/api/products/[id]/image-generation/route.ts',dependencies,'development',async()=>{calls++;return response();});
      try {
        const {job}=await (await route.POST(request(prepare),context)).json();
        const approval={action:'approve',jobId:job.id,reviewFingerprint:job.review.fingerprint,confirmPaid:true};
        if(phase==='execute') assert.equal((await route.POST(request(approval),context)).status,200);
        settings(changed);
        const result=await route.POST(request(phase==='approve'?approval:{action:'execute',jobId:job.id}),context);
        assert.equal(result.status,409); assert.equal((await result.json()).code,'IMAGE_SETTINGS_CHANGED'); assert.equal(calls,0);
        assert.equal(sqlite.prepare('SELECT status FROM image_jobs').get().status,phase==='approve'?'prepared':'approved');
        // The same idempotency key cannot silently rebind a previously reviewed request to new settings.
        assert.equal((await route.POST(request(prepare),context)).status,409);
      } finally {sqlite.close();}
    }
  }
});

test('SQLite claim detects settings changed during source validation; unrelated settings do not invalidate approval', async () => {
  const {sqlite,dependencies,files,settings} = harness(); let calls=0;
  const route=load('app/api/products/[id]/image-generation/route.ts',dependencies,'development',async()=>{calls++;return response();});
  try {
    const job=await approvedJob(route); const originalGet=files.get;
    files.get=async key=>{settings({removeBackground:false});return originalGet(key);};
    assert.equal((await route.POST(request({action:'execute',jobId:job.id}),context)).status,409);
    assert.equal(calls,0); assert.equal(sqlite.prepare('SELECT status FROM image_jobs').get().status,'approved');
    files.get=originalGet; settings({removeBackground:true,exchangeRate:987,brand:'UNRELATED-SETTING'});
    assert.equal((await route.POST(request({action:'execute',jobId:job.id}),context)).status,200); assert.equal(calls,1);
    settings({removeBackground:false});
    assert.equal((await route.POST(request({action:'execute',jobId:job.id}),context)).status,200); assert.equal(calls,1);
  } finally {sqlite.close();}
});

test('SQLite preparation rejects settings changed after the server read', async () => {
  const {sqlite,dependencies,settings} = harness();
  const getSettings=dependencies['@/db/queries'].getSettings;
  dependencies['@/db/queries'].getSettings=async owner=>{const previous=await getSettings(owner);settings({translateImages:false});return previous;};
  const route=load('app/api/products/[id]/image-generation/route.ts',dependencies);
  try {
    assert.equal((await route.POST(request(prepare),context)).status,409);
    assert.equal(sqlite.prepare('SELECT count(*) AS total FROM image_jobs').get().total,0);
  } finally {sqlite.close();}
});
test('concurrent execution clicks issue one image API call', async () => {
  const { sqlite, dependencies } = harness(); let calls = 0; let start; let release;
  const started = new Promise(resolve => { start = resolve; }); const pending = new Promise(resolve => { release = resolve; });
  const route = load('app/api/products/[id]/image-generation/route.ts', dependencies, 'development', async () => { calls++; start(); return pending; });
  try { const job = await approvedJob(route); const first = route.POST(request({ action: 'execute', jobId: job.id }), context); await started;
    assert.equal((await route.POST(request({ action: 'execute', jobId: job.id }), context)).status, 202); assert.equal(calls, 1);
    release(response()); assert.equal((await first).status, 200); assert.equal(calls, 1);
  } finally { sqlite.close(); }
});
test('changed source hash or product state after approval prevents spending', async () => {
  const { sqlite, dependencies, objects } = harness(); let calls = 0;
  const route = load('app/api/products/[id]/image-generation/route.ts', dependencies, 'development', async () => { calls++; return response(); });
  try { const job = await approvedJob(route); objects.set(input.sourceKey, { bytes: png(2, 2, 1), type: 'image/png' });
    assert.equal((await route.POST(request({ action: 'execute', jobId: job.id }), context)).status, 409); assert.equal(calls, 0);
    objects.set(input.sourceKey, { bytes: original, type: 'image/png' }); sqlite.exec('UPDATE product_content SET revision=3');
    assert.equal((await route.POST(request({ action: 'execute', jobId: job.id }), context)).status, 409); assert.equal(calls, 0);
  } finally { sqlite.close(); }
});
test('concurrent product changes retain generated result for free attachment and preserve other images', async () => {
  const { sqlite, dependencies } = harness(); let calls = 0;
  const changed = '2026-09-23T00:00:00.000Z';
  const route = load('app/api/products/[id]/image-generation/route.ts', dependencies, 'development', async () => { calls++; sqlite.prepare('UPDATE products SET updated_at=?,image_keys=?').run(changed, JSON.stringify([input.sourceKey, 'owner/other.png'])); return response(); });
  try { const job = await approvedJob(route); const result = await route.POST(request({ action: 'execute', jobId: job.id }), context);
    const saved = (await result.json()).job; assert.equal(saved.status, 'completed'); assert.equal(saved.result.attached, false);
    assert.equal(JSON.parse(sqlite.prepare('SELECT image_keys FROM products').get().image_keys).length, 2);
    const attach = await route.POST(request({ action: 'attach', jobId: job.id, expectedVersion: changed }), context); assert.equal(attach.status, 200); assert.equal((await attach.json()).job.result.attached, true);
    const keys = JSON.parse(sqlite.prepare('SELECT image_keys FROM products').get().image_keys); assert.equal(keys.length, 3); assert.equal(keys[1], 'owner/other.png'); assert.equal(calls, 1);
    const current = sqlite.prepare('SELECT updated_at FROM products').get().updated_at;
    assert.equal((await route.POST(request({ action: 'attach', jobId: job.id, expectedVersion: current }), context)).status, 200);
    assert.equal(JSON.parse(sqlite.prepare('SELECT image_keys FROM products').get().image_keys).length, 3); assert.equal(calls, 1);
  } finally { sqlite.close(); }
});
test('R2 storage failure consumes the claim without repeating a paid call', async () => {
  const { sqlite, dependencies, files } = harness(); let calls = 0;
  files.put = async () => { throw Error('R2 failed'); };
  const route = load('app/api/products/[id]/image-generation/route.ts', dependencies, 'development', async () => { calls++; return response(); });
  try { const job = await approvedJob(route); const result = await route.POST(request({ action: 'execute', jobId: job.id }), context); assert.equal(result.status, 503);
    assert.equal((await result.json()).code, 'IMAGE_RESULT_PERSISTENCE_UNCERTAIN');
    assert.equal((await route.POST(request({ action: 'execute', jobId: job.id }), context)).status, 202); assert.equal(calls, 1);
    assert.equal(JSON.parse(sqlite.prepare('SELECT image_keys FROM products').get().image_keys).length, 1);
  } finally { sqlite.close(); }
});
test('production without verified access, foreign assets, oversized bodies and forged model are rejected', async () => {
  const { sqlite, dependencies } = harness();
  try { const production = load('app/api/products/[id]/image-generation/route.ts', dependencies, 'production'); assert.equal((await production.POST(request(prepare), context)).status, 503);
    const route = load('app/api/products/[id]/image-generation/route.ts', dependencies);
    assert.equal((await route.POST(request({ ...prepare, model: 'forged' }), context)).status, 400);
    assert.equal((await route.POST(request({ ...prepare, sourceKey: 'other/source.png' }), context)).status, 400);
    assert.equal((await route.POST(request({ ...prepare, prompt: 'x'.repeat(33 * 1024) }), context)).status, 413);
    const { job } = await (await route.POST(request(prepare), context)).json();
    assert.equal((await route.POST(request({ action: 'execute', jobId: job.id }), context)).status, 409);
  } finally { sqlite.close(); }
});
