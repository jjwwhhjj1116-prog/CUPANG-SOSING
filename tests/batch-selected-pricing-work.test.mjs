import test from 'node:test';
import assert from 'node:assert/strict';
import {stageTwoFixture,json,plain} from './helpers/stage-two-pricing.mjs';

async function fixture({prepare,intercept,currentCheck,actualReads=false,beforeMutation}={}){
 const h=await stageTwoFixture(),controller=new AbortController(),calls=[],keys=new Map();
 let receipt=await json(await h.get()),onDispatch;
 if(prepare)receipt=await prepare(h,receipt);
 const original=plain(receipt),saved=h.snapshot();
 const fetcher=async(url,init)=>{
  assert.equal(url,`/api/products/${h.id}/stage-two-pricing`);assert.ok(['GET','POST'].includes(init.method));assert.equal(init.cache,'no-store');
  assert.equal(init.signal,controller.signal);assert.equal(init.credentials,'same-origin');assert.equal(init.redirect,'error');
  if(init.method==='POST'){await beforeMutation?.();onDispatch?.();}calls.push({url,init});
  const response=await intercept?.({receipt,calls,controller,h,init,setReceipt:value=>{receipt=value;}});
  if(response)return response;
  if(init.method==='POST'){receipt=await json(await h.post(JSON.parse(init.body)));}
  else if(actualReads)receipt=await json(await h.get());
  return Response.json(receipt);
 };
 const run=h.load('app/batch-selected-pricing-work.ts').runSelectedPricingWork;
 return{h,controller,calls,keys,original,saved,get receipt(){return receipt;},set receipt(value){receipt=value;},
  run:(controls={})=>run(h.id,{fetcher,signal:controller.signal,assertCurrent:currentCheck,expectedOwnerId:h.owner,keys,
   trackMutationDispatch:mark=>{onDispatch=mark;return()=>{onDispatch=undefined;};},...controls}),close:()=>h.close()};
}

test('selected price work saves an exact durable review through the real guarded POST, rereads it, then skips duplicate saves',async()=>{
 const f=await fixture({actualReads:true});
 try{
  const expected=f.receipt.options.pricing.rows[0].calculation;
  assert.deepEqual([expected.supplyPrice,expected.salePrice,expected.msrp],[4050,6750,8780]);
  const before=f.original,result=await f.run();
  assert.equal(result.status,'complete');assert.equal(result.calculatedOptions,2);assert.equal(result.totalOptions,2);assert.equal(result.uncertain,false);
  assert.match(result.message,/저장·재조회/);assert.deepEqual(f.calls.map(row=>row.init.method),['GET','GET','POST','GET']);assert.equal(f.h.batches,1);assert.equal(f.keys.size,0);
  assert.deepEqual(f.receipt.options.options.rows,before.options.options.rows);assert.deepEqual(f.receipt.quotation.overrides,before.quotation.overrides);assert.deepEqual(f.receipt.options.pricing.rows,before.options.pricing.rows);
  assert.ok(f.receipt.pricingReview);assert.equal(f.receipt.pricingReview.ownerId,f.h.owner);assert.equal(f.receipt.pricingReview.sourceProductVersion,before.product.updated_at);assert.equal(f.receipt.pricingReview.sourceInputFingerprint,before.quotation.inputFingerprint);
  const saved=f.h.snapshot(),again=await f.run();assert.equal(again.status,'complete');assert.match(again.message,/추가 저장 없이/);assert.equal(f.h.batches,1);assert.equal(f.h.snapshot(),saved);assert.equal(f.calls.filter(row=>row.init.method==='POST').length,1);
 }finally{f.close();}
});

test('manual prices, common overrides, exact integrated pack policy and excluded options stay saved unchanged',async()=>{
 const f=await fixture({prepare:async(h,before)=>{
  const body=h.body(before);body.policy={...body.policy,useIntegratedRate:true,integratedRate:290};
  body.rows[0].unitsPerPack=3;body.rows[2].unitCostCny=null;
  body.changes=[{optionId:'row-a',fieldKey:'supplyPrice',value:'7100'},{optionId:null,fieldKey:'msrp',value:'17500'},{optionId:'row-b',fieldKey:'salePrice',value:'8800'}];
  return json(await h.post(body));
 }});
 try{
  assert.deepEqual(['supplyPrice','salePrice','msrp'].map(key=>f.receipt.options.pricing.rows[0].calculation[key]),[6190,10320,13420]);
  assert.equal(f.receipt.quotation.resolved.rows.find(row=>row.optionId==='row-a').fields.supplyPrice.value,'7100');
  const result=await f.run();assert.equal(result.status,'complete');assert.equal(result.calculatedOptions,2);assert.match(result.message,/수동 가격/);
  assert.deepEqual(f.receipt,f.original);assert.equal(f.h.snapshot(),f.saved);assert.equal(f.receipt.options.options.rows[2].unitCostCny,null);
 }finally{f.close();}
});

