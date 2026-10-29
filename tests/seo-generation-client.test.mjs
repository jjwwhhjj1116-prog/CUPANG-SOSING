import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {providedOptionModule} from './helpers/provided-option-quotation.mjs';
const plain=value=>JSON.parse(JSON.stringify(value)),deferred=()=>{let resolve;const promise=new Promise(done=>resolve=done);return{promise,resolve};};
async function fixture(){
 const api=providedOptionModule('app/seo-generation-client.ts'),server=providedOptionModule('app/seo-generation.ts'),configuration=server.seoGenerationConfiguration({SOURCEFLOW_QUOTATION_AI_PROVIDER:'workers-ai',SOURCEFLOW_QUOTATION_AI_FREE_ONLY:'true',AI:{run:async()=>assert.fail('Remote AI is forbidden')}});
 const view={purpose:'seo-generation',productId:'product',productVersion:'2026-10-29T00:00:00.000Z',contentRevision:3,optionRevision:4,sourceFingerprint:'a'.repeat(64),company:{code:'A01526306',name:'유앤채'},source:{title:'棉手套',description:'棉制手套',attributes:[{name:'材质',value:'棉'}],provenance:'manual',reference:'saved-source',category:{id:'82533',path:['장갑']},guidance:{features:'저장 특징',keywords:'면장갑'}},memo:{brand:'브랜드',features:'사용자 참고',keywords:'면장갑'},configuration,jobs:[],sourceCurrent:null};
 let job=null;const calls=[],states=[],jobs=[],f={api,view,calls,states,jobs,before:null,reply:null,controller:new AbortController()};
 f.fetcher=async(url,init={})=>{
  const body=init.body?JSON.parse(init.body):null,call={url,method:init.method??'GET',body};calls.push(call);assert.ok(url.startsWith('/api/products/product/seo-generation'));assert.equal(init.credentials,'same-origin');assert.equal(init.redirect,'error');assert.equal(init.cache,'no-store');await f.before?.(call,init);
  if(call.method==='GET'){const query=new URL(url,'https://app.test').searchParams;const value={...plain(view),jobs:job?[plain(job)]:[],sourceCurrent:view.sourceCurrent,...(query.has('idempotencyKey')?{idempotencyKey:query.get('idempotencyKey')}:{})};return f.reply?.(call,value)??Response.json(value);}
  if(body.action==='prepare'){
   const proof={purpose:'seo-generation',version:1,sourceFingerprint:view.sourceFingerprint,optionRevision:view.optionRevision,company:plain(view.company),memo:plain(body.memo)},review=await server.prepareSeoGenerationReview(view.source,proof,configuration);
   job={id:randomUUID(),productId:view.productId,productVersion:view.productVersion,contentRevision:view.contentRevision,status:'prepared',review,result:null,error:null,createdAt:new Date().toISOString(),approvedAt:null,startedAt:null,finishedAt:null};
  }else if(body.action==='approve'){assert.equal(body.jobId,job.id);assert.equal(body.reviewFingerprint,job.review.fingerprint);assert.equal(body.confirmPaid,true);job={...job,status:'approved',approvedAt:new Date().toISOString()};}
  else{assert.equal(body.action,'execute');assert.equal(body.jobId,job.id);job={...job,status:'completed',startedAt:new Date().toISOString(),finishedAt:new Date().toISOString(),result:{draft:{title:'면 장갑',keywords:['면장갑','장갑'],description:'면으로 만든 장갑입니다.',attributes:[],warnings:[]},responseId:'local-fixture',model:configuration.model,usage:null,generatedAt:new Date().toISOString(),provenance:'generated',appliedToContent:false}};}
  const value={purpose:'seo-generation',productId:view.productId,productVersion:view.productVersion,company:plain(view.company),sourceCurrent:true,job:plain(job)};return f.reply?.(call,value)??Response.json(value);
 };
 f.state=api.createSeoGenerationDraftState(plain(view));f.controls={signal:f.controller.signal,fetcher:f.fetcher,onState:value=>states.push(plain(value)),onJob:value=>jobs.push(plain(value)),isContextCurrent:()=>true};f.actions=()=>calls.filter(call=>call.method==='POST').map(call=>call.body.action);f.job=()=>job;return f;
}

