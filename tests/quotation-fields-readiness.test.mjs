import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {DatabaseSync} from 'node:sqlite';

const normalize=sql=>sql.replace(/\s+/g,' ').trim();
const expectedDDL=[`CREATE TABLE IF NOT EXISTS product_quotation_fields ( product_id TEXT PRIMARY KEY REFERENCES products(id), owner_id TEXT NOT NULL, revision INTEGER NOT NULL CHECK(revision > 0), payload TEXT NOT NULL, updated_at TEXT NOT NULL )`,
 `CREATE TABLE IF NOT EXISTS collection_jobs (id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, offer_id TEXT NOT NULL, source_url TEXT NOT NULL, goal TEXT NOT NULL CHECK(goal IN ('collect','price','work','transmit')), status TEXT NOT NULL CHECK(status IN ('awaiting_connector','cancelled')), created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`,
 `CREATE TABLE IF NOT EXISTS collection_products (job_id TEXT PRIMARY KEY REFERENCES collection_jobs(id), owner_id TEXT NOT NULL, product_id TEXT NOT NULL UNIQUE REFERENCES products(id), created_at TEXT NOT NULL)`,
 `CREATE TABLE IF NOT EXISTS collection_context (job_id TEXT PRIMARY KEY REFERENCES collection_jobs(id), payload TEXT NOT NULL)`].map(normalize);
const source=fs.readFileSync(new URL('../db/quotation-fields.ts',import.meta.url),'utf8'),output=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
function load(env){const exports={};vm.runInNewContext(output,{exports,Error,Date,require:name=>{
 if(name==='cloudflare:workers')return {env};if(name==='@/app/image-pool-limit')return {PRODUCT_IMAGE_POOL_LIMIT:150};if(name==='@/app/quotation-scopes')return {quotationScope:id=>id};if(name==='@/app/quotation-schema')return {emptyQuotationOverrides:()=>({common:{},options:{}})};if(name==='@/db/collection-jobs')return {collectionSchema:expectedDDL[1],collectionProductSchema:expectedDDL[2]};throw Error('Unexpected dependency '+name);
}},{filename:'db/quotation-fields.ts'});return exports;}
function mockDatabase(onBatch=async()=>[]){const batches=[],reads=[];const db={prepare(sql){const statement={sql:normalize(sql),bind(...args){statement.args=args;return statement;},async first(){reads.push({sql:statement.sql,args:statement.args});return null;}};return statement;},async batch(statements){batches.push(Array.from(statements,item=>item.sql));return onBatch(batches.length);}};return{db,batches,reads};}
const read=(store)=>store.readQuotationFields('owner','product');
const guard={productVersion:'version',imageKeys:'[]',pricingPolicy:null,contentRevision:0,optionRevision:0,settingsPayload:null,profile:null,collection:null};

test('quotation schema setup retains exactly the four additive statements and sequential source reads execute fresh SELECTs',async()=>{
 const f=mockDatabase(),store=load({DB:f.db});for(let index=0;index<5;index++)await read(store);for(let index=0;index<7;index++)await store.quotationSourcesCurrent('owner','product',guard);for(let index=0;index<3;index++)await store.readQuotationCollectionSource('owner','offer','product');
 assert.deepEqual(f.batches,[expectedDDL]);assert.equal(f.reads.length,15);assert.equal(f.reads.filter(row=>row.sql.startsWith('SELECT payload,revision')).length,5);assert.equal(f.reads.filter(row=>row.sql.startsWith('SELECT p.id')).length,7);assert.equal(f.reads.filter(row=>row.sql.startsWith('SELECT job_id')).length,3);assert.ok(f.reads.every(row=>row.args.includes('owner')&&row.args.includes('product')));
});

test('failed DDL is never remembered and the same binding retries before source reads',async()=>{
 const failure=Error('synthetic D1 failure'),f=mockDatabase(async attempt=>{if(attempt===1)throw failure;return[];}),store=load({DB:f.db});await assert.rejects(read(store),error=>error===failure);assert.equal(f.reads.length,0);await read(store);await read(store);assert.deepEqual(f.batches,[expectedDDL,expectedDDL]);assert.equal(f.reads.length,2);
});

test('completed readiness is isolated by exact binding and module lifetime, with no pending request promise shared',async()=>{
 const a=mockDatabase(),b=mockDatabase(),env={DB:a.db},store=load(env);await read(store);env.DB=b.db;await read(store);env.DB=a.db;await read(store);assert.equal(a.batches.length,1);assert.equal(b.batches.length,1);await read(load(env));assert.equal(a.batches.length,2);
 const pending=[],c=mockDatabase(()=>new Promise((resolve,reject)=>pending.push({resolve,reject}))),other=load({DB:c.db}),first=read(other),second=read(other);assert.equal(pending.length,2);assert.equal(c.reads.length,0);pending[0].resolve([]);await first;
 const failure=Error('independent request failed'),rejected=assert.rejects(second,error=>error===failure);pending[1].reject(failure);await rejected;await read(other);assert.equal(pending.length,2);assert.equal(c.reads.length,2);assert.equal(c.batches.length,2);
});

