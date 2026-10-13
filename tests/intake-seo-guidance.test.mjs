import test from 'node:test';
import assert from 'node:assert/strict';
import {mobileIntakeHarness} from './helpers/mobile-intake.mjs';
import {schemaCompanies,hubSchemaSnapshot,schemaPath} from './helpers/hub-schema.mjs';
const json=async(response,status=200)=>{assert.equal(response.status,status,await response.clone().text());return response.json();};
let sequence=0;
async function fixture(company,{features='쌓을 수 있는',keywords='주방 정리함, 서랍 정리함',sourceTitle='抽屉收纳盒',translatedTitle='서랍 수납함',goal='work'}={}){
 const offerId=String(629010000001+sequence++),sourceUrl=`https://detail.1688.com/offer/${offerId}.html`,queries=[],sourceRequests=[];
 const dictionary=new Map([[sourceTitle,translatedTitle],['厨房抽屉可叠放收纳盒','주방 서랍용 쌓을 수 있는 수납함'],['白色','흰색'],['材质','재질'],['塑料','플라스틱']]);
 const source={'@context':'https://schema.org','@type':'Product',url:sourceUrl,name:sourceTitle,description:'厨房抽屉可叠放收纳盒',additionalProperty:[{'@type':'PropertyValue',name:'材质',value:'塑料'}],hasVariant:[{'@type':'Product',sku:offerId+'01',name:'白色',offers:{'@type':'Offer',price:'5.5',priceCurrency:'CNY',eligibleQuantity:{'@type':'QuantitativeValue',minValue:2}}}]};
 const h=mobileIntakeHarness({companyCode:company.code,companyName:company.name,sourceFetcher:async target=>{
  assert.equal(String(target),sourceUrl,'arbitrary new offer must fetch its own source, never a fixed cached offer');sourceRequests.push(String(target));return new Response('<script type="application/ld+json">'+JSON.stringify(source)+'</script>',{headers:{'content-type':'text/html;charset=utf-8'}});
 },translationFetcher:async target=>{
  const q=new URL(target).searchParams.get('q');queries.push(q);const translate=value=>{assert.ok(dictionary.has(value),'unexpected supplier text '+value);return dictionary.get(value);};
  const value=q.startsWith('[[YFTR')?q.split('\n').map(line=>{const m=/^(\[\[YFTR\d{6}\]\]) (.+)$/u.exec(line);assert.ok(m);return m[1]+' '+translate(m[2]);}).join('\n'):translate(q);
  return Response.json([[[value,q]],null,'zh-CN']);
 }});
 try{
  h.bindings.SOURCEFLOW_TEXT_PROVIDER='google-free';delete h.bindings.AI;
  const untouched=JSON.stringify(h.sqlite.prepare('SELECT * FROM collection_jobs WHERE id=?').get('job'));
  const settings={...h.settings,brand:company.name+' 브랜드'};await h.load('db/queries.ts').saveSettings('owner',JSON.stringify(settings));
  const profile=await h.load('db/category-profiles.ts').createCategoryProfile('owner',{name:'새 합성 수납함 카테고리',categoryId:'991234',categoryPath:schemaPath,hubSchema:hubSchemaSnapshot(company),template:null,mappings:[]});
  const queued=await json(await h.load('app/api/collection-jobs/route.ts').POST(new Request('https://app.test/api/collection-jobs',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({urls:[sourceUrl],goal,profileId:profile.id,expectedProfileRevision:profile.revision,features,keywords})})));
  const job=queued.jobs[0];assert.equal(job.offer_id,offerId);assert.equal(job.context.features,features);assert.equal(job.context.keywords,keywords);
  const receipt=await json(await h.route(`/api/collection-jobs/${job.id}/collect`,{method:'POST'}));assert.equal(receipt.receipt.result.provider,'public-product-jsonld-v1');assert.equal(receipt.receipt.result.sourceUrl,sourceUrl);
  const original=h.sqlite.prepare('SELECT * FROM collection_results WHERE job_id=?').get(job.id),context=h.sqlite.prepare('SELECT * FROM collection_context WHERE job_id=?').get(job.id);
  // Later settings are unrelated to this explicitly submitted intake request.
  await h.load('db/queries.ts').saveSettings('owner',JSON.stringify({...settings,brand:'나중 변경 브랜드',exchangeRate:999}));
  const state=()=>JSON.stringify(['products','product_content','product_options','translation_jobs','collection_context','collection_results','collection_images'].map(table=>h.sqlite.prepare('SELECT * FROM '+table).all()));
  const result={h,offerId,sourceUrl,job,profile,settings,features,keywords,queries,sourceRequests,original,context,untouched,state,
   fetcher:(path,init={})=>h.route(path,{method:init.method??'GET',body:init.body}),
   product:()=>h.sqlite.prepare('SELECT * FROM products WHERE source_url=?').get(sourceUrl),
   async content(){return (await json(await h.route('/api/products/'+this.product().id+'/content'))).content;},
   async options(){return (await json(await h.route('/api/products/'+this.product().id+'/options'))).options;},
   canonical(){return h.sqlite.prepare('SELECT * FROM translation_jobs WHERE product_id=? ORDER BY created_at').get(this.product().id);},
   async intake(){return h.intake(job.id);},close(){h.close();}};
  return result;
 }catch(error){h.close();throw error;}
}

