import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { DatabaseSync } from 'node:sqlite';
import ts from 'typescript';

function load(file, dependencies = {}, mode = 'development') {
  const source = fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports = {};
  vm.runInNewContext(output, { exports, crypto, URL, Response, process: { env: { NODE_ENV: mode } }, require: name => {
    if (name in dependencies) return dependencies[name];
    if (name === '@/app/workflow') return load('app/workflow.ts');
    if (name === '@/app/sourcing') return load('app/sourcing.ts');
    if (name === '@/app/workspace-settings') return load('app/workspace-settings.ts');
    if (name === '@/app/pricing') return load('app/pricing.ts');
    if (name === '@/app/chatgpt-auth') return {getChatGPTUser:async()=>null,getWorkspaceOwnerId:async()=>'local-demo'};
    if (name === '@/db/queries') return {getSettings:async()=>null};
    if (name === '@/db/category-profiles') return {getCategoryProfile:async()=>({id:'12345678-1234-1234-1234-123456789012',revision:1,verification:'draft'})};
    if (name === 'next/server') return { NextResponse: Response };
    throw new Error(`Unexpected dependency: ${name}`);
  } });
  return exports;
}

// Real SQLite statements with a transactional D1-shaped adapter. No external
// requests, real product data, credentials, or production storage are used.
function storage() {
  const sqlite = new DatabaseSync(':memory:');
  const db = {
    prepare(sql) {
      let values = [];
      const query = {
        bind(...args) { values = args; return query; },
        execute() { return sqlite.prepare(sql).all(...values); },
        async all() { return { results: query.execute() }; },
        async first() { return query.execute()[0] ?? null; },
      };
      return query;
    },
    async batch(queries) {
      sqlite.exec('BEGIN');
      try { const result = queries.map(query => ({ results: query.execute() })); sqlite.exec('COMMIT'); return result; }
      catch (error) { sqlite.exec('ROLLBACK'); throw error; }
    },
  };
  return { sqlite, queries: load('db/collection-jobs.ts', { 'cloudflare:workers': { env: { DB: db } } }) };
}
const parse = load('app/sourcing.ts').parseCollectionRequest;
const url = 'https://detail.1688.com/offer/123456789.html';
const payload = { urls: [url], goal: 'collect', profileId:'12345678-1234-1234-1234-123456789012' };
const request = body => new Request('http://localhost/api/collection-jobs', { method: 'POST', body: JSON.stringify(body) });

test('URL-only requests normalize tracking links and reject an entire invalid batch', () => {
  const entries = parse({ urls: [url + '?spm=test', url + '?hotSaleSkuId=111'], goal: 'price' });
  assert.equal(entries.length, 1);
  assert.equal(entries[0].sourceUrl, url);
  assert.equal(entries[0].offerId, '123456789');
  for (const value of [null, [], { urls: [] }, { urls: Array(51).fill(url) }, { urls: [url, 'https://evil.example'] },
    { urls: [url], goal: 'done' }, { urls: ['https://detail.1688.com/offer/000.html'] }]) assert.throws(() => parse(value));
});

test('SQLite persists, deduplicates repeated and parallel requests, and preserves the first goal', async () => {
  const { sqlite, queries } = storage();
  try {
    const [first] = await queries.enqueueCollection('owner-a', parse(payload));
    const repeated = await Promise.all(Array.from({ length: 8 }, () => queries.enqueueCollection('owner-a', parse({ ...payload, goal: 'work' }))));
    for (const [job] of repeated) { assert.equal(job.id, first.id); assert.equal(job.goal, 'collect'); }
    const jobs = await queries.listCollectionJobs('owner-a');
    assert.equal(jobs.length, 1);
    assert.equal(jobs[0].status, 'awaiting_connector');
    assert.equal(jobs[0].owner_id, undefined);
    assert.equal(sqlite.prepare("SELECT name FROM sqlite_master WHERE name='products'").get(), undefined);
  } finally { sqlite.close(); }
});

test('owner isolation and cancellation keep history; a later request receives a fresh ID', async () => {
  const { sqlite, queries } = storage();
  try {
    const [a] = await queries.enqueueCollection('a', parse(payload));
    const [b] = await queries.enqueueCollection('b', parse(payload));
    assert.notEqual(a.id, b.id);
    assert.equal(await queries.cancelCollection('b', a.id), null);
    const cancelled = await queries.cancelCollection('a', a.id);
    assert.equal(cancelled.status, 'cancelled');
    assert.equal((await queries.cancelCollection('a', a.id)).updated_at, cancelled.updated_at);
    const [next] = await queries.enqueueCollection('a', parse(payload));
    assert.notEqual(next.id, a.id);
    assert.equal((await queries.listCollectionJobs('a')).length, 2);
    assert.equal((await queries.listCollectionJobs('b')).length, 1);
  } finally { sqlite.close(); }
});

