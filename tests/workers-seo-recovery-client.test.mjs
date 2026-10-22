import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../app/workers-seo-recovery-client.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,Error,crypto});
const input=()=>exports.newWorkersSeoRecoveryRequest('product','2026-10-22T00:00:00.000Z','failed-google');
const reviewed=request=>({workersRecoveryReview:true,job:{id:'separate-review',productId:request.productId,productVersion:request.productVersion,contentRevision:2,status:'prepared',result:null,review:{destination:'Cloudflare Workers AI',model:'@cf/meta/m2m100-1.2b',fingerprint:'a'.repeat(64),workersRecovery:{failedJobId:request.failedJobId,scope:'collected',strategy:'m2m-text-v1',model:'@cf/meta/m2m100-1.2b',maxCalls:4}}}});

test('Workers preparation sends one explicit same-origin review request with the retained nonce and never executes or applies',async()=>{
 const request=input(),calls=[],options={signal:new AbortController().signal,contentRevision:2,fetcher:async function(url,init){assert.equal(this,undefined);calls.push({url,init});return Response.json(reviewed(request));}};
 const job=await exports.prepareWorkersSeoRecovery(request,options);assert.equal(job.id,'separate-review');assert.equal(calls.length,1);
 assert.equal(calls[0].url,'/api/products/product/translation');assert.equal(calls[0].init.method,'POST');
 assert.deepEqual(JSON.parse(calls[0].init.body),{action:'prepare-collected-m2m',expectedVersion:request.productVersion,idempotencyKey:request.idempotencyKey,failedJobId:request.failedJobId});
 assert.match(request.idempotencyKey,/^[a-f0-9-]{36}$/u);assert.ok(!calls.some(call=>/execute|apply|collection|supplier-hub/.test(call.url)));
});

test('wrong product, clock, revision, provider, failure reference and missing recovery ACK cannot become a reviewed job',async()=>{
 for(const change of [value=>{value.job.productId='other';},value=>{value.job.productVersion='old';},value=>{value.job.contentRevision=1;},value=>{value.job.review.destination='Google 번역';},value=>{value.job.review.workersRecovery.failedJobId='other-failure';},value=>{delete value.workersRecoveryReview;},value=>{delete value.job.review.workersRecovery;},value=>{value.job.review.fingerprint='invalid';}]){
  const request=input(),value=reviewed(request);change(value);let calls=0;
  await assert.rejects(()=>exports.prepareWorkersSeoRecovery(request,{signal:new AbortController().signal,contentRevision:2,fetcher:async()=>{calls++;return Response.json(value);}}),/일치하지/);assert.equal(calls,1);
 }
});

test('Qwen versions, another strategy/model or an invalid call budget cannot be accepted as a dedicated translation review',async()=>{
 for(const change of [value=>{value.job.review.workersRecovery.version=5;},value=>{delete value.job.review.workersRecovery.strategy;},value=>{value.job.review.workersRecovery.strategy='other';},value=>{value.job.review.workersRecovery.model='@cf/qwen/qwen3-30b-a3b-fp8';},value=>{value.job.review.model='@cf/qwen/qwen3-30b-a3b-fp8';},...[-1,0,9,1.5,null].map(maxCalls=>value=>{value.job.review.workersRecovery.maxCalls=maxCalls;})]){
  const request=input(),value=reviewed(request);change(value);
  await assert.rejects(()=>exports.prepareWorkersSeoRecovery(request,{signal:new AbortController().signal,contentRevision:2,fetcher:async()=>Response.json(value)}),/일치하지/);
 }
});

test('generic configured ceiling bounds the exact reviewed budget without requiring all eight calls',async()=>{
 const request=input(),fetcher=async()=>Response.json(reviewed(request));
 const job=await exports.prepareWorkersSeoRecovery(request,{signal:new AbortController().signal,contentRevision:2,expectedMaxCalls:8,fetcher});assert.equal(job.review.workersRecovery.maxCalls,4);
 await assert.rejects(exports.prepareWorkersSeoRecovery(request,{signal:new AbortController().signal,contentRevision:2,expectedMaxCalls:3,fetcher}),/일치하지/);
 let calls=0;await assert.rejects(exports.prepareWorkersSeoRecovery(request,{signal:new AbortController().signal,contentRevision:2,expectedMaxCalls:0,fetcher:async()=>{calls++;return Response.json(reviewed(request));}}));assert.equal(calls,0);
});

test('only confirmed free dedicated configuration exposes a bounded translation limit',()=>{
 const settings={configured:true,freeOnly:true,strategy:'m2m-text-v1',model:'@cf/meta/m2m100-1.2b',maxCalls:8};assert.equal(exports.workersSeoRecoveryM2mLimit(settings),8);
 for(const patch of [{configured:false},{freeOnly:false},{strategy:'other'},{model:'@cf/qwen/qwen3-30b-a3b-fp8'},{maxCalls:0},{maxCalls:9}])assert.equal(exports.workersSeoRecoveryM2mLimit({...settings,...patch}),null);
});

test('failed or uncertain HTTP delivery does not retry without another caller action',async()=>{
 for(const mode of ['http','lost-ack']){
  const request=input();let calls=0;
  await assert.rejects(()=>exports.prepareWorkersSeoRecovery(request,{signal:new AbortController().signal,contentRevision:2,fetcher:async()=>{calls++;if(mode==='lost-ack')throw Error('synthetic network failure');return Response.json({error:'서버 설정 확인 필요'},{status:503});}}));
  await Promise.resolve();assert.equal(calls,1);
 }
});

test('aborted preparation cannot dispatch or accept late review data',async()=>{
 const request=input(),controller=new AbortController();let calls=0;controller.abort();
 await assert.rejects(()=>exports.prepareWorkersSeoRecovery(request,{signal:controller.signal,contentRevision:2,fetcher:async()=>{calls++;return Response.json(reviewed(request));}}));assert.equal(calls,0);
 const second=new AbortController();await assert.rejects(()=>exports.prepareWorkersSeoRecovery(request,{signal:second.signal,contentRevision:2,fetcher:async()=>({ok:true,json:async()=>{second.abort();return reviewed(request);}})}));
});
