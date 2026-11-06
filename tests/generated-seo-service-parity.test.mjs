import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {seoWorkspaceHarness} from './helpers/seo-workspace.mjs';
import {mobileIntakeHarness} from './helpers/mobile-intake.mjs';
const fixtures=JSON.parse(fs.readFileSync(new URL('./fixtures/ten-category-seo-tags.json',import.meta.url),'utf8'));
const plain=v=>JSON.parse(JSON.stringify(v));
const policy='couplus-generated-v1';
for(const row of fixtures)test(`generated metadata and every native document agree for anonymous category ${row.case}`,async()=>{
 const h=seoWorkspaceHarness();try{
  const api=h.load('app/seo-workspace-client.ts'),clean=h.load('app/seo-keyword-text.ts');
  const view=await(await h.request()).json(),draft={seo:{keywords:row.keywords.join(', ')},optionNames:{},generatedKeywords:{text:row.keywords.join(', '),values:row.keywords}};
  const input=api.seoWorkspaceInput(view,draft),response=await h.request('PATCH',input);assert.equal(response.status,200,await response.clone().text());
  const saved=await response.json();assert.deepEqual(saved.content.seo.keywords.value,plain(clean.cleanSeoKeywordCandidates(row.keywords)));
  const expected=clean.quotationSeoKeywordText(saved.content);for(const tags of row.searchTags)assert.equal(expected,tags);
  assert.deepEqual(saved.options,view.options);assert.equal(saved.content.seo.keywords.provenance,'manual');
  const route=h.load('app/api/products/[id]/quotation-fields/route.ts'),fields=await(await route.GET(new Request('https://app.test'),{params:Promise.resolve({id:h.id})})).json();
  for(const option of fields.automatic.rows)assert.equal(option.fields.searchTags.value,expected);
  const edited=api.seoWorkspaceInput(saved,{...draft,seo:{keywords:'직접 태그'}});assert.equal(edited.seo.keywordText,'직접 태그');assert.equal(edited.seo.keywordPolicy,undefined);
 }finally{h.close();}
});
test('new Qwen reviews retain full candidates and old reviewed contracts still reject overflow',async()=>{
 const h=mobileIntakeHarness();try{
  const t=h.load('app/automation/translation.ts'),keywords=fixtures.at(-1).keywords,source={title:'실커튼',description:keywords.join(', '),attributes:[],provenance:'manual',reference:'synthetic'};
  const draft={title:'실커튼',description:'',keywords,attributes:[],warnings:[]};
  assert.deepEqual(plain(t.validateQwenTranslationDraft(draft,source,'commerce-exact-option-colors-v6',policy).keywords),keywords);
  assert.throws(()=>t.validateQwenTranslationDraft(draft,source,'commerce-exact-option-colors-v6'));
  let calls=0;const config={provider:'workers-ai',model:t.WORKERS_QWEN_MODEL,maxOutputTokens:4096,apiKey:'',ai:{run:async(_model,input)=>{calls++;assert.equal(input.response_format.json_schema.properties.keywords.maxItems,undefined);return {response:draft,model:t.WORKERS_QWEN_MODEL};}}};
  const review=await t.prepareTranslationReview(source,config);assert.equal(review.seoKeywordPolicy,policy);
  const request=t.buildTranslationRequest(review);assert.equal(request.text.format.schema.properties.keywords.maxItems,undefined);
  const result=await t.executeTranslation(review,config,()=>assert.fail('No external request'));assert.equal(calls,1);assert.deepEqual(plain(result.draft.keywords),keywords);
 }finally{h.close();}
});

