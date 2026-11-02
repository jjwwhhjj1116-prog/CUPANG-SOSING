import test from 'node:test';
import assert from 'node:assert/strict';
import {extractPageSource,validatePageSource} from '../extensions/supplier-hub/page-source.mjs';
import {mobileIntakeHarness} from './helpers/mobile-intake.mjs';

const offerId='700000000907',sourceUrl=`https://detail.1688.com/offer/${offerId}.html`;
const [main,gallery,skuOnly,body]=['main','gallery','sku-only','body'].map(name=>`https://cbu01.alicdn.com/synthetic-page-gallery-${name}.png`);
const plain=value=>value===undefined?undefined:JSON.parse(JSON.stringify(value));
function capture({galleryImages=[main,gallery],detailImages=[body],optionImage=skuOnly}={}){
 return extractPageSource({sourceUrl,scripts:[JSON.stringify({offerId,subject:'Synthetic gallery source',offerImgList:galleryImages,
  skuModel:{offerId,beginAmount:1,skuInfoMap:{black:{skuId:'synthetic-sku-907',name:'Black',price:'1',imageUrl:optionImage}}}})],priceText:'CNY',detailImages});
}
function draft(h,source){
 const receipt=h.load('app/source-inbox.ts').pageSourceCollectionResult(source),links=receipt.images.map((_,imageIndex)=>({imageIndex,key:`owner/synthetic-907-${imageIndex}.png`}));
 const options=h.load('app/product-options.ts').emptyProductOptions('synthetic-907');
 options.rows=[{id:'collected-1',included:true,supplierSku:receipt.options[0].sku,imageKey:null,provenance:{supplierSku:'collected',imageKey:'unverified'}}];
 const result=h.load('app/collection-image-draft.ts').collectedImageDraft('owner',receipt,links,links.map(row=>row.key),
  h.load('app/product-content.ts').emptyProductContent('synthetic-907'),options,new Date().toISOString());
 return {receipt,result,key:url=>links[receipt.images.findIndex(row=>row.url===url)].key};
}

test('current-page draft keeps true gallery extras separate from SKU-only files and explicit BODY',()=>{
 const h=mobileIntakeHarness();try{
  const source=capture(),{receipt,result,key}=draft(h,source);
  assert.deepEqual(plain(result.content.assets.additional.value),[key(gallery)],'SKU-only photos belong to options, not the common gallery');
  assert.deepEqual(plain(result.content.assets.main.value),[key(main)]);
  assert.deepEqual(plain(result.content.assets.detail.value),[key(body)]);
  assert.equal(result.options.rows[0].imageKey,key(skuOnly));
  assert.deepEqual(source.sourceGallery,{format:'chrome-current-page-gallery-v1',imageIndices:[0,1]});
  assert.deepEqual(plain(receipt.sourceGallery),source.sourceGallery);
  assert.deepEqual(h.network,[]);
 }finally{h.close();}
});

test('a photo proved in both gallery and option remains in both while an explicit detail placement stays separate',()=>{
 const h=mobileIntakeHarness();try{
  const source=capture({optionImage:gallery,detailImages:[body,main]}),{receipt,result,key}=draft(h,source);
  assert.deepEqual(plain(result.content.assets.additional.value),[key(gallery)]);
  assert.equal(result.options.rows[0].imageKey,key(gallery));
  const detailKeys=receipt.images.flatMap((image,index)=>image.role==='detail'?[`owner/synthetic-907-${index}.png`]:[]);
  assert.deepEqual(plain(result.content.assets.detail.value),detailKeys);
  assert.equal(detailKeys.length,2);
  assert.deepEqual(plain(receipt.sourceGallery),{format:'chrome-current-page-gallery-v1',imageIndices:[0,1]});
  assert.deepEqual(h.network,[]);
 }finally{h.close();}
});

