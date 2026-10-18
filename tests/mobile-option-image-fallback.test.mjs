import test from 'node:test';
import assert from 'node:assert/strict';
import {mobileImageRuntime,mobileImageFixture,mobileImageOfferId,mobileImageSourceUrl,mobileImageTitle,thirdAxisImage,mixedRet,plain} from './helpers/mobile-option-image-fallback.mjs';

const load=mobileImageRuntime(),parser=load('app/alibaba-mobile-product.ts');
const data=fixture=>fixture.skuPayload.data.result.data;
const parse=fixture=>parser.parseAlibabaMobileProduct(parser.parseAlibabaMobilePage(fixture.mobileHtml,mobileImageSourceUrl),fixture.skuPayload,parser.parseAlibabaMobileDescription(fixture.detailSource));

test('mobile SKU image mapping preserves all option facts/order and both first-two source candidates while ignoring third-axis images',()=>{
 const fixture=mobileImageFixture(),before=JSON.stringify(fixture),receipt=parse(fixture);
 assert.equal(receipt.offerId,mobileImageOfferId);assert.equal(receipt.title,mobileImageTitle);assert.equal(receipt.offerDefault,undefined);
 assert.deepEqual(Array.from(receipt.options,option=>[option.sku,option.name,option.color,option.size,option.unitPriceCny,option.minimumOrder,option.stock]),[
  ['69310001','Black / M / Basic','Black','M',4.5,2,0],['69310002','Green / L / Basic','Green','L',6,2,8],['69310003','Blue / S / Compact','Blue','S',9.1,2,null],
 ]);
 assert.deepEqual(Array.from(receipt.options,option=>option.imageIndex),[0,1,2]);
 assert.deepEqual(Array.from(receipt.images,image=>[image.url,image.role]),[[fixture.images[0],'main'],[fixture.images[1],'additional'],[fixture.images[2],'additional'],[fixture.images[3],'additional'],[fixture.images[2],'detail']]);
 assert.ok(receipt.images.every(image=>image.url!==thirdAxisImage));assert.equal(JSON.stringify(fixture),before);
 const {offerId,...body}=plain(receipt);assert.deepEqual(plain(load('app/collection-result.ts').validateCollectionResult(body,offerId)),plain(receipt));
});

test('first selected axis image wins and the valid second candidate stays in the editable gallery',()=>{
 const fixture=mobileImageFixture(),receipt=parse(fixture),green=receipt.options.find(option=>option.sku==='69310002');
 assert.equal(receipt.images[green.imageIndex].url,fixture.images[1]);
 const candidate=receipt.images.findIndex(image=>image.url===fixture.images[3]);assert.ok(candidate>=0);
 assert.ok(receipt.options.every(option=>option.imageIndex!==candidate),'nonselected second candidate must not become a representative');
});

test('missing first-two axis photos use product image zero for each actual SKU instead of a later-axis image',()=>{
 for(const blank of [undefined,null,'']){
  const fixture=mobileImageFixture();for(const prop of data(fixture).skuModel.skuProps.slice(0,2))for(const value of prop.value){if(blank===undefined)delete value.imageUrl;else value.imageUrl=blank;}
  const receipt=parse(fixture);assert.deepEqual(Array.from(receipt.options,option=>option.imageIndex),[0,0,0]);
  assert.equal(receipt.images.length,3,'only original gallery and one separate detail placement remain');
  assert.ok(receipt.options.every(option=>!!option.sku));assert.equal(receipt.offerDefault,undefined);
 }
});

