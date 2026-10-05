import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {mobileIntakeHarness} from './helpers/mobile-intake.mjs';
const read=name=>fs.readFileSync(new URL('./fixtures/'+name,import.meta.url),'utf8');
const sku=JSON.parse(read('1688-public-sku-813724060928.json'));
const capture=sourceUrl=>({format:'1688-public-mobile-capture-v1',sourceUrl,mobileHtml:'<script>window.__INIT_DATA='+read('1688-mobile-813724060928.json')+';</script>',skuPayload:JSON.parse(read('1688-skus-813724060928.json')),detailSource:read('1688-description-813724060928.txt')});
const base=h=>h.load('app/alibaba-mobile-product.ts').parseAlibabaPublicSkuProduct(sku,h.sourceUrl);
const request=h=>(path,init)=>h.route(path,{method:init?.method??'GET',body:init?.body});
async function seed(h){const original=base(h);await h.load('db/collection-results.ts').storeCollectionResult('owner','job',original);return original;}

for(const company of [{companyCode:'A01464742',companyName:'와이홉'},{companyCode:'A01526306',companyName:'유앤채'}])test(`explicit Chrome supplement keeps original receipt and manual product values (${company.companyCode})`,async()=>{
 const h=mobileIntakeHarness(company);
 try{
  h.sqlite.prepare("UPDATE collection_jobs SET goal='collect' WHERE id='job'").run();
  const original=await seed(h);await h.intake();const id=h.latest.product_id;
  let content=JSON.parse(h.sqlite.prepare('SELECT payload FROM product_content WHERE product_id=?').get(id).payload);
  const edited=await h.route(`/api/products/${id}/content`,{method:'PATCH',body:{expectedRevision:content.revision,patch:{seo:{title:'검토한 제목',keywords:[]},label:{material:''},assets:{main:[]}}}});
  assert.equal(edited.status,200,await edited.clone().text());
  const options=JSON.parse(h.sqlite.prepare('SELECT payload FROM product_options WHERE product_id=?').get(id).payload);
  options.rows[0].included=false;options.rows[1].unitsPerPack=3;options.rows[1].provenance.unitsPerPack='manual';
  h.sqlite.prepare('UPDATE product_options SET payload=? WHERE product_id=?').run(JSON.stringify(options),id);
  const before=h.sqlite.prepare('SELECT * FROM products WHERE id=?').get(id),raw=h.sqlite.prepare('SELECT * FROM collection_results').get(),context=h.sqlite.prepare('SELECT payload FROM collection_context').get().payload;
  const firstImages=h.sqlite.prepare('SELECT image_index,object_key FROM collection_images ORDER BY image_index').all();
  let captured=0;
  const message=await h.load('app/collection-supplement-client.ts').completeCollectionSupplement({jobId:'job',offerId:'813724060928',sourceUrl:h.sourceUrl,productId:id,productVersion:before.updated_at,provider:original.provider},
    {fetcher:request(h),signal:new AbortController().signal,captureFromBrowser:async()=>{captured++;return capture(h.sourceUrl);},onProgress(){}});
  assert.match(message,/보완했습니다/);assert.equal(captured,1);assert.equal(h.aiSources.length,0);
  assert.deepEqual(h.sqlite.prepare('SELECT * FROM collection_results').get(),raw,'initial receipt and time stay byte-for-byte immutable');
  assert.equal(h.sqlite.prepare('SELECT payload FROM collection_context').get().payload,context);
  const effective=await h.load('db/collection-results.ts').readCollectionResult('owner','job');
  assert.equal(effective.result.images.length,19);assert.equal(effective.result.attributes.length,24);
  assert.deepEqual(JSON.parse(JSON.stringify(effective.result.options)),JSON.parse(JSON.stringify(original.options)));
  assert.deepEqual(JSON.parse(JSON.stringify(effective.result.images.slice(0,4))),JSON.parse(JSON.stringify(original.images)));
  assert.deepEqual(h.sqlite.prepare('SELECT image_index,object_key FROM collection_images WHERE image_index<4 ORDER BY image_index').all(),firstImages);
  content=JSON.parse(h.sqlite.prepare('SELECT payload FROM product_content WHERE product_id=?').get(id).payload);
  assert.equal(content.seo.title.value,'검토한 제목');assert.deepEqual(content.seo.keywords.value,[]);assert.equal(content.label.material.value,'');assert.deepEqual(content.assets.main.value,[]);assert.equal(content.assets.detail.value.length,11);
  const afterOptions=JSON.parse(h.sqlite.prepare('SELECT payload FROM product_options WHERE product_id=?').get(id).payload);
  assert.equal(afterOptions.rows[0].included,false);assert.equal(afterOptions.rows[0].imageKey,options.rows[0].imageKey);assert.equal(afterOptions.rows[1].unitsPerPack,3);
  for(let i=0;i<options.rows.length;i++)assert.equal(afterOptions.rows[i].unitCostCny,options.rows[i].unitCostCny);
  const after=h.sqlite.prepare('SELECT * FROM products WHERE id=?').get(id);
  for(const field of ['source_price_cny','supply_price','sale_price','msrp','exchange_rate','source_url'])assert.equal(after[field],before[field]);
  assert.notEqual(after.updated_at,before.updated_at);assert.equal(h.objects.size,19);
  const {offerId:originalOffer,...originalBody}=original;assert.equal(originalOffer,'813724060928');
  const replay=await h.route('/api/collection-jobs/job/result',{method:'POST',body:originalBody});assert.equal(replay.status,200,await replay.clone().text());assert.equal((await replay.json()).receipt.result.images.length,19);
  assert.equal((await h.route('/api/collection-jobs/job/result',{method:'POST',body:{...originalBody,title:'different original'}})).status,409);
  const source=await (await h.route(`/api/products/${id}/translation-source`)).json();assert.equal(source.attributes.length,24);assert.equal(source.jobId,'job');assert.equal(source.sourceGaps.length,0);
  await h.load('app/collection-supplement-client.ts').completeCollectionSupplement({jobId:'job',offerId:'813724060928',sourceUrl:h.sourceUrl,productId:id,productVersion:after.updated_at,provider:effective.result.provider},
    {fetcher:request(h),signal:new AbortController().signal,captureFromBrowser:async()=>assert.fail('stored supplement is reused'),onProgress(){}});
  assert.equal(h.sqlite.prepare('SELECT count(*) n FROM collection_source_supplements').get().n,1);assert.equal(h.sqlite.prepare('SELECT count(*) n FROM products').get().n,1);assert.equal(h.objects.size,19);
 }finally{h.close();}
});

