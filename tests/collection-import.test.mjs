import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const exports={};
vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../app/collection-import.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,Error});
const {runCollectionImport}=exports;
const reply=(body,status=200)=>({ok:status===200,json:async()=>body});
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
 const first=await runCollectionImport('job',3,{fetcher});assert.equal(first.status,'failed');assert.equal(first.completedImages,1);assert.deepEqual([...writes],[0]);
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
