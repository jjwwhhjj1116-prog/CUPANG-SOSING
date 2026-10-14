import test from 'node:test';
import assert from 'node:assert/strict';
import {mobileIntakeHarness} from './helpers/mobile-intake.mjs';

const companies=[{companyCode:'A01526306',companyName:'유앤채'},{companyCode:'A01464742',companyName:'와이홉'}];

// Real local handlers/SQLite and recorded supplier fixtures. No production,
// vendor, image CDN or Hub requests leave this harness.
for(const company of companies)for(const boundary of ['fetch','body']){
 test(`capacity ${boundary} deadline reaches the editable source draft without discarding caller cancellation (${company.companyCode})`,async()=>{
  const h=mobileIntakeHarness(company),parent=new AbortController(),observed=[];
  try{
   const capacity=h.load('app/collection-capacity-client.ts'),readCapacity=capacity.fetchCollectionCapacity;
   capacity.fetchCollectionCapacity=(url,options)=>readCapacity(url,{...options,timeoutMs:25});
   const job=await h.load('db/collection-jobs.ts').findCollectionJob('owner','job');
   const fetcher=async(path,init={})=>{
    if(path.endsWith('/capacity')){
     observed.push(init.signal);
     if(boundary==='fetch')return new Promise((_resolve,reject)=>init.signal.addEventListener('abort',()=>reject(new Error('fixture capacity transport aborted')),{once:true}));
     return new Response(new ReadableStream({start(controller){init.signal.addEventListener('abort',()=>controller.error(new Error('fixture capacity body aborted')),{once:true});}}),{headers:{'content-type':'application/json'}});
    }
    return h.route(path,{method:init.method??'GET',body:init.body});
   };
   await assert.rejects(h.load('app/intake-collection.ts').collectIntakeProduct(job,{signal:parent.signal,fetcher,onJob(){},onProgress(){}}),/상품·옵션 초안은 저장했습니다.*이미지.*재시도/s);
   assert.equal(observed.length,1);
   assert.notEqual(observed[0],parent.signal);
   assert.equal(observed[0].aborted,true,'the capacity deadline must abort its HTTP signal through the intake wrapper');
   assert.equal(parent.signal.aborted,false,'a failed optional read must not cancel the user workflow');
   assert.equal(h.sqlite.prepare('SELECT count(*) n FROM products').get().n,1);
   assert.equal(h.calls.filter(path=>path.endsWith('/product')).length,1);
   assert.equal(h.aiSources.length,1,'initial source draft must run once');
   assert.equal(h.stats.downloads,0,'unknown capacity must not authorize image writes');
   assert.equal(h.calls.some(path=>path.endsWith('/images')||path.endsWith('/images-batch')),false);
   const product=h.sqlite.prepare('SELECT * FROM products').get();
   assert.equal(product.options_count,6);assert.equal(product.supplier_hub_status,'미전송');
   assert.equal(h.sqlite.prepare('SELECT count(*) n FROM collection_results').get().n,1);
   const quote=await h.route('/api/products/'+product.id+'/quotation-fields');
   assert.equal(quote.status,200);const view=await quote.json();
   assert.equal(view.categoryContext.categoryId,'80719');
   assert.equal(JSON.parse(h.sqlite.prepare('SELECT payload FROM collection_context WHERE job_id=?').get('job').payload).company.code,company.companyCode);
   assert.equal(view.resolved.rows.filter(row=>row.optionId!==null).length,6);
   for(const row of view.resolved.rows)assert.ok(row.fields.noticeManufacturerImporter.value.includes(company.companyName));
  }finally{h.close();}
 });

 test(`caller cancellation during capacity ${boundary} retains the receipt and creates no product (${company.companyCode})`,async()=>{
  const h=mobileIntakeHarness(company),parent=new AbortController(),observed=[];
  try{
   const capacity=h.load('app/collection-capacity-client.ts'),readCapacity=capacity.fetchCollectionCapacity;
   capacity.fetchCollectionCapacity=(url,options)=>readCapacity(url,{...options,timeoutMs:1000});
   const job=await h.load('db/collection-jobs.ts').findCollectionJob('owner','job');
   const fetcher=async(path,init={})=>{
    if(path.endsWith('/capacity')){
     observed.push(init.signal);
     const stop=()=>{parent.abort();};
     if(boundary==='fetch')return new Promise((_resolve,reject)=>{init.signal.addEventListener('abort',()=>reject(new Error('fixture caller abort')),{once:true});queueMicrotask(stop);});
     return new Response(new ReadableStream({start(controller){init.signal.addEventListener('abort',()=>controller.error(new Error('fixture caller abort')),{once:true});queueMicrotask(stop);}}),{headers:{'content-type':'application/json'}});
    }
    return h.route(path,{method:init.method??'GET',body:init.body});
   };
   const late=[],message=await h.load('app/intake-collection.ts').collectIntakeProduct(job,{signal:parent.signal,fetcher,onJob(value){if(parent.signal.aborted)late.push(value);},onProgress(value){if(parent.signal.aborted)late.push(value);}});
   assert.equal(message,undefined);assert.equal(observed.length,1);assert.equal(observed[0].aborted,true);
   assert.deepEqual(late,[]);assert.equal(h.sqlite.prepare('SELECT count(*) n FROM products').get().n,0);
   assert.equal(h.calls.some(path=>path.endsWith('/product')),false);
   assert.equal(h.aiSources.length,0);assert.equal(h.stats.downloads,0);
   assert.equal(h.sqlite.prepare('SELECT count(*) n FROM collection_results').get().n,1);
   assert.equal(h.calls.some(path=>path.includes('/supplier-hub')),false);
  }finally{h.close();}
 });
}
