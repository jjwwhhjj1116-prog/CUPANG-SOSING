import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { DatabaseSync } from 'node:sqlite';

function load(file, overrides = {}, mode = 'development') {
  const source = ts.transpileModule(fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports = {};
  vm.runInNewContext(source, { exports, Response, TextDecoder, Uint8Array, structuredClone, process: { env: { NODE_ENV: mode } }, require(name) {
    if (name in overrides) return overrides[name];
    if (name === '@/app/product-content') return load('app/product-content.ts');
    if (name === '@/app/chatgpt-auth') return { getChatGPTUser: async () => ({ userId: 'owner' }), getWorkspaceOwnerId: async () => 'owner' };
    if (name === 'next/server') return { NextResponse: Response };
    throw new Error(name);
  } });
  return exports;
}
const model = load('app/product-content.ts');
const now = '2026-09-22T01:00:00.000Z';
const context = { params: Promise.resolve({ id: 'test' }) };
const product = { id: 'test', owner_id: 'owner', image_keys: '["owner/main.jpg","owner/detail.png"]' };
const request = (body, headers = { 'content-type': 'application/json' }) => new Request('http://localhost/api/products/test/content', { method: 'PATCH', headers, body: JSON.stringify(body) });
const input = (patch, expectedRevision = 0) => ({ expectedRevision, patch });

test('content tracks edits without inventing generated content or changing untouched provenance', () => {
  const original = model.emptyProductContent('test');
  original.seo.title = { value: '번역 상품명', provenance: 'translated', updatedAt: '2026-09-01T00:00:00.000Z' };
  const { patch } = model.validateContentInput(input({ seo: { title: '번역 상품명', keywords: ['수납', '수납', '  주방  '] }, label: { material: '면' } }), [], 'owner');
  const result = model.applyContentPatch(original, patch, now);
  assert.equal(result.revision, 1); assert.equal(result.seo.title.provenance, 'translated');
  assert.deepEqual(Array.from(result.seo.keywords.value), ['수납', '주방']);
  assert.equal(result.seo.keywords.provenance, 'manual'); assert.equal(result.label.material.provenance, 'manual');
  assert.equal(result.label.countryOfOrigin.value, ''); assert.equal(result.label.countryOfOrigin.provenance, 'unverified');
  assert.equal(original.revision, 0); assert.equal(original.label.material.value, '');
});

test('content rejects forged provenance, unowned images, huge fields, invalid revisions and duplicate roles', () => {
  const keys = ['owner/main.jpg'];
  for (const body of [null, input({}), input({ seo: { title: { value: 'fake', provenance: 'generated' } } }), input({ provenance: 'generated' }), input({ label: { unknown: 'x' } }), input({ seo: { description: 'x'.repeat(20001) } }), input({ seo: { keywords: Array(51).fill('x') } }), input({ seo: { title: 'a\u0000b' } }), input({ assets: { main: ['other/main.jpg'] } }), input({ assets: { main: ['owner/missing.jpg'] } }), input({ assets: { main: keys.concat(keys) } }), input({ seo: { title: 'x' } }, -1)]) {
    assert.throws(() => model.validateContentInput(body, keys, 'owner'));
  }
  assert.throws(() => model.applyContentPatch(model.emptyProductContent('test'), { assets: { main: keys, detail: keys } }, now));
});

function sqliteDependencies() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(`PRAGMA foreign_keys=ON; CREATE TABLE products(id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, quote_status TEXT, updated_at TEXT, image_keys TEXT); INSERT INTO products VALUES('test','owner','완료','2026-01-01T00:00:00.000Z','["owner/main.jpg"]');`);
  const db = {
    prepare(sql) {
      let args = [];
      const query = { bind(...values) { args = values; return query; }, execute() { return sqlite.prepare(sql).all(...args); }, async first() { return query.execute()[0] ?? null; }, async run() { return sqlite.prepare(sql).run(...args); } };
      return query;
    },
    async batch(queries) {
      sqlite.exec('BEGIN');
      try { const result = queries.map(query => ({ results: query.execute() })); sqlite.exec('COMMIT'); return result; }
      catch (error) { sqlite.exec('ROLLBACK'); throw error; }
    },
  };
  return { sqlite, queries: load('db/product-content.ts', { 'cloudflare:workers': { env: { DB: db } } }) };
}

