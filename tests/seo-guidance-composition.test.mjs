import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {mobileIntakeHarness} from './helpers/mobile-intake.mjs';

const plain=value=>JSON.parse(JSON.stringify(value));
const json=async(response,status=200)=>{assert.equal(response.status,status,await response.clone().text());return response.json();};
const helper=fs.readFileSync(new URL('./helpers/mobile-intake.mjs',import.meta.url),'utf8');
const dictionary=vm.runInNewContext(helper.match(/const genericTranslation=(new Map\(Object\.entries\(\{[\s\S]+?\}\)\));/u)[1]);
const companies=[{code:'A01526306',name:'유앤채'},{code:'A01464742',name:'와이홉'}];
const memo={brand:'현재 브랜드',features:'원형테',keywords:'휴대용 안경, 선글라스'};
const composition={...memo,title:'현재 브랜드 원형테 우드 패턴 다리 선글라스 휴대용 안경'};
async function fixture(company,{manualSeo,automatic=false,linkedName=false}={}){
 const queries=[],translations=new Map(dictionary),colors=new Map([['亮黑','유광 검정'],['砂黑','무광 검정'],['砂灰','무광 회색']]),sizes=new Map([['太阳镜','선글라스'],['太阳镜 加005 盒子','선글라스 + 005 케이스']]);
 for(const pair of [...colors,...sizes])translations.set(...pair);
 for(const [color,colorText]of colors)for(const [size,sizeText]of sizes)translations.set(color+' / '+size,colorText+' / '+sizeText);
 const h=mobileIntakeHarness({companyCode:company.code,companyName:company.name,translationFetcher:async target=>{
  const q=new URL(target).searchParams.get('q');queries.push(q);
  const translate=value=>{assert.ok(translations.has(value),'Unrecorded translation '+value);return translations.get(value);};
  return Response.json([[[q.startsWith('[[YFTR')?q.split('\n').map(line=>{const match=/^(\[\[YFTR\d{6}\]\]) (.+)$/u.exec(line);assert.ok(match);return match[1]+' '+translate(match[2]);}).join('\n'):translate(q),q]],null,'zh-CN']);
 }});
 try{
  h.sqlite.prepare('UPDATE collection_jobs SET goal=?').run(automatic?'work':'collect');h.context.features='수집 특징';h.context.keywords='기존 타겟, 선글라스';h.sqlite.prepare('UPDATE collection_context SET payload=?').run(JSON.stringify(h.context));
  await h.intake();const product=h.sqlite.prepare('SELECT * FROM products').get(),base='/api/products/'+product.id,initial=(await json(await h.route(base+'/content'))).content;
  const label=Object.fromEntries(Object.keys(initial.label).filter(key=>!linkedName||key!=='productName').map(key=>[key,key==='productName'?'검토한 라벨 품명':key==='countryOfOrigin'||key==='certification'?'':'직접 검토 '+key]));
  await json(await h.route(base+'/content',{method:'PATCH',body:{expectedRevision:initial.revision,patch:{label,...(linkedName?{labelProductNameLinked:true}:{}),...(manualSeo?{seo:manualSeo}:{})}}}));
  const options=(await json(await h.route(base+'/options'))).options;
  await json(await h.route(base+'/option-names',{method:'PATCH',body:{expectedRevision:options.revision,expectedProductVersion:h.sqlite.prepare('SELECT updated_at FROM products').get().updated_at,changes:[{optionId:options.rows[0].id,value:'직접 검토한 옵션'}]}}));
  const receipt=(await h.load('db/collection-results.ts').readCollectionResult('owner','job')).result,collection=await h.load('db/collection-jobs.ts').findCollectionJob('owner','job');
  const currentOptions=(await json(await h.route(base+'/options'))).options,source=h.load('app/collected-seo-source.ts').collectedSeoSource(receipt,collection,currentOptions).source;
  translations.set(source.title,'우드 패턴 다리 선글라스');if(source.description)translations.set(source.description,'판매자 설명');
  h.bindings.SOURCEFLOW_TEXT_PROVIDER='google-free';delete h.bindings.AI;
  const content=(await json(await h.route(base+'/content'))).content,version=h.sqlite.prepare('SELECT updated_at FROM products').get().updated_at,api=h.load('app/seo-workspace-draft.ts');
  const state=api.createSeoWorkspaceDraftState({productId:product.id,productVersion:version,contentRevision:content.revision,source,memo,configuration:h.load('app/automation/translation.ts').translationConfiguration(h.bindings)});
  const fetcher=(target,init={})=>h.route(String(target),{method:init.method??'GET',body:init.body});
  const outcome=await api.runSeoWorkspaceDraft(state,{signal:new AbortController().signal,fetcher,onState:()=>{}});assert.equal(outcome.job.status,'completed');
  const retained=()=>JSON.stringify(['products','product_content','product_options','translation_jobs','collection_context','collection_results','collection_products','collection_images'].map(table=>h.sqlite.prepare('SELECT * FROM '+table).all()));
  return {h,base,content,currentOptions,job:outcome.job,body:{jobId:outcome.job.id,expectedVersion:version,seoComposition:composition},queries,retained};
 }catch(error){h.close();throw error;}
}