for(const company of schemaCompanies)test(`initial arbitrary URL intake uses captured short feature and targets in title, tags and quotation (${company.code})`,async()=>{
 const f=await fixture(company);try{
  const message=await f.intake(),product=f.product(),content=await f.content(),options=await f.options(),job=f.canonical(),review=JSON.parse(job.review),result=JSON.parse(job.result);
  const title=company.name+' 브랜드 쌓을 수 있는 서랍 수납함 주방 정리함 서랍 정리함';
  assert.equal(content.seo.title.value,title);assert.deepEqual(content.seo.keywords.value,['주방 정리함','서랍 정리함','서랍','수납함']);assert.equal(content.label.productName.value,title);assert.equal(content.labelProductNameLinked,true);
  assert.doesNotMatch(message,/검토 필요/);assert.match(message,/SEO·옵션 초안/);
  assert.equal(product.title,'抽屉收纳盒');assert.equal(product.source_url,f.sourceUrl);assert.equal(product.source_price_cny,5.5);assert.equal(product.exchange_rate,350);assert.equal(product.supplier_hub_status,'미전송');
  assert.equal(options.rows.length,1);assert.equal(options.rows[0].supplierSku,f.offerId+'01');assert.equal(options.rows[0].unitCostCny,5.5);assert.equal(options.rows[0].minimumOrderQuantity,2);assert.equal(options.rows[0].stock,null);assert.equal(options.rows[0].translatedName,'흰색');
  assert.equal(content.seo.description.value,'주방 서랍용 쌓을 수 있는 수납함');assert.equal(content.label.material.value,'플라스틱');
  assert.equal(result.draft.title,'서랍 수납함');assert.deepEqual(result.draft.keywords,['서랍','수납함']);assert.deepEqual(review.source.guidance,{features:f.features,keywords:f.keywords});
  assert.ok(f.queries.every(q=>!q.includes(f.features)&&!q.includes('주방 정리함')&&!q.includes(f.settings.brand)),'owner SEO input must not become supplier facts or provider input');assert.equal(f.queries.length,2);assert.deepEqual(f.sourceRequests,[f.sourceUrl]);assert.equal(f.h.aiSources.length,0);
  assert.deepEqual(f.h.sqlite.prepare('SELECT * FROM collection_results WHERE job_id=?').get(f.job.id),f.original);assert.deepEqual(f.h.sqlite.prepare('SELECT * FROM collection_context WHERE job_id=?').get(f.job.id),f.context);assert.equal(JSON.stringify(f.h.sqlite.prepare('SELECT * FROM collection_jobs WHERE id=?').get('job')),f.untouched);
  const quote=await json(await f.h.route('/api/products/'+product.id+'/quotation-fields'));assert.equal(quote.categoryContext.profileId,f.profile.id);assert.equal(quote.categoryContext.categoryId,'991234');assert.deepEqual(quote.categoryContext.categoryPath,schemaPath);
  for(const row of quote.resolved.rows){assert.equal(row.fields.title.value,title);assert.equal(row.fields.searchTags.value,content.seo.keywords.value.join(', '));assert.equal(row.fields.brand.value,f.settings.brand);assert.equal(row.fields.supplyPrice.value,'4930');assert.equal(row.fields.salePrice.value,'8220');}
  assert.ok(!f.h.network.includes('supplier.coupang.com'));
 }finally{f.close();}
});