test('free SEO context and notice parser reject any paid/model/destination or malformed scope alternative',async()=>{
 const f=await fixture();assert.equal((await f.api.readSeoGenerationContext('product',f.controller.signal,f.fetcher)).purpose,'seo-generation');
 for(const patch of [{freeOnly:false},{model:'paid-model'},{destination:'OpenAI Responses API'},{maxOutputTokens:4096},{notice:''},{configured:'true'},{extra:true}])assert.equal(f.api.parseSeoGenerationConfiguration({...f.view.configuration,...patch}),null);
 for(const patch of [{purpose:'translation'},{company:{code:'A01526306',name:'다른 회사'}},{sourceFingerprint:'bad'},{extra:true}]){f.reply=(call,value)=>call.method==='GET'?Response.json({...value,...patch}):null;await assert.rejects(f.api.readSeoGenerationContext('product',f.controller.signal,f.fetcher));}
 assert.equal(f.actions().length,0);
});

test('AI SEO prepares only until the real destination and free budget notice is confirmed',async()=>{
 const f=await fixture(),source=plain(f.state.source),outcome=await f.api.runSeoGenerationDraft(f.state,f.controls);assert.equal(outcome.job.status,'prepared');assert.equal(outcome.closed,false);assert.deepEqual(f.actions(),['prepare']);assert.match(outcome.message,/Cloudflare Workers AI|무료 한도/);assert.deepEqual(plain(f.state.source),source);assert.deepEqual(plain(outcome.job.review.seoGeneration.memo),f.view.memo);
 assert.equal(f.state.approvalSubmitted,false);assert.equal(f.state.executeSubmitted,false);assert.equal(f.calls.some(call=>/apply|content|options/.test(call.url)),false);
});

test('one confirmed purpose-bound generation retains factual attributes, accepts intentional empty output attributes and never applies content itself',async()=>{
 const f=await fixture(),result=await f.api.runSeoGenerationDraft(f.state,{...f.controls,confirmAi:true});assert.equal(result.job.status,'completed');assert.equal(result.closed,true);assert.equal(result.partial,false);assert.equal(result.label,'Workers AI SEO 생성 초안');assert.equal(result.job.result.draft.attributes.length,0);assert.equal(result.job.review.source.attributes.length,1);assert.deepEqual(f.actions(),['prepare','approve','execute']);assert.ok(f.states.some(state=>state.executeSubmitted));
 await f.api.runSeoGenerationDraft(f.state,{...f.controls,confirmAi:true});await f.api.refreshSeoGenerationDraft(f.state,f.controls);assert.deepEqual(f.actions(),['prepare','approve','execute']);assert.ok(f.calls.every(call=>call.url.includes('/seo-generation')));
});

for(const delivered of [false,true])test(`lost prepare response (${delivered}) can only recover the same exact key and cannot prepare another job`,async()=>{
 const f=await fixture(),original=f.fetcher;let lose=true;f.controls.fetcher=async(url,init)=>{const body=init?.body?JSON.parse(init.body):null;if(body?.action==='prepare'&&lose){lose=false;if(delivered)await original(url,init);else f.calls.push({url,method:'POST',body});throw Error('lost preparation');}return original(url,init);};
 const first=await f.api.runSeoGenerationDraft(f.state,{...f.controls,confirmAi:true});assert.equal(first.job?.status??null,delivered?'prepared':null);assert.equal(f.state.prepareSubmitted,true);assert.equal(f.state.executeSubmitted,false);const key=f.state.idempotencyKey;
 const restored=f.api.parseSeoGenerationDraftState(JSON.stringify(f.state),'product');assert.ok(restored);await f.api.runSeoGenerationDraft(restored,{...f.controls,confirmAi:true});assert.equal(f.actions().filter(action=>action==='prepare').length,1);assert.equal(f.actions().filter(action=>action==='execute').length,delivered?1:0);assert.equal(restored.idempotencyKey,key);assert.ok(f.calls.some(call=>call.method==='GET'&&call.url.includes('idempotencyKey='+key)));
});

