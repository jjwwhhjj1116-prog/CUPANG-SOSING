import test from 'node:test';
import assert from 'node:assert/strict';
import {load,observed,plain,zeroMinimumUI,componentUI,nodes,text} from './helpers/pricing-stage-two-zero-minimum.mjs';
import {providedOptionFixture,resolveProvidedOption} from './helpers/provided-option-quotation.mjs';
import {optionPriceTableUI,priceTableCompanies,priceTableNodes} from './helpers/option-price-table-ui.mjs';

const arithmeticMode='couplus-number-v1',recalculationMode='couplus-stage-two-v1';
const pricing=load('app/pricing.ts'),model=load('app/product-options.ts'),tools=load('app/option-editor-tools.ts');

test('new URL collection policy carries recorded Number arithmetic into category quotation and export while legacy stays unchanged',()=>{
 const settings={...load('app/workspace-settings.ts').newWorkspaceSettings,bundleEnabled:false};
 const now='2026-10-19T00:00:00.000Z',url='https://detail.1688.com/offer/90000000733.html';
 const job={id:'local-733',offer_id:'90000000733',source_url:url,goal:'work',status:'awaiting_connector',created_at:now,updated_at:now,
  context:{category:{id:'cat',categoryId:'80719',categoryPath:['주방용품','주방수납/정리','주방수납바구니/바스켓']},settings,capturedAt:now}};
 const receipt={schemaVersion:1,offerId:job.offer_id,sourceUrl:url,provider:'isolated-fixture',collectedAt:now,title:'合成商品',description:'',images:[],
  options:[{sku:'local-733',name:'合成选项',unitPriceCny:8.95,minimumOrder:1,stock:null}]};
 const before=JSON.stringify([job,receipt]),prepared=load('app/collection-product.ts').prepareCollectionProduct('local-owner',job,receipt,'local-product',now);
 assert.equal(prepared.policy.arithmeticMode,arithmeticMode);assert.equal(prepared.policy.roundingMode,'nearest');assert.equal(prepared.product.supply_price,6260);
 const product={...prepared.product,pricing_policy:JSON.stringify(prepared.policy)};
 for(const categoryId of ['80719','81452']){
  const input={categoryId,product,content:prepared.content,options:prepared.options,settings:{...settings,exchangeRate:900}};
  const resolved=load('app/quotation-schema.ts').resolveQuotationFields(input),row=resolved.rows.find(row=>row.optionId);
  assert.equal(row.fields.supplyPrice.value,'6260');
  const exported=load('app/exports/quotation-fields.ts').resolvedQuotationRows(input,resolved,[]);
  assert.equal(exported[0].supplyPrice,6260);
 }
 const off=load('app/collection-product.ts').prepareCollectionProduct('local-owner',{...job,context:{...job.context,settings:{...settings,minimumMarginEnabled:false}}},
  {...receipt,options:[{...receipt.options[0],unitPriceCny:0.35}]},'local-low',now);
 assert.equal(off.product.supply_price,240);assert.equal(off.policy.arithmeticMode,arithmeticMode);
 const historical=pricing.pricePolicy(observed),saved=JSON.stringify(historical);
 assert.equal(pricing.calculatePrice(8.95,historical).supplyPrice,6270);assert.equal(model.resolveOptionPricePolicy({...product,pricing_policy:saved},settings).policy.arithmeticMode,undefined);
 assert.equal(JSON.stringify(historical),saved);assert.equal(JSON.stringify([job,receipt]),before);
 const up=load('app/collection-product.ts').prepareCollectionProduct('local-owner',{...job,context:{...job.context,settings:{...settings,roundingMode:'up'}}},receipt,'local-up',now);
 assert.equal(up.policy.arithmeticMode,undefined);assert.equal(up.product.supply_price,6270);
});

test('settings preview matches new draft Number rounding without writing or changing settings',()=>{
 const settings={...load('app/workspace-settings.ts').newWorkspaceSettings,bundleEnabled:false},before=JSON.stringify(settings);
 const ui=componentUI('app/components/settings-price-preview.tsx','SettingsPricePreview',{props:{settings,disabled:false}});
 const cost=()=>nodes(ui.render()).find(node=>node.type==='input');
 cost().props.onChange({target:{value:'8.95'}});assert.match(text(ui.render()),/6,260원/);
 ui.update({settings:{...settings,minimumMarginEnabled:false}});cost().props.onChange({target:{value:'0.35'}});assert.match(text(ui.render()),/240원/);
 ui.update({settings:{...settings,roundingMode:'up'}});cost().props.onChange({target:{value:'8.95'}});assert.match(text(ui.render()),/6,270원/);
 assert.equal(JSON.stringify(settings),before);
});