for(const company of schemaCompanies){
 for(const scenario of [
  {name:'long feature',features:'사양'.repeat(51),reason:/특징.*100자/,titleFallback:true},
  {name:'multiline feature',features:'쌓을 수 있는\n주방 서랍용',reason:/특징.*100자/,titleFallback:true},
  {name:'overlong composed title',features:'가'.repeat(80),reason:/구성 상품명.*100자/,titleFallback:true},
  {name:'one overlong target',keywords:'검색어'.repeat(7),reason:/검색태그.*20자/,tagsFallback:true},
  {name:'combined target overflow',keywords:Array.from({length:8},(_,i)=>String(i)+'검색'.repeat(9)).join(', '),reason:/검색태그.*150자/,tagsFallback:true},
 ])test(`invalid optional ${scenario.name} keeps usable translation but actual intake requires SEO review (${company.code})`,async()=>{
  const f=await fixture(company,scenario);try{
   const message=await f.intake(),product=f.product(),content=await f.content(),options=await f.options();
   assert.match(message,/검토 필요/);assert.match(message,scenario.reason);assert.doesNotMatch(message,/SEO·옵션 초안을 생성해 반영했습니다/);
   assert.equal(content.seo.title.value,company.name+' 브랜드 '+(scenario.titleFallback?'서랍 수납함':'쌓을 수 있는 서랍 수납함'));
   assert.deepEqual(content.seo.keywords.value,scenario.tagsFallback?['서랍','수납함']:['주방 정리함','서랍 정리함','서랍','수납함']);
   assert.equal(content.seo.description.value,'주방 서랍용 쌓을 수 있는 수납함');assert.equal(content.label.material.value,'플라스틱');assert.equal(options.rows[0].translatedName,'흰색');assert.equal(options.rows[0].unitCostCny,5.5);
   assert.deepEqual(f.h.sqlite.prepare('SELECT * FROM collection_results WHERE job_id=?').get(f.job.id),f.original);assert.deepEqual(f.h.sqlite.prepare('SELECT * FROM collection_context WHERE job_id=?').get(f.job.id),f.context);
   const job=f.canonical();assert.equal(JSON.parse(job.result).draft.title,'서랍 수납함');assert.equal(JSON.parse(job.review).source.guidance.features,f.features);assert.equal(JSON.parse(job.review).source.guidance.keywords,f.keywords);assert.equal(f.queries.length,2);assert.equal(product.supplier_hub_status,'미전송');
   // Direct executor evidence, rather than merely checking the message text.
   const first=await fixture(company,{...scenario,goal:'collect'});try{
    await first.intake();const outcome=await first.h.load('app/intake-seo.ts').prepareIntakeSeoOutcome(first.product().id,first.fetcher,new AbortController().signal);
    assert.equal(outcome.completed,false);assert.equal(outcome.reviewRequired,true);assert.equal(outcome.manualReady,false);assert.match(outcome.message,scenario.reason);
   }finally{first.close();}
  }finally{f.close();}
 });
 test(`canonical replay retains later manual blanks, tags, labels, option edits and original prices (${company.code})`,async()=>{
  const f=await fixture(company);try{
   await f.intake();const product=f.product(),base='/api/products/'+product.id,content=await f.content(),options=await f.options(),canonical=f.canonical();
   await json(await f.h.route(base+'/content',{method:'PATCH',body:{expectedRevision:content.revision,patch:{seo:{title:'',keywords:[],description:''},label:{productName:'직접 검토한 별도 품명'},labelProductNameLinked:false}}}));
   const rows=f.h.load('app/product-options.ts').optionInputs(options);rows[0].translatedName='수정한 흰색';rows[0].unitCostCny=7.25;rows[0].minimumOrderQuantity=5;rows[0].included=false;
   await json(await f.h.route(base+'/options',{method:'PATCH',body:{expectedRevision:options.revision,expectedProductVersion:f.product().updated_at,rows}}));
   const before=f.state(),requests=f.queries.length;await f.intake();assert.equal(f.state(),before);assert.equal(f.queries.length,requests);assert.deepEqual(f.canonical(),canonical);
   const saved=await f.content();assert.equal(saved.seo.title.value,'');assert.deepEqual(saved.seo.keywords.value,[]);assert.equal(saved.label.productName.value,'직접 검토한 별도 품명');assert.equal(saved.labelProductNameLinked,false);assert.equal((await f.options()).rows[0].unitCostCny,7.25);assert.equal(f.product().supplier_hub_status,'미전송');
  }finally{f.close();}
 });
 test(`direct pre-generation manual title/tags and label remain authoritative while other initial translation fields fill (${company.code})`,async()=>{
  const f=await fixture(company,{goal:'collect'});try{
   await f.intake();const base='/api/products/'+f.product().id,content=await f.content();
   await json(await f.h.route(base+'/content',{method:'PATCH',body:{expectedRevision:content.revision,patch:{seo:{title:'직접 정한 제품명',keywords:[]},label:{productName:'별도 수동 품명'},labelProductNameLinked:false}}}));
   const outcome=await f.h.load('app/intake-seo.ts').prepareIntakeSeoOutcome(f.product().id,f.fetcher,new AbortController().signal),saved=await f.content();
   assert.equal(outcome.completed,true);assert.equal(outcome.reviewRequired,false);assert.equal(saved.seo.title.value,'직접 정한 제품명');assert.deepEqual(saved.seo.keywords.value,[]);assert.equal(saved.label.productName.value,'별도 수동 품명');assert.equal(saved.labelProductNameLinked,false);assert.equal(saved.seo.description.value,'주방 서랍용 쌓을 수 있는 수납함');assert.equal((await f.options()).rows[0].translatedName,'흰색');
  }finally{f.close();}
 });
}

