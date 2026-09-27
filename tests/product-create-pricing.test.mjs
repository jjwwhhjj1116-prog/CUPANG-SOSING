import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {DatabaseSync} from 'node:sqlite';
function runtime(){
 const sql=new DatabaseSync(':memory:');
 const DB={prepare(query){let values=[];return {bind(...args){values=args;return this;},async run(){return {meta:sql.prepare(query).run(...values)};},async first(){return sql.prepare(query).get(...values)??null;},async all(){return {results:sql.prepare(query).all(...values)};}};},async batch(statements){sql.exec('BEGIN');try{const result=[];for(const stmt of statements)result.push(await stmt.run());sql.exec('COMMIT');return result;}catch(error){sql.exec('ROLLBACK');throw error;}}};
 const cache=new Map();let authenticated=true;
 function load(file){if(cache.has(file))return cache.get(file);const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,crypto,URL,Response,TextEncoder,TextDecoder,process:{env:{NODE_ENV:'production'}},require(name){if(name==='cloudflare:workers')return {env:{DB}};if(name==='next/server')return {NextResponse:Response};if(name==='@/app/chatgpt-auth')return {getChatGPTUser:async()=>authenticated?{verifiedAccess:true}:null,getWorkspaceOwnerId:async()=>'owner'};if(name==='@/db/product-content')return {};if(name.startsWith('@/'))return load(name.slice(2)+'.ts');throw Error(name);}});cache.set(file,exports);return exports;}
 const store=load('db/queries.ts'),route=load('app/api/products/route.ts');
 const post=(body={})=>route.POST(new Request('https://app.test/api/products',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({sourceUrl:'https://detail.1688.com/offer/123.html',sourcePriceCny:5.23,...body})}));
 return {sql,load,store,post,logout(){authenticated=false;}};
}
const observed={exchangeRate:350,supplyMargin:50,coupangMargin:40,minimumMargin:3000,minimumMarginEnabled:true,msrpMultiple:1.3,roundingUnit:10,roundingMode:'nearest'};
test('product creation uses captured workspace policy and Couplus observed decimal rounding',async()=>{
 const r=runtime();await r.store.saveSettings('owner',JSON.stringify(observed));
 const response=await r.post();assert.equal(response.status,201);const {product}=await response.json();
 assert.equal(product.supply_price,4830);assert.equal(product.sale_price,8050);assert.equal(product.msrp,10470);
 assert.equal(JSON.parse(product.pricing_policy).roundingMode,'nearest');
 await r.store.saveSettings('owner',JSON.stringify({...observed,exchangeRate:500,roundingUnit:100}));
 const saved=await r.store.findProduct('owner',product.id);
 assert.equal(saved.supply_price,4830);assert.equal(JSON.parse(saved.pricing_policy).exchangeRate,350);
 assert.equal(await r.store.findProduct('other',product.id),null);r.sql.close();
});
test('disabled minimum margin and explicit overrides use shared price engine',async()=>{
 const r=runtime();await r.store.saveSettings('owner',JSON.stringify({...observed,minimumMarginEnabled:false}));
 const response=await r.post({roundingUnit:100,roundingMode:'up',exchangeRate:400});
 assert.equal(response.status,201);const {product}=await response.json();
 const policy=JSON.parse(product.pricing_policy),expected=r.load('app/pricing.ts').calculatePrice(5.23,policy);
 assert.equal(policy.minimumMargin,0);assert.equal(product.supply_price,expected.supplyPrice);assert.equal(product.sale_price,expected.salePrice);
 for(const invalid of [{roundingUnit:7},{roundingMode:'down'},{msrpMultiple:0.5},{minimumMarginEnabled:'false'},{exchangeRate:null},{optionsCount:201}])assert.equal((await r.post(invalid)).status,400);
 assert.equal(r.sql.prepare('SELECT count(*) n FROM products').get().n,1);r.sql.close();
});
test('initial price and policy are transactional and failed authentication creates no product',async()=>{
 const r=runtime();await r.store.saveSettings('owner',JSON.stringify(observed));
 r.sql.exec("CREATE TRIGGER fail_policy BEFORE INSERT ON product_price_policy BEGIN SELECT RAISE(ABORT,'fixture'); END");
 assert.equal((await r.post()).status,503);assert.equal(r.sql.prepare('SELECT count(*) n FROM products').get().n,0);
 r.sql.exec('DROP TRIGGER fail_policy');r.logout();assert.equal((await r.post()).status,503);assert.equal(r.sql.prepare('SELECT count(*) n FROM products').get().n,0);r.sql.close();
});
