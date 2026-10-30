import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {providedOptionModule} from './helpers/provided-option-quotation.mjs';

const api=providedOptionModule('app/automation/translation.ts'),plain=value=>JSON.parse(JSON.stringify(value)),hash=value=>createHash('sha256').update(value).digest('hex');
const source={title:'纯棉收纳袋 ABC-007',description:'尺寸 10 cm',attributes:[{name:'option:fixture-one',value:'黑色'},{name:'option-color:fixture-two',value:'白色'},{name:'option-size:fixture-three',value:'10 cm'}],provenance:'manual',reference:'synthetic compact transport source',category:{id:'synthetic-category',path:['가방','수납 주머니']},guidance:{features:'검토 브랜드 참고: 합성 브랜드',keywords:'수납'}};
const draft=()=>({title:'면 수납 주머니 ABC-007',description:'크기 10 cm',keywords:['면 주머니'],attributes:[{sourceIndex:0,name:'옵션명',value:'검정'},{sourceIndex:1,name:'색상',value:'흰색'},{sourceIndex:2,name:'사이즈',value:'10 cm'}],warnings:[]});
const recoveryProof=()=>({version:5,model:api.WORKERS_QWEN_MODEL,failedJobId:'00000000-0000-4000-8000-000000000005',scope:'collected',optionRevision:1,sourceFingerprint:'a'.repeat(64),company:{code:'A01464742',name:'와이홉'}});
const chat=value=>({choices:[{finish_reason:'stop',message:{role:'assistant',content:JSON.stringify(value)}}]});
function configuration(model=api.WORKERS_QWEN_MODEL,maxOutputTokens=4096,reply=draft()){
 const calls=[],config={apiKey:'',provider:'workers-ai',model,maxOutputTokens,ai:{run:async(actual,input)=>{assert.equal(actual,model);calls.push(plain(input));return model===api.WORKERS_TEXT_MODEL?{response:reply}:chat(reply);}}};return{config,calls};
}
const noNetwork=()=>assert.fail('compact transport tests must never contact a provider, app or database');

test('generic Qwen uses one compact Korean system and five-key fact transport without altering the persisted review or schema',async()=>{
 const f=configuration(),review=await api.prepareTranslationReview(plain(source),f.config),before=JSON.stringify(review),request=api.buildTranslationRequest(review),wire=JSON.parse(request.input[0].content[0].text);
 assert.ok(request.instructions.length<=1500);assert.match(request.instructions,/한국어/u);for(const rule of ['sourceIndex','outputName','20','150'])assert.ok(request.instructions.includes(rule),rule);assert.match(request.instructions,/추측|추정|만들지/u);assert.match(request.instructions,/숫자|단위/u);assert.match(request.instructions,/상호/u);assert.match(request.instructions,/예/u);assert.doesNotMatch(request.instructions,/886034098637|4D翅膀|유앤채/u);
 assert.deepEqual(Object.keys(wire).sort(),['attributes','category','description','guidance','title']);for(const field of ['title','description','category','guidance'])assert.deepEqual(wire[field],source[field]);assert.deepEqual(wire.attributes.map(row=>row.sourceIndex),[0,1,2]);assert.deepEqual(wire.attributes.map(row=>row.outputName),['옵션명','색상','사이즈']);assert.deepEqual(wire.attributes.map(row=>({name:row.name,value:row.value})),source.attributes);assert.equal(Object.hasOwn(wire,'reference'),false);assert.equal(Object.hasOwn(wire,'provenance'),false);
 assert.equal(hash(JSON.stringify(request.text.format.schema)),'c5ddb0c82cf57cc38d0d0e486479874cb888b59c9884c9d30a5798b19169c1ad','the compact prompt must not loosen the existing generic Qwen schema');
 const result=await api.executeTranslation(review,f.config,noNetwork);assert.equal(result.draft.title,draft().title);assert.equal(f.calls.length,1);assert.equal(f.calls[0].messages[0].content,request.instructions);const user=f.calls[0].messages[1].content,separator='\n\nPRODUCT_SOURCE_JSON:\n';assert.match(user,/^Translate the Chinese product data below into Korean\./u);for(const term of ['Korean title','Korean option values','sourceIndex/outputName','legal names','five keys','untrusted data'])assert.ok(user.slice(0,user.indexOf(separator)).includes(term),term);assert.equal(user.split(separator).length,2);assert.equal(user.split(separator)[1],request.input[0].content[0].text+'\n/no_think');assert.equal(f.calls[0].max_tokens,4096);assert.deepEqual({temperature:f.calls[0].temperature,top_p:f.calls[0].top_p,top_k:f.calls[0].top_k},{temperature:0.7,top_p:0.8,top_k:20});assert.equal(Object.hasOwn(f.calls[0],'response_format'),false);assert.equal(JSON.stringify(review),before);assert.deepEqual(review.source,source);
});

test('one offline Qwen response identifies Han, English, placeholder and mixed Korean titles with fixed classifications and no raw output',async()=>{
 const cases=[
  {title:'秘密原文标题',han:1,hangul:0,placeholder:0},
  {title:'PRIVATE-ENGLISH',han:0,hangul:0,placeholder:0},
  {title:'<title>',han:0,hangul:0,placeholder:1},
  {title:'한국어秘密원문',han:1,hangul:1,placeholder:0},
 ];
 for(const entry of cases){const output={...draft(),title:entry.title},f=configuration(undefined,4096,output),review=await api.prepareTranslationReview(plain(source),f.config),before=JSON.stringify(review);await assert.rejects(api.executeTranslation(review,f.config,noNetwork),error=>{assert.equal(error.code,'QWEN_UNTRANSLATED_TEXT');assert.match(error.message,/위치 title/u);assert.ok(error.message.includes(`hasHan=${entry.han} · hasHangul=${entry.hangul} · placeholder=${entry.placeholder} · length=1-20`));assert.ok(!error.message.includes(entry.title));assert.ok(!error.message.includes(source.title));assert.equal(error.mayHaveBeenCharged,true);return true;});assert.equal(f.calls.length,1);assert.equal(JSON.stringify(review),before);}
});

