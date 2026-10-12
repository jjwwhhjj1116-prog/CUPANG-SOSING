import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { mobileIntakeHarness } from './helpers/mobile-intake.mjs';

// Synthetic offer identity, local source structure and in-memory media only.
// No request reaches 1688, Supplier Hub or an existing working product.
const offerId='623000000001',sourceUrl=`https://detail.1688.com/offer/${offerId}.html`,title='Synthetic sourced basket',sku='623000000010';
const observed=JSON.parse(fs.readFileSync(new URL('./fixtures/1688-mobile-813724060928.json',import.meta.url),'utf8'));
const gallery=Object.values(observed.data).find(value=>value?.data?.offerImgList).data.offerImgList;
const main=gallery[0],detailImage=gallery[1];
const html=description=>'<script type="application/ld+json">'+JSON.stringify({
 '@type':'Product',url:sourceUrl,name:title,sku,image:main,...(description?{description}:{}),
 offers:{'@type':'Offer',price:'12.5',priceCurrency:'CNY',eligibleQuantity:{minValue:3},inventoryLevel:{'@type':'QuantitativeValue',value:0}},
})+'</script>';
function capture({description='Collected source detail',attributes=[{name:'material',value:'PP'}],detail=true}={}){
 const mobile={globalData:{offerBaseInfo:{offerId},tempModel:{offerId,offerTitle:title},offerSigns:{},detailModel:{offerId,
  detailUrl:'https://air.1688.com/detail?'+new URLSearchParams({offerId,url:'https://itemcdn.tmall.com/1688offer/Step623Synthetic'})}},
  data:{gallery:{data:{offerId,offerImgList:[main]}},attributes:{data:{offerId,propsList:attributes}}}};
 const skuPayload={ret:['SUCCESS::OK'],data:{result:{data:{offerBaseInfo:{offerId,title,picUrl:main},
  orderParamModel:{orderParam:{beginNum:3,skuParam:{skuPriceType:'skuPrice'}}},
  skuModel:{skuProps:[],skuInfoMap:{'':{skuId:sku,specAttrs:'',price:'12.5',canBookCount:0}}}}}}};
 return{format:'1688-public-mobile-capture-v1',sourceUrl,mobileHtml:'<script>window.__INIT_DATA='+JSON.stringify(mobile)+';</script>',skuPayload,
  detailSource:'var offer_details='+JSON.stringify({content:`<p>${description}</p>${detail?`<img src="${detailImage}">`:''}`})+';'};
}
function harness(company={},options={}){
 const h=mobileIntakeHarness({...company,...options});
 h.sqlite.prepare('UPDATE collection_jobs SET offer_id=?,source_url=?,goal=? WHERE id=?').run(offerId,sourceUrl,'collect','job');
 return h;
}
const json=async(response,status=200)=>{assert.equal(response.status,status,await response.clone().text());return response.json();};
const original=h=>h.load('app/public-product-collector.ts').parsePublicProduct(html(),sourceUrl);
const captured=(h,body=capture())=>h.load('app/browser-product-capture.ts').parseBrowserProductCapture(body,sourceUrl);
const plain=value=>JSON.parse(JSON.stringify(value));
const companies=[{companyCode:'A01464742',companyName:'와이홉'},{companyCode:'A01526306',companyName:'유앤채'}];