test('new dedicated generation cleans full candidate arrays and transports no item cap; old reviews stay bounded',async()=>{
 const h=mobileIntakeHarness();try{
  const seo=h.load('app/seo-generation.ts'),config=seo.seoGenerationConfiguration({SOURCEFLOW_QUOTATION_AI_PROVIDER:'workers-ai',SOURCEFLOW_QUOTATION_AI_FREE_ONLY:'true',AI:{run:async()=>({})}});
  for(const row of fixtures){
   const source={title:'상품 태그',description:row.keywords.join(', '),attributes:[],provenance:'manual',reference:'synthetic',category:{id:'1',path:['합성']}},proof={purpose:'seo-generation',version:1,sourceFingerprint:'a'.repeat(64),optionRevision:1,company:{code:'A01526306',name:'유앤채'},memo:{brand:'',features:'',keywords:''}};
   const review=await seo.prepareSeoGenerationReview(source,proof,config);assert.equal(review.seoKeywordPolicy,policy);
   const raw={title:'상품 태그',description:'',keywords:row.keywords,attributes:[],warnings:[]};let calls=0;
   const result=await seo.executeSeoGeneration(review,async(_model,input)=>{calls++;assert.equal(input.response_format.json_schema.properties.keywords.maxItems,undefined);assert.equal(input.response_format.json_schema.properties.keywords.items.maxLength,20);return{response:JSON.stringify(raw)};});
   assert.equal(calls,1);assert.deepEqual(plain(result.draft.keywords),row.keywords);
   assert.deepEqual(plain(seo.validateSeoGenerationDraft(result.draft,review).keywords),row.keywords);
  }
 }finally{h.close();}
});
test('generation adoption preserves full metadata, empty document retention, manual blanks and stale editable seeds',async()=>{
 const h=seoWorkspaceHarness();try{
  const modules={gen:h.load('app/seo-generated-draft.ts'),client:h.load('app/seo-workspace-client.ts'),batch:h.load('app/translation-batch-adoption.ts'),content:h.load('app/product-content.ts'),tags:h.load('app/seo-keyword-text.ts')};
  const view=await(await h.request()).json(),content=structuredClone(view.content);for(const field of ['title','keywords','description'])content.seo[field].provenance='collected';
  const keywords=fixtures[5].keywords,source={title:'상품 태그',description:keywords.join(', '),attributes:[],reference:'synthetic',provenance:'manual'};
  const job={id:'synthetic-job',productId:h.id,productVersion:h.version,contentRevision:content.revision,status:'completed',error:null,review:{model:'synthetic',fingerprint:'a'.repeat(64),seoKeywordPolicy:policy,source},result:{model:'synthetic',draft:{title:'상품 태그',description:'',keywords,attributes:[],warnings:[]}}};
  const seed=modules.gen.createSeoGeneratedDraft({productVersion:h.version,content,options:view.options,job,brand:'',memo:{brand:'',features:'',keywords:''}});assert.equal(seed.values.generatedKeywords.values.length,108);
  const seededView={...view,content};const merged=modules.gen.mergeSeoGeneratedDraft(seed,seededView,undefined,{seo:{},optionNames:{}});const input=modules.client.seoWorkspaceInput(seededView,merged);assert.equal(input.seo.keywords.length,108);
  const manual=modules.gen.mergeSeoGeneratedDraft(seed,seededView,undefined,{seo:{keywords:''},optionNames:{}});assert.equal(manual.seo.keywords,'');assert.equal(manual.generatedKeywords,undefined);
  const plan=modules.batch.translationBatchAdoption(content,job,h.version),saved=modules.content.applyContentPatch(content,plan.input.patch,'2026-11-06T12:00:00.000Z');assert.equal(saved.seo.keywords.value.length,108);assert.equal(modules.tags.quotationSeoKeywordText(saved),fixtures[5].searchTags[0]);
  job.result.draft.keywords=[];const empty=modules.batch.translationBatchAdoption(saved,{...job,contentRevision:saved.revision},h.version);assert.equal(empty.input,null); // A previous explicit manual confirmation remains protected.
  saved.seo.keywords.provenance='generated';const cleared=modules.batch.translationBatchAdoption(saved,job,h.version),next=modules.content.applyContentPatch(saved,cleared.input.patch,'2026-11-06T12:01:00.000Z');assert.deepEqual(plain(next.seo.keywords.value),[]);assert.equal(modules.tags.quotationSeoKeywordText(next),fixtures[5].searchTags[0]);
 }finally{h.close();}
});
test('new policy cleans noise while still rejecting unsafe suffix facts before document clipping',async()=>{
 const h=mobileIntakeHarness();try{
  const t=h.load('app/automation/translation.ts'),source={title:'구두 패드',description:'',attributes:[],reference:'synthetic',provenance:'manual'},raw={title:'구두 패드',description:'',keywords:[' 구두  패드!','구두 패드','ㄱ',' ','가'.repeat(21)],attributes:[],warnings:[]};
  assert.deepEqual(plain(t.validateQwenTranslationDraft(raw,source,'commerce-exact-option-colors-v6',policy).keywords),['구두 패드']);
  for(const term of ['패드 99999','항균 패드'])assert.throws(()=>t.validateQwenTranslationDraft({...raw,keywords:[...fixtures[5].keywords,term]}, {...source,description:fixtures[5].keywords.join(', ')},'commerce-exact-option-colors-v6',policy));
 }finally{h.close();}
});
