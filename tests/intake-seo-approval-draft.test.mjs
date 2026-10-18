import test from 'node:test';
import assert from 'node:assert/strict';
import {providedOptionModule} from './helpers/provided-option-quotation.mjs';

const load=providedOptionModule,run=load('app/intake-seo.ts').prepareIntakeSeoOutcome;
const id='70000000-0000-4000-8000-000000000001',collectionId='70000000-0000-4000-8000-000000000002';
async function fixture(status='prepared'){
 const now=new Date(),version=now.toISOString();
 const source=load('app/automation/translation.ts').validateTranslationSource({title:'单层运动保护带',description:'明确的商品原文',attributes:[{name:'option:collected-1',value:'黑色'}],provenance:'manual',reference:`수집 요청 ${collectionId} (https://detail.1688.com/offer/90000000700.html)의 저장 원문`,category:{id:'81452',path:['스포츠/레져','헬스/요가','헬스기구/용품','헬스보호대']}});
 const review=await load('app/automation/translation.ts').prepareTranslationReview(source,{provider:'openai',apiKey:'fixture-never-sent',model:'gpt-4.1-mini',maxOutputTokens:4096},now);
 return {job:{id,productId:'product-700',productVersion:version,contentRevision:1,status,review,result:null,error:null,createdAt:version,approvedAt:status==='approved'?version:null,startedAt:null,finishedAt:null},autoDraft:false,optionsOnly:false};
}
async function outcome(body,{status=200,throwResponse=false,abort=false}={}){
 const calls=[],controller=new AbortController();if(abort)controller.abort();
 const before=JSON.stringify(body),result=await run('product-700',async(path,init)=>{calls.push({path,body:JSON.parse(init.body)});if(throwResponse)throw Error('acknowledgement lost');return Response.json(body,{status});},controller.signal);
 assert.equal(JSON.stringify(body),before,'readiness cannot rewrite the acknowledged source or prepared review');
 return {result,calls};
}
const unready=({result})=>{assert.equal(result.manualReady,false);assert.equal(result.completed,false);assert.equal(result.reviewRequired,false);};

test('acknowledged ordinary OpenAI preparation makes only its editable source draft ready while preserving approval state',async()=>{
 for(const state of ['prepared','approved']){
  const body=await fixture(state),{result,calls}=await outcome(body);
  assert.equal(result.manualReady,true);assert.equal(result.completed,false);assert.equal(result.reviewRequired,false);
  assert.match(result.message,/원문 초안 저장 · SEO 생성 승인 대기/);assert.match(result.message,/직접 승인·실행/);
  assert.deepEqual(calls.map(call=>call.body.action),['prepare-collected']);assert.equal(body.job.status,state);assert.equal(body.job.result,null);
 }
});

test('normal reused preparation without autoDraft metadata stays ready without creating, approving or executing another request',async()=>{
 const body=await fixture();delete body.autoDraft;delete body.optionsOnly;
 body.replayed=true;body.productVersion=body.job.productVersion;
 const {result,calls}=await outcome(body);assert.equal(result.manualReady,true);assert.equal(result.completed,false);assert.equal(calls.length,1);
 assert.equal(calls[0].path,'/api/products/product-700/translation');assert.deepEqual(calls[0].body,{action:'prepare-collected',intake:true});
});

test('pending review readiness does not absorb running, failed, uncertain, unknown or already completed execution outcomes',async()=>{
 for(const status of ['running','failed','uncertain','unknown','completed']){
  const body=await fixture();body.job.status=status;const result=await outcome(body);unready(result);assert.equal(result.calls.length,1,status);
 }
 for(const patch of [{result:{}},{error:{code:'UNKNOWN',message:'unknown execution',mayHaveBeenCharged:true}},{startedAt:new Date().toISOString()},{finishedAt:new Date().toISOString()}]){
  const body=await fixture();Object.assign(body.job,patch);unready(await outcome(body));
 }
});

test('foreign, missing, damaged or expired source review acknowledgements remain unconfirmed',async()=>{
 const patches=[body=>{body.job.productId='other';},body=>{body.job.id='invalid';},body=>{body.job.productVersion='invalid';},body=>{body.job.contentRevision=-1;},body=>{body.productVersion='2026-01-01T00:00:00Z';},body=>{body.job.review.fingerprint='invalid';},body=>{body.job.review.maxOutputTokens=0;},body=>{body.job.review.model='';},body=>{body.job.review.expiresAt='2000-01-01T00:00:00Z';},body=>{body.job.review.source.reference='independent manual source';},body=>{delete body.job.review.source.category;},body=>{body.job.review.source.attributes='damaged';},body=>{body.job.review.inputCharacters++;},body=>{body.job.review.instructionsVersion='sourceflow-translation-v5';},body=>{body.job.approvedAt=body.job.createdAt;},body=>{body.job.status='approved';body.job.approvedAt=null;}];
 for(const patch of patches){const body=await fixture();patch(body);const result=await outcome(body);unready(result);assert.equal(result.calls.length,1);}
});

test('unknown providers, contradictory automatic flags and source/retry scopes do not become an ordinary manual-ready draft',async()=>{
 for(const destination of ['Cloudflare Workers AI','Google 번역','unknown']){const body=await fixture();body.job.review.destination=destination;unready(await outcome(body));}
 for(const patch of [{autoDraft:true},{autoDraft:'false'},{optionsOnly:true},{optionsOnly:null},{intakePreserved:true},{intakeSourceChanged:true},{intakeSourceChanged:null}]){
  const body=await fixture();Object.assign(body,patch);const result=await outcome(body);unready(result);assert.ok(result.calls.length<=2);
 }
 for(const key of ['optionsRetry','intakeOptions','seoRetry']){const body=await fixture();body.job.review[key]=null;unready(await outcome(body));}
});

test('failed or lost HTTP acknowledgements and cancellation cannot publish source-draft readiness',async()=>{
 for(const status of [400,409,429,503]){const result=await outcome(await fixture(),{status});unready(result);assert.equal(result.calls.length,1);}
 const missing=await outcome({},{});unready(missing);
 const lost=await outcome(await fixture(),{throwResponse:true});unready(lost);assert.equal(lost.calls.length,1);
 const aborted=await outcome(await fixture(),{abort:true});unready(aborted);assert.equal(aborted.calls.length,0);
});
