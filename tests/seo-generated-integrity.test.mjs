import test from 'node:test';
import assert from 'node:assert/strict';
import {providedOptionModule} from './helpers/provided-option-quotation.mjs';

const api=providedOptionModule('app/automation/translation.ts'),typed=providedOptionModule('app/seo-option-results.ts'),generated=providedOptionModule('app/seo-generated-draft.ts');
const plain=value=>JSON.parse(JSON.stringify(value)),noNetwork=()=>assert.fail('No network or live provider call');
const completion=value=>({choices:[{finish_reason:'stop',message:{role:'assistant',content:JSON.stringify(value)}}]});
async function fixture({title='유앤채 곡선 커튼레일',brand='유앤채, 보조 브랜드',names,validation='echo'}={}){
 const options=providedOptionModule('app/product-options.ts').emptyProductOptions('synthetic-rail');options.revision=2;
 options.rows=[1,2,5,3,4].map((length,index)=>({...providedOptionModule('app/product-options.ts').emptyOptionInput('rail-'+index),included:true,originalName:length+'米套装',provenance:{translatedName:'collected',color:'collected',size:'collected'}}));
 const context=providedOptionModule('app/seo-composition-context.ts').seoCompositionContext(options),content=providedOptionModule('app/product-content.ts').emptyProductContent(options.productId);
 const source={title:'弯曲窗帘轨道',description:'reference only',attributes:[...Array.from({length:16},(_,index)=>({name:'참고 속성 '+index,value:'원문 보존'})),...options.rows.map(row=>({name:'option:'+row.id,value:row.originalName}))],provenance:'manual',reference:'synthetic-rail-source',category:{id:'synthetic-category',path:['커튼레일']}};
 const composition={version:'couplus-current-composition-v1',memo:{brand,features:'',keywords:'곡선커튼레일'},related:{source:'none',query:'곡선커튼레일',keywords:[],warnings:[]}};
 let calls=0;const config={provider:'workers-ai',model:api.WORKERS_QWEN_MODEL,maxOutputTokens:4096,ai:{run:async(_model,input)=>{
  calls++;const data=JSON.parse(input.messages[1].content.split('\n\nPRODUCT_SOURCE_JSON:\n')[1].slice(0,-'\n/no_think'.length));
  if(data.validationDraft){if(validation==='throw')throw Error('synthetic unavailable validation');if(validation==='malformed')return completion({});return completion({...data.validationDraft,...(validation==='brand-only'?{title:'유앤채'}:{}),...(validation==='unit-lost'?{seoOptions:context.selectedOptions.map((row,index)=>({optionId:row.id,name:[1,2,5,3,4][index]+' 세트'}))}:{})});}
  return completion({title,keywords:['곡선커튼레일'],seoOptions:context.selectedOptions.map((row,index)=>({optionId:row.id,name:names?.[index]??[1,2,5,3,4][index]+'m 세트'}))});
 }}};
 const review=await api.prepareTranslationReview(source,config,new Date('2026-11-07T00:00:00.000Z'),composition,context);
 const result={model:config.model,provenance:'generated',appliedToContent:false,draft:{title,description:'',keywords:['곡선커튼레일'],attributes:[],warnings:[]},seoOptions:context.selectedOptions.map((row,index)=>({optionId:row.id,name:names?.[index]??[1,2,5,3,4][index]+'m 세트'}))};
 const job={id:'00000000-0000-4000-8000-000000000081',productId:options.productId,productVersion:'2026-11-07T00:00:00.000Z',contentRevision:content.revision,status:'completed',error:null,review,result};
 return{options,content,review,config,job,get calls(){return calls;},run:()=>api.executeTranslation(review,config,noNetwork),seed:()=>generated.createSeoGeneratedDraft({ownerId:'owner',productVersion:job.productVersion,content,options,job,brand,replaceSaved:true})};
}

test('producer rejects a brand-only title after Han or forbidden cleanup even when validation is unavailable',async()=>{
 for(const title of ['유앤채','유앤채 窗帘轨道','[유앤채]','유앤채 유앤채','유앤채 1개']){const f=await fixture({title,validation:'throw'}),before=JSON.stringify(f.review);await assert.rejects(f.run(),error=>error.code==='SEO_FACT_EMPTY'&&error.mayHaveBeenCharged===true);assert.equal(f.calls,2);assert.equal(JSON.stringify(f.review),before);}
 const f=await fixture({title:'유앤채 방수',validation:'malformed'});f.review.seoComposition.memo.features='방수 금지';await assert.rejects(f.run(),/SEO_FACT_EMPTY|상품명/);assert.equal(f.calls,2);
});

