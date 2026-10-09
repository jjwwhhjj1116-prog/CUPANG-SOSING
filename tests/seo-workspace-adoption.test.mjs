import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {mobileIntakeHarness} from './helpers/mobile-intake.mjs';

// Reuse the recorded source's faithful translation dictionary. Every source,
// Google response and product write is confined to this disposable API fixture.
const helper=fs.readFileSync(new URL('./helpers/mobile-intake.mjs',import.meta.url),'utf8');
const dictionary=vm.runInNewContext(helper.match(/const genericTranslation=(new Map\(Object\.entries\(\{[\s\S]+?\}\)\));/u)[1]);
const companies=[{code:'A01526306',name:'유앤채'}];
const path=['패션의류잡화','유니섹스/남녀공용 패션','공용 잡화','선글라스','남녀공용패션선글라스'];
const json=async(response,status=200)=>{assert.equal(response.status,status,await response.clone().text());return response.json();};
const plain=value=>JSON.parse(JSON.stringify(value));
async function fixture(company,manualKeywords){
 let mode='initial-stop';const queries=[],translations=new Map(dictionary);
 const colors=new Map([['亮黑','유광 검정'],['砂黑','무광 검정'],['砂灰','무광 회색']]),sizes=new Map([['太阳镜','선글라스'],['太阳镜 加005 盒子','선글라스 + 005 케이스']]);
 for(const pair of [...colors,...sizes])translations.set(...pair);
 for(const [color,colorText]of colors)for(const [size,sizeText]of sizes)translations.set(color+' / '+size,colorText+' / '+sizeText);
 const h=mobileIntakeHarness({companyCode:company.code,companyName:company.name,translationFetcher:async target=>{
  const url=new URL(target),q=url.searchParams.get('q');assert.equal(url.origin+url.pathname,'https://translate.googleapis.com/translate_a/single');assert.equal(url.searchParams.get('client'),'gtx');assert.ok(q.length<=5000);queries.push(q);
  if(mode==='initial-stop')return new Response('offline terminal quota fixture',{status:429});
  const translate=value=>{assert.ok(translations.has(value),'Unrecorded source translation: '+value);return translations.get(value);};
  const output=q.startsWith('[[YFTR')?q.split('\n').map(line=>{const match=/^(\[\[YFTR\d{6}\]\]) (.+)$/u.exec(line);assert.ok(match);return match[1]+' '+translate(match[2]);}).join('\n'):translate(q);
  return Response.json([[[output,q]],null,'zh-CN']);
 }});
 try{
  // A synthetic category contract belongs to this company before collection.
  // No private Single or downloaded workbook is relabeled for the test.
  const hubSchema={format:'supplier-hub-schema-v1',categoryId:'69900',categoryPath:path,company:{...company},observedAt:Date.now(),metadata:{kanCategoryId:2624,noticeNumber:4,scopeType:'Retail_Categorized_Single',version:188},inputBindings:'couplus-paths-v1',schemaString:JSON.stringify({type:'object',properties:{startPage:{type:'object',properties:{productName:{type:'string',title:'상품명'},categoryPath:{type:'string',title:'카테고리'}}},productPage:{type:'object',properties:{}},legalPage:{type:'object',properties:{}}}})};
  const profile=await h.load('db/category-profiles.ts').createCategoryProfile('owner',{name:'ISOLATED SEO ADOPTION CONTRACT',categoryId:'69900',categoryPath:path,hubSchema,template:null,mappings:[]},'cat');
  h.context.category=profile;h.context.features='저장된 특징 메모';h.context.keywords='초기 타겟, 선글라스';
  h.sqlite.prepare('UPDATE collection_context SET payload=?').run(JSON.stringify(h.context));h.sqlite.prepare("UPDATE collection_jobs SET goal='work'").run();
  h.bindings.SOURCEFLOW_TEXT_PROVIDER='google-free';delete h.bindings.AI;
  assert.match(await h.intake(),/HTTP 429/);assert.equal(queries.length,1);
  const product=h.sqlite.prepare('SELECT * FROM products').get(),base='/api/products/'+product.id;
  const initial=h.sqlite.prepare("SELECT * FROM translation_jobs WHERE idempotency_key='intake-auto-v1'").get();assert.equal(initial.status,'failed');
  const content=(await json(await h.route(base+'/content'))).content;
  assert.deepEqual(content.intakeKeywordSeed.value,['초기 타겟','선글라스']);
  await json(await h.route(base+'/content',{method:'PATCH',body:{expectedRevision:content.revision,patch:{
   label:{productName:'직접 검토한 라벨 품명',model:'직접 모델',manufacturer:'직접 제조사',material:'직접 재질',dimensions:'',countryOfOrigin:''},
   ...(manualKeywords!==undefined?{seo:{keywords:manualKeywords}}:{}),
  }}}));
  const options=await json(await h.route(base+'/options'));
  await json(await h.route(base+'/option-names',{method:'PATCH',body:{expectedRevision:options.options.revision,expectedProductVersion:options.productVersion,changes:[{optionId:options.options.rows[0].id,value:'직접 검토한 첫 옵션'}]}}));
  const receipt=await h.load('db/collection-results.ts').readCollectionResult('owner','job'),job=await h.load('db/collection-jobs.ts').findCollectionJob('owner','job'),currentOptions=(await json(await h.route(base+'/options'))).options;
  const source=h.load('app/collected-seo-source.ts').collectedSeoSource(receipt.result,job,currentOptions).source;
  translations.set(source.title,'원문 기준 선글라스');if(source.description)translations.set(source.description,'판매자 설명');
  const api=h.load('app/seo-workspace-draft.ts'),current=(await json(await h.route(base+'/content'))).content;
  const state=api.createSeoWorkspaceDraftState({productId:product.id,productVersion:h.sqlite.prepare('SELECT updated_at FROM products').get().updated_at,contentRevision:current.revision,source,
   memo:{brand:company.name,features:'현재 참고 특징',keywords:'현재 참고 키워드'},configuration:h.load('app/automation/translation.ts').translationConfiguration(h.bindings)});
  const fetcher=(target,init={})=>h.route(String(target),{method:init.method??'GET',body:init.body});
  mode='success';return{h,api,state,source,base,productId:product.id,queries,initial:JSON.stringify(initial),fetcher,current,currentOptions,receipt:JSON.stringify(receipt),context:h.sqlite.prepare('SELECT payload FROM collection_context').get().payload};
 }catch(cause){h.close();throw cause;}
}