test('workspace fallback policy is saved without recalculating, changing quantities or introducing manual price overrides',async()=>{
 const f=await fixture({actualReads:true,prepare:async(h)=>{
  h.sqlite.prepare('DELETE FROM product_price_policy WHERE product_id=?').run(h.id);
  return json(await h.get());
 }});
 try{assert.equal(f.receipt.options.pricing.policySource,'product-and-workspace');assert.equal((await f.run()).status,'complete');assert.equal(f.receipt.options.pricing.policySource,'saved-product');
  assert.deepEqual(f.receipt.options.pricing.policy,f.original.options.pricing.policy);assert.deepEqual(f.receipt.options.options.rows,f.original.options.options.rows);assert.deepEqual(f.receipt.quotation.overrides,f.original.quotation.overrides);}
 finally{f.close();}
});

test('new unreviewed rows use actual member settings, persist automatic prices without manual overrides, and project complete on the board',async()=>{
 const f=await fixture({actualReads:true,prepare:async(h)=>{
  h.sqlite.prepare('DELETE FROM product_price_policy WHERE product_id=?').run(h.id);
  const settings={...h.load('app/workspace-settings.ts').newWorkspaceSettings,exchangeRate:320,supplyMargin:45,coupangMargin:35,minimumMargin:4500,msrpMultiple:1.6,roundingUnit:100,roundingMode:'up'};
  await h.load('db/queries.ts').saveSettings(h.owner,JSON.stringify(settings));
  await h.load('db/queries.ts').saveSettings('unrelated-owner',JSON.stringify({...settings,minimumMargin:9000}));
  h.sqlite.prepare('UPDATE products SET exchange_rate=?,supply_margin=?,coupang_margin=? WHERE id=?').run(320,45,35,h.id);
  const schema=h.load('app/quotation-schema.ts').getQuotationSchema('80719'),profile=await h.load('db/category-profiles.ts').createCategoryProfile(h.owner,{name:'LOCAL NEW PRODUCT CATEGORY',categoryId:'80719',categoryPath:schema.categoryPath,template:null,mappings:[]},'new-product-price-category');
  const captured={category:profile,company:h.company,capturedAt:h.product.updated_at,features:'synthetic source only'};
  h.sqlite.prepare('INSERT INTO collection_jobs VALUES(?,?,?,?,?,?,?,?)').run('new-price-job',h.owner,'761000000001',h.product.source_url,'price','awaiting_connector',h.product.updated_at,h.product.updated_at);
  h.sqlite.prepare('INSERT INTO collection_context VALUES(?,?)').run('new-price-job',JSON.stringify(captured));h.sqlite.prepare('INSERT INTO collection_products VALUES(?,?,?,?)').run('new-price-job',h.owner,h.id,h.product.updated_at);
  return json(await h.get());
 }});
 try{
  const expected={exchangeRate:320,supplyMargin:45,coupangMargin:35,minimumMargin:4500,msrpMultiple:1.6,roundingUnit:100,bundleEnabled:false,bundleCriterion:'supplyMargin',bundleMinimumSupplyMargin:3000,bundleMinimumCoupangMargin:3000};
  assert.deepEqual(f.receipt.options.pricing.policy,expected);assert.equal(f.receipt.pricingReview,null);
  assert.deepEqual(f.receipt.quotation.overrides,{common:{},options:{}});
  assert.deepEqual(['supplyPrice','salePrice','msrp'].map(key=>f.receipt.options.pricing.rows[0].calculation[key]),[5500,8500,13600]);
  const before=await f.h.load('db/product-content.ts').readRegistrationSummaries(f.h.owner,[f.receipt.product]);assert.equal(before[f.h.id].stages.pricing.state,'pending');
  assert.equal((await f.run()).status,'complete');assert.equal(f.h.batches,1);assert.deepEqual(f.receipt.options.pricing.policy,expected);
  const request=JSON.parse(f.calls.find(call=>call.init.method==='POST').init.body);assert.deepEqual(request.policy,expected);assert.equal(request.recalculate,false);assert.deepEqual(request.changes,[]);
  assert.deepEqual(f.receipt.quotation.overrides,{common:{},options:{}});assert.deepEqual([f.receipt.product.supply_price,f.receipt.product.sale_price,f.receipt.product.msrp],[5500,8500,13600]);
  const after=await f.h.load('db/product-content.ts').readRegistrationSummaries(f.h.owner,[f.receipt.product]);assert.equal(after[f.h.id].stages.pricing.state,'complete');
 }finally{f.close();}
});

