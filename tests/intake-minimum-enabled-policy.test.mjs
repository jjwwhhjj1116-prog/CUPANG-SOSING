import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {mobileIntakeHarness} from './helpers/mobile-intake.mjs';
import {companies,plain,json,zeroMinimumUI} from './helpers/pricing-stage-two-zero-minimum.mjs';

const traces=[];
test.after(()=>fs.writeFileSync(new URL('../outputs/step716-minimum-policy-proof.json',import.meta.url),JSON.stringify({format:'step716-initial-minimum-switch-v1',traces,
 boundary:'Synthetic source, membership and company/category fixtures; actual import/settings/product/pricing routes and isolated SQLite; no external source, Hub, or existing working product writes.'},null,2)+'\n'));
const prices=product=>[product.supply_price,product.sale_price,product.msrp];
const initialPrices=integrated=>integrated?[17560,29270,38050]:[17920,29870,38830];
const recalcPrices=(integrated,enabled)=>enabled?(integrated?[8780,14630,19020]:[8960,14930,19410]):initialPrices(integrated);
const settings=(h,integrated,enabled)=>({...h.settings,minimumMarginEnabled:enabled,minimumMargin:0,...(integrated?{useIntegratedRate:true,integratedRate:300}:{useIntegratedRate:false,integratedRate:null})});

for(const company of companies)for(const integrated of [false,true])for(const enabled of [false,true])test(`new source draft carries its minimum switch into price review (${company.code}, integrated=${integrated}, enabled=${enabled})`,async()=>{
 const h=mobileIntakeHarness({companyCode:company.code,companyName:company.name});
 try{
  const sourceUrl='https://detail.1688.com/offer/90000000716.html';
  h.context.settings=settings(h,integrated,enabled);
  h.sqlite.prepare('UPDATE collection_jobs SET offer_id=?,source_url=?').run('90000000716',sourceUrl);
  h.sqlite.prepare('UPDATE collection_context SET payload=?').run(JSON.stringify(h.context));
  await h.load('db/queries.ts').saveSettings('owner',JSON.stringify(h.context.settings));
  await json(await h.route('/api/collection-jobs/job/result',{method:'POST',body:{schemaVersion:1,sourceUrl,provider:'synthetic-local-716',collectedAt:new Date().toISOString(),title:'本地价格选项',description:'本地测试',attributes:[],
   options:[{sku:'LOCAL716',name:'本地选项',unitPriceCny:25.6,minimumOrder:1,stock:2}],images:[]}}));
  const created=await json(await h.route('/api/collection-jobs/job/product',{method:'POST'})),id=created.productId;
  const read=()=>h.load('db/queries.ts').findProduct('owner',id),before=await read(),policy=JSON.parse(before.pricing_policy);
  const raw=h.sqlite.prepare('SELECT payload FROM collection_results').get().payload;
  const immutable=()=>JSON.stringify(['collection_results','collection_context','workspace_settings','product_options','product_content'].map(table=>[table,h.sqlite.prepare('SELECT * FROM '+table+' ORDER BY rowid').all()]));
  const immutableBefore=immutable();
  assert.equal(policy.minimumMargin,0);assert.equal(policy.recalculationMinimumEnabled,enabled);assert.equal(Object.hasOwn(policy,'recalculationMode'),false);
  assert.equal(h.load('app/pricing.ts').priceMinimumMarginEnabled(policy),enabled);assert.deepEqual(prices(before),initialPrices(integrated));
  const legacy={...policy};delete legacy.recalculationMinimumEnabled;
  assert.equal(Object.hasOwn(h.load('app/pricing.ts').pricePolicy(legacy),'recalculationMinimumEnabled'),false,'legacy policies are not migrated on read');
  const previous={...before,id:'protected-existing-716',source_url:'synthetic://protected-716'};
  await h.load('db/queries.ts').insertProduct(previous,legacy);
  const protectedState=()=>JSON.stringify(h.sqlite.prepare('SELECT * FROM products WHERE id=?').get(previous.id))+JSON.stringify(h.sqlite.prepare('SELECT * FROM product_price_policy WHERE product_id=?').get(previous.id));
  const protectedBefore=protectedState();let saved;
  const ui=zeroMinimumUI({initial:plain(policy),sourcePrice:25.6,onSave:async next=>{
   saved=plain(next);await json(await h.route('/api/products/'+id+'/pricing',{method:'POST',body:{policy:next,expectedVersion:before.updated_at,recalculate:true}}));
  }});
  assert.equal(ui.field('최소 공급 마진 보장').props.checked,enabled);assert.equal(ui.field('최소 공급 마진 (원)')?.props.value,enabled?0:undefined);
  assert.equal(ui.writes,0);assert.deepEqual(prices(await read()),initialPrices(integrated));
  ui.button('일괄 재계산').props.onClick();assert.equal(ui.writes,0);assert.deepEqual(prices(await read()),initialPrices(integrated));
  await ui.submit();assert.equal(ui.writes,1);assert.equal(saved.recalculationMinimumEnabled,enabled);
  const after=await read(),reopened=zeroMinimumUI({initial:JSON.parse(after.pricing_policy),sourcePrice:25.6});
  assert.equal(reopened.field('최소 공급 마진 보장').props.checked,enabled);assert.deepEqual(prices(after),recalcPrices(integrated,enabled));
  assert.equal(immutable(),immutableBefore);assert.equal(protectedState(),protectedBefore);assert.equal(h.sqlite.prepare('SELECT payload FROM collection_results').get().payload,raw);
  assert.equal(h.network.length,0);assert.equal(after.supplier_hub_status,'미전송');
  traces.push({kind:'intake',company,integrated,enabled,sourceSha256:createHash('sha256').update(raw).digest('hex'),initialPrices:prices(before),reviewedPrices:prices(after),switchPreserved:true,legacyUnchanged:true,protectedProductPreserved:true,externalRequests:0,hubWrites:0});
 }finally{h.close();}
});

for(const integrated of [false,true])for(const enabled of [false,true])test(`manual new-product route also retains zero minimum selection (integrated=${integrated}, enabled=${enabled})`,async()=>{
 const h=mobileIntakeHarness();
 try{
  const stored=settings(h,integrated,enabled);await h.load('db/queries.ts').saveSettings('owner',JSON.stringify(stored));
  const route=h.load('app/api/products/route.ts'),post=body=>route.POST(new Request('https://app.test/api/products',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({sourceUrl:'https://detail.1688.com/offer/90000000716.html',sourcePriceCny:25.6,...body})}));
  const {product}=await json(await post({}),201),policy=JSON.parse(product.pricing_policy);
  assert.equal(policy.recalculationMinimumEnabled,enabled);assert.equal(policy.minimumMargin,0);assert.deepEqual(prices(product),initialPrices(integrated));
  const snapshot=JSON.stringify(h.sqlite.prepare('SELECT * FROM products').all());
  await json(await post({minimumMargin:-1,minimumMarginEnabled:false}),400);assert.equal(JSON.stringify(h.sqlite.prepare('SELECT * FROM products').all()),snapshot);
  assert.equal(h.network.length,0);
  traces.push({kind:'manual-create',integrated,enabled,initialPrices:prices(product),switchPreserved:true,invalidInputStillRejected:true,externalRequests:0,hubWrites:0});
 }finally{h.close();}
});
