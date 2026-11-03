import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {providedOptionModule} from './helpers/provided-option-quotation.mjs';

const api=providedOptionModule('app/automation/translation.ts'),plain=value=>JSON.parse(JSON.stringify(value));
const source={title:'棉袜 A1',description:'',attributes:[{name:'option:sku-a',value:'红色 2 pcs'},{name:'制造商',value:'合法工厂'}],provenance:'manual',reference:'synthetic structured transport source'};
const draft=()=>({title:'면 양말 A1',keywords:['면 양말'],description:'',attributes:[{sourceIndex:0,name:'옵션명',value:'빨강 2 pcs'},{sourceIndex:1,name:'제조사',value:'合法工厂'}],warnings:['제조사 법정 상호 원문 보존']});
function fixture(reply){
 const calls=[],config={provider:'workers-ai',apiKey:'',model:api.WORKERS_QWEN_MODEL,maxOutputTokens:4096,ai:{run:async(model,input)=>{assert.equal(model,api.WORKERS_QWEN_MODEL);calls.push(plain(input));return reply??{response:draft(),model};}}};
 return{calls,config};
}
const noNetwork=()=>assert.fail('structured transport tests must not call a real provider or application');

test('new Qwen approval binds a structured transport policy and sends its exact generated schema once',async()=>{
 const f=fixture(),review=await api.prepareTranslationReview(plain(source),f.config),before=JSON.stringify(review),request=api.buildTranslationRequest(review);
 assert.equal(review.qwenTranslationPolicy,'commerce-partial-attributes-v5');
 const {fingerprint}=providedOptionModule('app/automation/model.ts'),{fingerprint:stored,...signed}=review;
 assert.equal(await fingerprint(signed),stored);signed.qwenTranslationPolicy='commerce-literal-v2';assert.notEqual(await fingerprint(signed),stored);
 const result=await api.executeTranslation(review,f.config,noNetwork);
 assert.equal(f.calls.length,1);assert.deepEqual(f.calls[0].response_format,{type:'json_schema',json_schema:plain(request.text.format.schema)});
 assert.equal(result.draft.title,draft().title);assert.deepEqual(plain(result.draft.attributes),[draft().attributes[0]]);assert.ok(result.draft.warnings.some(value=>value.includes('법정 상호 원문을 보존')));assert.equal(result.appliedToContent,false);assert.equal(JSON.stringify(review),before);assert.deepEqual(review.source,source);
 // The language constraint reaches the provider. Legal manufacturer names
 // retain their separately bound exception, never a blanket Han exception.
 const schema=f.calls[0].response_format.json_schema;
 assert.ok(!new RegExp(schema.properties.title.pattern,'u').test('한글秘密'));
 const option=schema.properties.attributes.items.anyOf[0],legal=schema.properties.attributes.items.anyOf[1];
 assert.deepEqual(option.properties.name.enum,['옵션명']);assert.deepEqual(option.properties.sourceIndex.enum,[0]);assert.ok(!new RegExp(option.properties.value.pattern,'u').test('빨강红色'));
 assert.deepEqual(legal.properties.value.enum,['合法工厂']);
});

test('historical v6, commerce-v2 and structured-v3 approvals retain byte-identical provider requests',async()=>{
 const hashes={absent:'2c35d314c54207be06a7995e2ffb797ffebf952dea0cefe7c995b66ff3a4f304','commerce-literal-v2':'59808beb9ae3ccb46e844a898a72198aba311f085a9bb4361130ced446ded451','commerce-json-schema-v3':'ca63cbded323a56d2436d5a8cf83cc8646c4fdef5390a263ed578bee8f229537'};
 for(const [policy,expected]of Object.entries(hashes)){
  const f=fixture(),review=await api.prepareTranslationReview(plain(source),f.config);if(policy==='absent')delete review.qwenTranslationPolicy;else review.qwenTranslationPolicy=policy;
  await api.executeTranslation(review,f.config,noNetwork);assert.equal(f.calls.length,1);assert.equal(Object.hasOwn(f.calls[0],'response_format'),policy==='commerce-json-schema-v3');
  assert.equal(createHash('sha256').update(JSON.stringify(f.calls[0])).digest('hex'),expected);
 }
});

