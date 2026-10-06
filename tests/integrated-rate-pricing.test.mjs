import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import ts from 'typescript';
import {createRequire} from 'node:module';
const native=createRequire(import.meta.url),plain=value=>JSON.parse(JSON.stringify(value));
function modules(){const cache=new Map();function load(file){if(cache.has(file))return cache.get(file);const exports={};cache.set(file,exports);vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../'+file,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,Error,structuredClone,TextEncoder,fetch(){throw Error('pricing must not contact an exchange-rate provider');},require(name){if(name.startsWith('./')||name.startsWith('../'))return load(path.posix.join(path.posix.dirname(file),name)+'.ts');return name.startsWith('@/')?load(name.slice(2)+'.ts'):native(name);}});return exports;}return load;}
const load=modules(),pricing=load('app/pricing.ts'),options=load('app/product-options.ts'),settings=load('app/workspace-settings.ts');
const base={exchangeRate:190,supplyMargin:0,coupangMargin:0,minimumMargin:0,msrpMultiple:1,roundingUnit:1};
const active={...base,useIntegratedRate:true,integratedRate:350};
const amounts=value=>[value.costKrw,value.supplyPrice,value.salePrice,value.msrp];

test('disabled integrated-rate fields preserve byte-identical legacy policy serialization and all price results',()=>{
 const legacy=pricing.pricePolicy(base),bytes=JSON.stringify(legacy),expected=plain(pricing.calculatePrice(25.6,legacy,3));
 for(const fields of [{},{useIntegratedRate:false,integratedRate:null},{useIntegratedRate:false,integratedRate:350}]){
  const policy=pricing.pricePolicy({...base,...fields});assert.equal(JSON.stringify(policy),bytes);assert.equal(Object.hasOwn(policy,'useIntegratedRate'),false);assert.equal(Object.hasOwn(policy,'integratedRate'),false);assert.deepEqual(plain(pricing.calculatePrice(25.6,{...base,...fields},3)),expected);
 }
});

test('active mode requires its explicit positive finite rate instead of substituting the normal rate or any provider',()=>{
 for(const rate of [undefined,null,'350','',0,-1,NaN,Infinity,-Infinity])assert.throws(()=>pricing.pricePolicy({...base,useIntegratedRate:true,integratedRate:rate}));
 for(const flag of ['true',1,null])assert.throws(()=>pricing.pricePolicy({...base,useIntegratedRate:flag,integratedRate:350}));
 const policy=pricing.pricePolicy(active);assert.equal(policy.useIntegratedRate,true);assert.equal(policy.integratedRate,350);assert.equal(policy.exchangeRate,190);
});

test('recorded purchaseCost adds the 200+100 fees once per selling pack and rounds cost to one won before margins',()=>{
 // Recorded recalculateOption/calculatePricing pass unit CNY × quantity to
 // purchaseCost. Expected amounts below are fixed arithmetic examples.
 const cases=[{cny:10,qty:1,cost:4180},{cny:10,qty:3,cost:11880},{cny:3.6,qty:1,cost:1716},{cny:25.6,qty:1,cost:10186},{cny:5.23,qty:1,cost:2344},{cny:5.24,qty:1,cost:2347}];
 for(const item of cases)assert.deepEqual(amounts(pricing.calculatePrice(item.cny,active,item.qty)),[item.cost,item.cost,item.cost,item.cost]);
 assert.notEqual(pricing.calculatePrice(10,active,3).costKrw,3*pricing.calculatePrice(10,active).costKrw,'selling pack charges are not multiplied per unit');
 assert.deepEqual(amounts(pricing.calculatePrice(5,{...active,integratedRate:1})),[336,336,336,336],'335.5 is rounded at the one-won purchase-cost stage');
});

test('one-won purchase-cost rounding precedes supply margin/minimum and the selected currency rounding remains independent',()=>{
 const value=pricing.calculatePrice(1.5,{...active,integratedRate:1,supplyMargin:30,coupangMargin:40});
 assert.deepEqual(amounts(value),[332,475,792,792],'round(301.5×1.1)=332 then margin targets, rather than rounding the original 331.65 only at supply');
 assert.deepEqual(amounts(pricing.calculatePrice(3.6,{...active,roundingUnit:100,roundingMode:'nearest'})),[1716,1700,1700,1700]);
 assert.deepEqual(amounts(pricing.calculatePrice(3.6,{...active,roundingUnit:100,roundingMode:'up'})),[1716,1800,1800,1800]);
 const minimum=pricing.calculatePrice(3.6,{...active,supplyMargin:50,coupangMargin:40,minimumMargin:3000,msrpMultiple:1.3,roundingUnit:10,roundingMode:'nearest'});
 assert.deepEqual(amounts(minimum),[1716,4720,7870,10230]);assert.equal(minimum.marginKrw,3004);
});

test('saved product policies remain authoritative over newly changed workspace flags and options use the confirmed pack arithmetic',()=>{
 const product={pricing_policy:JSON.stringify({...active,integratedRate:275}),exchange_rate:999,supply_margin:90,coupang_margin:90};
 const workspace={...settings.newWorkspaceSettings,useIntegratedRate:true,integratedRate:1000};
 const saved=options.resolveOptionPricePolicy(product,workspace);assert.equal(saved.policySource,'saved-product');assert.equal(saved.policy.integratedRate,275);
 const rows=[{...options.emptyOptionInput('pack'),originalName:'원문 묶음',unitCostCny:10,unitsPerPack:3,included:true},{...options.emptyOptionInput('excluded'),unitCostCny:null,included:false}];
 const result=options.calculateOptionPrices(rows,saved.policy);assert.equal(result[0].sourceCostCny,30);assert.deepEqual(amounts(result[0].calculation),[9405,9405,9405,9405]);assert.equal(result[1].calculation,null);assert.equal(result[1].error,null);
 const old=options.resolveOptionPricePolicy({...product,pricing_policy:JSON.stringify({...base,exchangeRate:200})},workspace);assert.equal(Object.hasOwn(old.policy,'useIntegratedRate'),false);assert.equal(options.calculateOptionPrices(rows,old.policy)[0].calculation.costKrw,6000);
});

test('recorded bundle quantity selection still uses the normal rate before integrated pack purchase cost is applied',()=>{
 const bundle=load('app/bundle-policy.ts'),criterion={bundleCriterion:'supplyMargin',bundleMinimumSupplyMargin:3000,bundleMinimumCoupangMargin:3000};
 for(const [rate,cost]of [[1,342],[350,4488],[1000,12210]]){
  const policy={...active,exchangeRate:350,supplyMargin:50,coupangMargin:40,minimumMargin:3000,integratedRate:rate,roundingUnit:10,roundingMode:'nearest'};
  assert.equal(bundle.suggestBundleQuantity(3.6,policy,criterion,100),3);assert.equal(bundle.initialBundleQuantity(3.6,policy,{...criterion,bundleEnabled:true}),3);assert.equal(pricing.calculatePrice(3.6,policy,3).costKrw,cost);
 }
});

test('legacy product fallback stays inactive until an explicit saved policy enables integration, preserving manual quote values and blanks',()=>{
 const product={id:'p',title:'상품',source_url:'https://detail.1688.com/offer/813724060928.html',pricing_policy:null,exchange_rate:200,supply_margin:50,coupang_margin:40,source_price_cny:3.6,supply_price:1440,sale_price:2400,msrp:3120,image_keys:'[]'};
 const workspace={...settings.newWorkspaceSettings,useIntegratedRate:true,integratedRate:350,minimumMarginEnabled:false,minimumMargin:0};
 const policy=options.resolveOptionPricePolicy(product,workspace);assert.equal(policy.policySource,'product-and-workspace');assert.equal(Object.hasOwn(policy.policy,'useIntegratedRate'),false);assert.equal(Object.hasOwn(policy.policy,'integratedRate'),false);assert.equal(policy.policy.exchangeRate,200);assert.equal(policy.policy.minimumMargin,0);
 const state=options.applyOptionRows(options.emptyProductOptions('p'),[{...options.emptyOptionInput('single'),originalName:'선택',unitCostCny:3.6,included:true},{...options.emptyOptionInput('pack'),originalName:'묶음',unitCostCny:10,unitsPerPack:3,included:true}],'2026-10-07T00:00:00.000Z');
 const content=load('app/product-content.ts').emptyProductContent('p'),overrides={common:{salePrice:'9999'},options:{single:{supplyPrice:'12345',msrp:''}}};
 const legacy=options.calculateOptionPrices(state.rows,policy.policy);assert.deepEqual(amounts(legacy[0].calculation),[720,1440,2400,3120]);assert.deepEqual(amounts(legacy[1].calculation),[6000,12000,20000,26000]);
 const enabled={...product,pricing_policy:JSON.stringify(pricing.pricePolicy({...workspace,exchangeRate:200,minimumMargin:0}))},saved=options.resolveOptionPricePolicy(enabled,workspace);assert.equal(saved.policySource,'saved-product');assert.equal(saved.policy.useIntegratedRate,true);assert.equal(saved.policy.integratedRate,350);
 const before=JSON.stringify({product,enabled,workspace,state,content,overrides});
 const resolved=load('app/quotation-schema.ts').resolveQuotationFields({categoryId:'80719',product:enabled,content,options:state,settings:workspace,overrides});
 const selected=resolved.rows.find(row=>row.optionId==='single');assert.equal(selected.fields.supplyPrice.value,'12345');assert.equal(selected.fields.supplyPrice.source,'manual-option');assert.equal(selected.fields.msrp.value,'');assert.equal(selected.fields.salePrice.value,'9999');assert.equal(resolved.rows.find(row=>row.optionId==='pack').fields.supplyPrice.value,'23760');assert.equal(JSON.stringify({product,enabled,workspace,state,content,overrides}),before);
});

test('invalid integrated inputs and monetary overflow fail before a numeric price can be returned',()=>{
 for(const source of [0,-1,NaN,Infinity])assert.throws(()=>pricing.calculatePrice(source,active));
 for(const qty of [0,-1,1.5,NaN,Number.MAX_SAFE_INTEGER+1])assert.throws(()=>pricing.calculatePrice(1,active,qty));
 assert.throws(()=>pricing.calculatePrice(Number.MAX_VALUE,{...active,integratedRate:Number.MAX_VALUE}));
});
