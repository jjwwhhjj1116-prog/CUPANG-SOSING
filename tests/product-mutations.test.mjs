import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { DatabaseSync } from 'node:sqlite';

function load(file, overrides = {}) {
  const code = ts.transpileModule(fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports = {};
  vm.runInNewContext(code, { exports, crypto, Response, TextEncoder, TextDecoder, Uint8Array, DataView, process: { env: { NODE_ENV: 'development' } }, require(name) {
    if (name in overrides) return overrides[name];
    if (name === 'next/server') return { NextResponse: Response };
    if (name === '@/app/chatgpt-auth') return { getChatGPTUser: async () => ({userId:'owner'}), getWorkspaceOwnerId: async () => 'owner' };
    if (name.startsWith('@/app/')) return load(`${name.slice(2)}.ts`, overrides);
    throw Error(name);
  } }, {filename:file});
  return exports;
}
function harness() {
  const sqlite = new DatabaseSync(':memory:');
  const db = { prepare(sql) { let args = []; const query = { bind(...values) { args = values; return query; }, execute() { return sqlite.prepare(sql).all(...args); }, async first() { return query.execute()[0] ?? null; }, async all() { return {results:query.execute()}; }, async run() { return sqlite.prepare(sql).run(...args); } }; return query; },
    async batch(queries) { sqlite.exec('BEGIN'); try { const result = queries.map(query => ({results:query.execute()})); sqlite.exec('COMMIT'); return result; } catch (error) { sqlite.exec('ROLLBACK'); throw error; } } };
  const env = { DB:db };
  const queries = load('db/queries.ts', {'cloudflare:workers':{env}});
  return {sqlite,env,queries};
}
const initialVersion = '2999-01-01T00:00:00.000Z';
const product = {id:'product',owner_id:'owner',source_url:'https://example.invalid/local-test-only',title:'LOCAL TEST ONLY',source_price_cny:1,exchange_rate:100,supply_margin:0,coupang_margin:0,supply_price:100,sale_price:100,msrp:100,options_count:1,seo_status:'대기',image_status:'대기',quote_status:'대기',registration_status:'수동 입력',supplier_hub_status:'미전송',image_keys:'["owner/original.png"]',goal_stage:'collect',created_at:initialVersion,updated_at:initialVersion};
const request = body => new Request('http://localhost/api/products/product', {method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
const context = {params:Promise.resolve({id:'product'})};

test('actual SQL CAS permits one competing edit and strictly advances even future/same-millisecond versions', async () => {
  const {sqlite,queries} = harness();
  try {
    await queries.insertProduct(product);
    sqlite.prepare('INSERT INTO product_price_policy VALUES (?,?)').run(product.id,'{"savedPolicy":true}');
    const candidates = await Promise.all([
      queries.updateProduct('owner',product.id,{title:'first contender'},initialVersion),
      queries.updateProduct('owner',product.id,{title:'second contender'},initialVersion),
    ]);
    assert.equal(candidates.filter(Boolean).length,1);
    const winner = candidates.find(Boolean);
    assert.equal(winner.updated_at,'2999-01-01T00:00:00.001Z');
    assert.equal(winner.pricing_policy,'{"savedPolicy":true}');
    const legacy = await queries.updateProduct('owner',product.id,{title:'legacy title edit'});
    assert.equal(legacy.updated_at,'2999-01-01T00:00:00.002Z');
    assert.equal(legacy.image_keys,product.image_keys);
    assert.equal(await queries.updateProduct('other-owner',product.id,{title:'foreign edit'},legacy.updated_at),null);
    assert.equal(await queries.updateProduct('owner','missing',{title:'missing edit'}),null);
    assert.equal((await queries.findProduct('owner',product.id)).title,'legacy title edit');
  } finally {sqlite.close();}
});

test('AI append during generic image PATCH validation survives with 409, preserving both original and generated references', async () => {
  const {sqlite,env,queries} = harness();
  try {
    await queries.insertProduct(product);
    sqlite.exec('CREATE TABLE product_content(product_id TEXT PRIMARY KEY,owner_id TEXT,revision INTEGER,payload TEXT)');
    const imageStore = load('db/image-jobs.ts',{'cloudflare:workers':{env}});
    const job = {id:'image-job',productId:product.id,productVersion:initialVersion,contentRevision:0,status:'prepared',review:{fingerprint:'review-fingerprint',expiresAt:'2999-12-31T00:00:00.000Z',settingsSnapshot:{translateImages:true,removeBackground:true,addCopyright:true,translationPrompt:''}},result:null,error:null,createdAt:new Date().toISOString(),approvedAt:null,startedAt:null,finishedAt:null};
    await imageStore.createImageJob('owner',job,product.image_keys,'local-test-key','local-test-fingerprint');
    await imageStore.approveImageJob('owner',product.id,job.id,job.review.fingerprint,new Date().toISOString());
    const claimed = await imageStore.claimImageJob('owner',product.id,job.id,job.review.fingerprint,'test-claim',new Date().toISOString());
    assert.ok(claimed);
    let validations = 0;
    const png = new Uint8Array(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2RkcAAAAASUVORK5CYII=','base64'));
    env.FILES = {async get(key) {
      assert.equal(key,'owner/uploaded.png'); validations++;
      // Model HTTP is never invoked: only the actual durable completion SQL is used.
      const completed = await imageStore.finishImageSuccess('owner',claimed,'test-claim',{storageKey:'owner/ai-result.png',attached:false});
      assert.equal(completed.result.attached,true);
      return {size:png.byteLength,body:new ReadableStream({start(controller){controller.enqueue(png);controller.close();}})};
    }};
    const route = load('app/api/products/[id]/route.ts',{'cloudflare:workers':{env},'@/db/queries':queries});
    const response = await route.PATCH(request({image_keys:'["owner/original.png","owner/uploaded.png"]',title:'stale edit',expectedVersion:initialVersion}),context);
    assert.equal(response.status,409); assert.equal(validations,1);
    const saved = await queries.findProduct('owner',product.id);
    assert.deepEqual(JSON.parse(saved.image_keys),['owner/original.png','owner/ai-result.png']);
    assert.equal(saved.title,product.title);
    assert.ok(saved.updated_at>initialVersion);
    assert.equal((await route.PATCH(request({image_keys:product.image_keys,expectedVersion:initialVersion}),context)).status,409);
    assert.equal(validations,1);
    assert.equal((await route.PATCH(request({image_keys:product.image_keys,expectedVersion:saved.updated_at}),{params:Promise.resolve({id:'missing'})})).status,404);
  } finally {sqlite.close();}
});
