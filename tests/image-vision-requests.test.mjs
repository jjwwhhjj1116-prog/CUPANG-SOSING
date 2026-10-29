import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {DatabaseSync} from 'node:sqlite';
const scope={owner:'owner',productId:'product',requestId:'request-1',company:{code:'company',name:'name'},member:{email:'fixture@example.test',role:'admin'},model:'vision',fingerprint:'a'.repeat(64),sourceScope:'b'.repeat(64),productVersion:'2026-10-29T00:00:00.000Z',contentRevision:2};
function fixture(){
 const sqlite=new DatabaseSync(':memory:');sqlite.exec("CREATE TABLE products(id TEXT PRIMARY KEY,owner_id TEXT,updated_at TEXT);CREATE TABLE product_content(product_id TEXT,owner_id TEXT,revision INTEGER);CREATE TABLE members(id TEXT,email TEXT,role TEXT,status TEXT,company_code TEXT,company_name TEXT)");
 sqlite.prepare('INSERT INTO products VALUES(?,?,?)').run(scope.productId,scope.owner,scope.productVersion);sqlite.prepare('INSERT INTO product_content VALUES(?,?,?)').run(scope.productId,scope.owner,2);sqlite.prepare('INSERT INTO members VALUES(?,?,?,?,?,?)').run(scope.owner,scope.member.email,'admin','approved',scope.company.code,scope.company.name);
 const db={prepare(sql){let args=[];const query={bind(...values){args=values;return query;},async first(){return sqlite.prepare(sql).get(...args)??null;},async run(){return sqlite.prepare(sql).run(...args);},sql};return query;},async batch(rows){for(const row of rows)sqlite.exec(row.sql);return[];}};
 const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../db/image-vision-requests.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,Date,TextEncoder,Error,require:name=>{assert.equal(name,'cloudflare:workers');return{env:{DB:db}};}});
 return{...exports,sqlite,close(){sqlite.close();}};
}
test('atomic Vision claim fences overlapping requests, uncertain survives and completed UUID replays bounded proposal only',async()=>{
 const h=fixture();try{
  assert.equal((await h.claimImageVisionRequest(scope)).claimed,true);
  assert.equal((await h.claimImageVisionRequest(scope)).record.status,'running');
  assert.equal((await h.claimImageVisionRequest({...scope,requestId:'request-2'})).record,null);
  await h.finishImageVisionRequest(scope,{status:'uncertain',failure:'TIMEOUT',requests:1});
  assert.equal((await h.claimImageVisionRequest({...scope,requestId:'request-2'})).record,null);
  assert.equal(h.sqlite.prepare('SELECT count(*) AS n FROM image_vision_requests').get().n,1);
 }finally{h.close();}
 const a=fixture();try{
  await a.claimImageVisionRequest(scope);await a.finishImageVisionRequest(scope,{status:'completed',result:{safe:'proposal'},requests:1});
  const repeat=await a.claimImageVisionRequest(scope);assert.equal(repeat.claimed,false);assert.equal(repeat.record.status,'completed');assert.equal(repeat.record.result,'{"safe":"proposal"}');
  assert.equal((await a.claimImageVisionRequest({...scope,requestId:'explicit-next-request'})).claimed,true);
 }finally{a.close();}
});
test('member/company/email/role/source version/content CAS stop claim and completion, existing product remains unchanged',async()=>{
 for(const patch of [{owner:'other'},{company:{code:'other',name:'name'}},{member:{email:'other@example.test',role:'admin'}},{member:{email:scope.member.email,role:'member'}},{productVersion:'old'},{contentRevision:3}]){
  const h=fixture();try{const before=JSON.stringify(h.sqlite.prepare('SELECT * FROM products').all());assert.equal((await h.claimImageVisionRequest({...scope,...patch})).claimed,false);assert.equal(h.sqlite.prepare('SELECT count(*) AS n FROM image_vision_requests').get().n,0);assert.equal(JSON.stringify(h.sqlite.prepare('SELECT * FROM products').all()),before);}finally{h.close();}
 }
 const h=fixture();try{await h.claimImageVisionRequest(scope);h.sqlite.exec("UPDATE members SET status='suspended'");await assert.rejects(h.finishImageVisionRequest(scope,{status:'failed',failure:'PROVIDER',requests:1}));assert.equal(h.sqlite.prepare('SELECT status FROM image_vision_requests').get().status,'running');}finally{h.close();}
});
test('migration and runtime ledger schema/index are equivalent and contain no image payload or product update',async()=>{
 const source=fs.readFileSync(new URL('../db/image-vision-requests.ts',import.meta.url),'utf8'),migration=fs.readFileSync(new URL('../db/migrations/0032_image_vision_requests.sql',import.meta.url),'utf8');
 assert.ok(!/UPDATE products|UPDATE product_content|DELETE FROM|source_key|image_bytes|password|credential/i.test(source));
 const a=fixture(),b=new DatabaseSync(':memory:');try{await a.claimImageVisionRequest(scope);b.exec(migration);const columns=db=>db.prepare('PRAGMA table_info(image_vision_requests)').all().map(row=>({name:row.name,type:row.type,notnull:row.notnull,pk:row.pk}));assert.deepEqual(columns(a.sqlite),columns(b));assert.equal(b.prepare("SELECT count(*) AS n FROM sqlite_master WHERE name='image_vision_requests_active'").get().n,1);}finally{a.close();b.close();}
});
test('completed cache lookup binds owner/product/company/model/source scope and membership exactly',async()=>{
 const h=fixture();try{
  await h.claimImageVisionRequest(scope);await h.finishImageVisionRequest(scope,{status:'completed',result:{safe:'proposal'},requests:1});
  const next={...scope,requestId:'request-2'};await h.claimImageVisionRequest(next);
  assert.equal((await h.completedImageVisionResult(next)).request_id,scope.requestId);
  await h.finishImageVisionRequest(next,{status:'completed',result:{safe:'proposal'},requests:0});assert.deepEqual(h.sqlite.prepare('SELECT provider_requests FROM image_vision_requests ORDER BY request_id').all().map(row=>row.provider_requests),[1,0]);
  for(const patch of [{owner:'another'},{productId:'another'},{company:{code:'another',name:'name'}},{company:{code:'company',name:'another'}},{model:'other-model'},{sourceScope:'c'.repeat(64)},{member:{email:'other@example.test',role:'admin'}}])assert.equal(await h.completedImageVisionResult({...next,...patch}),null);
  h.sqlite.exec("UPDATE members SET status='suspended'");assert.equal(await h.completedImageVisionResult(next),null);
 }finally{h.close();}
});