test('product-only public SKU parsing applies the same first/second/gallery rule without inventing general attributes or detail',()=>{
 const fixture=mobileImageFixture(),receipt=parser.parseAlibabaPublicSkuProduct(fixture.skuPayload,mobileImageSourceUrl);
 assert.equal(receipt.provider,'1688-public-sku-v1');assert.equal(receipt.description,'');assert.equal(receipt.attributes,undefined);
 for(const option of receipt.options){const expected=option.sku==='69310001'?fixture.images[0]:option.sku==='69310002'?fixture.images[1]:fixture.images[2];assert.equal(receipt.images[option.imageIndex].url,expected);}
 assert.ok(receipt.images.some(image=>image.url===fixture.images[3]));assert.ok(receipt.images.every(image=>image.url!==thirdAxisImage));
});

test('malformed selected or nonselected first-two image references fail strictly; a third-axis image is not inspected as a candidate',()=>{
 for(const bad of ['https://outside.example/bad.jpg','http://cbu01.alicdn.com/bad.jpg','https://alicdn.com.attacker.test/bad.jpg','javascript:bad',{},false,0]){
  for(const index of [0,1]){const fixture=mobileImageFixture();data(fixture).skuModel.skuProps[index].value[1].imageUrl=bad;assert.throws(()=>parse(fixture));}
 }
 for(const ignored of [thirdAxisImage,{},false,0,'javascript:ignored']){const fixture=mobileImageFixture();for(const value of data(fixture).skuModel.skuProps[2].value)value.imageUrl=ignored;assert.equal(parse(fixture).options.length,3);}
});

test('one explicit actual SKU with empty axes binds to main image zero, while missing or empty SKU facts never become an anonymous default',()=>{
 const fixture=mobileImageFixture(),sku=data(fixture).skuModel;sku.skuProps=[];sku.skuInfoMap={'':{skuId:'69310001',specAttrs:'',price:'4.5',canBookCount:null}};
 for(const result of [parse(fixture),parser.parseAlibabaPublicSkuProduct(fixture.skuPayload,mobileImageSourceUrl)]){
  assert.deepEqual(plain(result.options),[{sku:'69310001',name:mobileImageTitle,unitPriceCny:4.5,minimumOrder:2,stock:null,imageIndex:0}]);assert.equal(result.offerDefault,undefined);
 }
 for(const mutate of [s=>s.skuInfoMap={},s=>delete s.skuInfoMap,s=>s.skuInfoMap=null,s=>delete s.skuInfoMap[''].skuId,s=>s.skuInfoMap[''].skuId='',s=>delete s.skuProps,s=>s.skuProps=null,s=>s.skuInfoMap.extra={skuId:'69310002',specAttrs:'',price:'5',canBookCount:1}]){
  const invalid=structuredClone(fixture);mutate(data(invalid).skuModel);assert.throws(()=>parse(invalid));
 }
});

test('mixed success and verification failure cannot create either a mobile or public-SKU receipt from otherwise valid source facts',()=>{
 const fixture=mobileImageFixture();fixture.skuPayload.ret=[...mixedRet];
 assert.throws(()=>parse(fixture));assert.throws(()=>parser.parseAlibabaPublicSkuProduct(fixture.skuPayload,mobileImageSourceUrl));
});

test('fallback keeps range-price MOQ selection and gallery validation separate from image priority',()=>{
 const fixture=mobileImageFixture(),order=data(fixture).orderParamModel.orderParam;
 order.skuParam={skuPriceType:'rangePrice',skuRangePrices:[{beginAmount:1,price:'4.5'},{beginAmount:200,price:'1'}]};
 for(const item of Object.values(data(fixture).skuModel.skuInfoMap))delete item.price;
 const receipt=parse(fixture);assert.ok(receipt.options.every(option=>option.unitPriceCny===4.5&&option.minimumOrder===2));
 for(const mutate of [f=>f.init.data.gallery.data.offerImgList=[],f=>f.init.data.gallery.data.offerImgList=['https://outside.example/main.jpg']]){
  const invalid=structuredClone(fixture);mutate(invalid);invalid.mobileHtml='<script>window.__INIT_DATA='+JSON.stringify(invalid.init)+';</script>';assert.throws(()=>parse(invalid));
 }
});
