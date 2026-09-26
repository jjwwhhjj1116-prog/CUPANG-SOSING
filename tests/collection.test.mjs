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
  vm.runInNewContext(output, { exports, Error, crypto, URL, Response, process: { env: { NODE_ENV: mode } }, require: name => {
    if (name in dependencies) return dependencies[name];
    if (name === '@/db/collection-results') return load('db/collection-results.ts', dependencies);
    if (name === '@/app/category-profiles') return load('app/category-profiles.ts');
    if (name === '@/app/workflow') return load('app/workflow.ts');
    if (name === '@/app/sourcing') return load('app/sourcing.ts');
    if (name === '@/app/workspace-settings') return load('app/workspace-settings.ts');
    if (name === '@/app/pricing') return load('app/pricing.ts');
    if (name === '@/app/chatgpt-auth') return {getChatGPTUser:async()=>null,getWorkspaceOwnerId:async()=>'local-demo'};
    if (name === '@/db/queries') return {getSettings:async()=>null};
    if (name === '@/db/category-profiles') return {getCategoryProfile:async()=>({id:'12345678-1234-1234-1234-123456789012',revision:1,categoryId:'80719',verification:'draft'})};
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
const payload = { urls: [url], goal: 'collect', expectedProfileRevision:1, profileId:'12345678-1234-1234-1234-123456789012' };
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

test('changed category settings return 409 before settings reads or enqueue; matching snapshot is preserved',async()=>{
 let reads=0,writes=0,captured;
 const category={id:payload.profileId,revision:2,categoryId:'81452',categoryPath:['헬스보호대'],template:null,mappings:[],verification:'draft'};
 const route=load('app/api/collection-jobs/route.ts',{
  '@/db/category-profiles':{getCategoryProfile:async()=>category},
  '@/db/queries':{getSettings:async()=>{reads++;return null;}},
  '@/db/collection-jobs':{enqueueCollection:async(owner,entries,context)=>{writes++;captured=context;return [];}}
 });
 const stale=await route.POST(request(payload));assert.equal(stale.status,409);assert.equal((await stale.json()).code,'CATEGORY_PROFILE_CHANGED');
 assert.equal(reads,0);assert.equal(writes,0);
 const current=await route.POST(request({...payload,expectedProfileRevision:2,features:'보존 특징',keywords:'보존 키워드'}));
 assert.equal(current.status,200);assert.equal(writes,1);assert.equal(captured.category.revision,2);assert.equal(captured.category.categoryId,'81452');assert.equal(captured.features,'보존 특징');
 for(const key of ['brand','manufacturer','importer','serviceContact','tradeType','importType','taxType'])assert.equal(captured.settings[key],'',key);
 for(const revision of [undefined,null,0,-1,1.5,'2',Number.MAX_SAFE_INTEGER+1])assert.equal((await route.POST(request({...payload,expectedProfileRevision:revision}))).status,400);
 assert.equal(writes,1);
});

test('mixed intake reports only requests whose persisted context differs and never replaces original data',async()=>{
 const {sqlite,queries}=storage();
 try{
  let category={id:payload.profileId,revision:1,categoryId:'80719',categoryPath:['바스켓'],template:null,mappings:[]};
  const route=load('app/api/collection-jobs/route.ts',{'@/db/collection-jobs':queries,'@/db/category-profiles':{getCategoryProfile:async()=>category}});
  const first=await (await route.POST(request({...payload,features:'원래 특징'}))).json();
  assert.equal(first.preservedRequests.length,0);
  const repeated=await (await route.POST(request({...payload,features:'원래 특징'}))).json();
  assert.equal(repeated.preservedRequests.length,0);
  category={...category,revision:2,categoryId:'81452',categoryPath:['보호대']};
  const mixed=await (await route.POST(request({...payload,expectedProfileRevision:2,urls:[url,'https://detail.1688.com/offer/987654321.html'],goal:'work',features:'새 특징',keywords:'새 키워드'}))).json();
  assert.equal(mixed.jobs.length,2);assert.equal(mixed.preservedRequests.length,1);
  assert.equal(mixed.preservedRequests[0].sourceUrl,url);
  assert.deepEqual(mixed.preservedRequests[0].differences,['작업 목표','카테고리·견적서 설정','상품 특징','타겟 키워드']);
  const old=mixed.jobs.find(job=>job.id===first.jobs[0].id);
  assert.equal(old.context.category.categoryId,'80719');assert.equal(old.context.features,'원래 특징');
  assert.equal(mixed.jobs.find(job=>job.id!==old.id).context.category.categoryId,'81452');
  const retry=await (await route.POST(request({...payload,expectedProfileRevision:2,urls:[url,'https://detail.1688.com/offer/987654321.html'],goal:'work',features:'새 특징',keywords:'새 키워드'}))).json();
  assert.equal(retry.preservedRequests.length,1);assert.equal((await queries.listCollectionJobs('local-demo')).length,2);
 }finally{sqlite.close();}
});
test('intake preserves explicit registration facts without inventing missing fields',async()=>{
 let captured;
 const route=load('app/api/collection-jobs/route.ts',{
  '@/db/queries':{getSettings:async()=>({payload:JSON.stringify({brand:'내 브랜드',manufacturer:'',tradeType:'기타 도소매업자',exchangeRate:350})})},
  '@/db/collection-jobs':{enqueueCollection:async(_owner,_entries,context)=>{captured=context;return [];}}
 });
 assert.equal((await route.POST(request(payload))).status,200);
 assert.equal(captured.settings.brand,'내 브랜드');assert.equal(captured.settings.manufacturer,'');assert.equal(captured.settings.importer,'');assert.equal(captured.settings.importType,'');assert.equal(captured.settings.tradeType,'기타 도소매업자');assert.equal(captured.settings.exchangeRate,350);
});

test('context comparison ignores capture time and object key order but reports settings and missing legacy evidence',()=>{
 const compare=load('app/sourcing.ts').preservedCollectionRequests;
 const context={category:{id:'a',categoryId:'80719'},settings:{exchangeRate:200,brand:'A'},features:'',keywords:'',capturedAt:'today'};
 const job={offer_id:'123456789',source_url:url,goal:'collect',context:{...context,capturedAt:'yesterday',settings:{brand:'A',exchangeRate:200}}};
 const before=JSON.stringify(job);
 assert.equal(compare([job],parse(payload),context).length,0);
 assert.equal(compare([job],parse(payload),{...context,settings:{...context.settings,exchangeRate:300}})[0].differences[0],'기본설정');
 assert.equal(compare([{...job,context:null}],parse(payload),context)[0].differences[0],'카테고리·기본설정 기록 없음');
 assert.equal(JSON.stringify(job),before);
});

test('legacy invalid category codes cannot enter collection and fail before reading settings or enqueuing', async () => {
  let touched = 0;
  for (const categoryId of ['', '카테고리', '80719/81452', 'a'.repeat(101)]) {
    const route = load('app/api/collection-jobs/route.ts', {
      '@/db/category-profiles': { getCategoryProfile: async () => ({ id: payload.profileId, revision: 1, categoryId }) },
      '@/db/queries': { getSettings: async () => { touched++; } },
      '@/db/collection-jobs': { enqueueCollection: async () => { touched++; } },
    });
    const response = await route.POST(new Request('http://localhost/api/collection-jobs', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) }));
    assert.equal(response.status, 400); assert.equal((await response.json()).code, 'CATEGORY_CODE_INVALID');
  }
  assert.equal(touched, 0);
});

test('queue exposes owner-scoped receipt time without payload and preserves cancellation and product precedence',async()=>{
 const {sqlite,queries}=storage();const progress=load('app/sourcing.ts').collectionJobProgress;
 try{
  const [a]=await queries.enqueueCollection('a',parse(payload));
  const [b]=await queries.enqueueCollection('b',parse(payload));
  assert.equal(a.received_at,null);assert.equal(progress(a).kind,'awaiting_connector');
  sqlite.prepare('INSERT INTO collection_results(job_id,owner_id,payload,received_at) VALUES (?,?,?,?)').run(a.id,'a','{"title":"private source"}','2026-09-24T01:00:00Z');
  const jobs=await queries.listCollectionJobs('a');assert.equal(jobs.length,1);assert.equal(jobs[0].received_at,'2026-09-24T01:00:00Z');assert.equal(progress(jobs[0]).kind,'received');assert.equal(jobs[0].payload,undefined);
  assert.equal((await queries.findCollectionJob('b',b.id)).received_at,null);assert.equal(await queries.findCollectionJob('b',a.id),null);
  // Even an inconsistent owner on a receipt must not disclose its timestamp.
  sqlite.prepare('UPDATE collection_results SET owner_id=? WHERE job_id=?').run('b',a.id);
  assert.equal((await queries.findCollectionJob('a',a.id)).received_at,null);
  sqlite.prepare('UPDATE collection_results SET owner_id=? WHERE job_id=?').run('a',a.id);
  const cancelled=await queries.cancelCollection('a',a.id);assert.equal(cancelled.received_at,jobs[0].received_at);assert.equal(progress(cancelled).kind,'cancelled');
  assert.equal(progress({...jobs[0],product_id:'saved'}).kind,'imported');assert.equal(progress({status:'awaiting_connector'}).kind,'awaiting_connector');
 }finally{sqlite.close();}
});

test('invalid target keywords are rejected before queuing an uneditable SEO draft',async()=>{
 let writes=0;const route=load('app/api/collection-jobs/route.ts',{'@/db/collection-jobs':{enqueueCollection:async()=>{writes++;return [];}}});
 for(const keywords of ['x'.repeat(101),'bad\u0000',Array.from({length:51},(_,i)=>'k'+i).join(',')]) {
  const res=await route.POST(request({...payload,keywords}));assert.equal(res.status,400);assert.match((await res.json()).error,/키워드/);
 }
 assert.equal(writes,0);
});

test('displayed registration settings must match persisted settings before queue creation',async()=>{
 const {savedRegistrationSettings}=load('app/workspace-settings.ts');const settings=savedRegistrationSettings({brand:'저장 브랜드',exchangeRate:350,serviceContact:''});let writes=0;
 const api=load('app/api/collection-jobs/route.ts',{'@/db/queries':{getSettings:async()=>({payload:JSON.stringify(settings)})},'@/db/collection-jobs':{enqueueCollection:async(owner,entries,context)=>{writes++;assert.equal(context.settings.exchangeRate,350);assert.equal(context.settings.brand,'저장 브랜드');return [];}}});
 for(const changed of [{...settings,exchangeRate:190},{...settings,brand:''},{...settings,topImageEnabled:true,topImageKey:'owner/other.png'}]){const r=await api.POST(request({...payload,expectedSettings:changed}));assert.equal(r.status,409);assert.equal((await r.json()).code,'REGISTRATION_SETTINGS_CHANGED');}
 assert.equal(writes,0);
 const reversed=Object.fromEntries(Object.entries(settings).reverse());assert.equal((await api.POST(request({...payload,expectedSettings:reversed}))).status,200);assert.equal(writes,1);
 assert.equal((await api.POST(request({...payload,expectedSettings:null}))).status,400);assert.equal(writes,1);
});
