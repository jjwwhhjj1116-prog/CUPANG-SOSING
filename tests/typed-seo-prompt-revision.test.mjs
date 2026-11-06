import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {providedOptionModule} from './helpers/provided-option-quotation.mjs';

const api=providedOptionModule('app/automation/translation.ts');
const model=providedOptionModule('app/automation/model.ts');
const plain=value=>JSON.parse(JSON.stringify(value));
const digest=value=>createHash('sha256').update(typeof value==='string'?value:JSON.stringify(value)).digest('hex');
const keys=['title','keywords','description','attributes','warnings','seoOptions'];
const source={title:'旧标题 99cm 手腕垫',description:'',attributes:[{name:'材质',value:'棉'}],provenance:'manual',reference:'inert local prompt contract',category:{id:'synthetic-pad',path:['손목 패드']}};
const composition={version:'couplus-current-composition-v1',memo:{brand:'검토 브랜드',features:'10cm 손목 패드',keywords:'손목패드'},related:{source:'provided',query:'손목패드',keywords:['손목 패드','사무용 패드'],warnings:[]}};
const context={optionRevision:2,bundleQuantity:null,selectedOptions:[
 {id:'owned-black-1',name:'黑色 / 10cm',nameTrans:'',color:'黑色',size:'10cm',bundleQuantity:1,manualName:false,manualColor:false,manualSize:false},
 {id:'owned-white-2',name:'白色 / 10cm',nameTrans:'',color:'白色',size:'10cm',bundleQuantity:1,manualName:false,manualColor:false,manualSize:false},
]};
function fixture(){
 const calls=[],config={provider:'workers-ai',apiKey:'',model:api.WORKERS_QWEN_MODEL,maxOutputTokens:4096,ai:{run:async(actual,input)=>{
  assert.equal(actual,api.WORKERS_QWEN_MODEL);calls.push(plain(input));
  const body=JSON.parse(input.messages[1].content.split('\n\nPRODUCT_SOURCE_JSON:\n')[1].slice(0,-'\n/no_think'.length));
  const result=body.validationDraft??{title:body.optionExamples?'':'면 손목 패드 10cm',description:'',keywords:body.optionExamples?[]:['손목 패드','사무용 패드'],attributes:body.attributes.map(value=>({sourceIndex:value.sourceIndex,name:'재질',value:'면'})),warnings:[],seoOptions:body.seoOptionTargets.map(value=>({optionId:value.id,name:value.color==='黑色'?'검정 10cm':'흰색 10cm',color:value.color==='黑色'?'검정':'흰색',size:'10cm'}))};
  return {choices:[{finish_reason:'stop',message:{role:'assistant',content:JSON.stringify(result)}}]};
 }}};
 return {calls,config};
}
function historicalReview(){
 return {model:api.WORKERS_QWEN_MODEL,maxOutputTokens:4096,source:plain(source),inputCharacters:JSON.stringify(source).length,instructionsVersion:'sourceflow-translation-v6',destination:'Cloudflare Workers AI',paidNotice:'Inert local approved review',pricingUrl:'',expiresAt:'2026-11-06T00:15:00.000Z',fingerprint:'historical-placeholder',reviewId:'00000000-0000-4000-8000-000000000041',seoKeywordPolicy:'couplus-generated-v1',qwenTranslationPolicy:'commerce-exact-option-colors-v6',seoComposition:plain(composition),seoCompositionContext:plain(context)};
}
const noNetwork=()=>assert.fail('No external model, app or database request is allowed');
const approvedHistorical={request:'1c64c61bbc8708de4b2504eebdbb7315b7a6bed824ca41002f08a9c79d13be1f',transport:'e9276642b226b815c7374fc14deaa3628d3fe60b580ec2d370e8c64bcc0d6042',fingerprint:'cd95fc00bb2a5584f92b2d3a9f0bc4737f5e07e65817359cdd260f36081954dd'};
const approvedTypedV1={request:'cf09f027bb269b885cedcd259f6ad1c05f4ee9fa7a324e53cb9edc956199fc42',transport:'af0f94261dfcd0908af9f6ac08988fc885bbdf38b129806c1fae8e659537c053',fingerprint:'3b43e6dbc138e87330df047dd135f354c47a49d74c956c8f7de17f55b4fe4a20',pipeline:'0cfd5f5b67e4f6fcd2596f7cfc756cc504a0ee1de625d1b70b8db67b92bdb4fb',validation:'d3c2192b1076bdbfaf7c2d61094b2d82d8c40d201df6c7c8907bf40001a5cc23'};

