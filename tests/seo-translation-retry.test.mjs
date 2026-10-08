import test from 'node:test';
import assert from 'node:assert/strict';
import {mobileIntakeHarness} from './helpers/mobile-intake.mjs';
const companies=[{companyCode:'A01464742',companyName:'와이홉'},{companyCode:'A01526306',companyName:'유앤채'}];
const json=async(response,status=200)=>{assert.equal(response.status,status,await response.clone().text());return response.json();};
const payload=(h,table)=>JSON.parse(h.sqlite.prepare('SELECT payload FROM '+table).get().payload);

async function fixture(company=companies[0],initialMode='failed'){
 let mode=initialMode,queries=[],executes=0;
 const texts=new Map();
 const h=mobileIntakeHarness({...company,translationFetcher:async(target,init)=>{
  const url=new URL(target),query=url.searchParams.get('q');queries.push(query);
  assert.equal(url.origin,'https://translate.googleapis.com');assert.equal(url.pathname,'/translate_a/single');assert.equal(url.searchParams.get('client'),'gtx');
  assert.equal(init.method,'GET');assert.equal(init.credentials,'omit');assert.equal(init.body,undefined);
  if(mode==='failed'||mode==='partial'&&query.startsWith('[[YFTR'))return new Response('fixture429',{status:429});
  const translate=source=>{assert.ok(texts.has(source),'SEO retry sends only its exact title/description');return texts.get(source);};
  const translated=query.startsWith('[[YFTR')?query.split('\n').map(line=>{const m=/^(\[\[YFTR\d{6}\]\]) (.+)$/u.exec(line);assert.ok(m);return `${m[1]} ${translate(m[2])}`;}).join('\n'):translate(query);
  return Response.json([[[translated,query,null,null]],null,'zh-CN']);
 }});
 try{
  const profile=await h.load('db/category-profiles.ts').createCategoryProfile('owner',{name:'SEO 원문 재시도',categoryId:'69900',categoryPath:['패션의류잡화','유니섹스/남녀공용 패션','공용 잡화','선글라스','남녀공용패션선글라스'],template:null,mappings:[]},'cat');
  h.context.category=profile;h.sqlite.prepare('UPDATE collection_context SET payload=? WHERE job_id=?').run(JSON.stringify(h.context),'job');
  await json(await h.route('/api/collection-jobs/job/collect',{method:'POST'}));const saved=await json(await h.route('/api/collection-jobs/job/product',{method:'POST'})),id=saved.productId,path='/api/products/'+id;
  const receipt=payload(h,'collection_results');texts.set(receipt.title,'원문 기준 선글라스');if(receipt.description)texts.set(receipt.description,'원문 기준 상품 설명');
  h.bindings.SOURCEFLOW_TEXT_PROVIDER='google-free';delete h.bindings.AI;
  const prepared=await json(await h.route(path+'/translation',{method:'POST',body:{action:'prepare-collected',intake:true}}),201);
  await json(await h.route(path+'/translation',{method:'POST',body:{action:'approve',jobId:prepared.job.id,reviewFingerprint:prepared.job.review.fingerprint,confirmPaid:true}}));
  const initial=await json(await h.route(path+'/translation',{method:'POST',body:{action:'execute',jobId:prepared.job.id}}));assert.equal(initial.job.status,initialMode==='failed'?'failed':'completed');
  const content=payload(h,'product_content');await json(await h.route(path+'/content',{method:'PATCH',body:{expectedRevision:content.revision,patch:{seo:{description:'',keywords:['직접 검색어']},label:{manufacturer:'직접 제조사'}}}}));
  mode='success';queries=[];
  const product=()=>h.sqlite.prepare('SELECT * FROM products WHERE id=?').get(id);
  const post=body=>h.route(path+'/translation',{method:'POST',body});
  const fetcher=(target,init={})=>{const body=init.body?JSON.parse(init.body):undefined;if(body?.action==='execute')executes++;return h.route(String(target),{method:init.method??'GET',body});};
  const untouched=()=>JSON.stringify({product:product(),content:payload(h,'product_content'),options:payload(h,'product_options'),context:payload(h,'collection_context'),receipt:payload(h,'collection_results'),original:h.sqlite.prepare('SELECT * FROM translation_jobs WHERE id=?').get(initial.job.id),objects:[...h.objects]});
  return {h,id,path,receipt,initial:initial.job,queries,texts,product,post,fetcher,untouched,setMode:value=>mode=value,get executes(){return executes;}};
 }catch(error){h.close();throw error;}
}