test('new explicit intake supplements SKU-only server response before creating the draft; unavailable Chrome retains the partial source',async()=>{
 for(const available of [true,false]){
  const h=mobileIntakeHarness({sourceFetcher:async target=>{const host=new URL(target).hostname;return host==='h5api.m.1688.com'?Response.json(sku):new Response('<html>Public data unavailable</html>',{headers:{'content-type':'text/html'}});}});
  try{
   h.sqlite.prepare("UPDATE collection_jobs SET goal='collect' WHERE id='job'").run();let captured=0;
   const result=await h.load('app/intake-collection.ts').collectIntakeProduct(await h.load('db/collection-jobs.ts').findCollectionJob('owner','job'),{
    fetcher:request(h),signal:new AbortController().signal,onJob(){},onProgress(){},captureFromBrowser:async()=>{captured++;if(!available)throw Error('Chrome unavailable');return capture(h.sourceUrl);}});
   assert.equal(captured,1);assert.equal(h.sqlite.prepare('SELECT count(*) n FROM products').get().n,1);
   assert.equal(h.objects.size,available?19:4);assert.equal(h.aiSources.length,0);
   assert.equal(JSON.parse(h.sqlite.prepare('SELECT payload FROM collection_results').get().payload).images.length,4);
   if(available){const content=JSON.parse(h.sqlite.prepare('SELECT payload FROM product_content').get().payload);assert.equal(content.seo.title.provenance,'collected');assert.ok(h.calls.indexOf('/api/collection-jobs/job/source-supplement')<h.calls.indexOf('/api/collection-jobs/job/product'));}
   else assert.match(result,/Chrome unavailable/);
  }finally{h.close();}
 }
});

test('mismatched offer/SKU/price and incomplete Chrome captures cannot supplement; owner/version/cancellation still guard writes',async()=>{
 const h=mobileIntakeHarness();
 try{
  const original=await seed(h),parsed=h.load('app/browser-product-capture.ts').parseBrowserProductCapture(capture(h.sourceUrl),h.sourceUrl);
  const merge=h.load('app/collection-source-supplement.ts').supplementCollectionSource;
  for(const modify of [value=>value.offerId='999',value=>value.options[0].sku='999',value=>value.options[0].unitPriceCny+=1,value=>value.options[0].name='different',value=>value.options.pop()]){const next=structuredClone(parsed);modify(next);assert.throws(()=>merge(original,next));}
  const partial=await h.route('/api/collection-jobs/job/source-supplement',{method:'POST',body:{capture:{format:'1688-public-sku-capture-v1',sourceUrl:h.sourceUrl,skuPayload:sku}}});assert.equal(partial.status,422);
  h.sqlite.prepare("UPDATE collection_jobs SET owner_id='other' WHERE id='job'").run();assert.equal((await h.route('/api/collection-jobs/job/source-supplement',{method:'POST',body:{capture:capture(h.sourceUrl)}})).status,404);
  h.sqlite.prepare("UPDATE collection_jobs SET owner_id='owner',status='cancelled' WHERE id='job'").run();assert.equal((await h.route('/api/collection-jobs/job/source-supplement',{method:'POST',body:{capture:capture(h.sourceUrl)}})).status,409);
  h.sqlite.prepare("UPDATE collection_jobs SET status='awaiting_connector' WHERE id='job'").run();await h.route('/api/collection-jobs/job/product',{method:'POST'});
  assert.equal((await h.route('/api/collection-jobs/job/source-supplement',{method:'POST',body:{capture:capture(h.sourceUrl),expectedProductVersion:'old'}})).status,409);
  assert.equal(h.sqlite.prepare('SELECT count(*) n FROM collection_source_supplements').get().n,0);
 }finally{h.close();}
});
