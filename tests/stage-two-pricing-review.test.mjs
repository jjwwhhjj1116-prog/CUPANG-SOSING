import test from 'node:test';
import assert from 'node:assert/strict';
import {providedOptionModule as load} from './helpers/provided-option-quotation.mjs';
const {createStageTwoPricingReview:create,matchesStageTwoPricingReview:matches}=load('app/stage-two-pricing-review.ts');
const {emptyOptionInput,emptyProductOptions,applyOptionRows}=load('app/product-options.ts');
const before='2026-10-20T00:00:00.000Z',saved='2026-10-20T00:00:00.001Z',later='2026-10-21T00:00:00.000Z';
const plain=value=>JSON.parse(JSON.stringify(value));
function input(){
 const fields=['supplyPrice','salePrice','msrp'].flatMap(id=>[{id,section:'product',label:id,type:'number',required:false,visibility:'common',integer:true,min:1,max:Number.MAX_SAFE_INTEGER},
  {id:'wire-'+id,section:'product',label:id,type:'text',numericText:true,required:false,visibility:'common',hubInput:id,hubWire:{path:['productPage','commonAttributes',{supplyPrice:'purchasePrice',salePrice:'coupangSalePrice',msrp:'msrp'}[id]]}}]);
 const rows=[{...emptyOptionInput('one'),originalName:'원문',unitCostCny:0.28,included:true},{...emptyOptionInput('excluded'),originalName:'제외',included:false}];
 return {ownerId:'owner',product:{id:'product',source_price_cny:0.28,updated_at:saved},
  policy:{exchangeRate:310,supplyMargin:50,coupangMargin:45,minimumMargin:3000,msrpMultiple:1.3,roundingUnit:10,roundingMode:'nearest',arithmeticMode:'couplus-number-v1',useIntegratedRate:true,integratedRate:300,recalculationMinimumEnabled:true},
  options:applyOptionRows(emptyProductOptions('product'),rows,saved),state:{schemaVersion:1,productId:'product',revision:1,updatedAt:saved,overrides:{common:{},options:{}}},
  schema:{version:1,categoryId:'80719',categoryPath:['시험','가격'],status:'observed',evidence:'synthetic',fields,submissionReady:false},profileId:'profile',company:{code:'A01526306',name:'유앤채'},sourceInputFingerprint:'a'.repeat(64),sourceProductVersion:before,savedAt:saved};
}
test('a no-dirty explicit review seals current configuration without inventing a recalculation mode or changing saved inputs',()=>{
 const value=input(),snapshot=JSON.stringify(value),receipt=create(value);assert.equal(receipt.productVersion,saved);assert.equal(receipt.sourceProductVersion,before);assert.equal(receipt.companyCode,'A01526306');assert.equal(matches(receipt,value),true);assert.equal(JSON.stringify(value),snapshot);assert.equal(Object.hasOwn(value.policy,'recalculationMode'),false);
 const reordered=plain(value);reordered.policy=Object.fromEntries(Object.entries(reordered.policy).reverse());assert.equal(matches(receipt,reordered),true,'canonical object key order has no semantic meaning');
});
test('matching survives unrelated title, image, document revision and clock changes while preserving reviewed manual prices and blank optional MSRP',()=>{
 const value=input();value.state.categoryOverrides={'category:80719':{common:{supplyPrice:'5000','wire-supplyPrice':'5000',salePrice:'9000','wire-salePrice':'9000',msrp:'','wire-msrp':''},options:{}}};
 const receipt=create(value),laterInput=plain(value);laterInput.product.updated_at=later;laterInput.product.title='다른 상품명';laterInput.options.revision++;laterInput.options.rows[0].translatedName='다른 옵션명';laterInput.options.rows[0].imageKey='owner/changed.png';laterInput.state.revision++;laterInput.state.updatedAt=later;laterInput.state.categoryOverrides['category:80719'].common.title='다른 제목';laterInput.state.categoryOverrides['category:80719'].common.mainImage='owner/changed.png';
 assert.equal(matches(receipt,laterInput),true);assert.equal(JSON.parse(receipt.configuration).bindings[0].values.find(value=>value.input==='supplyPrice').cells[0].value,'5000');
});
test('every price configuration or authentic scope change invalidates the saved review',()=>{
 const value=input(),receipt=create(value),changes=[
  next=>next.ownerId='another',next=>next.product.id='another',next=>next.product.source_price_cny=0.29,next=>next.policy.exchangeRate=311,
  next=>next.options.rows[0].unitCostCny=0.29,next=>next.options.rows[0].unitsPerPack=3,next=>next.options.rows[1].included=true,
  next=>next.options.rows.reverse(),next=>next.schema.categoryId='81221',next=>next.schema.categoryPath=['변경'],next=>next.profileId='another',
  next=>next.company.code='A01464742',next=>next.company.name='다른 회사',next=>next.schema.fields[0].max=100000,
  next=>next.sourceInputFingerprint='b'.repeat(64),next=>next.sourceProductVersion='2026-10-19T00:00:00.000Z',next=>next.savedAt=later,
  next=>next.state.categoryOverrides={'category:80719':{common:{salePrice:'9000','wire-salePrice':'9000'},options:{}}},
 ];
 for(const change of changes){const next=plain(value);change(next);assert.equal(matches(receipt,next),false,String(change));}
});
test('malformed or incomplete current prices cannot create or match a review',()=>{
 for(const change of [next=>next.options.rows.forEach(row=>{row.included=false;}),next=>next.options.rows[0].unitCostCny=null,next=>next.options.rows[0].unitsPerPack=0,
  next=>next.state.categoryOverrides={'category:80719':{common:{salePrice:'','wire-salePrice':''},options:{}}},
  next=>next.state.categoryOverrides={'category:80719':{common:{supplyPrice:'5000','wire-supplyPrice':'5100'},options:{}}},
  next=>next.state.categoryOverrides={'category:80719':{common:{salePrice:'9000.5','wire-salePrice':'9000.5'},options:{}}},
  next=>next.schema.fields[1].min=50000,next=>next.options.rows.push(plain(next.options.rows[0]))]){
  const good=input(),receipt=create(good),bad=plain(good);change(bad);assert.throws(()=>create(bad));assert.equal(matches(receipt,bad),false);
 }
});
test('receipt source proof and monotonic saved version are required, while optional known company and profile scopes are enforced',()=>{
 const value=input(),receipt=create(value);
 for(const change of [next=>delete next.sourceInputFingerprint,next=>next.sourceInputFingerprint='bad',next=>delete next.sourceProductVersion,next=>next.sourceProductVersion=saved,next=>next.savedAt=before]){const next=plain(value);change(next);assert.throws(()=>create(next));}
 for(const change of [next=>next.productVersion=later,next=>next.sourceInputFingerprint='bad',next=>next.ownerId='another',next=>next.companyName=undefined,next=>next.configuration+=' ',next=>next.extra=true]){const next=plain(receipt);change(next);assert.equal(matches(next,value),false);}
 const unknown=plain(value);delete unknown.profileId;delete unknown.company;assert.equal(matches(receipt,unknown),true,'unknown optional scopes do not fabricate a different known identity');
});
