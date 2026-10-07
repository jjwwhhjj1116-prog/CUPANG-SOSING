import test from 'node:test';
import assert from 'node:assert/strict';
import {mobileIntakeHarness} from './helpers/mobile-intake.mjs';

const companies=[{companyCode:'A01464742',companyName:'와이홉'},{companyCode:'A01526306',companyName:'유앤채'}];
const json=async(response,status=200)=>{assert.equal(response.status,status,await response.clone().text());return response.json();};
const payload=(h,table)=>JSON.parse(h.sqlite.prepare('SELECT payload FROM '+table).get().payload);
const colors=new Map([['亮黑','유광 검정'],['砂黑','무광 검정'],['砂灰','무광 회색']]);
const sizes=new Map([['太阳镜','선글라스'],['太阳镜 加005 盒子','선글라스 + 005 케이스']]);

/** Actual handlers + recorded public supplier source in ephemeral SQLite.
 * Google, authentication and image storage are fixtures; no live records exist. */
async function fixture(company=companies[0],initialMode='failed'){
 let mode=initialMode,queries=[],executePosts=0;
 const texts=new Map();
 const h=mobileIntakeHarness({...company,translationFetcher:async(target,init)=>{
  const url=new URL(target),query=url.searchParams.get('q');queries.push(query);
  assert.equal(url.origin,'https://translate.googleapis.com');assert.equal(url.pathname,'/translate_a/single');
  assert.equal(url.searchParams.get('client'),'gtx');assert.equal(url.searchParams.get('sl'),'auto');assert.equal(url.searchParams.get('tl'),'ko');
  assert.equal(init.method,'GET');assert.equal(init.credentials,'omit');assert.equal(init.body,undefined);
  if(mode==='failed'||mode==='partial'&&query.startsWith('[[YFTR'))return new Response('fixture rate limit',{status:429});
  const translate=source=>{assert.ok(texts.has(source),'only recorded source values reach the free endpoint');return texts.get(source);};
  const translated=query.startsWith('[[YFTR')?query.split('\n').map(line=>{const match=/^(\[\[YFTR\d{6}\]\]) (.+)$/u.exec(line);assert.ok(match);return `${match[1]} ${translate(match[2])}`;}).reverse().join('\n'):translate(query);
  return Response.json([[[translated,query,null,null]],null,'zh-CN']);
 }});
 try{
  const profile=await h.load('db/category-profiles.ts').createCategoryProfile('owner',{name:'기록 원문 옵션 재시도',categoryId:'69900',
   categoryPath:['패션의류잡화','유니섹스/남녀공용 패션','공용 잡화','선글라스','남녀공용패션선글라스'],template:null,mappings:[]},'cat');
  h.context.category=profile;h.sqlite.prepare('UPDATE collection_context SET payload=? WHERE job_id=?').run(JSON.stringify(h.context),'job');
  await json(await h.route('/api/collection-jobs/job/collect',{method:'POST'}));
  const saved=await json(await h.route('/api/collection-jobs/job/product',{method:'POST'})),productId=saved.productId,path='/api/products/'+productId;
  const source=payload(h,'collection_results');texts.set(source.title,'원문 기준 선글라스');if(source.description)texts.set(source.description,'원문 기준 설명');
  for(const [value,text] of [...colors,...sizes])texts.set(value,text);
  for(const [color,textColor] of colors)for(const [size,textSize] of sizes)texts.set(`${color} / ${size}`,`${textColor} / ${textSize}`);
  h.bindings.SOURCEFLOW_TEXT_PROVIDER='google-free';delete h.bindings.AI;
  const prepared=await json(await h.route(path+'/translation',{method:'POST',body:{action:'prepare-collected',intake:true}}),201);
  await json(await h.route(path+'/translation',{method:'POST',body:{action:'approve',jobId:prepared.job.id,reviewFingerprint:prepared.job.review.fingerprint,confirmPaid:true}}));
  const initial=await json(await h.route(path+'/translation',{method:'POST',body:{action:'execute',jobId:prepared.job.id}}));
  assert.equal(initial.job.status,initialMode==='failed'?'failed':'completed');
  if(initialMode==='partial'){assert.equal(initial.job.result.googleStoppedHttpStatus,429);assert.equal(initial.job.result.draft.attributes.length,0);}
  const options=payload(h,'product_options');assert.equal(options.rows.length,6);
  // These are valid saved operator choices, including deliberate blanks. The
  // fixture never invents a translation proof from Chinese text alone.
  options.rows[1].translatedName='';options.rows[1].color='';options.rows[1].size='';
  for(const key of ['translatedName','color','size'])options.rows[1].provenance[key]='manual';
  options.rows[2].translatedName='직접 확인한 옵션';options.rows[2].color='직접 확인한 색';options.rows[2].size='';
  for(const key of ['translatedName','color','size'])options.rows[2].provenance[key]='manual';
  options.rows[2].unitCostCny=12;options.rows[2].provenance.unitCostCny='manual';options.rows[3].included=false;
  h.sqlite.prepare('UPDATE product_options SET payload=? WHERE product_id=?').run(JSON.stringify(options),productId);
  const content=payload(h,'product_content');
  await json(await h.route(path+'/content',{method:'PATCH',body:{expectedRevision:content.revision,
   patch:{seo:{title:'직접 검토한 기존 SEO',description:'',keywords:[]},label:{manufacturer:'직접 검토한 제조사'}}}}));
  mode='success';queries=[];
  const currentProduct=()=>h.sqlite.prepare('SELECT * FROM products WHERE id=?').get(productId);
  const immutable=()=>JSON.stringify({original:h.sqlite.prepare('SELECT * FROM translation_jobs WHERE id=?').get(initial.job.id),
   receipt:payload(h,'collection_results'),context:payload(h,'collection_context'),links:h.sqlite.prepare('SELECT * FROM collection_products').all(),
   objects:[...h.objects],status:currentProduct().supplier_hub_status});
  const post=(body)=>h.route(path+'/translation',{method:'POST',body});
  const fetcher=(target,init={})=>{const body=init.body?JSON.parse(init.body):undefined;if(body?.action==='execute')executePosts++;return h.route(String(target),{method:init.method??'GET',body});};
  return {h,path,productId,initial:initial.job,queries,texts,currentProduct,immutable,post,fetcher,
   get executePosts(){return executePosts;},setMode(value){mode=value;},prepare(retryKey=crypto.randomUUID(),expectedVersion=currentProduct().updated_at){return post({action:'prepare-options-retry',retryKey,expectedVersion});}};
 }catch(error){h.close();throw error;}
}

