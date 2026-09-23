import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {memoryDatabase,runtimeDDL} from '../scripts/check-db-schema.mjs';
function load(file,deps={},mode='development'){
 const exports={};const code=ts.transpileModule(fs.readFileSync(new URL(`../${file}`,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 vm.runInNewContext(code,{exports,crypto,URL,Date,Response,process:{env:{NODE_ENV:mode}},require(name){if(name in deps)return deps[name];if(name==='next/server')return {NextResponse:Response};if(name.startsWith('@/'))return load(`${name.slice(2)}.ts`,deps,mode);throw Error(name);}});return exports;
}
const settings=load('app/workspace-settings.ts').defaultSettings;
const prepare=load('app/collection-product.ts').prepareCollectionProduct;
const now='2026-01-01T00:00:00.000Z';
const job={id:'job',offer_id:'123',source_url:'https://detail.1688.com/offer/123.html',goal:'transmit',status:'awaiting_connector',created_at:now,updated_at:now,context:{category:{id:'cat'},settings,features:'feature',keywords:'',capturedAt:now}};
const result={schemaVersion:1,offerId:'123',sourceUrl:job.source_url,provider:'fixture',collectedAt:now,title:'原文商品',description:'原文説明',images:[],options:[{sku:'a',name:'黑',unitPriceCny:3.25,minimumOrder:2,stock:null},{sku:'b',name:'白',unitPriceCny:5,minimumOrder:1,stock:0}]};
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
function storage(){const sqlite=memoryDatabase();for(const statement of runtimeDDL())sqlite.exec(statement.sql);
 sqlite.prepare('INSERT INTO collection_jobs VALUES (?,?,?,?,?,?,?,?)').run(job.id,'owner','123',job.source_url,job.goal,job.status,now,now);
 sqlite.prepare('INSERT INTO collection_context VALUES (?,?)').run(job.id,JSON.stringify(job.context));
 sqlite.prepare('INSERT INTO collection_results VALUES (?,?,?,?)').run(job.id,'owner',JSON.stringify(result),now);
 const db={prepare(sql){let args=[];const q={bind(...v){args=v;return q;},execute(){return sqlite.prepare(sql).all(...args);},async first(){return q.execute()[0]??null;},async run(){return sqlite.prepare(sql).run(...args);}};return q;},async batch(statements){sqlite.exec('BEGIN');try{const results=statements.map(s=>({results:s.execute()}));sqlite.exec('COMMIT');return results;}catch(e){sqlite.exec('ROLLBACK');throw e;}}};
 const deps={'cloudflare:workers':{env:{DB:db}},'@/db/queries':{ensureDatabase:async()=>{}},'@/db/product-options':{readProductOptions:async()=>{}},'@/db/product-content':{readProductContent:async()=>{}}};return {sqlite,...load('db/collection-products.ts',deps),jobs:load('db/collection-jobs.ts',deps)};}
test('transaction creates all companion rows once and retry preserves manual edits',async()=>{const s=storage();const first=await s.promoteCollection('owner',job,result);s.sqlite.prepare('UPDATE products SET title=? WHERE id=?').run('수동 수정',first.product_id);const second=await s.promoteCollection('owner',job,result);assert.equal(first.product_id,second.product_id);for(const table of ['products','product_options','product_content','product_price_policy','collection_products'])assert.equal(s.sqlite.prepare(`SELECT count(*) n FROM ${table}`).get().n,1);assert.equal(s.sqlite.prepare('SELECT title FROM products').get().title,'수동 수정');assert.equal(await s.jobs.cancelCollection('owner',job.id),null);assert.equal(s.sqlite.prepare('SELECT status FROM collection_jobs').get().status,'awaiting_connector');s.sqlite.close();});
test('failed companion insert rolls back product and all earlier writes',async()=>{const s=storage();s.sqlite.exec("CREATE TRIGGER fail_content BEFORE INSERT ON product_content BEGIN SELECT RAISE(ABORT,'synthetic failure'); END");await assert.rejects(()=>s.promoteCollection('owner',job,result));for(const table of ['products','product_options','product_price_policy','collection_products'])assert.equal(s.sqlite.prepare(`SELECT count(*) n FROM ${table}`).get().n,0);s.sqlite.exec('DROP TRIGGER fail_content');assert.ok((await s.promoteCollection('owner',job,result)).product_id);s.sqlite.close();});
test('cancellation, other owner and changed receipt/context create no products',async()=>{for(const mutation of ['cancel','owner','receipt','context']){const s=storage();if(mutation==='cancel')s.sqlite.exec("UPDATE collection_jobs SET status='cancelled'");if(mutation==='receipt')s.sqlite.exec("UPDATE collection_results SET payload='{}'");if(mutation==='context')s.sqlite.exec("UPDATE collection_context SET payload='{}'");await assert.rejects(()=>s.promoteCollection(mutation==='owner'?'other':'owner',job,result));assert.equal(s.sqlite.prepare('SELECT count(*) n FROM products').get().n,0);s.sqlite.close();}});
test('production API rejects unverified requests before any product read or write',async()=>{const api=load('app/api/collection-jobs/[id]/product/route.ts',{'@/app/chatgpt-auth':{getChatGPTUser:async()=>null},'@/db/collection-jobs':{},'@/db/collection-results':{},'@/db/collection-products':{}},'production');const r=await api.POST(new Request('https://example.test',{method:'POST'}),{params:Promise.resolve({id:'job'})});assert.equal(r.status,503);});
