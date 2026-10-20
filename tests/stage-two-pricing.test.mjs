import test from 'node:test';
import assert from 'node:assert/strict';
import {providedOptionModule as load} from './helpers/provided-option-quotation.mjs';
const {pricePolicy,calculatePrice}=load('app/pricing.ts'),{recalculateStageTwoRows,applyStageTwoRows}=load('app/stage-two-pricing.ts');
const {emptyOptionInput,emptyProductOptions,applyOptionRows,optionInputs,calculateOptionPrices}=load('app/product-options.ts');
const plain=value=>JSON.parse(JSON.stringify(value)),policy={exchangeRate:350,supplyMargin:50,coupangMargin:40,minimumMargin:3000,msrpMultiple:1.3,roundingUnit:10,roundingMode:'nearest',arithmeticMode:'couplus-number-v1',recalculationMode:'couplus-stage-two-v1',recalculationMinimumEnabled:true};
const enabled={...policy,bundleEnabled:true,bundleCriterion:'supplyMargin',bundleMinimumSupplyMargin:3000,bundleMinimumCoupangMargin:3000};

test('optional product bundle settings preserve legacy price policy bytes and reject partial or malformed rules',()=>{
 assert.equal(JSON.stringify(pricePolicy(policy)),JSON.stringify(policy));
 for(const legacy of [{...load('app/workspace-settings.ts').defaultSettings},{...load('app/workspace-settings.ts').defaultSettings,bundleEnabled:true}]){const parsed=pricePolicy(legacy);assert.equal(Object.hasOwn(parsed,'bundleEnabled'),false,'legacy null criteria never activate a quantity rule');}
 assert.deepEqual(plain(pricePolicy(enabled)),enabled);
 for(const invalid of [{...policy,bundleEnabled:true},{...enabled,bundleEnabled:1},{...enabled,bundleCriterion:'other'},{...enabled,bundleMinimumSupplyMargin:999},{...enabled,bundleMinimumCoupangMargin:NaN},{...enabled,bundleMinimumSupplyMargin:1.1},{...enabled,bundleMinimumSupplyMargin:Number.MAX_SAFE_INTEGER+1}])assert.throws(()=>pricePolicy(invalid));
});
test('automatic bundle chooses ordinary-rate quantity before final integrated pack pricing without mutating source facts',()=>{
 const row={...emptyOptionInput('a'),originalName:'原文',unitCostCny:0.36,unitsPerPack:1,included:true,stock:100,minimumOrderQuantity:4,packagedWeightG:20,packagingConfirmed:true},before=JSON.stringify(row);
 const ordinary=recalculateStageTwoRows([row],enabled),integratedPolicy={...enabled,useIntegratedRate:true,integratedRate:300},integrated=recalculateStageTwoRows([row],integratedPolicy);
 assert.equal(ordinary[0].unitsPerPack,21);assert.equal(integrated[0].unitsPerPack,21,'stage-two selector uses ordinary exchange rate and selected 10 KRW unit, not initial-worker 100 KRW or integrated landed fees');assert.equal(integrated[0].packagingConfirmed,false);assert.equal(JSON.stringify(row),before);
 for(const key of ['stock','minimumOrderQuantity','unitCostCny','originalName','packagedWeightG'])assert.equal(integrated[0][key],row[key]);
 assert.deepEqual(plain(calculateOptionPrices(integrated,integratedPolicy)[0].calculation),plain(calculatePrice(row.unitCostCny,integratedPolicy,21)));
});
test('off, absent and excluded bundle rules preserve reviewed quantities and confirmation flags',()=>{
 const row={...emptyOptionInput('a'),originalName:'A',unitCostCny:0.36,unitsPerPack:5,included:true,packagingConfirmed:true};
 for(const current of [policy,{...enabled,bundleEnabled:false}])assert.deepEqual(plain(recalculateStageTwoRows([row],current)),[row]);
 assert.deepEqual(plain(recalculateStageTwoRows([{...row,included:false}],enabled)),[{...row,included:false}]);
 const chosen=recalculateStageTwoRows([row],enabled)[0];assert.equal(chosen.packagingConfirmed,false);assert.equal(recalculateStageTwoRows([chosen],enabled)[0].packagingConfirmed,false);
});
test('applying reviewed rows retains unrelated provenance and bundle lineage; changed count does not reconfirm old packaging',()=>{
 const now='2026-10-20T00:00:00.000Z',next='2026-10-20T00:00:01.000Z',input=['a','b'].map(id=>({...emptyOptionInput(id),originalName:id,unitCostCny:2.99,included:true,packagedWeightG:20,packagingConfirmed:true}));
 const saved=applyOptionRows(emptyProductOptions('synthetic'),input,now);saved.bundleSources={b:{sourceOptionId:'a',quantity:3}};
 const rows=optionInputs(saved);rows[0].unitsPerPack=5;rows[0].packagingConfirmed=false;const result=applyStageTwoRows(saved,rows,next);
 assert.deepEqual(plain(result.rows[1]),plain(saved.rows[1]));assert.deepEqual(plain(result.bundleSources),plain(saved.bundleSources));assert.equal(result.rows[0].packagingUnitsPerPack,1);assert.equal(result.rows[0].provenance.unitsPerPack,'manual');assert.equal(result.rows[0].provenance.packagedWeightG,saved.rows[0].provenance.packagedWeightG);
});