test('real SQLite preserves durable content and prevents stale/foreign writers from corrupting it', async () => {
  const { sqlite, queries } = sqliteDependencies();
  try {
    const empty = await queries.readProductContent('owner', 'test'); assert.equal(empty.revision, 0);
    const first = model.applyContentPatch(empty, { seo: { title: '저장됨' } }, now);
    assert.equal((await queries.saveProductContent('owner', first, 0)).revision, 1);
    assert.equal(sqlite.prepare('SELECT quote_status FROM products').get().quote_status, '대기');
    assert.equal((await queries.readProductContent('owner', 'test')).seo.title.value, '저장됨');
    sqlite.prepare("UPDATE products SET quote_status='완료'").run();
    const stale = model.applyContentPatch(empty, { seo: { title: '오래된 편집' } }, now);
    assert.equal(await queries.saveProductContent('owner', stale, 0), null);
    assert.equal(sqlite.prepare('SELECT quote_status FROM products').get().quote_status, '완료');
    assert.equal(await queries.saveProductContent('other', stale, 0), null);
    assert.equal((await queries.readProductContent('other', 'test')).revision, 0);
    const second = model.applyContentPatch(first, { label: { model: 'M-1' } }, now);
    assert.equal((await queries.saveProductContent('owner', second, 1)).revision, 2);
    assert.equal((await queries.readProductContent('owner', 'test')).seo.title.value, '저장됨');
    assert.equal((await queries.readProductContent('owner', 'test')).label.model.value, 'M-1');
    assert.equal(await queries.saveProductContent('owner', { ...second, productId: 'missing' }, 1), null);
  } finally { sqlite.close(); }
});

function routeWith({ find = async () => product, read = async () => model.emptyProductContent('test'), save = async (_owner, content) => content, head = async () => ({ httpMetadata: { contentType: 'image/jpeg' } }), mode } = {}) {
  return load('app/api/products/[id]/content/route.ts', {
    '@/db/queries': { findProduct: find },
    '@/db/product-content': { readProductContent: read, saveProductContent: save },
    'cloudflare:workers': { env: { FILES: { head } } },
  }, mode);
}

test('content endpoint enforces product ownership, cache privacy, production closure and bounded JSON', async () => {
  let accessed = 0;
  const missing = routeWith({ find: async () => null, read: async () => { accessed++; } });
  assert.equal((await missing.GET(new Request('http://localhost'), context)).status, 404);
  assert.equal((await missing.PATCH(request(input({ seo: { title: 'x' } })), context)).status, 404);
  assert.equal(accessed, 0);
  const route = routeWith();
  const get = await route.GET(new Request('http://localhost'), context);
  assert.equal(get.status, 200); assert.equal(get.headers.get('cache-control'), 'no-store');
  assert.equal((await route.PATCH(request(input({ seo: { title: 'x' } }), {}), context)).status, 400);
  assert.equal((await route.PATCH(request(input({ seo: { title: '한'.repeat(40000) } })), context)).status, 413);
  const production = routeWith({ mode: 'production', find: async () => { throw Error('must not access storage'); } });
  assert.equal((await production.GET(new Request('http://localhost'), context)).status, 503);
  assert.equal((await production.PATCH(request(input({ seo: { title: 'x' } })), context)).status, 503);
});

test('content endpoints distinguish conflicts and storage failure while preserving honest statuses', async () => {
  let saved;
  const route = routeWith({ save: async (owner, content, revision) => { assert.equal(owner, 'owner'); assert.equal(revision, 0); saved = content; return content; } });
  const response = await route.PATCH(request(input({ seo: { title: '<script>alert(1)</script>' }, label: { manufacturer: '제조사' } })), context);
  assert.equal(response.status, 200); assert.equal(saved.seo.title.value, '<script>alert(1)</script>');
  assert.equal(saved.seo.title.provenance, 'manual'); assert.equal(saved.registration_status, undefined);
  for (const [overrides, status] of [
    [{ read: async () => ({ ...model.emptyProductContent('test'), revision: 2 }) }, 409],
    [{ save: async () => null }, 409],
    [{ save: async () => { throw Error('secret storage error'); } }, 503],
  ]) {
    const failed = await routeWith(overrides).PATCH(request(input({ seo: { title: 'x' } })), context);
    assert.equal(failed.status, status); assert.ok(!(await failed.text()).includes('secret storage error'));
  }
});

