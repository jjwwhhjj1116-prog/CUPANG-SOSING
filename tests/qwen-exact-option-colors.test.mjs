import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {providedOptionModule} from './helpers/provided-option-quotation.mjs';

const api=providedOptionModule('app/automation/translation.ts'),plain=value=>JSON.parse(JSON.stringify(value));
const policy='commerce-exact-option-colors-v6';
const colors=[['白色','흰색'],['黑色','검정'],['米色','베이지'],['深灰','진회색'],['浅灰','연회색'],['粉色','분홍색'],['浅紫','연보라색'],['绿色','초록색']];
const source={title:'棉袜',description:'',attributes:colors.map(([value],index)=>({name:`${index%2?'option-color':'option'}:sku-${index}`,value})),provenance:'manual',reference:'local exact color boundary'};
const draft=()=>({title:'면 양말',keywords:['면 양말'],description:'',attributes:colors.map(([,value],sourceIndex)=>({sourceIndex,name:sourceIndex%2?'색상':'옵션명',value})),warnings:[]});
function fixture(output=draft()){let calls=0,wire;const config={provider:'workers-ai',apiKey:'',model:api.WORKERS_QWEN_MODEL,maxOutputTokens:4096,ai:{run:async(model,input)=>{calls++;wire=plain(input);return{response:output,model};}}};return{config,get calls(){return calls;},get wire(){return wire;}};}
const noNetwork=()=>assert.fail('exact color tests must never contact a model, application or supplier');

test('new v6 schema binds only exact pure Chinese option colors to their reviewed Korean value and source index',async()=>{
 const f=fixture(),review=await api.prepareTranslationReview(plain(source),f.config),before=JSON.stringify(review),request=api.buildTranslationRequest(review);
 assert.equal(review.qwenTranslationPolicy,policy);
 for(const [index,[,value]]of colors.entries()){
  const shape=request.text.format.schema.properties.attributes.items.anyOf[index];
  assert.deepEqual(plain(shape.properties.value),{type:'string',enum:[value]});assert.deepEqual(plain(shape.properties.sourceIndex.enum),[index]);
 }
 const {fingerprint}=providedOptionModule('app/automation/model.ts'),{fingerprint:stored,...signed}=review;assert.equal(await fingerprint(signed),stored);signed.qwenTranslationPolicy='commerce-partial-attributes-v5';assert.notEqual(await fingerprint(signed),stored);
 const result=await api.executeTranslation(review,f.config,noNetwork);assert.deepEqual(plain(result.draft),draft());assert.equal(f.calls,1);assert.equal(result.appliedToContent,false);assert.equal(JSON.stringify(review),before);
});

test('provider enum violations on required white, beige or other pure colors fail once without correcting raw output',async()=>{
 for(const [index,wrong]of [[0,'크림색'],[2,'크림색'],[3,'연회색'],[4,'진회색'],[5,'빨강'],[7,'검정']]){
  const output=draft();output.attributes[index].value=wrong;const before=JSON.stringify(output),f=fixture(output),review=await api.prepareTranslationReview(plain(source),f.config);
  await assert.rejects(api.executeTranslation(review,f.config,noNetwork),error=>error.code==='QWEN_OPTION_COLOR_MISMATCH'&&error.mayHaveBeenCharged&&error.message.includes('sourceIndex '+index));
  assert.equal(f.calls,1);assert.equal(JSON.stringify(output),before);
 }
});

test('v6 cannot partially discard an incorrect pure-color required option or bypass syntax and missing-option checks',async()=>{
 const bound={...plain(source),attributes:[...plain(source.attributes),{name:'상품속성: 数值',value:'80'}]},good=draft();good.attributes.push({sourceIndex:8,name:'수치',value:'81'});
 for(const [change,code]of [[value=>{value.attributes[0].value='크림색';},'QWEN_OPTION_COLOR_MISMATCH'],[value=>{value.attributes.shift();},'QWEN_MISSING_TRANSLATION'],[value=>{value.attributes[0].sourceIndex=99;},'INVALID_MODEL_OUTPUT'],[value=>{value.attributes[1].sourceIndex=0;},'INVALID_MODEL_OUTPUT']]){
  const output=plain(good);change(output);const f=fixture(output),review=await api.prepareTranslationReview(bound,f.config);
  await assert.rejects(api.executeTranslation(review,f.config,noNetwork),error=>error.code===code);assert.equal(f.calls,1);
 }
 const f=fixture(good),review=await api.prepareTranslationReview(bound,f.config),result=await api.executeTranslation(review,f.config,noNetwork);assert.equal(result.draft.attributes.length,8);assert.ok(result.draft.warnings.some(value=>value.includes('sourceIndex 8')));assert.equal(f.calls,1);
});

