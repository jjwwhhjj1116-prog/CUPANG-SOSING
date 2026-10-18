import test from 'node:test';
import assert from 'node:assert/strict';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {offerDefaultRuntime,offerDefaultPayload,offerId,sourceUrl,originalTitle,plain} from './helpers/alibaba-offer-default.mjs';

const load=offerDefaultRuntime(),parse=load('app/alibaba-product-result.ts').parseAlibabaProduct;
const validate=load('app/collection-result.ts').validateCollectionResult;
const body=receipt=>{const {offerId:identity,...value}=plain(receipt);assert.equal(identity,offerId);return value;};

test('explicit empty SKU array creates one original-name default with first-row price, known zero stock and ordered source images',()=>{
 const input=offerDefaultPayload(),before=JSON.stringify(input),receipt=parse(input,sourceUrl);
 assert.equal(receipt.title,originalTitle);assert.equal(receipt.provider,'1688-openapi-candidate-v1');
 assert.deepEqual(plain(receipt.options),[{sku:'',name:originalTitle,unitPriceCny:4.5,minimumOrder:2,stock:0,imageIndex:0}]);
 assert.deepEqual(plain(receipt.offerDefault),{format:'1688-openapi-offer-default-v1',offerId,sourceSkuCount:0,priceSource:'product-sale-first-row',unitPriceCny:4.5,minimumOrder:2,stock:0});
 assert.equal(receipt.priceBasis,undefined);assert.equal(receipt.images.length,3);
 assert.deepEqual(Array.from(receipt.images,image=>image.role),['main','additional','detail']);
 assert.equal(receipt.description,'运动收纳保护带原文说明');assert.equal(receipt.attributes[0].value,'PP');
 assert.deepEqual(plain(validate(body(receipt),offerId)),plain(receipt));assert.equal(JSON.stringify(input),before);
});

test('default preserves unknown versus zero stock without using subjectTrans as verified original or Korean name',()=>{
 for(const stock of [undefined,null,0,12]){
  const input=offerDefaultPayload({stock});if(stock===undefined)delete input.result.result.productSaleInfo.amountOnSale;
  const receipt=parse(input,sourceUrl);assert.equal(receipt.options[0].stock,stock??null);assert.equal(receipt.offerDefault.stock,stock??null);
  assert.equal(receipt.options[0].name,originalTitle);assert.equal(receipt.title,originalTitle);
 }
 for(const subjectTrans of ['',null,17,{value:'translated'}]){
  const input=offerDefaultPayload();input.result.result.subjectTrans=subjectTrans;
  assert.equal(parse(input,sourceUrl).options[0].name,originalTitle);
 }
});

test('missing, null, malformed and damaged nonempty SKU arrays never become a product-level default',()=>{
 for(const value of [undefined,null,'',0,{},[null],[{}],[{skuId:'',price:'4.5',skuAttributes:[]}],[{skuId:'6911',price:null,skuAttributes:[]}]]){
  const input=offerDefaultPayload();if(value===undefined)delete input.result.result.productSkuInfos;else input.result.result.productSkuInfos=value;
  assert.throws(()=>parse(input,sourceUrl),'invalid or absent SKU data cannot trigger fallback');
 }
 const valid=offerDefaultPayload();valid.result.result.productSkuInfos=[{skuId:'69110001',price:'8.2',amountOnSale:0,skuAttributes:[]}];
 const actual=parse(valid,sourceUrl);assert.equal(actual.offerDefault,undefined);assert.equal(actual.options[0].sku,'69110001');assert.equal(actual.options[0].unitPriceCny,8.2);
});

test('only a strict valid original first sale row supplies default price, never another tier or headline',()=>{
 for(const value of [undefined,null,'',0,-1,'0','-1','4.5garbage','4.5-6',' 4.5 ',NaN,Infinity,100000001,'100000001',{},true]){
  const input=offerDefaultPayload();input.result.result.productSaleInfo.priceRangeList[0].price=value;
  input.result.result.price='3';input.result.result.priceInfo={price:'3'};
  assert.throws(()=>parse(input,sourceUrl),`invalid first price ${String(value)} must not use later price 0.3`);
 }
 for(const sale of [undefined,null,{},[],{priceRangeList:null},{priceRangeList:[]},{priceRangeList:{}},{priceRangeList:[null,{price:'4.5'}]}]){
  const input=offerDefaultPayload();input.result.result.productSaleInfo=sale;assert.throws(()=>parse(input,sourceUrl));
 }
 const maximum=offerDefaultPayload();maximum.result.result.productSaleInfo.priceRangeList[0].price=100000000;
 assert.equal(parse(maximum,sourceUrl).options[0].unitPriceCny,100000000);
});

test('default still rejects bad MOQ, stock, offer identity, original name and source media',()=>{
 const mutations=[p=>p.minOrderQuantity=0,p=>p.minOrderQuantity=1.5,p=>delete p.minOrderQuantity,p=>p.offerId='691999',p=>p.subject='',
  ...[-1,0.5,'bad',true,Infinity,Number.MAX_SAFE_INTEGER+1].map(value=>p=>p.productSaleInfo.amountOnSale=value),
  p=>p.productImage.images=[],p=>p.productImage.images=['https://alicdn.com.attacker.test/image.jpg'],p=>p.description='<img src="https://attacker.test/image.jpg">'];
 for(const mutate of mutations){const input=offerDefaultPayload();mutate(input.result.result);assert.throws(()=>parse(input,sourceUrl));}
});