test('asset mapping verifies real object existence and image MIME before writing roles', async () => {
  let saves = 0;
  for (const head of [async () => null, async () => ({ httpMetadata: { contentType: 'image/svg+xml' } })]) {
    const route = routeWith({ head, save: async () => { saves++; } });
    assert.equal((await route.PATCH(request(input({ assets: { main: ['owner/main.jpg'] } })), context)).status, 400);
  }
  assert.equal(saves, 0);
  const route = routeWith({ head: async key => { assert.equal(key, 'owner/main.jpg'); return { httpMetadata: { contentType: 'image/jpeg' } }; } });
  const response = await route.PATCH(request(input({ assets: { main: ['owner/main.jpg'] } })), context);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).content.assets.main.value[0], 'owner/main.jpg');
});

test('image role save uses SQLite CAS when product references change during the R2 check', async () => {
  const { sqlite, queries } = sqliteDependencies();
  try {
    const route = routeWith({
      find: async () => sqlite.prepare('SELECT * FROM products WHERE id=?').get('test'),
      read: queries.readProductContent, save: queries.saveProductContent,
      head: async () => { sqlite.prepare("UPDATE products SET image_keys='[]' WHERE id='test'").run(); return { httpMetadata: { contentType: 'image/jpeg' } }; },
    });
    const response = await route.PATCH(request(input({ assets: { main: ['owner/main.jpg'] } })), context);
    assert.equal(response.status, 409);
    const saved = await queries.readProductContent('owner', 'test');
    assert.equal(saved.revision, 0); assert.equal(saved.assets.main.value.length, 0);
    assert.equal(sqlite.prepare('SELECT image_keys FROM products').get().image_keys, '[]');
  } finally { sqlite.close(); }
});

test('new label fields normalize legacy reads without writes and support validated edits', async()=>{
 const legacy=model.emptyProductContent('test');delete legacy.label.components;delete legacy.label.releaseDate;
 legacy.revision=4;legacy.updatedAt=now;legacy.label.material={value:'면',provenance:'manual',updatedAt:now};
 const before=JSON.stringify(legacy);let writes=0;
 const db={prepare(sql){return {async run(){if(!sql.startsWith('CREATE TABLE'))writes++;},bind(){return this;},async first(){return {payload:JSON.stringify(legacy),revision:4};}};}};
 const stored=load('db/product-content.ts',{'cloudflare:workers':{env:{DB:db}}});
 const loaded=await stored.readProductContent('owner','test');
 assert.equal(loaded.revision,4);assert.equal(loaded.label.components.value,'');assert.equal(loaded.label.releaseDate.provenance,'unverified');assert.equal(loaded.label.material.value,'면');assert.equal(writes,0);
 const {patch}=model.validateContentInput(input({label:{components:'본체 1개, 파우치 1개',releaseDate:'2026년 9월'}},4),[],'owner');
 const saved=model.applyContentPatch(legacy,patch,now);
 assert.equal(saved.label.components.provenance,'manual');assert.equal(saved.label.releaseDate.value,'2026년 9월');assert.equal(JSON.stringify(legacy),before);
 const cleared=model.applyContentPatch(saved,{label:{components:'',releaseDate:''}},now);
 assert.equal(cleared.label.components.provenance,'manual');assert.equal(cleared.label.releaseDate.value,'');
 for(const value of [null,123,'x'.repeat(2001)])assert.throws(()=>model.validateContentInput(input({label:{components:value}}),[],'owner'));
});


test('detail banners preserve legacy content and require owned single images', () => {
 const old=model.emptyProductContent('test');delete old.assets.detailTop;delete old.assets.detailBottom;
 old.assets.detail.value=['owner/body'];const before=JSON.stringify(old);
 const normalized=model.withCurrentLabelFields(old);
 assert.equal(JSON.stringify(old),before);assert.equal(normalized.revision,old.revision);
 assert.deepEqual(Array.from(model.contentDetailImageKeys(normalized)),['owner/body']);
 const {patch}=model.validateContentInput(input({assets:{detailTop:['owner/top'],detailBottom:['owner/bottom']}}),['owner/top','owner/bottom'],'owner');
 const next=model.applyContentPatch(old,patch,now);
 assert.deepEqual(Array.from(model.contentDetailImageKeys(next)),['owner/top','owner/body','owner/bottom']);
 assert.equal(next.assets.detailTop.provenance,'manual');
 assert.throws(()=>model.validateContentInput(input({assets:{detailTop:['owner/top','owner/bottom']}}),['owner/top','owner/bottom'],'owner'));
 assert.throws(()=>model.validateContentInput(input({assets:{detailBottom:['other/private']}}),['other/private'],'owner'));
 assert.throws(()=>model.applyContentPatch(next,{assets:{detail:['owner/top']}},now));
});