for(const company of companies)for(const initialMode of ['failed','partial'])test(`explicit free retry fills untouched included options after ${initialMode} 429, preserving original job and manual fields (${company.companyCode})`,async()=>{
 const f=await fixture(company,initialMode),{h}=f;
 try{
  const preserved=f.immutable(),before=payload(h,'product_options'),content=payload(h,'product_content'),product=f.currentProduct();
  // The ordinary automatic workflow reuses its terminal outcome and must not
  // start a retry or a 429 request storm merely because it was reopened.
  const ordinary=await h.load('app/intake-seo.ts').prepareIntakeSeoOutcome(f.productId,f.fetcher,new AbortController().signal);
  assert.equal(ordinary.manualReady,initialMode==='failed');assert.equal(ordinary.reviewRequired,initialMode==='partial');assert.equal(f.queries.length,0);
  const api=h.load('app/options-translation-retry.ts'),state=api.newOptionsRetryState(f.productId,product.updated_at),states=[];
  const outcome=await api.retryOptionsTranslation(state,{fetcher:f.fetcher,signal:new AbortController().signal,onState:value=>states.push(JSON.parse(JSON.stringify(value)))});
  assert.equal(outcome.done,true);assert.equal(outcome.saved,true);assert.equal(f.executePosts,1);assert.equal(outcome.job.review.optionsRetry.retryKey,state.retryKey);
  assert.equal(outcome.job.result.draft.title,'');assert.equal(outcome.job.result.draft.description,'');assert.deepEqual(outcome.job.result.draft.keywords,[]);
  const sent=f.queries.flatMap(query=>query.startsWith('[[YFTR')?query.split('\n').map(line=>{const match=/^(\[\[YFTR\d{6}\]\]) (.+)$/u.exec(line);assert.ok(match);return match[2];}):[query]);
  assert.deepEqual([...new Set(sent)].sort(),[...new Set(outcome.job.review.source.attributes.map(pair=>pair.value))].sort());
  assert.ok(!sent.includes(outcome.job.review.source.title));assert.ok(!outcome.job.review.source.description||!sent.includes(outcome.job.review.source.description));assert.equal(f.queries.length,1);
  assert.ok(states.every(value=>value.retryKey===state.retryKey));assert.equal(outcome.job.review.optionsRetry.scope,'options');
  assert.equal(outcome.job.review.source.attributes.length,9);assert.ok(outcome.job.review.source.attributes.every(pair=>before.rows.filter(row=>[0,4,5].includes(before.rows.indexOf(row))).some(row=>pair.name.endsWith(':'+row.id))));
  const after=payload(h,'product_options'),afterContent=payload(h,'product_content');
  for(const index of [0,4,5]){const row=after.rows[index];assert.equal(row.translatedName,f.texts.get(before.rows[index].originalName));assert.equal(row.color,colors.get(before.rows[index].color));assert.equal(row.size,sizes.get(before.rows[index].size));for(const key of ['translatedName','color','size'])assert.equal(row.provenance[key],'translated');}
  assert.deepEqual(after.rows.slice(1,4),before.rows.slice(1,4));
  for(const index of [0,4,5])for(const key of Object.keys(before.rows[index]).filter(key=>!['translatedName','color','size','provenance','updatedAt'].includes(key)))assert.deepEqual(after.rows[index][key],before.rows[index][key]);
  assert.deepEqual(afterContent.seo,content.seo);assert.deepEqual(afterContent.label,content.label);assert.deepEqual(afterContent.assets,content.assets);
  assert.equal(after.revision,before.revision+1);assert.equal(afterContent.revision,content.revision+1);assert.equal(f.immutable(),preserved);
  assert.equal(h.aiSources.length,0);assert.ok(!h.network.includes('supplier.coupang.com'));
  const calls=f.queries.length,executions=f.executePosts;
  const recovered=await api.retryOptionsTranslation(state,{fetcher:f.fetcher,signal:new AbortController().signal,onState:()=>{}});
  assert.equal(recovered.saved,true);assert.equal(f.queries.length,calls);assert.equal(f.executePosts,executions);
 }finally{h.close();}
});

