import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import ts from 'typescript';
import {createRequire} from 'node:module';
import {memoryDatabase,runtimeDDL} from '../scripts/check-db-schema.mjs';
const native=createRequire(import.meta.url),version='2026-10-06T00:00:00.000Z';
const active={exchangeRate:350,supplyMargin:50,coupangMargin:40,minimumMargin:3000,msrpMultiple:1.3,roundingUnit:10,roundingMode:'nearest',useIntegratedRate:true,integratedRate:300};
const companies=[{code:'A01464742',name:'와이홉',email:'unari8484@gmail.com'},{code:'A01526306',name:'유앤채',email:'jwhj1116@kakao.com'}];
function harness(company=companies[0]){
 const sqlite=memoryDatabase();for(const declaration of runtimeDDL())sqlite.exec(declaration.sql);const owner='local-'+company.code,state={verified:true,sql:[],beforePricingWrite:null,external:0};
 const db={prepare(sql){let args=[];const q={bind(...values){args=values;return q;},execute(){state.sql.push(sql);if(/UPDATE\s+products\s+SET\s+exchange_rate/i.test(sql))state.beforePricingWrite?.();return sqlite.prepare(sql).all(...args);},async first(){return q.execute()[0]??null;},async all(){return{results:q.execute()};},async run(){state.sql.push(sql);return sqlite.prepare(sql).run(...args);}};return q;},async batch(statements){sqlite.exec('BEGIN');try{const result=statements.map(q=>({results:q.execute()}));sqlite.exec('COMMIT');return result;}catch(error){sqlite.exec('ROLLBACK');throw error;}}};
 const cache=new Map();function load(file){if(cache.has(file))return cache.get(file);const exports={};cache.set(file,exports);vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../'+file,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,Error,URL,Request,Response,Headers,TextEncoder,TextDecoder,Uint8Array,DataView,structuredClone,crypto,process:{env:{NODE_ENV:'production'}},fetch(){state.external++;throw Error('no external requests in pricing/removal tests');},require(name){if(name==='next/server')return{NextResponse:Response};if(name==='cloudflare:workers')return{env:{DB:db}};if(name==='@/app/chatgpt-auth')return{getChatGPTUser:async()=>state.verified?{verifiedAccess:true,userId:owner,email:company.email,membership:{id:owner,email:company.email,role:company.code==='A01526306'?'admin':'member',status:'approved',companyCode:company.code,companyName:company.name}}:null,getWorkspaceOwnerId:async()=>owner};if(name.startsWith('./')||name.startsWith('../'))return load(path.posix.join(path.posix.dirname(file),name)+'.ts');return name.startsWith('@/')?load(name.slice(2)+'.ts'):native(name);}});return exports;}
 const route=load('app/api/products/[id]/pricing/route.ts'),productRoute=load('app/api/products/[id]/route.ts'),context=id=>({params:Promise.resolve({id})});
 const price=(body={policy:active,expectedVersion:version},headers={},id='p')=>route.POST(new Request('https://app.test/api/products/'+id+'/pricing',{method:'POST',headers:{'content-type':'application/json',...headers},body:typeof body==='string'?body:JSON.stringify(body)}),context(id));
 const remove=(body,id='p')=>productRoute.DELETE(new Request('https://app.test/api/products/'+id,{method:'DELETE',headers:{'content-type':'application/json'},body:JSON.stringify(body)}),context(id));
 const snapshot=()=>JSON.stringify(Object.fromEntries(['products','product_price_policy','product_options','product_content','product_quotation_fields','workspace_settings'].map(table=>[table,sqlite.prepare('SELECT * FROM '+table+' ORDER BY 1').all()])));
 async function seed({overflow=false,excluded=false}={}){
  const product={id:'p',owner_id:owner,source_url:'https://detail.1688.com/offer/813724060928.html',title:'PRIVATE PRICING FIXTURE',source_price_cny:3.6,exchange_rate:350,supply_margin:50,coupang_margin:40,supply_price:4260,sale_price:7100,msrp:9230,options_count:2,seo_status:'입력됨',image_status:'대기',quote_status:'완료',registration_status:'검토 대기',supplier_hub_status:'미전송',image_keys:'[]',goal_stage:'price',created_at:version,updated_at:version};
  const queries=load('db/queries.ts'),legacy={exchangeRate:350,supplyMargin:50,coupangMargin:40,minimumMargin:3000,msrpMultiple:1.3,roundingUnit:10,roundingMode:'nearest'};await queries.insertProduct(product,legacy);await queries.insertProduct({...product,id:'foreign',owner_id:'other'},legacy);
  const model=load('app/product-options.ts'),input={...model.emptyOptionInput('sku'),originalName:'원문 옵션',translatedName:'검토 옵션',included:!excluded,unitCostCny:overflow?1e9:excluded?null:3.6,unitsPerPack:overflow?1e6:1},options=model.applyOptionRows(model.emptyProductOptions('p'),[input],version);sqlite.prepare('INSERT INTO product_options VALUES(?,?,?,?,?)').run('p',owner,options.revision,JSON.stringify(options),version);
  const content=load('app/product-content.ts').emptyProductContent('p');content.revision=1;content.updatedAt=version;content.seo.title.value='보존할 SEO';sqlite.prepare('INSERT INTO product_content VALUES(?,?,?,?,?)').run('p',owner,1,JSON.stringify(content),version);
  const state={schemaVersion:1,productId:'p',revision:1,overrides:{common:{salePrice:'9999'},options:{sku:{supplyPrice:'12345',msrp:''}}},updatedAt:version};sqlite.prepare('INSERT INTO product_quotation_fields VALUES(?,?,?,?,?)').run('p',owner,1,JSON.stringify(state),version);await queries.saveSettings(owner,JSON.stringify(load('app/workspace-settings.ts').newWorkspaceSettings));
 }
 return{sqlite,owner,state,load,price,remove,snapshot,seed,close(){sqlite.close();}};
}
const json=async(response,status=200)=>{assert.equal(response.status,status,await response.clone().text());return response.json();};

for(const company of companies)test(`soft removal prevents pricing/policy writes and restoration permits an explicit integrated calculation (${company.code})`,async()=>{
 const h=harness(company);try{await h.seed();const before=h.snapshot(),removed=await json(await h.remove({expectedVersion:version}));await json(await h.price(),409);assert.equal(h.snapshot(),before);assert.equal(h.sqlite.prepare('SELECT removed_at FROM product_removals').get().removed_at,removed.removedAt);
  await json(await h.remove({action:'restore',expectedVersion:version,expectedRemovedAt:removed.removedAt}));const options=h.sqlite.prepare('SELECT payload FROM product_options').get().payload,content=h.sqlite.prepare('SELECT payload FROM product_content').get().payload,overrides=h.sqlite.prepare('SELECT payload FROM product_quotation_fields').get().payload,settings=h.sqlite.prepare('SELECT payload FROM workspace_settings').get().payload;
  const saved=await json(await h.price());assert.deepEqual([saved.calculation.costKrw,saved.product.supply_price,saved.product.sale_price,saved.product.msrp],[1518,4520,7530,9790]);const policy=JSON.parse(h.sqlite.prepare('SELECT payload FROM product_price_policy WHERE product_id=?').get('p').payload);assert.equal(policy.useIntegratedRate,true);assert.equal(policy.integratedRate,300);assert.equal(saved.product.quote_status,'대기');assert.equal(saved.product.supplier_hub_status,'미전송');assert.equal(h.sqlite.prepare('SELECT payload FROM product_options').get().payload,options);assert.equal(h.sqlite.prepare('SELECT payload FROM product_content').get().payload,content);assert.equal(h.sqlite.prepare('SELECT payload FROM product_quotation_fields').get().payload,overrides);assert.equal(h.sqlite.prepare('SELECT payload FROM workspace_settings').get().payload,settings);assert.equal(h.state.external,0);
 }finally{h.close();}
});

test('a removal arriving after pricing preflight is caught by the atomic SQL guard before both price and policy writes',async()=>{
 const h=harness();try{await h.seed();const before=h.snapshot();h.state.beforePricingWrite=()=>{h.state.beforePricingWrite=null;h.sqlite.prepare('INSERT INTO product_removals(product_id,owner_id,product_version,removed_at) VALUES(?,?,?,?)').run('p',h.owner,version,'2026-10-06T00:00:00.001Z');};await json(await h.price(),409);assert.equal(h.snapshot(),before);assert.equal(h.sqlite.prepare('SELECT count(*) AS count FROM product_removals').get().count,1);assert.equal(h.state.external,0);
 }finally{h.close();}
});

test('overflow in any included pack fails price preflight without reaching an atomic price update or policy insert',async()=>{
 const h=harness();try{await h.seed({overflow:true});const before=h.snapshot();h.state.sql.length=0;const body=await json(await h.price(),400);assert.equal(body.code,'INVALID_OPTION_PRICE');assert.equal(body.options[0].optionId,'sku');assert.ok(body.options[0].error);assert.equal(h.snapshot(),before);assert.equal(h.state.sql.some(sql=>/UPDATE\s+products\s+SET\s+exchange_rate|INSERT\s+INTO\s+product_price_policy/i.test(sql)),false);
 }finally{h.close();}
});

test('excluded unfinished options do not block an otherwise valid explicit pricing save',async()=>{
 const h=harness();try{await h.seed({excluded:true});const options=h.sqlite.prepare('SELECT payload FROM product_options').get().payload;await json(await h.price());assert.equal(h.sqlite.prepare('SELECT payload FROM product_options').get().payload,options);
 }finally{h.close();}
});

test('invalid rates, stale versions, unrelated owners, oversized/extra-key bodies and cross-origin pricing cannot mutate saved records',async()=>{
 const h=harness();try{await h.seed();const before=h.snapshot();for(const rate of [null,0,-1,'350'])await json(await h.price({policy:{...active,integratedRate:rate},expectedVersion:version}),400);await json(await h.price({policy:active,expectedVersion:'2026-10-05T00:00:00.000Z'}),409);await json(await h.price(undefined,{},'foreign'),404);await json(await h.price({policy:active,expectedVersion:version,automatic:true}),400);await json(await h.price({policy:active,expectedVersion:version,padding:'x'.repeat(9000)}),413);await json(await h.price(undefined,{origin:'https://foreign.example'}),400);assert.equal(h.snapshot(),before);assert.equal(h.state.external,0);
 }finally{h.close();}
});
