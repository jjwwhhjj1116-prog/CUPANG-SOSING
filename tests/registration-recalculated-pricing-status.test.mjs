import test from 'node:test';
import assert from 'node:assert/strict';
import {mobileIntakeHarness} from './helpers/mobile-intake.mjs';
const json=async response=>{assert.equal(response.status,200,await response.clone().text());return response.json();};
const companies=[{companyCode:'A01526306',companyName:'유앤채'},{companyCode:'A01464742',companyName:'와이홉'}];

for(const company of companies)test(company.companyCode+': saved Stage2 recalculation completes pricing after clearing overrides and survives unrelated edits',async()=>{
 const h=mobileIntakeHarness(company);
 try{
  await h.intake();const product=h.sqlite.prepare('SELECT * FROM products').get(),base='/api/products/'+product.id;
  const read=async()=>{const response=await json(await h.load('app/api/products/route.ts').GET());return response.products.find(row=>row.id===product.id);};
  assert.equal((await read()).content_summary.stages.pricing.state,'pending','initial automatic prices are unreviewed');
  let receipt=await json(await h.route(base+'/stage-two-pricing'));
  const policy=h.load('app/pricing.ts').pricePolicy({...receipt.options.pricing.policy,recalculationMode:'couplus-stage-two-v1'});
  const rows=h.load('app/stage-two-pricing.ts').recalculateStageTwoRows(h.load('app/product-options.ts').optionInputs(receipt.options.options),policy);
  receipt=await json(await h.route(base+'/stage-two-pricing',{method:'POST',body:{expectedProductVersion:receipt.product.updated_at,expectedOptionRevision:receipt.options.options.revision,expectedQuotationRevision:receipt.quotation.revision,expectedInputFingerprint:receipt.quotation.inputFingerprint,policy,rows,changes:[],recalculate:true}}));
  assert.equal(receipt.options.pricing.policy.recalculationMode,'couplus-stage-two-v1');
  const targets=h.load('app/quotation-price-targets.ts').quotationPriceTargets(receipt.quotation.resolved.schema.fields);
  for(const input of ['supplyPrice','salePrice'])for(const field of targets[input].linked){assert.equal(Object.hasOwn(receipt.quotation.overrides.common,field),false);for(const values of Object.values(receipt.quotation.overrides.options))assert.equal(Object.hasOwn(values,field),false);}
  const before=JSON.stringify(['products','product_options','product_quotation_fields','product_price_policy'].map(table=>h.sqlite.prepare('SELECT * FROM '+table).all()));
  assert.equal((await read()).content_summary.stages.pricing.state,'complete');
  assert.equal((await json(await h.route(base+'/content'))).registrationStages.pricing.state,'complete');
  assert.equal(JSON.stringify(['products','product_options','product_quotation_fields','product_price_policy'].map(table=>h.sqlite.prepare('SELECT * FROM '+table).all())),before,'status reads never repair or rewrite saved values');
  const content=(await json(await h.route(base+'/content'))).content;
  await json(await h.route(base+'/content',{method:'PATCH',body:{expectedRevision:content.revision,patch:{seo:{title:'상태 검증용 저장 상품명'}}}}));
  assert.equal((await read()).content_summary.stages.pricing.state,'complete','unrelated saved title does not discard pricing intent');
  let quote=await json(await h.route(base+'/quotation-fields'));
  const first=quote.resolved.rows.find(row=>row.optionId),keys=JSON.parse((await read()).image_keys);
  const imageTarget=h.load('app/quotation-seo-targets.ts').exactPrimaryQuotationTarget(quote.resolved.schema.fields,'mainImage');
  await json(await h.route(base+'/quotation-fields',{method:'PUT',body:{expectedRevision:quote.revision,expectedInputFingerprint:quote.inputFingerprint,changes:imageTarget.linked.map(fieldKey=>({fieldKey,optionId:first.optionId,value:keys[0]}))}}));
  assert.equal((await read()).content_summary.stages.pricing.state,'complete','a later quotation image save does not require matching clocks');
  quote=await json(await h.route(base+'/quotation-fields'));
  await json(await h.route(base+'/quotation-fields',{method:'PUT',body:{expectedRevision:quote.revision,expectedInputFingerprint:quote.inputFingerprint,changes:targets.salePrice.linked.map(fieldKey=>({fieldKey,optionId:first.optionId,value:''}))}}));
  assert.equal((await read()).content_summary.stages.pricing.state,'pending','blank final saved prices cannot remain complete');
 }finally{h.close();}
});

test('recalculation intent cannot hide invalid current option costs, inconsistent product policy, or no included options',async()=>{
 const h=mobileIntakeHarness();
 try{
  await h.intake();const product=h.sqlite.prepare('SELECT * FROM products').get(),base='/api/products/'+product.id,initial=await json(await h.route(base+'/stage-two-pricing'));
  const policy=h.load('app/pricing.ts').pricePolicy({...initial.options.pricing.policy,recalculationMode:'couplus-stage-two-v1'});
  await json(await h.route(base+'/stage-two-pricing',{method:'POST',body:{expectedProductVersion:initial.product.updated_at,expectedOptionRevision:initial.options.options.revision,expectedQuotationRevision:initial.quotation.revision,expectedInputFingerprint:initial.quotation.inputFingerprint,policy,rows:h.load('app/product-options.ts').optionInputs(initial.options.options),changes:[],recalculate:true}}));
  const read=async()=>{const current=await h.load('db/queries.ts').findProduct('owner',product.id);return(await h.load('db/product-content.ts').readRegistrationSummaries('owner',[current]))[product.id].stages.pricing.state;};
  assert.equal(await read(),'complete');
  const option=h.sqlite.prepare('SELECT payload FROM product_options WHERE product_id=?').get(product.id).payload;
  for(const invalid of ['cost','inclusion']){const changed=JSON.parse(option);if(invalid==='cost')changed.rows.find(row=>row.included).unitCostCny=null;else changed.rows.forEach(row=>{row.included=false;});h.sqlite.prepare('UPDATE product_options SET payload=? WHERE product_id=?').run(JSON.stringify(changed),product.id);assert.equal(await read(),'pending',invalid);h.sqlite.prepare('UPDATE product_options SET payload=? WHERE product_id=?').run(option,product.id);}
  const savedPolicy=h.sqlite.prepare('SELECT payload FROM product_price_policy WHERE product_id=?').get(product.id).payload;
  h.sqlite.prepare('UPDATE product_price_policy SET payload=? WHERE product_id=?').run(JSON.stringify({...JSON.parse(savedPolicy),exchangeRate:999}),product.id);assert.equal(await read(),'pending','policy must agree with the saved product totals');
 }finally{h.close();}
});