test('nonce replay and lost execute/apply acknowledgements recover the same job and exact after-image without another execute or apply',async()=>{
 const f=await fixture(),{h}=f;
 try{
  const api=h.load('app/options-translation-retry.ts'),state=api.newOptionsRetryState(f.productId,f.currentProduct().updated_at),before=f.immutable();
  let dropExecute=true,dropApply=true,applyPosts=0;
  const fetcher=async(target,init={})=>{
   const body=init.body?JSON.parse(init.body):{};if(body.action==='apply')applyPosts++;
   const response=await f.fetcher(target,init);
   if(body.action==='execute'&&dropExecute){dropExecute=false;throw Error('fixture execute ACK lost after commit');}
   if(body.action==='apply'&&dropApply){dropApply=false;throw Error('fixture apply ACK lost after commit');}
   return response;
  };
  const first=await json(await f.prepare(state.retryKey),201),second=await json(await f.prepare(state.retryKey));
  assert.equal(first.job.id,second.job.id);assert.equal(second.replayed,true);assert.equal(f.queries.length,0);
  const outcome=await api.retryOptionsTranslation(state,{fetcher,signal:new AbortController().signal,onState:()=>{}});
  assert.equal(outcome.saved,true);assert.equal(f.executePosts,1);assert.equal(applyPosts,1);
  assert.equal(h.sqlite.prepare("SELECT count(*) AS n FROM translation_jobs WHERE idempotency_key LIKE 'options-retry-%'").get().n,1);assert.equal(f.immutable(),before);
  const requests=f.queries.length;
  await api.retryOptionsTranslation(JSON.parse(JSON.stringify(state)),{fetcher,signal:new AbortController().signal,onState:()=>{}});
  assert.equal(f.queries.length,requests);assert.equal(f.executePosts,1);assert.equal(applyPosts,1);
 }finally{h.close();}
});

