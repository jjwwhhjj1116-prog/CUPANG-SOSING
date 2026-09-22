import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { DatabaseSync } from 'node:sqlite';

function load(file, overrides = {}, mode = 'development') {
  const output = ts.transpileModule(fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports = {};
  vm.runInNewContext(output, { exports, Response, process: { env: { NODE_ENV: mode } }, require: name => {
    if (name in overrides) return overrides[name];
    if (name === 'next/server') return { NextResponse: Response };
    if (name === '@/app/pricing') return load('app/pricing.ts');
    if (name === '@/app/workspace-settings') return load('app/workspace-settings.ts');
    if (name === '@/app/chatgpt-auth') return { getChatGPTUser: async () => ({ userId: 'owner' }), getWorkspaceOwnerId: async () => 'owner' };
    throw Error(name);
  } });
  return exports;
}
const pricing = load('app/pricing.ts');
const policy = { exchangeRate:100,supplyMargin:0,coupangMargin:0,minimumMargin:0,msrpMultiple:1,roundingUnit:10 };
const product = { id:'test', source_price_cny:10, updated_at:'2026-09-22T00:00:00.000Z' };
const request = body => new Request('http://localhost', {method:'POST',body:JSON.stringify(body)});
const input = { policy, expectedVersion:product.updated_at };
const context = { params: Promise.resolve({id:product.id}) };

test('pricing handles zero margin, minimum margin, percentage margin, and rounding',()=>{
  assert.equal(pricing.calculatePrice(10,policy).supplyPrice,1000);
  assert.equal(pricing.calculatePrice(10,{...policy,minimumMargin:305}).supplyPrice,1310);
  const result=pricing.calculatePrice(10,{...policy,supplyMargin:50,coupangMargin:20,msrpMultiple:1.3});
  assert.equal(result.supplyPrice,2000);assert.equal(result.salePrice,2500);assert.equal(result.msrp,3250);assert.equal(result.actualMargin,50);
});

test('decimal FX and supply margin hit exact ceilings without swallowing a genuine excess',()=>{
  const unitPolicy={...policy,roundingUnit:1};
  assert.equal(pricing.calculatePrice(0.07,unitPolicy).costKrw,7);
  assert.equal(pricing.calculatePrice(0.07,unitPolicy).supplyPrice,7);
  assert.ok(0.07000000000000002 > 0.07);
  assert.equal(pricing.calculatePrice(0.07000000000000002,unitPolicy).supplyPrice,8);
  assert.equal(pricing.calculatePrice(1,{...unitPolicy,exchangeRate:7.000000000000001}).supplyPrice,8);
  const marginPolicy={...policy,exchangeRate:200,supplyMargin:55,roundingUnit:100};
  const exact=pricing.calculatePrice(4.5,marginPolicy);
  assert.equal(exact.costKrw,900);assert.equal(exact.supplyPrice,2000);
  assert.equal(exact.marginKrw,1100);assert.equal(exact.actualMargin,55);
  assert.equal(pricing.calculatePrice(4.500000000000001,marginPolicy).supplyPrice,2100);
  assert.equal(pricing.calculatePrice(4.5,{...marginPolicy,supplyMargin:55.00000000000001}).supplyPrice,2100);
  assert.equal(pricing.calculatePrice(4.499999999999999,marginPolicy).supplyPrice,2000);
});

test('minimum margin comparisons preserve sub-cent excess before rounding',()=>{
  const minimumPolicy={...policy,roundingUnit:1,minimumMargin:3};
  assert.equal(pricing.calculatePrice(0.07,minimumPolicy).supplyPrice,10);
  assert.equal(pricing.calculatePrice(0.07,{...minimumPolicy,minimumMargin:3.0000000000000004}).supplyPrice,11);
  // Both targets equal 2000. Only an actual decimal increase selects 2100.
  const tied={...policy,exchangeRate:200,supplyMargin:55,minimumMargin:1100,roundingUnit:100};
  assert.equal(pricing.calculatePrice(4.5,tied).supplyPrice,2000);
  assert.equal(pricing.calculatePrice(4.5,{...tied,minimumMargin:1100.0000000000002}).supplyPrice,2100);
  assert.equal(pricing.calculatePrice(4.5,{...tied,minimumMargin:1099.9999999999998}).supplyPrice,2000);
});

test('Coupang margin and MSRP use decimal rounding at their own boundaries',()=>{
  const salePolicy={...policy,exchangeRate:200,coupangMargin:55,roundingUnit:100};
  const exact=pricing.calculatePrice(4.5,salePolicy);
  assert.equal(exact.supplyPrice,900);assert.equal(exact.salePrice,2000);assert.equal(exact.msrp,2000);
  assert.equal(pricing.calculatePrice(4.5,{...salePolicy,coupangMargin:55.00000000000001}).salePrice,2100);
  const marketPolicy={...policy,roundingUnit:1,msrpMultiple:1.1};
  assert.equal(pricing.calculatePrice(1,marketPolicy).msrp,110);
  assert.equal(pricing.calculatePrice(1,{...marketPolicy,msrpMultiple:1.1000000000000003}).msrp,111);
  assert.equal(pricing.calculatePrice(1,{...marketPolicy,msrpMultiple:1.0999999999999999}).msrp,110);
});

test('all supported rounding units agree with integer price examples across both margin branches',()=>{
  // 4.5 CNY × 200 = 900; / 45% = 2000; / 80% = 2500;
  // market × 1.1 = 2750. Each stage rounds before the next stage.
  for(const [roundingUnit,supplyPrice,salePrice,msrp] of [[1,2000,2500,2750],[10,2000,2500,2750],[100,2000,2500,2800],[1000,2000,3000,4000]]){
    const result=pricing.calculatePrice(4.5,{...policy,exchangeRate:200,supplyMargin:55,coupangMargin:20,msrpMultiple:1.1,roundingUnit});
    assert.deepEqual([result.supplyPrice,result.salePrice,result.msrp],[supplyPrice,salePrice,msrp]);
  }
});

test('finite exponent extremes remain bounded and safe integer monetary limits still apply',()=>{
  const exactPolicy={...policy,exchangeRate:1,roundingUnit:1};
  const maximum=pricing.calculatePrice(Number.MAX_SAFE_INTEGER,exactPolicy);
  assert.equal(maximum.supplyPrice,Number.MAX_SAFE_INTEGER);assert.equal(maximum.costKrw,Number.MAX_SAFE_INTEGER);
  assert.equal(maximum.marginKrw,0);assert.equal(maximum.actualMargin,0);
  assert.throws(()=>pricing.calculatePrice(Number.MAX_SAFE_INTEGER+1,exactPolicy),/가격 범위/);
  assert.throws(()=>pricing.calculatePrice(Number.MAX_SAFE_INTEGER,{...exactPolicy,msrpMultiple:1.0000000000000002}),/가격 범위/);
  assert.throws(()=>pricing.calculatePrice(1,{...exactPolicy,minimumMargin:Number.MAX_VALUE}),/가격 범위/);
  assert.throws(()=>pricing.calculatePrice(Number.MAX_VALUE,{...exactPolicy,exchangeRate:Number.MAX_VALUE}),/가격 범위/);
  assert.equal(pricing.calculatePrice(1e-300,{...exactPolicy,exchangeRate:1e300}).supplyPrice,1);
  const tiny=pricing.calculatePrice(Number.MIN_VALUE,exactPolicy);
  assert.equal(tiny.costKrw,Number.MIN_VALUE);assert.equal(tiny.supplyPrice,1);
  const underflow=pricing.calculatePrice(Number.MIN_VALUE,{...exactPolicy,exchangeRate:Number.MIN_VALUE});
  assert.equal(underflow.costKrw,0);assert.equal(underflow.supplyPrice,1);
  assert.equal(underflow.actualMargin,100);
});

test('option pack cost integration uses the same exact decimal price boundaries',()=>{
  const {emptyOptionInput,calculateOptionPrices}=load('app/product-options.ts');
  const row={...emptyOptionInput('selected'),originalName:'실측 예시',included:true,unitCostCny:1.5,unitsPerPack:3};
  const result=calculateOptionPrices([row,{...row,id:'excluded',included:false}],{...policy,exchangeRate:200,supplyMargin:55,roundingUnit:100});
  assert.equal(result[0].sourceCostCny,4.5);assert.equal(result[0].calculation.supplyPrice,2000);assert.equal(result[0].error,null);
  assert.equal(result[1].calculation,null);
  const cents=calculateOptionPrices([{...row,unitCostCny:0.01,unitsPerPack:7}],{...policy,roundingUnit:1})[0];
  assert.equal(cents.sourceCostCny,0.07);assert.equal(cents.calculation.costKrw,7);assert.equal(cents.calculation.supplyPrice,7);
});

test('settings preserve zero values, validate reference controls, and migrate older saved settings',()=>{
  const {validateSettings}=load('app/workspace-settings.ts');
  const value=validateSettings({brand:'Test',supplyMargin:0,minimumMargin:0,minimumMarginEnabled:false,roundingUnit:10});
  assert.equal(value.supplyMargin,0);assert.equal(value.minimumMarginEnabled,false);assert.equal(value.boxSkuQuantity,1);assert.equal(value.roundingUnit,10);
  for(const body of [{boxSkuQuantity:0},{boxSkuQuantity:1.5},{tradeType:'invalid'},{importType:'invalid'},{translateImages:'true'},{translationPrompt:'x'.repeat(10001)},{roundingUnit:3}]) assert.throws(()=>validateSettings(body));
});
test('invalid inputs and overflow fail rather than producing plausible prices',()=>{
  for(const update of [{exchangeRate:0},{exchangeRate:'100'},{supplyMargin:100},{coupangMargin:-1},{msrpMultiple:0.5},{minimumMargin:-1},{roundingUnit:7}]) assert.throws(()=>pricing.calculatePrice(10,{...policy,...update}));
  for(const cost of [0,-1,Infinity,NaN,1e300]) assert.throws(()=>pricing.calculatePrice(cost,policy));
});
test('CSV escapes commas, quotes, multiline values and spreadsheet formulas',()=>{
  const csv=pricing.quotationCsv([['=HYPERLINK("bad")','one,two','line\nbreak','  +CMD',123]]);
  assert.ok(csv.startsWith('\uFEFF'));
  assert.ok(csv.includes('"\'=HYPERLINK(""bad"")"'));
  assert.ok(csv.includes('"one,two"'));assert.ok(csv.includes('"line\nbreak"'));assert.ok(csv.includes('"\'  +CMD"'));assert.ok(csv.endsWith('"123"'));
});
test('server computes from stored cost, ignores forged totals, and returns stored product',async()=>{
  let written;
  const route=load('app/api/products/[id]/pricing/route.ts',{'@/db/queries':{
    findProduct:async(owner,id)=>{assert.equal(owner,'owner');assert.equal(id,'test');return product;},
    applyProductPrice:async(owner,id,version,values)=>{written=values;assert.equal(version,product.updated_at);return {...product,supply_price:values.supplyPrice};},
  }});
  const response=await route.POST(request({...input,sourcePriceCny:1,supplyPrice:1}),context);
  assert.equal(response.status,200);assert.equal(written.supplyPrice,1000);
  assert.equal((await response.json()).product.supply_price,1000);
});
test('missing products, stale versions, concurrent writes, storage failures have distinct responses',async()=>{
  for(const [queries,expected] of [
    [{findProduct:async()=>null},404],
    [{findProduct:async()=>({...product,updated_at:'2026-09-23T00:00:00.000Z'})},409],
    [{findProduct:async()=>product,applyProductPrice:async()=>null},409],
    [{findProduct:async()=>{throw Error('private storage');}},503],
  ]){
    const route=load('app/api/products/[id]/pricing/route.ts',{'@/db/queries':queries});
    const response=await route.POST(request(input),context);assert.equal(response.status,expected);assert.ok(!(await response.text()).includes('private storage'));
  }
});
test('invalid pricing never reaches storage and production is closed until authenticated',async()=>{
  const dependencies={'@/db/queries':{}};
  const route=load('app/api/products/[id]/pricing/route.ts',dependencies);
  for(const body of [null,{}, {...input,expectedVersion:'bad'}, {...input,policy:{...policy,supplyMargin:100}}])assert.equal((await route.POST(request(body),context)).status,400);
  const production=load('app/api/products/[id]/pricing/route.ts',dependencies,'production');
  assert.equal((await production.POST(request(input),context)).status,503);
});

test('real SQLite atomically preserves saved policy when a stale writer has the same timestamp',async()=>{
  const sqlite=new DatabaseSync(':memory:');
  const db={prepare(sql){let args=[];const q={bind(...values){args=values;return q;},execute(){return sqlite.prepare(sql).all(...args);},async all(){return {results:q.execute()};},async first(){return q.execute()[0]??null;},async run(){return sqlite.prepare(sql).run(...args);}};return q;},async batch(queries){sqlite.exec('BEGIN');try{const results=queries.map(q=>({results:q.execute()}));sqlite.exec('COMMIT');return results;}catch(error){sqlite.exec('ROLLBACK');throw error;}}};
  const queries=load('db/queries.ts',{'cloudflare:workers':{env:{DB:db}}});
  try{
    await queries.ensureDatabase();
    const future='2999-01-01T00:00:00.000Z';
    sqlite.prepare(`INSERT INTO products(id,owner_id,source_url,title,source_price_cny,exchange_rate,supply_margin,coupang_margin,supply_price,sale_price,msrp,created_at,updated_at) VALUES ('test','owner','synthetic','TEST',10,100,0,0,1000,1000,1000,?,?)`).run(future,future);
    const values={...policy,...pricing.calculatePrice(10,policy)};
    const saved=await queries.applyProductPrice('owner','test',future,values,policy);
    assert.ok(saved);assert.equal(JSON.parse(saved.pricing_policy).roundingUnit,10);
    const stale=await queries.applyProductPrice('owner','test',future,values,{...policy,roundingUnit:1000});
    assert.equal(stale,null);
    assert.equal(JSON.parse((await queries.findProduct('owner','test')).pricing_policy).roundingUnit,10);
    assert.equal((await queries.listProducts('owner')).length,1);
    assert.equal((await queries.listProducts('other')).length,0);
  }finally{sqlite.close();}
});
