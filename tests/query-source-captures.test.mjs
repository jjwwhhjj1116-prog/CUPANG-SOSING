import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {webcrypto,createHash} from 'node:crypto';
import {memoryDatabase,runtimeDDL,ddlFromSource,sqlTokens} from '../scripts/check-db-schema.mjs';

const companies=[{code:'A01526306',name:'유앤채'},{code:'A01464742',name:'와이홉'}];
const id=index=>'79000000-0000-4000-8000-'+String(index).padStart(12,'0');
const plain=value=>JSON.parse(JSON.stringify(value));
const source=(index=1)=>({schemaVersion:1,sourceUrl:'https://detail.1688.com/offer/790000000001.html',offerId:'790000000001',provider:'1688-openapi-candidate-v1',collectedAt:new Date(Date.now()-600000+index).toISOString(),
 title:'합성 겨울 모자 '+index,description:'전체 원문 설명 '+index,attributes:[{name:'材质',value:'棉'}],options:[{sku:'sku-black',name:'黑色',unitPriceCny:3,minimumOrder:null,stock:0,imageIndex:1,color:'黑色',size:'均码'},
 {sku:'sku-blue',name:'蓝色',unitPriceCny:5,minimumOrder:2,stock:null,imageIndex:0,color:'蓝色',size:'均码'}],
 images:[{url:'https://cbu01.alicdn.com/synthetic-main.jpg',role:'main'},{url:'https://cbu01.alicdn.com/synthetic-sku.jpg',role:'additional'},{url:'https://cbu01.alicdn.com/synthetic-detail.jpg',role:'detail'}],
 priceBasis:{schemaVersion:1,source:'1688-openapi-consignment-v1',rule:'couplus-all-skus-uniform-first-row-v1',selection:'mixed-sku',firstBasePriceCny:2.8,skuPrices:[{sku:'sku-black',source:'consign-price',unitPriceCny:3},{sku:'sku-blue',source:'fenxiao-offer-price',unitPriceCny:5}]},
 sourceGallery:{format:'1688-openapi-gallery-v1',imageIndices:[0]}});

/** Pure app modules and actual in-memory SQLite only. No fixtures from sellers,
 * network client, operational D1 or browser connection exists in this test. */