test('an absent binding does not poison readiness and a binding switch during DDL cannot redirect the current SELECT',async()=>{
 const env={},store=load(env);await assert.rejects(read(store),/D1 unavailable/);let release;const a=mockDatabase(()=>new Promise(resolve=>{release=resolve;})),b=mockDatabase();env.DB=a.db;const pending=read(store);env.DB=b.db;release([]);await pending;assert.equal(a.reads.length,1);assert.equal(b.reads.length,0);await read(store);assert.equal(b.batches.length,1);assert.equal(b.reads.length,1);
});

function sqliteFixture(){
 const sqlite=new DatabaseSync(':memory:');sqlite.exec(`CREATE TABLE products(id TEXT PRIMARY KEY,owner_id TEXT,updated_at TEXT,image_keys TEXT);CREATE TABLE product_removals(product_id TEXT,owner_id TEXT);CREATE TABLE product_price_policy(product_id TEXT,payload TEXT);CREATE TABLE product_content(product_id TEXT,owner_id TEXT,revision INTEGER);CREATE TABLE product_options(product_id TEXT,owner_id TEXT,revision INTEGER);CREATE TABLE workspace_settings(owner_id TEXT,payload TEXT);CREATE TABLE category_profiles(id TEXT,owner_id TEXT,revision INTEGER);CREATE TABLE members(id TEXT,email TEXT,role TEXT,status TEXT,company_code TEXT,company_name TEXT);INSERT INTO products VALUES('product','owner','version','[]');INSERT INTO product_content VALUES('product','owner',1);INSERT INTO product_options VALUES('product','owner',1);INSERT INTO workspace_settings VALUES('owner','settings');INSERT INTO category_profiles VALUES('profile','owner',1);INSERT INTO members VALUES('owner','member@example.test','member','approved','A01526306','유앤채');`);
 const batches=[],reads=[];const db={prepare(sql){let args=[];return{sql,bind(...values){args=values;return this;},async first(){reads.push({sql,args});return sqlite.prepare(sql).get(...args)??null;}};},async batch(statements){batches.push(Array.from(statements,item=>normalize(item.sql)));for(const statement of statements)sqlite.exec(statement.sql);return[];}};
 return{sqlite,db,batches,reads,store:load({DB:db})};
}

test('completed schema readiness never caches quotation rows, ownership, company, settings or source-clock fences',async()=>{
 const f=sqliteFixture();try{
  await read(f.store);f.sqlite.exec(`INSERT INTO collection_jobs VALUES('job','owner','offer','https://detail.1688.com/offer/1.html','work','awaiting_connector','version','version');INSERT INTO collection_products VALUES('job','owner','product','version');INSERT INTO collection_context VALUES('job','context');`);
  const source={...guard,contentRevision:1,optionRevision:1,settingsPayload:'settings',profile:{id:'profile',revision:1},member:{email:'member@example.test',role:'member',companyCode:'A01526306',companyName:'유앤채'},collection:{offerId:'offer',snapshot:{id:'job',payload:'context',updatedAt:'version',linked:true}}};
  assert.equal(await f.store.quotationSourcesCurrent('owner','product',source),true);
  const mutations=[`UPDATE products SET updated_at='changed'`,`UPDATE products SET owner_id='other'`,`UPDATE workspace_settings SET payload='changed'`,`UPDATE product_content SET revision=2`,`UPDATE product_options SET revision=2`,`UPDATE category_profiles SET revision=2`,`UPDATE members SET status='suspended'`,`UPDATE members SET company_code='A01464742',company_name='와이홉'`,`UPDATE collection_context SET payload='changed'`,`UPDATE collection_jobs SET status='cancelled'`,`DELETE FROM collection_products`,`INSERT INTO product_removals VALUES('product','owner')`];
  for(const sql of mutations){f.sqlite.exec('SAVEPOINT drift');f.sqlite.exec(sql);assert.equal(await f.store.quotationSourcesCurrent('owner','product',source),false,sql);f.sqlite.exec('ROLLBACK TO drift');f.sqlite.exec('RELEASE drift');assert.equal(await f.store.quotationSourcesCurrent('owner','product',source),true);}
  for(const revision of [1,2]){const state={schemaVersion:1,productId:'product',revision,overrides:{common:{},options:{}},updatedAt:'version'};f.sqlite.prepare('INSERT OR REPLACE INTO product_quotation_fields VALUES(?,?,?,?,?)').run('product','owner',revision,JSON.stringify(state),'version');assert.equal((await read(f.store)).revision,revision);}
  assert.equal((await f.store.readQuotationCollectionSource('owner','offer','product')).payload,'context');f.sqlite.exec(`UPDATE collection_context SET payload='changed'`);assert.equal((await f.store.readQuotationCollectionSource('owner','offer','product')).payload,'changed');assert.equal(f.batches.length,1);
 }finally{f.sqlite.close();}
});

test('external schema deletion fails closed in the current SELECT instead of returning remembered data',async()=>{
 const f=sqliteFixture();try{await read(f.store);f.sqlite.exec('DROP TABLE product_quotation_fields');await assert.rejects(read(f.store),/no such table/);assert.equal(f.batches.length,1);assert.equal(f.reads.length,2);}finally{f.sqlite.close();}
});
