import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
function load(file) { const exports = {}; vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../' + file, import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, { exports, Error, URL, TextEncoder, setTimeout, require: name => load(name.slice(2) + '.ts') }); return exports; }
const { importReceivedJobs, pendingReceivedJobs } = load('app/collection-batch.ts');
const job = id => ({ id, offer_id: '123', source_url: 'https://detail.1688.com/offer/123.html', status: 'awaiting_connector', received_at: '2026-09-25T00:00:00Z', product_id: null });
const source = { schemaVersion: 1, offerId: '123', sourceUrl: job('a').source_url, provider: 'synthetic-test', collectedAt: '2026-09-25T00:00:00Z', title: 'fixture', description: '', options: [{ sku: 'a', name: 'one', unitPriceCny: 2, minimumOrder: 1, stock: null }], images: [] };
test('only received, non-cancelled, unlinked jobs are initially selected', () => {
  assert.deepEqual(Array.from(pendingReceivedJobs([job('a'), { ...job('b'), product_id: 'p' }, { ...job('c'), status: 'cancelled' }, { ...job('d'), received_at: null }]), item => item.id), ['a']);
});
test('batch binds receipts and isolates failures while continuing to the next product', async () => {
  const calls = [], results = [];
  await importReceivedJobs([job('bad'), job('good')], { shouldStop: () => false, onProgress: () => {}, onResult: (id, result) => results.push({ id, ...result }), fetcher: async (url) => {
    calls.push(url); const id = url.split('/')[3];
    return Response.json(url.endsWith('/result') ? { jobId: id === 'bad' ? 'other' : id, offerId: '123', receipt: { result: source } } : { productId: 'p' });
  } });
  assert.deepEqual(results.map(r => [r.id, r.status]), [['bad', 'failed'], ['good', 'completed']]);
  assert.equal(calls.some(url => url.includes('/bad/product')), false);
  assert.deepEqual(calls, ['/api/collection-jobs/bad/result', '/api/collection-jobs/good/result', '/api/collection-jobs/good/product']);
});
test('stop after reading a receipt prevents capacity checks and all writes', async () => {
  let stop = false; const calls = [], results = [];
  await importReceivedJobs([job('a'), job('b')], { shouldStop: () => stop, onProgress: () => {}, onResult: r => results.push(r), fetcher: async url => { calls.push(url); stop = true; return Response.json({ jobId: 'a', offerId: '123', receipt: { result: source } }); } });
  assert.equal(calls.length, 1); assert.equal(results.length, 0);
});
test('full storage still imports the product and reports preserved but omitted originals', async () => {
  const calls = [], results = [];
  await importReceivedJobs([job('a')], { shouldStop: () => false, onProgress: () => {}, onResult: (_id, r) => results.push(r), fetcher: async url => {
    calls.push(url);
    return Response.json(url.endsWith('/result') ? { jobId: 'a', offerId: '123', receipt: { result: { ...source, images: [{ url: 'https://cbu01.alicdn.com/a.jpg', role: 'main' }] } } } : url.endsWith('/capacity') ? { capacity: { usedSlots: 50, totalImages: 1, reusableIndices: [] } } : { productId: 'p' });
  } });
  assert.equal(results[0].status, 'completed'); assert.equal(results[0].completedImages, 0); assert.match(results[0].warnings[0], /1개/);
  assert.equal(calls.some(url => url.endsWith('/images')), false);
});

test('automatic import of a large SKU gallery includes details and reports the omitted source count',async()=>{
 const images=Array.from({length:65},(_,index)=>({url:`https://cbu01.alicdn.com/${index}.jpg`,role:index===0?'main':index<61?'additional':'detail'}));
 const options=Array.from({length:60},(_,index)=>({...source.options[0],sku:`sku-${index}`,name:`option-${index}`,imageIndex:index+1}));
 const saved=[],results=[];
 await importReceivedJobs([job('a')],{shouldStop:()=>false,onProgress:()=>{},onResult:(_id,result)=>results.push(result),fetcher:async(url,init)=>{
  if(url.endsWith('/result'))return Response.json({jobId:'a',offerId:'123',receipt:{result:{...source,images,options}}});
  if(url.endsWith('/capacity'))return Response.json({capacity:{usedSlots:2,totalImages:65,reusableIndices:[]}});
  if(url.endsWith('/product'))return Response.json({productId:'p'});
  const index=JSON.parse(init.body).index;saved.push(index);return Response.json({key:`owner/${index}.jpg`});
 }});
 assert.equal(results[0].status,'completed');assert.equal(results[0].completedImages,48);
 assert.ok(saved.includes(0));assert.ok(saved.includes(61));assert.equal(saved.length,48);
 assert.deepEqual(saved,[...saved].sort((a,b)=>a-b));assert.match(results[0].warnings.at(-1),/17개/);
});

test('linked recovery survives reload and excludes cancelled or unreceived jobs',()=>{
 const {linkedReceivedJobs}=load('app/collection-batch.ts');
 const jobs=[job('new'),{...job('linked'),product_id:'p'},{...job('cancelled'),product_id:'p2',status:'cancelled'},{...job('empty'),product_id:'p3',received_at:null}];
 assert.deepEqual(Array.from(linkedReceivedJobs(jobs),j=>j.id),['linked']);
});

test('linked recovery reuses the saved product, excludes removed originals and retries missing images',async()=>{
 const calls=[],results=[];const linked={...job('a'),product_id:'existing'};
 const receipt={...source,images:[{url:'https://cbu01.alicdn.com/a.jpg',role:'main'},{url:'https://cbu01.alicdn.com/b.jpg',role:'detail'},{url:'https://cbu01.alicdn.com/c.jpg',role:'detail'}]};
 await importReceivedJobs([linked],{shouldStop:()=>false,onProgress:()=>{},onResult:(_id,r)=>results.push(r),fetcher:async(url,init)=>{
  calls.push([url,init?.body]);
  if(url.endsWith('/result'))return Response.json({jobId:'a',offerId:'123',receipt:{result:receipt}});
  if(url.endsWith('/capacity'))return Response.json({capacity:{usedSlots:1,totalImages:3,reusableIndices:[0],blockedIndices:[1]}});
  if(url.endsWith('/product'))return Response.json({productId:'existing',reused:true});
  return Response.json({key:'image-'+JSON.parse(init.body).index});
 }});
 assert.equal(results[0].productId,'existing');assert.equal(results[0].status,'completed');assert.equal(results[0].completedImages,2);
 assert.deepEqual(calls.filter(([url])=>url.endsWith('/images')).map(([,body])=>JSON.parse(body).index),[0,2]);
 assert.match(results[0].warnings[0],/1개/);
});

test('batch recovers transient receipt, capacity, product and image errors with identical requests',async()=>{
 const calls=[],results=[],waits=[],counts=new Map();
 const receipt={...source,images:[{url:'https://cbu01.alicdn.com/a.jpg',role:'main'}]};
 await importReceivedJobs([job('a')],{shouldStop:()=>false,onProgress:()=>{},onResult:(_id,r)=>results.push(r),retryWait:async ms=>waits.push(ms),fetcher:async(url,init)=>{
  calls.push([url,init?.body]);const count=(counts.get(url)??0)+1;counts.set(url,count);
  if(count===1){if(url.endsWith('/product'))throw new Error('response lost');return Response.json({error:'temporary'},{status:503});}
  if(url.endsWith('/result'))return Response.json({jobId:'a',offerId:'123',receipt:{result:receipt}});
  if(url.endsWith('/capacity'))return Response.json({capacity:{usedSlots:0,totalImages:1,reusableIndices:[]}});
  return Response.json(url.endsWith('/product')?{productId:'p',reused:true}:{key:'image'});
 }});
 assert.equal(results[0].status,'completed');assert.equal(results[0].completedImages,1);
 assert.deepEqual(waits,[500,500,500,500]);
 const imageCalls=calls.filter(([url])=>url.endsWith('/images'));assert.equal(imageCalls.length,2);assert.equal(imageCalls[0][1],imageCalls[1][1]);
 assert.equal(counts.get('/api/collection-jobs/a/product'),2);
});

test('batch caps transient failures at three attempts and continues with the next job',async()=>{
 const calls=[],results=[];
 await importReceivedJobs([job('bad'),job('good')],{shouldStop:()=>false,onProgress:()=>{},onResult:(id,r)=>results.push([id,r.status]),retryWait:async()=>{},fetcher:async url=>{
  calls.push(url);if(url.includes('/bad/'))return Response.json({error:'unavailable'},{status:502});
  return Response.json(url.endsWith('/result')?{jobId:'good',offerId:'123',receipt:{result:source}}:{productId:'p'});
 }});
 assert.equal(calls.filter(url=>url.includes('/bad/')).length,3);assert.deepEqual(results,[['bad','failed'],['good','completed']]);
});

test('batch never retries permission failures and stopping during backoff prevents another request',async()=>{
 for(const status of [401,403,409,429]){
  let calls=0;const results=[];
  await importReceivedJobs([job('a')],{shouldStop:()=>false,onProgress:()=>{},onResult:(_id,r)=>results.push(r),retryWait:async()=>assert.fail('must not retry'),fetcher:async()=>{calls++;return Response.json({error:'blocked'},{status});}});
  assert.equal(calls,1);assert.equal(results[0].status,'failed');
 }
 let stop=false,calls=0;
 await importReceivedJobs([job('a'),job('b')],{shouldStop:()=>stop,onProgress:()=>{},onResult:()=>assert.fail('stopped before writes'),retryWait:async()=>{stop=true;},fetcher:async()=>{calls++;throw new Error('network');}});
 assert.equal(calls,1);
});

test('temporary capacity outage preserves editable product draft without image writes or false completion',async()=>{
 const calls=[],results=[];
 await importReceivedJobs([job('a')],{shouldStop:()=>false,onProgress:()=>{},onResult:(_id,r)=>results.push(r),retryWait:async()=>{},fetcher:async url=>{
  calls.push(url);
  if(url.endsWith('/result'))return Response.json({jobId:'a',offerId:'123',receipt:{result:{...source,images:[{url:'https://cbu01.alicdn.com/a.jpg',role:'main'}]}}});
  if(url.endsWith('/capacity'))return Response.json({error:'temporary'},{status:503});
  if(url.endsWith('/product'))return Response.json({productId:'draft'});
  assert.fail('must not download images');
 }});
 assert.equal(results[0].productId,'draft');assert.equal(results[0].status,'failed');assert.equal(results[0].completedImages,0);
 assert.equal(calls.filter(url=>url.endsWith('/capacity')).length,3);assert.equal(calls.filter(url=>url.endsWith('/product')).length,1);
});

test('capacity permission failures do not fall back to product writes',async()=>{
 for(const status of [401,403,409,429]){
  const results=[];
  await importReceivedJobs([job('a')],{shouldStop:()=>false,onProgress:()=>{},onResult:(_id,r)=>results.push(r),retryWait:async()=>{},fetcher:async url=>{
   if(url.endsWith('/result'))return Response.json({jobId:'a',offerId:'123',receipt:{result:{...source,images:[{url:'https://cbu01.alicdn.com/a.jpg',role:'main'}]}}});
   assert.ok(url.endsWith('/capacity'));return Response.json({error:'blocked'},{status});
  }});
  assert.equal(results[0].productId,null);assert.equal(results[0].status,'failed');
 }
});

test('intake image reservation survives batch selection and still creates the saved draft',async()=>{
 const images=Array.from({length:60},(_,index)=>({url:`https://cbu01.alicdn.com/${index}.jpg`,role:index===0?'main':index===59?'detail':'additional'}));
 const saved=[],results=[];let prepared=false;
 await importReceivedJobs([job('a')],{reservedImageSlots:1,shouldStop:()=>false,onProgress:()=>{},onProductSaved:async (_jobId,id)=>{assert.equal(id,'p');prepared=true;},onResult:(_id,result)=>results.push(result),fetcher:async(url,init)=>{
  if(url.endsWith('/result'))return Response.json({jobId:'a',offerId:'123',receipt:{result:{...source,images}}});
  if(url.endsWith('/capacity'))return Response.json({capacity:{usedSlots:2,totalImages:60,reusableIndices:[]}});
  if(url.endsWith('/product'))return Response.json({productId:'p'});
  assert.equal(prepared,true);const index=JSON.parse(init.body).index;saved.push(index);return Response.json({key:`owner/${index}.jpg`});
 }});
 assert.equal(results[0].status,'completed');assert.equal(saved.length,47);assert.ok(saved.includes(0)&&saved.includes(59));
 assert.match(results[0].warnings.at(-1),/13개/);assert.equal(saved.length+2+1,50);
});

test('network and HTML capacity outages retain source-based draft preparation without image writes',async()=>{
 for(const failure of ['network','html','successful-html','truncated-json']){
  const calls=[],results=[],prepared=[];
  await importReceivedJobs([job('a')],{shouldStop:()=>false,onProgress:()=>{},onResult:(_id,r)=>results.push(r),onProductSaved:async(id,productId)=>prepared.push([id,productId]),retryWait:async()=>{},fetcher:async url=>{
   calls.push(url);
   if(url.endsWith('/result'))return Response.json({jobId:'a',offerId:'123',receipt:{result:{...source,images:[{url:'https://cbu01.alicdn.com/a.jpg',role:'main'}]}}});
   if(url.endsWith('/capacity')){if(failure==='network')throw TypeError('network unavailable');return new Response(failure==='truncated-json'?'{"capacity":':'<html>Bad gateway</html>',{status:failure==='html'?502:200});}
   if(url.endsWith('/product'))return Response.json({productId:'draft'});
   assert.fail('outage must not trigger image writes');
  }});
  assert.equal(calls.filter(url=>url.endsWith('/capacity')).length,['network','html'].includes(failure)?3:1);
  assert.deepEqual(prepared,[['a','draft']]);assert.equal(results[0].productId,'draft');assert.equal(results[0].status,'failed');assert.equal(results[0].completedImages,0);
 }
});

test('stopping during capacity network failure does not save a product or prepare SEO',async()=>{
 let stopped=false;const results=[];
 await importReceivedJobs([job('a')],{shouldStop:()=>stopped,onProgress:()=>{},onResult:(_id,r)=>results.push(r),onProductSaved:async()=>assert.fail('no SEO after stop'),retryWait:async()=>{},fetcher:async url=>{
  if(url.endsWith('/result'))return Response.json({jobId:'a',offerId:'123',receipt:{result:{...source,images:[{url:'https://cbu01.alicdn.com/a.jpg',role:'main'}]}}});
  assert.ok(url.endsWith('/capacity'));stopped=true;throw TypeError('aborted');
 }});
 assert.equal(results.length,0);
});

test('HTML access denial never causes fallback writes',async()=>{
 for(const status of [401,403,409,429]){
  const results=[];
  await importReceivedJobs([job('a')],{shouldStop:()=>false,onProgress:()=>{},onResult:(_id,r)=>results.push(r),retryWait:async()=>{},fetcher:async url=>{
   if(url.endsWith('/result'))return Response.json({jobId:'a',offerId:'123',receipt:{result:{...source,images:[{url:'https://cbu01.alicdn.com/a.jpg',role:'main'}]}}});
   assert.ok(url.endsWith('/capacity'));return new Response('<html>Error</html>',{status});
  }});
  assert.equal(results[0].status,'failed');assert.equal(results[0].productId,null);
 }
});

test('a transient second capacity read still saves and prepares the source draft exactly once',async()=>{
 for(const failure of ['network',200,502,503,504]){
  let reads=0;const calls=[],results=[],prepared=[];
  await importReceivedJobs([job('a')],{shouldStop:()=>false,onProgress:()=>{},retryWait:async()=>{},onResult:(_id,r)=>results.push(r),onProductSaved:async(_id,id)=>prepared.push(id),fetcher:async url=>{
   calls.push(url);
   if(url.endsWith('/result'))return Response.json({jobId:'a',offerId:'123',receipt:{result:{...source,images:[{url:'https://cbu01.alicdn.com/a.jpg',role:'main'}]}}});
   if(url.endsWith('/capacity')){
    if(++reads===1)return Response.json({capacity:{usedSlots:0,totalImages:1,reusableIndices:[]}});
    if(failure==='network')throw TypeError('connection lost');
    return new Response('gateway unavailable',{status:failure});
   }
   assert.ok(url.endsWith('/product'));return Response.json({productId:'draft'});
  }});
  assert.equal(reads,failure===200?2:4);assert.equal(calls.filter(url=>url.endsWith('/product')).length,1);
  assert.deepEqual(prepared,['draft']);assert.equal(results[0].productId,'draft');
  assert.equal(results[0].status,'failed');assert.equal(results[0].completedImages,0);
  assert.match(results[0].error,/초안은 저장/);
 }
});

test('second capacity denial or cancellation does not create a draft',async()=>{
 for(const failure of [401,403,409,429,'cancel']){
  let reads=0,stopped=false;const results=[];
  await importReceivedJobs([job('a')],{shouldStop:()=>stopped,onProgress:()=>{},retryWait:async()=>{},onResult:(_id,r)=>results.push(r),onProductSaved:async()=>assert.fail('no draft preparation'),fetcher:async url=>{
   if(url.endsWith('/result'))return Response.json({jobId:'a',offerId:'123',receipt:{result:{...source,images:[{url:'https://cbu01.alicdn.com/a.jpg',role:'main'}]}}});
   assert.ok(url.endsWith('/capacity'));
   if(++reads===1)return Response.json({capacity:{usedSlots:0,totalImages:1,reusableIndices:[]}});
   if(failure==='cancel'){stopped=true;throw TypeError('cancelled');}
   return new Response('invalid capacity',{status:failure});
  }});
  assert.equal(results[0].productId,null);assert.equal(results[0].status,failure==='cancel'?'stopped':'failed');
 }
});


test('readable but invalid capacity data never authorizes image selection or fallback writes',async()=>{
 for(const badRead of [1,2])for(const capacity of [null,{}, {usedSlots:0,totalImages:2,reusableIndices:[]}, {usedSlots:0,totalImages:1,reusableIndices:[0],blockedIndices:[0]}]){
  let reads=0;const results=[];
  await importReceivedJobs([job('a')],{shouldStop:()=>false,onProgress:()=>{},onResult:(_id,r)=>results.push(r),fetcher:async url=>{
   if(url.endsWith('/result'))return Response.json({jobId:'a',offerId:'123',receipt:{result:{...source,images:[{url:'https://cbu01.alicdn.com/a.jpg',role:'main'}]}}});
   assert.ok(url.endsWith('/capacity'));
   return Response.json({capacity:++reads===badRead?capacity:{usedSlots:0,totalImages:1,reusableIndices:[]}});
  }});
  assert.equal(results[0].status,'failed');assert.equal(results[0].productId,null);
 }
});