test('captured optional SEO proof must match the real preview job and content revision before automatic application',async()=>{
 for(const corruption of [value=>{value.jobId='wrong-job';},value=>{value.contentRevision++;},value=>{value.needsReview=false;},value=>{value.warnings=[];}]){
  const f=await fixture(schemaCompanies[0],{goal:'collect',features:'특징'.repeat(51)});try{
   await f.intake();const before=JSON.stringify({product:f.product(),content:await f.content(),options:await f.options()}),applyCalls=[];
   const fetcher=async(path,init={})=>{const response=await f.fetcher(path,init);if(path.endsWith('/translation-apply')){const body=JSON.parse(init.body);applyCalls.push(body.action);if(body.action==='preview'&&response.ok){const value=await response.json();assert.ok(value.intakeSeoGuidance);corruption(value.intakeSeoGuidance);return Response.json(value);}}return response;};
   const outcome=await f.h.load('app/intake-seo.ts').prepareIntakeSeoOutcome(f.product().id,fetcher,new AbortController().signal);
   assert.equal(outcome.completed,false);assert.match(outcome.message,/SEO 구성 검토 상태를 확인하지 못했습니다/);assert.deepEqual(applyCalls,['preview']);assert.equal(JSON.stringify({product:f.product(),content:await f.content(),options:await f.options()}),before);assert.equal(f.queries.length,2);
  }finally{f.close();}
 }
});


