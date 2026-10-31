import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {providedOptionModule} from './helpers/provided-option-quotation.mjs';
import {quotationAiApiFixture,companies,plain} from './helpers/quotation-ai-api.mjs';
import {mockProvider} from './helpers/quotation-ai.mjs';

const policy=providedOptionModule('app/quotation-text-execution.ts'),draft=providedOptionModule('app/product-label-draft.ts'),labels=providedOptionModule('app/product-label.ts');
const qwen='@cf/qwen/qwen3-30b-a3b-fp8',llama=policy.LEGACY_QUOTATION_TEXT_MODEL;
const enable=bindings=>Object.assign(bindings,{SOURCEFLOW_TEXT_PROVIDER:'workers-ai',SOURCEFLOW_TEXT_MODEL:qwen,SOURCEFLOW_TEXT_MAX_OUTPUT_TOKENS:'4096'});
const envelope=value=>({object:'chat.completion',model:qwen,choices:[{index:0,finish_reason:'stop',message:{role:'assistant',content:typeof value==='string'?value:JSON.stringify(value),reasoning_content:'not output: {"content":"999개","material":"invented","type":"invented"}'}}]});
const json=async(response,status=200)=>{assert.equal(response.status,status,await response.clone().text());return response.json();};
function labelFixture(){const url=new URL('./product-label-draft.test.mjs',import.meta.url),ast=ts.createSourceFile(url.pathname,fs.readFileSync(url,'utf8'),ts.ScriptTarget.Latest,true);const fn=ast.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text==='fixture');return vm.runInNewContext(fn.getText(ast)+'\nfixture',{model:labels,draft,version:'2026-10-18T00:00:00.000Z',JSON})({});}
function qwenProvider(){const fake=mockProvider();return{calls:fake.calls,async run(model,input){assert.equal(model,qwen);assert.equal(input.response_format,undefined);assert.equal(input.stream,false);assert.match(input.messages[1].content,/\n\/no_think$/u);const clean={...input,messages:input.messages.map(message=>message.role==='user'?{...message,content:message.content.replace(/\n\/no_think$/u,'')}:message)};return envelope((await fake.run(model,clean)).response);}};}

test('stage6/7 use the validated configured text model while preserving legacy enable and shared-cap policy',()=>{
 const env={SOURCEFLOW_QUOTATION_AI_PROVIDER:'workers-ai',SOURCEFLOW_QUOTATION_AI_FREE_ONLY:'true',AI:{run(){}}};assert.equal(policy.quotationTextConfiguration(env).model,llama);
 enable(env);const current=policy.quotationTextConfiguration(env);assert.equal(current.configured,true);assert.equal(current.model,qwen);assert.equal(current.executionPolicy.budget,'shared-utc-40-v1');assert.equal(policy.validQuotationTextExecution(current.executionPolicy),true);
 for(const patch of [{SOURCEFLOW_QUOTATION_AI_FREE_ONLY:'false'},{SOURCEFLOW_TEXT_MAX_OUTPUT_TOKENS:'bad'},{SOURCEFLOW_TEXT_MODEL:'@cf/qwen/qwen3.8-27b'},{SOURCEFLOW_TEXT_PROVIDER:'workers-ai',AI:null}])assert.equal(policy.quotationTextConfiguration({...env,...patch}).configured,false);
});

test('label Qwen serializes the deployed chat protocol, ignores separate reasoning, validates new proof and retains legacy decode',async()=>{
 const f=labelFixture(),configuration=policy.quotationTextConfiguration(enable({SOURCEFLOW_QUOTATION_AI_PROVIDER:'workers-ai',SOURCEFLOW_QUOTATION_AI_FREE_ONLY:'true',AI:{run(){}}})),calls=[];
 const response={content:'2개',material:'실리콘',type:'무릎 보호용품'};
 const result=await draft.executeProductLabelDraft(f.plan(),{async run(model,input){calls.push({model,input});return envelope(response);}},configuration.executionPolicy);
 assert.equal(calls.length,1);assert.equal(calls[0].model,qwen);assert.equal(calls[0].input.response_format,undefined);assert.equal(calls[0].input.stream,false);assert.match(calls[0].input.messages[1].content,/\n\/no_think$/u);assert.equal(result.values.netContents,'2개');assert.equal(result.model,qwen);assert.deepEqual(plain(result.executionPolicy),plain(configuration.executionPolicy));draft.verifyProductLabelDraftResult(f.view,'one',result);
 assert.match(result.warnings.join('\n'),/과금/);assert.throws(()=>draft.verifyProductLabelDraftResult(f.view,'one',{...result,executionPolicy:undefined}));assert.throws(()=>draft.verifyProductLabelDraftResult(f.view,'one',{...result,model:llama}));assert.throws(()=>draft.verifyProductLabelDraftResult(f.view,'one',{...result,executionPolicy:{...result.executionPolicy,budget:'unlimited'}}));
 const legacy=await draft.executeProductLabelDraft(f.plan(),{async run(model,input){assert.equal(model,llama);assert.equal(input.response_format.type,'json_schema');return{response:JSON.stringify(response)};}});draft.verifyProductLabelDraftResult(f.view,'one',legacy);assert.equal(legacy.executionPolicy,undefined);
 for(const value of [envelope('{"content":"2개","content":"3개","material":"실리콘","type":"용품"}'),{...envelope(response),model:'@cf/qwen/qwen3.8-27b'},{...envelope(response),choices:[{finish_reason:'length',message:{role:'assistant',content:JSON.stringify(response)}}]}])await assert.rejects(draft.executeProductLabelDraft(f.plan(),{async run(){return value;}},configuration.executionPolicy));
});

