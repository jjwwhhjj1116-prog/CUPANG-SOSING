import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {mobileIntakeHarness} from './helpers/mobile-intake.mjs';
import {extractPageSource} from '../extensions/supplier-hub/page-source.mjs';

const companies=[{companyCode:'A01526306',companyName:'유앤채'},{companyCode:'A01464742',companyName:'와이홉'}];
const captureId='75400000-0000-4000-8000-000000000001';
const fixture=name=>fs.readFileSync(new URL('./fixtures/'+name,import.meta.url),'utf8');
async function selectedSource(h,company){
 const model=h.load('app/alibaba-mobile-product.ts');
 const original=model.parseAlibabaMobileProduct(model.parseAlibabaMobilePage('<script>window.__INIT_DATA='+fixture('1688-mobile-813724060928.json')+';</script>',h.sourceUrl),
  JSON.parse(fixture('1688-skus-813724060928.json')),model.parseAlibabaMobileDescription(fixture('1688-description-813724060928.txt')));
 const snapshot=extractPageSource({sourceUrl:h.sourceUrl,title:'合成版本锁商品',priceText:'¥5.00',minimumOrderText:'1件起批',scripts:[JSON.stringify({subject:'合成版本锁商品',
  skuModel:{offerId:'813724060928',skuInfoMap:{black:{skuId:'synthetic-lock-black',specAttrs:'黑色',price:'5.00'}}},offerImgList:[original.images[0].url]})]});
 const fingerprint=await h.load('app/source-inbox.ts').pageSourceFingerprint(snapshot);
 const response=await h.load('app/api/source-inbox/route.ts').POST(new Request('https://app.test/api/source-inbox',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({
  expectedOwnerId:'owner',expectedCompany:{code:company.companyCode,name:company.companyName},id:captureId,fingerprint,snapshot})}));
 assert.equal(response.status,200,await response.clone().text());
 return {format:'yoofam-saved-page-capture-v1',sourceUrl:h.sourceUrl,captureId,fingerprint,revision:1};
}
const job=h=>h.load('db/collection-jobs.ts').findCollectionJob('owner','job');
const route=h=>(path,init)=>h.route(path,{method:init?.method??'GET',body:init?.body});
function promotionBody(init){assert.equal(new Headers(init.headers).get('content-type'),'application/json');return JSON.parse(init.body);}
function supplement(h){
 const original=h.sqlite.prepare('SELECT * FROM collection_results WHERE job_id=?').get('job');
 const result={...JSON.parse(original.payload),description:'수집본 검증 뒤 다른 창에서 보완한 원문'};
 h.sqlite.prepare('INSERT INTO collection_source_supplements(job_id,owner_id,base_payload,captured_payload,payload,received_at) VALUES(?,?,?,?,?,?)')
  .run('job','owner',original.payload,JSON.stringify(result),JSON.stringify(result),new Date().toISOString());
 return result;
}

for(const company of companies)test(company.companyCode+': selected source promotion carries its immutable tuple and exact receipt clock through real API/SQLite',async()=>{
 const h=mobileIntakeHarness(company);
 try{
  const selection=await selectedSource(h,company);h.sqlite.prepare("UPDATE collection_jobs SET goal='collect' WHERE id='job'").run();
  const request=route(h),posts=[],reported=[];
  const message=await h.load('app/intake-collection.ts').collectIntakeProduct(await job(h),{selectedCapture:selection,signal:new AbortController().signal,
   fetcher:async(path,init)=>{if(path.endsWith('/product'))posts.push(promotionBody(init));return request(path,init);},onJob:value=>reported.push(value),onProgress(){}});
  assert.match(message,/상품 추가 완료/);assert.equal(posts.length,1);assert.deepEqual(posts[0],{expectedSource:{capture:selection,receivedAt:h.sqlite.prepare('SELECT received_at FROM collection_results').get().received_at}});
  assert.equal(h.sqlite.prepare('SELECT count(*) n FROM products').get().n,1);assert.ok(reported.at(-1).product_id);
  assert.equal(h.aiSources.length,0);assert.ok(h.network.every(host=>host==='cbu01.alicdn.com'));assert.equal(h.objects.size,1);
 }finally{h.close();}
});

for(const company of companies)test(company.companyCode+': a supplement between the verified result GET and product POST is terminal before product/SEO/image writes',async()=>{
 const h=mobileIntakeHarness(company);
 try{
  const selection=await selectedSource(h,company);h.sqlite.prepare("UPDATE collection_jobs SET goal='work' WHERE id='job'").run();
  const request=route(h),reported=[];let sawResult=false,changed=false,rejection;
  const fetcher=async(path,init)=>{
   if(path.endsWith('/product')){
    assert.equal(sawResult,true);assert.deepEqual(promotionBody(init).expectedSource.capture,selection);
    supplement(h);changed=true;
   }
   const response=await request(path,init);
   if(path.endsWith('/result')&&response.ok)sawResult=true;
   if(path.endsWith('/product')){rejection=await response.clone().json();assert.equal(response.status,409);assert.equal(rejection.code,'SOURCE_SELECTION_CONFLICT');}
   return response;
  };
  await assert.rejects(h.load('app/intake-collection.ts').collectIntakeProduct(await job(h),{selectedCapture:selection,signal:new AbortController().signal,fetcher,onJob:value=>reported.push(value),onProgress(){}}),
   error=>error.message===rejection?.error);
  assert.equal(changed,true);assert.equal(h.sqlite.prepare('SELECT count(*) n FROM collection_source_supplements').get().n,1);
  for(const table of ['products','collection_products','product_options','product_content','collection_images'])assert.equal(h.sqlite.prepare('SELECT count(*) n FROM '+table).get().n,0,table);
  assert.ok(reported.every(value=>!value.product_id));assert.equal(h.aiSources.length,0);assert.equal(h.objects.size,0);assert.deepEqual(h.network,[]);
  assert.ok(h.calls.every(path=>!path.endsWith('/image-draft')&&!path.endsWith('/images')&&!path.includes('/api/products/')));
 }finally{h.close();}
});

test('raw URL receipt import keeps the existing empty product POST contract',async()=>{
 const h=mobileIntakeHarness(companies[0]);
 try{
  const selection=await selectedSource(h,companies[0]);h.sqlite.prepare("UPDATE collection_jobs SET goal='collect' WHERE id='job'").run();
  const receipt=await h.route('/api/collection-jobs/job/collect',{method:'POST',body:{browserCapture:selection}});assert.equal(receipt.status,200);
  const received=await job(h),request=route(h);let posted=false;
  assert.match(await h.load('app/intake-collection.ts').collectIntakeProduct(received,{signal:new AbortController().signal,fetcher:async(path,init)=>{
   if(path.endsWith('/product')){posted=true;assert.equal(init.body,undefined);}return request(path,init);},onJob(){},onProgress(){}}),/상품 추가 완료/);
  assert.equal(posted,true);assert.ok(h.network.every(host=>host==='cbu01.alicdn.com'));
 }finally{h.close();}
});