test('a retry job can only apply options, and stale option/source clocks block approval before any free request',async()=>{
 const f=await fixture(),{h}=f;
 try{
  const prepared=await json(await f.prepare(),201),beforeContent=payload(h,'product_content');
  await json(await f.post({action:'approve',jobId:prepared.job.id,reviewFingerprint:prepared.job.review.fingerprint,confirmPaid:true}));
  const executed=await json(await f.post({action:'execute',jobId:prepared.job.id}));assert.equal(executed.job.status,'completed');
  await json(await h.route(f.path+'/translation-apply',{method:'POST',body:{action:'preview',scope:'all',jobId:prepared.job.id,expectedVersion:f.currentProduct().updated_at}}),409);
  assert.deepEqual(payload(h,'product_content'),beforeContent);
  const next=await json(await f.prepare(),201),requests=f.queries.length,options=payload(h,'product_options'),inputs=h.load('app/product-options.ts').optionInputs(options);
  inputs[0].translatedName='직접 검토하고 수정';
  await json(await h.route(f.path+'/options',{method:'PATCH',body:{expectedRevision:options.revision,expectedProductVersion:f.currentProduct().updated_at,rows:inputs}}));
  const edited=h.sqlite.prepare('SELECT payload FROM product_options').get().payload;
  await json(await f.post({action:'approve',jobId:next.job.id,reviewFingerprint:next.job.review.fingerprint,confirmPaid:true}),409);
  assert.equal(f.queries.length,requests);assert.equal(h.sqlite.prepare('SELECT payload FROM product_options').get().payload,edited);
 }finally{h.close();}
});

test('a prepared retry removed before approval is refused without changing job bytes, product clock or saved documents',async()=>{
 const f=await fixture(),{h}=f;
 try{
  const prepared=await json(await f.prepare(),201),beforeJob=JSON.stringify(h.sqlite.prepare('SELECT * FROM translation_jobs WHERE id=?').get(prepared.job.id)),
   product=JSON.stringify(f.currentProduct()),content=h.sqlite.prepare('SELECT payload FROM product_content').get().payload,
   options=h.sqlite.prepare('SELECT payload FROM product_options').get().payload;
  const removed=await h.load('db/product-removals.ts').removeProduct('owner',f.productId,f.currentProduct().updated_at);assert.ok(removed);
  await json(await f.post({action:'approve',jobId:prepared.job.id,reviewFingerprint:prepared.job.review.fingerprint,confirmPaid:true}),409);
  assert.equal(JSON.stringify(h.sqlite.prepare('SELECT * FROM translation_jobs WHERE id=?').get(prepared.job.id)),beforeJob);
  assert.equal(JSON.stringify(f.currentProduct()),product);assert.equal(h.sqlite.prepare('SELECT payload FROM product_content').get().payload,content);
  assert.equal(h.sqlite.prepare('SELECT payload FROM product_options').get().payload,options);assert.equal(f.queries.length,0);
 }finally{h.close();}
});

test('retry approval checks the exact option revision even if a competing writer has not advanced the product clock',async()=>{
 const f=await fixture(),{h}=f;
 try{
  const prepared=await json(await f.prepare(),201),beforeJob=JSON.stringify(h.sqlite.prepare('SELECT * FROM translation_jobs WHERE id=?').get(prepared.job.id)),clock=f.currentProduct().updated_at;
  h.sqlite.prepare('UPDATE product_options SET revision=revision+1 WHERE product_id=?').run(f.productId);
  await json(await f.post({action:'approve',jobId:prepared.job.id,reviewFingerprint:prepared.job.review.fingerprint,confirmPaid:true}),409);
  assert.equal(JSON.stringify(h.sqlite.prepare('SELECT * FROM translation_jobs WHERE id=?').get(prepared.job.id)),beforeJob);assert.equal(f.currentProduct().updated_at,clock);assert.equal(f.queries.length,0);
 }finally{h.close();}
});

for(const status of ['running','uncertain'])test(`running/uncertain owner-product evidence blocks a fresh explicit nonce (${status})`,async()=>{
 const f=await fixture(),{h}=f;
 try{
  h.sqlite.prepare('UPDATE translation_jobs SET status=? WHERE id=?').run(status,f.initial.id);
  const preserved=f.immutable();await json(await f.prepare(),409);assert.equal(f.queries.length,0);assert.equal(f.immutable(),preserved);
  assert.equal(h.sqlite.prepare("SELECT count(*) AS n FROM translation_jobs WHERE idempotency_key LIKE 'options-retry-%'").get().n,0);
 }finally{h.close();}
});