test('source gaps depend on absent seller facts, regardless of JSON-LD, mobile or API provider names',()=>{
 const h=harness();
 try{
  const gaps=h.load('app/collection-source-gaps.ts').collectionSourceGaps,warnings=h.load('app/collection-result.ts').collectionSourceWarnings,
   can=h.load('app/collection-source-supplement.ts').canSupplementCollection,source=original(h),full=captured(h);
  for(const provider of ['public-product-jsonld-v1','1688-public-mobile-v1','chrome-public-mobile-v1','official-api-fixture']){
   const sparse={...source,provider};
   assert.deepEqual(plain(gaps(sparse)).map(gap=>gap.fieldId),['detailHtml','detailImages','noticeMaterial']);
   assert.equal(can(sparse),true);assert.match(warnings(sparse).join(' '),/상세 설명·상세 이미지·일반 상품 속성/);
   const complete={...full,provider};assert.deepEqual(plain(gaps(complete)),[]);assert.deepEqual(plain(warnings(complete)),[]);assert.equal(can(complete),false);
   // Some legitimate products have no published attributes: this is a review
   // reminder, never a reason to invent attributes or reject the source draft.
   const noAttributes={...complete,attributes:[]};
   assert.deepEqual(plain(gaps(noAttributes)).map(gap=>gap.fieldId),['noticeMaterial']);
   assert.doesNotMatch(warnings(noAttributes).join(' '),/상세 설명|상세 이미지/);
   assert.ok(h.load('app/collection-source-review.ts').collectionSourceReview(gaps(noAttributes)).every(issue=>issue.kind==='review'));
  }
 }finally{h.close();}
});

test('partial enrichment fills only the supplied facts and keeps unsupplied details as informational gaps',()=>{
 const h=harness();
 try{
  const merged=h.load('app/collection-source-supplement.ts').supplementCollectionSource(original(h),captured(h,capture({description:'',detail:false})));
  assert.equal(merged.description,'');assert.deepEqual(plain(merged.attributes),[{name:'material',value:'PP'}]);
  assert.deepEqual(plain(h.load('app/collection-source-gaps.ts').collectionSourceGaps(merged)).map(gap=>gap.fieldId),['detailHtml','detailImages']);
  assert.match(h.load('app/collection-result.ts').collectionSourceWarnings(merged).join(' '),/상세 설명·상세 이미지/);
  assert.equal(h.load('app/collection-source-supplement.ts').canSupplementCollection(merged),false,'an append-only supplement is reused even when optional facts are still absent');
 }finally{h.close();}
});

test('no-attribute products stay valid editable drafts, but captures without new facts cannot pretend to supplement them',async()=>{
 const h=harness();
 try{
  const full=captured(h),source={...full,provider:'public-product-jsonld-v1',attributes:[]},unchanged={...full,attributes:[]};
  assert.throws(()=>h.load('app/collection-source-supplement.ts').supplementCollectionSource(source,unchanged),/보완|받지 못/);
  await h.load('db/collection-results.ts').storeCollectionResult('owner','job',source);
  const {productId}=await json(await h.route('/api/collection-jobs/job/product',{method:'POST'}));
  const context=await json(await h.route(`/api/products/${productId}/translation-source`));
  assert.deepEqual(context.attributes,[]);assert.deepEqual(context.sourceGaps.map(gap=>gap.fieldId),['noticeMaterial']);
  assert.equal(h.sqlite.prepare('SELECT count(*) n FROM products').get().n,1);assert.equal(h.sqlite.prepare('SELECT count(*) n FROM collection_source_supplements').get().n,0);
 }finally{h.close();}
});