test('an observed page without a gallery can retain option photos without manufacturing main, common additional or BODY',()=>{
 const h=mobileIntakeHarness();try{
  const source=capture({galleryImages:[],detailImages:[]}),{receipt,result,key}=draft(h,source);
  assert.deepEqual(plain(result.content.assets.additional.value),[]);
  assert.deepEqual(plain(result.content.assets.main.value),[]);
  assert.deepEqual(plain(result.content.assets.detail.value),[]);
  assert.equal(result.options.rows[0].imageKey,key(skuOnly));
  assert.deepEqual(plain(receipt.sourceGallery),{format:'chrome-current-page-gallery-v1',imageIndices:[]});
  assert.deepEqual(h.network,[]);
 }finally{h.close();}
});

test('page gallery marker rejects malformed placements and incompatible receipt providers; legacy captures remain unchanged',()=>{
 const h=mobileIntakeHarness();try{
  const source=capture(),model=h.load('app/source-inbox.ts'),validate=h.load('app/collection-result.ts').validateCollectionResult;
  assert.deepEqual(source.sourceGallery,{format:'chrome-current-page-gallery-v1',imageIndices:[0,1]});
  const result=model.pageSourceCollectionResult(source),{offerId:receivedOffer,...input}=plain(result);
  for(const mutate of [r=>r.sourceGallery=null,r=>r.sourceGallery=undefined,r=>r.sourceGallery.extra=true,r=>r.sourceGallery.format='foreign-gallery',
   r=>r.sourceGallery.imageIndices=[],r=>r.sourceGallery.imageIndices=[1],r=>r.sourceGallery.imageIndices=[0,0],
   r=>r.sourceGallery.imageIndices=[0,2],r=>r.sourceGallery.imageIndices=[0,-1],r=>r.sourceGallery.imageIndices=[0,1.5],
   r=>r.sourceGallery.imageIndices=[0,'1'],r=>r.sourceGallery.imageIndices=[0,1,2,3,4]]){
   const candidate=plain(source);mutate(candidate);assert.throws(()=>validatePageSource(candidate),/갤러리/);
   const receipt=plain(input);mutate(receipt);assert.throws(()=>validate(receipt,receivedOffer),/갤러리/);
  }
  for(const provider of ['1688-openapi-candidate-v1','1688-public-mobile-v1','chrome-public-mobile-v1','chrome-product-jsonld-v1','chrome-current-page-v2'])
   assert.throws(()=>validate({...input,provider},receivedOffer),/갤러리/);
  for(const format of ['1688-openapi-gallery-v1','1688-public-mobile-gallery-v1']){
   assert.throws(()=>validatePageSource({...source,sourceGallery:{...source.sourceGallery,format}}),/갤러리/);
   assert.throws(()=>validate({...input,sourceGallery:{...input.sourceGallery,format}},receivedOffer),/갤러리/);
  }
  for(const provider of ['chrome-current-page-v1','chrome-reviewed-page-v1'])assert.deepEqual(plain(validate({...input,provider},receivedOffer).sourceGallery),source.sourceGallery);
  const sparse=plain(source);delete sparse.sourceGallery.imageIndices[0];assert.throws(()=>validatePageSource(sparse),/갤러리/);
  const foreign=plain(source);foreign.offerId='700000000908';assert.throws(()=>validatePageSource(foreign),/상품 번호/);
  const legacy=plain(source);delete legacy.sourceGallery;const bytes=JSON.stringify(legacy);
  assert.equal(JSON.stringify(validatePageSource(legacy)),bytes);assert.equal(Object.hasOwn(model.pageSourceCollectionResult(legacy),'sourceGallery'),false);
  assert.deepEqual(h.network,[]);
 }finally{h.close();}
});

