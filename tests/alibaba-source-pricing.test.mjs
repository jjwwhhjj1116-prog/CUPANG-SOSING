import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';
import * as parse5 from 'parse5';
import {webcrypto} from 'node:crypto';
import {mobileIntakeHarness} from './helpers/mobile-intake.mjs';
import {parseProductJsonLd} from '../extensions/supplier-hub/product-jsonld.mjs';
const cache=new Map(),plain=value=>JSON.parse(JSON.stringify(value));
function load(file){
 if(cache.has(file))return cache.get(file);const exports={};cache.set(file,exports);
 vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../'+file,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,
  {exports,Error,URL,Date,TextEncoder,structuredClone,crypto:webcrypto,fetch(){throw Error('static pricing fixtures must not access a provider');},require(name){if(name==='parse5')return parse5;if(name==='@/extensions/supplier-hub/product-jsonld.mjs')return {parseProductJsonLd};if(name.startsWith('.'))return load(path.posix.join(path.posix.dirname(file),name)+'.ts');if(name.startsWith('@/'))return load(name.slice(2)+'.ts');throw Error(name);}});return exports;
}
const parse=load('app/alibaba-product-result.ts').parseAlibabaProduct;
const validate=load('app/collection-result.ts').validateCollectionResult;
const url='https://detail.1688.com/offer/813724060928.html';
const raw=receipt=>{const {offerId,...body}=receipt;assert.equal(offerId,'813724060928');return plain(body);};
// Synthetic OpenAPI fixtures exercise the retained static processOptions
// contract (current source slice SHA 4a567138…e3f0), not a live API result.
function fixture(costs=['25.6','25.6'],base='5.23'){
 return {result:{success:true,result:{offerId:'813724060928',subject:'原文商品',minOrderQuantity:'2',description:'',productImage:{images:['https://cbu01.alicdn.com/main.jpg']},
  productSaleInfo:{priceRangeList:[{startQuantity:100,price:base},{startQuantity:1,price:'0.01'}]},
  productSkuInfos:costs.map((cost,index)=>({skuId:String(5627721589407+index),consignPrice:cost,amountOnSale:'0',skuAttributes:[{value:index?'白色':'黑色'}]}))}}};
}
const costs=receipt=>Array.from(receipt.options,item=>item.unitPriceCny);

test('uniform source SKU prices use the original first base row and retain the displaced original prices',()=>{
 const source=fixture(),before=JSON.stringify(source),receipt=parse(source,url);
 assert.deepEqual(costs(receipt),[5.23,5.23]);assert.equal(receipt.priceBasis.selection,'uniform-first-base');
 assert.equal(receipt.priceBasis.firstBasePriceCny,5.23);assert.equal(receipt.priceBasis.rule,'couplus-all-skus-uniform-first-row-v1');
 assert.deepEqual(Array.from(receipt.priceBasis.skuPrices,item=>[item.sku,item.source,item.unitPriceCny]),[['5627721589407','consign-price',25.6],['5627721589408','consign-price',25.6]]);
 assert.deepEqual(plain(validate(raw(receipt),receipt.offerId)),plain(receipt));assert.equal(JSON.stringify(source),before);
 const single=fixture(['28']);assert.deepEqual(costs(parse(single,url)),[5.23],'one SKU is also a uniform complete source');
});

test('mixed prices stay per SKU, ignoring base/minimum/tier ordering and misleading explicit price siblings',()=>{
 const source=fixture(['25.6','28'],'4');source.result.result.productSkuInfos.forEach(sku=>sku.price='999');
 const receipt=parse(source,url);assert.deepEqual(costs(receipt),[25.6,28]);assert.equal(receipt.priceBasis.selection,'mixed-sku');
 assert.equal(receipt.priceBasis.firstBasePriceCny,4);assert.deepEqual(Array.from(receipt.priceBasis.skuPrices,item=>item.unitPriceCny),[25.6,28]);
 assert.deepEqual(plain(validate(raw(receipt),receipt.offerId)),plain(receipt));
});

test('fenxiao preferred prices determine uniformity and preserve each chosen source kind',()=>{
 const source=fixture(['99','25.6']);source.result.result.productSkuInfos[0].fenxiaoPriceInfo={offerPrice:'25.6'};
 const receipt=parse(source,url);assert.deepEqual(costs(receipt),[5.23,5.23]);
 assert.deepEqual(Array.from(receipt.priceBasis.skuPrices,item=>[item.source,item.unitPriceCny]),[['fenxiao-offer-price',25.6],['consign-price',25.6]]);
 source.result.result.productSkuInfos[1].fenxiaoPriceInfo={offerPrice:28};assert.deepEqual(costs(parse(source,url)),[25.6,28]);
});

