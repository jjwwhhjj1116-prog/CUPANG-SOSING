import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

function load(env){
 const modules=new Map();
 const require=name=>{
  if(name==='cloudflare:workers')return {env};
  assert.ok(name.startsWith('@/'),`Unexpected module: ${name}`);
  if(modules.has(name))return modules.get(name);
  const exports={};modules.set(name,exports);
  const filename=name.slice(2)+'.ts',source=fs.readFileSync(new URL('../'+filename,import.meta.url),'utf8');
  vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,require},{filename});
  return exports;
 };
 return require('@/db/collection-jobs');
}
function database(onBatch=async()=>[]){
 const batches=[],reads=[];
 let row={id:'job',status:'awaiting_connector',context_json:JSON.stringify({company:{code:'A01526306',name:'유앤채'}})};
 const db={prepare(sql){
  let args=[];
  const statement={sql:sql.replace(/\s+/gu,' ').trim(),bind(...values){args=values;return statement;},async first(){reads.push({sql:statement.sql,args});return structuredClone(row);}};
  return statement;
 },async batch(statements){batches.push(Array.from(statements,item=>item.sql));return onBatch(batches.length);}};
 return {db,batches,reads,setRow(value){row=value;}};
}

test('completed collection schema setup runs its nine DDL statements once per binding and keeps job/context reads fresh',async()=>{
 const h=database(),store=load({DB:h.db});
 assert.equal(await store.ensureCollectionDatabase(),h.db);
 const first=await store.findCollectionJob('owner','job');assert.equal(first.status,'awaiting_connector');
 h.setRow({id:'job',status:'cancelled',context_json:JSON.stringify({company:{code:'A01464742',name:'와이홉'}})});
 const second=await store.findCollectionJob('owner','job');assert.equal(second.status,'cancelled');assert.equal(second.context.company.code,'A01464742');
 assert.equal(h.batches.length,1);assert.equal(h.batches[0].length,9);
 assert.ok(h.batches[0].every(sql=>/^(?:CREATE (?:TABLE|INDEX) IF NOT EXISTS|DROP INDEX IF EXISTS)/u.test(sql)));
 assert.equal(h.reads.length,2);assert.ok(h.reads.every(read=>read.sql.includes('WHERE owner_id=? AND id=?')&&read.args[0]==='owner'&&read.args[1]==='job'));
});

test('failed collection schema setup is not cached and the next successful attempt is remembered',async()=>{
 const failure=Error('D1 unavailable'),h=database(async attempt=>{if(attempt===1)throw failure;return [];}),store=load({DB:h.db});
 await assert.rejects(store.ensureCollectionDatabase(),error=>error===failure);
 await store.ensureCollectionDatabase();await store.ensureCollectionDatabase();assert.equal(h.batches.length,2);
});

test('collection schema readiness is isolated by binding and by module isolate',async()=>{
 const first=database(),second=database(),env={DB:first.db},store=load(env);
 await store.ensureCollectionDatabase();env.DB=second.db;await store.ensureCollectionDatabase();await store.ensureCollectionDatabase();
 env.DB=first.db;await store.ensureCollectionDatabase();assert.equal(first.batches.length,1);assert.equal(second.batches.length,1);
 await load(env).ensureCollectionDatabase();assert.equal(first.batches.length,2);
});

test('concurrent setup keeps request-local pending I/O and an in-flight failure cannot forget another successful setup',async()=>{
 const pending=[],h=database(()=>new Promise((resolve,reject)=>pending.push({resolve,reject}))),store=load({DB:h.db});
 const first=store.ensureCollectionDatabase(),second=store.ensureCollectionDatabase();assert.equal(pending.length,2);
 const failure=Error('request two failed'),rejected=assert.rejects(second,error=>error===failure);
 pending[0].resolve([]);await first;pending[1].reject(failure);await rejected;
 const third=store.ensureCollectionDatabase();pending[2]?.resolve([]);await third;assert.equal(pending.length,2);
});

test('missing D1 binding fails without suppressing a later valid initialization',async()=>{
 const env={},store=load(env);await assert.rejects(store.ensureCollectionDatabase(),/D1 unavailable/u);
 const h=database();env.DB=h.db;await store.ensureCollectionDatabase();await store.ensureCollectionDatabase();assert.equal(h.batches.length,1);
});