test('atomic retry insertion refuses an unsettled job arriving after the initial read, and claim refuses a later uncertain job',async()=>{
 const f=await fixture(),{h}=f;
 try{
  const store=h.load('db/translation-jobs.ts'),prepared=await json(await f.prepare(),201),retryKey=crypto.randomUUID(),originalPrepare=h.db.prepare;
  let injected=false;
  h.db.prepare=function(sql){const query=originalPrepare(sql);if(sql.startsWith('INSERT INTO translation_jobs')&&sql.includes('product_removals')){const execute=query.execute;query.execute=function(){if(!injected){injected=true;h.sqlite.prepare("UPDATE translation_jobs SET status='running' WHERE id=?").run(f.initial.id);}return execute();};}return query;};
  const created=await store.createOptionsRetryTranslation('owner',{...prepared.job,id:crypto.randomUUID()},retryKey,'c'.repeat(64),prepared.job.review.optionsRetry.optionRevision);assert.equal(created,null);assert.equal(injected,true);
  h.db.prepare=originalPrepare;h.sqlite.prepare("UPDATE translation_jobs SET status='failed' WHERE id=?").run(f.initial.id);
  await json(await f.post({action:'approve',jobId:prepared.job.id,reviewFingerprint:prepared.job.review.fingerprint,confirmPaid:true}));
  h.sqlite.prepare("UPDATE translation_jobs SET status='uncertain' WHERE id=?").run(f.initial.id);
  await json(await f.post({action:'execute',jobId:prepared.job.id}),409);assert.equal(f.queries.length,0);
  assert.equal(h.sqlite.prepare('SELECT status FROM translation_jobs WHERE id=?').get(prepared.job.id).status,'approved');
 }finally{h.close();}
});

test('exact nonce lookup survives latest-20 history and remains owner scoped; an unrelated edit cannot be acknowledged as the saved retry',async()=>{
 const f=await fixture(),{h}=f;
 try{
  const api=h.load('app/options-translation-retry.ts'),state=api.newOptionsRetryState(f.productId,f.currentProduct().updated_at);
  await api.retryOptionsTranslation(state,{fetcher:f.fetcher,signal:new AbortController().signal,onState:()=>{}});
  const row=h.sqlite.prepare('SELECT * FROM translation_jobs WHERE id=?').get(state.jobId);
  for(let i=0;i<25;i++)h.sqlite.prepare(`INSERT INTO translation_jobs SELECT ?,owner_id,product_id,?,request_fingerprint,product_version,content_revision,status,review_fingerprint,review,expires_at,result,error,claim_token,?,approved_at,started_at,finished_at FROM translation_jobs WHERE id=?`)
   .run(crypto.randomUUID(),'other-history-'+i,new Date(Date.parse(row.created_at)+60000+i).toISOString(),state.jobId);
  assert.ok(!(await storeHistory(h,f.productId)).some(job=>job.id===state.jobId));
  const found=await json(await h.route(f.path+'/translation?retryKey='+state.retryKey));assert.equal(found.job.id,state.jobId);
  const foreign=crypto.randomUUID();h.sqlite.prepare(`INSERT INTO translation_jobs SELECT ?,'foreign-owner',product_id,?,request_fingerprint,product_version,content_revision,status,review_fingerprint,review,expires_at,result,error,claim_token,created_at,approved_at,started_at,finished_at FROM translation_jobs WHERE id=?`)
   .run(crypto.randomUUID(),'options-retry-'+foreign,state.jobId);
  assert.equal((await json(await h.route(f.path+'/translation?retryKey='+foreign))).job,null);
  const content=payload(h,'product_content');await json(await h.route(f.path+'/content',{method:'PATCH',body:{expectedRevision:content.revision,patch:{label:{manufacturer:'이후 확인한 제조사'}}}}));
  const before=f.queries.length,executions=f.executePosts;
  await assert.rejects(api.retryOptionsTranslation(state,{fetcher:f.fetcher,signal:new AbortController().signal,onState:()=>{}}),/저장 응답이 불확실|자료가 변경/);
  assert.equal(f.queries.length,before);assert.equal(f.executePosts,executions);assert.equal(payload(h,'product_content').label.manufacturer.value,'이후 확인한 제조사');
 }finally{h.close();}
});
async function storeHistory(h,id){return h.load('db/translation-jobs.ts').listTranslationJobs('owner',id);}