test('structured transport still rejects mixed-language titles, unsupported claims and source index drift without repair or retry',async()=>{
 const cases=[
  {change:output=>{output.title='요가秘密양말';},code:'QWEN_UNTRANSLATED_TEXT'},
  {change:output=>{output.title='방수 면 양말 A1';},code:'QWEN_UNSUPPORTED_CLAIM'},
  {change:output=>{output.attributes[0].sourceIndex=99;},code:'INVALID_MODEL_OUTPUT'},
 ];
 for(const entry of cases){
  const output=draft();entry.change(output);const f=fixture({response:output,model:api.WORKERS_QWEN_MODEL}),review=await api.prepareTranslationReview(plain(source),f.config),before=JSON.stringify(review);
  await assert.rejects(api.executeTranslation(review,f.config,noNetwork),error=>{assert.equal(error.code,entry.code);assert.equal(error.mayHaveBeenCharged,true);return true;});
  assert.equal(f.calls.length,1);assert.ok(f.calls[0].response_format);assert.equal(JSON.stringify(review),before);
 }
});

test('new literal-value policy fixes only whole numeric values and unambiguous ASCII codes to their source index',async()=>{
 const attributes=[
  {name:'상품속성: 成分及含量',value:'80'},
  {name:'상품속성: 针数',value:'200N'},
  {name:'상품속성: 货号',value:'YJW-957'},
  {name:'상품속성: 数值',value:'0.05'},
  {name:'상품속성: 颜色',value:'BLACK'},
  {name:'상품속성: 描述',value:'soft cotton'},
  {name:'상품속성: 尺寸',value:'80 cm'},
  {name:'상품속성: 成分',value:'80% 棉'},
  {name:'option:sku-a',value:'200N'},
  {name:'option-size:sku-b',value:'80'},
  {name:'상품속성: 季节',value:'Fall2026'},
 ];
 const bound={...plain(source),attributes},f=fixture(),review=await api.prepareTranslationReview(bound,f.config),before=JSON.stringify(review);
 assert.equal(review.qwenTranslationPolicy,'commerce-partial-attributes-v5');
 const request=api.buildTranslationRequest(review),rows=request.text.format.schema.properties.attributes.items.anyOf;
 for(const index of [0,1,2,3]){assert.deepEqual(plain(rows[index].properties.sourceIndex.enum),[index]);assert.deepEqual(plain(rows[index].properties.value),{type:'string',enum:[attributes[index].value]});}
 for(const index of [4,5,6,7,8,9,10])assert.equal(Object.hasOwn(rows[index].properties.value,'enum'),false,'text/option values must still be translated: '+index);
 // Historical v3 keeps its exact schema and source transport. The new enum
 // never infers that an unqualified number is a percentage or other unit.
 const legacy=api.buildTranslationRequest({...review,qwenTranslationPolicy:'commerce-json-schema-v3'});
 for(const index of [0,1,2,3])assert.equal(Object.hasOwn(legacy.text.format.schema.properties.attributes.items.anyOf[index].properties.value,'enum'),false);
 assert.equal(request.instructions,legacy.instructions);assert.equal(request.input[0].content[0].text,legacy.input[0].content[0].text);assert.equal(JSON.stringify(review),before);
});

test('literal-value schema reaches one provider call while changed numeric facts still fail without retry',async()=>{
 const bound={...plain(source),attributes:[{name:'상품속성: 成分及含量',value:'80'},{name:'상품속성: 货号',value:'YJW-957'}]},output={...draft(),attributes:[{sourceIndex:0,name:'성분 및 함량',value:'80'},{sourceIndex:1,name:'품번',value:'YJW-957'}],warnings:[]};
 const f=fixture({response:output}),review=await api.prepareTranslationReview(bound,f.config),before=JSON.stringify(review),result=await api.executeTranslation(review,f.config,noNetwork);
 assert.equal(f.calls.length,1);assert.deepEqual(f.calls[0].response_format.json_schema.properties.attributes.items.anyOf[0].properties.value,{type:'string',enum:['80']});assert.equal(result.draft.attributes[0].value,'80');assert.equal(JSON.stringify(review),before);
 const invalid=plain(output);invalid.attributes[0].value='81';const rejected=fixture({response:invalid}),again={...await api.prepareTranslationReview(bound,rejected.config),qwenTranslationPolicy:'commerce-literal-schema-v4'};
 await assert.rejects(api.executeTranslation(again,rejected.config,noNetwork),error=>error.code==='QWEN_UNSUPPORTED_FACT'&&error.mayHaveBeenCharged);
 assert.equal(rejected.calls.length,1);assert.equal(JSON.stringify(review),before);
});
