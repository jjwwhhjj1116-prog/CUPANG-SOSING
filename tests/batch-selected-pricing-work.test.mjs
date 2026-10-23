import test from 'node:test';
import assert from 'node:assert/strict';
import {stageTwoFixture,json,plain} from './helpers/stage-two-pricing.mjs';

async function fixture({prepare,intercept,currentCheck}={}){
 const h=await stageTwoFixture(),controller=new AbortController(),calls=[];
 let receipt=await json(await h.get());
 if(prepare)receipt=await prepare(h,receipt);
 const original=plain(receipt),saved=h.snapshot();
 const fetcher=async(url,init)=>{
  assert.equal(url,`/api/products/${h.id}/stage-two-pricing`);assert.equal(init.method,'GET');assert.equal(init.cache,'no-store');
  assert.equal(init.signal,controller.signal);assert.equal(init.credentials,'same-origin');assert.equal(init.redirect,'error');calls.push({url,init});
  const response=await intercept?.({receipt,calls,controller,h});
  return response??Response.json(receipt);
 };
 const run=h.load('app/batch-selected-pricing-work.ts').runSelectedPricingWork;
 return{h,controller,calls,original,saved,get receipt(){return receipt;},set receipt(value){receipt=value;},
  run:(controls={})=>run(h.id,{fetcher,signal:controller.signal,assertCurrent:currentCheck,...controls}),close:()=>h.close()};
}

test('selected price work verifies exact current dynamic prices through the real local GET with no writes and returns draft',async()=>{
 const f=await fixture();
 try{
  const expected=f.receipt.options.pricing.rows[0].calculation;
  assert.deepEqual([expected.supplyPrice,expected.salePrice,expected.msrp],[4050,6750,8780]);
  const result=await f.run({fetcher:async(url,init)=>{f.calls.push({url,init});assert.equal(init.method,'GET');return f.h.get();}});
  assert.equal(result.status,'draft');assert.equal(result.calculatedOptions,2);assert.equal(result.totalOptions,2);assert.equal(result.uncertain,false);
  assert.match(result.message,/별도 가격 저장은 없습니다/);assert.equal(f.calls.length,2);assert.equal(f.h.snapshot(),f.saved);
 }finally{f.close();}
});

test('manual price blanks, common overrides, exact integrated pack policy and excluded options stay saved unchanged',async()=>{
 const f=await fixture({prepare:async(h,before)=>{
  const body=h.body(before);body.policy={...body.policy,useIntegratedRate:true,integratedRate:290};
  body.rows[0].unitsPerPack=3;body.rows[2].unitCostCny=null;
  body.changes=[{optionId:'row-a',fieldKey:'supplyPrice',value:''},{optionId:null,fieldKey:'msrp',value:'17500'},{optionId:'row-b',fieldKey:'salePrice',value:'8800'}];
  return json(await h.post(body));
 }});
 try{
  assert.deepEqual(['supplyPrice','salePrice','msrp'].map(key=>f.receipt.options.pricing.rows[0].calculation[key]),[6190,10320,13420]);
  assert.equal(f.receipt.quotation.resolved.rows.find(row=>row.optionId==='row-a').fields.supplyPrice.value,'');
  const result=await f.run();assert.equal(result.status,'draft');assert.equal(result.calculatedOptions,2);assert.match(result.message,/수동 가격.*공란 포함/);
  assert.deepEqual(f.receipt,f.original);assert.equal(f.h.snapshot(),f.saved);assert.equal(f.receipt.options.options.rows[2].unitCostCny,null);
 }finally{f.close();}
});

test('workspace fallback policy remains dynamic without being pinned to a product policy',async()=>{
 const f=await fixture({prepare:async(h)=>{
  h.sqlite.prepare('DELETE FROM product_price_policy WHERE product_id=?').run(h.id);
  return json(await h.get());
 }});
 try{assert.equal(f.receipt.options.pricing.policySource,'product-and-workspace');assert.equal((await f.run()).status,'draft');assert.equal(f.h.snapshot(),f.saved);}
 finally{f.close();}
});

