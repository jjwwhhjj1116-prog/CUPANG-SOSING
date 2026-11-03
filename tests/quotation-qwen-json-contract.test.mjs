import test from 'node:test';
import assert from 'node:assert/strict';
import {providedOptionModule} from './helpers/provided-option-quotation.mjs';
import {quotationAiApiFixture,companies,plain} from './helpers/quotation-ai-api.mjs';
import {mockProvider,aiModule,aiFixture} from './helpers/quotation-ai.mjs';

const api=providedOptionModule('app/quotation-text-execution.ts'),provider=providedOptionModule('app/quotation-ai-provider.ts');
const qwen='@cf/qwen/qwen3-30b-a3b-fp8';
const legacy={version:1,model:qwen,protocol:'qwen-chat-json-v1',maxOutputTokens:4096,textMaxOutputTokens:4096,enableGate:'legacy-quotation-free-only-v1',budget:'shared-utc-40-v1'};
const current={...legacy,version:2,protocol:'qwen-json-schema-v2'};
const env=()=>({SOURCEFLOW_QUOTATION_AI_PROVIDER:'workers-ai',SOURCEFLOW_QUOTATION_AI_FREE_ONLY:'true',SOURCEFLOW_TEXT_PROVIDER:'workers-ai',SOURCEFLOW_TEXT_MODEL:qwen,SOURCEFLOW_TEXT_MAX_OUTPUT_TOKENS:'4096',AI:{run(){}}});
const chat=content=>({model:qwen,object:'chat.completion',choices:[{finish_reason:'stop',message:{role:'assistant',content}}]});
const request=()=>provider.quotationAiProviderInput({messages:[{role:'system',content:'synthetic quote'},{role:'user',content:JSON.stringify({task:'GET_COMMON_OTHER_ATTRIBUTES',fields:[{id:'exact-material',required:true,maxLength:20}]})}],max_tokens:4096,temperature:0.1});
const json=async(response,status=200)=>{assert.equal(response.status,status,await response.clone().text());return response.json();};

test('new configured Qwen policy retains the exact generated schema and versions its request identity',()=>{
 const selected=api.quotationTextConfiguration(env()).executionPolicy,input=request(),before=JSON.stringify(input);
 const wire=api.quotationTextProviderInput(input,selected);
 assert.equal(JSON.stringify(wire.response_format),JSON.stringify(input.response_format));
 assert.deepEqual(plain(selected),current);
 assert.equal(wire.stream,false);assert.equal(wire.max_tokens,4096);assert.equal(wire.temperature,0.1);
 assert.equal(wire.messages[1].content,input.messages[1].content+'\n/no_think');assert.equal(JSON.stringify(input),before);
 assert.equal(api.sameQuotationTextExecution(selected,legacy),false);
 for(const value of [{...current,version:1},{...legacy,version:2},{...current,protocol:'json_object'},{...current,budget:'unlimited'}])assert.equal(api.validQuotationTextExecution(value),false);
});

test('legacy v1 remains chat-only and keeps its original schema-free wire and raw duplicate-key text',()=>{
 const input=request(),wire=api.quotationTextProviderInput(input,legacy),raw='{"changes":[],"changes":[]}';
 assert.equal(wire.response_format,undefined);assert.equal(api.validQuotationTextExecution(legacy),true);
 assert.equal(api.quotationTextProviderResponse(chat(raw),legacy).response,raw);
 assert.throws(()=>api.quotationTextProviderResponse({response:{changes:[]}},legacy));
});

test('v2 accepts the documented parsed JSON object while preserving original chat text and strict dual matching',()=>{
 const value={changes:[]},raw=' { "changes": [], "changes": [] } ';
 assert.equal(api.quotationTextProviderResponse({response:value,model:qwen},current).response,JSON.stringify(value));
 assert.equal(api.quotationTextProviderResponse(chat(raw),current).response,raw.trim());
 assert.equal(api.quotationTextProviderResponse({...chat('{"changes":[]}'),response:value},current).response,'{"changes":[]}');
 for(const payload of [{response:[]},{response:'{"changes":[]}'},{response:value,reasoning_content:'not output'},
  {...chat('{"changes":[]}'),response:{changes:[{fieldKey:'foreign',value:'x'}]}},
  {...chat('{"changes":[]}'),model:'other-model'},chat('```json\n{"changes":[]}\n```'),
  {choices:[{finish_reason:'length',message:{role:'assistant',content:'{"changes":[]}'}}]}])assert.throws(()=>api.quotationTextProviderResponse(payload,current));
});

test('v2 still reaches the unchanged core duplicate, exact-key and field-scope rejection without retries',async()=>{
 const core=aiModule(),fixture=aiFixture(),plan=core.buildQuotationAiPlan(fixture.saved,fixture.scope),before=JSON.stringify(fixture.saved);
 for(const [payload,code] of [[chat('{"differentiatedFieldIds":[],"differentiatedFieldIds":[]}'),'AI_RESPONSE_DUPLICATE'],
  [{response:{differentiatedFieldIds:[],unexpected:'cannot become a field'}},'AI_RESPONSE'],
  [{response:{differentiatedFieldIds:['foreign-field-key']}},'AI_RESPONSE_SCOPE']]){
  let calls=0;
  await assert.rejects(core.executeQuotationAi(plan,{async run(){calls++;return api.quotationTextProviderResponse(payload,current);}},current),error=>error.code===code);
  assert.equal(calls,1);assert.equal(JSON.stringify(fixture.saved),before);
 }
});

for(const company of companies)test(company.code+': actual quote API sends all task schemas and accepts parsed JSON without quote writes or replay calls',async()=>{
 const f=await quotationAiApiFixture(company);try{
  Object.assign(f.h.bindings,{...env(),AI:f.h.bindings.AI});const fake=mockProvider(),calls=[];
  f.setProvider({async run(model,input){
   assert.equal(model,qwen);assert.equal(input.response_format.type,'json_schema');assert.equal(input.response_format.json_schema.additionalProperties,false);
   assert.equal(input.stream,false);assert.match(input.messages[1].content,/\n\/no_think$/u);
   calls.push(plain(input));const clean={...input,messages:input.messages.map(message=>message.role==='user'?{...message,content:message.content.replace(/\n\/no_think$/u,'')}:message)};
   return {response:JSON.parse((await fake.run(model,clean)).response),model:qwen};
  }});
  const view=await json(await f.request(undefined,'GET')),before=f.state(),body=f.requestBody(view),result=await json(await f.request(body));
  assert.equal(result.job.status,'completed');assert.deepEqual(plain(result.job.executionPolicy),current);assert.ok(calls.length);
  const quote=await json(await f.h.route(f.base+'/quotation-fields'+f.query));
  assert.ok(f.h.load('app/quotation-ai-client.ts').quotationAiProposalChanges(quote,result.job,view.fingerprint).length);
  const count=calls.length;assert.equal((await json(await f.request(body))).job.id,result.job.id);assert.equal(calls.length,count);
  assert.equal(f.state(),before);assert.equal(f.h.sqlite.prepare('SELECT requests FROM quotation_ai_daily').get().requests,count);assert.deepEqual(f.h.network,[]);
 }finally{f.close();}
});
