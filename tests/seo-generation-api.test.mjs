import test from 'node:test';
import assert from 'node:assert/strict';
import {mobileIntakeHarness} from './helpers/mobile-intake.mjs';

const companies=[{companyCode:'A01464742',companyName:'와이홉'},{companyCode:'A01526306',companyName:'유앤채'}];
const plain=value=>JSON.parse(JSON.stringify(value));
const json=async(response,status=200)=>{assert.equal(response.status,status,await response.clone().text());return response.json();};
const payload=(h,table)=>JSON.parse(h.sqlite.prepare('SELECT payload FROM '+table).get().payload);
async function fixture(company=companies[0],goal='price',{partialOptions=false}={}){
 const google=[];let optionTranslationBlocked=partialOptions;
 const h=mobileIntakeHarness({...company,translationFetcher:async(target)=>{
  const url=new URL(target);assert.equal(url.origin,'https://translate.googleapis.com');const source=url.searchParams.get('q');google.push(source);
  if(optionTranslationBlocked&&source.startsWith('[[YFTR'))return new Response('local translation partial fixture',{status:429});
  return Response.json([[[source.replace(/\p{Script=Han}+/gu,'한글'),source,null,null]],null,'zh-CN']);
 }});
 try{
  h.bindings.SOURCEFLOW_TEXT_PROVIDER='google-free';h.bindings.SOURCEFLOW_QUOTATION_AI_PROVIDER='workers-ai';h.bindings.SOURCEFLOW_QUOTATION_AI_FREE_ONLY='true';
  const profile=await h.load('db/category-profiles.ts').createCategoryProfile('owner',h.context.category,'category');h.context.category=profile;
  h.sqlite.prepare('UPDATE collection_context SET payload=? WHERE job_id=?').run(JSON.stringify(h.context),'job');
  h.sqlite.prepare('UPDATE collection_jobs SET goal=? WHERE id=?').run(goal,'job');
  await json(await h.route('/api/collection-jobs/job/collect',{method:'POST'}));
  const original=payload(h,'collection_results');original.title='合成太阳镜';original.description='原文商品说明';
  h.sqlite.prepare('UPDATE collection_results SET payload=? WHERE job_id=?').run(JSON.stringify(original),'job');
  await h.intake();optionTranslationBlocked=false;const product=()=>h.sqlite.prepare('SELECT * FROM products').get(),id=product().id,path='/api/products/'+id+'/seo-generation';
  const requests=[],generated=[],good={title:'검토 브랜드 선글라스',keywords:['선글라스','패션 안경'],description:'상품 원문을 참고한 선글라스 설명',attributes:[],warnings:[]};let reply=good;
  h.bindings.AI={run:async(model,input)=>{assert.equal(model,'@cf/meta/llama-3.3-70b-instruct-fp8-fast');assert.equal(input.max_tokens,2048);assert.equal(input.response_format.type,'json_schema');generated.push({model,input});return typeof reply==='function'?reply(model,input):{response:reply,choices:[{message:{role:'assistant',content:JSON.stringify(reply)},finish_reason:'stop'}]};}};
  const post=body=>{requests.push(body);return h.route(path,{method:'POST',body});};
  const get=(query='')=>h.route(path+query);
  const prepare=async(context,memo,key=crypto.randomUUID())=>{
   context??=await get().then(json);memo??=context.memo;
   const body={action:'prepare',expectedVersion:context.productVersion,expectedContentRevision:context.contentRevision,expectedOptionRevision:context.optionRevision,expectedSourceFingerprint:context.sourceFingerprint,memo,idempotencyKey:key};
   return {body,...await json(await post(body),201)};
  };
  const approve=async job=>json(await post({action:'approve',jobId:job.id,reviewFingerprint:job.review.fingerprint,confirmPaid:true}));
  const execute=async job=>json(await post({action:'execute',jobId:job.id}));
  const baseline=()=>JSON.stringify({product:product(),content:payload(h,'product_content'),options:payload(h,'product_options'),source:payload(h,'collection_results'),context:payload(h,'collection_context'),objects:[...h.objects]});
  return {h,id,path,post,get,prepare,approve,execute,baseline,google,generated,requests,product,good,setReply:value=>reply=value};
 }catch(error){h.close();throw error;}
}