test('removal arriving between retry preview and atomic apply preserves every document and the product clock',async()=>{
 const f=await fixture(),{h}=f;
 try{
  const prepared=await json(await f.prepare(),201);await json(await f.post({action:'approve',jobId:prepared.job.id,reviewFingerprint:prepared.job.review.fingerprint,confirmPaid:true}));
  await json(await f.post({action:'execute',jobId:prepared.job.id}));
  const body={scope:'options',jobId:prepared.job.id,expectedVersion:f.currentProduct().updated_at};
  const preview=await json(await h.route(f.path+'/translation-apply',{method:'POST',body:{...body,action:'preview'}}));
  const product=JSON.stringify(f.currentProduct()),content=h.sqlite.prepare('SELECT payload FROM product_content').get().payload,
   options=h.sqlite.prepare('SELECT payload FROM product_options').get().payload,immutable=f.immutable(),originalPrepare=h.db.prepare;
  let injected=false;
  h.db.prepare=function(sql){const query=originalPrepare(sql);if(sql.startsWith('UPDATE products SET updated_at=?')&&sql.includes('translation_jobs')){const execute=query.execute;query.execute=function(){if(!injected){injected=true;h.sqlite.prepare('INSERT INTO product_removals VALUES(?,?,?,?)').run(f.productId,'owner',new Date().toISOString(),body.expectedVersion);}return execute();};}return query;};
  await json(await h.route(f.path+'/translation-apply',{method:'POST',body:{...body,action:'apply',fingerprint:preview.fingerprint}}),409);
  assert.equal(injected,true);assert.equal(JSON.stringify(f.currentProduct()),product);assert.equal(h.sqlite.prepare('SELECT payload FROM product_content').get().payload,content);
  assert.equal(h.sqlite.prepare('SELECT payload FROM product_options').get().payload,options);assert.equal(f.immutable(),immutable);
 }finally{h.close();}
});

test('partial explicit 429 applies only acknowledged fields once and does not queue an automatic second batch',async()=>{
 const f=await fixture(),{h}=f;
 try{
  f.setMode('partial');const api=h.load('app/options-translation-retry.ts'),state=api.newOptionsRetryState(f.productId,f.currentProduct().updated_at),before=payload(h,'product_options'),immutable=f.immutable();
  const outcome=await api.retryOptionsTranslation(state,{fetcher:f.fetcher,signal:new AbortController().signal,onState:()=>{}});
  assert.equal(outcome.done,true);assert.equal(outcome.saved,false);assert.equal(outcome.job.status,'completed');assert.equal(outcome.job.result.googleStoppedHttpStatus,429);
  assert.equal(f.executePosts,1);assert.deepEqual(payload(h,'product_options'),before);assert.equal(f.immutable(),immutable);
  assert.equal(h.sqlite.prepare("SELECT count(*) AS n FROM translation_jobs WHERE idempotency_key LIKE 'options-retry-%'").get().n,1);
 }finally{h.close();}
});

test('an acknowledged option-only partial result cannot replace existing SEO status, evidence or fingerprint',async()=>{
 const f=await fixture(),{h}=f;
 try{
  f.setMode('partial');const prepared=await json(await f.prepare(),201);
  await json(await f.post({action:'approve',jobId:prepared.job.id,reviewFingerprint:prepared.job.review.fingerprint,confirmPaid:true}));
  const executed=await json(await f.post({action:'execute',jobId:prepared.job.id}));assert.equal(executed.job.result.googleStoppedHttpStatus,429);
  const model=h.load('app/automation/model.ts'),product=f.currentProduct(),content=payload(h,'product_content'),options=payload(h,'product_options'),preserved=JSON.stringify({product,content,options}),now=new Date().toISOString();
  const baseline=await model.planAutomation(product,h.settings,null,content,null,now,options),retry=await model.planAutomation(product,h.settings,null,content,executed.job,now,options);
  const seo=retry.stages.find(stage=>stage.id==='seo');
  assert.deepEqual(JSON.parse(JSON.stringify(seo)),JSON.parse(JSON.stringify(baseline.stages.find(stage=>stage.id==='seo'))));assert.equal(retry.inputFingerprint,baseline.inputFingerprint);
  assert.ok(seo.evidence.every(item=>item.kind!=='providerReceipt'));assert.ok(seo.artifacts.every(item=>item.id!==executed.job.id));
  // Normal completed SEO jobs retain the established draft/evidence behavior.
  const review={...executed.job.review};delete review.optionsRetry;
  const normal={...executed.job,review,result:{...executed.job.result,draft:{...executed.job.result.draft,title:'별도 검토할 한국어 SEO'}}};
  const standard=await model.planAutomation(product,h.settings,null,content,normal,now,options),standardSeo=standard.stages.find(stage=>stage.id==='seo');
  assert.equal(standardSeo.reason.code,'TRANSLATION_DRAFT_NOT_APPLIED');assert.ok(standardSeo.evidence.some(item=>item.kind==='providerReceipt'));
  assert.notEqual(standard.inputFingerprint,baseline.inputFingerprint);assert.equal(JSON.stringify({product,content,options}),preserved);
 }finally{h.close();}
});