for(const company of companies)test(`current brand, feature and targets compose the reviewed title and quotation tags (${company.code})`,async()=>{
 const f=await fixture(company);try{
  const before=f.retained(),job=JSON.stringify(f.job),objects=JSON.stringify([...f.h.objects].map(([key,value])=>[key,[...value]]));
  const preview=await json(await f.h.route(f.base+'/translation-apply',{method:'POST',body:{...f.body,action:'preview'}}));assert.equal(f.retained(),before,'preview saves nothing');
  assert.ok(preview.preview.some(row=>row.name==='상품명 · 사용자 구성안'&&row.after===composition.title));
  assert.ok(preview.preview.some(row=>row.name==='검색어 · 사용자 구성안'&&row.after.startsWith('휴대용 안경, 선글라스')));
  await json(await f.h.route(f.base+'/translation-apply',{method:'POST',body:{...f.body,action:'apply',fingerprint:preview.fingerprint}}));
  const saved=(await json(await f.h.route(f.base+'/content'))).content,options=(await json(await f.h.route(f.base+'/options'))).options;
  assert.equal(saved.seo.title.value,composition.title);assert.equal(saved.seo.title.provenance,'manual');assert.deepEqual(saved.seo.keywords.value.slice(0,2),['휴대용 안경','선글라스']);
  assert.deepEqual(saved.label,f.content.label,'guidance does not invent labels, origin, certification or source facts');assert.equal(saved.intakeKeywordSeed,undefined);
  const quotation=await json(await f.h.route(f.base+'/quotation-fields'));for(const row of quotation.resolved.rows.filter(row=>row.included)){assert.equal(row.fields.title.value,composition.title);assert.equal(row.fields.searchTags.value,saved.seo.keywords.value.join(', '));}
  assert.equal(options.rows[0].translatedName,'직접 검토한 옵션');for(const row of options.rows){const original=f.currentOptions.rows.find(item=>item.id===row.id);for(const key of ['originalName','supplierSku','included','unitCostCny','unitsPerPack','imageKey'])assert.deepEqual(row[key],original[key]);}
  assert.equal(JSON.stringify(await f.h.load('db/translation-jobs.ts').getTranslationJob('owner',f.job.productId,f.job.id)),job,'provider history/result never rewritten');assert.equal(JSON.stringify([...f.h.objects].map(([key,value])=>[key,[...value]])),objects);
  assert.equal(f.h.aiSources.length,0);assert.ok(f.queries.every(q=>!q.includes(memo.brand)&&!q.includes(memo.features)&&!q.includes('휴대용 안경')));
 }finally{f.h.close();}
});