for(const company of companies)for(const initialMode of ['failed','partial'])test(`explicit SEO retry preserves terminal ${initialMode} intake, prepares a fresh reviewed job and requests no options (${company.companyCode})`,async()=>{
 const f=await fixture(company,initialMode),{h}=f;
 try{
  const api=h.load('app/seo-translation-retry.ts'),state=api.newSeoRetryState(f.id,f.product().updated_at),before=f.untouched();
  const original=await json(await f.post({action:'prepare-collected',intake:true}));assert.equal(original.job.id,f.initial.id);assert.equal(f.queries.length,0);
  const prepared=await api.prepareSeoTranslationRetry(state,{fetcher:f.fetcher,signal:new AbortController().signal,onState:()=>{}});
  assert.equal(prepared.job.status,'prepared');assert.notEqual(prepared.job.id,f.initial.id);assert.equal(prepared.job.review.seoRetry.scope,'seo');assert.equal(prepared.job.review.seoRetry.company.code,company.companyCode);
  assert.deepEqual(prepared.job.review.source.attributes,[]);assert.equal(f.queries.length,0);assert.equal(f.untouched(),before);
  const repeat=await api.prepareSeoTranslationRetry(state,{fetcher:f.fetcher,signal:new AbortController().signal,onState:()=>{}});assert.equal(repeat.job.id,prepared.job.id);assert.equal(f.queries.length,0);
  const outcome=await api.executeSeoTranslationRetry(state,{fetcher:f.fetcher,signal:new AbortController().signal,onState:()=>{}});
  assert.equal(outcome.job.status,'completed');assert.equal(outcome.closed,true);assert.equal(f.executes,1);assert.equal(outcome.job.result.draft.title,'원문 기준 선글라스');assert.deepEqual(outcome.job.result.draft.attributes,[]);
  assert.ok(f.queries.length>=1&&f.queries.length<=2);assert.ok(f.queries.every(query=>[f.receipt.title,f.receipt.description].includes(query)));assert.equal(f.untouched(),before);
  const requests=f.queries.length;await api.executeSeoTranslationRetry(JSON.parse(JSON.stringify(state)),{fetcher:f.fetcher,signal:new AbortController().signal,onState:()=>{}});assert.equal(f.queries.length,requests);assert.equal(f.executes,1);
  const content=payload(h,'product_content'),options=h.sqlite.prepare('SELECT payload FROM product_options').get().payload;
  const application=h.load('app/translation-adoption.ts').translationAdoptionInput(content,outcome.job,f.product().updated_at,['title']);
  await json(await h.route(f.path+'/content',{method:'PATCH',body:application}));const current=payload(h,'product_content');
  assert.equal(current.seo.title.value,'원문 기준 선글라스');assert.deepEqual(current.seo.description,content.seo.description);assert.deepEqual(current.seo.keywords,content.seo.keywords);
  assert.deepEqual(current.label.manufacturer,content.label.manufacturer);assert.equal(h.sqlite.prepare('SELECT payload FROM product_options').get().payload,options);
  assert.equal(h.aiSources.length,0);assert.ok(!h.network.includes('supplier.coupang.com'));
 }finally{h.close();}
});

test('fresh SEO prepare/execute lost acknowledgements recover one exact nonce outside bounded history, without another execute',async()=>{
 const f=await fixture(),{h}=f;
 try{
  const api=h.load('app/seo-translation-retry.ts'),state=api.newSeoRetryState(f.id,f.product().updated_at);let losePrepare=true,loseExecute=true;
  const fetcher=async(target,init={})=>{const body=init.body?JSON.parse(init.body):{};const response=await f.fetcher(target,init);
   if(body.action==='prepare-seo-retry'&&losePrepare){losePrepare=false;throw Error('fixture prepare acknowledgement lost');}
   if(body.action==='execute'&&loseExecute){loseExecute=false;throw Error('fixture execution acknowledgement lost');}return response;};
  const before=f.untouched(),prepared=await api.prepareSeoTranslationRetry(state,{fetcher,signal:new AbortController().signal,onState:()=>{}});
  assert.equal(prepared.job.status,'prepared');const result=await api.executeSeoTranslationRetry(state,{fetcher,signal:new AbortController().signal,onState:()=>{}});
  assert.equal(result.job.status,'completed');assert.equal(f.executes,1);assert.equal(f.untouched(),before);
  const row=h.sqlite.prepare('SELECT * FROM translation_jobs WHERE id=?').get(state.jobId);
  for(let index=0;index<25;index++)h.sqlite.prepare(`INSERT INTO translation_jobs SELECT ?,owner_id,product_id,?,request_fingerprint,product_version,content_revision,status,review_fingerprint,review,expires_at,result,error,claim_token,?,approved_at,started_at,finished_at FROM translation_jobs WHERE id=?`)
   .run(crypto.randomUUID(),'newer-history-'+index,new Date(Date.parse(row.created_at)+60000+index).toISOString(),row.id);
  assert.ok(!(await h.load('db/translation-jobs.ts').listTranslationJobs('owner',f.id)).some(job=>job.id===row.id));
  const count=f.queries.length;await api.executeSeoTranslationRetry(state,{fetcher,signal:new AbortController().signal,onState:()=>{}});assert.equal(f.executes,1);assert.equal(f.queries.length,count);
 }finally{h.close();}
});