test('new typed SEO approval seals the prompt revision while ordinary and context-free reviews keep their legacy identity',async()=>{
 const f=fixture(),review=await api.prepareTranslationReview(plain(source),f.config,new Date('2026-11-06T00:00:00.000Z'),plain(composition),plain(context));
 assert.equal(review.typedSeoPromptRevision,'couplus-typed-seo-v4');
 const {fingerprint,...signed}=review;assert.equal(await model.fingerprint(signed),fingerprint);
 delete signed.typedSeoPromptRevision;assert.notEqual(await model.fingerprint(signed),fingerprint,'A prompt change requires a different approval fingerprint');
 for(const [policy,targets]of [[undefined,undefined],[plain(composition),undefined]]){
  const legacy=await api.prepareTranslationReview(plain(source),f.config,new Date(),policy,targets);
  assert.equal(Object.hasOwn(legacy,'typedSeoPromptRevision'),false);
 }
 for(const config of [{...f.config,provider:'openai',model:'synthetic-model'},{...f.config,model:api.WORKERS_TEXT_MODEL}]){
  const legacy=await api.prepareTranslationReview(plain(source),config,new Date(),plain(composition),plain(context));
  assert.equal(Object.hasOwn(legacy,'typedSeoPromptRevision'),false);
 }
});

test('approved typed v3 Qwen transport consistently requests six keys and gives selected facts final priority',async()=>{
 const f=fixture(),review={...await api.prepareTranslationReview(plain(source),f.config,new Date(),plain(composition),plain(context)),typedSeoPromptRevision:'couplus-typed-seo-v3'};
 const result=await api.executeTranslation(review,f.config,noNetwork),request=f.calls[0];
 assert.deepEqual(Array.from(request.response_format.json_schema.required),keys);
 const directive=request.messages[1].content.match(/these (five|six) keys: ([^.]+)\./u);
 assert.ok(directive,'The provider user message must state its output contract');
 assert.equal(directive[1],'six');assert.deepEqual(directive[2].split(',').map(value=>value.trim()),keys);
 const system=request.messages[0].content;
 assert.doesNotMatch(system,/title,keywords,description,attributes,warnings 키의 JSON/u);
 const example=system.match(/JSON 객체 예: (\{[^\n]+\})/u);assert.ok(example,'Typed SEO supplies a matching structural example');
 assert.deepEqual(Object.keys(JSON.parse(example[1])),keys);
 assert.ok(system.lastIndexOf('현재 SEO 구성 정책:')>system.indexOf('title, description, attributes의 명시된 사실만 번역하세요.'),'Current selection rules must follow the generic translation rules');
 const body=JSON.parse(request.messages[1].content.split('\n\nPRODUCT_SOURCE_JSON:\n')[1].slice(0,-'\n/no_think'.length));
 assert.equal(body.currentMemo.features,'10cm 손목 패드');assert.equal(body.sourceTitleAuthority,'reference');
 assert.deepEqual(body.seoOptionTargets.map(value=>value.id),['owned-black-1','owned-white-2']);
 assert.equal(result.draft.title,'면 손목 패드 10cm','Normal provider spacing is not rewritten');
 assert.deepEqual(Array.from(result.draft.keywords),['손목 패드','사무용 패드']);
 assert.equal(f.calls.length,2,'One generation plus the existing bounded response-validation request');
});

test('already approved typed reviews without a revision preserve their exact request, transport and fingerprint bytes',async()=>{
 const f=fixture(),review=historicalReview(),before=JSON.stringify(review),request=api.buildTranslationRequest(review);
 assert.equal(digest(request),approvedHistorical.request);
 const {fingerprint,...signed}=review;void fingerprint;assert.equal(await model.fingerprint(signed),approvedHistorical.fingerprint);
 await api.executeTranslation(review,f.config,noNetwork);
 assert.equal(digest(f.calls[0]),approvedHistorical.transport);
 assert.equal(digest(f.calls),'155bd3db409292935db50e51a6aae6b52a9f266530b7d60d6d6bb4b60b86c7b7');
 assert.equal(JSON.stringify(review),before);
});