test('source truthiness permits only the recorded missing/empty/numeric-zero fallback and rejects bad chosen prices',()=>{
 for(const offerPrice of [undefined,null,0,'']){
  const source=fixture(['25.6','28']);source.result.result.productSkuInfos[0].fenxiaoPriceInfo={offerPrice};
  const receipt=parse(source,url);assert.deepEqual(costs(receipt),[25.6,28]);assert.equal(receipt.priceBasis.skuPrices[0].source,'consign-price');
 }
 for(const offerPrice of ['0','bad',' ',false,true,[],{},-1,Infinity,'25.6junk']){
  const source=fixture(['25.6','28']);source.result.result.productSkuInfos[0].fenxiaoPriceInfo={offerPrice};
  if(offerPrice===false){assert.deepEqual(costs(parse(source,url)),[25.6,28]);continue;}
  assert.throws(()=>parse(source,url),/원가/);
 }
});

test('partial consignment shape, invalid first row, wrong offer and duplicate SKUs never fall back to explicit sku.price',()=>{
 for(const mutate of [p=>delete p.productSaleInfo,p=>p.productSaleInfo.priceRangeList=[],p=>p.productSaleInfo.priceRangeList[0]=null,
  p=>delete p.productSaleInfo.priceRangeList[0].price,p=>p.productSaleInfo.priceRangeList[0].price='0',p=>p.productSaleInfo.priceRangeList[0].price='range',
  p=>delete p.productSkuInfos[1].consignPrice,p=>p.productSkuInfos[0].consignPrice=0,p=>p.productSkuInfos[0].consignPrice=100000001,
  p=>p.productSkuInfos[0].fenxiaoPriceInfo='bad',p=>p.offerId='999',p=>p.productSkuInfos[1].skuId=p.productSkuInfos[0].skuId]){
  const source=fixture();source.result.result.productSkuInfos.forEach(sku=>sku.price='10');mutate(source.result.result);assert.throws(()=>parse(source,url));
 }
 const mixed=fixture(['25.6','28']);mixed.result.result.productSaleInfo.priceRangeList[0].price='bad';assert.throws(()=>parse(mixed,url),/원가/);
});

test('legacy explicit price candidates remain byte-for-byte compatible even with a different advertised base',()=>{
 const source=fixture();source.result.result.productSkuInfos.forEach((sku,index)=>{delete sku.consignPrice;sku.price=index?'28':'25.6';});
 const withSale=parse(source,url),withoutSale=structuredClone(source);delete withoutSale.result.result.productSaleInfo;
 assert.deepEqual(costs(withSale),[25.6,28]);assert.equal(Object.hasOwn(withSale,'priceBasis'),false);
 assert.deepEqual(plain(parse(withoutSale,url,Date.parse(withSale.collectedAt))),plain(withSale));
});

test('public mobile range-price selection and equal-price JSON-LD never acquire the OpenAPI first-base rule',()=>{
 const mobile=JSON.parse(fs.readFileSync(new URL('fixtures/1688-mobile-813724060928.json',import.meta.url),'utf8'));
 const source=JSON.parse(fs.readFileSync(new URL('fixtures/1688-skus-813724060928.json',import.meta.url),'utf8')),data=source.data.result.data;
 data.productSaleInfo={priceRangeList:[{price:'4'}]};data.orderParamModel.orderParam.beginNum=3;
 const parameters=data.orderParamModel.orderParam.skuParam;parameters.skuPriceType='rangePrice';parameters.skuRangePrices=[{beginAmount:1,price:'12.5'},{beginAmount:3,price:'10.5'},{beginAmount:100,price:'9.5'}];
 Object.values(data.skuModel.skuInfoMap).forEach(sku=>{sku.consignPrice='25.6';sku.fenxiaoPriceInfo={offerPrice:'25.6'};});
 const parser=load('app/alibaba-mobile-product.ts'),page=parser.parseAlibabaMobilePage('<script>window.__INIT_DATA='+JSON.stringify(mobile)+';</script>',url);
 const receipt=parser.parseAlibabaMobileProduct(page,source);
 assert.ok(receipt.options.length>1);assert.ok(costs(receipt).every(cost=>cost===10.5));assert.equal(Object.hasOwn(receipt,'priceBasis'),false);
 const product={'@type':'ProductGroup',url,name:'原文商品',image:['https://cbu01.alicdn.com/main.jpg'],productSaleInfo:{priceRangeList:[{price:'4'}]},
  hasVariant:['a','b'].map(sku=>({'@type':'Product',name:sku,sku,consignPrice:'25.6',offers:{'@type':'Offer',price:'25.6',priceCurrency:'CNY',eligibleQuantity:{minValue:2}}}))};
 const publicReceipt=load('app/public-product-collector.ts').parsePublicProduct('<script type="application/ld+json">'+JSON.stringify(product)+'</script>',url);
 assert.deepEqual(costs(publicReceipt),[25.6,25.6]);assert.equal(Object.hasOwn(publicReceipt,'priceBasis'),false);
});

