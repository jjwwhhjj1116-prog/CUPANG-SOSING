import test, {after} from 'node:test';
import assert from 'node:assert/strict';
import {mobileImageFixture,mobileImageSourceUrl,plain} from './helpers/mobile-option-image-fallback.mjs';
import {mobileIntakeHarness} from './helpers/mobile-intake.mjs';

const harness=mobileIntakeHarness(),load=harness.load,parser=load('app/alibaba-mobile-product.ts');
after(()=>harness.close());
const capture=fixture=>load('app/browser-product-capture.ts').parseBrowserProductCapture(fixture.capture,mobileImageSourceUrl);
const parse=fixture=>parser.parseAlibabaMobileProduct(parser.parseAlibabaMobilePage(fixture.mobileHtml,mobileImageSourceUrl),fixture.skuPayload,parser.parseAlibabaMobileDescription(fixture.detailSource));
const roundTrip=value=>{const {offerId,...body}=plain(value);return load('app/collection-result.ts').validateCollectionResult(body,offerId);};

test('only a verified full page provides gallery provenance; SKU-only cover preserves option facts without claiming a gallery',()=>{
 const fixture=mobileImageFixture(),full=parse(fixture),sku=parser.parseAlibabaPublicSkuProduct(fixture.skuPayload,mobileImageSourceUrl);
 assert.deepEqual(plain(full.sourceGallery),{format:'1688-public-mobile-gallery-v1',imageIndices:[0,1]});
 assert.deepEqual(plain(full.sourceGallery.imageIndices.map(index=>full.images[index].url)),fixture.init.data.gallery.data.offerImgList);
 assert.equal(Object.hasOwn(sku,'sourceGallery'),false);
 const facts=value=>Array.from(value.options,option=>{const {imageIndex,...fields}=plain(option);return {...fields,imageUrl:value.images[imageIndex].url};});
 assert.deepEqual(facts(sku),facts(full),'source image indices can differ, but SKU facts and selected representative URLs must agree');
 assert.deepEqual(plain(roundTrip(full)),plain(full));assert.equal(Object.hasOwn(roundTrip(sku),'sourceGallery'),false);
 const flags=full.images.map((_,index)=>load('app/collection-gallery.ts').collectionCommonImageCandidate(full,index));
 assert.deepEqual(plain(flags),[true,true,false,false,true]);
});

test('deduplicated page gallery keeps its order before variant and detail candidates',()=>{
 const fixture=mobileImageFixture(),raw=fixture.init.data.gallery.data.offerImgList;
 raw.splice(1,0,raw[0]);raw.push(raw[2]);fixture.mobileHtml='<script>window.__INIT_DATA='+JSON.stringify(fixture.init)+';</script>';
 const result=parse(fixture);assert.deepEqual(plain(result.sourceGallery.imageIndices),[0,1]);
 assert.deepEqual(Array.from(result.images,image=>[image.url,image.role]),[[fixture.images[0],'main'],[fixture.images[1],'additional'],[fixture.images[2],'additional'],[fixture.images[3],'additional'],[fixture.images[2],'detail']]);
 assert.deepEqual(Array.from(result.options,option=>option.imageIndex),[0,1,2]);
});

test('full and partial Chrome captures retain page gallery after provider retag and receipt roundtrip',()=>{
 const fixture=mobileImageFixture(),full=capture(fixture);
 assert.equal(full.provider,'chrome-public-mobile-v1');assert.deepEqual(plain(roundTrip(full)),plain(full));
 for(const status of [502,503,504]){
  const partial=load('app/browser-product-capture.ts').parseBrowserProductCapture({...fixture.capture,format:'1688-public-mobile-partial-capture-v1',detailSource:'',detailUnavailable:{status}},mobileImageSourceUrl);
  assert.equal(partial.provider,'chrome-public-mobile-partial-v1');assert.deepEqual(plain(partial.sourceGallery),plain(full.sourceGallery));
  assert.deepEqual(plain(partial.options),plain(full.options));assert.equal(partial.images.length,4);assert.equal(partial.description,'');assert.ok(partial.images.every(image=>image.role!=='detail'));
  assert.deepEqual(plain(roundTrip(partial)),plain(partial));
 }
 const sku=load('app/browser-product-capture.ts').parseBrowserProductCapture({format:'1688-public-sku-capture-v1',sourceUrl:mobileImageSourceUrl,skuPayload:fixture.skuPayload},mobileImageSourceUrl);
 assert.equal(sku.provider,'chrome-public-sku-v1');assert.equal(Object.hasOwn(roundTrip(sku),'sourceGallery'),false);
});

test('public gallery format is accepted only on full/partial public providers, independently from OpenAPI provenance',()=>{
 const full=plain(parse(mobileImageFixture()));
 for(const provider of ['1688-public-mobile-v1','1688-public-mobile-partial-v1','chrome-public-mobile-v1','chrome-public-mobile-partial-v1','chrome-public-mobile-supplement-v1'])assert.deepEqual(plain(roundTrip({...full,provider}).sourceGallery),full.sourceGallery);
 for(const provider of ['1688-public-sku-v1','chrome-public-sku-v1','chrome-product-jsonld-v1','1688-openapi-candidate-v1'])assert.throws(()=>roundTrip({...full,provider}));
 for(const provider of ['1688-public-mobile-v1','chrome-public-mobile-v1','chrome-public-mobile-partial-v1'])assert.throws(()=>roundTrip({...full,provider,sourceGallery:{...full.sourceGallery,format:'1688-openapi-gallery-v1'}}));
});

test('supplement preserves original gallery identity and never copies a full capture marker into an unmarked receipt',()=>{
 const fixture=mobileImageFixture(),full=capture(fixture),merge=load('app/collection-source-supplement.ts').supplementCollectionSource;
 for(const marked of [true,false]){
  const original=plain(full);original.provider='1688-public-mobile-partial-v1';original.description='';original.images.pop();if(!marked)delete original.sourceGallery;
  const before=JSON.stringify(original),merged=merge(original,full);
  assert.equal(merged.provider,'chrome-public-mobile-supplement-v1');assert.equal(merged.images.length,5);
  assert.deepEqual(plain(merged.images.slice(0,4)),original.images);assert.deepEqual(plain(merged.options),original.options);
  assert.equal(Object.hasOwn(merged,'sourceGallery'),marked);if(marked)assert.deepEqual(plain(merged.sourceGallery),original.sourceGallery);
  assert.equal(JSON.stringify(original),before);assert.deepEqual(plain(roundTrip(merged)),plain(merged));
 }
 const sku=parser.parseAlibabaPublicSkuProduct(fixture.skuPayload,mobileImageSourceUrl),merged=merge(sku,full);
 assert.equal(Object.hasOwn(merged,'sourceGallery'),false);assert.deepEqual(plain(merged.images.slice(0,sku.images.length)),plain(sku.images));
 assert.deepEqual(plain(merged.options),plain(sku.options));
});
