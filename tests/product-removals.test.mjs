import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {memoryDatabase,runtimeDDL,checkDatabaseSchema} from '../scripts/check-db-schema.mjs';

const version='2026-10-01T00:00:00.000Z';
function harness(){
 const sqlite=memoryDatabase();for(const declaration of runtimeDDL())sqlite.exec(declaration.sql);
 const state={owner:'owner',verified:true,ownerError:false,beforeMutation:null,sql:[],fileCalls:[]};
 const objects=new Map([['owner/main.png',new Uint8Array([1,2,3])],['owner/detail.png',new Uint8Array([4,5,6])]]);
 const db={prepare(sql){let args=[];const q={bind(...values){args=values;return q;},execute(){state.sql.push(sql);if(/^\s*(?:INSERT INTO|DELETE FROM) product_removals/i.test(sql))state.beforeMutation?.(sql,args);return sqlite.prepare(sql).all(...args);},async first(){return q.execute()[0]??null;},async all(){return{results:q.execute()};},async run(){state.sql.push(sql);return sqlite.prepare(sql).run(...args);}};return q;},async batch(statements){sqlite.exec('BEGIN');try{const results=statements.map(q=>({results:q.execute()}));sqlite.exec('COMMIT');return results;}catch(error){sqlite.exec('ROLLBACK');throw error;}}};
 const env={DB:db,FILES:{async delete(key){state.fileCalls.push(['delete',key]);throw Error('Product removal cannot delete files.');},async put(key){state.fileCalls.push(['put',key]);throw Error('Product removal cannot rewrite files.');},async get(key){state.fileCalls.push(['get',key]);throw Error('Product removal cannot read files.');}}};
 const cache=new Map();function load(file){if(cache.has(file))return cache.get(file);const exports={};cache.set(file,exports);vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../'+file,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,URL,Date,Error,crypto,Request,Response,Headers,TextEncoder,TextDecoder,Uint8Array,DataView,process:{env:{NODE_ENV:'production'}},require(name){if(name==='cloudflare:workers')return{env};if(name==='next/server')return{NextResponse:Response};if(name==='@/app/chatgpt-auth')return{getChatGPTUser:async()=>state.verified?{verifiedAccess:true,userId:state.owner}:null,getWorkspaceOwnerId:async()=>{if(state.ownerError)throw Error('auth unavailable');return state.owner;}};assert.ok(name.startsWith('@/'),name);return load(name.slice(2)+'.ts');}},{filename:file});return exports;}
 const route=load('app/api/products/[id]/route.ts'),listing=load('app/api/products/route.ts'),queries=load('db/queries.ts'),removals=load('db/product-removals.ts');
 const request=(body,id='product')=>route.DELETE(new Request('https://app.test/api/products/'+id,{method:'DELETE',headers:{'content-type':'application/json'},body:typeof body==='string'?body:JSON.stringify(body)}),{params:Promise.resolve({id})});
 const list=removed=>listing.GET(new Request('https://app.test/api/products'+(removed?'?removed=only':'')));
 const snapshot=()=>JSON.stringify(Object.fromEntries(sqlite.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name<>'product_removals' ORDER BY name").all().map(({name})=>[name,sqlite.prepare(`SELECT * FROM "${name}" ORDER BY rowid`).all()])));
 const fileSnapshot=()=>JSON.stringify([...objects].map(([key,bytes])=>[key,[...bytes]]));
 async function seed(){
  const product={id:'product',owner_id:'owner',source_url:'https://detail.1688.com/offer/813724060928.html',title:'수집 원본 상품명',source_price_cny:1,exchange_rate:210,supply_margin:25,coupang_margin:15,supply_price:420,sale_price:990,msrp:1200,options_count:2,seo_status:'입력됨',image_status:'대기',quote_status:'완료',registration_status:'검토 대기',supplier_hub_status:'미전송',image_keys:JSON.stringify([...objects.keys()]),goal_stage:'price',created_at:version,updated_at:version};
  await queries.insertProduct(product);await queries.insertProduct({...product,id:'foreign',owner_id:'other',image_keys:'[]'});await queries.insertProduct({...product,id:'visible',image_keys:'[]'});
  sqlite.prepare('INSERT INTO product_price_policy VALUES(?,?)').run(product.id,'{ "savedPolicy":true, "margin":25 }');
  const content=load('app/product-content.ts').emptyProductContent(product.id);content.revision=1;content.updatedAt=version;content.seo.title.value='저장한 수정 상품명';content.assets.main.value=['owner/main.png'];content.assets.detail.value=['owner/detail.png'];
  const options=load('app/product-options.ts').emptyProductOptions(product.id);options.revision=1;options.updatedAt=version;
  sqlite.prepare('INSERT INTO product_content VALUES(?,?,?,?,?)').run(product.id,'owner',1,JSON.stringify(content),version);
  sqlite.prepare('INSERT INTO product_options VALUES(?,?,?,?,?)').run(product.id,'owner',1,JSON.stringify(options),version);
  sqlite.prepare('INSERT INTO product_quotation_fields VALUES(?,?,?,?,?)').run(product.id,'owner',1,'{ "manualQuotation":"preserve bytes" }',version);
  sqlite.prepare('INSERT INTO collection_jobs VALUES(?,?,?,?,?,?,?,?)').run('job','owner','813724060928',product.source_url,'price','awaiting_connector',version,version);
  sqlite.prepare('INSERT INTO collection_context VALUES(?,?)').run('job','{ "originalContext":true }');
  sqlite.prepare('INSERT INTO collection_results VALUES(?,?,?,?)').run('job','owner','{ "originalSupplierText":"原文" }',version);
  sqlite.prepare('INSERT INTO collection_source_supplements VALUES(?,?,?,?,?,?)').run('job','owner','{ "originalSupplierText":"原文" }','{"captured":"补充"}','{ "merged":"原文 + 补充" }',version);
  sqlite.prepare('INSERT INTO collection_products VALUES(?,?,?,?)').run('job','owner',product.id,version);
  sqlite.prepare('INSERT INTO collection_images VALUES(?,?,?,?,?,?,?)').run('job',0,'owner',product.id,'owner/main.png','image-operation',version);
  const fingerprint='a'.repeat(64),receipt={schemaVersion:1,evidence:'chrome-observation',profileId:'category',categoryId:'80719',fingerprint,productVersion:version,recordedAt:version,result:{state:'validation-complete',filename:`YOOFAM-${fingerprint}.xlsx`,company:{code:'A01464742',name:'와이홉'},includedOptions:2,quotationId:'saved-quotation',observedAt:1,registered:false}};
  sqlite.prepare('INSERT INTO supplier_hub_receipts VALUES(?,?,?,?,?,?)').run('owner',product.id,fingerprint,1,1,JSON.stringify(receipt));
  return product;
 }
 return{sqlite,state,env,objects,load,queries,removals,route,listing,request,list,snapshot,fileSnapshot,seed,close:()=>sqlite.close()};
}
async function json(response,status=200){assert.equal(response.status,status,await response.clone().text());return response.json();}

test('soft removal and restore preserve every product, dependent row and stored file byte',async()=>{
 const h=harness();try{
  const product=await h.seed(),before=h.snapshot(),files=h.fileSnapshot();
  for(const table of ['product_price_policy','product_content','product_options','product_quotation_fields','collection_jobs','collection_context','collection_results','collection_source_supplements','collection_products','collection_images','supplier_hub_receipts'])assert.ok(h.sqlite.prepare(`SELECT count(*) AS count FROM ${table}`).get().count>0,`${table} fixture has saved rows`);
  const defaultBefore=await json(await h.list());assert.equal(defaultBefore.products.length,2);for(const row of defaultBefore.products)assert.equal(Object.hasOwn(row,'removed_at'),false);
  const removed=await json(await h.request({expectedVersion:product.updated_at}));assert.equal(removed.productId,product.id);assert.equal(removed.removed,true);assert.equal(removed.productVersion,version);assert.ok(Number.isFinite(Date.parse(removed.removedAt)));
  assert.equal(h.snapshot(),before);assert.equal(h.fileSnapshot(),files);assert.deepEqual(h.state.fileCalls,[]);
  const active=await json(await h.list());assert.deepEqual(active.products.map(row=>row.id),['visible']);
  const trash=await json(await h.list(true));assert.equal(trash.products.length,1);assert.equal(trash.products[0].id,product.id);assert.equal(trash.products[0].removed_at,removed.removedAt);
  assert.equal(trash.products[0].updated_at,version);assert.equal(trash.products[0].content_summary.seoTitle,'저장한 수정 상품명');assert.equal(trash.products[0].content_summary.mainImageKey,'owner/main.png');assert.equal(trash.products[0].source_image_key,'owner/main.png');assert.equal(trash.products[0].hub_receipt.quotationId,'saved-quotation');
  const restored=await json(await h.request({action:'restore',expectedVersion:version,expectedRemovedAt:removed.removedAt}));assert.deepEqual(restored,{productId:product.id,restored:true});
  assert.equal(h.sqlite.prepare('SELECT count(*) AS count FROM product_removals').get().count,0);assert.equal(h.snapshot(),before);assert.equal(h.fileSnapshot(),files);assert.deepEqual(h.state.fileCalls,[]);
  const defaultAfter=await json(await h.list());assert.deepEqual(defaultAfter,defaultBefore);assert.deepEqual((await json(await h.list(true))).products,[]);
 }finally{h.close();}
});

test('stale and repeated removal returns conflicts without replacing the marker or changing data',async()=>{
 const h=harness();try{
  await h.seed();const before=h.snapshot();await json(await h.request({expectedVersion:'2026-09-30T00:00:00.000Z'}),409);assert.equal(h.sqlite.prepare('SELECT count(*) AS count FROM product_removals').get().count,0);
  const removed=await json(await h.request({expectedVersion:version})),marker=JSON.stringify(h.sqlite.prepare('SELECT * FROM product_removals').all());
  await json(await h.request({expectedVersion:version}),409);assert.equal(JSON.stringify(h.sqlite.prepare('SELECT * FROM product_removals').all()),marker);assert.equal(h.snapshot(),before);
  await json(await h.request({action:'restore',expectedVersion:version,expectedRemovedAt:removed.removedAt}));await json(await h.request({action:'restore',expectedVersion:version,expectedRemovedAt:removed.removedAt}),409);assert.equal(h.snapshot(),before);
 }finally{h.close();}
});

test('competing atomic removals and restorations each permit exactly one writer',async()=>{
 const h=harness();try{
  await h.seed();const before=h.snapshot();
  const removed=await Promise.all([h.removals.removeProduct('owner','product',version),h.removals.removeProduct('owner','product',version)]);assert.equal(removed.filter(Boolean).length,1);
  const marker=removed.find(Boolean);assert.equal(h.sqlite.prepare('SELECT count(*) AS count FROM product_removals').get().count,1);
  const restored=await Promise.all([h.removals.restoreProduct('owner','product',version,marker.removed_at),h.removals.restoreProduct('owner','product',version,marker.removed_at)]);assert.equal(restored.filter(Boolean).length,1);
  assert.equal(h.sqlite.prepare('SELECT count(*) AS count FROM product_removals').get().count,0);assert.equal(h.snapshot(),before);
 }finally{h.close();}
});

test('restore compares both current product version and the exact removed_at marker',async()=>{
 const h=harness();try{
  await h.seed();const removed=await json(await h.request({expectedVersion:version})),before=h.snapshot();
  for(const body of [{action:'restore',expectedVersion:'2026-09-30T00:00:00.000Z',expectedRemovedAt:removed.removedAt},{action:'restore',expectedVersion:version,expectedRemovedAt:'2026-09-30T00:00:00.000Z'}])await json(await h.request(body),409);
  assert.equal(h.snapshot(),before);assert.equal(h.sqlite.prepare('SELECT removed_at FROM product_removals').get().removed_at,removed.removedAt);
  await json(await h.request({action:'restore',expectedVersion:version,expectedRemovedAt:removed.removedAt}));
 }finally{h.close();}
});

test('atomic owner/version checks reject a product edit arriving immediately before marker insertion',async()=>{
 const h=harness();try{
  await h.seed();let edited;
  h.state.beforeMutation=sql=>{if(!sql.includes('INSERT'))return;h.state.beforeMutation=null;h.sqlite.prepare('UPDATE products SET title=?,updated_at=? WHERE id=?').run('다른 편집자가 저장한 상품명','2026-10-01T00:00:00.001Z','product');edited=h.snapshot();};
  await json(await h.request({expectedVersion:version}),409);assert.equal(h.snapshot(),edited);assert.equal(h.sqlite.prepare('SELECT count(*) AS count FROM product_removals').get().count,0);
  await json(await h.request({expectedVersion:'2026-10-01T00:00:00.001Z'}));assert.equal(h.snapshot(),edited);
 }finally{h.close();}
});

test('atomic restore rejects races that replace its marker or edit the current product',async()=>{
 for(const race of ['marker','product']){
  const h=harness();try{
   await h.seed();const removed=await json(await h.request({expectedVersion:version}));let changed;
   h.state.beforeMutation=sql=>{if(!sql.includes('DELETE'))return;h.state.beforeMutation=null;if(race==='marker')h.sqlite.prepare('UPDATE product_removals SET removed_at=? WHERE product_id=?').run('2026-10-02T00:00:00.000Z','product');else h.sqlite.prepare('UPDATE products SET updated_at=?,title=? WHERE id=?').run('2026-10-01T00:00:00.001Z','이후 저장한 상품명','product');changed=h.snapshot();};
   await json(await h.request({action:'restore',expectedVersion:version,expectedRemovedAt:removed.removedAt}),409);assert.equal(h.snapshot(),changed);assert.equal(h.sqlite.prepare('SELECT count(*) AS count FROM product_removals').get().count,1);
  }finally{h.close();}
 }
});

test('missing and unrelated-owner removal/restore return404 and owner-scoped lists never expose them',async()=>{
 const h=harness();try{
  await h.seed();const before=h.snapshot();
  for(const id of ['missing','foreign']){await json(await h.request({expectedVersion:version},id),404);await json(await h.request({action:'restore',expectedVersion:version,expectedRemovedAt:version},id),404);}
  const marker=await h.removals.removeProduct('other','foreign',version);assert.ok(marker);
  assert.equal((await json(await h.list(true))).products.length,0);h.state.owner='other';assert.deepEqual((await json(await h.list(true))).products.map(row=>row.id),['foreign']);
  await json(await h.request({action:'restore',expectedVersion:version,expectedRemovedAt:marker.removed_at},'product'),404);assert.equal(h.snapshot(),before);
 }finally{h.close();}
});

test('invalid or oversized deletion bodies stop before data mutation',async()=>{
 const h=harness();try{
  await h.seed();const before=h.snapshot();
  for(const body of [null,[],{}, {expectedVersion:3},{expectedVersion:'invalid'},{expectedVersion:version,action:'erase'},{expectedVersion:version,permanent:true},{expectedVersion:version,expectedRemovedAt:version},{action:'restore',expectedVersion:version},{action:'restore',expectedVersion:version,expectedRemovedAt:'invalid'},'{broken'])await json(await h.request(body),400);
  await json(await h.request({expectedVersion:version,padding:'x'.repeat(9000)}),413);assert.equal(h.snapshot(),before);assert.equal(h.sqlite.prepare('SELECT count(*) AS count FROM product_removals').get().count,0);
 }finally{h.close();}
});

test('production auth and owner-resolution failure stop before request body and database access',async()=>{
 const h=harness();try{
  h.state.verified=false;const request={get body(){throw Error('Body must not be touched before authentication.');}};const context={params:Promise.resolve({id:'product'})};
  await json(await h.route.DELETE(request,context),503);assert.equal(h.state.sql.length,0);
  h.state.verified=true;h.state.ownerError=true;await json(await h.route.DELETE(request,context),503);assert.equal(h.state.sql.length,0);
 }finally{h.close();}
});

test('new removal migration matches runtime schema and remains additive and idempotent',()=>{
 assert.ok(checkDatabaseSchema().tables>0);
 const migration=fs.readFileSync(new URL('../db/migrations/0015_product_removals.sql',import.meta.url),'utf8');assert.equal(/\b(?:DELETE|UPDATE|DROP|ALTER)\b/i.test(migration),false);
});