test('an execute acknowledgement lost before a durable claim leaves approved state read-only and never resends execute',async()=>{
 const f=await fixture(),{h}=f;
 try{
  const api=h.load('app/seo-translation-retry.ts'),state=api.newSeoRetryState(f.id,f.product().updated_at);let posts=0;
  const fetcher=(target,init={})=>{const body=init.body?JSON.parse(init.body):{};if(body.action==='execute'){posts++;throw Error('fixture uncertain request delivery');}return f.fetcher(target,init);};
  await api.prepareSeoTranslationRetry(state,{fetcher,signal:new AbortController().signal,onState:()=>{}});
  const result=await api.executeSeoTranslationRetry(state,{fetcher,signal:new AbortController().signal,onState:()=>{}});assert.equal(result.job.status,'approved');assert.equal(result.closed,false);assert.equal(state.executeSubmitted,true);
  await api.executeSeoTranslationRetry(JSON.parse(JSON.stringify(state)),{fetcher,signal:new AbortController().signal,onState:()=>{}});assert.equal(posts,1);assert.equal(f.queries.length,0);
 }finally{h.close();}
});

test('prepare-collected never misidentifies an option-only partial job as a SEO request when collected attributes are empty',async()=>{
 const f=await fixture(),{h}=f;
 try{
  const receipt=payload(h,'collection_results');receipt.attributes=[];h.sqlite.prepare('UPDATE collection_results SET payload=? WHERE job_id=?').run(JSON.stringify(receipt),'job');f.setMode('partial');
  const options=await json(await f.post({action:'prepare-options-retry',expectedVersion:f.product().updated_at,retryKey:crypto.randomUUID()}),201);
  await json(await f.post({action:'approve',jobId:options.job.id,reviewFingerprint:options.job.review.fingerprint,confirmPaid:true}));await json(await f.post({action:'execute',jobId:options.job.id}));
  const count=f.queries.length,ordinary=await json(await f.post({action:'prepare-collected'}),201);assert.notEqual(ordinary.job.id,options.job.id);assert.equal(ordinary.job.review.optionsRetry,undefined);assert.equal(f.queries.length,count);
  const fresh=await json(await f.post({action:'prepare-seo-retry',expectedVersion:f.product().updated_at,retryKey:crypto.randomUUID()}),201);assert.ok(fresh.job.review.seoRetry);assert.deepEqual(fresh.job.review.source.attributes,[]);assert.equal(f.queries.length,count);
 }finally{h.close();}
});

