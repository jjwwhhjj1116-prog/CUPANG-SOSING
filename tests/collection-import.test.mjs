import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const exports={};
vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../app/collection-import.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,Error,require:name=>{const capacity={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL(name.slice(2)==='app/collection-retry'?'../app/collection-retry.ts':'../app/collection-capacity.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports:capacity});return capacity;}});
const actualImport=exports.runCollectionImport;
// Legacy flow fixtures have no existing files; capacity failures are covered separately below.
const runCollectionImport=(job,total,options={})=>actualImport(job,total,{...options,fetcher:async(url,init)=>url.endsWith('/capacity')?reply({capacity:{usedSlots:0,totalImages:total,reusableIndices:[]}}):options.fetcher(url,init)});
const reply=(body,status=200)=>({ok:status===200,json:async()=>body});

test('selected subset keeps receipt indices and original ordering, skipping failed or unwanted images',async()=>{
 const calls=[],progress=[],selection=[199,2,0];
 const result=await runCollectionImport('job',200,{imageIndices:selection,fetcher:async(url,init)=>{
  if(url.endsWith('/product'))return reply({productId:'p'});
  const index=JSON.parse(init.body).index;calls.push(index);return reply({key:`owner/${index}`});
 },onProgress:value=>progress.push(value)});
 assert.equal(result.status,'completed');assert.deepEqual(calls,[0,2,199]);assert.deepEqual(selection,[199,2,0]);
 assert.equal(result.completedImages,3);assert.equal(progress.at(-1).totalImages,3);
});

test('invalid or oversized selections fail before creating a product or downloading files',async()=>{
 let calls=0;const fetcher=async()=>{calls++;return reply({productId:'p'});};
 for(const indices of [[0,0],[-1],[200],[1.5],Array.from({length:51},(_,i)=>i)]){
  await assert.rejects(()=>runCollectionImport('job',200,{imageIndices:indices,fetcher}),/50/);
 }
 await assert.rejects(()=>runCollectionImport('job',200,{fetcher}),/50/);
 assert.equal(calls,0);
});
test('import executes product first and images in order, without translation or submission calls',async()=>{
 const calls=[],progress=[];
 const outcome=await runCollectionImport('job',3,{fetcher:async(url,init)=>{calls.push([url,init]);return reply(url.endsWith('/product')?{productId:'p'}:{key:'owner/image'});},onProgress:p=>progress.push(p)});
 assert.equal(outcome.status,'completed');assert.equal(outcome.productId,'p');assert.equal(outcome.completedImages,3);
 assert.equal(calls[0][0],'/api/collection-jobs/job/product');assert.deepEqual(calls.slice(1).map(([,init])=>JSON.parse(init.body).index),[0,1,2]);assert.equal(progress.at(-1).completedImages,3);
});
test('product failure prevents image writes; uncertain responses are not treated as success',async()=>{
 for(const response of [reply({error:'conflict'},409),reply({})]){
  let calls=0;const outcome=await runCollectionImport('job',2,{fetcher:async()=>{calls++;return response;}});
  assert.equal(calls,1);assert.equal(outcome.status,'failed');assert.equal(outcome.completedImages,0);
 }
});
test('failed image stops later requests and retry reuses idempotent product/image endpoints',async()=>{
 let fail=true;const writes=new Set();let products=0;
 const fetcher=async(url,init)=>{
  if(url.endsWith('/product')){products++;return reply({productId:'p'});}
  const {index}=JSON.parse(init.body);if(index===1&&fail)return reply({error:'storage failure'},503);
  writes.add(index);return reply({key:`owner/${index}`,reused:writes.has(index)});
 };
 const first=await runCollectionImport('job',3,{fetcher});assert.equal(first.status,'failed');assert.equal(first.completedImages,1);assert.deepEqual([...writes],[0]);assert.match(first.error,/원본 2번 이미지/);
 fail=false;const second=await runCollectionImport('job',3,{fetcher});assert.equal(second.status,'completed');assert.equal(second.productId,first.productId);assert.equal(products,2);assert.equal(writes.size,3);
});
test('stop waits for active write to settle and never schedules the following image',async()=>{
 let stop=false,calls=0;
 const outcome=await runCollectionImport('job',3,{shouldStop:()=>stop,fetcher:async url=>{calls++;if(url.endsWith('/product'))return reply({productId:'p'});stop=true;return reply({key:'owner/a'});}});
 assert.equal(outcome.status,'stopped');assert.equal(outcome.completedImages,1);assert.equal(calls,2);
 let attempted=false;const before=await runCollectionImport('job',3,{shouldStop:()=>true,fetcher:async()=>{attempted=true;}});assert.equal(before.status,'stopped');assert.equal(attempted,false);
});
test('missing image acknowledgment and connection loss retain only confirmed counts',async()=>{
 for(const imageResponse of [()=>reply({}),()=>{throw Error('offline');}]){
  const outcome=await runCollectionImport('job',2,{fetcher:async url=>url.endsWith('/product')?reply({productId:'p'}):imageResponse()});
  assert.equal(outcome.status,'failed');assert.equal(outcome.productId,'p');assert.equal(outcome.completedImages,0);
 }
 await assert.rejects(()=>runCollectionImport('job',201),/이미지/);
});


test('fresh server capacity stops all writes when banners and selected originals exceed the limit',async()=>{
 for(const capacity of [{usedSlots:2,totalImages:49,reusableIndices:[]},{usedSlots:0,totalImages:48,reusableIndices:[]},null]){
  const calls=[];const result=await actualImport('job',49,{fetcher:async(url,init)=>{calls.push([url,init]);return reply({capacity});}});
  assert.equal(result.status,'failed');assert.equal(result.productId,null);assert.equal(calls.length,1);assert.equal(calls[0][0],'/api/collection-jobs/job/capacity');assert.equal(calls[0][1].method,undefined);
 }
});
test('full storage can retry confirmed originals without counting them twice',async()=>{
 const calls=[];const outcome=await actualImport('job',2,{fetcher:async(url)=>{calls.push(url);if(url.endsWith('/capacity'))return reply({capacity:{usedSlots:50,totalImages:2,reusableIndices:[0,1]}});return reply(url.endsWith('/product')?{productId:'p'}:{key:'owner/reused'});}});
 assert.equal(outcome.status,'completed');assert.equal(outcome.completedImages,2);assert.equal(calls.length,4);
});
test('capacity errors and cancellation after the read never create a product',async()=>{
 let calls=0,stop=false;const outcome=await actualImport('job',1,{shouldStop:()=>stop,fetcher:async()=>{calls++;stop=true;return reply({capacity:{usedSlots:0,totalImages:1,reusableIndices:[]}});}});
 assert.equal(outcome.status,'stopped');assert.equal(calls,1);
 const failed=await actualImport('job',1,{fetcher:async()=>reply({error:'offline'},503)});assert.equal(failed.status,'failed');assert.equal(failed.productId,null);
});


test('detached selections fail preflight without restoring user-removed originals',async()=>{
 let calls=0;const result=await actualImport('job',2,{fetcher:async()=>{calls++;return reply({capacity:{usedSlots:0,totalImages:2,reusableIndices:[],blockedIndices:[1]}});}});
 assert.equal(result.status,'failed');assert.equal(result.productId,null);assert.equal(calls,1);assert.match(result.error,/제외/);
});

test('opt-in transient retries reuse identical image request and count only confirmed writes',async()=>{
 let imageCalls=0;const waits=[];const progress=[];
 const outcome=await actualImport('job',1,{retryAttempts:3,retryWait:async ms=>waits.push(ms),onRetry:n=>progress.push(n),fetcher:async(url,init)=>{
  if(url.endsWith('/capacity'))return reply({capacity:{usedSlots:0,totalImages:1,reusableIndices:[]}});
  if(url.endsWith('/product'))return reply({productId:'p'});
  assert.equal(JSON.parse(init.body).index,0);imageCalls++;
  if(imageCalls<3)return {ok:false,status:503,body:{cancel:async()=>{}},json:async()=>({error:'temporary'})};
  return reply({key:'owner/a'});
 }});
 assert.equal(outcome.status,'completed');assert.equal(outcome.completedImages,1);assert.equal(imageCalls,3);
 assert.deepEqual(waits,[500,1000]);assert.deepEqual(progress,[2,3]);
});

test('conflicts are not retried and stopping during backoff prevents another write',async()=>{
 for(const scenario of ['conflict','stop']){
  let calls=0,stop=false;
  const outcome=await actualImport('job',0,{retryAttempts:3,shouldStop:()=>stop,retryWait:async()=>{stop=true;},fetcher:async()=>{
   calls++;return {ok:false,status:scenario==='conflict'?409:503,body:{cancel:async()=>{}},json:async()=>({error:'conflict'})};
  }});
  assert.equal(calls,1);assert.equal(outcome.status,scenario==='stop'?'stopped':'failed');
 }
});

test('network uncertainty has a bounded retry budget and never confirms a missing product acknowledgment',async()=>{
 let calls=0;
 const exhausted=await actualImport('job',0,{retryAttempts:3,retryWait:async()=>{},fetcher:async()=>{calls++;throw new Error('offline');}});
 assert.equal(calls,3);assert.equal(exhausted.status,'failed');assert.equal(exhausted.productId,null);
 calls=0;
 const malformed=await actualImport('job',0,{retryAttempts:3,retryWait:async()=>{},fetcher:async(url)=>{
  calls++;assert.ok(url.endsWith('/product'));return reply({});
 }});
 assert.equal(calls,1);assert.equal(malformed.status,'failed');assert.equal(malformed.productId,null);
});