for(const company of companies)for(const goal of ['price','work'])test(company.companyCode+' '+goal+': new Google intake remains translated and one purpose-bound free SEO generation optimizes the draft without changing option facts',async()=>{
 const f=await fixture(company,goal),{h}=f;
 try{
  const initial=payload(h,'product_content');assert.equal(initial.seo.title.provenance,'translated');assert.equal(initial.seo.description.provenance,'translated');
  assert.ok(f.google.length);const sourceBefore=h.sqlite.prepare('SELECT payload FROM collection_results').get().payload,optionsBefore=plain(payload(h,'product_options')),before=f.baseline();
  const config=await json(await h.load('app/api/seo-generation/configuration/route.ts').GET());assert.equal(config.purpose,'seo-generation');assert.equal(config.ownerId,'owner');assert.equal(config.company.code,company.companyCode);assert.equal(config.configuration.freeOnly,true);assert.equal(config.configuration.configured,true);
  const context=await json(await f.get());assert.ok(context.source.attributes.length);assert.deepEqual(context.configuration,config.configuration);assert.equal(context.configuration.model,'@cf/meta/llama-3.3-70b-instruct-fp8-fast');
  const prepared=await f.prepare(context);assert.equal(prepared.job.status,'prepared');assert.equal(prepared.job.review.seoGeneration.purpose,'seo-generation');assert.equal(f.generated.length,0);assert.equal(f.baseline(),before);
  const replay=await json(await f.post(prepared.body));assert.equal(replay.job.id,prepared.job.id);const lookup=await json(await f.get('?idempotencyKey='+prepared.body.idempotencyKey));assert.equal(lookup.jobs[0].id,prepared.job.id);
  await f.approve(prepared.job);const completed=await f.execute(prepared.job);assert.equal(completed.job.status,'completed');assert.equal(f.generated.length,1);assert.equal(f.baseline(),before);
  const providerInput=JSON.parse(f.generated[0].input.messages[1].content);assert.deepEqual(providerInput.source,context.source);assert.deepEqual(providerInput.memo,context.memo);
  assert.deepEqual(completed.job.result.draft.attributes,[]);assert.ok(!completed.job.result.draft.warnings.some(value=>value.includes('누락')));
  assert.equal((await f.execute(completed.job)).job.id,completed.job.id);assert.equal(f.generated.length,1);
  const ordinary=await json(await h.route('/api/products/'+f.id+'/translation'));assert.ok(!ordinary.jobs.some(job=>job.id===completed.job.id));
  await json(await h.route('/api/products/'+f.id+'/translation',{method:'POST',body:{action:'execute',jobId:completed.job.id}}),409);
  await json(await h.route('/api/products/'+f.id+'/translation-apply',{method:'POST',body:{action:'preview',jobId:completed.job.id,expectedVersion:context.productVersion}}),409);
  const request={action:'preview',jobId:completed.job.id,expectedVersion:context.productVersion,linkQuotationSeoDefaults:true};const preview=await json(await f.post(request));assert.ok(preview.preview.some(row=>row.after===f.good.title));
  assert.ok(initial.categoryAttributes?.values.length);assert.ok(!preview.skipped.some(value=>value.includes('상품 속성 번역이 누락')));
  const saved=await json(await f.post({...request,action:'apply',fingerprint:preview.fingerprint}));assert.equal(saved.contentRevision,context.contentRevision+1);assert.equal(saved.optionRevision,context.optionRevision+1);
  const content=payload(h,'product_content'),options=payload(h,'product_options');assert.equal(content.seo.title.value,f.good.title);assert.equal(content.seo.title.provenance,'generated');assert.deepEqual(content.seo.keywords.value,f.good.keywords);assert.equal(content.seo.keywords.provenance,'generated');
  assert.deepEqual(options.rows,optionsBefore.rows);assert.deepEqual(options.bundleSources,optionsBefore.bundleSources);assert.deepEqual(content.categoryAttributes,initial.categoryAttributes);assert.equal(h.sqlite.prepare('SELECT payload FROM collection_results').get().payload,sourceBefore);
  assert.equal(h.sqlite.prepare('SELECT requests FROM quotation_ai_daily').get().requests,1);assert.equal(h.bindings.SOURCEFLOW_TEXT_PROVIDER,'google-free');assert.ok(!h.network.includes('supplier.coupang.com'));
  await json(await f.post({...request,action:'apply',fingerprint:preview.fingerprint}),409);assert.equal(f.generated.length,1);assert.equal(payload(h,'product_content').revision,content.revision);
 }finally{h.close();}
});