test('offer-default receipt evidence is exact, provider-bound and matches its one anonymous option',()=>{
 const receipt=body(parse(offerDefaultPayload(),sourceUrl));
 const mutations=[r=>r.provider='1688-public-mobile-v1',r=>r.provider='chrome-public-mobile-supplement-v1',r=>r.provider='unknown',
  r=>r.offerDefault.extra='not-supported',r=>r.offerDefault.format='v0',r=>r.offerDefault.offerId='691999',r=>r.offerDefault.sourceSkuCount=1,
  r=>r.offerDefault.sourceSkuCount='0',r=>r.offerDefault.priceSource='lowest-tier',r=>r.offerDefault.unitPriceCny=0.3,
  r=>r.offerDefault.minimumOrder=1,r=>r.offerDefault.stock=null,r=>r.options[0].sku='invented-default-id',r=>r.options[0].name='different source name',
  r=>r.options.push({...r.options[0],sku:'6911'}),r=>r.options[0].unitPriceCny=0.3,r=>r.options[0].minimumOrder=3,
  r=>r.options[0].stock=null,r=>delete r.options[0].imageIndex,r=>r.options[0].imageIndex=1,
  r=>r.options[0].color='',r=>r.options[0].size='default',r=>r.images[0].role='additional',
  r=>r.priceBasis={schemaVersion:1,source:'1688-openapi-consignment-v1',rule:'couplus-all-skus-uniform-first-row-v1',selection:'uniform-first-base',firstBasePriceCny:4.5,skuPrices:[{sku:'',source:'consign-price',unitPriceCny:4.5}]}];
 for(const mutate of mutations){const input=structuredClone(receipt);mutate(input);assert.throws(()=>validate(input,offerId));}
 for(const key of Object.keys(receipt.offerDefault)){const input=structuredClone(receipt);delete input.offerDefault[key];assert.throws(()=>validate(input,offerId),`missing default evidence ${key}`);}
});

test('blank supplier SKU stays forbidden for every ordinary receipt, including superficially similar OpenAPI receipts',()=>{
 const receipt=body(parse(offerDefaultPayload(),sourceUrl));delete receipt.offerDefault;
 for(const provider of ['1688-openapi-candidate-v1','1688-public-mobile-v1','chrome-public-mobile-v1','manual-test']){
  assert.throws(()=>validate({...receipt,provider},offerId));
 }
 const normal=structuredClone(receipt);normal.options[0].sku='69110001';
 assert.equal(validate(normal,offerId).options[0].sku,'69110001');
});

test('draft preparation keeps deterministic local identity and unverified blank supplier identity while preserving source price and MOQ',()=>{
 const receipt=parse(offerDefaultPayload(),sourceUrl),settings=load('app/observed-price-preset.ts').applyObservedPricePreset(load('app/workspace-settings.ts').defaultSettings);
 const job={id:'synthetic-job-691',offer_id:offerId,source_url:sourceUrl,goal:'work',context:{category:{id:'cat',categoryId:'80719',categoryPath:['주방용품','주방수납/정리','주방수납바구니/바스켓']},settings,company:{code:'A01464742',name:'와이홉'}}};
 const now=new Date().toISOString(),prepare=load('app/collection-product.ts').prepareCollectionProduct;
 const first=prepare('owner',job,receipt,'product',now),second=prepare('owner',job,validate(body(receipt),offerId),'product',now);
 assert.deepEqual(plain(first),plain(second));assert.equal(first.options.rows.length,1);
 const option=first.options.rows[0];assert.equal(option.id,'collected-1');assert.equal(option.supplierSku,'');assert.equal(option.provenance.supplierSku,'unverified');
 assert.equal(option.originalName,originalTitle);assert.equal(option.provenance.originalName,'collected');assert.equal(option.translatedName,'');assert.equal(option.provenance.translatedName,'unverified');
 assert.equal(option.unitCostCny,4.5);assert.equal(option.minimumOrderQuantity,2);assert.equal(option.stock,0);assert.equal(option.imageKey,null);
 assert.equal(first.content.seo.title.value,originalTitle);assert.equal(first.product.source_price_cny,4.5);assert.equal(first.product.supplier_hub_status,'미전송');
});

test('price evidence UI shows first-row default cost and absence of supplier SKU without fabricating a SKU table',()=>{
 const result=parse(offerDefaultPayload(),sourceUrl),Component=load('app/components/collection-price-basis-panel.tsx').CollectionPriceBasisPanel;
 const html=renderToStaticMarkup(createElement(Component,{result}));
 assert.match(html,/옵션 구분 없는 상품/);assert.match(html,/상품 가격표 첫 행의 4\.5위안/);assert.match(html,/공급자 SKU는 제공되지 않아 비워 두었습니다/);
 assert.doesNotMatch(html,/<table|default-691|collected-1/);
 const ordinary=structuredClone(result);delete ordinary.offerDefault;ordinary.options[0].sku='69110001';
 assert.equal(renderToStaticMarkup(createElement(Component,{result:ordinary})),'' );
});

test('SKU-less source gaps cannot request a mobile SKU supplement that would reinterpret the captured identity',()=>{
 const input=offerDefaultPayload();input.result.result.description='';input.result.result.productAttribute=[];
 const receipt=parse(input,sourceUrl),supplement=load('app/collection-source-supplement.ts').canSupplementCollection;
 assert.equal(supplement(receipt),false);assert.deepEqual(Array.from(load('app/collection-source-gaps.ts').collectionSourceGaps(receipt),gap=>gap.fieldId),['detailHtml','detailImages','noticeMaterial']);
 const ordinary=structuredClone(receipt);delete ordinary.offerDefault;ordinary.options[0].sku='69110001';
 assert.equal(supplement(ordinary),true,'ordinary incomplete SKU source keeps its existing explicit repair path');
});
