import test from 'node:test';
import assert from 'node:assert/strict';
import {mobileIntakeHarness} from './helpers/mobile-intake.mjs';
const qwen='@cf/qwen/qwen3-30b-a3b-fp8',llama='@cf/meta/llama-3.3-70b-instruct-fp8-fast';
// Synthetic source facts model the regression; no product or network is read.
const source={title:'4D翼型硅胶后跟贴 高跟鞋后跟保护垫',description:'硅胶后跟保护贴',attributes:[{name:'option:synthetic-black',value:'黑色'}],provenance:'manual',reference:'synthetic quality source'};
const good={title:'4D 날개형 실리콘 뒤꿈치 보호 패드',description:'실리콘 뒤꿈치 보호 패드',keywords:['뒤꿈치 패드','실리콘 패드'],attributes:[{sourceIndex:0,name:'option:synthetic-black',value:'검정'}],warnings:[]};
const review={model:qwen,maxOutputTokens:2048,instructionsVersion:'sourceflow-translation-v6',destination:'Cloudflare Workers AI',source,workersRecovery:{version:2,model:qwen}};
const envelope=value=>({object:'chat.completion',model:qwen,choices:[{index:0,finish_reason:'stop',message:{role:'assistant',content:JSON.stringify(value)}}]});
function run(callback){const h=mobileIntakeHarness();try{return callback(h);}finally{h.close();}}

test('the model-specific Qwen parser reads only one complete assistant JSON message and discards reasoning',()=>run(h=>{
 const parser=h.load('app/automation/workers-qwen-contract.ts').parseWorkersQwenJson;
 const response=envelope(good);response.choices[0].message.reasoning_content='private synthetic reasoning';
 assert.deepEqual(JSON.parse(JSON.stringify(parser(response).value)),good);assert.equal(Object.hasOwn(parser(response),'reasoning_content'),false);
}));
for(const kind of ['llama-envelope','multiple-choices','think-content','fenced-json','truncated','tool-calls','wrong-model','text-completion','array-json'])test(`Qwen refuses an unproven output contract (${kind})`,()=>run(h=>{
 const parser=h.load('app/automation/workers-qwen-contract.ts').parseWorkersQwenJson,response=envelope(good);
 if(kind==='llama-envelope'){delete response.choices;response.response=good;}
 if(kind==='multiple-choices')response.choices.push(response.choices[0]);
 if(kind==='think-content')response.choices[0].message.content='<think>synthetic</think>'+JSON.stringify(good);
 if(kind==='fenced-json')response.choices[0].message.content='```json\n'+JSON.stringify(good)+'\n```';
 if(kind==='truncated')response.choices[0].finish_reason='length';
 if(kind==='tool-calls')response.choices[0].message.tool_calls=[{id:'synthetic-tool'}];
 if(kind==='wrong-model')response.model=llama;
 if(kind==='text-completion')response.object='text_completion';
 if(kind==='array-json')response.choices[0].message.content='[]';
 assert.throws(()=>parser(response));
}));
test('recovery quality accepts Korean wording while retaining source-bound identifiers',()=>run(h=>{
 const quality=h.load('app/product-translation-quality.ts');assert.doesNotThrow(()=>quality.assertWorkersRecoveryDraftQuality(review,good));
 assert.equal(quality.unsupportedTranslatedProductClaim('방수 패드','防水保护垫'),null);
}));
for(const field of ['title','keywords','description','option'])test(`mixed Han cannot pass Korean recovery quality (${field})`,()=>run(h=>{
 const draft=structuredClone(good),quality=h.load('app/product-translation-quality.ts');
 if(field==='title')draft.title='4D 翼형 후跟贴 고跟구두용 방수 방습 후跟패드';
 if(field==='keywords')draft.keywords=['뒤꿈치贴'];
 if(field==='description')draft.description='후跟 패드입니다';
 if(field==='option')draft.attributes[0].value='검정色';
 assert.throws(()=>quality.assertWorkersRecoveryDraftQuality(review,draft),error=>error.code==='RECOVERY_UNTRANSLATED_TEXT');
}));
for(const claim of ['방수','방습','항균','살균','무독성','통증 완화'])test(`source-free added performance claim is refused (${claim})`,()=>run(h=>{
 const draft={...good,keywords:[claim+' 패드']},quality=h.load('app/product-translation-quality.ts');
 assert.throws(()=>quality.assertWorkersRecoveryDraftQuality({...review,source:{...source,category:{id:'synthetic',path:[claim]},guidance:{features:claim,keywords:claim}}},draft),error=>error.code==='RECOVERY_UNSUPPORTED_CLAIM');
}));
for(const boundary of ['seo','batch','integrated','options','label','label-reuse','quotation'])test(`archived bad Llama output stays read-only at the ${boundary} adoption boundary`,()=>run(h=>{
 const job={id:crypto.randomUUID(),productId:'synthetic',productVersion:'2026-10-22T00:00:00.000Z',contentRevision:0,status:'completed',review:{...review,model:llama,workersRecovery:{}},
  result:{model:llama,draft:{...good,title:'4D 翼형 후跟贴 고跟구두용 방수 방습 후跟패드'}}};
 const before=JSON.stringify(job),content={productId:job.productId,revision:0},options={productId:job.productId};
 const call=boundary==='seo'?()=>h.load('app/translation-adoption.ts').translationAdoptionInput(content,job,job.productVersion,['title'])
  :boundary==='batch'?()=>h.load('app/translation-batch-adoption.ts').translationBatchAdoption(content,job,job.productVersion)
  :boundary==='integrated'?()=>h.load('app/translation-integrated-adoption.ts').integratedTranslationPlan(content,options,job,job.productVersion)
  :boundary==='options'?()=>h.load('app/option-translation.ts').adoptOptionTranslations(options,job,job.productVersion)
  :boundary==='label'?()=>h.load('app/translation-label-adoption.ts').translationLabelAdoption(content,job,job.productVersion,[])
  :boundary==='label-reuse'?()=>h.load('app/translation-label-reuse.ts').translationLabelReuseView({job,content,labels:{}})
  :()=>h.load('app/quotation-translation-adoption.ts').quotationTranslationMatches(job.productId,{},job);
 if(boundary==='quotation')assert.equal(call(),false);else assert.throws(call,error=>error.code==='RECOVERY_UNTRANSLATED_TEXT');
 assert.equal(JSON.stringify(job),before);
}));