test('actual work intake with partial Google options continues through option-only adoption then fresh purpose-bound SEO generation',async()=>{
 const f=await fixture(companies[0],'work',{partialOptions:true}),{h}=f;
 try{
  const optionsBefore=plain(payload(h,'product_options')),sourceBefore=h.sqlite.prepare('SELECT payload FROM collection_results').get().payload;
  assert.ok(optionsBefore.rows.some(row=>row.provenance.translatedName!=='translated'));
  const configuration=(await json(await h.load('app/api/seo-generation/configuration/route.ts').GET())).configuration,requests=[];
  const fetcher=async(input,init)=>{
   const target=typeof input==='string'?input:input.url,url=new URL(target,'https://app.test');assert.equal(url.origin,'https://app.test');requests.push({path:url.pathname,body:init?.body?JSON.parse(init.body):null});
   if(url.pathname==='/api/supplier-hub/catalog-context')return Response.json({ownerId:'owner',company:{code:companies[0].companyCode,name:companies[0].companyName}});
   if(url.pathname==='/api/products/'+f.id)return h.load('app/api/products/[id]/route.ts').GET(new Request(url),{params:Promise.resolve({id:f.id})});
   return h.route(url.pathname+url.search,{method:init?.method??'GET',body:init?.body});
  };
  const result=await h.load('app/batch-selected-work.ts').runSelectedBatchProduct(f.id,{stages:['seo'],mode:'full',expectedOwnerId:'owner',signal:new AbortController().signal,fetcher,keys:new Map(),newKey:()=>crypto.randomUUID(),onStage:()=>{},seoGenerationConsent:configuration});
  assert.equal(result.stages[0].status,'draft',JSON.stringify(result));assert.equal(f.generated.length,1);
  const content=payload(h,'product_content'),options=payload(h,'product_options');assert.equal(content.seo.title.value,f.good.title);assert.equal(content.seo.title.provenance,'generated');assert.ok(options.rows.every(row=>row.provenance.translatedName==='translated'));
  assert.deepEqual(options.rows.map(row=>({id:row.id,originalName:row.originalName,originalColor:row.originalColor,originalSize:row.originalSize,unitPrice:row.unitPrice,skuId:row.skuId})),optionsBefore.rows.map(row=>({id:row.id,originalName:row.originalName,originalColor:row.originalColor,originalSize:row.originalSize,unitPrice:row.unitPrice,skuId:row.skuId})));
  assert.ok(requests.some(request=>request.path.endsWith('/translation-apply')&&request.body?.action==='apply'&&request.body.scope==='options'));
  assert.equal(requests.filter(request=>request.path.endsWith('/seo-generation')&&request.body?.action==='execute').length,1);assert.equal(h.sqlite.prepare('SELECT payload FROM collection_results').get().payload,sourceBefore);
 }finally{h.close();}
});