test('mobile supplementation preserves current-page gallery membership and excludes appended SKU-only photos',()=>{
 const h=mobileIntakeHarness();try{
  const model=h.load('app/source-inbox.ts'),supplement=h.load('app/collection-source-supplement.ts'),galleryModel=h.load('app/collection-gallery.ts');
  for(const reviewed of [false,true])for(const galleryImages of [[main,gallery],[]]){
   const original=model.pageSourceCollectionResult(capture({galleryImages}),reviewed),before=JSON.stringify(original),{offerId,...input}=plain(original);
   const captured={...input,provider:'chrome-public-mobile-v1',description:'Explicit mobile description'};
   if(galleryImages.length)captured.sourceGallery={format:'1688-public-mobile-gallery-v1',imageIndices:[0,1]};else delete captured.sourceGallery;
   captured.images.push({url:'https://cbu01.alicdn.com/synthetic-mobile-sku-only.png',role:'additional'},
    {url:'https://cbu01.alicdn.com/synthetic-mobile-detail.png',role:'detail'});
   const full=h.load('app/collection-result.ts').validateCollectionResult(captured,offerId);
   assert.equal(supplement.canSupplementCollection(original),true);
   const merged=supplement.supplementCollectionSource(original,full);
   assert.equal(merged.provider,'chrome-public-mobile-supplement-v1');assert.deepEqual(plain(merged.sourceGallery),plain(original.sourceGallery));
   assert.deepEqual(plain(merged.images.slice(0,original.images.length)),plain(original.images));assert.deepEqual(plain(merged.options),plain(original.options));
   assert.equal(galleryModel.collectionCommonImageCandidate(merged,original.images.length),false);
   assert.equal(galleryModel.collectionCommonImageCandidate(merged,original.images.length+1),true);
   assert.equal(merged.description,'Explicit mobile description');assert.equal(JSON.stringify(original),before);
  }
  assert.deepEqual(h.network,[]);
 }finally{h.close();}
});

for(const company of [{code:'A01464742',name:'와이홉'},{code:'A01526306',name:'유앤채'}])test(`${company.code}: saved page selection preserves gallery provenance through the immutable server receipt`,async()=>{
 const h=mobileIntakeHarness({companyCode:company.code,companyName:company.name,sourceFetcher:()=>assert.fail('Saved synthetic sources cannot request a supplier')});try{
  const source=capture(),model=h.load('app/source-inbox.ts'),fingerprint=await model.pageSourceFingerprint(source),captureId='00000000-0000-4000-8000-000000000907';
  h.sqlite.prepare('UPDATE collection_jobs SET offer_id=?,source_url=? WHERE id=?').run(offerId,sourceUrl,'job');
  const response=await h.load('app/api/source-inbox/route.ts').POST(new Request('https://app.test/api/source-inbox',{method:'POST',headers:{'content-type':'application/json'},
   body:JSON.stringify({expectedOwnerId:'owner',expectedCompany:company,id:captureId,fingerprint,snapshot:source})}));
  assert.equal(response.status,200,await response.clone().text());
  const selection={format:'yoofam-saved-page-capture-v1',sourceUrl,captureId,fingerprint,revision:1};
  const received=await h.route('/api/collection-jobs/job/collect',{method:'POST',body:{browserCapture:selection}});
  assert.equal(received.status,200,await received.clone().text());const ack=await received.json();
  assert.deepEqual(ack.receipt.result.sourceGallery,{format:'chrome-current-page-gallery-v1',imageIndices:[0,1]});
  const stored=await h.load('db/collection-results.ts').readCollectionResult('owner','job');
  assert.deepEqual(plain(stored.result.sourceGallery),source.sourceGallery);
  const reviewed=model.reviewPageSource(source,{title:source.title,options:source.options.map(row=>({key:row.key,name:row.name,supplierSku:row.supplierSku,unitPriceCny:row.unitPriceCny,currency:row.currency,minimumOrder:row.minimumOrder}))});
  assert.deepEqual(plain(model.pageSourceCollectionResult(reviewed,true).sourceGallery),source.sourceGallery);
  assert.deepEqual(h.network,[]);assert.equal(h.sqlite.prepare('SELECT COUNT(*) n FROM supplier_hub_receipts').get().n,0);
 }finally{h.close();}
});
