import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {DatabaseSync} from 'node:sqlite';
const scope={owner:'owner',productId:'product',requestId:'request-1',company:{code:'company',name:'name'},member:{email:'fixture@example.test',role:'admin'},model:'vision',fingerprint:'a'.repeat(64),sourceScope:'b'.repeat(64),productVersion:'2026-10-29T00:00:00.000Z',contentRevision:2};
function fixture(){
 const sqlite=new DatabaseSync(':memory:');sqlite.exec("CREATE TABLE products(id TEXT PRIMARY KEY,owner_id TEXT,updated_at TEXT,image_keys TEXT);CREATE TABLE product_content(product_id TEXT,owner_id TEXT,revision INTEGER);CREATE TABLE members(id TEXT,email TEXT,role TEXT,status TEXT,company_code TEXT,company_name TEXT)");
 sqlite.prepare('INSERT INTO products VALUES(?,?,?,?)').run(scope.productId,scope.owner,scope.productVersion,'[]');sqlite.prepare('INSERT INTO product_content VALUES(?,?,?)').run(scope.productId,scope.owner,2);sqlite.prepare('INSERT INTO members VALUES(?,?,?,?,?,?)').run(scope.owner,scope.member.email,'admin','approved',scope.company.code,scope.company.name);
 const queries=[];const db={prepare(sql){queries.push(sql);let args=[];const query={bind(...values){args=values;return query;},async first(){return sqlite.prepare(sql).get(...args)??null;},async run(){return sqlite.prepare(sql).run(...args);},async all(){return {results:sqlite.prepare(sql).all(...args)};},sql};return query;},async batch(rows){for(const row of rows)sqlite.exec(row.sql);return[];}};
 const cache=new Map(),env={DB:db,SOURCEFLOW_IMAGE_TEXT_PROVIDER:'workers-ai-vision',SOURCEFLOW_IMAGE_TEXT_MODEL:'@cf/qwen/qwen3.8-27b',SOURCEFLOW_IMAGE_TEXT_PAID_ALLOWED:'true',AI:{run(){throw Error('No provider calls');}}};
 function load(file){if(cache.has(file))return cache.get(file);const exports={};cache.set(file,exports);vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../'+file,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,Date,TextEncoder,Uint8Array,DataView,Error,setTimeout,clearTimeout,require(name){if(name==='cloudflare:workers')return{env};if(name==='@/app/automation/image-edit')return{inspectImage:()=>({width:100,height:80,mime:'image/png'})};if(name==='@/app/image-files')return{isOwnedImageKey:(owner,key)=>typeof key==='string'&&key.startsWith(owner+'/'),MAX_IMAGE_BYTES:10*1024*1024};assert.ok(name.startsWith('@/'),name);return load(name.slice(2)+'.ts');}});return exports;}
 return{...load('db/image-vision-requests.ts'),sqlite,queries,load,env,close(){sqlite.close();}};
}

test('completed proposals bind text style without splitting the original unknown-source admission fence or changing old rows',async()=>{
 const h=fixture(),textStyle={format:'image-overlay-korean-style-v1',copywriting:true,guidance:'간결한 존댓말',fingerprint:'c'.repeat(64)};
 try{
  await h.claimImageVisionRequest(scope);await h.finishImageVisionRequest(scope,{status:'completed',result:{legacy:true},requests:1});
  const original=h.sqlite.prepare('SELECT * FROM image_vision_requests WHERE request_id=?').get(scope.requestId);
  h.sqlite.exec('CREATE TABLE image_vision_batches(owner_id TEXT,product_id TEXT,request_id TEXT,request_fingerprint TEXT,source_scope TEXT,company_code TEXT,company_name TEXT,model TEXT,attempt TEXT)');
  const styled={...scope,requestId:'style-1',fingerprint:'d'.repeat(64),textStyle};
  assert.equal((await h.claimImageVisionRequest(styled)).claimed,true);assert.equal(await h.completedImageVisionResult(styled),null,'custom style cannot borrow legacy default text');
  assert.equal((await h.claimImageVisionRequest({...styled,requestId:'style-2',textStyle:{...textStyle,fingerprint:'e'.repeat(64)}})).claimed,false,'style changes never bypass a running original');
  h.sqlite.prepare('INSERT INTO image_vision_batches VALUES(?,?,?,?,?,?,?,?,?)').run(scope.owner,scope.productId,styled.requestId,styled.fingerprint,styled.sourceScope,styled.company.code,styled.company.name,styled.model,JSON.stringify({textStyle}));
  await h.finishImageVisionRequest(styled,{status:'completed',result:{styled:true},requests:1});
  assert.equal((await h.completedImageVisionResult({...styled,requestId:'style-reuse'})).request_id,styled.requestId);
  assert.equal(await h.completedImageVisionResult({...styled,requestId:'other-style',textStyle:{...textStyle,fingerprint:'e'.repeat(64)}}),null);
  assert.equal((await h.completedImageVisionResult({...scope,requestId:'default-reuse'})).request_id,scope.requestId,'legacy callers cannot borrow custom-style text');
  assert.deepEqual(h.sqlite.prepare('SELECT * FROM image_vision_requests WHERE request_id=?').get(scope.requestId),original);
 }finally{h.close();}
});
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
test('a new inspection-policy source scope cannot bypass a retained legacy uncertain inference',async()=>{
 const h=fixture();try{await h.claimImageVisionRequest(scope);await h.finishImageVisionRequest(scope,{status:'uncertain',failure:'TIMEOUT',requests:1});
  const next={...scope,requestId:'new-policy',sourceScope:'c'.repeat(64),legacySourceScope:scope.sourceScope,fingerprint:'d'.repeat(64)};assert.equal((await h.claimImageVisionRequest(next)).claimed,false);assert.equal(h.sqlite.prepare('SELECT count(*) AS n FROM image_vision_requests').get().n,1);
 }finally{h.close();}
});
test('atomic three-policy claim fences every original running or uncertain scope without changing its ledger',async()=>{
 const scopes=['b','c','d'].map(value=>value.repeat(64));
 for(const original of scopes)for(const target of scopes){const h=fixture();try{
  const first={...scope,sourceScope:original};assert.equal((await h.claimImageVisionRequest(first)).claimed,true);
  await h.finishImageVisionRequest(first,{status:'uncertain',failure:'TIMEOUT',requests:1});
  const before=JSON.stringify(h.sqlite.prepare('SELECT * FROM image_vision_requests').all());
  assert.equal((await h.claimImageVisionRequest({...scope,requestId:'preservation-v2',sourceScope:target,sourceScopes:scopes})).claimed,false);
  assert.equal(JSON.stringify(h.sqlite.prepare('SELECT * FROM image_vision_requests').all()),before);
 }finally{h.close();}}
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

test('status observation is SELECT-only, never initializes a missing ledger, and binds exact original request/source/member',async()=>{
 const empty=fixture();try{await assert.rejects(empty.readImageVisionRequest(scope),/no such table/);assert.equal(empty.sqlite.prepare("SELECT count(*) AS n FROM sqlite_master WHERE name='image_vision_requests'").get().n,0);assert.ok(empty.queries.every(sql=>/^SELECT /u.test(sql)));}finally{empty.close();}
 const h=fixture();try{
  await h.claimImageVisionRequest(scope);await h.finishImageVisionRequest(scope,{status:'uncertain',failure:'TIMEOUT',requests:1});const before=JSON.stringify(h.sqlite.prepare('SELECT * FROM image_vision_requests').all());h.queries.length=0;
  assert.equal((await h.readImageVisionRequest(scope)).status,'uncertain');
  for(const patch of [{owner:'other'},{productId:'other'},{requestId:'other'},{sourceScope:'c'.repeat(64)},{fingerprint:'d'.repeat(64)},{company:{code:'company',name:'other'}},{model:'other'},{member:{email:'other@example.test',role:'admin'}}])assert.equal(await h.readImageVisionRequest({...scope,...patch}),null);
  assert.ok(h.queries.every(sql=>/^SELECT /u.test(sql)));assert.equal(JSON.stringify(h.sqlite.prepare('SELECT * FROM image_vision_requests').all()),before);
  h.sqlite.exec("UPDATE members SET status='suspended'");assert.equal(await h.readImageVisionRequest(scope),null);
 }finally{h.close();}
});

test('one late provider result closes only its original running/uncertain claim with request count one and immutable terminal result',async()=>{
 for(const from of ['running','uncertain']){
  const h=fixture();try{
   await h.claimImageVisionRequest(scope);if(from==='uncertain')await h.finishImageVisionRequest(scope,{status:'uncertain',failure:'TIMEOUT',requests:1});
   const products=JSON.stringify([h.sqlite.prepare('SELECT * FROM products').all(),h.sqlite.prepare('SELECT * FROM product_content').all()]);
   const value={status:'completed',result:{model:scope.model,requests:1,proposal:'validated by provider reader'}};
   assert.equal(await h.finishLateImageVisionRequest(scope,value),true);const saved=JSON.stringify(h.sqlite.prepare('SELECT * FROM image_vision_requests').all());
   assert.equal(h.sqlite.prepare('SELECT count(*) AS n FROM image_vision_requests').get().n,1);assert.equal(h.sqlite.prepare('SELECT provider_requests FROM image_vision_requests').get().provider_requests,1);
   assert.equal(await h.finishLateImageVisionRequest(scope,{status:'failed',failure:'JSON'}),false);assert.equal(JSON.stringify(h.sqlite.prepare('SELECT * FROM image_vision_requests').all()),saved);
   await assert.rejects(h.finishImageVisionRequest(scope,{status:'uncertain',failure:'TIMEOUT',requests:1}),/changed/);assert.equal(JSON.stringify(h.sqlite.prepare('SELECT * FROM image_vision_requests').all()),saved);
   assert.equal(JSON.stringify([h.sqlite.prepare('SELECT * FROM products').all(),h.sqlite.prepare('SELECT * FROM product_content').all()]),products);
  }finally{h.close();}
 }
});

test('late observations cannot create storage/rows, cross scope or membership, or replace a confirmed failure',async()=>{
 const absent=fixture();try{await assert.rejects(absent.finishLateImageVisionRequest(scope,{status:'failed',failure:'JSON'}),/no such table/);assert.equal(absent.sqlite.prepare("SELECT count(*) AS n FROM sqlite_master WHERE name='image_vision_requests'").get().n,0);}finally{absent.close();}
 const h=fixture();try{
  await h.claimImageVisionRequest(scope);await h.finishImageVisionRequest(scope,{status:'uncertain',failure:'TIMEOUT',requests:1});const before=JSON.stringify(h.sqlite.prepare('SELECT * FROM image_vision_requests').all());
  for(const patch of [{owner:'other'},{productId:'other'},{requestId:'other'},{sourceScope:'c'.repeat(64)},{fingerprint:'d'.repeat(64)},{model:'other'},{company:{code:'company',name:'other'}},{member:{email:'other@example.test',role:'admin'}}])assert.equal(await h.finishLateImageVisionRequest({...scope,...patch},{status:'failed',failure:'JSON'}),false);
  assert.equal(JSON.stringify(h.sqlite.prepare('SELECT * FROM image_vision_requests').all()),before);h.sqlite.exec("UPDATE members SET status='suspended'");assert.equal(await h.finishLateImageVisionRequest(scope,{status:'failed',failure:'JSON'}),false);
 }finally{h.close();}
 const terminal=fixture();try{await terminal.claimImageVisionRequest(scope);await terminal.finishImageVisionRequest(scope,{status:'failed',failure:'BLOCKS',requests:1});assert.equal(await terminal.finishLateImageVisionRequest(scope,{status:'failed',failure:'JSON'}),false);assert.equal(terminal.sqlite.prepare('SELECT failure FROM image_vision_requests').get().failure,'BLOCKS');}finally{terminal.close();}
});

test('twelve bounded policy/alias fences serialize concurrent alias claims atomically without replacing exact stored scope',async()=>{
 const h=fixture(),aliases=Array.from({length:12},(_,index)=>(index+1).toString(16).padStart(64,'0'));try{
  const claims=await Promise.all([h.claimImageVisionRequest({...scope,sourceScope:aliases[0],sourceScopes:aliases}),h.claimImageVisionRequest({...scope,requestId:'request-2',sourceScope:aliases[5],sourceScopes:aliases})]);
  assert.deepEqual(claims.map(row=>row.claimed),[true,false]);assert.equal(h.sqlite.prepare('SELECT count(*) AS n FROM image_vision_requests').get().n,1);assert.equal(h.sqlite.prepare('SELECT source_scope FROM image_vision_requests').get().source_scope,aliases[0]);
 }finally{h.close();}
});

test('every retained policy/alias running or uncertain row fences a fresh alias and keeps historical bytes unchanged',async()=>{
 const aliases=Array.from({length:12},(_,index)=>(index+1).toString(16).padStart(64,'0'));
 for(const sourceScope of aliases)for(const status of ['running','uncertain']){const h=fixture();try{
  const original={...scope,sourceScope};await h.claimImageVisionRequest(original);if(status==='uncertain')await h.finishImageVisionRequest(original,{status,failure:'TIMEOUT',requests:1});
  const before=JSON.stringify(h.sqlite.prepare('SELECT * FROM image_vision_requests').all());assert.equal((await h.claimImageVisionRequest({...scope,requestId:'next',sourceScope:aliases[11],sourceScopes:aliases})).claimed,false);assert.equal(JSON.stringify(h.sqlite.prepare('SELECT * FROM image_vision_requests').all()),before);
 }finally{h.close();}}
});

test('completed lookup accepts only bounded requested-policy aliases and retains owner/product/company/model/member guards',async()=>{
 const h=fixture(),aliases=['b','c','d','e'].map(value=>value.repeat(64));try{
  await h.claimImageVisionRequest(scope);await h.finishImageVisionRequest(scope,{status:'completed',result:{safe:'proposal'},requests:1});
  const next={...scope,requestId:'next',sourceScope:aliases[1],sourceScopes:aliases,completedSourceScopes:aliases};assert.equal((await h.completedImageVisionResult(next)).request_id,scope.requestId);
  assert.equal(await h.completedImageVisionResult({...next,completedSourceScopes:aliases.slice(1)}),null);
  for(const patch of [{owner:'other'},{productId:'other'},{company:{code:'other',name:'name'}},{company:{code:'company',name:'other'}},{model:'other'},{member:{email:'other@example.test',role:'admin'}},{member:{email:scope.member.email,role:'member'}}])assert.equal(await h.completedImageVisionResult({...next,...patch}),null);
  h.sqlite.exec("UPDATE members SET status='suspended'");assert.equal(await h.completedImageVisionResult(next),null);
 }finally{h.close();}
});

test('claim and completed alias lists reject malformed, missing current and oversized bounds',async()=>{
 const h=fixture();try{
  for(const sourceScopes of [[],['bad'],['c'.repeat(64)],Array.from({length:13},(_,i)=>i.toString(16).padStart(64,'0')).concat(scope.sourceScope)])await assert.rejects(h.claimImageVisionRequest({...scope,sourceScopes}),/Invalid Image Vision source scopes/);
  for(const completedSourceScopes of [[],['bad'],['c'.repeat(64)],[scope.sourceScope,'c'.repeat(64)],['b','c','d','e','f'].map(value=>value.repeat(64))])await assert.rejects(h.completedImageVisionResult({...scope,completedSourceScopes}),/Invalid Image Vision completed source scopes/);
 }finally{h.close();}
});


test('cached alias completion persists a new exact-key no-text or markings receipt with zero provider requests',async()=>{
 for(const decision of ['no-foreign-text','product-markings-only']){const h=fixture();try{
  const vision=h.load('app/automation/workers-image-vision.ts'),receipts=h.load('db/image-no-text-receipts.ts'),configuration=vision.imageVisionConfiguration(h.env),keys=['owner/collected-main-'+ 'a'.repeat(64)+'.png','owner/collected-detail-'+ 'a'.repeat(64)+'.png'];
  h.sqlite.prepare('UPDATE products SET image_keys=?').run(JSON.stringify(keys));
  const original={...scope,requestId:'12345678-1234-4123-8123-123456789abc',model:configuration.model,inspection:{sourceKey:keys[0],sourceSha256:'a'.repeat(64),width:100,height:80,sourceLanguage:'zh',configuration}};
  const result=vision.parseImageVisionResponse({response:{decision,blocks:decision==='no-foreign-text'?[]:[{original:'YOGA',translated:'YOGA',kind:'product-marking',box:{x:5,y:10,width:40,height:10}}]}},100,80,'product-text-preservation-v2');
  const before=JSON.stringify([h.sqlite.prepare('SELECT * FROM products').all(),h.sqlite.prepare('SELECT * FROM product_content').all()]);
  await h.claimImageVisionRequest(original);await h.finishImageVisionRequest(original,{status:'completed',result,requests:1});
  const current={...original,requestId:'12345678-1234-4123-8123-123456789abd',fingerprint:'d'.repeat(64),sourceScope:'c'.repeat(64),sourceScopes:['b'.repeat(64),'c'.repeat(64)],completedSourceScopes:['b'.repeat(64),'c'.repeat(64)],inspection:{...original.inspection,sourceKey:keys[1]}};
  assert.equal((await h.claimImageVisionRequest(current)).claimed,true);const cached=await h.completedImageVisionResult(current);assert.ok(cached);await h.finishImageVisionRequest(current,{status:'completed',result:JSON.parse(cached.result),requests:0});
  const stored=h.sqlite.prepare('SELECT source_key,source_scope,request_fingerprint,proof FROM image_no_text_receipts ORDER BY request_id').all();assert.equal(stored.length,2);assert.equal(stored[1].source_key,keys[1]);assert.equal(stored[1].source_scope,current.sourceScope);assert.equal(stored[1].request_fingerprint,current.fingerprint);assert.equal(JSON.parse(stored[1].proof).reason,decision);
  assert.deepEqual(h.sqlite.prepare('SELECT provider_requests,result FROM image_vision_requests ORDER BY request_id').all().map(row=>[row.provider_requests,JSON.parse(row.result).requests]),[[1,1],[0,1]]);
  assert.equal((await receipts.readImageNoTextReceipts(scope.owner,[{id:scope.productId,image_keys:JSON.stringify(keys)}]))[scope.productId].length,2);
  assert.equal(JSON.stringify([h.sqlite.prepare('SELECT * FROM products').all(),h.sqlite.prepare('SELECT * FROM product_content').all()]),before);
 }finally{h.close();}}
});