for(const company of companies)test(`explicit sparse JSON-LD repair preserves immutable SKU/price receipt and every saved edit (${company.companyCode})`,async()=>{
 const h=harness(company);
 try{
  const source=original(h);await h.load('db/collection-results.ts').storeCollectionResult('owner','job',source);
  const {productId:id}=await json(await h.route('/api/collection-jobs/job/product',{method:'POST'})),base='/api/products/'+id;
  const content=(await json(await h.route(base+'/content'))).content;
  await json(await h.route(base+'/content',{method:'PATCH',body:{expectedRevision:content.revision,patch:{seo:{title:'검토한 수납 바스켓',description:'직접 작성한 설명',keywords:[]},label:{material:'직접 확인한 PP'},assets:{main:[],detail:[]}}}}));
  const options=JSON.parse(h.sqlite.prepare('SELECT payload FROM product_options').get().payload);
  options.rows[0].included=false;options.rows[0].unitsPerPack=2;options.rows[0].provenance.unitsPerPack='manual';
  h.sqlite.prepare('UPDATE product_options SET payload=?').run(JSON.stringify(options));
  const before={product:h.sqlite.prepare('SELECT * FROM products').get(),content:h.sqlite.prepare('SELECT * FROM product_content').get(),
   options:h.sqlite.prepare('SELECT * FROM product_options').get(),receipt:h.sqlite.prepare('SELECT * FROM collection_results').get(),context:h.sqlite.prepare('SELECT * FROM collection_context').get()};
  const body=await json(await h.route('/api/collection-jobs/job/source-supplement',{method:'POST',body:{capture:capture(),expectedProductVersion:before.product.updated_at}}));
  assert.equal(body.receipt.result.provider,'chrome-public-mobile-supplement-v1');assert.equal(body.receipt.result.description,'Collected source detail');
  assert.deepEqual(body.receipt.result.attributes,[{name:'material',value:'PP'}]);assert.deepEqual(body.receipt.result.options,plain(source.options));
  assert.deepEqual(body.receipt.result.images.slice(0,source.images.length),plain(source.images));assert.equal(body.receipt.result.images.at(-1).role,'detail');
  assert.deepEqual(h.sqlite.prepare('SELECT * FROM collection_results').get(),before.receipt);assert.deepEqual(h.sqlite.prepare('SELECT * FROM collection_context').get(),before.context);
  assert.deepEqual(h.sqlite.prepare('SELECT * FROM product_content').get(),before.content);assert.deepEqual(h.sqlite.prepare('SELECT * FROM product_options').get(),before.options);
  const after=h.sqlite.prepare('SELECT * FROM products').get();
  for(const field of ['title','source_price_cny','source_url','supply_price','sale_price','msrp','exchange_rate','supply_margin','coupang_margin'])assert.equal(after[field],before.product[field]);
  const context=await json(await h.route(base+'/translation-source'));assert.equal(context.description,'Collected source detail');assert.deepEqual(context.sourceGaps,[]);assert.equal(context.requestContext.categoryId,'80719');
  const view=await json(await h.route(base+'/quotation-fields')),fields=view.resolved.rows[0].fields;
  assert.equal(fields.title.value,'검토한 수납 바스켓');assert.equal(fields.noticeMaterial.value,'직접 확인한 PP');assert.match(fields.detailHtml.value,/직접 작성한 설명/);
  assert.equal(fields.mainImage.value,'');assert.equal(fields.detailImages.value,'');
  const replay=await json(await h.route('/api/collection-jobs/job/source-supplement',{method:'POST',body:{capture:capture(),expectedProductVersion:before.product.updated_at}}));
  assert.deepEqual(replay.receipt,body.receipt);assert.equal(h.sqlite.prepare('SELECT count(*) n FROM collection_source_supplements').get().n,1);
  assert.equal(h.aiSources.length,0);assert.equal(h.objects.size,0);assert.deepEqual(h.network,[]);
 }finally{h.close();}
});

