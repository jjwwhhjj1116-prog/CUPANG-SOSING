import test from 'node:test';
import assert from 'node:assert/strict';
import {mobileIntakeHarness} from './helpers/mobile-intake.mjs';

const savedContent=h=>JSON.parse(h.sqlite.prepare('SELECT payload FROM product_content').get().payload);
const savedOptions=h=>JSON.parse(h.sqlite.prepare('SELECT payload FROM product_options').get().payload);
const product=h=>h.sqlite.prepare('SELECT * FROM products').get();
const json=async response=>{assert.ok(response.ok,await response.clone().text());return response.json();};
const patch=async(h,changes)=>json(await h.route('/api/products/'+product(h).id+'/content',{method:'PATCH',body:{expectedRevision:savedContent(h).revision,patch:changes}}));
const fetcher=h=>(path,init)=>h.route(path,{method:init?.method??'GET',body:init?.body});
const intake=async(h,fetch=fetcher(h))=>h.load('app/intake-collection.ts').collectIntakeProduct(await h.load('db/collection-jobs.ts').findCollectionJob('owner','job'),{
 signal:new AbortController().signal,fetcher:fetch,onJob:()=>{},onProgress:()=>{},
});

for(const company of [{companyCode:'A01464742',companyName:'와이홉'},{companyCode:'A01526306',companyName:'유앤채'}])test(`initial completed intake fills untouched source after a concurrent label edit (${company.companyCode})`,async()=>{
 const h=mobileIntakeHarness(company);
 try{
  const original=h.bindings.AI.run;let edited=false;
  h.bindings.AI.run=async(...args)=>{const answer=await original(...args);if(!edited){edited=true;await patch(h,{label:{material:'직접 확인한 재질'}});}return answer;};
  const context=h.sqlite.prepare('SELECT payload FROM collection_context').get().payload;
  await assert.rejects(intake(h),/상품이 변경/);
  assert.equal(savedContent(h).seo.title.provenance,'collected');assert.equal(h.aiSources.length,1);
  const initial=h.sqlite.prepare('SELECT * FROM translation_jobs').get();assert.equal(initial.status,'completed');
  assert.match(await intake(h),/SEO·옵션 초안을 생성해 반영/);
  assert.equal(h.aiSources.length,1,'reuse the completed initial result without another model request');
  assert.equal(h.sqlite.prepare('SELECT count(*) n FROM translation_jobs').get().n,1);
  const content=savedContent(h),options=savedOptions(h);
  assert.equal(content.seo.title.value,'검토 브랜드 우드 패턴 다리 선글라스');assert.equal(content.seo.description.value,'상품 원문에 따른 검토용 설명');
  assert.equal(content.label.material.value,'직접 확인한 재질');assert.equal(content.label.material.provenance,'manual');
  assert.equal(content.label.productName.value,content.seo.title.value);assert.equal(content.categoryAttributes.jobId,initial.id);
  assert.ok(options.rows.every(row=>row.translatedName&&row.provenance.translatedName==='translated'));
  const quotation=await json(await h.route('/api/products/'+product(h).id+'/quotation-fields'));
  assert.ok(quotation.resolved.rows.every(row=>row.fields.title.value===content.seo.title.value));
  assert.equal(h.sqlite.prepare('SELECT payload FROM collection_context').get().payload,context);
  assert.equal(h.sqlite.prepare('SELECT * FROM translation_jobs').get().result,initial.result);
  const before=JSON.stringify({content,options});await intake(h);
  assert.equal(JSON.stringify({content:savedContent(h),options:savedOptions(h)}),before);assert.equal(h.aiSources.length,1);
  assert.equal(product(h).supplier_hub_status,'미전송');
 }finally{h.close();}
});

