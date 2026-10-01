import test from 'node:test';
import assert from 'node:assert/strict';
import {mobileIntakeHarness} from './helpers/mobile-intake.mjs';

// Real handlers and temporary SQLite, recorded source facts, fixture AI/images.
// A cancelled view must not consume a late durable write as a new editor event.
for(const company of [{companyCode:'A01464742',companyName:'와이홉'},{companyCode:'A01526306',companyName:'유앤채'}])for(const boundary of ['product','images-batch'])test(`cancelled ${boundary} acknowledgement keeps the saved URL draft recoverable without publishing stale events (${company.companyCode})`,async()=>{
 const h=mobileIntakeHarness(company),controller=new AbortController(),late=[],progress=[];
 try{
  const job=await h.load('db/collection-jobs.ts').findCollectionJob('owner','job');
  const fetcher=async(path,init)=>{
   const response=await h.route(path,{method:init?.method??'GET',body:init?.body});
   if(path.endsWith('/'+boundary))controller.abort();
   return response;
  };
  const result=await h.load('app/intake-collection.ts').collectIntakeProduct(job,{signal:controller.signal,fetcher,
   onJob:value=>{if(controller.signal.aborted)late.push(value);},onProgress:value=>{if(controller.signal.aborted)progress.push(value);}});
  assert.equal(result,undefined);assert.deepEqual(late,[]);assert.deepEqual(progress,[]);
  const saved=h.sqlite.prepare('SELECT * FROM products').get();assert.ok(saved);assert.equal(saved.source_url,h.sourceUrl);assert.equal(saved.options_count,6);assert.equal(saved.supplier_hub_status,'미전송');
  const options=JSON.parse(h.sqlite.prepare('SELECT payload FROM product_options').get().payload);assert.equal(options.rows.length,6);
  const generatedBefore=h.aiSources.length,downloadsBefore=h.stats.downloads;
  if(boundary==='product'){assert.equal(generatedBefore,0);assert.equal(downloadsBefore,0);}else{assert.equal(generatedBefore,1);assert.equal(downloadsBefore,3);}
  assert.match(await h.intake(),/상품 초안 저장됨/);assert.equal(h.sqlite.prepare('SELECT count(*) n FROM products').get().n,1);
  assert.equal(h.sqlite.prepare('SELECT id FROM products').get().id,saved.id);assert.equal(h.aiSources.length,1);assert.equal(h.stats.downloads,19);
  const quote=await h.route('/api/products/'+saved.id+'/quotation-fields');assert.equal(quote.status,200);const body=await quote.json();
  assert.equal(body.categoryContext.categoryId,'80719');assert.equal(body.resolved.rows.filter(row=>row.optionId!==null).length,6);
  for(const row of body.resolved.rows)assert.ok(row.fields.noticeManufacturerImporter.value.includes('수입자: '+company.companyName));
  assert.equal(h.calls.some(path=>path.includes('/supplier-hub-receipt')),false);
 }finally{h.close();}
});