for(const scenario of ['removed','option-revision','option-corrupt','source','running','uncertain','foreign-owner','wrong-company'])test(`SEO approval protects current source/company/option/removal identity (${scenario})`,async()=>{
 const f=await fixture(),{h}=f;
 try{
  const api=h.load('app/seo-translation-retry.ts'),state=api.newSeoRetryState(f.id,f.product().updated_at),prepared=await api.prepareSeoTranslationRetry(state,{fetcher:f.fetcher,signal:new AbortController().signal,onState:()=>{}});
  if(scenario==='removed')assert.ok(await h.load('db/product-removals.ts').removeProduct('owner',f.id,f.product().updated_at));
  if(scenario==='option-revision'){
   const options=payload(h,'product_options'),rows=h.load('app/product-options.ts').optionInputs(options);
   rows[0].unitCostCny+=1;
   await json(await h.route(f.path+'/options',{method:'PATCH',body:{expectedRevision:options.revision,expectedProductVersion:f.product().updated_at,rows}}));
   assert.equal(payload(h,'product_options').revision,options.revision+1);
  }
  if(scenario==='option-corrupt')h.sqlite.prepare('UPDATE product_options SET revision=revision+1 WHERE product_id=?').run(f.id);
  if(scenario==='source'){const receipt=payload(h,'collection_results');receipt.title+=' 原文变更';h.sqlite.prepare('UPDATE collection_results SET payload=? WHERE job_id=?').run(JSON.stringify(receipt),'job');}
  if(['running','uncertain'].includes(scenario))h.sqlite.prepare('UPDATE translation_jobs SET status=? WHERE id=?').run(scenario,f.initial.id);
  if(scenario==='foreign-owner')h.sqlite.prepare("UPDATE translation_jobs SET owner_id='foreign-owner' WHERE id=?").run(prepared.job.id);
  if(scenario==='wrong-company'){const review=JSON.parse(h.sqlite.prepare('SELECT review FROM translation_jobs WHERE id=?').get(prepared.job.id).review);review.seoRetry.company={code:'A01526306',name:'유앤채'};h.sqlite.prepare('UPDATE translation_jobs SET review=? WHERE id=?').run(JSON.stringify(review),prepared.job.id);}
  const bytes=JSON.stringify(h.sqlite.prepare('SELECT * FROM translation_jobs WHERE id=?').get(prepared.job.id)),before=f.untouched();
  await json(await f.post({action:'approve',jobId:prepared.job.id,reviewFingerprint:prepared.job.review.fingerprint,confirmPaid:true}),scenario==='foreign-owner'?404:scenario==='option-corrupt'?503:409);
  assert.equal(JSON.stringify(h.sqlite.prepare('SELECT * FROM translation_jobs WHERE id=?').get(prepared.job.id)),bytes);assert.equal(f.untouched(),before);assert.equal(f.queries.length,0);
 }finally{h.close();}
});

test('source tuple races at approval and apply are atomically rejected, preserving saved manual blanks and options',async()=>{
 for(const action of ['approve','apply']){
 const f=await fixture(),{h}=f;
 try{
  const api=h.load('app/seo-translation-retry.ts'),state=api.newSeoRetryState(f.id,f.product().updated_at),prepared=await api.prepareSeoTranslationRetry(state,{fetcher:f.fetcher,signal:new AbortController().signal,onState:()=>{}});
  let request;
  if(action==='approve')request=()=>f.post({action:'approve',jobId:prepared.job.id,reviewFingerprint:prepared.job.review.fingerprint,confirmPaid:true});
  else{await api.executeSeoTranslationRetry(state,{fetcher:f.fetcher,signal:new AbortController().signal,onState:()=>{}});
   const body={jobId:prepared.job.id,expectedVersion:f.product().updated_at},preview=await json(await h.route(f.path+'/translation-apply',{method:'POST',body:{...body,action:'preview'}}));
   assert.ok(preview.preview.some(row=>row.name==='상품명'));assert.ok(!preview.preview.some(row=>row.name==='상품 설명'||row.name==='검색어'));
   request=()=>h.route(f.path+'/translation-apply',{method:'POST',body:{...body,action:'apply',fingerprint:preview.fingerprint}});}
  const product=JSON.stringify(f.product()),content=h.sqlite.prepare('SELECT payload FROM product_content').get().payload,options=h.sqlite.prepare('SELECT payload FROM product_options').get().payload;
  const beforeJob=JSON.stringify(h.sqlite.prepare('SELECT * FROM translation_jobs WHERE id=?').get(prepared.job.id)),originalPrepare=h.db.prepare;let changed=false;
  h.db.prepare=function(sql){const query=originalPrepare(sql),match=action==='approve'?sql.startsWith("UPDATE translation_jobs SET status='approved'"):sql.startsWith('UPDATE products SET updated_at=?');
   if(match&&sql.includes('collection_results')){const execute=query.execute;query.execute=function(){if(!changed){changed=true;const receipt=payload(h,'collection_results');receipt.title+=' 后来原文';h.sqlite.prepare('UPDATE collection_results SET payload=? WHERE job_id=?').run(JSON.stringify(receipt),'job');}return execute();};}return query;};
  const calls=f.queries.length;await json(await request(),409);assert.equal(changed,true);assert.equal(f.queries.length,calls);
  assert.equal(JSON.stringify(f.product()),product);assert.equal(h.sqlite.prepare('SELECT payload FROM product_content').get().payload,content);assert.equal(h.sqlite.prepare('SELECT payload FROM product_options').get().payload,options);
  assert.equal(JSON.stringify(h.sqlite.prepare('SELECT * FROM translation_jobs WHERE id=?').get(prepared.job.id)),beforeJob);
 }finally{h.close();}
 }
});