for(const company of companies)for(const goal of ['price','work'])test(company.companyCode+' '+goal+': actual new intake and full-mode batch SEO runner generate and apply SEO through current local handlers',async()=>{
 const f=await fixture(company,goal),{h}=f;
 try{
  const before=payload(h,'product_content'),optionsBefore=plain(payload(h,'product_options')),sourceBefore=h.sqlite.prepare('SELECT payload FROM collection_results').get().payload;
  assert.equal(before.seo.title.provenance,'translated');assert.equal(before.seo.description.provenance,'translated');
  const configuration=(await json(await h.load('app/api/seo-generation/configuration/route.ts').GET())).configuration,requests=[],stages=[];
  const fetcher=async(input,init)=>{
   const target=typeof input==='string'?input:input.url,url=new URL(target,'https://app.test');assert.equal(url.origin,'https://app.test');requests.push({path:url.pathname,method:init?.method??'GET'});
   if(url.pathname==='/api/supplier-hub/catalog-context')return Response.json({ownerId:'owner',company:{code:company.companyCode,name:company.companyName}});
   if(url.pathname==='/api/products/'+f.id)return h.load('app/api/products/[id]/route.ts').GET(new Request(url),{params:Promise.resolve({id:f.id})});
   return h.route(url.pathname+url.search,{method:init?.method??'GET',body:init?.body});
  };
  const result=await h.load('app/batch-selected-work.ts').runSelectedBatchProduct(f.id,{stages:['seo'],mode:'full',expectedOwnerId:'owner',signal:new AbortController().signal,fetcher,keys:new Map(),newKey:()=>crypto.randomUUID(),onStage:value=>stages.push(value),seoGenerationConsent:configuration});
  assert.equal(result.stages[0].status,'draft',JSON.stringify(result));assert.ok(stages.some(stage=>stage.status==='running'));assert.equal(f.generated.length,1);
  const content=payload(h,'product_content');assert.equal(content.seo.title.value,f.good.title);assert.equal(content.seo.title.provenance,'generated');assert.equal(content.seo.keywords.provenance,'generated');assert.equal(content.seo.description.provenance,'generated');
  assert.ok(requests.some(request=>request.path.endsWith('/automation')));assert.ok(requests.some(request=>request.path.endsWith('/seo-generation')&&request.method==='POST'));
  assert.deepEqual(payload(h,'product_options').rows,optionsBefore.rows);assert.deepEqual(content.categoryAttributes,before.categoryAttributes);assert.equal(h.sqlite.prepare('SELECT payload FROM collection_results').get().payload,sourceBefore);
  assert.equal(h.sqlite.prepare('SELECT requests FROM quotation_ai_daily').get().requests,1);assert.ok(!h.network.includes('supplier.coupang.com'));
 }finally{h.close();}
});

for(const [source,title,accepted]of [['海绵清洁块','스펀지 면 소재 세척 블록',false],['海绵清洁块','스펀지 표면 세척 블록',true],['纯棉清洁块','순면 소재 세척 블록',true]])test('generated material evidence: '+source+' → '+title,async()=>{
 const f=await fixture(),{h}=f;
 try{
  const receipt=payload(h,'collection_results');receipt.title=source;receipt.description='原文商品说明';h.sqlite.prepare('UPDATE collection_results SET payload=?').run(JSON.stringify(receipt));
  f.setReply({...f.good,title,keywords:['세척 블록']});const prepared=await f.prepare(),before=f.baseline();await f.approve(prepared.job);const response=await f.post({action:'execute',jobId:prepared.job.id});
  assert.equal(response.status,accepted?200:409,await response.clone().text());const state=await json(await f.get('?jobId='+prepared.job.id));assert.equal(state.jobs[0].status,accepted?'completed':'failed');assert.equal(f.generated.length,1);assert.equal(f.baseline(),before);
 }finally{h.close();}
});

test('manual SEO values and blanks remain protected while eligible generated fields can still be applied',async()=>{
 const f=await fixture(),{h}=f;
 try{
  const current=payload(h,'product_content');await json(await h.route('/api/products/'+f.id+'/content',{method:'PATCH',body:{expectedRevision:current.revision,patch:{seo:{title:'직접 확정한 상품명',keywords:[]}}}}));
  const manual=payload(h,'product_content'),prepared=await f.prepare();await f.approve(prepared.job);const completed=await f.execute(prepared.job),request={action:'preview',jobId:completed.job.id,expectedVersion:f.product().updated_at,linkQuotationSeoDefaults:true};
  const preview=await json(await f.post(request));assert.ok(preview.skipped.some(value=>value.includes('직접 수정')));assert.ok(!preview.preview.some(row=>['상품명','검색어'].includes(row.name)));
  if(preview.preview.length)await json(await f.post({...request,action:'apply',fingerprint:preview.fingerprint}));
  const result=payload(h,'product_content');assert.deepEqual(result.seo.title,manual.seo.title);assert.deepEqual(result.seo.keywords,manual.seo.keywords);
 }finally{h.close();}
});

