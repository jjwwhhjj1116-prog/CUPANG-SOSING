import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {memoryDatabase,runtimeDDL} from '../scripts/check-db-schema.mjs';
function load(file,deps={},mode='development'){
 const exports={};const code=ts.transpileModule(fs.readFileSync(new URL(`../${file}`,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 vm.runInNewContext(code,{exports,structuredClone,crypto,URL,Date,Response,TextEncoder,TextDecoder,Uint8Array,DataView,process:{env:{NODE_ENV:mode}},require(name){if(name in deps)return deps[name];if(name==='next/server')return {NextResponse:Response};if(name.startsWith('@/'))return load(`${name.slice(2)}.ts`,deps,mode);throw Error(name);}});return exports;
}
const settings=load('app/workspace-settings.ts').defaultSettings;
const prepare=load('app/collection-product.ts').prepareCollectionProduct;
test('unsaved registration examples never become promoted product label facts',()=>{
 const {savedRegistrationSettings,validateSettings}=load('app/workspace-settings.ts');
 const blank=savedRegistrationSettings(null);
 const promoted=prepare('owner',{...job,context:{...job.context,settings:blank}},result,'p',now);
 for(const key of ['manufacturer','importer','contact'])assert.equal(promoted.content.label[key].value,'');
 assert.equal(promoted.policy.exchangeRate,settings.exchangeRate);
 assert.equal(validateSettings(blank).tradeType,'');assert.equal(validateSettings(blank).importType,'');
 assert.throws(()=>validateSettings({...blank,tradeType:'invalid'}));assert.throws(()=>validateSettings({...blank,importType:'invalid'}));
 const current={...settings,brand:'later',manufacturer:'later'};
 const resolved=load('app/collection-registration-settings.ts').collectionRegistrationSettings(current,blank);
 assert.equal(resolved.brand,'');assert.equal(resolved.manufacturer,'');
});
const now='2026-01-01T00:00:00.000Z';
const job={id:'job',offer_id:'123',source_url:'https://detail.1688.com/offer/123.html',goal:'transmit',status:'awaiting_connector',created_at:now,updated_at:now,context:{category:{id:'cat'},settings,features:'feature',keywords:'',capturedAt:now}};
const result={schemaVersion:1,offerId:'123',sourceUrl:job.source_url,provider:'fixture',collectedAt:now,title:'原文商品',description:'原文説明',images:[],options:[{sku:'a',name:'黑',unitPriceCny:3.25,minimumOrder:2,stock:null},{sku:'b',name:'白',unitPriceCny:5,minimumOrder:1,stock:0}]};

test('observed pricing survives SQLite promotion, workspace changes and category quotation resolution',async()=>{
 const capturedSettings=load('app/observed-price-preset.ts').applyObservedPricePreset({...settings,brand:'저장 브랜드'});
 const capturedJob={...job,context:{...job.context,settings:capturedSettings}};
 const receipt={...result,options:[{...result.options[0],unitPriceCny:25.6},{...result.options[1],unitPriceCny:0.1}]};
 const s=storage();
 try{
  s.sqlite.prepare('UPDATE collection_context SET payload=? WHERE job_id=?').run(JSON.stringify(capturedJob.context),job.id);
  s.sqlite.prepare('UPDATE collection_results SET payload=? WHERE job_id=?').run(JSON.stringify(receipt),job.id);
  const saved=await s.promoteCollection('owner',capturedJob,receipt);
  const product=s.sqlite.prepare('SELECT * FROM products WHERE id=?').get(saved.product_id);
  product.pricing_policy=s.sqlite.prepare('SELECT payload FROM product_price_policy WHERE product_id=?').get(saved.product_id).payload;
  const content=JSON.parse(s.sqlite.prepare('SELECT payload FROM product_content WHERE product_id=?').get(saved.product_id).payload);
  const options=JSON.parse(s.sqlite.prepare('SELECT payload FROM product_options WHERE product_id=?').get(saved.product_id).payload);
  const resolver=load('app/quotation-schema.ts').resolveQuotationFields;
  const changedSettings={...settings,exchangeRate:999,supplyMargin:5,coupangMargin:5,roundingUnit:1000,msrpMultiple:2,minimumMargin:0,minimumMarginEnabled:false};
  for(const categoryId of ['80719','81452','64497','103495']){
   const quote=resolver({categoryId,product,content,options,settings:changedSettings});
   const prices=quote.rows.filter(row=>row.optionId).map(row=>['supplyPrice','salePrice','msrp'].map(key=>row.fields[key].value));
   assert.deepEqual(JSON.parse(JSON.stringify(prices)),[['17920','29870','38830'],['3040','5070','6590']],categoryId);
  }
  const bundled={...options,rows:options.rows.map((row,index)=>({...row,unitsPerPack:index===0?2:1}))};
  const quote=resolver({categoryId:'80719',product,content,options:bundled,settings:changedSettings});
  const row=quote.rows.find(row=>row.optionId===options.rows[0].id);
  assert.deepEqual(['supplyPrice','salePrice','msrp'].map(key=>row.fields[key].value),['35840','59730','77650']);
  const manual=resolver({categoryId:'80719',product,content,options:bundled,settings:changedSettings,overrides:{common:{},options:{[row.optionId]:{supplyPrice:'',salePrice:'60000'}}}}).rows.find(item=>item.optionId===row.optionId);
  assert.equal(manual.fields.supplyPrice.value,'');assert.equal(manual.fields.salePrice.value,'60000');assert.equal(manual.fields.msrp.value,'77650');
  assert.equal(product.supplier_hub_status,'미전송');
 }finally{s.sqlite.close();}
});
test('structured collection attributes preserve facts without guessing or claiming translation',()=>{
 const receipt={...result,options:[{...result.options[0],color:'黑色',size:'S'},result.options[1]]};
 const r=prepare('owner',job,receipt,'p',now);
 assert.equal(r.options.rows[0].color,'黑色');assert.equal(r.options.rows[0].size,'S');
 assert.equal(r.options.rows[0].provenance.color,'collected');assert.equal(r.options.rows[0].provenance.size,'collected');
 assert.equal(r.options.rows[1].color,'');assert.equal(r.options.rows[1].size,'');
 assert.equal(r.options.rows[1].provenance.color,'unverified');
 assert.equal(r.options.rows[0].translatedName,'');
 for(const key of ['color','size'])for(const value of [null,123,'x'.repeat(201),'bad\u0000'])assert.throws(()=>prepare('owner',job,{...result,options:[{...result.options[0],[key]:value}]},'p',now));
});
test('promotion preserves original facts, captured policy and unverified fields',()=>{const r=prepare('owner',job,result,'p',now);assert.equal(r.product.source_price_cny,3.25);assert.equal(r.product.options_count,2);assert.equal(r.options.rows[0].translatedName,'');assert.equal(r.options.rows[0].unitsPerPack,1);assert.equal(r.options.rows[0].minimumOrderQuantity,2);assert.equal(r.options.rows[0].provenance.originalName,'collected');assert.equal(r.content.seo.title.provenance,'collected');assert.equal(r.content.label.material.value,'');assert.equal(r.product.image_keys,'[]');assert.equal(r.product.supplier_hub_status,'미전송');assert.equal(r.product.seo_status,'대기');assert.equal(r.policy.exchangeRate,settings.exchangeRate);});
test('promotion rejects missing context or malformed SKU and obeys disabled minimum margin',()=>{assert.throws(()=>prepare('owner',{...job,context:null},result,'p',now));assert.throws(()=>prepare('owner',job,{...result,options:[{...result.options[0],minimumOrder:1e12}]},'p',now));const r=prepare('owner',{...job,context:{...job.context,settings:{...settings,minimumMarginEnabled:false}}},result,'p',now);assert.equal(r.policy.minimumMargin,0);});
function storage(files){const sqlite=memoryDatabase();for(const statement of runtimeDDL())sqlite.exec(statement.sql);
 sqlite.prepare('INSERT INTO collection_jobs VALUES (?,?,?,?,?,?,?,?)').run(job.id,'owner','123',job.source_url,job.goal,job.status,now,now);
 sqlite.prepare('INSERT INTO collection_context VALUES (?,?)').run(job.id,JSON.stringify(job.context));
 sqlite.prepare('INSERT INTO collection_results VALUES (?,?,?,?)').run(job.id,'owner',JSON.stringify(result),now);
 const db={prepare(sql){let args=[];const q={bind(...v){args=v;return q;},execute(){return sqlite.prepare(sql).all(...args);},async first(){return q.execute()[0]??null;},async run(){return sqlite.prepare(sql).run(...args);}};return q;},async batch(statements){sqlite.exec('BEGIN');try{const results=statements.map(s=>({results:s.execute()}));sqlite.exec('COMMIT');return results;}catch(e){sqlite.exec('ROLLBACK');throw e;}}};
 const deps={'cloudflare:workers':{env:{DB:db,FILES:files}},'@/db/queries':{ensureDatabase:async()=>{}},'@/db/product-options':{readProductOptions:async()=>{}},'@/db/product-content':{readProductContent:async()=>{}}};return {sqlite,...load('db/collection-products.ts',deps),jobs:load('db/collection-jobs.ts',deps)};}
test('transaction creates all companion rows once and retry preserves manual edits',async()=>{const s=storage();const first=await s.promoteCollection('owner',job,result);s.sqlite.prepare('UPDATE products SET title=? WHERE id=?').run('수동 수정',first.product_id);const second=await s.promoteCollection('owner',job,result);assert.equal(first.product_id,second.product_id);for(const table of ['products','product_options','product_content','product_price_policy','collection_products'])assert.equal(s.sqlite.prepare(`SELECT count(*) n FROM ${table}`).get().n,1);assert.equal(s.sqlite.prepare('SELECT title FROM products').get().title,'수동 수정');assert.equal(await s.jobs.cancelCollection('owner',job.id),null);assert.equal(s.sqlite.prepare('SELECT status FROM collection_jobs').get().status,'awaiting_connector');s.sqlite.close();});
test('failed companion insert rolls back product and all earlier writes',async()=>{const s=storage();s.sqlite.exec("CREATE TRIGGER fail_content BEFORE INSERT ON product_content BEGIN SELECT RAISE(ABORT,'synthetic failure'); END");await assert.rejects(()=>s.promoteCollection('owner',job,result));for(const table of ['products','product_options','product_price_policy','collection_products'])assert.equal(s.sqlite.prepare(`SELECT count(*) n FROM ${table}`).get().n,0);s.sqlite.exec('DROP TRIGGER fail_content');assert.ok((await s.promoteCollection('owner',job,result)).product_id);s.sqlite.close();});
test('cancellation, other owner and changed receipt/context create no products',async()=>{for(const mutation of ['cancel','owner','receipt','context']){const s=storage();if(mutation==='cancel')s.sqlite.exec("UPDATE collection_jobs SET status='cancelled'");if(mutation==='receipt')s.sqlite.exec("UPDATE collection_results SET payload='{}'");if(mutation==='context')s.sqlite.exec("UPDATE collection_context SET payload='{}'");await assert.rejects(()=>s.promoteCollection(mutation==='owner'?'other':'owner',job,result));assert.equal(s.sqlite.prepare('SELECT count(*) n FROM products').get().n,0);s.sqlite.close();}});
test('production API rejects unverified requests before any product read or write',async()=>{const api=load('app/api/collection-jobs/[id]/product/route.ts',{'@/app/chatgpt-auth':{getChatGPTUser:async()=>null},'@/db/collection-jobs':{},'@/db/collection-results':{},'@/db/collection-products':{}},'production');const r=await api.POST(new Request('https://example.test',{method:'POST'}),{params:Promise.resolve({id:'job'})});assert.equal(r.status,503);});

test('promotion persists supplier stock by SKU including zero without changing quotation inclusion',async()=>{
 const s=storage();const saved=await s.promoteCollection('owner',job,result);
 const options=JSON.parse(s.sqlite.prepare('SELECT payload FROM product_options WHERE product_id=?').get(saved.product_id).payload);
 assert.equal(options.rows[0].supplierSku,'a');assert.equal(options.rows[0].stock,null);assert.equal(options.rows[0].provenance.stock,'unverified');
 assert.equal(options.rows[1].supplierSku,'b');assert.equal(options.rows[1].stock,0);assert.equal(options.rows[1].provenance.stock,'collected');assert.equal(options.rows[1].included,true);
 const changed={...options,rows:options.rows.map(row=>({...row,stock:17,provenance:{...row.provenance,stock:'manual'}}))};
 s.sqlite.prepare('UPDATE product_options SET payload=? WHERE product_id=?').run(JSON.stringify(changed),saved.product_id);
 await s.promoteCollection('owner',job,result);
 assert.equal(JSON.parse(s.sqlite.prepare('SELECT payload FROM product_options WHERE product_id=?').get(saved.product_id).payload).rows[1].stock,17);
 s.sqlite.close();
});


test('collection captures selected banners without changing originals and ignores disabled banners',()=>{
 const captured={...job,context:{...job.context,settings:{...settings,topImageEnabled:true,topImageKey:'owner/top.png',bottomImageEnabled:true,bottomImageKey:'owner/bottom.png'}}};
 const before=JSON.stringify(captured);const prepared=prepare('owner',captured,result,'p',now);
 assert.equal(prepared.product.image_keys,JSON.stringify(['owner/top.png','owner/bottom.png']));
 assert.equal(prepared.content.assets.detailTop.value[0],'owner/top.png');assert.equal(prepared.content.assets.detailBottom.value[0],'owner/bottom.png');
 assert.equal(prepared.content.assets.detail.value.length,0);assert.equal(JSON.stringify(captured),before);
 captured.context.settings.topImageKey='owner/new.png';assert.equal(prepared.content.assets.detailTop.value[0],'owner/top.png');
 captured.context.settings.topImageEnabled=false;assert.equal(prepare('owner',captured,result,'p',now).content.assets.detailTop.value.length,0);
 captured.context.settings.bottomImageKey='other/private.png';assert.throws(()=>prepare('owner',captured,result,'p',now));
});


test('banner verification precedes atomic promotion and completed retries preserve the captured file',async()=>{
 let available=false,reads=0;
 const s=storage({get:async()=>{reads++;return available?{size:8,body:new Response(new Uint8Array([137,80,78,71,13,10,26,10])).body}:null;}});
 const captured={...job,context:{...job.context,settings:{...settings,topImageEnabled:true,topImageKey:'owner/top.png'}}};
 s.sqlite.prepare('UPDATE collection_context SET payload=?').run(JSON.stringify(captured.context));
 await assert.rejects(()=>s.promoteCollection('owner',captured,result));assert.equal(s.sqlite.prepare('SELECT count(*) n FROM products').get().n,0);
 available=true;const saved=await s.promoteCollection('owner',captured,result);
 assert.equal(s.sqlite.prepare('SELECT image_keys FROM products').get().image_keys,'["owner/top.png"]');
 assert.equal(JSON.parse(s.sqlite.prepare('SELECT payload FROM product_content').get().payload).assets.detailTop.value[0],'owner/top.png');
 const checked=reads;available=false;
 assert.equal((await s.promoteCollection('owner',captured,result)).product_id,saved.product_id);assert.equal(reads,checked);s.sqlite.close();
});

test('promotion initializes label business fields from captured settings including explicit blanks',()=>{
 const captured={...job,context:{...job.context,settings:{...settings,manufacturer:'등록 제조사',importer:'등록 수입원',serviceContact:''}}};
 const before=JSON.stringify(captured),prepared=prepare('owner',captured,result,'p',now);
 for(const [key,value] of [['manufacturer','등록 제조사'],['importer','등록 수입원'],['contact','']]){
  assert.equal(prepared.content.label[key].value,value);assert.equal(prepared.content.label[key].provenance,'manual');
  assert.equal(prepared.content.label[key].updatedAt,now);
 }
 for(const key of ['material','countryOfOrigin','certification','kcInformation'])assert.equal(prepared.content.label[key].provenance,'unverified');
 assert.equal(JSON.stringify(captured),before);
 const sparse={...captured,context:{...captured.context,settings:{...captured.context.settings}}};
 for(const key of ['manufacturer','importer','serviceContact'])delete sparse.context.settings[key];
 const legacy=prepare('owner',sparse,result,'p',now);
 for(const key of ['manufacturer','importer','contact']){assert.equal(legacy.content.label[key].value,'');assert.equal(legacy.content.label[key].provenance,'unverified');}
});

test('promotion retry preserves edited label business fields instead of restoring captured settings',async()=>{
 const s=storage();
 try{
  const saved=await s.promoteCollection('owner',job,result);
  const read=()=>JSON.parse(s.sqlite.prepare('SELECT payload FROM product_content WHERE product_id=?').get(saved.product_id).payload);
  const content=read();assert.equal(content.label.manufacturer.value,settings.manufacturer);
  content.label.manufacturer={value:'',provenance:'manual',updatedAt:now};content.label.importer.value='수정 수입원';
  s.sqlite.prepare('UPDATE product_content SET payload=? WHERE product_id=?').run(JSON.stringify(content),saved.product_id);
  await s.promoteCollection('owner',job,result);
  assert.equal(read().label.manufacturer.value,'');assert.equal(read().label.importer.value,'수정 수입원');
 }finally{s.sqlite.close();}
});

test('captured company labels feed quotation fields even after workspace defaults change',()=>{
 const captured={...job,context:{...job.context,settings:{...settings,manufacturer:'당시 제조사',importer:'당시 수입원',serviceContact:''}}};
 const p=prepare('owner',captured,result,'p',now);
 const {resolveQuotationFields}=load('app/quotation-schema.ts');
 const resolved=resolveQuotationFields({categoryId:'80719',product:p.product,content:p.content,options:p.options,settings:{...settings,manufacturer:'새 제조사',importer:'새 수입원',serviceContact:'새 연락처'}});
 for(const row of resolved.rows.filter(row=>row.included)){
  assert.equal(row.fields.manufacturer.value,'당시 제조사');
  assert.equal(row.fields.noticeManufacturerImporter.value,'제조자: 당시 제조사 / 수입자: 당시 수입원');
  assert.equal(row.fields.noticeServiceContact.value,'');
  assert.equal(row.fields.noticeServiceContact.source,'content');
 }
});

test('captured target keywords populate SEO and category quotation tags without inventing translated keywords',()=>{
 const captured={...job,context:{...job.context,keywords:' 빨강, 수납 가방\n빨강, 轻便 ',features:'feature must not replace source description'}};
 const r=prepare('owner',captured,result,'p',now);
 assert.deepEqual(Array.from(r.content.seo.keywords.value),['빨강','수납 가방','轻便']);
 assert.equal(r.content.seo.keywords.provenance,'manual');assert.equal(r.content.seo.description.value,result.description);
 const resolve=load('app/quotation-schema.ts').resolveQuotationFields;
 for(const categoryId of ['80719','81452','64497','103495']){
  const quote=resolve({categoryId,product:r.product,content:r.content,options:r.options,settings});
  assert.ok(quote.rows.every(row=>row.fields.searchTags.value==='빨강, 수납 가방, 轻便'));
 }
 assert.deepEqual(Array.from(prepare('owner',job,result,'p',now).content.seo.keywords.value),[]);
});
test('keyword promotion never silently truncates invalid captured input',()=>{
 for(const keywords of ['x'.repeat(101),Array.from({length:51},(_,i)=>'k'+i).join(','),'bad\u0000']){
  assert.throws(()=>prepare('owner',{...job,context:{...job.context,keywords}},result,'p',now),/키워드/);
 }
});

test('stored target keyword draft survives promotion retry after manual SEO editing',async()=>{
 const s=storage();const captured={...job,context:{...job.context,keywords:'원본, 검색어'}};
 try {
 s.sqlite.prepare('UPDATE collection_context SET payload=? WHERE job_id=?').run(JSON.stringify(captured.context),job.id);
 const saved=await s.promoteCollection('owner',captured,result);
 const read=()=>JSON.parse(s.sqlite.prepare('SELECT payload FROM product_content WHERE product_id=?').get(saved.product_id).payload);
 const content=read();assert.deepEqual(content.seo.keywords.value,['원본','검색어']);
 content.seo.keywords.value=[];content.seo.keywords.provenance='manual';
 s.sqlite.prepare('UPDATE product_content SET payload=? WHERE product_id=?').run(JSON.stringify(content),saved.product_id);
 await s.promoteCollection('owner',captured,result);assert.deepEqual(read().seo.keywords.value,[]);
 } finally {s.sqlite.close();}
});
