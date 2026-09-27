import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../app/reviewed-translation.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,Error});
const run=exports.runReviewedTranslation;
const job={id:'job',productId:'p',productVersion:'v',contentRevision:1,status:'prepared',review:{fingerprint:'review'}};
test('one reviewed action acknowledges approval then executes exactly once',async()=>{
 const calls=[],saved=[];
 const result=await run('p',job,{signal:new AbortController().signal,onJob:j=>saved.push(j.status),fetcher:async(url,init)=>{assert.equal(url,'/api/products/p/translation');const body=JSON.parse(init.body);calls.push(body);return Response.json({job:{...job,status:body.action==='approve'?'approved':'completed'}});}});
 assert.deepEqual(calls,[{action:'approve',jobId:'job',reviewFingerprint:'review',confirmPaid:true},{action:'execute',jobId:'job'}]);assert.deepEqual(saved,['approved','completed']);assert.equal(result.job.status,'completed');
});
test('approval failure or mismatched response cannot execute',async()=>{
 for(const reply of [()=>Response.json({error:'conflict'},{status:409}),()=>Response.json({job:{...job,id:'other',status:'approved'}}),()=>Response.json({job:{...job,status:'prepared'}})]){
  let calls=0;await assert.rejects(()=>run('p',job,{signal:new AbortController().signal,onJob:()=>assert.fail('unexpected state'),fetcher:async()=>{calls++;return reply();}}));assert.equal(calls,1);
 }
});
test('execution uncertainty retains acknowledged approval without automatic retries',async()=>{
 const saved=[];let calls=0;
 await assert.rejects(()=>run('p',job,{signal:new AbortController().signal,onJob:j=>saved.push(j),fetcher:async()=>{if(++calls===1)return Response.json({job:{...job,status:'approved'}});throw Error('lost acknowledgement');}}));
 assert.equal(calls,2);assert.equal(saved[0].status,'approved');
 const retried=[];await run('p',saved[0],{signal:new AbortController().signal,onJob:()=>{},fetcher:async(_url,init)=>{retried.push(JSON.parse(init.body).action);return Response.json({job:{...job,status:'running'},message:'existing execution'});}});assert.deepEqual(retried,['execute']);
});
test('cancellation before or after approval never launches the paid request',async()=>{
 for(const before of [true,false]){const controller=new AbortController();let calls=0;if(before)controller.abort();const result=await run('p',job,{signal:controller.signal,onJob:()=>controller.abort(),fetcher:async()=>{calls++;return Response.json({job:{...job,status:'approved'}});}});assert.equal(result,null);assert.equal(calls,before?0:1);}
});