for(const [index,company]of schemaCompanies.entries())test(`unfinished automatic SEO fallback survives reopen until that exact field is manually confirmed (${company.code})`,async()=>{
 const f=await fixture(company,index?{keywords:'검색어'.repeat(7)}:{features:'특징'.repeat(51)});try{
  assert.match(await f.intake(),/검토 필요/);const initial=await f.content(),initialOptions=await f.options(),base='/api/products/'+f.product().id;
  await json(await f.h.route(base+'/content',{method:'PATCH',body:{expectedRevision:initial.revision,patch:{seo:{description:'별도 수정 설명'},label:{precautions:'직접 확인한 주의사항'}}}}));
  const editedRows=f.h.load('app/product-options.ts').optionInputs(initialOptions);editedRows[0].translatedName='수동 확인 옵션';
  await json(await f.h.route(base+'/options',{method:'PATCH',body:{expectedRevision:initialOptions.revision,expectedProductVersion:f.product().updated_at,rows:editedRows}}));
  const saved=await f.content(),before=f.state(),requests=f.queries.length;assert.ok(saved.intakeSeoGuidancePending);assert.deepEqual(saved.intakeSeoGuidancePending,initial.intakeSeoGuidancePending,'other SEO, label and option edits preserve the exact pending field proof');
  const replay=await f.h.load('app/intake-seo.ts').prepareIntakeSeoOutcome(f.product().id,f.fetcher,new AbortController().signal);
  assert.equal(replay.completed,false);assert.equal(replay.reviewRequired,true);assert.match(replay.message,/SEO 구성안/);assert.equal(f.state(),before);assert.equal(f.queries.length,requests);
  // Saving even the same value is an explicit owner confirmation; unrelated
  // fields need not be re-written to resolve this optional candidate warning.
  await json(await f.h.route('/api/products/'+f.product().id+'/content',{method:'PATCH',body:{expectedRevision:saved.revision,patch:{seo:index?{keywords:saved.seo.keywords.value}:{title:saved.seo.title.value}}}}));
  const confirmed=f.state(),done=await f.h.load('app/intake-seo.ts').prepareIntakeSeoOutcome(f.product().id,f.fetcher,new AbortController().signal);
  assert.equal(done.completed,true);assert.equal(done.reviewRequired,false);assert.equal(f.state(),confirmed);assert.equal(f.queries.length,requests);
 }finally{f.close();}
});

test('initial canonical Google guidance cannot become complete when its typed preview proof is absent',async()=>{
 const f=await fixture(schemaCompanies[0],{goal:'collect',features:'특징'.repeat(51)});try{
  await f.intake();const before=JSON.stringify({product:f.product(),content:await f.content(),options:await f.options()}),applyCalls=[];
  const fetcher=async(path,init={})=>{const response=await f.fetcher(path,init);if(path.endsWith('/translation-apply')){const body=JSON.parse(init.body);applyCalls.push(body.action);if(body.action==='preview'&&response.ok){const value=await response.json();assert.ok(value.intakeSeoGuidance);delete value.intakeSeoGuidance;return Response.json(value);}}return response;};
  const outcome=await f.h.load('app/intake-seo.ts').prepareIntakeSeoOutcome(f.product().id,fetcher,new AbortController().signal);
  assert.equal(outcome.completed,false);assert.match(outcome.message,/SEO 구성 검토 상태를 확인하지 못했습니다/);assert.deepEqual(applyCalls,['preview']);assert.equal(JSON.stringify({product:f.product(),content:await f.content(),options:await f.options()}),before);
 }finally{f.close();}
});


