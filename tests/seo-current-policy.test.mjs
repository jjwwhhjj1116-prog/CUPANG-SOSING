import test from 'node:test';
import assert from 'node:assert/strict';
import {mobileIntakeHarness} from './helpers/mobile-intake.mjs';
test('new composition prompts 70, related preferences stay out of source facts, legacy prompt unchanged',async()=>{
 const h=mobileIntakeHarness();try{const t=h.load('app/automation/translation.ts'),p=h.load('app/seo-current-policy.ts');const source={title:'袜子',description:'',attributes:[{name:'option:one',value:'白色 长筒 2个'}],provenance:'manual',reference:'inert',category:{id:'1',path:['양말']}};
 const config={provider:'workers-ai',model:t.WORKERS_QWEN_MODEL,maxOutputTokens:4096,apiKey:''},old=await t.prepareTranslationReview(source,config),before=t.buildTranslationRequest(old);
 const policy=p.validateSeoCompositionPolicy({version:'couplus-current-composition-v1',memo:{brand:'브랜드, 다른',features:'방수 금지',keywords:'양말'},related:{source:'provided',query:'양말',keywords:[' 양말 ','양말'],warnings:[]}});
 const review=await t.prepareTranslationReview(source,config,new Date(),policy),request=t.buildTranslationRequest(review);assert.match(request.instructions,/70/);assert.match(request.input[0].content[0].text,/related/);assert.deepEqual(t.buildTranslationRequest(old),before);assert.equal(old.seoComposition,undefined);
 const guarded=p.guardCurrentSeoDraft({title:'방수 장목 양말',keywords:['방수양말','양말'],description:'',attributes:[],warnings:[]},review.source,policy);assert.equal(guarded.title,'장목 양말');assert.deepEqual(JSON.parse(JSON.stringify(guarded.keywords)),['양말']);assert.ok(guarded.warnings.length);
 assert.throws(()=>p.guardCurrentSeoDraft({title:'방수',keywords:[],description:'',attributes:[],warnings:[]},review.source,policy),/SEO_FACT_EMPTY/);
 }finally{h.close();}
});

test('current guards drop one ambiguous keyword, enforce selected facts/order and never truncate a75 character title',()=>{
 const h=mobileIntakeHarness();try{const p=h.load('app/seo-current-policy.ts'),base={title:'黑色双层半指中国',description:'',attributes:[{name:'option:a',value:'白色 单层 全指 2个 20cm'},{name:'option:b',value:'白色 单层 全指 2片 30cm'},{name:'产地',value:'中国'}],provenance:'manual',reference:'1688',category:{id:'1',path:['운동 장갑']}},memo={brand:'',features:'방수 금지',keywords:''},policy=p.validateSeoCompositionPolicy({version:'couplus-current-composition-v1',memo,related:{source:'none',query:'',keywords:[],warnings:[]}});
 const result=p.guardCurrentSeoDraft({title:'한국산 블랙 이중 핑거리스 4개 장갑',description:'',keywords:['플라스틱장갑','방수장갑','치료장갑','장갑'],attributes:[],warnings:[]},base,policy);assert.equal(result.title,'장갑');assert.deepEqual(Array.from(result.keywords),['장갑']);assert.ok(result.warnings.length>=5);
 const rose=p.guardCurrentSeoDraft({title:'로즈 골드 걸이',description:'',keywords:['로즈골드걸이','금속걸이'],attributes:[],warnings:[]},{...base,title:'金色 玫瑰金 挂钩',attributes:[{name:'option:a',value:'玫瑰金'}]},policy);assert.equal(rose.title,'로즈 골드 걸이');assert.deepEqual(Array.from(rose.keywords),['로즈골드걸이','금속걸이']);
 const title='가'.repeat(75);assert.equal(p.guardCurrentSeoDraft({title,description:'',keywords:[],attributes:[],warnings:[]},base,policy).title,title);
 const shared=p.guardCurrentSeoDraft({title:'2매 장갑',description:'',keywords:[],attributes:[],warnings:[]},base,policy);assert.equal(shared.title,'2매 장갑');
 const originPolicy=p.validateSeoCompositionPolicy({...policy,memo:{...memo,features:'한국산. 원산지 표기 금지'}});assert.equal(p.guardCurrentSeoDraft({title:'한국산 호주산 장갑',description:'',keywords:[],attributes:[],warnings:[]},base,originPolicy).title,'장갑');
 }finally{h.close();}
});