test('already approved typed v1 reviews preserve the whole provider pipeline and approval identity',async()=>{
 const f=fixture(),review={...historicalReview(),typedSeoPromptRevision:'couplus-typed-seo-v1'},before=JSON.stringify(review);
 assert.equal(digest(api.buildTranslationRequest(review)),approvedTypedV1.request);
 const {fingerprint,...signed}=review;void fingerprint;assert.equal(await model.fingerprint(signed),approvedTypedV1.fingerprint);
 await api.executeTranslation(review,f.config,noNetwork);
 assert.equal(digest(f.calls[0]),approvedTypedV1.transport);assert.equal(digest(f.calls),approvedTypedV1.pipeline);
 assert.equal(JSON.stringify(review),before);
});

test('approved typed v3 SEO keeps the source-supported item noun and asks for additional relevant search candidates without changing validation',async()=>{
 const f=fixture(),review={...await api.prepareTranslationReview(plain(source),f.config,new Date(),plain(composition),plain(context)),typedSeoPromptRevision:'couplus-typed-seo-v3'};
 const result=await api.executeTranslation(review,f.config,noNetwork),system=f.calls[0].messages[0].content;
 assert.match(system,/주품목 명사는 effectiveTargetKeyword와 categoryLabel이 가리키는 실제 상품/u);
 assert.match(system,/원제목이나 관련어의 다른 품목으로 바꾸지 마세요/u);
 assert.match(system,/제공된 관련어 중 실제 상품에 맞는 것을 활용하고, 추가로 상품에 맞는 관련 검색어도 생성하세요/u);
 const body=JSON.parse(f.calls[0].messages[1].content.split('\n\nPRODUCT_SOURCE_JSON:\n')[1].slice(0,-'\n/no_think'.length));
 assert.equal(body.effectiveTargetKeyword,'손목패드');assert.equal(body.categoryLabel,'손목 패드');assert.deepEqual(body.seoOptionTargets.map(value=>value.size),['10cm','10cm']);
 assert.equal(result.draft.title,'면 손목 패드 10cm','The instruction change must not append or replace the target keyword in model output');
 assert.equal(f.calls.length,2);assert.equal(digest(f.calls[1]),approvedTypedV1.validation,'Existing Korean-preserving validation is unchanged');
 const follow=fixture(),continued=await api.executeTranslation(review,follow.config,noNetwork,{examples:[],targets:context.selectedOptions.slice(0,1),optionOnly:true});
 assert.doesNotMatch(follow.calls[0].messages[0].content,/주품목 명사는 effectiveTargetKeyword/u,'Option-only continuations must not request SEO generation again');
 assert.equal(continued.draft.title,'');assert.deepEqual(Array.from(continued.draft.keywords),[]);assert.equal(follow.calls.length,1);
});

test('unknown or context-free typed prompt revisions are rejected before any provider request',async()=>{
 for(const patch of [{typedSeoPromptRevision:'unreviewed-revision'},...['couplus-typed-seo-v1','couplus-typed-seo-v2','couplus-typed-seo-v3','couplus-typed-seo-v4'].flatMap(typedSeoPromptRevision=>[{typedSeoPromptRevision,seoCompositionContext:undefined},{typedSeoPromptRevision,seoComposition:undefined}])]){
  const f=fixture(),review={...historicalReview(),...patch};
  await assert.rejects(api.executeTranslation(review,f.config,noNetwork),error=>error.code==='UNSUPPORTED_INSTRUCTIONS'&&!error.mayHaveBeenCharged);
  assert.equal(f.calls.length,0);
 }
});


test('typed v2 request, whole pipeline and fingerprint remain exact while v3 keeps its request bytes',async()=>{
 const f=fixture(),review={...historicalReview(),typedSeoPromptRevision:'couplus-typed-seo-v2'},before=JSON.stringify(review);
 assert.equal(digest(api.buildTranslationRequest(review)),'23f3d01c42e2104f6a3b8d99274d60ab740fe7c670db3e7ea6eaae70183619a8');
 const {fingerprint,...signed}=review;void fingerprint;assert.equal(await model.fingerprint(signed),'690270f67cde94c05d3691e1214cf26babb94fc3563e0abd95cfe14a24805204');
 await api.executeTranslation(review,f.config,noNetwork);assert.equal(digest(f.calls),'2b07121da13b93a7b55c2a2fff2d0cf046f1b333808343835c7a7718daf99d42');assert.equal(JSON.stringify(review),before);
 const v3={...review,typedSeoPromptRevision:'couplus-typed-seo-v3'};assert.equal(digest(api.buildTranslationRequest(v3)),digest(api.buildTranslationRequest(review)));
});