for(const company of companies)test(company.code+': actual quotation handlers bind Qwen policy, reject legacy completion promotion, preserve source and reserve each call once',async()=>{
 const f=await quotationAiApiFixture(company);try{
  const legacyView=await json(await f.request(undefined,'GET')),legacyBody=f.requestBody(legacyView),legacy=await json(await f.request(legacyBody)),before=f.state(),legacyCalls=f.provider.calls.length;
  assert.equal(legacy.job.model,llama);enable(f.h.bindings);const next=await json(await f.request(undefined,'GET'));assert.equal(next.configuration.model,qwen);assert.notEqual(next.fingerprint,legacyView.fingerprint);assert.equal(next.jobs.find(job=>job.id===legacy.job.id).model,llama);
  const currentQuote=await json(await f.h.route(f.base+'/quotation-fields'+f.query));const client=f.h.load('app/quotation-ai-client.ts');assert.equal(client.quotationAiJobForScope(next,currentQuote,f.id,null,true),null);
  await json(await f.request({...f.requestBody(next),idempotencyKey:legacyBody.idempotencyKey}),409);assert.equal(f.provider.calls.length,legacyCalls);
  const provider=qwenProvider();f.setProvider(provider);const body=f.requestBody(next),out=await json(await f.request(body));assert.equal(out.job.status,'completed');assert.equal(out.job.model,qwen);assert.equal(out.job.result.model,qwen);assert.equal(out.job.executionPolicy.protocol,'qwen-chat-json-v1');assert.ok(provider.calls.length);
  const stored=JSON.parse(f.jobs().find(job=>job.id===out.job.id).review);assert.deepEqual(stored.executionPolicy,out.job.executionPolicy);assert.equal(stored.fingerprint,next.fingerprint);
  assert.ok(client.quotationAiProposalChanges(currentQuote,out.job,next.fingerprint).length);assert.throws(()=>client.quotationAiProposalChanges(currentQuote,{...out.job,result:{...out.job.result,model:llama}},next.fingerprint));
  for(const model of [qwen,'unsupported-model'])assert.throws(()=>client.quotationAiProposalChanges(currentQuote,{...out.job,model:undefined,executionPolicy:undefined,result:{...out.job.result,model}},next.fingerprint));
  assert.equal((await json(await f.request(body))).job.id,out.job.id);assert.equal(f.state(),before);assert.equal(f.h.sqlite.prepare('SELECT requests FROM quotation_ai_daily').get().requests,legacyCalls+provider.calls.length);assert.deepEqual(f.h.network,[]);
 }finally{f.close();}
});

for(const status of ['running','uncertain'])test('legacy '+status+' remains a product-wide execution fence after switching to Qwen',async()=>{
 const f=await quotationAiApiFixture();try{
  const current=await json(await f.request(undefined,'GET'));await json(await f.request(f.requestBody(current)));const old=f.jobs()[0];f.h.sqlite.prepare('UPDATE quotation_ai_jobs SET status=? WHERE id=?').run(status,old.id);
  enable(f.h.bindings);const provider=qwenProvider();f.setProvider(provider);const next=await json(await f.request(undefined,'GET'));const result=await json(await f.request(f.requestBody(next)),409);assert.equal(result.code,'QUOTATION_AI_BUSY');assert.equal(provider.calls.length,0);assert.equal(f.jobs().find(job=>job.id===old.id).status,status);
 }finally{f.close();}
});

test('Qwen policy change and exhausted legacy shared40 limit cause zero provider calls without another model fallback',async()=>{
 const f=await quotationAiApiFixture();try{
  enable(f.h.bindings);const provider=qwenProvider();f.setProvider(provider);let current=await json(await f.request(undefined,'GET'));const body=f.requestBody(current);f.h.bindings.SOURCEFLOW_TEXT_MAX_OUTPUT_TOKENS='3000';await json(await f.request(body),409);assert.equal(provider.calls.length,0);
  current=await json(await f.request(undefined,'GET'));await f.h.load('db/quotation-ai-jobs.ts').reserveQuotationAiRequest();f.h.sqlite.prepare('UPDATE quotation_ai_daily SET requests=40').run();const result=await json(await f.request(f.requestBody(current)),409);assert.equal(result.code,'QUOTATION_AI_LIMIT');assert.equal(provider.calls.length,0);assert.equal(f.h.sqlite.prepare('SELECT requests FROM quotation_ai_daily').get().requests,40);
 }finally{f.close();}
});
