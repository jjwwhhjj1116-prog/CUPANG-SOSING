import test from 'node:test';
import assert from 'node:assert/strict';
import {mobileIntakeHarness} from './helpers/mobile-intake.mjs';

const clone=value=>JSON.parse(JSON.stringify(value));
async function fixture(description='구두 뒤꿈치에 부착하는 스펀지 패드'){
 const h=mobileIntakeHarness(),seo=h.load('app/seo-generation.ts');
 const source={title:'스펀지 뒤꿈치 패드 4D',description,attributes:[{name:'재질',value:'스펀지'}],category:{id:'68183',path:['생활용품','신발용품']}};
 const proof={purpose:'seo-generation',version:1,sourceFingerprint:'a'.repeat(64),optionRevision:1,company:{code:'A01526306',name:'유앤채'},memo:{brand:'',features:'',keywords:''}};
 const configuration=seo.seoGenerationConfiguration({SOURCEFLOW_QUOTATION_AI_PROVIDER:'workers-ai',SOURCEFLOW_QUOTATION_AI_FREE_ONLY:'true',AI:{run:async()=>({})}});
 const review=await seo.prepareSeoGenerationReview(source,proof,configuration);
 const good={title:'스펀지 뒤꿈치 패드 4D',description:description?'구두 뒤꿈치에 부착하는 스펀지 패드':'',keywords:['뒤꿈치 패드','구두 패드'],attributes:[],warnings:[]};
 return {h,seo,review,good,normalize:raw=>seo.validateSeoGenerationDraft(raw,review,true)};
}
function rejects(f,raw,reason){assert.throws(()=>f.normalize(raw),error=>error.code==='SEO_GENERATION_INVALID'&&error.reason===reason&&error.uncertain===false&&error.message.includes('(검증: '+reason+')'));}

test('fresh SEO keywords trim whitespace, collapse spacing and remove exact duplicates without changing values or source snapshots',async()=>{
 const f=await fixture();try{
  const raw={...clone(f.good),keywords:[' 뒤꿈치  패드 ','뒤꿈치 패드','구두\u00a0패드','구두 패드']},before=JSON.stringify(raw),source=JSON.stringify(f.review.source);
  const draft=f.normalize(raw);assert.deepEqual(Array.from(draft.keywords),['뒤꿈치 패드','구두 패드']);assert.equal(JSON.stringify(raw),before);assert.equal(JSON.stringify(f.review.source),source);assert.equal(draft.title,f.good.title);assert.equal(draft.description,f.good.description);assert.deepEqual(Array.from(draft.attributes),[]);
  assert.deepEqual(Array.from(f.seo.validateSeoGenerationDraft(draft,f.review).keywords),Array.from(draft.keywords));
 }finally{f.h.close();}
});

test('keyword selection preserves the original order and only existing terms that fit the 150 character joined limit',async()=>{
 const f=await fixture();try{
  const candidates=Array.from({length:12},(_,index)=>'뒤꿈치패드'.repeat(3)+String.fromCharCode(0xac00+index)),raw={...clone(f.good),keywords:[...candidates,'패드']},before=JSON.stringify(raw);
  const draft=f.normalize(raw),expected=[];for(const value of raw.keywords)if([...expected,value].join(', ').length<=150)expected.push(value);
  assert.deepEqual(Array.from(draft.keywords),expected);assert.ok(draft.keywords.length<candidates.length);assert.ok(draft.keywords.join(', ').length<=150);assert.ok(draft.keywords.every(value=>raw.keywords.includes(value)));assert.equal(draft.keywords.at(-1),'패드');assert.equal(JSON.stringify(raw),before);
 }finally{f.h.close();}
});

test('every candidate is checked before overflow selection, including numbers, claims, materials and untranslated text that would be dropped',async()=>{
 const f=await fixture();try{
  const prefix=[...Array.from({length:8},(_,index)=>'뒤꿈치패드'.repeat(3)+String.fromCharCode(0xac00+index)),'뒤꿈치패드용'];assert.equal(f.normalize({...clone(f.good),keywords:prefix}).keywords.join(', ').length,150);
  for(const [term,reason]of [['패드 99999','unsupported-number'],['항균 패드','unsupported-claim'],['실리콘 패드','unsupported-material'],['鞋贴 패드','untranslated']])rejects(f,{...clone(f.good),keywords:[...prefix,term]},reason);
 }finally{f.h.close();}
});