test('producer cannot promote copied numeric 米 or unit-lost names when validation fails',async()=>{
 for(const names of [[1,2,5,3,4].map(n=>n+'米套装'),[1,2,5,3,4].map(n=>n+' 세트')]){
  for(const validation of ['throw','malformed']){const f=await fixture({names,validation});await assert.rejects(f.run(),error=>error.code==='SEO_OPTION_UNIT_OR_CODE_CHANGED'&&error.mayHaveBeenCharged===true);assert.equal(f.calls,2);}
 }
});

test('an unusable validation rewrite retains a usable known candidate without a model retry',async()=>{
 for(const validation of ['brand-only','unit-lost']){const f=await fixture({validation}),result=await f.run();assert.equal(result.draft.title,'유앤채 곡선 커튼레일');assert.equal(result.seoOptions[0].name,'1m 세트');assert.equal(f.calls,2);assert.match(result.draft.warnings.join(' '),/한자 검증 응답을 확인하지 못해/);}
});

test('stored completed generated seeds reject the normalized brand-only and unit-lost shapes without mutating evidence',async()=>{
 for(const input of [{title:'유앤채'},{names:[1,2,5,3,4].map(n=>n+' 세트')}]){const f=await fixture(input),before=JSON.stringify({job:f.job,content:f.content,options:f.options});assert.throws(f.seed,/SEO_FACT_EMPTY|상품명|SEO_OPTION_UNIT_OR_CODE_CHANGED|단위/);assert.equal(JSON.stringify({job:f.job,content:f.content,options:f.options}),before);}
});

test('numeric unit text inside the first brand cannot impersonate a remaining product noun',()=>{
 const policy=providedOptionModule('app/seo-current-policy.ts');assert.throws(()=>policy.assertGeneratedSeoTitle('ABC2M','ABC2M, second'),/SEO_FACT_EMPTY/);assert.throws(()=>policy.assertGeneratedSeoTitle('[abc2m] 1세트','ABC2M'),/SEO_FACT_EMPTY/);assert.doesNotThrow(()=>policy.assertGeneratedSeoTitle('ABC2M 컵','ABC2M'));
});

for(const title of ['유앤채 1kg','유앤채 1ml','유앤채 1m 유앤채',...['쌍','세트','개입','개','매','장','팩','묶음','켤레','롤','봉','병','통','박스','캔','봉지','입','pcs','pc','구','갈래'].flatMap(unit=>['유앤채 1'+unit,'유앤채 '+unit])]){
 test('producer rejects quantity/unit-only product wording: '+title,async()=>{
  const f=await fixture({title,validation:'throw'}),before=JSON.stringify(f.review);await assert.rejects(f.run(),error=>error.code==='SEO_FACT_EMPTY'&&error.mayHaveBeenCharged===true);assert.equal(f.calls,2);assert.equal(JSON.stringify(f.review),before);
 });
 test('completed seed rejects quantity/unit-only product wording: '+title,async()=>{
  const f=await fixture({title}),before=JSON.stringify({job:f.job,content:f.content,options:f.options});assert.throws(f.seed,error=>error.code==='SEO_FACT_EMPTY');assert.equal(JSON.stringify({job:f.job,content:f.content,options:f.options}),before);assert.equal(f.calls,0);
 });
}

test('producer and seed preserve short product nouns beside quantities and numeric brands',async()=>{
 for(const [title,brand] of [['유앤채 컵','유앤채'],['유앤채 컵 1kg','유앤채'],['유앤채 1ml 컵','유앤채'],['ABC2M 컵','ABC2M'],['ABC2M 컵 1ml','ABC2M'],['유앤채 컵 1쌍','유앤채'],['유앤채 컵 세트','유앤채'],['유앤채 도장','유앤채'],['유앤채 물병','유앤채']]){
  const f=await fixture({title,brand,validation:'throw'}),result=await f.run();assert.equal(result.draft.title,title);assert.equal(f.seed().values.seo.title,title);assert.equal(f.calls,2);
 }
});

