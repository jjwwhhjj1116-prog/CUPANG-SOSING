import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {providedOptionModule} from './helpers/provided-option-quotation.mjs';
// Synthetic source only; every request below is an inert function.
const offerId='900000007301',sourceUrl=`https://detail.1688.com/offer/${offerId}.html`;
const job={id:'probe-job',offer_id:offerId,source_url:sourceUrl,goal:'collect',status:'awaiting_connector',created_at:'2026-10-01T00:00:00.000Z',updated_at:'2026-10-01T00:00:00.000Z',context:null};
const receivedAt='2026-10-01T00:00:01.000Z',capture={sourceUrl,scripts:['{"@type":"Product"}']};
const receipt=()=>({jobId:job.id,offerId,receipt:{receivedAt,result:{schemaVersion:1,sourceUrl,offerId,provider:'chrome-public-product-jsonld-v1',collectedAt:'2026-10-01T00:00:00.000Z',title:'합성 원문',description:'',options:[{sku:'source-sku',name:'검정',unitPriceCny:10,minimumOrder:1,stock:null}],images:[]}}});
const compiled=ts.transpileModule(fs.readFileSync(new URL('../app/intake-collection.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
function fixture({probe=async()=>capture,request=async()=>Response.json(receipt()),current=job,signal=new AbortController().signal}={}){
 const calls=[],updates=[],progress=[],imports=[],probes=[],full=[];const exports={};
 const fetcher=async(path,init)=>{calls.push({path,method:init?.method??'GET',body:init?.body});return request(path,init);};
 vm.runInNewContext(compiled,{exports,Error,AbortSignal,require(name){
  if(name==='@/app/collection-batch')return{importReceivedJobs:async(jobs,options)=>{imports.push(jobs.map(row=>({...row})));await options.onProductSaved(jobs[0].id,'new-draft');options.onResult(jobs[0].id,{status:'completed',productId:'new-draft',completedImages:0});}};
  if(name==='@/app/intake-seo')return{prepareIntakeSeoOutcome:()=>assert.fail('collect-only never generates')};
  return providedOptionModule(name.slice(2)+'.ts');
 }});
 return{calls,updates,progress,imports,probes,full,run:()=>exports.collectIntakeProduct(current,{signal,fetcher,onJob:row=>updates.push(row),onProgress:message=>progress.push(message),
  probeExistingFromBrowser:async(url,signal)=>{probes.push(url);return probe(url,signal);},captureFromBrowser:async()=>{full.push(true);throw Error('unexpected full capture');}})};
}
test('exact existing-page source is persisted before import without waiting for /collect or recapturing optional gaps',async()=>{
 const f=fixture();const before=JSON.stringify(job);assert.match(await f.run(),/상품 추가 완료/);assert.deepEqual(f.probes,[sourceUrl]);
 assert.deepEqual(f.calls.map(row=>[row.path,row.method]),[['/api/collection-jobs/probe-job/browser-capture','POST']]);assert.deepEqual(JSON.parse(f.calls[0].body),capture);
 assert.equal(f.imports.length,1);assert.equal(f.imports[0][0].received_at,receivedAt);assert.equal(f.updates.at(-1).product_id,'new-draft');assert.equal(f.full.length,0);assert.equal(JSON.stringify(job),before);
});
for(const missing of ['none','unsupported','error'])test(`unavailable existing probe ${missing} falls back to server once`,async()=>{
 const f=fixture({probe:async()=>{if(missing==='error')throw Error('probe unavailable');return null;}});await f.run();
 assert.deepEqual(f.calls.map(row=>[row.path.split('/').at(-1),row.method]),[['collect','POST']]);assert.equal(f.imports.length,1);
});
for(const failure of ['network','body','server'])test(`existing source ${failure} ACK loss reads same receipt once without another collection`,async()=>{
 const f=fixture({request:async path=>{if(path.endsWith('/result'))return Response.json(receipt());if(failure==='network')throw Error('ACK lost');if(failure==='body')return{ok:true,status:200,json:async()=>{throw Error('lostbody');}};return Response.json({error:'ambiguous'},{status:503});}});await f.run();
 assert.deepEqual(f.calls.map(row=>[row.path.split('/').at(-1),row.method]),[['browser-capture','POST'],['result','GET']]);assert.equal(f.imports.length,1);assert.equal(f.full.length,0);
});
for(const status of [401,403,409,422])test(`existing source rejection ${status} is terminal and never starts server collection`,async()=>{
 const f=fixture({request:async()=>Response.json({error:'명시적 캡처 거절',code:'SOURCE_NOT_COLLECTED'},{status})});await assert.rejects(f.run(),/명시적 캡처 거절/);
 assert.equal(f.calls.length,1);assert.equal(f.imports.length,0);assert.equal(f.full.length,0);
});
test('failed same-job recovery stays uncertain instead of a second collect or import',async()=>{
 const f=fixture({request:async path=>{if(path.endsWith('/result'))return Response.json({receipt:null});throw Error('ACK lost');}});await assert.rejects(f.run(),/저장된 원문도 확인하지 못했습니다/);
 assert.equal(f.calls.length,2);assert.equal(f.imports.length,0);assert.equal(f.full.length,0);
});
test('wrong-source capture receipt is terminal before import',async()=>{
 const f=fixture({request:async()=>{const body=receipt();body.receipt.result.sourceUrl='https://detail.1688.com/offer/900000007302.html';return Response.json(body);}});await assert.rejects(f.run());assert.equal(f.calls.length,1);assert.equal(f.imports.length,0);
});
for(const resolves of [true,false])test(`abort during existing probe ${resolves?'resolve':'reject'} never sends a receipt request or publishes late`,async()=>{
 const controller=new AbortController();let release;const f=fixture({signal:controller.signal,probe:()=>new Promise((resolve,reject)=>release=()=>resolves?resolve(capture):reject(Error('aborted')))});const run=f.run();
 for(let i=0;i<5&&!release;i++)await new Promise(resolve=>setImmediate(resolve));assert.ok(release);const progressBefore=f.progress.length;controller.abort();release();assert.equal(await run,undefined);
 assert.equal(f.calls.length,0);assert.equal(f.imports.length,0);assert.equal(f.updates.length,0);assert.equal(f.progress.length,progressBefore);
});
test('saved original linked to an existing product is never probed or re-imported',async()=>{
 const f=fixture({current:{...job,product_id:'working-product'}});assert.match(await f.run(),/기존 상품 열기/);assert.equal(f.probes.length,0);assert.equal(f.calls.length,0);assert.equal(f.imports.length,0);
});
test('already-received source never uses the new existing-page probe',async()=>{
 const f=fixture({current:{...job,received_at:receivedAt}});await f.run();assert.equal(f.probes.length,0);assert.deepEqual(f.calls.map(row=>row.method),['GET']);assert.equal(f.imports.length,1);
});