function harness(){
 const sqlite=memoryDatabase(),cache=new Map();for(const statement of runtimeDDL())sqlite.exec(statement.sql);
 const DB={prepare(sql){let args=[];const query={bind(...values){args=values;return query;},async all(){return{results:sqlite.prepare(sql).all(...args)};},async first(){return sqlite.prepare(sql).get(...args)??null;},async run(){return sqlite.prepare(sql).run(...args);}};return query;}};
 function load(file){if(cache.has(file))return cache.get(file);const exports={};cache.set(file,exports);
  const output=ts.transpileModule(fs.readFileSync(new URL('../'+file,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  vm.runInNewContext(output,{exports,Error,URL,Date,TextEncoder,Uint8Array,crypto:webcrypto,fetch(){assert.fail('server-query storage must not perform network requests');},require(name){
   if(name==='cloudflare:workers')return{env:{DB}};
   assert.ok(name.startsWith('@/app/'),name);return load(name.slice(2)+'.ts');
  }},{filename:file});return exports;
 }
 const model=load('app/query-source-capture.ts'),store=load('db/query-source-captures.ts');
 const save=async(index,value=source(index),owner='owner',company=companies[0])=>store.storeQuerySourceCapture(owner,company,id(index),await model.querySourceFingerprint(value),value);
 return {sqlite,model,store,save,close(){sqlite.close();}};
}

for(const company of companies)test(`${company.code}: complete server evidence is immutable and list responses contain bounded summaries`,async()=>{
 const h=harness();try{
  const input=source(),before=plain(input),saved=await h.save(1,input,'owner',company);assert.equal(saved.duplicate,false);assert.equal(saved.item.captureVersion,1);assert.deepEqual(plain(saved.item.snapshot),plain(h.model.normalizeQuerySource(input)));assert.deepEqual(input,before);
  const normalized=saved.item.snapshot;assert.equal(normalized.options[0].minimumOrder,null);assert.equal(normalized.options[0].stock,0);assert.equal(normalized.options[1].stock,null);assert.equal(normalized.options[0].imageIndex,1);assert.equal(normalized.options[0].color,'黑色');assert.equal(normalized.options[0].size,'均码');assert.deepEqual(plain(normalized.priceBasis),input.priceBasis);assert.deepEqual(plain(normalized.sourceGallery),input.sourceGallery);assert.equal(normalized.provider,input.provider);
  const raw=h.sqlite.prepare('SELECT * FROM query_source_captures').get();assert.equal(raw.payload,JSON.stringify(normalized));assert.equal(raw.fingerprint,createHash('sha256').update(raw.payload).digest('hex'));
  const summary=await h.store.listQuerySourceCaptures('owner',company);assert.equal(summary.length,1);assert.equal(Object.hasOwn(summary[0],'snapshot'),false);assert.equal(summary[0].optionCount,2);assert.equal(summary[0].thumbnailUrl,input.images[0].url);assert.equal(summary[0].sourceUrl,input.sourceUrl);assert.deepEqual(plain(summary[0]),plain(h.model.querySourceCaptureSummary(saved.item)));
  const read=await h.store.readQuerySourceCapture('owner',id(1),company);assert.deepEqual(plain(read),plain(saved.item));assert.equal(await h.store.readQuerySourceCapture('foreign-owner',id(1),company),null);assert.equal(await h.store.readQuerySourceCapture('owner',id(1),companies.find(item=>item.code!==company.code)),null);assert.equal((await h.store.listQuerySourceCaptures('owner',companies.find(item=>item.code!==company.code))).length,0);
 }finally{h.close();}
});

test('same canonical source retries deduplicate while explicit recapture creates a new pinned immutable version',async()=>{
 const h=harness();try{
  const first=source(),saved=await h.save(1,first),raw=h.sqlite.prepare('SELECT * FROM query_source_captures').get();
  const reordered=Object.fromEntries(Object.entries(first).reverse());assert.equal(await h.model.querySourceFingerprint(first),await h.model.querySourceFingerprint(reordered));
  const retry=await h.save(1,reordered),duplicate=await h.save(2,reordered);assert.equal(retry.duplicate,true);assert.equal(duplicate.duplicate,true);assert.equal(duplicate.item.id,id(1));assert.equal(await h.store.readQuerySourceCapture('owner',id(2)),null);
  const changed={...first,collectedAt:new Date(Date.parse(first.collectedAt)+1).toISOString()},recapture=await h.save(3,changed);assert.equal(recapture.duplicate,false);assert.equal(recapture.item.captureVersion,2);assert.equal(recapture.item.revision,1);assert.equal(recapture.item.id,id(3));assert.deepEqual(h.sqlite.prepare('SELECT * FROM query_source_captures WHERE id=?').get(id(1)),raw);
  await assert.rejects(h.save(1,changed),h.store.QuerySourceCaptureConflict);await assert.rejects(h.save(4,first,'owner',companies[1]),h.store.QuerySourceCaptureConflict);assert.equal(h.sqlite.prepare('SELECT count(*) AS n FROM query_source_captures').get().n,2);
  assert.equal((await h.save(5,first,'different-owner',companies[1])).item.captureVersion,1);assert.deepEqual(plain((await h.store.readQuerySourceCapture('owner',id(1))).snapshot),plain(saved.item.snapshot));
 }finally{h.close();}
});

test('unknown SKU row identity, null MOQ, zero stock and empty source images remain exact without PageSource conversion',async()=>{
 const h=harness();try{
  const input={...source(),provider:'chrome-current-page-v1',options:[{sku:'',name:'黑色',unitPriceCny:2.99,minimumOrder:null,stock:0,color:'黑色',size:'均码'}],images:[],pageOptionIdentity:{format:'yoofam-page-option-identity-v1',offerId:'790000000001',sourceKeys:['color-black']}};delete input.priceBasis;delete input.sourceGallery;
  const item=(await h.save(1,input)).item;assert.deepEqual(plain(item.snapshot),plain(h.model.normalizeQuerySource(input)));assert.equal(item.snapshot.options[0].sku,'');assert.equal(item.snapshot.options[0].minimumOrder,null);assert.equal(item.snapshot.options[0].stock,0);assert.deepEqual(plain(item.snapshot.images),[]);assert.deepEqual(plain(item.snapshot.pageOptionIdentity),input.pageOptionIdentity);assert.equal((await h.store.listQuerySourceCaptures('owner',companies[0]))[0].thumbnailUrl,null);
 }finally{h.close();}
});

test('an observed zero-SKU offer default stays separate from source-key identity and from real supplier SKUs',async()=>{
 const h=harness();try{
  const input={...source(),options:[{sku:'',name:'합성 겨울 모자 1',unitPriceCny:3,minimumOrder:2,stock:0,imageIndex:0}],offerDefault:{format:'1688-openapi-offer-default-v1',offerId:'790000000001',sourceSkuCount:0,priceSource:'product-sale-first-row',unitPriceCny:3,minimumOrder:2,stock:0}};delete input.priceBasis;
  const item=(await h.save(1,input)).item;assert.deepEqual(plain(item.snapshot.offerDefault),input.offerDefault);assert.equal(item.snapshot.options[0].sku,'');assert.equal(Object.hasOwn(item.snapshot,'pageOptionIdentity'),false);
  await assert.rejects(h.save(2,{...input,options:[{...input.options[0],sku:'invented'}]}));assert.equal(h.sqlite.prepare('SELECT count(*) n FROM query_source_captures').get().n,1);
 }finally{h.close();}
});

test('validation rejects bad fingerprints, source mismatches, accessors and oversized envelopes before allocating a capture',async()=>{
 const h=harness();try{
  await assert.rejects(h.store.storeQuerySourceCapture('owner',companies[0],id(1),'0'.repeat(64),source()),h.store.QuerySourceCaptureConflict);
  for(const input of [{...source(),offerId:'790000000099'},{...source(),cookie:'not-allowed'},{...source(),options:[{...source().options[0],stock:-1}]}])await assert.rejects(h.save(1,input));
  let reads=0;const accessor={...source()};Object.defineProperty(accessor,'title',{enumerable:true,get(){reads++;return 'do not read';}});assert.throws(()=>h.model.normalizeQuerySource(accessor));assert.equal(reads,0);
  const oversized={...source(),attributes:Array.from({length:50},(_,index)=>({name:'속성'+index,value:'가'.repeat(1000)})),description:'가'.repeat(20000),options:Array.from({length:200},(_,index)=>({sku:'synthetic-'+index,name:'가'.repeat(500),unitPriceCny:1,minimumOrder:null,stock:null,color:'가'.repeat(200),size:'가'.repeat(200)}))};delete oversized.priceBasis;
  await assert.rejects(h.save(1,oversized),/512KiB/);assert.equal(h.sqlite.prepare('SELECT count(*) n FROM query_source_captures').get().n,0);
 }finally{h.close();}
});

test('archive compare-and-swap changes only visibility/revision and cannot alter an immutable source or another company',async()=>{
 const h=harness();try{
  const item=(await h.save(1)).item,raw=h.sqlite.prepare('SELECT payload FROM query_source_captures').get().payload;
  assert.equal(await h.store.archiveQuerySourceCapture('foreign-owner',id(1),1),null);assert.equal(await h.store.archiveQuerySourceCapture('owner',id(1),1,companies[1]),null);assert.equal(await h.store.archiveQuerySourceCapture('owner',id(1),2,companies[0]),null);
  const archived=await h.store.archiveQuerySourceCapture('owner',id(1),1,companies[0]);assert.equal(archived.revision,2);assert.ok(archived.archivedAt);assert.equal(h.sqlite.prepare('SELECT payload FROM query_source_captures').get().payload,raw);assert.equal((await h.store.listQuerySourceCaptures('owner',companies[0])).length,0);assert.equal(await h.store.archiveQuerySourceCapture('owner',id(1),1,companies[0]),null);assert.equal(await h.store.archiveQuerySourceCapture('owner',id(1),2,companies[0]),null);
  const retry=await h.save(2,item.snapshot);assert.equal(retry.duplicate,true);assert.equal(retry.item.id,id(1));assert.equal(retry.item.revision,2);assert.ok(retry.item.archivedAt,'a retry cannot silently restore a hidden capture');assert.equal(h.sqlite.prepare('SELECT count(*) n FROM query_source_captures').get().n,1);
 }finally{h.close();}
});

test('archived summaries and restore CAS recover capacity without changing evidence and invalidate prior selection revisions',async()=>{
 const h=harness();try{
  const input=source(),item=(await h.save(1,input)).item,raw=h.sqlite.prepare('SELECT payload,fingerprint FROM query_source_captures').get();
  assert.equal((await h.store.listQuerySourceCaptures('owner',companies[0],{archived:true})).length,0);
  const archived=await h.store.archiveQuerySourceCapture('owner',id(1),1,companies[0]);const hidden=await h.store.listQuerySourceCaptures('owner',companies[0],{archived:true});assert.equal(hidden.length,1);assert.equal(hidden[0].id,item.id);assert.equal(hidden[0].revision,2);assert.equal(Object.hasOwn(hidden[0],'snapshot'),false);
  assert.equal((await h.store.listQuerySourceCaptures('other-owner',companies[0],{archived:true})).length,0);assert.equal((await h.store.listQuerySourceCaptures('owner',companies[1],{archived:true})).length,0);
  assert.equal(await h.store.restoreQuerySourceCapture('other-owner',id(1),archived.revision,companies[0]),null);assert.equal(await h.store.restoreQuerySourceCapture('owner',id(1),archived.revision,companies[1]),null);assert.equal(await h.store.restoreQuerySourceCapture('owner',id(1),1,companies[0]),null);
  const restored=await h.store.restoreQuerySourceCapture('owner',id(1),2,companies[0]);assert.equal(restored.archivedAt,null);assert.equal(restored.revision,3);assert.notEqual(restored.revision,item.revision);assert.notEqual(restored.revision,archived.revision);assert.deepEqual(h.sqlite.prepare('SELECT payload,fingerprint FROM query_source_captures').get(),raw);
  assert.equal((await h.store.listQuerySourceCaptures('owner',companies[0],{archived:true})).length,0);assert.equal((await h.store.listQuerySourceCaptures('owner',companies[0])).length,1);assert.equal(await h.store.restoreQuerySourceCapture('owner',id(1),3,companies[0]),null);assert.equal(await h.store.archiveQuerySourceCapture('owner',id(1),2,companies[0]),null);
  await assert.rejects(h.store.restoreQuerySourceCapture('owner',id(1),0,companies[0]),h.store.QuerySourceCaptureConflict);
 }finally{h.close();}
});

test('full active capacity rejects restore atomically; archiving another row permits the exact retained version',async()=>{
 const h=harness();try{
  const first=(await h.save(1)).item;await h.store.archiveQuerySourceCapture('owner',id(1),first.revision,companies[0]);
  for(let index=2;index<=41;index++)assert.ok(await h.save(index));const before=h.sqlite.prepare('SELECT * FROM query_source_captures WHERE id=?').get(id(1));
  assert.equal(await h.store.restoreQuerySourceCapture('owner',id(1),2,companies[0]),null);assert.deepEqual(h.sqlite.prepare('SELECT * FROM query_source_captures WHERE id=?').get(id(1)),before);assert.equal((await h.store.listQuerySourceCaptures('owner',companies[0])).length,40);
  await h.store.archiveQuerySourceCapture('owner',id(2),1,companies[0]);const restored=await h.store.restoreQuerySourceCapture('owner',id(1),2,companies[0]);assert.equal(restored.revision,3);assert.equal(restored.archivedAt,null);assert.equal((await h.store.listQuerySourceCaptures('owner',companies[0])).length,40);assert.equal(h.sqlite.prepare('SELECT count(*) n FROM query_source_captures').get().n,41);
 }finally{h.close();}
});

test('active 40 and retained 200 bounds preserve every previous source and permit another owner independently',async()=>{
 const h=harness();try{
  for(let index=1;index<=40;index++)assert.ok(await h.save(index));assert.equal((await h.store.listQuerySourceCaptures('owner',companies[0])).length,40);assert.equal(await h.save(41),null);
  for(let index=1;index<=40;index++)await h.store.archiveQuerySourceCapture('owner',id(index),1,companies[0]);
  for(let index=41;index<=200;index++){assert.ok(await h.save(index));await h.store.archiveQuerySourceCapture('owner',id(index),1,companies[0]);}
  assert.equal(await h.save(201),null);assert.equal(h.sqlite.prepare('SELECT count(*) n FROM query_source_captures').get().n,200);assert.equal((await h.store.listQuerySourceCaptures('owner',companies[0])).length,0);assert.equal((await h.store.listQuerySourceCaptures('owner',companies[0],{archived:true})).length,200);assert.ok(await h.save(201,source(201),'another-owner',companies[1]));
 }finally{h.close();}
});

test('the migration agrees with runtime DDL and leaves protected operational rows byte-identical',async()=>{
 const h=harness();try{
  const migration=fs.readFileSync(new URL('../db/migrations/0030_query_source_captures.sql',import.meta.url),'utf8'),runtime=ddlFromSource(fs.readFileSync(new URL('../db/query-source-captures.ts',import.meta.url),'utf8'))[0];
  assert.deepEqual(sqlTokens(migration).filter(token=>token!==';'),sqlTokens(runtime.sql));
  // Dedicated sentinels in the real protection tables verify that this store
  // never issues a mutation against the earlier data path.
  const stamp='2026-10-22T00:00:00.000Z';h.sqlite.prepare('INSERT INTO collection_jobs VALUES(?,?,?,?,?,?,?,?)').run('protected-job','owner','790000000099','https://detail.1688.com/offer/790000000099.html','collect','awaiting_connector',stamp,stamp);
  h.sqlite.prepare(`INSERT INTO products(id,owner_id,source_url,title,source_price_cny,exchange_rate,supply_margin,coupang_margin,supply_price,sale_price,msrp,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`).run('protected-product','owner','https://detail.1688.com/offer/790000000099.html','수동 작업 중 상품',9.9,350,50,40,6930,11550,15015,stamp,stamp);
  h.sqlite.prepare('INSERT INTO product_content VALUES(?,?,?,?,?)').run('protected-product','owner',7,'{"manualTitle":"keep","images":["keep"]}',stamp);
  h.sqlite.prepare('INSERT INTO collection_results VALUES(?,?,?,?)').run('protected-job','owner','{"immutableReceipt":"keep"}',stamp);
  h.sqlite.prepare('INSERT INTO source_inbox(owner_id,id,company_code,company_name,offer_id,fingerprint,payload,review_payload,revision,received_at) VALUES(?,?,?,?,?,?,?,?,?,?)').run('owner','protected-source',companies[0].code,companies[0].name,'790000000099','f'.repeat(64),'{"original":"keep"}','{"manual":"keep"}',7,stamp);
  const tables=['products','product_content','collection_jobs','collection_results','source_inbox','source_inbox_captures'],before=Object.fromEntries(tables.map(table=>[table,JSON.stringify(h.sqlite.prepare('SELECT * FROM '+table).all())]));
  const saved=await h.save(1);await h.save(2,saved.item.snapshot);await h.store.archiveQuerySourceCapture('owner',id(1),1,companies[0]);await h.store.listQuerySourceCaptures('owner',companies[0]);
  for(const table of tables)assert.equal(JSON.stringify(h.sqlite.prepare('SELECT * FROM '+table).all()),before[table],table+' must remain untouched');
 }finally{h.close();}
});