test('mixed colors, descriptions, model codes, sizes and ordinary attributes never receive a partial color replacement',async()=>{
 const values=[['option:a','白色/黑色'],['option:b','米白色'],['option:c','白色 大号'],['option:d','白色AB-005'],['option:e','白色袜子'],['option:f','深灰色'],['option-size:g','白色'],['상품속성: 颜色','白色'],['制造商','白色']];
 const bound={...plain(source),attributes:values.map(([name,value])=>({name,value}))},f=fixture(),review=await api.prepareTranslationReview(bound,f.config),before=JSON.stringify(review),schema=api.buildTranslationRequest(review).text.format.schema.properties.attributes.items.anyOf;
 for(let index=0;index<values.length-1;index++)assert.equal(Object.hasOwn(schema[index].properties.value,'enum'),false,'no guessed/partial translation at '+index);
 assert.deepEqual(plain(schema.at(-1).properties.value.enum),['白色'],'legal name keeps only its existing original-value exception');assert.equal(JSON.stringify(review),before);
});

test('historical v5 and earlier completion/apply contracts retain their original color behavior and request bytes',async()=>{
 const output=draft();output.attributes[0].value='크림색';output.attributes[2].value='크림색';
 for(const previous of [undefined,'commerce-literal-v2','commerce-json-schema-v3','commerce-literal-schema-v4','commerce-partial-attributes-v5']){
  const f=fixture(output),review=await api.prepareTranslationReview(plain(source),f.config);delete review.seoKeywordPolicy;if(previous===undefined)delete review.qwenTranslationPolicy;else review.qwenTranslationPolicy=previous;
  const result=await api.executeTranslation(review,f.config,noNetwork);assert.equal(result.draft.attributes[0].value,'크림색');assert.equal(f.calls,1);
  assert.doesNotThrow(()=>api.validateQwenTranslationDraft(output,source,previous));
  if(previous==='commerce-partial-attributes-v5')assert.equal(createHash('sha256').update(JSON.stringify(f.wire)).digest('hex'),'70a45562d1694031ca57d179c459c4a315b6300744a3ec9ef4a800f58fc34bb0');
 }
 assert.throws(()=>api.validateQwenTranslationDraft(output,source,policy),error=>error.code==='QWEN_OPTION_COLOR_MISMATCH');
});

test('a valid v6 white translation never replaces an existing manual 하양 option name or color',()=>{
 const optionsModel=providedOptionModule('app/product-options.ts'),adoption=providedOptionModule('app/option-translation.ts');
 const options=optionsModel.applyOptionRows(optionsModel.emptyProductOptions('p'),[{...optionsModel.emptyOptionInput('sku-0'),originalName:'白色',translatedName:'하양',color:'하양',included:true,unitCostCny:1,unitsPerPack:1}],'v');
 const bound={...plain(source),attributes:[{name:'option:sku-0',value:'白色'},{name:'option-color:sku-0',value:'白色'}]},output={...draft(),attributes:[{sourceIndex:0,name:'옵션명',value:'흰색'},{sourceIndex:1,name:'색상',value:'흰색'}]};
 api.validateQwenTranslationDraft(output,bound,policy);
 const job={productId:'p',productVersion:'v',status:'completed',review:{model:api.WORKERS_QWEN_MODEL,qwenTranslationPolicy:policy,instructionsVersion:'sourceflow-translation-v6',source:bound},result:{draft:output}},before=JSON.stringify(options);
 const result=adoption.adoptOptionTranslations(options,job,'v',true);assert.equal(result.changed,0);assert.equal(result.rows[0].translatedName,'하양');assert.equal(result.rows[0].color,'하양');assert.equal(JSON.stringify(options),before);
});
