import test from 'node:test';
import assert from 'node:assert/strict';
import {optionImageRuntime,optionImagePayload,optionImageOfferId,optionImageSourceUrl,defaultGallery,firstAttributeImage,secondAttributeImage,unusedThirdImage,plain} from './helpers/alibaba-option-image-fallback.mjs';

const load=optionImageRuntime(),parse=load('app/alibaba-product-result.ts').parseAlibabaProduct;
const product=input=>input.result.result;
const attributes=()=>[{value:'Black',attributeName:'Color'},{value:'M',attributeName:'Size'},{value:'Basic',attributeName:'Style',skuImageUrl:unusedThirdImage}];

test('first SKU attribute image wins while its second source candidate stays available and the third remains outside the image pool',()=>{
 const input=optionImagePayload(),sku=product(input).productSkuInfos[0];sku.skuAttributes=attributes();
 sku.skuAttributes[0].skuImageUrl=firstAttributeImage;sku.skuAttributes[1].skuImageUrl=secondAttributeImage;
 const before=JSON.stringify(input),receipt=parse(input,optionImageSourceUrl);
 assert.equal(receipt.options[0].imageIndex,2);assert.equal(receipt.images[2].url,firstAttributeImage);
 assert.deepEqual(Array.from(receipt.images,image=>image.url),[...defaultGallery,firstAttributeImage,secondAttributeImage]);
 assert.equal(JSON.stringify(input),before);assert.equal(receipt.options[0].sku,'69210001');assert.equal(receipt.offerDefault,undefined);
});

test('the second attribute is selected only while the first is falsy, without looking at a third image',()=>{
 for(const first of [undefined,null,'']){
  const input=optionImagePayload(),sku=product(input).productSkuInfos[0];sku.skuAttributes=attributes();
  if(first!==undefined)sku.skuAttributes[0].skuImageUrl=first;sku.skuAttributes[1].skuImageUrl=secondAttributeImage;
  const receipt=parse(input,optionImageSourceUrl);assert.equal(receipt.options[0].imageIndex,2);
  assert.deepEqual(Array.from(receipt.images,image=>image.url),[...defaultGallery,secondAttributeImage]);
 }
});

test('without either first-two image the actual supplier SKU binds to gallery image zero, even when a third attribute has an image',()=>{
 for(const unused of [unusedThirdImage,firstAttributeImage,'javascript:ignored-unselected',{}]){
  const input=optionImagePayload();product(input).productSkuInfos[0].skuAttributes=attributes();product(input).productSkuInfos[0].skuAttributes[2].skuImageUrl=unused;
  const receipt=parse(input,optionImageSourceUrl);assert.equal(receipt.options[0].imageIndex,0);assert.equal(receipt.options[0].sku,'69210001');
  assert.deepEqual(Array.from(receipt.images,image=>image.url),defaultGallery);assert.equal(receipt.options[0].unitPriceCny,4.5);
 }
});

test('a selected malformed image fails explicitly instead of trying another attribute or silently reverting to the gallery',()=>{
 for(const selected of ['https://alicdn.com.attacker.test/bad.jpg','http://cbu01.alicdn.com/bad.jpg','https://user:password@cbu01.alicdn.com/bad.jpg','https://cbu01.alicdn.com:8443/bad.jpg','https://cbu01.alicdn.com/bad.jpg#fragment','javascript:bad',' ',{},true]){
  for(const position of [0,1]){
   const input=optionImagePayload(),sku=product(input).productSkuInfos[0];sku.skuAttributes=attributes();
   sku.skuAttributes[position].skuImageUrl=selected;if(position===0)sku.skuAttributes[1].skuImageUrl=secondAttributeImage;
   assert.throws(()=>parse(input,optionImageSourceUrl),`invalid selected position ${position} cannot use a lower-priority image`);
  }
 }
});

test('malformed first-two image candidates are rejected even if a different valid candidate would be selected',()=>{
 for(const bad of ['https://outside.example/second.jpg','http://cbu01.alicdn.com/second.jpg',{},false,0]){
  const input=optionImagePayload();product(input).productSkuInfos[0].skuAttributes[0].skuImageUrl=firstAttributeImage;product(input).productSkuInfos[0].skuAttributes[1].skuImageUrl=bad;
  assert.throws(()=>parse(input,optionImageSourceUrl),'unselected second candidate is still part of the source image pool and must validate');
 }
});

test('selected image references reuse the canonical gallery index and repeated fallback SKUs do not duplicate originals',()=>{
 for(const index of [0,1]){
  const input=optionImagePayload();product(input).productSkuInfos[0].skuAttributes[0].skuImageUrl=defaultGallery[index];
  const receipt=parse(input,optionImageSourceUrl);assert.equal(receipt.options[0].imageIndex,index);assert.equal(receipt.images.length,2);
 }
 const input=optionImagePayload();product(input).productSkuInfos.push({...structuredClone(product(input).productSkuInfos[0]),skuId:'69210002'});
 const receipt=parse(input,optionImageSourceUrl);assert.deepEqual(Array.from(receipt.options,option=>option.imageIndex),[0,0]);assert.equal(receipt.images.length,2);
 const {offerId,...body}=plain(receipt);assert.equal(offerId,optionImageOfferId);
 assert.deepEqual(plain(load('app/collection-result.ts').validateCollectionResult(body,offerId)),plain(receipt));
});

test('one actual SKU with explicit empty attributes gains image zero without becoming an anonymous product default',()=>{
 const input=optionImagePayload();product(input).productSkuInfos[0].skuAttributes=[];
 const receipt=parse(input,optionImageSourceUrl);assert.equal(receipt.options[0].imageIndex,0);assert.equal(receipt.options[0].sku,'69210001');assert.equal(receipt.offerDefault,undefined);
 for(const value of [undefined,null,{},'']){const invalid=structuredClone(input);if(value===undefined)delete product(invalid).productSkuInfos[0].skuAttributes;else product(invalid).productSkuInfos[0].skuAttributes=value;assert.throws(()=>parse(invalid,optionImageSourceUrl));}
 product(input).productSkuInfos.push({...structuredClone(product(input).productSkuInfos[0]),skuId:'69210002'});assert.throws(()=>parse(input,optionImageSourceUrl),'multi-SKU empty attributes remain ambiguous');
});

test('attribute image fallback does not weaken gallery or price guards and preserves separate detail placement',()=>{
 const input=optionImagePayload({detailImage:defaultGallery[0]});product(input).productSkuInfos[0].skuAttributes[1].skuImageUrl=secondAttributeImage;
 const before=JSON.stringify(input),receipt=parse(input,optionImageSourceUrl);
 assert.equal(receipt.options[0].imageIndex,2);assert.equal(receipt.images[2].url,secondAttributeImage);
 assert.deepEqual(plain(receipt.images.at(-1)),{url:defaultGallery[0],role:'detail'});assert.equal(JSON.stringify(input),before);
 for(const mutate of [p=>p.productImage.images=[],p=>p.productImage.images=['https://not-alibaba.example/invalid.jpg'],p=>delete p.productSkuInfos[0].price,p=>p.productSkuInfos[0].price=0,p=>p.productSkuInfos[0].skuId='']){const invalid=structuredClone(input);mutate(product(invalid));assert.throws(()=>parse(invalid,optionImageSourceUrl));}
});
