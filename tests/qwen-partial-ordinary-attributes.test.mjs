import test from 'node:test';
import assert from 'node:assert/strict';
import {providedOptionModule} from './helpers/provided-option-quotation.mjs';

const api=providedOptionModule('app/automation/translation.ts'),plain=value=>JSON.parse(JSON.stringify(value));
const source={title:'棉袜 A1',description:'',attributes:[{name:'option:sku-a',value:'红色 2 pcs'},{name:'상품속성: 成分及含量',value:'80'},{name:'상품속성: 适用年龄',value:'青年18-40/中年40-60/少年13-18'},{name:'制造商',value:'合法工厂'}],provenance:'manual',reference:'synthetic partial ordinary attributes'};
const draft=()=>({title:'면 양말 A1',keywords:['면 양말'],description:'',attributes:[{sourceIndex:0,name:'옵션명',value:'빨강 2 pcs'},{sourceIndex:1,name:'성분 및 함량',value:'80'},{sourceIndex:2,name:'적용 연령',value:'청년18-40/중년40-60/청소년13-18'},{sourceIndex:3,name:'제조사',value:'合法工厂'}],warnings:[]});
function fixture(output){const calls=[],config={provider:'workers-ai',apiKey:'',model:api.WORKERS_QWEN_MODEL,maxOutputTokens:4096,ai:{run:async(model,input)=>{assert.equal(model,api.WORKERS_QWEN_MODEL);calls.push(plain(input));return{response:output,model};}}};return{calls,config};}
const noNetwork=()=>assert.fail('partial attribute tests must never call a real model, app or supplier');

for(const issue of ['number','language','claim'])test(`one unsafe ordinary ${issue} is omitted with indexed coverage while strict Korean SEO and options remain usable`,async()=>{
 const output=draft();output.attributes[2].value=issue==='number'?'청년18-40/중년40-65/청소년13-18':issue==='language'?'青年18-40/中年40-60/少年13-18':'방수 청년18-40/중년40-60/청소년13-18';
 const f=fixture(output),review=await api.prepareTranslationReview(plain(source),f.config),before=JSON.stringify(review),responseBefore=JSON.stringify(output);
 assert.equal(review.qwenTranslationPolicy,'commerce-partial-attributes-v5');
 const result=await api.executeTranslation(review,f.config,noNetwork);
 assert.equal(f.calls.length,1);assert.equal(result.draft.title,'면 양말 A1');assert.equal(result.draft.attributes.find(row=>row.sourceIndex===0).value,'빨강 2 pcs');assert.equal(result.draft.attributes.some(row=>row.sourceIndex===2),false);
 assert.ok(result.draft.warnings.some(value=>value.includes('sourceIndex 2')&&value.includes('일반 상품속성')));assert.ok(result.draft.warnings.some(value=>value.includes('누락 2개')));
 assert.doesNotThrow(()=>api.validateQwenTranslationDraft(result.draft,source),'the saved sanitized draft must pass the unchanged apply validator');
 assert.equal(JSON.stringify(review),before);assert.equal(JSON.stringify(output),responseBefore);assert.equal(result.appliedToContent,false);
});

test('old v4 Qwen and v5 full-attribute contracts remain hard failures for the same ordinary mismatch',async()=>{
 const output=draft();output.attributes[1].value='81';const f=fixture(output),review={...await api.prepareTranslationReview(plain(source),f.config),qwenTranslationPolicy:'commerce-literal-schema-v4'},before=JSON.stringify(review);
 await assert.rejects(api.executeTranslation(review,f.config,noNetwork),error=>error.code==='QWEN_UNSUPPORTED_FACT');assert.equal(f.calls.length,1);assert.equal(JSON.stringify(review),before);
 const fresh=fixture(output),next=await api.prepareTranslationReview(plain(source),fresh.config),result=await api.executeTranslation(next,fresh.config,noNetwork);assert.equal(result.draft.attributes.some(row=>row.sourceIndex===1),false);assert.deepEqual(fresh.calls[0],f.calls[0],'v5 changes only the reviewed local result policy, not the v4 provider wire');
 assert.throws(()=>api.validateTranslationDraft(output,source,'sourceflow-translation-v5','all',api.WORKERS_QWEN_MODEL),error=>error.code==='UNSUPPORTED_FACT');
});