test('initial replay preserves explicitly confirmed same-value SEO and blanks plus later option edits',async()=>{
 for(const title of ['','same-source']){
  const h=mobileIntakeHarness();
  try{
   const original=h.bindings.AI.run;let edited=false;let expectedTitle;
   h.bindings.AI.run=async(...args)=>{const answer=await original(...args);if(!edited){
    edited=true;expectedTitle=title==='same-source'?savedContent(h).seo.title.value:title;
    await patch(h,{seo:{title:expectedTitle,description:'',keywords:[]},label:{material:'직접 검토한 재질'}});
    const view=await json(await h.route('/api/products/'+product(h).id+'/options'));
    const rows=h.load('app/product-options.ts').optionInputs(view.options);
    rows[0].translatedName='직접 선택한 옵션';rows[0].color='';rows[1].included=false;
    await json(await h.route('/api/products/'+product(h).id+'/options',{method:'PATCH',body:{expectedRevision:view.options.revision,expectedProductVersion:view.productVersion,rows}}));
   }return answer;};
   await assert.rejects(intake(h),/상품이 변경/);
   assert.equal(savedContent(h).seo.description.provenance,'manual','an explicitly saved initial blank is protected');
   await intake(h);assert.equal(h.aiSources.length,1);
   const content=savedContent(h),options=savedOptions(h);
   assert.equal(content.seo.title.value,expectedTitle);assert.equal(content.seo.title.provenance,'manual');assert.equal(content.seo.description.value,'');
   assert.deepEqual(content.seo.keywords.value,[]);assert.equal(content.label.material.value,'직접 검토한 재질');
   assert.equal(options.rows[0].translatedName,'직접 선택한 옵션');assert.equal(options.rows[0].color,'');assert.equal(options.rows[1].included,false);assert.equal(options.rows[1].translatedName,'');
   assert.ok(options.rows.slice(2).every(row=>row.translatedName));
  }finally{h.close();}
 }
});

test('an explicit empty SEO keyword save with no intake guidance remains empty on initial replay',async()=>{
 const h=mobileIntakeHarness();
 try{
  h.context.keywords='';h.sqlite.prepare('UPDATE collection_context SET payload=? WHERE job_id=?').run(JSON.stringify(h.context),'job');
  const original=h.bindings.AI.run;let edited=false;
  h.bindings.AI.run=async(...args)=>{const answer=await original(...args);if(!edited){
   edited=true;assert.deepEqual(savedContent(h).seo.keywords.value,[]);assert.equal(savedContent(h).seo.keywords.provenance,'unverified');
   await patch(h,{seo:{keywords:[]}});
  }return answer;};
  await assert.rejects(intake(h),/상품이 변경/);
  assert.equal(savedContent(h).intakeKeywordSeed,undefined);
  await intake(h);assert.equal(h.aiSources.length,1);
  assert.deepEqual(savedContent(h).seo.keywords.value,[]);assert.equal(savedContent(h).seo.keywords.provenance,'manual');
  assert.equal(savedContent(h).seo.title.value,'검토 브랜드 우드 패턴 다리 선글라스');
 }finally{h.close();}
});