for(const company of companies){
 test(`completed intake SEO remains protected until title/tags replacement is explicitly reviewed (${company.code})`,async()=>{
  const f=await fixture(company,{automatic:true,linkedName:true});try{
   assert.equal(f.content.seo.title.provenance,'manual');assert.equal(f.content.seo.keywords.provenance,'manual');assert.equal(f.content.labelProductNameLinked,true);
   const preserved=await json(await f.h.route(f.base+'/translation-apply',{method:'POST',body:{...f.body,action:'preview'}}));
   assert.ok(!preserved.preview.some(row=>row.name.startsWith('상품명')));assert.ok(!preserved.preview.some(row=>row.name.startsWith('검색어')));
   const body={...f.body,seoComposition:{...composition,replaceTitle:true,replaceKeywords:true}},before=f.retained();
   const preview=await json(await f.h.route(f.base+'/translation-apply',{method:'POST',body:{...body,action:'preview'}}));assert.equal(f.retained(),before);
   assert.ok(preview.preview.some(row=>row.name==='상품명 · 사용자 구성안'&&row.before===f.content.seo.title.value&&row.after===composition.title));
   assert.ok(preview.preview.some(row=>row.name==='품명 · SEO 상품명 연동'&&row.after===composition.title));
   await json(await f.h.route(f.base+'/translation-apply',{method:'POST',body:{...body,action:'apply',fingerprint:preview.fingerprint}}));
   const saved=(await json(await f.h.route(f.base+'/content'))).content;assert.equal(saved.seo.title.value,composition.title);assert.equal(saved.label.productName.value,composition.title);assert.equal(saved.labelProductNameLinked,true);
   for(const key of Object.keys(f.content.label).filter(key=>key!=='productName'))assert.deepEqual(saved.label[key],f.content.label[key]);
   assert.deepEqual(saved.seo.keywords.value.slice(0,2),['휴대용 안경','선글라스']);assert.equal(f.h.aiSources.length,1,'only the initial fixture provider was used, composition invokes no provider');
  }finally{f.h.close();}
 });
 test(`direct saved title, same-value tags and explicit blank remain protected without replacement flags (${company.code})`,async()=>{
  const f=await fixture(company,{manualSeo:{title:'',keywords:[]}});try{
   const preview=await json(await f.h.route(f.base+'/translation-apply',{method:'POST',body:{...f.body,action:'preview'}}));
   assert.ok(!preview.preview.some(row=>row.name.startsWith('상품명')||row.name.startsWith('검색어')));
   await json(await f.h.route(f.base+'/translation-apply',{method:'POST',body:{...f.body,action:'apply',fingerprint:preview.fingerprint}}));
   const saved=(await json(await f.h.route(f.base+'/content'))).content;assert.deepEqual(saved.seo.title,f.content.seo.title);assert.deepEqual(saved.seo.keywords,f.content.seo.keywords);assert.deepEqual(saved.label,f.content.label);
  }finally{f.h.close();}
 });
 test(`changing any reviewed guidance, exact whitespace or replace flag invalidates the preview without writes (${company.code})`,async()=>{
  const f=await fixture(company);try{
   const preview=await json(await f.h.route(f.base+'/translation-apply',{method:'POST',body:{...f.body,action:'preview'}})),before=f.retained();
   for(const changed of [{brand:'다른 브랜드'},{features:'다른 특징'},{keywords:'다른 타겟'},{title:composition.title+' '},{replaceTitle:true},{replaceKeywords:false}]){
    const response=await f.h.route(f.base+'/translation-apply',{method:'POST',body:{...f.body,seoComposition:{...composition,...changed},action:'apply',fingerprint:preview.fingerprint}});await json(response,409);assert.equal(f.retained(),before);
   }
  }finally{f.h.close();}
 });
 test(`long Korean feature notes accept a short reviewed title while invalid SEO can still use translation only (${company.code})`,async()=>{
  const f=await fixture(company);try{
   const raw={...composition,features:'사양'.repeat(1000),title:'현재 브랜드 직접 선택한 짧은 특징 휴대용 안경'};assert.ok(new TextEncoder().encode(JSON.stringify(raw)).length>4096);
   const before=f.retained(),preview=await json(await f.h.route(f.base+'/translation-apply',{method:'POST',body:{...f.body,seoComposition:raw,action:'preview'}}));assert.equal(f.retained(),before);
   for(const invalid of [{title:'가'.repeat(101)},{title:''},{keywords:'가'.repeat(21)},{keywords:Array.from({length:15},(_,i)=>'검색어'+i+'열글자테스트').join(', ')},{replaceTitle:'true'}]){
    await json(await f.h.route(f.base+'/translation-apply',{method:'POST',body:{...f.body,seoComposition:{...raw,...invalid},action:'preview'}}),400);assert.equal(f.retained(),before);
   }
   await json(await f.h.route(f.base+'/translation-apply',{method:'POST',body:{...f.body,scope:'options',action:'preview'}}),400);
   const ordinary=await json(await f.h.route(f.base+'/translation-apply',{method:'POST',body:{jobId:f.job.id,expectedVersion:f.body.expectedVersion,action:'preview'}}));assert.ok(ordinary.preview.some(row=>row.name==='상품명'));
   await json(await f.h.route(f.base+'/translation-apply',{method:'POST',body:{...f.body,seoComposition:raw,action:'apply',fingerprint:preview.fingerprint}}));assert.equal((await json(await f.h.route(f.base+'/content'))).content.seo.title.value,raw.title);
  }finally{f.h.close();}
 });
 test(`composition checks captured company even when a manual job omits category metadata (${company.code})`,async()=>{
  for(const category of [true,false]){
   const f=await fixture(company);try{
    if(!category){const review=plain(f.job.review);delete review.source.category;f.h.sqlite.prepare('UPDATE translation_jobs SET review=? WHERE id=?').run(JSON.stringify(review),f.job.id);}
    const preview=await json(await f.h.route(f.base+'/translation-apply',{method:'POST',body:{...f.body,action:'preview'}}));
    f.h.setCompany(companies.find(value=>value.code!==company.code));const before=f.retained();
    for(const action of ['preview','apply']){await json(await f.h.route(f.base+'/translation-apply',{method:'POST',body:{...f.body,action,...(action==='apply'?{fingerprint:preview.fingerprint}:{})}}),409);assert.equal(f.retained(),before);}
   }finally{f.h.close();}
  }
 });
 test(`a legacy manually entered product without a captured collection still supports explicit SEO composition (${company.code})`,async()=>{
  const f=await fixture(company);try{
   f.h.sqlite.prepare('DELETE FROM collection_products').run();const before=f.retained();
   const preview=await json(await f.h.route(f.base+'/translation-apply',{method:'POST',body:{...f.body,action:'preview'}}));assert.equal(f.retained(),before);
   await json(await f.h.route(f.base+'/translation-apply',{method:'POST',body:{...f.body,action:'apply',fingerprint:preview.fingerprint}}));assert.equal((await json(await f.h.route(f.base+'/content'))).content.seo.title.value,composition.title);
  }finally{f.h.close();}
 });
}