for(const delivered of [false,true])test(`lost execution response (${delivered}) preserves submission flags and every recovery is read-only`,async()=>{
 const f=await fixture(),original=f.fetcher;f.controls.fetcher=async(url,init)=>{const body=init?.body?JSON.parse(init.body):null;if(body?.action==='execute'){if(delivered)await original(url,init);else f.calls.push({url,method:'POST',body});throw Error('lost execution');}return original(url,init);};
 const first=await f.api.runSeoGenerationDraft(f.state,{...f.controls,confirmAi:true});assert.equal(first.job.status,delivered?'completed':'approved');assert.equal(f.state.executeSubmitted,true);await f.api.runSeoGenerationDraft(f.state,{...f.controls,confirmAi:true});await f.api.refreshSeoGenerationDraft(f.state,f.controls);assert.equal(f.actions().filter(action=>action==='execute').length,1);
});

test('changed source, notice or company cannot approve the prepared purpose-specific request',async()=>{
 for(const change of ['source','notice','company']){const f=await fixture();await f.api.runSeoGenerationDraft(f.state,f.controls);if(change==='source')f.view.sourceFingerprint='b'.repeat(64);if(change==='notice')f.view.configuration.notice+=' 변경';if(change==='company')f.view.company={code:'A01464742',name:'와이홉'};const result=await f.api.runSeoGenerationDraft(f.state,{...f.controls,confirmAi:true});assert.equal(result.job.status,'prepared');assert.match(result.message,/변경/);assert.deepEqual(f.actions(),['prepare']);}
});

test('tampered purpose, source/memo/company proof, mixed recovery marker and option output cannot be promoted or executed',async()=>{
 for(const mode of ['purpose','source','memo','company','mixed','options']){const f=await fixture();f.reply=(call,value)=>{if(call.method!=='POST')return null;const altered=plain(value),job=altered.job;if(mode==='purpose')delete job.review.seoGeneration;if(mode==='source')job.review.source.title='다른 원문';if(mode==='memo')job.review.seoGeneration.memo.features='다른 참고';if(mode==='company')job.review.seoGeneration.company={code:'A01464742',name:'와이홉'};if(mode==='mixed')job.review.optionsRetry={scope:'options'};if(mode==='options'&&call.body.action==='execute')job.result.draft.attributes=[{sourceIndex:0,name:'재질',value:'면'}];return Response.json(altered);};
  if(mode==='options'){const result=await f.api.runSeoGenerationDraft(f.state,{...f.controls,confirmAi:true});assert.equal(result.job.status,'completed','only an independently validated same stored job can recover a tampered transport reply');assert.equal(result.job.result.draft.attributes.length,0);}
  else{const result=await f.api.runSeoGenerationDraft(f.state,{...f.controls,confirmAi:true});assert.equal(result.job.status,'prepared');assert.deepEqual(f.actions(),['prepare']);}
 }
});

test('schema and concurrent requests remain purpose-scoped and an aborted execute is never resent',async()=>{
 const f=await fixture();assert.ok(f.api.parseSeoGenerationDraftState(JSON.stringify(f.state),'product'));assert.equal(f.api.parseSeoGenerationDraftState({...f.state,schemaVersion:1},'product'),null);assert.equal(f.api.parseSeoGenerationDraftState({...f.state,purpose:'translation'},'product'),null);
 const entered=deferred(),gate=deferred(),original=f.fetcher;f.controls.fetcher=async(url,init)=>{if(init?.body&&JSON.parse(init.body).action==='execute'){entered.resolve();await gate.promise;}return original(url,init);};
 const pending=f.api.runSeoGenerationDraft(f.state,{...f.controls,confirmAi:true});await entered.promise;assert.equal(f.state.executeSubmitted,true);await assert.rejects(f.api.runSeoGenerationDraft(plain(f.state),{...f.controls,confirmAi:true}),/중복/);f.controller.abort();gate.resolve();await assert.rejects(pending);assert.equal(f.actions().filter(action=>action==='execute').length,1);
 const controller=new AbortController();await f.api.refreshSeoGenerationDraft(f.state,{...f.controls,signal:controller.signal});assert.equal(f.actions().filter(action=>action==='execute').length,1);
});