test('wrong product, policy, calculation, manual precedence, missing/duplicate options and unsupported wire mapping are blocked',async()=>{
 const changes={
  product:r=>{r.product.id='foreign-product';},owner:r=>{r.product.owner_id='foreign-owner';},policy:r=>{r.options.pricing.policy.exchangeRate++;},
  calculation:r=>{r.options.pricing.rows[0].calculation.salePrice++;},
  override:r=>{r.quotation.overrides.options['row-a']={salePrice:''};},
  source:r=>{r.quotation.resolved.rows.find(row=>row.optionId==='row-a').fields.salePrice.source='manual-option';},
  missing:r=>{r.quotation.automatic.rows.splice(1,1);},
  duplicate:r=>{r.options.options.rows[1].id='row-a';},
  wire:r=>{for(const quote of [r.quotation.resolved,r.quotation.automatic])quote.schema.fields.push({...quote.schema.fields.find(field=>field.id==='salePrice'),id:'wrong-wire',hubInput:'msrp',hubWire:{path:['productPage','commonAttributes','coupangSalePrice']}});},
 };
 for(const [mode,change] of Object.entries(changes)){
  const f=await fixture();try{change(f.receipt);const result=await f.run();assert.ok(['blocked','failed'].includes(result.status),mode);assert.equal(result.calculatedOptions,0);assert.equal(result.uncertain,false);assert.equal(f.calls.length,1);assert.equal(f.h.snapshot(),f.saved);}
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
 try{const running=held.run();await new Promise(resolve=>setImmediate(resolve));assert.equal(held.calls.length,0);release();assert.equal((await running).status,'complete');}finally{held.close();}
 const denied=await fixture({currentCheck:async()=>{throw Error('account denied');}});
 try{assert.equal((await denied.run()).status,'blocked');assert.equal(denied.calls.length,0);}finally{denied.close();}
 let allowed=true;const mid=await fixture({currentCheck:async()=>{if(!allowed)throw Error('account changed');},intercept(){allowed=false;}});
 try{assert.equal((await mid.run()).status,'blocked');assert.equal(mid.calls.length,1);}finally{mid.close();}
 const aborted=await fixture();try{aborted.controller.abort();assert.equal((await aborted.run()).status,'blocked');assert.equal(aborted.calls.length,0);}finally{aborted.close();}
 const html=await fixture({intercept(){return new Response('<html>login</html>');}});
 try{assert.equal((await html.run()).status,'failed');assert.equal(html.calls.length,1);}finally{html.close();}
});

test('manual blank final prices and stale MSRP markers stay unchanged and block review before POST',async()=>{
 for(const mode of ['blank','stale-msrp']){
  const f=await fixture();try{
   if(mode==='blank'){
    f.receipt.quotation.overrides.options['row-a']={supplyPrice:''};const row=f.receipt.quotation.resolved.rows.find(row=>row.optionId==='row-a');row.fields.supplyPrice.value='';row.fields.supplyPrice.source='manual-option';
   }else{
    f.receipt.quotation.overrides.options['row-a']={salePrice:'9990',msrp:'10000'};const row=f.receipt.quotation.resolved.rows.find(row=>row.optionId==='row-a');for(const field of ['salePrice','msrp']){row.fields[field].value=f.receipt.quotation.overrides.options['row-a'][field];row.fields[field].source='manual-option';}
    f.receipt.quotation.stageTwoMsrp={'row-a':{fields:['msrp'],value:'10000'}};
   }
   const original=plain(f.receipt),result=await f.run();assert.equal(result.status,'blocked');assert.equal(result.uncertain,false);assert.equal(f.calls.filter(call=>call.init.method==='POST').length,0);assert.equal(f.keys.size,0);assert.deepEqual(f.receipt,original);assert.equal(f.h.snapshot(),f.saved);
  }finally{f.close();}
 }
});

test('a proven preflight rejection sends no POST and releases the unsent fence for a later explicit run',async()=>{
 let reject=true;const f=await fixture({actualReads:true,beforeMutation(){if(reject)throw Error('protected account preflight denied');}});
 try{
  const stopped=await f.run();assert.equal(stopped.status,'blocked');assert.equal(stopped.uncertain,false);assert.match(stopped.message,/요청을 보내지 않았습니다/);
  assert.equal(f.keys.size,0);assert.equal(f.h.batches,0);assert.deepEqual(f.calls.map(call=>call.init.method),['GET','GET']);assert.equal(f.h.snapshot(),f.saved);
  reject=false;assert.equal((await f.run()).status,'complete');assert.equal(f.h.batches,1);assert.equal(f.calls.filter(call=>call.init.method==='POST').length,1);
 }finally{f.close();}
});

test('a lost POST ACK is proved by one read and never resent, including a later explicit retry after a failed recovery read',async()=>{
 for(const delayed of [false,true]){
  let readsAfterPost=0,posted=false,allowRecovery=!delayed;
  const f=await fixture({actualReads:true,async intercept({h,init,setReceipt}){
   if(init.method==='POST'){const saved=await json(await h.post(JSON.parse(init.body)));setReceipt(saved);posted=true;throw Error('ACK lost');}
   if(posted){readsAfterPost++;if(!allowRecovery)throw Error('recovery read offline');}
  }});
  try{
   const first=await f.run();assert.equal(first.status,delayed?'blocked':'complete');assert.equal(first.uncertain,delayed);assert.equal(f.h.batches,1);assert.equal(f.calls.filter(call=>call.init.method==='POST').length,1);
   if(delayed){assert.equal(f.keys.size,1);allowRecovery=true;const retry=await f.run();assert.equal(retry.status,'complete');assert.equal(retry.uncertain,false);assert.equal(f.calls.filter(call=>call.init.method==='POST').length,1);assert.equal(f.keys.size,0);}
   assert.equal(readsAfterPost,delayed?2:1);
  }finally{f.close();}
 }
});

test('a changed current price commit cannot satisfy the original unknown save or trigger an automatic retry',async()=>{
 let posted=false,allowRead=false;
 const f=await fixture({actualReads:true,async intercept({h,init,setReceipt}){
  if(init.method==='POST'){setReceipt(await json(await h.post(JSON.parse(init.body))));posted=true;throw Error('original ACK lost');}
  if(posted&&!allowRead)throw Error('read unavailable');
 }});
 try{
  assert.equal((await f.run()).uncertain,true);const original=await json(await f.h.get()),changed=f.h.body(original);changed.rows[0].unitCostCny=6.99;
  await json(await f.h.post(changed));const saved=f.h.snapshot();allowRead=true;
  const stopped=await f.run();assert.equal(stopped.status,'blocked');assert.equal(stopped.uncertain,true);assert.equal(f.calls.filter(call=>call.init.method==='POST').length,1);assert.equal(f.h.batches,2);assert.equal(f.h.snapshot(),saved);assert.equal(f.keys.size,1);
 }finally{f.close();}
});

test('server CAS conflicts preserve the competing product change and never retry the price POST',async()=>{
 const f=await fixture({actualReads:true});try{
  f.h.before(()=>f.h.sqlite.prepare('UPDATE products SET title=? WHERE id=?').run('competing edit',f.h.id));
  const failed=await f.run();assert.equal(failed.status,'blocked');assert.equal(failed.uncertain,true);assert.equal(f.h.batches,1);assert.equal(f.keys.size,1);
  assert.equal(f.h.sqlite.prepare('SELECT title FROM products WHERE id=?').get(f.h.id).title,'competing edit');
  const before=f.h.snapshot();await f.run();assert.equal(f.calls.filter(call=>call.init.method==='POST').length,1);assert.equal(f.h.snapshot(),before);
 }finally{f.close();}
});

test('an uncommitted unknown POST and changed saved values cannot be automatically resent or rebound to another owner',async()=>{
 const f=await fixture({intercept({init}){if(init.method==='POST')throw Error('transport outcome unknown');}});
 try{
  assert.equal((await f.run()).uncertain,true);assert.equal(f.keys.size,1);assert.equal(f.h.batches,0);const posts=()=>f.calls.filter(call=>call.init.method==='POST').length;
  assert.equal(posts(),1);assert.equal((await f.run()).uncertain,true);assert.equal(posts(),1);
  const retained=[...f.keys.values()][0],key=[...f.keys.keys()][0],foreign=JSON.parse(retained);foreign.ownerId='another-owner';f.keys.set(key,JSON.stringify(foreign));
  const stopped=await f.run();assert.equal(stopped.uncertain,true);assert.equal(stopped.status,'blocked');assert.equal(posts(),1);assert.equal(f.h.snapshot(),f.saved);
 }finally{f.close();}
});