test('numeric 米 accepts Korean and SI meters but ordinary Chinese color/rice words are not lengths',async()=>{
 for(const name of ['1m 세트','1미터 세트']){const f=await fixture();f.job.result.seoOptions[0].name=name;assert.equal(f.seed().values.optionNames['rail-0'],name);}
 const f=await fixture(),target={...f.review.seoCompositionContext.selectedOptions[0]};
 for(const [source,name] of [['10厘米','10cm'],['10毫米','10mm'],['10毫升','10ml'],['AB-10 1米','AB-10 1m'],['米色','베이지'],['大米','쌀']]){
  target.name=source;assert.doesNotThrow(()=>typed.validateSeoOptionResults([{optionId:target.id,name}],[target],f.review,true));
 }
 for(const source of ['10厘米','10毫米','10毫升','AB-10 1米']){target.name=source;assert.throws(()=>typed.validateSeoOptionResults([{optionId:target.id,name:source==='AB-10 1米'?'1m':'10 세트'}],[target],f.review,true));}
});

test('TOP3 coverage counts selected options without warning about sixteen unrequested ordinary attributes',async()=>{
 const f=await fixture({validation:'throw'}),before=JSON.stringify(f.review.source),result=await f.run();assert.equal(result.seoOptions.length,5);assert.deepEqual(plain(result.draft.attributes),[]);assert.doesNotMatch(result.draft.warnings.join(' '),/16개 중 0개|누락 16개/);assert.equal(JSON.stringify(f.review.source),before);assert.equal(f.calls,2);
 const draft=f.job.result.draft;
 const generic=api.validateQwenTranslationDraft(draft,f.review.source,f.review.qwenTranslationPolicy,f.review.seoKeywordPolicy,f.review.seoComposition,f.review.seoCompositionContext,'all','couplus-typed-seo-v2');assert.match(generic.warnings.join(' '),/16개 중 0개/);
});

test('valid generated nouns, exact IDs and manual blanks retain their current behavior',async()=>{
 const f=await fixture(),result=await f.run();assert.equal(result.draft.title,'유앤채 곡선 커튼레일');assert.equal(f.seed().values.seo.title,'유앤채 곡선 커튼레일');
 for(const mutate of [rows=>{rows[0].optionId='foreign';},rows=>{rows[1].optionId=rows[0].optionId;}]){const rows=plain(result.seoOptions);mutate(rows);assert.throws(()=>typed.validateSeoOptionResults(rows,f.review.seoCompositionContext.selectedOptions,f.review,true));}
 const omitted=typed.validateSeoOptionResults([],f.review.seoCompositionContext.selectedOptions,f.review,true);assert.equal(omitted.values.length,0);assert.match(omitted.warnings.join(' '),/누락/);
 const editing={seo:{title:'',keywords:'직접 검색어'},optionNames:{'rail-0':''}},seed=f.seed();const merged=generated.mergeSeoGeneratedDraft(seed,{productId:f.options.productId,productVersion:f.job.productVersion,content:f.content,options:f.options},'owner',editing);assert.equal(merged.seo.title,'');assert.equal(merged.optionNames['rail-0'],'');
});

for(const unit of ['kg','ml','mm','cm','km','mg','g','m','l','밀리미터','센티미터','킬로미터','미터','밀리그램','킬로그램','그램','밀리리터','리터'])test('SR2 standalone measurement rejects producer and seed: '+unit,async()=>{
 const f=await fixture({title:'유앤채 '+unit,validation:'throw'}),before=JSON.stringify(f.job);await assert.rejects(f.run(),error=>error.code==='SEO_FACT_EMPTY'&&error.mayHaveBeenCharged===true);assert.throws(f.seed,error=>error.code==='SEO_FACT_EMPTY');assert.equal(f.calls,2);assert.equal(JSON.stringify(f.job),before);
});
test('SR2 measurement tokens do not erase genuine nouns and numeric brands',async()=>{
 for(const [title,brand] of [['유앤채 컵 kg','유앤채'],['유앤채 물병 ml','유앤채'],['ABC2M 컵','ABC2M'],['ABC2M 컵 1kg','ABC2M'],['유앤채 밀리미터자','유앤채']]){const f=await fixture({title,brand,validation:'throw'});assert.equal((await f.run()).draft.title,title);assert.equal(f.seed().values.seo.title,title);assert.equal(f.calls,2);}
});