test('initial replay never replaces a newer completed category snapshot or its reviewed content',async()=>{
 const h=mobileIntakeHarness();
 try{
  const original=h.bindings.AI.run;let newer;let reviewed;
  h.bindings.AI.run=async(...args)=>{
   const answer=await original(...args);
   if(h.aiSources.length===1){
    await patch(h,{label:{material:'최신 검토 재질'}});
    const base='/api/products/'+product(h).id+'/translation';
    const post=body=>h.route(base,{method:'POST',body});
    newer=(await json(await post({action:'prepare',source:JSON.parse(args[1].messages[1].content),expectedVersion:product(h).updated_at,idempotencyKey:'newer-reviewed-result'}))).job;
    await json(await post({action:'approve',jobId:newer.id,reviewFingerprint:newer.review.fingerprint,confirmPaid:true}));
    await json(await post({action:'execute',jobId:newer.id}));
    const body={jobId:newer.id,expectedVersion:product(h).updated_at};
    const preview=await json(await h.route('/api/products/'+product(h).id+'/translation-apply',{method:'POST',body:{...body,action:'preview'}}));
    await json(await h.route('/api/products/'+product(h).id+'/translation-apply',{method:'POST',body:{...body,action:'apply',fingerprint:preview.fingerprint}}));
    reviewed=savedContent(h).categoryAttributes;
   }
   return answer;
  };
  await assert.rejects(intake(h),/상품이 변경/);assert.equal(savedContent(h).categoryAttributes.jobId,newer.id);
  assert.deepEqual(savedContent(h).categoryAttributes,reviewed);
  const before=JSON.stringify({content:savedContent(h),options:savedOptions(h)});
  await intake(h);
  assert.equal(JSON.stringify({content:savedContent(h),options:savedOptions(h)}),before);
  assert.equal(h.aiSources.length,2,'only the initial request and explicit newer review executed');
 }finally{h.close();}
});

test('lost execute acknowledgement recovers the persisted result while an uncertain provider outcome stays stopped',async()=>{
 for(const mode of ['saved-response-lost','provider-uncertain']){
  const h=mobileIntakeHarness();
  try{
   let calls=0;const original=h.bindings.AI.run;
   h.bindings.AI.run=async(...args)=>{calls++;if(mode==='provider-uncertain')throw Error('fixture outcome unknown');return original(...args);};
   let lost=false;
   const fetch=async(path,init)=>{const response=await fetcher(h)(path,init);if(mode==='saved-response-lost'&&!lost&&path.endsWith('/translation')&&JSON.parse(init.body).action==='execute'){
    lost=true;assert.equal((await response.clone().json()).job.status,'completed');throw Error('fixture execute acknowledgement lost');
   }return response;};
   await assert.rejects(intake(h,fetch));await patch(h,{label:{material:'응답 확인 중 검토한 재질'}});
   if(mode==='saved-response-lost'){
    await intake(h);assert.equal(savedContent(h).seo.title.value,'검토 브랜드 우드 패턴 다리 선글라스');
   }else{
    await assert.rejects(intake(h));assert.equal(savedContent(h).seo.title.provenance,'collected');assert.equal(h.sqlite.prepare('SELECT status FROM translation_jobs').get().status,'uncertain');
   }
   assert.equal(calls,1);assert.equal(savedContent(h).label.material.value,'응답 확인 중 검토한 재질');
  }finally{h.close();}
 }
});

test('replayed initial preview remains bound to the current revision and exact intake URL',async()=>{
 for(const change of ['content','source-url']){
  const h=mobileIntakeHarness();
  try{
   const original=h.bindings.AI.run;let edited=false;
   h.bindings.AI.run=async(...args)=>{const result=await original(...args);if(!edited){edited=true;await patch(h,{label:{material:'첫 수정'}});}return result;};
   await assert.rejects(intake(h));
   const initial=h.sqlite.prepare('SELECT id FROM translation_jobs').get();
   const body={jobId:initial.id,expectedVersion:product(h).updated_at};
   const preview=await json(await h.route('/api/products/'+product(h).id+'/translation-apply',{method:'POST',body:{...body,action:'preview'}}));
   if(change==='content')await patch(h,{seo:{title:'검토 후 다시 수정한 상품명'}});
   else h.sqlite.prepare('UPDATE products SET source_url=?').run('https://detail.1688.com/offer/813724060929.html');
   const before=JSON.stringify({content:savedContent(h),options:savedOptions(h)});
   const response=await h.route('/api/products/'+product(h).id+'/translation-apply',{method:'POST',body:{...body,action:'apply',fingerprint:preview.fingerprint}});
   assert.equal(response.status,409);assert.equal(JSON.stringify({content:savedContent(h),options:savedOptions(h)}),before);assert.equal(h.aiSources.length,1);
  }finally{h.close();}
 }
});
