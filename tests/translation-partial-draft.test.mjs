import test from 'node:test';
import assert from 'node:assert/strict';
import {mobileIntakeHarness} from './helpers/mobile-intake.mjs';
const json=async response=>{assert.ok(response.ok,await response.clone().text());return response.json();};
const product=h=>h.sqlite.prepare('SELECT * FROM products').get();
const content=h=>JSON.parse(h.sqlite.prepare('SELECT payload FROM product_content').get().payload);
const options=h=>JSON.parse(h.sqlite.prepare('SELECT payload FROM product_options').get().payload);

for(const company of [{companyCode:'A01464742',companyName:'와이홉'},{companyCode:'A01526306',companyName:'유앤채'}])test(`Chinese SEO passthrough cannot complete or apply even with all 42 source attributes (${company.companyCode})`,async()=>{
 const h=mobileIntakeHarness(company);try{
  h.sqlite.exec("UPDATE collection_jobs SET goal='collect'");await h.intake();const beforeProduct=product(h),beforeContent=content(h),beforeOptions=options(h),receipt=h.sqlite.prepare('SELECT payload FROM collection_results').get().payload,base='/api/products/'+beforeProduct.id;
  const request=body=>h.route(base+'/translation',{method:'POST',body}),prepared=await json(await request({action:'prepare-collected',intake:true}));let calls=0;
  h.bindings.AI.run=async(_model,input)=>{
   calls++;const source=JSON.parse(input.messages[1].content);assert.equal(source.attributes.length,42);assert.equal(input.messages[0].role,'system');assert.equal(input.messages[0].content,h.load('app/automation/translation.ts').buildTranslationRequest(prepared.job.review).instructions);
   return {response:{title:'太阳眼镜木纹腿男女复古墨镜高级感潮遮阳防紫外线太阳镜复古墨镜',keywords:['太阳镜','木纹腿','男女复古','墨镜','高级感','潮遮阳','防紫外线'],description:'',warnings:['category path may not match product facts','certification text is an unverified seller claim'],attributes:source.attributes.map(({sourceIndex,name,value})=>({sourceIndex,name,value}))}};
  };
  await json(await request({action:'approve',jobId:prepared.job.id,reviewFingerprint:prepared.job.review.fingerprint,confirmPaid:true}));
  const {job}=await json(await request({action:'execute',jobId:prepared.job.id}));assert.equal(job.status,'failed');assert.equal(job.error.code,'UNTRANSLATED_SEO');assert.equal(job.error.mayHaveBeenCharged,true);assert.equal(job.result,null);
  const replay=await json(await request({action:'execute',jobId:job.id}));assert.equal(replay.job.status,'failed');assert.equal(calls,1);
  assert.equal((await h.route(base+'/translation-apply',{method:'POST',body:{action:'preview',jobId:job.id,expectedVersion:product(h).updated_at}})).status,409);
  assert.deepEqual(product(h),beforeProduct);assert.deepEqual(content(h),beforeContent);assert.deepEqual(options(h),beforeOptions);assert.equal(h.sqlite.prepare('SELECT payload FROM collection_results').get().payload,receipt);
 }finally{h.close();}
});

