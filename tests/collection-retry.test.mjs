import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const exports={};
const now=Date.parse('2026-09-28T10:00:00Z');
class Clock extends Date { static now(){return now;} }
vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../app/collection-retry.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,Date:Clock,setTimeout});
const retry=exports.collectionRequestWithRetry;
test('rate limited image write waits for Retry-After and repeats the exact idempotent request',async()=>{
 const waits=[],calls=[];let released=0;
 const init={method:'POST',body:'{"index":3}'};
 const result=await retry('/images',init,{attempts:3,wait:async ms=>waits.push(ms),fetcher:async(url,request)=>{
  calls.push([url,request]);return calls.length===1?{status:429,headers:new Headers({'retry-after':'2'}),body:{cancel:async()=>{released++;}}}:Response.json({key:'owner/image'});
 }});
 assert.equal(result.status,200);assert.deepEqual(waits,[2000]);assert.equal(released,1);
 assert.equal(calls.length,2);assert.equal(calls[0][1],init);assert.equal(calls[1][1],init);
});
test('date backoff is honored but excessive and malformed Retry-After are never retried early',async()=>{
 for(const [header,expected] of [['Mon, 28 Sep 2026 10:00:03 GMT',3000],['0',0],['11',null],['bogus',null]]){
  let calls=0;const waits=[];const failed=new Response('limited',{status:429,headers:{'retry-after':header}});
  const result=await retry('/images',{}, {attempts:3,wait:async ms=>waits.push(ms),fetcher:async()=>++calls===1?failed:Response.json({})});
  assert.deepEqual(waits,expected===null?[]:[expected]);assert.equal(calls,expected===null?1:2);
  if(expected===null){assert.equal(result,failed);assert.equal(await result.text(),'limited');}
 }
});
test('bounded retries preserve the final response and stop before another write',async()=>{
 let calls=0;const waits=[];
 const response=await retry('/product',{}, {attempts:3,wait:async ms=>waits.push(ms),fetcher:async()=>{calls++;return new Response('busy',{status:503});}});
 assert.equal(calls,3);assert.deepEqual(waits,[500,1000]);assert.equal(await response.text(),'busy');
 let stopped=false;calls=0;
 await assert.rejects(()=>retry('/images',{}, {attempts:3,shouldStop:()=>stopped,wait:async()=>{stopped=true;},fetcher:async()=>{calls++;return new Response('',{status:429,headers:{'retry-after':'0'}});}}),/중단/);
 assert.equal(calls,1);
 for(const status of [400,401,403,409]){calls=0;await retry('/product',{}, {attempts:3,wait:async()=>assert.fail('no retry'),fetcher:async()=>{calls++;return new Response('',{status});}});assert.equal(calls,1);}
});