test('stored draft validation stays strict when a caller ignores the returned draft',async()=>{
 const f=await fixture();try{
  for(const keywords of [[' 뒤꿈치 패드'],['뒤꿈치 패드','뒤꿈치 패드'],['뒤꿈치  패드'],Array.from({length:12},(_,index)=>'뒤꿈치패드'.repeat(3)+String.fromCharCode(0xac00+index))]){
   const raw={...clone(f.good),keywords};assert.throws(()=>f.seo.validateSeoGenerationDraft(raw,f.review),error=>error.reason==='keywords-not-normalized');assert.ok(f.normalize(raw).keywords.join(', ').length<=150);
  }
 }finally{f.h.close();}
});

test('invalid shape, type, size and dangerous keyword characters retain fixed detailed reasons without raw values',async()=>{
 const f=await fixture();try{
  const cases=[['draft-keys',value=>value.private='PRIVATE_VALUE'],['title-type',value=>value.title=4],['title-empty',value=>value.title=' '],['title-limit',value=>value.title='가'.repeat(101)],['title-characters',value=>value.title='패드\n'],['description-type',value=>value.description=[]],['description-limit',value=>value.description='가'.repeat(20001)],['keywords-type',value=>value.keywords='PRIVATE_VALUE'],['keywords-count',value=>value.keywords=[]],['keywords-count',value=>value.keywords=Array(31).fill('패드')],['keyword-type',value=>value.keywords=[{}]],['keyword-empty',value=>value.keywords=[' ']],['keyword-limit',value=>value.keywords=['가'.repeat(21)]],['keyword-characters',value=>value.keywords=['패드,쿠션']],['keyword-characters',value=>value.keywords=['패드\t쿠션']],['keyword-characters',value=>value.keywords=['패드\u007f']],['attributes-type',value=>value.attributes={}],['attributes-content',value=>value.attributes=[{name:'PRIVATE_VALUE'}]],['warnings-type',value=>value.warnings={}],['warnings-count',value=>value.warnings=Array(31).fill('')],['warning-type',value=>value.warnings=[4]],['warning-limit',value=>value.warnings=['가'.repeat(2001)]],['untranslated',value=>value.title='PRIVATE_TITLE'],['control-characters',value=>value.description='PRIVATE_VALUE\u0000']];
  for(const [reason,mutate]of cases){const raw=clone(f.good);mutate(raw);assert.throws(()=>f.normalize(raw),error=>error.code==='SEO_GENERATION_INVALID'&&error.reason===reason&&!error.message.includes('PRIVATE_'));}
 }finally{f.h.close();}
});

test('generation schema and prompt share a bounded keyword budget and force empty descriptions when no description source exists',async()=>{
 for(const description of ['', '  ', '원문 설명']){const f=await fixture(description);try{
  const calls=[],raw={...clone(f.good),description:description.trim()?'원문 설명':'',keywords:[' 뒤꿈치  패드 ','뒤꿈치 패드','구두 패드']};
  const result=await f.seo.executeSeoGeneration(f.review,async(model,input)=>{calls.push({model,input});return {response:JSON.stringify(raw)};});assert.equal(calls.length,1);assert.deepEqual(Array.from(result.draft.keywords),['뒤꿈치 패드','구두 패드']);
  const schema=calls[0].input.response_format.json_schema,k=schema.properties.keywords;assert.equal(k.maxItems,10);assert.equal(k.items.maxLength,13);assert.ok(k.maxItems*k.items.maxLength+(k.maxItems-1)*2<=150);assert.equal(schema.properties.description.maxLength,description.trim()?20000:0);assert.equal(schema.additionalProperties,false);assert.equal(schema.properties.attributes.maxItems,0);assert.match(calls[0].input.messages[0].content,/1~10개·각13자 이하/);assert.equal(JSON.stringify(JSON.parse(calls[0].input.messages[1].content).source),JSON.stringify(f.review.source));
 }finally{f.h.close();}}
});

test('unsupported descriptions and malformed model JSON remain failures with no retry or raw provider content in the error',async()=>{
 const f=await fixture('');try{
  rejects(f,{...clone(f.good),description:'만들어낸 설명'},'description-without-source');let calls=0;
  await assert.rejects(f.seo.executeSeoGeneration(f.review,async()=>{calls++;return {response:'PRIVATE_RAW_MODEL_RESPONSE'};}),error=>error.code==='SEO_GENERATION_INVALID'&&error.reason==='json'&&!error.message.includes('PRIVATE_RAW'));assert.equal(calls,1);
 }finally{f.h.close();}
});
