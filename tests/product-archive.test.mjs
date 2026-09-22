import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { DatabaseSync } from 'node:sqlite';
import { webcrypto } from 'node:crypto';

function load(file, dependencies = {}, mode = 'development', cache = new Map()) {
  if (cache.has(file)) return cache.get(file);
  const exports = {}; cache.set(file, exports);
  const source = ts.transpileModule(fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(source, { exports, crypto: webcrypto, Date, TextEncoder, TextDecoder, Uint8Array, URL, URLSearchParams, atob, btoa, Response, process: { env: { NODE_ENV: mode } }, require(name) {
    if (name in dependencies) return dependencies[name];
    if (name === 'next/server') return { NextResponse: Response };
    if (name.startsWith('@/')) return load(name.slice(2) + '.ts', dependencies, mode, cache);
    throw Error(name);
  } });
  return exports;
}
const model = load('app/product-archive.ts');
const now = new Date('2026-09-21T16:01:00.000Z');
const query = (params = {}) => model.parseArchiveQuery(new URLSearchParams({ range: 'all', ...params }), now);
const plain = value => JSON.parse(JSON.stringify(value));

test('Korean calendar bounds handle midnight, inclusive end dates, leap days and month boundaries', () => {
  assert.equal(model.koreanDay('2026-09-21T14:59:59.999Z'), '2026-09-21');
  assert.equal(model.koreanDay('2026-09-21T15:00:00.000Z'), '2026-09-22');
  assert.deepEqual(plain(model.archiveDateBounds('today', null, null, now)), { from: '2026-09-22', to: '2026-09-22', startUtc: '2026-09-21T15:00:00.000Z', endUtc: '2026-09-22T15:00:00.000Z' });
  assert.equal(model.archiveDateBounds('7days', null, null, now).from, '2026-09-16');
  assert.equal(model.archiveDateBounds('month', null, null, now).startUtc, '2026-08-31T15:00:00.000Z');
  assert.equal(model.archiveDateBounds('custom', '2024-02-29', '2024-03-01', now).endUtc, '2024-03-01T15:00:00.000Z');
  for (const [from, to] of [['2026-02-29', '2026-03-01'], ['2026-09-30', '2026-09-01'], ['2026-13-01', '2026-13-02'], ['', '2026-09-22']]) assert.throws(() => model.archiveDateBounds('custom', from, to, now));
});

test('cursor rejects malformed or changed filters and query validation does not accept arbitrary SQL/date/limit controls', async () => {
  const params = await query({ q: '한글 URL' }); const item = { id: 'p', sourceKind: 'product', createdAt: '2026-09-21T15:00:00.000Z' };
  const cursor = await model.nextArchiveCursor(item, params);
  assert.equal((await query({ q: '한글 URL', cursor })).cursor.id, 'p');
  await assert.rejects(query({ q: '다른 검색어', cursor }));
  await assert.rejects(query({ q: '한글 URL', limit: '100', cursor }));
  for (const params of [{ cursor: 'malformed' }, { range: 'sql' }, { limit: '0' }, { limit: '101' }, { limit: '1.2' }, { q: 'a'.repeat(2049) }, { q: 'bad\u0000query' }, { ownerId: 'foreign' }]) await assert.rejects(query(params));
  await assert.rejects(model.parseArchiveQuery(new URLSearchParams('range=all&range=today'), now));
  assert.equal(model.safeArchiveUrl('javascript:alert(1)'), null);
  assert.equal(model.safeArchiveUrl('https://detail.1688.com.evil.test/offer/123.html'), null);
  assert.equal(model.archiveOfferId('https://detail.1688.com/offer/1073686239310.html?sku=123'), '1073686239310');
});

function database() {
  const sqlite = new DatabaseSync(':memory:'); sqlite.exec('PRAGMA foreign_keys=ON');
  const binding = { prepare(sql) { let parameters = []; const stmt = {
    bind(...values) { parameters = values; return stmt; },
    async all() { return { results: sqlite.prepare(sql).all(...parameters) }; },
    async first() { return sqlite.prepare(sql).get(...parameters) ?? null; },
    async run() { return sqlite.prepare(sql).run(...parameters); },
    execute() { sqlite.prepare(sql).run(...parameters); return { results: [] }; },
  }; return stmt; }, async batch(statements) { return statements.map(statement => statement.execute()); } };
  const dependencies = { 'cloudflare:workers': { env: { DB: binding } } };
  return { sqlite, dependencies, db: load('db/product-archive.ts', dependencies) };
}
function insertProduct(sqlite, id, owner, createdAt, title = `상품 ${id}`, sourceUrl = `https://detail.1688.com/offer/${100000 + Number(id.replace(/\D/g, '') || 0)}.html`) {
  sqlite.prepare(`INSERT INTO products(id,owner_id,source_url,title,source_price_cny,exchange_rate,supply_margin,coupang_margin,supply_price,sale_price,msrp,created_at,updated_at,registration_status)
    VALUES(?,?,?,?,1,200,0,0,200,200,200,?,?,'수동 입력')`).run(id, owner, sourceUrl, title, createdAt, createdAt);
}
function insertRequest(sqlite, id, owner, createdAt, status = 'awaiting_connector', url = `https://detail.1688.com/offer/${500000 + Number(id.replace(/\D/g, '') || 0)}.html`) {
  sqlite.prepare(`INSERT INTO collection_jobs(id,owner_id,offer_id,source_url,goal,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)`)
    .run(id, owner, model.archiveOfferId(url), url, 'collect', status, createdAt, createdAt);
}

test('real SQLite pages through >200 mixed historical rows without duplicates/missing ties or other-owner exposure', async () => {
  const { sqlite, db } = database();
  try {
    await db.listProductArchive('owner', await query());
    const expected = [];
    for (let i = 0; i < 275; i++) {
      const id = `item-${String(i).padStart(4, '0')}`; const timestamp = `2026-09-${String(1 + (i % 20)).padStart(2, '0')}T00:00:00.000Z`;
      insertProduct(sqlite, id, 'owner', timestamp); insertRequest(sqlite, id, 'owner', timestamp, i % 2 ? 'cancelled' : 'awaiting_connector');
      expected.push(`product:${id}`, `request:${id}`);
    }
    insertProduct(sqlite, 'foreign-product', 'other', '2026-09-22T00:00:00.000Z');
    insertRequest(sqlite, 'foreign-request', 'other', '2026-09-22T00:00:00.000Z');
    const found = []; let cursor = null; let pages = 0;
    do {
      const page = await db.listProductArchive('owner', await query({ limit: '37', ...(cursor ? { cursor } : {}) })); pages++;
      assert.ok(page.items.length <= 37); assert.ok(page.items.every(item => item.id.startsWith('item-')));
      found.push(...page.items.map(item => `${item.sourceKind}:${item.id}`)); cursor = page.nextCursor;
      assert.ok(pages < 20);
    } while (cursor);
    assert.equal(found.length, 550); assert.equal(new Set(found).size, 550); assert.deepEqual(found.sort(), expected.sort());
    // A cursor from another owner remains merely a sort position, never an owner selector.
    const foreignPage = await db.listProductArchive('other', await query());
    const foreignCursor = await model.nextArchiveCursor(foreignPage.items[0], await query());
    const ownerPage = await db.listProductArchive('owner', await query({ cursor: foreignCursor }));
    assert.ok(ownerPage.items.every(item => !item.id.startsWith('foreign')));
    const indexes = sqlite.prepare("SELECT name FROM sqlite_schema WHERE type='index'").all().map(row => row.name);
    assert.ok(indexes.includes('idx_products_owner_created_id')); assert.ok(indexes.includes('idx_collection_owner_created_id'));
  } finally { sqlite.close(); }
});

test('real SQLite applies Korea-day boundaries and literal title/full URL/offer search to each union branch', async () => {
  const { sqlite, db } = database();
  try {
    await db.listProductArchive('owner', await query());
    insertProduct(sqlite, 'before', 'owner', '2026-09-21T14:59:59.999Z');
    insertProduct(sqlite, 'start', 'owner', '2026-09-21T15:00:00.000Z', '가방 100%_원본');
    insertRequest(sqlite, 'middle', 'owner', '2026-09-22T14:59:59.999Z', 'cancelled', 'https://detail.1688.com/offer/1073686239310.html');
    insertRequest(sqlite, 'end', 'owner', '2026-09-22T15:00:00.000Z');
    const page = await db.listProductArchive('owner', await query({ range: 'today' }));
    assert.deepEqual(plain(page.items.map(item => item.id)), ['middle', 'start']);
    assert.equal(page.items[0].sourceKind, 'request'); assert.equal(model.archiveStatusLabel(page.items[0]), '요청 취소');
    assert.equal((await db.listProductArchive('owner', await query({ q: '100%_' }))).items[0].id, 'start');
    assert.equal((await db.listProductArchive('owner', await query({ q: '1073686239310' }))).items[0].id, 'middle');
    assert.equal((await db.listProductArchive('owner', await query({ q: 'https://detail.1688.com/offer/1073686239310.html' }))).items[0].id, 'middle');
    assert.equal((await db.listProductArchive('owner', await query({ q: "' OR 1=1 --" }))).items.length, 0);
  } finally { sqlite.close(); }
});

test('category context stays owner scoped, labels product matches as references and tolerates corrupt context JSON', async () => {
  const { sqlite, db } = database();
  try {
    await db.listProductArchive('owner', await query());
    const source = 'https://detail.1688.com/offer/1073686239310.html';
    insertProduct(sqlite, 'product', 'owner', '2026-09-20T00:00:00.000Z', '가방', source + '?sku=9#details');
    insertRequest(sqlite, 'own-request', 'owner', '2026-09-19T00:00:00.000Z', 'awaiting_connector', source);
    insertRequest(sqlite, 'foreign-request', 'other', '2026-09-21T00:00:00.000Z', 'awaiting_connector', source);
    sqlite.prepare('INSERT INTO collection_context(job_id,payload) VALUES(?,?)').run('own-request', JSON.stringify({ category: { categoryId: '80719', categoryPath: ['주방용품', '바스켓'] }, settings: { secretNeverReturn: 'hidden' } }));
    sqlite.prepare('INSERT INTO collection_context(job_id,payload) VALUES(?,?)').run('foreign-request', JSON.stringify({ category: { categoryId: 'foreign', categoryPath: ['foreign'] } }));
    const page = await db.listProductArchive('owner', await query());
    assert.equal(page.items[0].category.id, '80719'); assert.equal(page.items[0].category.source, 'matching-request');
    assert.equal(page.items[1].category.source, 'request-snapshot'); assert.ok(!JSON.stringify(page).includes('hidden'));
    sqlite.prepare('UPDATE collection_context SET payload=? WHERE job_id=?').run('{bad-json', 'own-request');
    assert.ok((await db.listProductArchive('owner', await query())).items.every(item => item.category === null));
  } finally { sqlite.close(); }
});

test('archive API preserves production auth gate, parameter errors and no-store contract', async () => {
  let called = 0;
  const dependencies = { '@/app/chatgpt-auth': { getChatGPTUser: async () => null, getWorkspaceOwnerId: async () => 'owner' },
    '@/db/product-archive': { listProductArchive: async owner => { called++; assert.equal(owner, 'owner'); return { items: [] }; } } };
  const closed = load('app/api/product-archive/route.ts', dependencies, 'production');
  assert.equal((await closed.GET(new Request('https://app.local/api/product-archive?range=all'))).status, 503); assert.equal(called, 0);
  const local = load('app/api/product-archive/route.ts', dependencies);
  assert.equal((await local.GET(new Request('https://app.local/api/product-archive?range=invalid'))).status, 400); assert.equal(called, 0);
  const response = await local.GET(new Request('https://app.local/api/product-archive?range=all'));
  assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'no-store'); assert.equal(called, 1);
});

test('long multilingual/escaped searches produce bounded digest cursors and still bind exact filters',async()=>{
  const item={id:'p',sourceKind:'product',createdAt:'2026-09-21T15:00:00.000Z'};
  for(const text of ['가'.repeat(2048),'\\'.repeat(2048),'🙂'.repeat(1024)]){
    const base=await query({q:text});const cursor=await model.nextArchiveCursor(item,base);
    assert.ok(cursor.length<500);assert.equal((await query({q:text,cursor})).cursor.id,'p');
    await assert.rejects(query({q:text.slice(0,-1)+'x',cursor}));
    const decoded=JSON.parse(Buffer.from(cursor,'base64url').toString('utf8'));assert.match(decoded.filter,/^[a-f0-9]{64}$/);assert.ok(!decoded.filter.includes(text.slice(0,10)));
  }
});
