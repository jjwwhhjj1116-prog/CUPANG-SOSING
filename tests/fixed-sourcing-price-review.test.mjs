import test from 'node:test';
import assert from 'node:assert/strict';
import {stageTwoFixture,json,plain} from './helpers/stage-two-pricing.mjs';
const fixed=(policy,referenceCny=2.99,salePrice=9800,supplyPrice=5390,purchaseCost=2499)=>({...policy,useIntegratedRate:true,integratedRate:290,fixedSourcing:{version:1,referenceCny,salePrice,supplyPrice,purchaseCost,sourceUnitsPerPack:1}});
test('P2-A actual CNY save then fixed-base save keeps calculated prices automatic and pending real edits exact',async()=>{
 const h=await stageTwoFixture();try{
  let before=await json(await h.get()),request=h.body(before);request.policy=fixed(request.policy);let saved=await json(await h.post(request));
  const helper=h.load('app/stage-two-option-recalculation.ts').recalculateStageTwoOptionCost,row=saved.options.options.rows.find(row=>row.id==='row-a');
  const pending=[{optionId:'row-b',fieldKey:'msrp',value:''},{optionId:'row-b',fieldKey:'supplyPrice',value:null}],plan=helper(row,4,saved.options.pricing.policy,saved.quotation,pending);
  assert.deepEqual(plain(plan.changes),pending);request=h.body(saved);request.rows=request.rows.map(row=>row.id==='row-a'?{...row,unitCostCny:4}:row);request.changes=plain(plan.changes);request.recalculate=true;saved=await json(await h.post(request));
  assert.equal(saved.quotation.resolved.rows.find(row=>row.optionId==='row-a').fields.salePrice.source,'pricing');
  request=h.body(saved);request.policy.fixedSourcing={...request.policy.fixedSourcing,salePrice:10000,supplyPrice:5500};request.recalculate=true;before=saved;saved=await json(await h.post(request));
  const final=saved.quotation.resolved.rows.find(row=>row.optionId==='row-a').fields.salePrice;assert.equal(final.value,'13380');assert.equal(final.source,'pricing');assert.equal(saved.quotation.overrides.options['row-b'].msrp,'');
  h.load('app/stage-two-pricing.ts').verifyStageTwoPricingReceipt(before.options,before.quotation,request,saved);
 }finally{h.close();}
});
test('P2-B actual atomic product/receipt uses fixed reference3.63 while raw original3.82 remains and real options uplift',async()=>{
 const h=await stageTwoFixture();try{
  h.sqlite.prepare('UPDATE products SET source_price_cny=? WHERE id=?').run(3.82,h.id);const before=await json(await h.get()),request=h.body(before);request.policy={...fixed(request.policy,3.63,8600,4730,2126),coupangMargin:45};request.rows=request.rows.map(row=>({...row,unitCostCny:row.id==='row-a'?3.63:4}));
  const saved=await json(await h.post(request));assert.equal(saved.product.source_price_cny,3.82);assert.equal(saved.product.sale_price,8600);assert.equal(saved.product.supply_price,4730);assert.equal(saved.product.msrp,11180);assert.equal(saved.options.pricing.rows[0].calculation.salePrice,8600);assert.ok(saved.options.pricing.rows[1].calculation.salePrice>8600);
  h.load('app/stage-two-pricing.ts').verifyStageTwoPricingReceipt(before.options,before.quotation,request,saved);assert.deepEqual(await json(await h.get()),saved);
  const pricing=h.load('app/pricing.ts');assert.equal(pricing.calculateRepresentativePrice(3.82,request.policy).salePrice,8600);assert.deepEqual(plain(pricing.calculateRepresentativePrice(3.82,h.policy)),plain(pricing.calculatePrice(3.82,h.policy)));
 }finally{h.close();}
});