test('historical Stage2 policy is promoted only by explicit recalculate and saves the mode with its review',async()=>{
 const legacy={...observed,recalculationMode},before=JSON.stringify(legacy),saved=[];
 const ui=zeroMinimumUI({sourcePrice:32.3,initial:legacy,onSave:async policy=>saved.push(plain(policy))});
 assert.equal(ui.policy().arithmeticMode,undefined);assert.match(text(ui.render()),/14,310원/);assert.equal(ui.writes,0);
 ui.button('일괄 재계산').props.onClick();assert.equal(ui.policy().arithmeticMode,arithmeticMode);assert.equal(ui.policy().roundingMode,'nearest');assert.match(text(ui.render()),/14,300원/);
 assert.equal(ui.writes,0);await ui.submit();assert.equal(saved[0].arithmeticMode,arithmeticMode);assert.equal(saved[0].recalculationMode,recalculationMode);
 assert.equal(ui.render().props['data-workspace-dirty'],false);assert.equal(JSON.stringify(legacy),before);
 const ordinary=[];const unchanged=zeroMinimumUI({sourcePrice:32.3,initial:legacy,onSave:async policy=>ordinary.push(plain(policy))});await unchanged.submit();assert.equal(ordinary[0].arithmeticMode,undefined);
 const clean=zeroMinimumUI({sourcePrice:32.3,initial:legacy});clean.update({initial:{...legacy,arithmeticMode}});assert.equal(clean.policy().arithmeticMode,arithmeticMode);assert.match(text(clean.render()),/14,300원/);assert.equal(clean.writes,0);
});

test('option preview identity rejects changed arithmetic but ordinary CNY and quantity edits keep saved arithmetic',()=>{
 const legacy={...observed,recalculationMode},rows=[{...model.emptyOptionInput('local'),originalName:'合成',unitCostCny:16.15,included:true}],before=JSON.stringify([legacy,rows]);
 const ordinary=tools.previewOptionBulk(rows,['local'],{type:'unitsPerPack',value:2},legacy);assert.equal(ordinary.changes[0].afterPrice,14310);
 assert.throws(()=>tools.applyOptionBulk(rows,ordinary,{...legacy,arithmeticMode}),/가격 정책/);
 const sourceEdit=tools.previewOptionBulk(rows,['local'],{type:'unitCostCny',value:32.3},legacy);assert.equal(sourceEdit.changes[0].afterPrice,14310);
 const explicit=tools.previewOptionBulk(rows,['local'],{type:'applyBundle',value:2},{...legacy,roundingMode:'up'});assert.equal(explicit.changes[0].afterPrice,14300);
 assert.equal(JSON.stringify([legacy,rows]),before);
});

test('explicit copied bundle uses Number calculation only for new quoted prices and preserves old saved policy',()=>{
 const fixture=providedOptionFixture({unitCostCny:16.15}),resolved=resolveProvidedOption(fixture).resolved,before=JSON.stringify(fixture);
 const bundles=load('app/option-bundles.ts'),additions=[{sourceOptionId:fixture.options.rows[0].id,optionId:'local-bundle'}];
 const next=bundles.applyBundleAddRows(fixture.options,additions,2,'2026-10-19T00:00:00.000Z');
 const changes=bundles.bundleQuotationChanges({resolved,overrides:{common:{},options:{}},imageKeys:[]},additions,next.rows,{...fixture.policy,roundingMode:'up'});
 assert.equal(changes.find(change=>change.optionId==='local-bundle'&&change.fieldKey==='supplyPrice').value,'14300');
 assert.equal(fixture.policy.arithmeticMode,undefined);assert.equal(JSON.stringify(fixture),before);
});

for(const company of priceTableCompanies)test(`actual selected bundle confirms Number prices in saved quotation without promoting the product policy (${company.code})`,async()=>{
 const h=await optionPriceTableUI(company,{count:2,integrated:true});try{
  const base='/api/products/'+h.product.id,view=await (await h.request(base+'/options')).json(),rows=h.load('app/product-options.ts').optionInputs(view.options);
  rows[0].unitCostCny=32.3;
  const patched=await h.request(base+'/options',{method:'PATCH',body:JSON.stringify({expectedRevision:view.options.revision,expectedProductVersion:view.productVersion,rows})});assert.equal(patched.status,200,await patched.clone().text());
  h.changeProductVersion(h.sqlite.prepare('SELECT updated_at FROM products WHERE id=?').get(h.product.id).updated_at);await h.settle();const before=h.protectedSnapshot();
  h.node('가격 옵션 2 권장소비자가').props.onChange({target:{value:''}});
  h.node('가격 옵션 1 선택').props.onChange({target:{checked:true}});h.button('번들 적용').props.onClick();h.node('적용할 번들 수량').props.onChange({target:{value:'1'}});
  const dialog=priceTableNodes(h.render()).find(node=>node.props?.role==='dialog');priceTableNodes(dialog).find(node=>node.type==='form').props.onSubmit({preventDefault(){}});await h.settle();
  assert.equal(priceTableNodes(h.render()).some(node=>node.props?.role==='dialog'),false);
  const quote=await (await h.request(base+'/quotation-fields')).json();assert.equal(quote.overrides.options['price-001'].supplyPrice,'14300');assert.equal(quote.overrides.options['price-002'].msrp,'');
  assert.equal(quote.resolved.rows.find(row=>row.optionId==='price-001').fields.supplyPrice.value,'14300');
  assert.equal(h.protectedSnapshot(),before);assert.equal(JSON.parse(h.sqlite.prepare('SELECT payload FROM product_price_policy WHERE product_id=?').get(h.product.id).payload).arithmeticMode,undefined);
 }finally{h.close();}
});
