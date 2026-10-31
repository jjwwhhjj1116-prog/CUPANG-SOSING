import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {DatabaseSync} from 'node:sqlite';
const plain=value=>JSON.parse(JSON.stringify(value));
function fixture(){
 const sqlite=new DatabaseSync(':memory:'),queries=[],cache=new Map();sqlite.exec(`CREATE TABLE products(id TEXT PRIMARY KEY,owner_id TEXT,updated_at TEXT,image_keys TEXT);
 CREATE TABLE product_content(product_id TEXT,owner_id TEXT,revision INTEGER);CREATE TABLE members(id TEXT,email TEXT,role TEXT,status TEXT,company_code TEXT,company_name TEXT);`);
 const scope={owner:'owner',productId:'fresh',requestId:'12345678-1234-4123-8123-123456789abc',company:{code:'A01526306',name:'유앤채'},member:{email:'fixture@example.test',role:'admin'},model:'@cf/qwen/qwen3.8-27b',fingerprint:'a'.repeat(64),sourceScope:'b'.repeat(64),productVersion:'2026-10-30T00:00:00.000Z',contentRevision:1};
 const product={id:'fresh',owner_id:'owner',updated_at:scope.productVersion,image_keys:'["owner/photo.png"]'};
 sqlite.prepare('INSERT INTO products VALUES(?,?,?,?)').run(product.id,product.owner_id,product.updated_at,product.image_keys);sqlite.prepare('INSERT INTO product_content VALUES(?,?,?)').run('fresh','owner',1);sqlite.prepare('INSERT INTO members VALUES(?,?,?,?,?,?)').run('owner',scope.member.email,'admin','approved',scope.company.code,scope.company.name);
 const db={prepare(sql){queries.push(sql);let args=[];const q={sql,bind(...values){args=values;return q;},async first(){return sqlite.prepare(sql).get(...args)??null;},async all(){return{results:sqlite.prepare(sql).all(...args)};},async run(){return sqlite.prepare(sql).run(...args);}};return q;},async batch(items){for(const item of items)sqlite.exec(item.sql);return[];}};
 const env={DB:db,SOURCEFLOW_IMAGE_TEXT_PROVIDER:'workers-ai-vision',SOURCEFLOW_IMAGE_TEXT_MODEL:scope.model,SOURCEFLOW_IMAGE_TEXT_PAID_ALLOWED:'true',AI:{run(){throw Error('Projection must never infer');}},FILES:{get(){throw Error('Projection must never read pixels');},put(){throw Error('No image writes');}}};
 function load(file){if(cache.has(file))return cache.get(file);const exports={};cache.set(file,exports);vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../'+file,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,Date,Error,TextEncoder,Uint8Array,DataView,structuredClone,setTimeout,clearTimeout,require(name){if(name==='cloudflare:workers')return{env};if(name==='@/app/automation/image-edit')return{inspectImage:()=>({width:100,height:80,mime:'image/png'})};if(name==='@/app/image-files')return{isOwnedImageKey:(owner,key)=>typeof key==='string'&&key.startsWith(owner+'/'),MAX_IMAGE_BYTES:10*1024*1024};assert.ok(name.startsWith('@/'),name);return load(name.slice(2)+'.ts');}},{filename:file});return exports;}
 const contract=load('app/image-text-vision.ts'),vision=load('app/automation/workers-image-vision.ts'),ledger=load('db/image-vision-requests.ts'),receipts=load('db/image-no-text-receipts.ts'),status=load('app/registration-stage-status.ts'),content=load('app/product-content.ts').emptyProductContent('fresh');content.revision=1;content.updatedAt=product.updated_at;content.assets.main.value=['owner/photo.png'];content.assets.additional.value=['owner/photo.png'];content.assets.detail.value=['owner/photo.png'];
 const configuration=vision.imageVisionConfiguration(env);scope.inspection={sourceKey:'owner/photo.png',sourceSha256:'c'.repeat(64),width:100,height:80,sourceLanguage:'zh',configuration};
 const result=vision.parseImageVisionResponse({response:{decision:'no-foreign-text',blocks:[]}},100,80);
 const row={optionId:'one',title:'상품',main:['owner/photo.png'],additional:['owner/photo.png'],detail:['owner/photo.png'],label:[],imageIssues:{}};
 return{sqlite,queries,scope,product,env,contract,vision,ledger,receipts,status,content,row,result,configuration,load,async finish(value=result){await ledger.claimImageVisionRequest(scope);await ledger.finishImageVisionRequest(scope,{status:'completed',result:value,requests:1});},read:()=>receipts.readImageNoTextReceipts('owner',[product]),close:()=>sqlite.close()};
}
test('explicit provider no-foreign decision is required; legacy empty, unreadable and contradictory decisions never qualify',async()=>{
 const h=fixture();try{
  for(const value of [{blocks:[]},{decision:'unreadable',blocks:[]},{blocks:[{original:'中文',translated:'중국어',box:{x:1,y:1,width:20,height:10}}]}]){
   const result=h.vision.parseImageVisionResponse({response:value},100,80);assert.equal(h.contract.isVerifiedNoForeignText(result),false);
  }
  for(const value of [{decision:'foreign-text',blocks:[]},{decision:'no-foreign-text',blocks:[{original:'中文',translated:'중국어',box:{x:1,y:1,width:20,height:10}}]},{decision:'guessed',blocks:[]}])assert.throws(()=>h.vision.parseImageVisionResponse({response:value},100,80),/BLOCKS/);
  assert.equal(h.contract.isVerifiedNoForeignText(h.result),true);
 }finally{h.close();}
});
test('actual completed ledger produces a SHA/policy receipt and current final slots complete without provider, pixel or product writes',async()=>{
 const h=fixture();try{const before=JSON.stringify(h.sqlite.prepare('SELECT * FROM products').all());await h.finish();h.queries.length=0;const proof=(await h.read()).fresh;
  assert.equal(proof.length,1);assert.equal(proof[0].sourceSha256,'c'.repeat(64));assert.equal(proof[0].policy,'foreign-text-inspection-v1');assert.ok(h.queries.every(sql=>/^SELECT /u.test(sql)));
  const stages=h.status.registrationStagesFromSavedContent(h.product,h.content,null,['owner/photo.png'],[h.row],proof);
  for(const id of ['mainImage','additionalImages','detailImage'])assert.equal(stages[id].state,'complete',id);assert.equal(stages.koreanLabel.state,'pending');
  assert.equal(JSON.stringify(h.sqlite.prepare('SELECT * FROM products').all()),before);
  h.sqlite.prepare('UPDATE products SET updated_at=?').run('2026-10-31T00:00:00.000Z');h.product.updated_at='2026-10-31T00:00:00.000Z';assert.equal((await h.read()).fresh.length,1,'unrelated version changes do not require inference again');
 }finally{h.close();}
});
test('no current originals, missing/changed/extra final slots, different product/owner/policy/config or active/failed records stay pending',async()=>{
 const h=fixture();try{await h.finish();const original=(await h.read()).fresh,read=(row=h.row,keys=['owner/photo.png'],proof=original,product=h.product)=>h.status.registrationStagesFromSavedContent(product,h.content,null,keys,row===null?null:[row],proof).mainImage.state;
  assert.equal(read({...h.row,main:[]}), 'pending');assert.equal(read({...h.row,main:['owner/new.png']},['owner/photo.png','owner/new.png']),'pending');assert.equal(read({...h.row,main:['owner/photo.png','owner/new.png']},['owner/photo.png','owner/new.png']),'pending');assert.equal(read(null),'pending');assert.equal(read(h.row,[]),'pending');assert.equal(read(h.row,undefined,[{...original[0],productId:'other'}]),'pending');assert.equal(read(h.row,undefined,[{...original[0],policy:'old-policy'}]),'pending');
  const snapshot=plain(h.sqlite.prepare('SELECT * FROM image_vision_requests').get());
  for(const status of ['running','uncertain','failed']){h.sqlite.prepare('UPDATE image_vision_requests SET status=?').run(status);assert.equal(Object.keys(await h.read()).length,0);}
  h.sqlite.prepare('UPDATE image_vision_requests SET status=?').run(snapshot.status);
  for(const sql of ["UPDATE members SET status='suspended'","UPDATE members SET company_code='OTHER'","UPDATE members SET email='other@example.test'","UPDATE members SET role='member'"]){h.sqlite.exec(sql);assert.equal(Object.keys(await h.read()).length,0);h.sqlite.prepare('UPDATE members SET status=?,company_code=?,email=?,role=?').run('approved',h.scope.company.code,h.scope.member.email,'admin');}
  h.env.SOURCEFLOW_IMAGE_TEXT_MODEL='other-model';assert.equal(Object.keys(await h.read()).length,0);h.env.SOURCEFLOW_IMAGE_TEXT_MODEL=h.scope.model;
  h.env.SOURCEFLOW_IMAGE_TEXT_PAID_ALLOWED='false';assert.equal(Object.keys(await h.read()).length,0);h.env.SOURCEFLOW_IMAGE_TEXT_PAID_ALLOWED='true';
  assert.equal(Object.keys(await h.receipts.readImageNoTextReceipts('another',[h.product])).length,0);
  h.sqlite.prepare('UPDATE products SET image_keys=?').run('[]');assert.equal(Object.keys(await h.read()).length,0);
 }finally{h.close();}
});
test('legacy empty output creates no receipt; read-only missing tables are never initialized; migration equals runtime schema',async()=>{
 const h=fixture();try{await h.finish(h.vision.parseImageVisionResponse({response:{blocks:[]}},100,80));assert.equal(h.sqlite.prepare("SELECT count(*) AS n FROM sqlite_master WHERE name='image_no_text_receipts'").get().n,0);h.queries.length=0;assert.equal(Object.keys(await h.read()).length,0);assert.ok(h.queries.every(sql=>/^SELECT /u.test(sql)));
  h.sqlite.exec(h.receipts.imageNoTextReceiptsSchema);const db=new DatabaseSync(':memory:');try{db.exec(fs.readFileSync(new URL('../db/migrations/0038_image_no_text_receipts.sql',import.meta.url),'utf8'));const columns=db=>db.prepare('PRAGMA table_info(image_no_text_receipts)').all().map(row=>[row.name,row.type,row.notnull,row.pk]);assert.deepEqual(columns(h.sqlite),columns(db));}finally{db.close();}
 }finally{h.close();}
});
test('actual listing resolves an older matching image failure only after every current source proof, while running and newer failures stay authoritative',async()=>{
 const {mobileIntakeHarness}=await import('./helpers/mobile-intake.mjs'),h=mobileIntakeHarness({companyCode:'A01526306',companyName:'유앤채'});
 try{await h.intake();const collected=h.sqlite.prepare('SELECT * FROM products').get(),draft=await h.route(`/api/products/${collected.id}/work-draft`,{method:'POST',body:{expectedVersion:collected.updated_at,roles:['main','additional','detail']}});assert.equal(draft.status,200,await draft.clone().text());
  const product=h.sqlite.prepare('SELECT * FROM products').get(),keys=JSON.parse(product.image_keys),content=await h.load('db/product-content.ts').readProductContent('owner',product.id);
  const selected=JSON.parse(h.sqlite.prepare('SELECT payload FROM product_options WHERE product_id=?').get(product.id).payload);for(const row of selected.rows)row.included=true;h.sqlite.prepare('UPDATE product_options SET payload=? WHERE product_id=?').run(JSON.stringify(selected),product.id);
  h.sqlite.prepare('INSERT INTO members(id,email,password_hash,role,status,company_code,company_name,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)').run('owner','jwhj1116@kakao.com','fixture','admin','approved','A01526306','유앤채',product.updated_at,product.updated_at);
  const ran=await h.route(`/api/products/${product.id}/automation`,{method:'POST',body:{action:'run',stages:['pricing'],expectedVersion:product.updated_at,idempotencyKey:'no-text-listing'}});assert.equal(ran.status,200,await ran.clone().text());
  const workflow=(await ran.json()).workflow,stage=workflow.stages.find(stage=>stage.id==='mainImage');Object.assign(stage,{status:'failed',attempts:1,updatedAt:'2026-01-01T00:00:00.000Z',reason:{message:'기존 이미지 작업 실패'},artifacts:[],evidence:[]});
  const put=()=>h.sqlite.prepare('UPDATE product_automation SET payload=? WHERE product_id=?').run(JSON.stringify(workflow),product.id),read=async()=>h.load('db/product-content.ts').readRegistrationSummaries('owner',[await h.load('db/queries.ts').findProduct('owner',product.id)]);put();
  assert.equal((await read())[product.id].stages.mainImage.state,'failed');
  Object.assign(h.bindings,{SOURCEFLOW_IMAGE_TEXT_PROVIDER:'workers-ai-vision',SOURCEFLOW_IMAGE_TEXT_MODEL:'@cf/qwen/qwen3.8-27b',SOURCEFLOW_IMAGE_TEXT_PAID_ALLOWED:'true'});
  const config=h.load('app/automation/workers-image-vision.ts').imageVisionConfiguration(h.bindings),ledger=h.load('db/image-vision-requests.ts'),result=h.load('app/automation/workers-image-vision.ts').parseImageVisionResponse({response:{decision:'no-foreign-text',blocks:[]}},1,1),before=JSON.stringify(h.sqlite.prepare('SELECT * FROM products').all());
  for(const [index,key]of keys.entries()){
   const scope={owner:'owner',productId:product.id,requestId:`12345678-1234-4123-8123-${String(index+1).padStart(12,'0')}`,company:{code:'A01526306',name:'유앤채'},member:{email:'jwhj1116@kakao.com',role:'admin'},model:config.model,fingerprint:String(index%10).repeat(64),sourceScope:String(index%10).repeat(64),productVersion:product.updated_at,contentRevision:content.revision,inspection:{sourceKey:key,sourceSha256:'c'.repeat(64),width:1,height:1,sourceLanguage:'zh',configuration:config}};
   assert.equal((await ledger.claimImageVisionRequest(scope)).claimed,true);await ledger.finishImageVisionRequest(scope,{status:'completed',result,requests:1});
  }
  const receipts=(await h.load('db/image-no-text-receipts.ts').readImageNoTextReceipts('owner',[product]))[product.id];assert.equal(receipts?.length,keys.length);
  let summary=(await read())[product.id];assert.equal(summary.stages.mainImage.state,'complete',JSON.stringify(summary.stages.mainImage));assert.ok(summary.stages.mainImage.sourceProofAt);assert.equal(JSON.stringify(h.sqlite.prepare('SELECT * FROM products').all()),before);
  stage.status='running';put();assert.equal((await read())[product.id].stages.mainImage.state,'running','a live running attempt is never hidden by no-op receipts');
  stage.status='failed';stage.updatedAt='2099-01-01T00:00:00.000Z';put();assert.equal((await read())[product.id].stages.mainImage.state,'failed','a newer failure remains authoritative');
  stage.updatedAt='2026-01-01T00:00:00.000Z';put();h.sqlite.prepare('DELETE FROM image_no_text_receipts WHERE source_key=?').run(selected.rows.find(row=>row.included).imageKey??content.assets.main.value[0]);summary=(await read())[product.id];assert.equal(summary.stages.mainImage.state,'failed','one missing current main-image proof cannot erase failure');
 }finally{h.close();}
});