test('new partial policy cannot hide invalid indices, duplicate indices, required option facts, legal names or SEO failures',async()=>{
 const scenarios=[
  {change:output=>{output.attributes[0].value='빨강 3 pcs';},code:'QWEN_UNSUPPORTED_FACT'},
  {change:output=>{output.attributes[0].value='红色 2 pcs';},code:'QWEN_UNTRANSLATED_TEXT'},
  {change:output=>{output.attributes[0].value='방수 빨강 2 pcs';},code:'QWEN_UNSUPPORTED_CLAIM'},
  {change:output=>{output.attributes[3].value='다른 공장';},code:'QWEN_LEGAL_NAME_CHANGED'},
  {change:output=>{output.attributes[1].sourceIndex=99;},code:'INVALID_MODEL_OUTPUT'},
  {change:output=>{output.attributes[2].sourceIndex=1;},code:'INVALID_MODEL_OUTPUT'},
  {change:output=>{output.attributes[2].value={untrusted:'not a string'};},code:'INVALID_TRANSLATION_INPUT'},
  {change:output=>{output.title='면秘密양말 A1';},code:'QWEN_UNTRANSLATED_TEXT'},
  {change:output=>{output.keywords=['방수 양말'];},code:'QWEN_UNSUPPORTED_CLAIM'},
  {change:output=>{output.description='원문에 없는 9999개';},code:'UNSUPPORTED_FACT'},
 ];
 for(const scenario of scenarios){const output=draft();output.attributes[2].value='청년18-40/중년40-65/청소년13-18';scenario.change(output);const f=fixture(output),review=await api.prepareTranslationReview(plain(source),f.config);await assert.rejects(api.executeTranslation(review,f.config,noNetwork),error=>{assert.equal(error.code,scenario.code);assert.equal(error.mayHaveBeenCharged,true);return true;});assert.equal(f.calls.length,1);}
});

test('indexed omission notices remain bounded and keep the saved result applicable when the model already returned fifty warnings',async()=>{
 const output=draft();output.attributes[2].value='청년18-40/중년40-65/청소년13-18';output.warnings=Array.from({length:50},(_,index)=>'검토 안내 '+index);
 const f=fixture(output),review=await api.prepareTranslationReview(plain(source),f.config),result=await api.executeTranslation(review,f.config,noNetwork);
 assert.equal(result.draft.warnings.length,50);assert.ok(result.draft.warnings.some(value=>value.includes('일반 상품속성')&&value.includes('sourceIndex 2')));assert.ok(result.draft.warnings.some(value=>value.includes('누락 2개')));assert.doesNotThrow(()=>api.validateQwenTranslationDraft(result.draft,source));assert.equal(f.calls.length,1);
});

test('the fifty-attribute source bound allows only a finite local isolation pass and one model call',async()=>{
 const bound={...plain(source),attributes:[plain(source.attributes[0]),...Array.from({length:49},(_,index)=>({name:'상품속성: 数值'+index,value:String(index+100)}))]},output={...draft(),attributes:[plain(draft().attributes[0]),...Array.from({length:49},(_,index)=>({sourceIndex:index+1,name:'일반 속성',value:String(index+1000)}))],warnings:[]};
 const f=fixture(output),review=await api.prepareTranslationReview(bound,f.config),result=await api.executeTranslation(review,f.config,noNetwork);
 assert.equal(f.calls.length,1);assert.equal(result.draft.attributes.length,1);assert.ok(result.draft.warnings.some(value=>value.includes('일반 상품속성 49개')));assert.ok(result.draft.warnings.every(value=>value.length<=2000));assert.doesNotThrow(()=>api.validateQwenTranslationDraft(result.draft,bound));
});
