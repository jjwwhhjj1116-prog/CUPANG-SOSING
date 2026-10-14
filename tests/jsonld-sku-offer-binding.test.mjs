import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {parseProductJsonLd} from '../extensions/supplier-hub/product-jsonld.mjs';
import {mobileIntakeHarness} from './helpers/mobile-intake.mjs';

// Complete local-only contracts. The inaccessible user offer is never read,
// requested or represented as a collected receipt by these synthetic fixtures.
const offerId='651000000001',sourceUrl=`https://detail.1688.com/offer/${offerId}.html`,skuId='000651000000010',foreignSku='000651000000099';
const mobile=JSON.parse(fs.readFileSync(new URL('./fixtures/1688-mobile-813724060928.json',import.meta.url),'utf8'));
const image=Object.values(mobile.data).find(value=>value?.data?.offerImgList).data.offerImgList[0];
const companies=[{code:'A01526306',name:'유앤채'},{code:'A01464742',name:'와이홉'}];
const product=()=>({'@type':'ProductGroup',url:sourceUrl,name:'本地合成单层运动护膝',description:'本地合成商品说明',image:[image],hasVariant:[{'@type':'Product',name:'黑色单层',sku:skuId,color:'黑色单层',image,
 offers:{'@type':'Offer',sku:skuId,price:'2.99',priceCurrency:'CNY',eligibleQuantity:{minValue:3},inventoryLevel:{'@type':'QuantitativeValue',value:0}}}]});
const html=value=>`<script type="application/ld+json">${JSON.stringify(value)}</script>`;
const json=async response=>{assert.ok(response.ok,await response.clone().text());return response.json();};

test('a different Offer SKU cannot supply the price of one inline, referenced or non-variant product',()=>{
 for(const kind of ['inline','local-reference','non-variant']){
  const p=product();p.hasVariant[0].offers.sku=foreignSku;let nodes=[p];
  if(kind==='local-reference'){const offer=p.hasVariant[0].offers;p.hasVariant[0].offers={'@id':'#offer'};nodes=[p,{'@id':'#offer',...offer}];}
  if(kind==='non-variant'){const variant=p.hasVariant[0];delete p.hasVariant;nodes=[{...p,sku:variant.sku,color:variant.color,offers:variant.offers}];}
  const before=JSON.stringify(nodes);assert.throws(()=>parseProductJsonLd(nodes,sourceUrl),/SKU.*일치/);assert.equal(JSON.stringify(nodes),before);
 }
});

test('either explicit SKU or matching trimmed strings preserve leading zeroes without inventing a SKU',()=>{
 for(const kind of ['both','variant-only','offer-only','trimmed']){
  const p=product(),variant=p.hasVariant[0];
  if(kind==='variant-only')delete variant.offers.sku;
  if(kind==='offer-only')delete variant.sku;
  if(kind==='trimmed'){variant.sku=' '+skuId+' ';variant.offers.sku='\t'+skuId+'\n';}
  const before=JSON.stringify(p),result=parseProductJsonLd([p],sourceUrl);
  assert.equal(result.options.length,1);assert.equal(result.options[0].sku.trim(),skuId);assert.equal(result.options[0].name,'黑色单层');assert.equal(result.options[0].unitPriceCny,2.99);assert.equal(result.options[0].minimumOrder,3);assert.equal(result.options[0].stock,0);assert.equal(JSON.stringify(p),before);
 }
 const missing=product();delete missing.hasVariant[0].sku;delete missing.hasVariant[0].offers.sku;assert.throws(()=>parseProductJsonLd([missing],sourceUrl),/SKU/);
});

test('an explicit invalid or case-different Offer SKU cannot be silently ignored when the variant has a SKU',()=>{
 for(const value of ['', ' ',null,651000000010,{},'ABC']){
  const p=product();p.hasVariant[0].offers.sku=value;assert.throws(()=>parseProductJsonLd([p],sourceUrl),/SKU/);
 }
 const p=product();p.hasVariant[0].sku='abc';p.hasVariant[0].offers.sku='ABC';assert.throws(()=>parseProductJsonLd([p],sourceUrl),/SKU.*일치/);
});

test('one conflicting variant rejects the complete receipt rather than importing a partial set of prices',()=>{
 const p=product();p.hasVariant.push({...structuredClone(p.hasVariant[0]),sku:'000651000000011',name:'另一个选项'});p.hasVariant[1].offers.sku=foreignSku;
 assert.throws(()=>parseProductJsonLd([p],sourceUrl),/SKU.*일치/);
 const spec=product(),offer=spec.hasVariant[0].offers;offer.sku=foreignSku;delete offer.price;offer.priceSpecification={'@type':'PriceSpecification',price:'2.99',priceCurrency:'CNY'};
 assert.throws(()=>parseProductJsonLd([spec],sourceUrl),/SKU.*일치/);
});

async function setup(company,p){
 const calls=[],h=mobileIntakeHarness({companyCode:company.code,companyName:company.name,sourceFetcher:async target=>{
  const url=new URL(target);calls.push(url.href);assert.ok(!url.href.includes('1012144591864'),'the denied offer must never be requested, even by a local transport fixture');
  if(url.hostname==='detail.1688.com'){assert.equal(url.href,sourceUrl);return new Response(html(p),{headers:{'content-type':'text/html'}});}
  if(url.hostname==='m.1688.com')return new Response('<html>No mobile fixture</html>',{headers:{'content-type':'text/html'}});
  assert.equal(url.hostname,'h5api.m.1688.com');return Response.json({ret:['FAIL_SYS_PRODUCT_NOT_FOUND::local-only']});
 }});
 h.sqlite.prepare('UPDATE collection_jobs SET offer_id=?,source_url=?,goal=?').run(offerId,sourceUrl,'work');
 h.context.keywords='';h.sqlite.prepare('UPDATE collection_context SET payload=?').run(JSON.stringify(h.context));
 h.bindings.AI.run=async(_model,input)=>{const source=JSON.parse(input.messages[1].content);h.aiSources.push(source);return{response:{title:'단층 운동 무릎 보호대',description:'로컬 합성 상품 설명',keywords:['무릎 보호대'],warnings:[],attributes:source.attributes.map((pair,sourceIndex)=>({sourceIndex,name:pair.name,value:'검정 단층'}))}};};
 return{h,calls,close:()=>h.close()};
}

