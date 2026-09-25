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
