import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
function load(file){const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../'+file,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,require:name=>load(name.slice(2)+'.ts')});return exports;}
const bundle=load('app/bundle-policy.ts'),settings=load('app/workspace-settings.ts'),pricing=load('app/pricing.ts'),options=load('app/product-options.ts'),tools=load('app/option-editor-tools.ts');
const policy={exchangeRate:350,supplyMargin:50,coupangMargin:40,minimumMargin:3000,msrpMultiple:1.3,roundingUnit:10,roundingMode:'nearest'};
const rule={bundleCriterion:'supplyMargin',bundleMinimumSupplyMargin:3000,bundleMinimumCoupangMargin:3000};

test('recorded selector keeps initial fixed-100 and explicit editor rounding separate from final prices',()=>{
 assert.equal(bundle.initialBundleQuantity(0.36,policy,{bundleEnabled:true,...rule}),19);
 assert.equal(bundle.suggestBundleQuantity(0.36,policy,rule),21);
 for(const cny of [3.6,5.5])assert.equal(bundle.initialBundleQuantity(cny,policy,{bundleEnabled:true,...rule}),3);
 const selected=bundle.suggestBundleQuantity(3.6,{...policy,minimumMargin:50000,roundingMode:'up'},{...rule,bundleMinimumSupplyMargin:4000});
 assert.equal(selected,5,'minimum guarantee does not replace the bundle threshold');
 assert.equal(bundle.suggestBundleQuantity(3.6,policy,{...rule,bundleCriterion:'coupangMargin',bundleMinimumSupplyMargin:50000}),3,'criterion uses its own threshold');
 assert.equal(bundle.suggestBundleQuantity(3.6,policy,{...rule,bundleMinimumSupplyMargin:1000}),1);
 assert.equal(bundle.suggestBundleQuantity(0.01,policy,rule),21,'bounded odd increment is preserved even if the threshold is not reached');
 assert.equal(pricing.calculatePrice(0.36,policy,19).supplyPrice,5390,'actual bundled price still uses saved 10-won rounding and minimum guarantee');
 assert.equal(pricing.calculatePrice(3.6,policy,3).supplyPrice,7560);
});

test('off, incomplete legacy settings and unrelated box quantity do not create automatic packs',()=>{
 for(const stored of [{bundleEnabled:false,...rule},{bundleEnabled:true},{...settings.defaultSettings,bundleEnabled:true},{bundleEnabled:true,bundleCriterion:null,bundleMinimumSupplyMargin:null,bundleMinimumCoupangMargin:null,boxSkuQuantity:50}])assert.equal(bundle.initialBundleQuantity(3.6,policy,stored),1);
 assert.equal(bundle.initialBundleQuantity(3.6,policy,{...rule,bundleEnabled:true,boxSkuQuantity:50}),3);
 for(const bad of [{...rule,bundleCriterion:'other'},{...rule,bundleMinimumSupplyMargin:null},{...rule,bundleMinimumCoupangMargin:999},{...rule,bundleMinimumSupplyMargin:Infinity}])assert.throws(()=>bundle.bundlePolicy(bad));
});

test('explicit automatic preview preserves row facts and blanks, invalidates changed packaging and stays cancellable',()=>{
 const rows=[{...options.emptyOptionInput('a'),originalName:'원문',translatedName:'',supplierSku:'sku-a',stock:20,minimumOrderQuantity:50,unitCostCny:3.6,included:true,packagedWeightG:100,packagedWidthMm:50,packagedLengthMm:40,packagedHeightMm:30,packagingConfirmed:true}, {...options.emptyOptionInput('b'),unitCostCny:5.5,unitsPerPack:2,included:false}];
 const before=JSON.stringify(rows),preview=tools.previewOptionBulk(rows,['a'],{type:'autoBundle',value:rule},policy);
 assert.equal(JSON.stringify(rows),before);assert.equal(preview.rows[0].unitsPerPack,3);assert.equal(preview.rows[1].unitsPerPack,2);
 for(const key of ['id','originalName','translatedName','supplierSku','stock','minimumOrderQuantity','imageKey','packagedWeightG','packagedWidthMm','packagedLengthMm','packagedHeightMm'])assert.equal(preview.rows[0][key],rows[0][key],key);
 assert.equal(preview.rows[0].packagingConfirmed,false);assert.equal(preview.changes[0].afterPrice,7560);
 assert.throws(()=>tools.applyOptionBulk(rows,preview,{...policy,roundingUnit:100}),/가격 정책/);
 assert.throws(()=>tools.applyOptionBulk([{...rows[0],translatedName:'수동 수정'},rows[1]],preview,policy),/옵션이 바뀌었/);
 const applied=tools.applyOptionBulk(rows,preview,policy);assert.equal(applied[0].unitsPerPack,3);assert.equal(JSON.stringify(rows),before);
 const unchanged=tools.previewOptionBulk([{...rows[0],unitsPerPack:3}],['a'],{type:'autoBundle',value:rule},policy);
 assert.equal(unchanged.rows[0].packagingConfirmed,true);
 assert.throws(()=>tools.previewOptionBulk([{...rows[0],unitCostCny:null}],['a'],{type:'autoBundle',value:rule},policy),/원가/);
});
