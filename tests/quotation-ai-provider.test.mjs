import test from 'node:test';
import assert from 'node:assert/strict';
import {providedOptionModule} from './helpers/provided-option-quotation.mjs';
import {aiModule,aiFixture,mockProvider} from './helpers/quotation-ai.mjs';
const {quotationAiProviderResponse:normalize,quotationAiProviderInput:providerInput}=providedOptionModule('app/quotation-ai-provider.ts');
const modern=text=>({id:'synthetic-chat',object:'chat.completion',created:1,model:'@cf/meta/llama-3.3-70b-instruct-sd',
  choices:[{index:0,message:{role:'assistant',content:text,refusal:null,annotations:null,audio:null,function_call:null,reasoning:null},finish_reason:'stop',logprobs:null,stop_reason:null}],
  usage:{prompt_tokens:1211,completion_tokens:25,total_tokens:1236,neurons:37.41468},response:text,tool_calls:[],metrics:null});
test('actual observed Workers AI envelope reaches exact proposal parser while usage metadata never becomes a field',async()=>{
  const core=aiModule(),f=aiFixture(),provider=mockProvider();const out=await core.executeQuotationAi(core.buildQuotationAiPlan(f.saved,f.scope),{run:async(...args)=>normalize(modern((await provider.run(...args)).response))});assert.ok(out.changes.length);
});
test('legacy own-provider response remains supported without extra keys entering model JSON',()=>assert.deepEqual(JSON.parse(JSON.stringify(normalize({response:'{}',usage:{arbitrary:true}}))),{response:'{}'}));
test('conflicting choices, truncation, nontext and tool requests are rejected rather than retried or executed',()=>{
  const one=modern('{}');for(const value of [null,'{}',{response:[]},{...one,response:'[]'},{...one,choices:[]},{...one,choices:[{...one.choices[0],finish_reason:'length'}]}, {...one,tool_calls:[{name:'save'}]}])assert.throws(()=>normalize(value));
});
test('provider envelope normalization preserves duplicate or unsafe inner JSON for strict parser rejection',async()=>{
  const core=aiModule(),f=aiFixture(),plan=core.buildQuotationAiPlan(f.saved,f.scope);
  await assert.rejects(core.executeQuotationAi(plan,{run:async()=>normalize(modern('{"differentiatedFieldIds":[],"differentiatedFieldIds":[]}'))}),e=>e.code==='AI_RESPONSE_DUPLICATE');
});
test('observed JSON mode object and whitespace-varied choice preserve the original text for core validation',()=>{
  const text='{ "differentiatedFieldIds": [] }',value={...modern(text),response:{differentiatedFieldIds:[]}};assert.equal(normalize(value).response,text);
  assert.equal(normalize({response:{changes:[]}}).response,'{"changes":[]}');
});
test('each generation schema restricts field identifiers and exact choice values, without unsupported uniqueItems',async()=>{
  const core=aiModule(),f=aiFixture(),mock=mockProvider(),inputs=[];
  await core.executeQuotationAi(core.buildQuotationAiPlan(f.saved,f.scope),{run:async(model,input)=>{const guarded=providerInput(input);inputs.push(guarded);return mock.run(model,input);}});
  assert.equal(inputs.length,4);assert.ok(inputs.every(input=>input.response_format.type==='json_schema'&&!JSON.stringify(input.response_format).includes('uniqueItems')));
  const common=inputs[1].response_format.json_schema.properties.changes.items.anyOf;assert.ok(common.some(field=>field.properties.value.enum));
  assert.ok(common.every(field=>field.additionalProperties===false&&field.properties.fieldKey.enum.length===1));
  const different=inputs.at(-1).response_format.json_schema.properties.options;assert.equal(different.minItems,f.options.rows.length);assert.equal(different.maxItems,f.options.rows.length);
  assert.deepEqual(JSON.parse(JSON.stringify(different.items.anyOf.map(item=>item.properties.optionId.enum[0]))),f.options.rows.map(row=>row.id));
});
test('unsupported generation task cannot send a provider request',()=>assert.throws(()=>providerInput({messages:[{role:'system',content:''},{role:'user',content:JSON.stringify({task:'SUBMIT',fields:[]})}],max_tokens:4096,temperature:0.1})));