test('wrong product, policy, calculation, manual precedence, missing/duplicate options and unsupported wire mapping are blocked',async()=>{
 const changes={
  product:r=>{r.product.id='foreign-product';},policy:r=>{r.options.pricing.policy.exchangeRate++;},
  calculation:r=>{r.options.pricing.rows[0].calculation.salePrice++;},
  override:r=>{r.quotation.overrides.options['row-a']={salePrice:''};},
  source:r=>{r.quotation.resolved.rows.find(row=>row.optionId==='row-a').fields.salePrice.source='manual-option';},
  missing:r=>{r.quotation.automatic.rows.splice(1,1);},
  duplicate:r=>{r.options.options.rows[1].id='row-a';},
  wire:r=>{for(const quote of [r.quotation.resolved,r.quotation.automatic])quote.schema.fields.push({...quote.schema.fields.find(field=>field.id==='salePrice'),id:'wrong-wire',hubInput:'msrp',hubWire:{path:['productPage','commonAttributes','coupangSalePrice']}});},
 };
 for(const [mode,change] of Object.entries(changes)){
  const f=await fixture();try{change(f.receipt);const result=await f.run();assert.notEqual(result.status,'draft',mode);assert.equal(result.calculatedOptions,0);assert.equal(result.uncertain,false);assert.equal(f.calls.length,1);assert.equal(f.h.snapshot(),f.saved);}
  finally{f.close();}
 }
});

test('no included options or missing included cost is blocked without a representative product-price fallback',async()=>{
 for(const mode of ['excluded','cost']){
  const f=await fixture();try{
   if(mode==='excluded')f.receipt.options.options.rows.forEach(row=>row.included=false);
   else{f.receipt.options.options.rows[0].unitCostCny=null;f.receipt.options.pricing.rows=plain(f.h.load('app/product-options.ts').calculateOptionPrices(f.receipt.options.options.rows,f.receipt.options.pricing.policy));}
   const result=await f.run();assert.equal(result.status,'blocked');assert.equal(result.calculatedOptions,0);assert.equal(f.calls.length,1);assert.equal(f.h.snapshot(),f.saved);
  }finally{f.close();}
 }
});

test('a changed second read, abort, pending or denied async account proof and malformed responses never report completion',async()=>{
 const changed=await fixture({intercept({receipt,calls}){if(calls.length===2){const body=plain(receipt);body.quotation.inputFingerprint='f'.repeat(64);return Response.json(body);}}});
 try{assert.equal((await changed.run()).status,'blocked');assert.equal(changed.calls.length,2);}finally{changed.close();}
 let release;const wait=new Promise(resolve=>{release=resolve;}),held=await fixture({currentCheck:()=>wait});
 try{const running=held.run();await new Promise(resolve=>setImmediate(resolve));assert.equal(held.calls.length,0);release();assert.equal((await running).status,'draft');}finally{held.close();}
 const denied=await fixture({currentCheck:async()=>{throw Error('account denied');}});
 try{assert.equal((await denied.run()).status,'blocked');assert.equal(denied.calls.length,0);}finally{denied.close();}
 let allowed=true;const mid=await fixture({currentCheck:async()=>{if(!allowed)throw Error('account changed');},intercept(){allowed=false;}});
 try{assert.equal((await mid.run()).status,'blocked');assert.equal(mid.calls.length,1);}finally{mid.close();}
 const aborted=await fixture();try{aborted.controller.abort();assert.equal((await aborted.run()).status,'blocked');assert.equal(aborted.calls.length,0);}finally{aborted.close();}
 const html=await fixture({intercept(){return new Response('<html>login</html>');}});
 try{assert.equal((await html.run()).status,'failed');assert.equal(html.calls.length,1);}finally{html.close();}
});