for(const company of companies)test(`URL intake complements sparse desktop metadata before creating its editable source draft (${company.companyCode})`,async()=>{
 const h=harness(company,{sourceFetcher:async target=>{assert.equal(new URL(target).hostname,'detail.1688.com');return new Response(html(),{headers:{'content-type':'text/html'}});}});
 try{
  h.sqlite.prepare("UPDATE collection_jobs SET goal='work' WHERE id='job'").run();
  h.context.keywords='수납,바스켓';h.sqlite.prepare('UPDATE collection_context SET payload=? WHERE job_id=?').run(JSON.stringify(h.context),'job');
  h.bindings.AI.run=async(_model,input)=>{const source=JSON.parse(input.messages[1].content);h.aiSources.push(source);
   assert.equal(source.title,title);assert.equal(source.description,'Collected source detail');assert.equal(source.category.id,'80719');
   return{response:{title:'단일 수납 바스켓',description:'수집한 원문에 따른 검토용 상세 설명',keywords:['수납'],warnings:[],
    attributes:source.attributes.map((pair,sourceIndex)=>({sourceIndex,name:pair.name.startsWith('option:')?'옵션명':pair.name.replace('상품속성: ',''),value:pair.name.startsWith('option:')?'단일 바스켓':pair.value}))}};};
  let captureCalls=0;
  const result=await h.load('app/intake-collection.ts').collectIntakeProduct(await h.load('db/collection-jobs.ts').findCollectionJob('owner','job'),{
   fetcher:(path,init)=>h.route(path,{method:init?.method??'GET',body:init?.body}),signal:new AbortController().signal,onJob(){},onProgress(){},
   captureFromBrowser:async url=>{assert.equal(url,sourceUrl);captureCalls++;return capture();}});
  assert.match(result,/상품 초안 저장됨/);assert.equal(captureCalls,1);
  assert.ok(h.calls.indexOf('/api/collection-jobs/job/source-supplement')<h.calls.indexOf('/api/collection-jobs/job/product'));
  const product=h.sqlite.prepare('SELECT * FROM products').get(),base='/api/products/'+product.id,content=(await json(await h.route(base+'/content'))).content;
  assert.equal(product.source_url,sourceUrl);assert.equal(product.options_count,1);assert.equal(product.source_price_cny,12.5);assert.equal(product.supplier_hub_status,'미전송');
  assert.equal(content.seo.title.value,'검토 브랜드 단일 수납 바스켓');assert.equal(content.seo.description.value,'수집한 원문에 따른 검토용 상세 설명');assert.deepEqual(content.seo.keywords.value,['수납']);assert.equal(content.label.material.value,'PP');assert.equal(content.label.importer.value,company.companyName);
  assert.equal(content.assets.main.value.length,1);assert.equal(content.assets.detail.value.length,1);
  const source=await json(await h.route(base+'/translation-source'));assert.deepEqual(source.sourceGaps,[]);assert.equal(source.provider,'chrome-public-mobile-supplement-v1');
  const view=await json(await h.route(base+'/quotation-fields')),fields=view.resolved.rows[0].fields;assert.equal(view.categoryContext.categoryId,'80719');assert.equal(fields.title.value,content.seo.title.value);assert.equal(fields.noticeMaterial.value,'PP');assert.match(fields.detailHtml.value,/수집한 원문에 따른 검토용 상세 설명/);
  assert.deepEqual(['supplyPrice','salePrice','msrp'].map(key=>fields[key].value),['8750','14580','18950']);assert.ok(fields.mainImage.value);assert.ok(fields.detailImages.value);
  assert.equal(h.sqlite.prepare('SELECT count(*) n FROM products').get().n,1);assert.equal(h.objects.size,2);assert.equal(h.aiSources.length,1);
  assert.ok(h.network.every(host=>['detail.1688.com','cbu01.alicdn.com'].includes(host)),'all source/media fetches are intercepted local fixtures');
 }finally{h.close();}
});

test('sparse-source enrichment still rejects changed SKU, name, price, MOQ, source URL and stale product versions',async()=>{
 const h=harness();
 try{
  const source=original(h),full=captured(h),merge=h.load('app/collection-source-supplement.ts').supplementCollectionSource;
  for(const mutate of [next=>next.options[0].sku+='x',next=>next.options[0].name+='x',next=>next.options[0].unitPriceCny++,next=>next.options[0].minimumOrder++,next=>next.sourceUrl=next.sourceUrl.replace(offerId,'623000000002')]){
   const next=structuredClone(full);mutate(next);assert.throws(()=>merge(source,next));
  }
  await h.load('db/collection-results.ts').storeCollectionResult('owner','job',source);await json(await h.route('/api/collection-jobs/job/product',{method:'POST'}));
  await json(await h.route('/api/collection-jobs/job/source-supplement',{method:'POST',body:{capture:capture(),expectedProductVersion:'stale'}}),409);
  assert.equal(h.sqlite.prepare('SELECT count(*) n FROM collection_source_supplements').get().n,0);assert.deepEqual(h.network,[]);
 }finally{h.close();}
});
