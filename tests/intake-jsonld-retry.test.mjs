import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {mobileIntakeHarness} from './helpers/mobile-intake.mjs';

// In-memory handlers/SQLite and local image bytes only. Source transport fails
// closed, so receipt retries cannot silently exercise a real supplier request.
test('bounded JSON-LD image-failure and stale-job retries preserve the receipt, edits and completed quote',async()=>{
 const sourceRequests=[],requests=[],updates=[],progress=[];
 const h=mobileIntakeHarness({sourceFetcher:async target=>{sourceRequests.push(target);assert.fail('source transport is forbidden');}});
 try{
  const offerId='900000007350',sourceUrl=`https://detail.1688.com/offer/${offerId}.html`;
  h.sqlite.prepare("UPDATE collection_jobs SET offer_id=?,source_url=?,goal='collect' WHERE id='job'").run(offerId,sourceUrl);
  const read=name=>fs.readFileSync(new URL('./fixtures/'+name,import.meta.url),'utf8');
  const mobile=h.load('app/alibaba-mobile-product.ts');
  const images=mobile.parseAlibabaMobileProduct(mobile.parseAlibabaMobilePage('<script>window.__INIT_DATA='+read('1688-mobile-813724060928.json')+';</script>',h.sourceUrl),JSON.parse(read('1688-skus-813724060928.json')),mobile.parseAlibabaMobileDescription(read('1688-description-813724060928.txt'))).images.slice(0,2).map(image=>image.url);
  const capture={sourceUrl,scripts:[JSON.stringify({'@type':'Product',url:sourceUrl,name:'합성 원문 상품',description:'',sku:'local-source-sku',image:images,
   offers:{'@type':'Offer',price:10,priceCurrency:'CNY',eligibleQuantity:{'@type':'QuantitativeValue',minValue:1}}})]};
  let fullCaptures=0,probes=0,probeAvailable=true;
  const fetcher=(path,init)=>{requests.push({path,method:init?.method??'GET'});return h.route(path,{method:init?.method??'GET',body:init?.body});};
  const run=current=>h.load('app/intake-collection.ts').collectIntakeProduct(current,{signal:new AbortController().signal,fetcher,onJob:value=>updates.push(value),onProgress:value=>progress.push(value),
   probeExistingFromBrowser:async()=>{probes++;return probeAvailable?capture:null;},captureFromBrowser:async()=>{fullCaptures++;assert.fail('bounded JSON-LD must not trigger full capture');}});
  const current=()=>h.load('db/collection-jobs.ts').findCollectionJob('owner','job');
  const stale=await current();h.stats.failImageIndex=0;
  await assert.rejects(run(stale),/이미지/);
  const linked=await current(),productId=linked.product_id;assert.ok(productId);assert.ok(linked.received_at);
  assert.equal(h.sqlite.prepare('SELECT count(*) n FROM products').get().n,1);assert.equal(fullCaptures,0);assert.equal(h.objects.size,1);
  const original=h.sqlite.prepare('SELECT * FROM collection_results').get();assert.equal(JSON.parse(original.payload).provider,'chrome-product-jsonld-v1');
  const content=JSON.parse(h.sqlite.prepare('SELECT payload FROM product_content WHERE product_id=?').get(productId).payload);
  const edited=await h.route(`/api/products/${productId}/content`,{method:'PATCH',body:{expectedRevision:content.revision,patch:{seo:{title:'직접 확인한 제목',description:''},assets:{main:[]}}}});
  assert.equal(edited.status,200,await edited.clone().text());
  const optionState=await (await h.route(`/api/products/${productId}/options`)).json(),rows=h.load('app/product-options.ts').optionInputs(optionState.options);rows[0].unitsPerPack=3;
  const optionEdit=await h.route(`/api/products/${productId}/options`,{method:'PATCH',body:{expectedRevision:optionState.options.revision,expectedProductVersion:optionState.productVersion,rows}});
  assert.equal(optionEdit.status,200,await optionEdit.clone().text());
  const editedOptions=h.sqlite.prepare('SELECT payload FROM product_options WHERE product_id=?').get(productId).payload;
  h.stats.failImageIndex=null;probeAvailable=false;requests.length=0;progress.length=0;
  const message=await run(await current());assert.match(message,/상품 추가 완료/);assert.doesNotMatch(message,/상세 원문 보완 미완료/);
  assert.equal(probes,1,'received image retry never probes Chrome');assert.equal(fullCaptures,0);assert.equal(h.objects.size,2);
  assert.ok(requests.every(row=>!row.path.endsWith('/collect')&&!row.path.endsWith('/source-supplement')&&!row.path.endsWith('/translation-source')));
  assert.deepEqual(h.sqlite.prepare('SELECT * FROM collection_results').get(),original);assert.equal(h.sqlite.prepare('SELECT payload FROM product_options WHERE product_id=?').get(productId).payload,editedOptions);
  const after=JSON.parse(h.sqlite.prepare('SELECT payload FROM product_content WHERE product_id=?').get(productId).payload);assert.equal(after.seo.title.value,'직접 확인한 제목');assert.equal(after.seo.description.value,'');assert.deepEqual(after.assets.main.value,[]);
  h.sqlite.prepare("UPDATE products SET quote_status='완료' WHERE id=?").run(productId);
  const retained=()=>JSON.stringify({product:h.sqlite.prepare('SELECT * FROM products WHERE id=?').get(productId),content:h.sqlite.prepare('SELECT * FROM product_content WHERE product_id=?').get(productId),options:h.sqlite.prepare('SELECT * FROM product_options WHERE product_id=?').get(productId),pricing:h.sqlite.prepare('SELECT * FROM product_price_policy WHERE product_id=?').get(productId),context:h.sqlite.prepare('SELECT * FROM collection_context').get(),receipt:h.sqlite.prepare('SELECT * FROM collection_results').get()});
  const before=retained(),downloads=h.stats.downloads;requests.length=0;
  const replay=await run(stale);assert.doesNotMatch(replay,/상세 원문 보완 미완료/);assert.equal(retained(),before,'stale collect returns the saved receipt and leaves completed quote and edits intact');
  assert.equal(requests[0].path,'/api/collection-jobs/job/collect');assert.equal(requests[0].method,'POST');assert.equal(probes,2);assert.equal(fullCaptures,0);assert.equal(h.stats.downloads,downloads);
  assert.deepEqual(sourceRequests,[]);assert.ok(progress.every(value=>!value.includes('현재 Chrome')));assert.ok(requests.every(row=>!row.path.endsWith('/source-supplement')));
  assert.equal(h.sqlite.prepare('SELECT count(*) n FROM collection_source_supplements').get().n,0);assert.equal(h.sqlite.prepare('SELECT count(*) n FROM products').get().n,1);assert.equal(h.aiSources.length,0);assert.equal(updates.at(-1).product_id,productId);
  assert.equal(h.load('app/collection-source-supplement.ts').canSupplementCollection(JSON.parse(original.payload)),true,'explicit source repair remains available');
 }finally{h.close();}
});