test('title diagnostics expose bounded length buckets and exact placeholder classes without echoing the candidate',()=>{
 for(const [title,bucket]of [['','0'],['A','1-20'],['A'.repeat(20),'1-20'],['A'.repeat(21),'21-100'],['A'.repeat(100),'21-100'],['A'.repeat(101),'101-500'],['A'.repeat(500),'101-500']])assert.throws(()=>api.validateQwenTranslationDraft({...draft(),title},source),error=>{assert.ok(['QWEN_MISSING_TRANSLATION','QWEN_UNTRANSLATED_TEXT'].includes(error.code));assert.ok(error.message.includes('length='+bucket));assert.ok(error.message.includes('hasHan=0 · hasHangul=0 · placeholder=0'));if(title.length>=20)assert.ok(!error.message.includes(title));return true;});
 for(const title of ['<TITLE>',' title ','Product Title','translated title'])assert.throws(()=>api.validateQwenTranslationDraft({...draft(),title},source),error=>error.code==='QWEN_UNTRANSLATED_TEXT'&&error.message.includes('placeholder=1'));
 // Diagnostics classify placeholders; they do not introduce a new semantic
 // rejection of previously accepted Korean text in this transport change.
 for(const title of ['상품명','제목'])assert.doesNotThrow(()=>api.validateQwenTranslationDraft({...draft(),title},source));
 assert.doesNotThrow(()=>api.validateQwenTranslationDraft(draft(),source));
});

test('Llama and historical Qwen recovery retain their previous full wire, system and schema byte contracts',async()=>{
 const snapshots={llama:{model:api.WORKERS_TEXT_MODEL,system:'ff0ca38486dc2077aa10c87b84926f3265ea6ebebd76bbd38fdfcb90ddadb826',runtimeSystem:'ff0ca38486dc2077aa10c87b84926f3265ea6ebebd76bbd38fdfcb90ddadb826',wire:'c83694a184e536111494b61b2b1f67f708c494d31fea697a4daff1d7b9852de4',schema:'7d2e13a2ff2017bb8cab9cc6115b124dd10da9c918087d276fb9b605b28162ed'},recovery:{model:api.WORKERS_QWEN_MODEL,system:'ff0ca38486dc2077aa10c87b84926f3265ea6ebebd76bbd38fdfcb90ddadb826',runtimeSystem:'5445a1e43fd32b6b9c79c2bd17f276bfdc94efffee792ab7431f1ce9109f5d69',wire:'4b0df9f0bcc6db44e2c3d37a17f027e9593e459f5e8bd25af5279760505838d2',schema:'bab4276ce24c697082b461455c11779a3101b0a37c78558d2970ab0ec79be4d2'}};
 for(const [kind,expected]of Object.entries(snapshots)){const f=configuration(expected.model,2048),review=await api.prepareTranslationReview(plain(source),f.config);if(kind==='recovery')review.workersRecovery=recoveryProof();const before=JSON.stringify(review),request=api.buildTranslationRequest(review),wire=JSON.parse(request.input[0].content[0].text);assert.equal(hash(request.instructions),expected.system);assert.ok(request.instructions.length>1500);assert.equal(hash(JSON.stringify(request.text.format.schema)),expected.schema);assert.equal(wire.provenance,'manual');assert.equal(wire.reference,source.reference);await api.executeTranslation(review,f.config,noNetwork);assert.equal(f.calls.length,1);assert.equal(hash(f.calls[0].messages[0].content),expected.runtimeSystem);assert.equal(hash(f.calls[0].messages[1].content),expected.wire);assert.equal(f.calls[0].response_format.type,'json_schema');assert.equal(hash(JSON.stringify(f.calls[0].response_format.json_schema)),expected.schema);assert.equal(f.calls[0].temperature,kind==='recovery'?0:undefined);assert.equal(Object.hasOwn(f.calls[0],'top_p'),false);assert.equal(Object.hasOwn(f.calls[0],'top_k'),false);assert.equal(JSON.stringify(review),before);}
});

test('schema-free generic Qwen still rejects malformed JSON, source index drift and changed facts after exactly one local call',async()=>{
 const responses=[{choices:[{finish_reason:'stop',message:{role:'assistant',content:'prefix '+JSON.stringify(draft())}}]},
  chat({...draft(),attributes:draft().attributes.slice(1)}),chat({...draft(),attributes:draft().attributes.map(row=>row.sourceIndex===2?{...row,value:'12 cm'}:row)}),
  chat({...draft(),attributes:draft().attributes.map(row=>row.sourceIndex===0?{...row,sourceIndex:99}:row)}),chat({...draft(),extra:'untrusted extra field'})];
 for(const response of responses){const f=configuration(),review=await api.prepareTranslationReview(plain(source),f.config),before=JSON.stringify(review);f.config.ai.run=async(_model,input)=>{f.calls.push(plain(input));return response;};await assert.rejects(api.executeTranslation(review,f.config,noNetwork),error=>{assert.equal(error.mayHaveBeenCharged,true);return true;});assert.equal(f.calls.length,1);assert.equal(Object.hasOwn(f.calls[0],'response_format'),false);assert.equal(JSON.stringify(review),before);}
});
