import test from 'node:test';
import assert from 'node:assert/strict';
import {optionImageRuntime,optionImagePayload,optionImageSourceUrl,firstAttributeImage,secondAttributeImage,plain} from './helpers/alibaba-option-image-fallback.mjs';
const load=optionImageRuntime(),parse=load('app/alibaba-product-result.ts').parseAlibabaProduct;
const validate=load('app/collection-result.ts').validateCollectionResult;
const gallery=load('app/collection-gallery.ts');
function receipt(){const input=optionImagePayload();input.result.result.productSkuInfos[0].skuAttributes[0].skuImageUrl=firstAttributeImage;input.result.result.productSkuInfos[0].skuAttributes[1].skuImageUrl=secondAttributeImage;return parse(input,optionImageSourceUrl);}

test('new OpenAPI receipt preserves gallery prefix separately from first and second SKU candidates',()=>{
 const value=receipt();assert.deepEqual(plain(value.sourceGallery),{format:'1688-openapi-gallery-v1',imageIndices:[0,1]});
 assert.equal(value.options[0].imageIndex,2);assert.equal(value.images[2].url,firstAttributeImage);assert.equal(value.images[3].url,secondAttributeImage);
 assert.deepEqual(plain(value.images.map((_,index)=>gallery.collectionCommonImageCandidate(value,index))),[true,true,false,false]);
 const {offerId,...input}=plain(value);assert.deepEqual(plain(validate(input,offerId)),plain(value));
 const legacy=plain(value);delete legacy.sourceGallery;assert.ok(legacy.images.every((_,index)=>gallery.collectionCommonImageCandidate(legacy,index)));
 const {offerId:legacyOffer,...old}=legacy;assert.equal(Object.hasOwn(validate(old,legacyOffer),'sourceGallery'),false);
});
test('gallery URL deduplication retains source order without creating files or changing SKU fallback',()=>{
 const input=optionImagePayload();const images=input.result.result.productImage.images;images.splice(1,0,images[0]);images.push(images[1]);
 input.result.result.productSkuInfos[0].skuAttributes[0].skuImageUrl=images[0];const value=parse(input,optionImageSourceUrl);
 assert.deepEqual(plain(value.sourceGallery.imageIndices),[0,1]);assert.equal(value.images.length,2);assert.equal(value.options[0].imageIndex,0);
});
test('bad gallery markers cannot reinterpret detail/variant images or unrelated provider receipts',()=>{
 const value=plain(receipt()),{offerId,...input}=value;
 for(const mutate of [r=>r.sourceGallery=null,r=>r.sourceGallery=undefined,r=>r.sourceGallery.format='unknown',r=>r.sourceGallery.extra=true,r=>r.sourceGallery.imageIndices=[],r=>r.sourceGallery.imageIndices=[0,0],r=>r.sourceGallery.imageIndices=[1,0],r=>r.sourceGallery.imageIndices=[0,2],r=>r.sourceGallery.imageIndices=[0,-1],r=>r.sourceGallery.imageIndices=[0,1.5],r=>r.sourceGallery.imageIndices=[0,'1'],r=>r.sourceGallery.imageIndices=[0,1,2,3,4],r=>r.images[1].role='detail',r=>r.provider='chrome-public-mobile-v1',r=>r.provider='chrome-product-jsonld-v1']){
  const candidate=plain(input);mutate(candidate);assert.throws(()=>validate(candidate,offerId));
 }
 let reads=0;for(const position of ['marker','array']){
  const candidate=plain(input),object=position==='marker'?candidate.sourceGallery:candidate.sourceGallery.imageIndices;
  Object.defineProperty(object,position==='marker'?'imageIndices':'0',{get(){reads++;throw Error('must not invoke getter');},enumerable:true});assert.throws(()=>validate(candidate,offerId));
 }assert.equal(reads,0);
 const sparse=plain(input);delete sparse.sourceGallery.imageIndices[0];sparse.sourceGallery.imageIndices.extra=0;assert.throws(()=>validate(sparse,offerId));
});
test('append-only source supplement preserves original gallery and SKU indices without claiming appended candidate provenance',()=>{
 const original=receipt(),capture=plain(original);delete capture.sourceGallery;capture.provider='chrome-public-mobile-v1';capture.description='추가로 확인한 원문';
 capture.images.push({url:'https://cbu01.alicdn.com/supplement-extra.jpg',role:'additional'},{url:'https://cbu01.alicdn.com/supplement-detail.jpg',role:'detail'});
 const before=JSON.stringify(original),merged=load('app/collection-source-supplement.ts').supplementCollectionSource(original,capture);
 assert.equal(merged.provider,'chrome-public-mobile-supplement-v1');assert.deepEqual(plain(merged.sourceGallery),plain(original.sourceGallery));assert.deepEqual(plain(merged.options),plain(original.options));
 assert.deepEqual(plain(merged.images.slice(0,original.images.length)),plain(original.images));assert.equal(gallery.collectionCommonImageCandidate(merged,4),false);assert.equal(gallery.collectionCommonImageCandidate(merged,5),true);assert.equal(JSON.stringify(original),before);
});