for(const company of [{companyCode:'A01464742',companyName:'와이홉'},{companyCode:'A01526306',companyName:'유앤채'}])test(`valid partial 42-attribute response remains a reviewable SEO draft and preserves omitted originals/manual blanks (${company.companyCode})`,async()=>{
 const h=mobileIntakeHarness(company);try{
  h.sqlite.exec("UPDATE collection_jobs SET goal='collect'");await h.intake();const id=product(h).id,base='/api/products/'+id,receipt=h.sqlite.prepare('SELECT payload FROM collection_results').get().payload,originalOptions=options(h),policy=product(h).pricing_policy;
  const request=body=>h.route(base+'/translation',{method:'POST',body});
  const prepared=await json(await request({action:'prepare-collected',intake:true}));assert.equal(prepared.job.review.source.attributes.length,42);
  const original=h.bindings.AI.run;let calls=0,returnedIndices;
  h.bindings.AI.run=async(...args)=>{
   calls++;const response=await original(...args),source=JSON.parse(args[1].messages[1].content),optionIndex=source.attributes.findIndex(pair=>pair.name==='option:'+originalOptions.rows[2].id);
   returnedIndices=[0,optionIndex];response.response.attributes=response.response.attributes.filter(item=>returnedIndices.includes(item.sourceIndex));
   await json(await h.route(base+'/content',{method:'PATCH',body:{expectedRevision:content(h).revision,patch:{seo:{description:'',keywords:[]},label:{material:'직접 확인한 재질'}}}}));
   const current=await json(await h.route(base+'/options')),rows=h.load('app/product-options.ts').optionInputs(current.options);rows[0].translatedName='';rows[0].color='';rows[1].included=false;
   await json(await h.route(base+'/options',{method:'PATCH',body:{expectedRevision:current.options.revision,expectedProductVersion:current.productVersion,rows}}));
   return response;
  };
  await json(await request({action:'approve',jobId:prepared.job.id,reviewFingerprint:prepared.job.review.fingerprint,confirmPaid:true}));
  const {job}=await json(await request({action:'execute',jobId:prepared.job.id}));assert.equal(job.status,'completed');assert.equal(job.review.instructionsVersion,'sourceflow-translation-v6');assert.equal(job.result.draft.attributes.length,2);assert.deepEqual(job.result.draft.attributes.map(item=>item.sourceIndex),returnedIndices);assert.match(job.result.draft.warnings[0],/42개 중 2개/);assert.match(job.result.draft.warnings[0],/40개.*원문/);
  const beforeRead=JSON.stringify(job.review.source),saved=h.sqlite.prepare('SELECT * FROM translation_jobs').get();assert.equal((await json(await request({action:'execute',jobId:job.id}))).replayed,true);assert.equal(calls,1);
  const apply=body=>h.route(base+'/translation-apply',{method:'POST',body:{jobId:job.id,expectedVersion:product(h).updated_at,...body}}),preview=await json(await apply({action:'preview'}));await json(await apply({action:'apply',fingerprint:preview.fingerprint}));
  const next=content(h),nextOptions=options(h);assert.equal(next.seo.title.value,'검토 브랜드 우드 패턴 다리 선글라스');assert.equal(next.seo.description.value,'');assert.equal(next.seo.description.provenance,'manual');assert.deepEqual(next.seo.keywords.value,[]);assert.equal(next.label.material.value,'직접 확인한 재질');
  assert.equal(nextOptions.rows[0].translatedName,'');assert.equal(nextOptions.rows[0].color,'');assert.equal(nextOptions.rows[0].provenance.color,'manual');assert.equal(nextOptions.rows[1].included,false);assert.equal(nextOptions.rows[2].provenance.translatedName,'translated');
  for(const row of nextOptions.rows.slice(3)){assert.equal(row.translatedName,'');assert.notEqual(row.provenance.translatedName,'translated');}
  for(const [i,row]of nextOptions.rows.entries()){assert.equal(row.id,originalOptions.rows[i].id);assert.equal(row.unitCostCny,originalOptions.rows[i].unitCostCny);}
  const quote=await json(await h.route(base+'/quotation-fields'));
  assert.deepEqual(next.seoTitleDocument,{policy:'couplus-seo-save-v1',sourceTitle:'검토 브랜드 우드 패턴 다리 선글라스',sourceUpdatedAt:next.seo.title.updatedAt,value:'검토 브랜드 우드 패턴 다리 선글라스'});
  assert.equal(nextOptions.rows[2].translatedName,'무광 검정 / 선글라스','a translated option remains distinct from the saved common document title');
  for(const row of quote.resolved.rows){assert.equal(row.fields.title.value,'검토 브랜드 우드 패턴 다리 선글라스');assert.equal(row.fields.title.source,'content');}
  assert.equal(quote.resolved.rows.find(row=>row.optionId===nextOptions.rows[1].id).included,false,'title policy never re-includes an excluded option');
  assert.equal(h.sqlite.prepare('SELECT payload FROM collection_results').get().payload,receipt);assert.equal(product(h).pricing_policy,policy);assert.equal(JSON.stringify(job.review.source),beforeRead);assert.deepEqual(h.sqlite.prepare('SELECT * FROM translation_jobs').get(),saved);
  const unchanged=()=>{const {updated_at:version,...facts}=product(h);assert.ok(Number.isFinite(Date.parse(version)));return JSON.stringify({product:facts,content:content(h),options:options(h),receipt:h.sqlite.prepare('SELECT payload FROM collection_results').get().payload,context:h.sqlite.prepare('SELECT * FROM collection_context').all(),settings:h.sqlite.prepare('SELECT * FROM workspace_settings').all(),jobs:h.sqlite.prepare('SELECT * FROM translation_jobs').all(),images:[...h.objects].map(([key,bytes])=>[key,Array.from(bytes)])});},beforeOverrides=unchanged(),beforeVersion=product(h).updated_at;
  const put=async(view,changes)=>json(await h.route(base+'/quotation-fields',{method:'PUT',body:{expectedRevision:view.revision,expectedInputFingerprint:view.inputFingerprint,changes}}));
  const manual=await put(quote,[{fieldKey:'title',optionId:null,value:'견적 공통 직접 검토'},{fieldKey:'title',optionId:nextOptions.rows[0].id,value:'견적 옵션 직접 검토'},{fieldKey:'title',optionId:nextOptions.rows[2].id,value:''}]);
  const manualVersion=product(h).updated_at;assert.ok(Date.parse(manualVersion)>Date.parse(beforeVersion),'quotation save advances the existing product CAS clock');assert.equal(manual.revision,quote.revision+1);assert.notEqual(manual.inputFingerprint,quote.inputFingerprint);
  for(const row of manual.resolved.rows){const specific=row.optionId===nextOptions.rows[0].id,blank=row.optionId===nextOptions.rows[2].id;assert.equal(row.fields.title.value,specific?'견적 옵션 직접 검토':blank?'':'견적 공통 직접 검토');assert.equal(row.fields.title.source,specific||blank?'manual-option':'manual-common');assert.equal(row.fields.title.validationIssues.length>0,blank,'explicit blank retains the existing required-title error');const old=quote.resolved.rows.find(previous=>previous.optionId===row.optionId);assert.equal(row.included,old.included);for(const field of Object.keys(row.fields).filter(field=>field!=='title'))assert.deepEqual(row.fields[field],old.fields[field]);}
  assert.equal(unchanged(),beforeOverrides,'quotation title edits cannot alter source, SEO, label, options, pricing, images or translation history');
  const restored=await put(manual,[{fieldKey:'title',optionId:null,value:null},{fieldKey:'title',optionId:nextOptions.rows[0].id,value:null},{fieldKey:'title',optionId:nextOptions.rows[2].id,value:null}]);
  assert.deepEqual(restored.overrides,quote.overrides);assert.deepEqual(restored.resolved.rows,quote.resolved.rows);assert.ok(Date.parse(product(h).updated_at)>Date.parse(manualVersion));assert.equal(restored.revision,manual.revision+1);assert.equal(unchanged(),beforeOverrides);assert.equal(calls,1);
 }finally{h.close();}
});