for(const company of companies)for(const manualKeywords of [undefined,['초기 타겟','선글라스'],[]])test(`workspace Google result applies untouched intake tags and preserves explicit ${manualKeywords===undefined?'no keyword edit':manualKeywords.length?'same-value keyword edit':'blank keyword edit'} (${company.code})`,async()=>{
 const f=await fixture(company,manualKeywords);try{
  const beforeContent=f.h.sqlite.prepare('SELECT payload FROM product_content').get().payload,beforeOptions=f.h.sqlite.prepare('SELECT payload FROM product_options').get().payload;
  assert.equal(f.state.source.guidance.keywords,f.source.guidance.keywords);assert.match(f.state.source.guidance.features,/현재 참고 키워드/u);
  const outcome=await f.api.runSeoWorkspaceDraft(f.state,{signal:new AbortController().signal,fetcher:f.fetcher,onState:()=>{},isContextCurrent:()=>true});
  assert.equal(outcome.job.status,'completed');assert.equal(outcome.partial,false);assert.equal(f.h.aiSources.length,0);
  assert.equal(f.h.sqlite.prepare('SELECT payload FROM product_content').get().payload,beforeContent);assert.equal(f.h.sqlite.prepare('SELECT payload FROM product_options').get().payload,beforeOptions,'draft execution does not save options');
  const body={jobId:outcome.job.id,expectedVersion:f.state.productVersion};
  const preview=await json(await f.h.route(f.base+'/translation-apply',{method:'POST',body:{...body,action:'preview'}}));
  assert.equal(preview.preview.some(row=>row.name==='검색어'),manualKeywords===undefined,JSON.stringify({preview:preview.preview,skipped:preview.skipped}));
  assert.ok(preview.preview.some(row=>row.name==='상품명'));assert.ok(preview.preview.some(row=>row.name.includes('옵션명')));
  await json(await f.h.route(f.base+'/translation-apply',{method:'POST',body:{...body,action:'apply',fingerprint:preview.fingerprint}}));
  const saved=(await json(await f.h.route(f.base+'/content'))).content,savedOptions=(await json(await f.h.route(f.base+'/options'))).options;
  assert.deepEqual(saved.seo.keywords.value,manualKeywords===undefined?plain(outcome.job.result.draft.keywords):manualKeywords);
  const quotation=await json(await f.h.route(f.base+'/quotation-fields')),included=quotation.resolved.rows.filter(row=>row.included);
  const expectedTags=(manualKeywords===undefined?outcome.job.result.draft.keywords:manualKeywords).join(', ');
  assert.equal(quotation.categoryContext.categoryId,'69900');assert.equal(included.length,6);
  assert.deepEqual(included.map(row=>row.fields.searchTags.value),Array(6).fill(expectedTags),'stage seven resolves the same generated or deliberately saved tags for every included option');
  assert.ok(saved.seo.title.value.endsWith(outcome.job.result.draft.title));assert.equal(saved.intakeKeywordSeed,undefined);
  for(const key of ['productName','model','manufacturer','material','dimensions','countryOfOrigin'])assert.deepEqual(saved.label[key],f.current.label[key]);
  assert.equal(savedOptions.rows[0].translatedName,'직접 검토한 첫 옵션');assert.equal(savedOptions.rows[0].provenance.translatedName,'manual');
  for(const row of savedOptions.rows){
   const original=f.currentOptions.rows.find(item=>item.id===row.id);
   for(const key of ['originalName','supplierSku','included','stock','unitCostCny','unitsPerPack','minimumOrderQuantity','imageKey','widthCm','lengthCm','heightCm','weightKg','packagedWeightG','packagedWidthMm','packagedLengthMm','packagedHeightMm','packagingUnitsPerPack'])assert.deepEqual(row[key],original[key],key);
   if(row.id!==savedOptions.rows[0].id)assert.equal(row.provenance.translatedName,'translated');
  }
  assert.equal(JSON.stringify(await f.h.load('db/collection-results.ts').readCollectionResult('owner','job')),f.receipt);assert.equal(f.h.sqlite.prepare('SELECT payload FROM collection_context').get().payload,f.context);
  assert.equal(JSON.stringify(f.h.sqlite.prepare("SELECT * FROM translation_jobs WHERE idempotency_key='intake-auto-v1'").get()),f.initial,'the terminal Google429 history is never rewritten');
  const requests=f.queries.length;await f.api.refreshSeoWorkspaceDraft(f.state,{signal:new AbortController().signal,fetcher:f.fetcher,onState:()=>{}});assert.equal(f.queries.length,requests);
  assert.equal(f.h.sqlite.prepare('SELECT supplier_hub_status FROM products').get().supplier_hub_status,'미전송');
 }finally{f.h.close();}
});