test('a saved completed execution survives a lost acknowledgement and exact-key lookup outside bounded history without another model call',async()=>{
 const f=await fixture(),{h}=f;
 try{
  const prepared=await f.prepare();await f.approve(prepared.job);const result=await f.execute(prepared.job);assert.equal(f.generated.length,1);
  const row=h.sqlite.prepare('SELECT * FROM translation_jobs WHERE id=?').get(result.job.id);
  for(let index=0;index<23;index++)h.sqlite.prepare('INSERT INTO translation_jobs SELECT ?,owner_id,product_id,?,request_fingerprint,product_version,content_revision,status,review_fingerprint,review,expires_at,result,error,claim_token,?,approved_at,started_at,finished_at FROM translation_jobs WHERE id=?').run(crypto.randomUUID(),'later-'+index,new Date(Date.parse(row.created_at)+60000+index).toISOString(),row.id);
  const lookup=await json(await f.get('?idempotencyKey='+prepared.body.idempotencyKey));assert.equal(lookup.jobs.length,1);assert.equal(lookup.jobs[0].status,'completed');assert.equal(lookup.jobs[0].id,result.job.id);assert.equal(f.generated.length,1);
 }finally{h.close();}
});

for(const scenario of ['company','source','option-revision','review-memo','free-setting','budget'])test('SEO generation refuses '+scenario+' changes before any provider execution',async()=>{
 const f=await fixture(),{h}=f;
 try{
  const prepared=await f.prepare();await f.approve(prepared.job);
  if(scenario==='company')h.setCompany({code:'A01526306',name:'유앤채'});
  if(scenario==='source'){const source=payload(h,'collection_results');source.title+=' 变更';h.sqlite.prepare('UPDATE collection_results SET payload=?').run(JSON.stringify(source));}
  if(scenario==='option-revision')h.sqlite.prepare('UPDATE product_options SET revision=revision+1').run();
  if(scenario==='review-memo'){const review=plain(prepared.job.review);review.seoGeneration.memo.features='changed';h.sqlite.prepare('UPDATE translation_jobs SET review=? WHERE id=?').run(JSON.stringify(review),prepared.job.id);}
  if(scenario==='free-setting')h.bindings.SOURCEFLOW_QUOTATION_AI_FREE_ONLY='false';
  if(scenario==='budget'){await h.load('db/quotation-ai-jobs.ts').reserveQuotationAiRequest();h.sqlite.prepare('UPDATE quotation_ai_daily SET requests=40').run();}
  const before=f.baseline(),response=await f.post({action:'execute',jobId:prepared.job.id});assert.notEqual(response.status,200,await response.clone().text());assert.equal(f.generated.length,0);assert.equal(f.baseline(),before);
 }finally{h.close();}
});

for(const [label,patch]of [['overlong title',{title:'한'.repeat(101)}],['overlong tags',{keywords:Array.from({length:15},(_,index)=>'검색어'+index+'한'.repeat(10))}],['invented number',{title:'검토 선글라스 999999개'}],['invented material',{title:'검토 실리콘 선글라스'}],['invented claim',{title:'검토 항균 선글라스'}],['option output',{attributes:[{sourceIndex:0,name:'옵션명',value:'다른 옵션'}]}]])test('invalid generated '+label+' is never adopted and never retried',async()=>{
 const f=await fixture(),{h}=f;
 try{
  const prepared=await f.prepare(),before=f.baseline();f.setReply({...f.good,...patch});await f.approve(prepared.job);const response=await f.post({action:'execute',jobId:prepared.job.id});assert.notEqual(response.status,200);
  assert.equal(f.generated.length,1);assert.equal(f.baseline(),before);const lookup=await json(await f.get('?jobId='+prepared.job.id));assert.equal(lookup.jobs[0].status,'failed');
  const repeated=await json(await f.post({action:'execute',jobId:prepared.job.id}));assert.equal(repeated.job.status,'failed');assert.equal(f.generated.length,1);
 }finally{h.close();}
});