for(const company of schemaCompanies){
 test(`internal pending SEO proof cannot be forged by clients and malformed stored proof preserves every record (${company.code})`,async()=>{
  const f=await fixture(company,{features:'특징'.repeat(51)});try{
   await f.intake();const content=await f.content(),base='/api/products/'+f.product().id;assert.ok(content.intakeSeoGuidancePending);
   const before=f.state();for(const body of [{expectedRevision:content.revision,patch:{intakeSeoGuidancePending:content.intakeSeoGuidancePending}},{expectedRevision:content.revision,patch:{seo:{title:content.seo.title.value}},intakeSeoGuidancePending:content.intakeSeoGuidancePending}]){
    await json(await f.h.route(base+'/content',{method:'PATCH',body}),400);assert.equal(f.state(),before);
   }
   const original=f.h.sqlite.prepare('SELECT payload FROM product_content WHERE product_id=?').get(f.product().id).payload,job=f.canonical();
   for(const corrupt of [value=>{value.jobId='wrong';},value=>{value.jobId='00000000-0000-0000-0000-000000000000';},value=>{value.sourceReference='different source';},value=>{value.fields.title.updatedAt='not UTC';},value=>{value.fields.title.updatedAt='2020-01-01T00:00:00.000Z';},value=>{value.fields.title.value='different saved fallback';},value=>{value.fields.title.warning='';},value=>{value.fields.extra={};},value=>{value.fields.title.extra=true;}]){
    const bad=JSON.parse(original);corrupt(bad.intakeSeoGuidancePending);f.h.sqlite.prepare('UPDATE product_content SET payload=? WHERE product_id=?').run(JSON.stringify(bad),f.product().id);
    const preserved=f.state();await json(await f.h.route(base+'/translation-apply',{method:'POST',body:{action:'preview',jobId:job.id,expectedVersion:f.product().updated_at}}),409);assert.equal(f.state(),preserved);
   }
   f.h.sqlite.prepare('UPDATE product_content SET payload=? WHERE product_id=?').run(original,f.product().id);assert.equal(f.state(),before);
  }finally{f.close();}
 });
 test(`a concurrent manual save rejects the initial fallback application without persisting a false pending proof (${company.code})`,async()=>{
  const f=await fixture(company,{goal:'collect',features:'특징'.repeat(51)});try{
   await f.intake();let manual,apply=0;const fetcher=async(path,init={})=>{
    if(path.endsWith('/translation-apply')&&JSON.parse(init.body).action==='apply'){
     apply++;const content=await f.content();await json(await f.h.route('/api/products/'+f.product().id+'/content',{method:'PATCH',body:{expectedRevision:content.revision,patch:{label:{precautions:'저장 중 직접 수정'}}}}));manual=JSON.stringify({product:f.product(),content:await f.content(),options:await f.options()});
    }return f.fetcher(path,init);
   };
   const outcome=await f.h.load('app/intake-seo.ts').prepareIntakeSeoOutcome(f.product().id,fetcher,new AbortController().signal);
   assert.equal(outcome.completed,false);assert.match(outcome.message,/상품이 변경|저장 중|자료가 변경/);assert.equal(apply,1);assert.equal(JSON.stringify({product:f.product(),content:await f.content(),options:await f.options()}),manual);assert.equal((await f.content()).intakeSeoGuidancePending,undefined);assert.equal(f.canonical().status,'completed');assert.equal(f.queries.length,2);
  }finally{f.close();}
 });
 test(`uncertain first-save acknowledgement recovers its persisted warning without another provider or automatic write (${company.code})`,async()=>{
  const f=await fixture(company,{goal:'collect',features:'특징'.repeat(51)});try{
   await f.intake();let lost=0;const fetcher=async(path,init={})=>{const response=await f.fetcher(path,init);if(path.endsWith('/translation-apply')&&JSON.parse(init.body).action==='apply'&&response.ok){lost++;throw Error('fixture lost acknowledged response');}return response;};
   const outcome=await f.h.load('app/intake-seo.ts').prepareIntakeSeoOutcome(f.product().id,fetcher,new AbortController().signal);assert.equal(outcome.completed,false);assert.equal(lost,1);const content=await f.content();assert.ok(content.intakeSeoGuidancePending);assert.equal(content.seo.description.value,'주방 서랍용 쌓을 수 있는 수납함');assert.equal((await f.options()).rows[0].translatedName,'흰색');
   const saved=f.state(),queries=f.queries.length,recovered=await f.h.load('app/intake-seo.ts').prepareIntakeSeoOutcome(f.product().id,f.fetcher,new AbortController().signal);
   assert.equal(recovered.completed,false);assert.equal(recovered.reviewRequired,true);assert.match(recovered.message,/입력한 특징.*100자/);assert.equal(f.state(),saved);assert.equal(f.queries.length,queries);assert.equal(f.product().supplier_hub_status,'미전송');
  }finally{f.close();}
 });
}