test('price evidence validates exact types, bounded SKU identity/order, derived rule and selected-cost consistency',()=>{
 const receipt=parse(fixture(),url),body=raw(receipt);
 for(const mutate of [b=>b.priceBasis=null,b=>b.priceBasis.schemaVersion=2,b=>b.priceBasis.source='mobile',b=>b.priceBasis.rule='minimum-tier',
  b=>b.priceBasis.selection='mixed-sku',b=>b.priceBasis.firstBasePriceCny='5.23',b=>b.priceBasis.firstBasePriceCny=0,
  b=>b.priceBasis.skuPrices=[],b=>b.priceBasis.skuPrices.push(b.priceBasis.skuPrices[0]),b=>b.priceBasis.skuPrices.reverse(),
  b=>b.priceBasis.skuPrices[0].sku='foreign',b=>b.priceBasis.skuPrices[0].source='sku.price',b=>b.priceBasis.skuPrices[0].source={toString:()=> 'consign-price'},
  b=>b.priceBasis.skuPrices[0].unitPriceCny='25.6',b=>b.priceBasis.skuPrices[0].unitPriceCny=NaN,b=>b.priceBasis.skuPrices[0].unitPriceCny=28,
  b=>b.priceBasis.raw='x'.repeat(524289),b=>b.priceBasis.skuPrices[0].extra=true,b=>b.options[0].unitPriceCny=25.6,
  b=>b.provider='1688-public-mobile-v1',b=>b.provider='public-product-jsonld-v1']){
  const invalid=structuredClone(body);mutate(invalid);assert.throws(()=>validate(invalid,receipt.offerId),/원가/);
 }
 const mixed=raw(parse(fixture(['25.6','28']),url));mixed.options[0].unitPriceCny=5.23;assert.throws(()=>validate(mixed,receipt.offerId),/원가/);
});

test('append-only public supplementation preserves consistent original OpenAPI price evidence',()=>{
 const original=parse(fixture(),url),captured={...plain(original),provider:'chrome-public-mobile-v1',description:'추가 원문'};delete captured.priceBasis;
 const before=JSON.stringify(original),supplemented=load('app/collection-source-supplement.ts').supplementCollectionSource(original,captured);
 assert.equal(supplemented.provider,'chrome-public-mobile-supplement-v1');assert.deepEqual(plain(supplemented.priceBasis),plain(original.priceBasis));
 assert.deepEqual(costs(supplemented),[5.23,5.23]);assert.equal(JSON.stringify(original),before);
});

for(const company of [{code:'A01526306',name:'유앤채'},{code:'A01464742',name:'와이홉'}])test(`normalized source receipt and SQLite draft use the selected SKU costs and captured price policy (${company.code})`,async()=>{
 for(const [sourceCosts,expectedPrices]of [[['25.6','25.6'],[[5000,8330,10830],[5000,8330,10830]]],[['5.23','25.6'],[[5000,8330,10830],[16990,28320,36820]]]]){
  const h=mobileIntakeHarness({companyCode:company.code,companyName:company.name});try{
   h.context.settings={...h.context.settings,useIntegratedRate:true,integratedRate:290,bundleEnabled:false};
   h.sqlite.prepare('UPDATE collection_context SET payload=? WHERE job_id=?').run(JSON.stringify(h.context),'job');
   const source=fixture(sourceCosts),before=JSON.stringify(source),receipt=h.load('app/alibaba-product-result.ts').parseAlibabaProduct(source,url);
   const storedResponse=await h.route('/api/collection-jobs/job/result',{method:'POST',body:raw(receipt)});assert.equal(storedResponse.status,200,await storedResponse.clone().text());
   const stored=JSON.parse(h.sqlite.prepare('SELECT payload FROM collection_results WHERE job_id=?').get('job').payload);
   assert.deepEqual(stored.priceBasis,plain(receipt.priceBasis));
   const createdResponse=await h.route('/api/collection-jobs/job/product',{method:'POST'});assert.equal(createdResponse.status,200,await createdResponse.clone().text());
   const created=await createdResponse.json(),product=h.sqlite.prepare('SELECT * FROM products WHERE id=?').get(created.productId);
   const options=JSON.parse(h.sqlite.prepare('SELECT payload FROM product_options WHERE product_id=?').get(created.productId).payload);
   const policy=JSON.parse(h.sqlite.prepare('SELECT payload FROM product_price_policy WHERE product_id=?').get(created.productId).payload);
   assert.deepEqual(options.rows.map(row=>row.unitCostCny),costs(receipt));assert.equal(policy.integratedRate,290);assert.equal(Object.hasOwn(policy,'recalculationMode'),false);
   const prices=h.load('app/product-options.ts').calculateOptionPrices(options.rows,policy);
   assert.deepEqual(Array.from(prices,row=>[row.calculation.supplyPrice,row.calculation.salePrice,row.calculation.msrp]),expectedPrices);
   assert.equal(product.source_price_cny,Math.min(...costs(receipt)));assert.equal(product.supply_price,expectedPrices[0][0]);
   assert.equal(created.executionStarted,false);assert.equal(product.supplier_hub_status,'미전송');assert.equal(h.network.length,0);assert.equal(JSON.stringify(source),before);
   assert.deepEqual(JSON.parse(h.sqlite.prepare('SELECT payload FROM collection_results WHERE job_id=?').get('job').payload).priceBasis,stored.priceBasis);
  }finally{h.close();}
 }
});