for(const company of companies)test(`actual source handler refuses a mismatched one-SKU price and valid intake preserves reviewed fields (${company.code})`,async()=>{
 const wrong=product();wrong.hasVariant[0].offers.sku=foreignSku;const rejected=await setup(company,wrong);
 try{
  const before=rejected.h.sqlite.prepare('SELECT * FROM collection_jobs').get(),context=rejected.h.sqlite.prepare('SELECT payload FROM collection_context').get().payload;
  const response=await rejected.h.route('/api/collection-jobs/job/collect',{method:'POST'});assert.equal(response.status,422);assert.equal((await response.json()).code,'SOURCE_NOT_COLLECTED');
  for(const table of ['collection_results','collection_products','products','product_options','product_content','translation_jobs','supplier_hub_receipts'])assert.equal(rejected.h.sqlite.prepare('SELECT count(*) n FROM '+table).get().n,0,table);
  assert.deepEqual(rejected.h.sqlite.prepare('SELECT * FROM collection_jobs').get(),before);assert.equal(rejected.h.sqlite.prepare('SELECT payload FROM collection_context').get().payload,context);assert.equal(rejected.h.objects.size,0);assert.equal(rejected.h.aiSources.length,0);
 }finally{rejected.close();}

 const f=await setup(company,product()),h=f.h;try{
  assert.match(await h.intake(),/상품 초안 저장됨/);const stored=h.sqlite.prepare('SELECT * FROM products').get(),base='/api/products/'+stored.id,source=await h.load('db/collection-results.ts').readCollectionResult('owner','job');
  assert.equal(source.result.provider,'public-product-jsonld-v1');assert.equal(source.result.options.length,1);assert.equal(source.result.options[0].sku,skuId);assert.equal(source.result.options[0].unitPriceCny,2.99);assert.equal(source.result.options[0].minimumOrder,3);assert.equal(source.result.options[0].stock,0);
  const content=(await json(await h.route(base+'/content'))).content,options=(await json(await h.route(base+'/options'))).options,row=options.rows[0];
  assert.equal(options.rows.length,1);assert.equal(row.supplierSku,skuId);assert.equal(row.originalName,'黑色单层');assert.equal(row.translatedName,'검정 단층');assert.equal(row.unitCostCny,2.99);assert.equal(row.minimumOrderQuantity,3);assert.equal(row.stock,0);assert.equal(row.provenance.unitCostCny,'collected');assert.equal(content.label.importer.value,company.name);
  const quote=await json(await h.route(base+'/quotation-fields')),q=quote.resolved.rows.find(value=>value.optionId===row.id);assert.deepEqual(['supplyPrice','salePrice','msrp'].map(field=>q.fields[field].value),['4050','6750','8780']);assert.ok(q.fields.mainImage.value);assert.equal(stored.options_count,1);assert.equal(stored.supplier_hub_status,'미전송');
  const raw=JSON.stringify(source),files=JSON.stringify([...h.objects].map(([key,bytes])=>[key,Buffer.from(bytes).toString('base64')]));
  await json(await h.route(base+'/content',{method:'PATCH',body:{expectedRevision:content.revision,patch:{seo:{title:'직접 검토한 상품명',description:''},label:{material:'직접 확인한 재질'},assets:{additional:[]}}}}));
  const current=await json(await h.route(base+'/options')),inputs=h.load('app/product-options.ts').optionInputs(current.options);inputs[0].translatedName='';inputs[0].color='직접 검정';
  await json(await h.route(base+'/options',{method:'PATCH',body:{expectedRevision:current.options.revision,expectedProductVersion:current.productVersion,rows:inputs}}));
  const snapshot=()=>JSON.stringify(Object.fromEntries(['products','product_content','product_options','product_price_policy','collection_context','collection_results','translation_jobs'].map(table=>[table,h.sqlite.prepare('SELECT * FROM '+table).all()]))),saved=snapshot(),network=h.network.length,generations=h.aiSources.length;
  await h.intake();assert.equal(snapshot(),saved);assert.equal(h.network.length,network);assert.equal(h.aiSources.length,generations);assert.equal(JSON.stringify(await h.load('db/collection-results.ts').readCollectionResult('owner','job')),raw);assert.equal(JSON.stringify([...h.objects].map(([key,bytes])=>[key,Buffer.from(bytes).toString('base64')])),files);
  const latest=(await json(await h.route(base+'/options'))).options.rows[0],final=await json(await h.route(base+'/quotation-fields')),finalRow=final.resolved.rows.find(value=>value.optionId===row.id);assert.equal(latest.translatedName,'');assert.equal(latest.color,'직접 검정');assert.equal(finalRow.fields.title.value,'직접 검토한 상품명');assert.equal(finalRow.fields.noticeMaterial.value,'직접 확인한 재질');assert.equal(finalRow.fields.additionalImages.value,'');assert.equal(h.sqlite.prepare('SELECT count(*) n FROM supplier_hub_receipts').get().n,0);
  assert.ok(f.calls.every(url=>!url.includes('1012144591864')));assert.ok(!h.network.includes('supplier.coupang.com'));
 }finally{f.close();}
});