test('SQLite rolls back the whole input batch when any insert fails', async () => {
  const { sqlite, queries } = storage();
  try {
    await queries.listCollectionJobs('a');
    const entries = parse(payload);
    await assert.rejects(queries.enqueueCollection('a', [...entries, { ...entries[0], offerId: '999', goal: 'invalid' }]));
    assert.equal((await queries.listCollectionJobs('a')).length, 0);
  } finally { sqlite.close(); }
});

test('intake returns stored IDs without reporting execution; no external calls are available', async () => {
  const { sqlite, queries } = storage();
  try {
    const route = load('app/api/collection-jobs/route.ts', { '@/db/collection-jobs': queries });
    const response = await route.POST(request(payload));
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.executionStarted, false);
    assert.equal(result.jobs.length, 1);
    assert.equal((await (await route.GET()).json()).jobs[0].id, result.jobs[0].id);
    assert.equal((await route.POST(request({ urls: [url, 'invalid'] }))).status, 400);
    assert.equal((await route.POST(new Request('http://localhost', { method: 'POST', body: '{' }))).status, 400);
  } finally { sqlite.close(); }
});

test('storage failures do not fabricate requests or leak database details', async () => {
  const fail = async () => { throw new Error('PRIVATE DATABASE'); };
  const route = load('app/api/collection-jobs/route.ts', { '@/db/collection-jobs': { enqueueCollection: fail, listCollectionJobs: fail } });
  for (const response of [await route.GET(), await route.POST(request(payload))]) {
    assert.equal(response.status, 503);
    const result = await response.json();
    assert.equal(result.jobs, undefined);
    assert.ok(!JSON.stringify(result).includes('PRIVATE'));
  }
});

test('public production intake and cancellation fail closed before touching storage', async () => {
  const route = load('app/api/collection-jobs/route.ts', { '@/db/collection-jobs': {} }, 'production');
  assert.equal((await route.GET()).status, 503);
  assert.equal((await route.POST(request(payload))).status, 503);
  const cancel = load('app/api/collection-jobs/[id]/route.ts', { '@/db/collection-jobs': {} }, 'production');
  assert.equal((await cancel.DELETE(request({}), { params: Promise.resolve({ id: crypto.randomUUID() }) })).status, 503);
});

test('cancellation endpoint validates identity and returns the persisted cancellation', async () => {
  const { sqlite, queries } = storage();
  try {
    const [job] = await queries.enqueueCollection('local-demo', parse(payload));
    const route = load('app/api/collection-jobs/[id]/route.ts', { '@/db/collection-jobs': queries });
    const run = id => route.DELETE(request({}), { params: Promise.resolve({ id }) });
    assert.equal((await run('bad')).status, 400);
    assert.equal((await run(crypto.randomUUID())).status, 404);
    assert.equal((await (await run(job.id)).json()).job.status, 'cancelled');
  } finally { sqlite.close(); }
});

test('category and settings snapshot persist and repeated URL cannot replace the original context',async()=>{
  const {sqlite,queries}=storage();
  try{
    const original={category:{id:'category-a',revision:1},settings:{exchangeRate:190},features:'test',keywords:'one',capturedAt:'2026-09-22'};
    const [job]=await queries.enqueueCollection('local-demo',parse(payload),original);
    await queries.enqueueCollection('local-demo',parse(payload),{...original,settings:{exchangeRate:999}});
    const [stored]=await queries.listCollectionJobs('local-demo');
    assert.equal(stored.id,job.id);assert.equal(stored.context.settings.exchangeRate,190);
    assert.equal((await queries.cancelCollection('local-demo',job.id)).context.category.id,'category-a');
  }finally{sqlite.close();}
});

test('intake requires category selection before URL staging and rejects missing profiles',async()=>{
  const route=load('app/api/collection-jobs/route.ts',{'@/db/collection-jobs':{},'@/db/category-profiles':{getCategoryProfile:async()=>null}});
  assert.equal((await route.POST(request({urls:[url]}))).status,400);
  assert.equal((await route.POST(request(payload))).status,404);
});
