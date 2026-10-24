import test from 'node:test';
import assert from 'node:assert/strict';
import {mobileIntakeHarness} from './helpers/mobile-intake.mjs';
const model='@cf/meta/m2m100-1.2b',strategy='m2m-text-v1',title='硅胶后跟贴',translations=new Map([[title,'실리콘 뒤꿈치 보호 패드'],['米色','베이지'],['粉色','분홍'],['黑色','검정']]);
const companies=[{code:'A01526306',name:'유앤채'},{code:'A01464742',name:'와이홉'}];
const json=async(response,status=200)=>{assert.equal(response.status,status,await response.clone().text());return response.json();};
const source={title,description:'',attributes:['米色','粉色','黑色'].map((value,index)=>({name:'option:collected-'+index,value})),provenance:'manual',reference:'synthetic-m2m'};
test('direct text plan translates title first and source-bound options without markers or prompts',async()=>{
 const h=mobileIntakeHarness();try{const api=h.load('app/automation/workers-m2m-translation.ts'),plan=api.planWorkersM2mTranslation(source),calls=[];assert.deepEqual(Array.from(plan.requests),[title,'米色','粉色','黑色']);
  const result=await api.executeWorkersM2mTranslation(source,{run:async(got,input)=>{assert.equal(got,model);assert.deepEqual(Object.keys(input).sort(),['source_lang','target_lang','text']);assert.equal(input.source_lang,'zh');assert.equal(input.target_lang,'ko');assert.doesNotMatch(input.text,/collected|option:|synthetic/);calls.push(input.text);return{translated_text:translations.get(input.text)};}},4);
  assert.equal(result.requests,4);assert.equal(result.draft.title,translations.get(title));assert.deepEqual(Array.from(result.draft.attributes,row=>[row.sourceIndex,row.name,row.value]),[[0,'옵션명','베이지'],[1,'옵션명','분홍'],[2,'옵션명','검정']]);assert.deepEqual(calls,[title,'米色','粉色','黑色']);
 }finally{h.close();}
});
test('plan deduplicates identical text, bounds calls and leaves unhandled originals with explicit warnings',async()=>{
 const h=mobileIntakeHarness();try{const api=h.load('app/automation/workers-m2m-translation.ts'),many={...source,description:'长'.repeat(1001),attributes:Array.from({length:12},(_,index)=>({name:'option:collected-'+index,value:index<2?'米色':'合成色'+index}))},plan=api.planWorkersM2mTranslation(many);assert.equal(plan.requests.length,8);assert.equal(plan.missingAttributeIndexes.length,4);assert.equal(plan.descriptionOmitted,true);
  const result=await api.executeWorkersM2mTranslation(many,{run:async(_model,input)=>({translated_text:input.text===title?translations.get(title):input.text==='米色'?'베이지':'합성색 '+input.text.match(/\d+/)[0]})},8);assert.equal(result.draft.attributes.length,8);assert.equal(result.draft.attributes[0].value,result.draft.attributes[1].value);assert.equal(result.draft.description,'');assert.ok(result.draft.warnings.some(value=>/원문에 보존/.test(value)));assert.equal(many.attributes.length,12);
 }finally{h.close();}
});
for(const kind of ['han','english','foreign-number','unsupported-claim','async','chat','missing-text','oversize'])test('invalid essential M2M result stops after the title without another call: '+kind,async()=>{
 const h=mobileIntakeHarness();try{const api=h.load('app/automation/workers-m2m-translation.ts');let calls=0;
  const response=kind==='async'?{request_id:'synthetic'}:kind==='chat'?{choices:[]}:kind==='missing-text'?{}:{translated_text:kind==='han'?'실리콘 色':kind==='english'?'silicone heel pad':kind==='foreign-number'?'실리콘 패드 999':kind==='unsupported-claim'?'방수 실리콘 패드':kind==='oversize'?'한'.repeat(501):translations.get(title)};
  await assert.rejects(()=>api.executeWorkersM2mTranslation(source,{run:async()=>{calls++;return response;}},4));assert.equal(calls,1);
 }finally{h.close();}
});
async function fixture(company=companies[0],seoMemo=false){
 const h=mobileIntakeHarness({companyCode:company.code,companyName:company.name,translationFetcher:async()=>new Response('synthetic rate limit',{status:429})});try{
  h.bindings.SOURCEFLOW_TEXT_PROVIDER='google-free';h.bindings.SOURCEFLOW_QUOTATION_AI_PROVIDER='workers-ai';h.bindings.SOURCEFLOW_QUOTATION_AI_FREE_ONLY='true';
  await json(await h.route('/api/collection-jobs/job/result',{method:'POST',body:{schemaVersion:1,sourceUrl:h.sourceUrl,provider:'synthetic-m2m-page-v1',collectedAt:new Date().toISOString(),title,description:'',attributes:[],images:[],options:['米色','粉色','黑色'].map((name,index)=>({sku:'synthetic-'+index,name,unitPriceCny:0.28,minimumOrder:1,stock:100}))}}));
  const {productId:id}=await json(await h.route('/api/collection-jobs/job/product',{method:'POST'})),base='/api/products/'+id,post=body=>h.route(base+'/translation',{method:'POST',body});
  let prepareBody={action:'prepare-collected',intake:true};
  if(seoMemo){
   const receipt=JSON.parse(h.sqlite.prepare('SELECT payload FROM collection_results').get().payload),collection=await h.load('db/collection-jobs.ts').findCollectionJob('owner','job');
   const options=(await json(await h.route(base+'/options'))).options,content=(await json(await h.route(base+'/content'))).content;
   const source=h.load('app/collected-seo-source.ts').collectedSeoSource(receipt,collection,options).source;
   const state=h.load('app/seo-workspace-draft.ts').createSeoWorkspaceDraftState({productId:id,productVersion:h.sqlite.prepare('SELECT updated_at FROM products WHERE id=?').get(id).updated_at,contentRevision:content.revision,source,
    memo:{brand:company.name,features:'검토용 참고 메모',keywords:'뒤꿈치 패드'},configuration:h.load('app/automation/translation.ts').translationConfiguration(h.bindings)});
   prepareBody={action:'prepare',source:state.source,expectedVersion:state.productVersion,idempotencyKey:state.idempotencyKey};
  }
  const {job}=await json(await post(prepareBody),201);await json(await post({action:'approve',jobId:job.id,reviewFingerprint:job.review.fingerprint,confirmPaid:true}));const failed=(await json(await post({action:'execute',jobId:job.id}))).job;assert.equal(failed.status,'failed');assert.match(failed.error.message,/429/);
  const content=JSON.parse(h.sqlite.prepare('SELECT payload FROM product_content WHERE product_id=?').get(id).payload);await json(await h.route(base+'/content',{method:'PATCH',body:{expectedRevision:content.revision,patch:{seo:{keywords:['직접 검색어']},label:{manufacturer:'직접 제조사'}}}}));
  const calls=[],version=()=>h.sqlite.prepare('SELECT updated_at FROM products WHERE id=?').get(id).updated_at;
  h.bindings.AI.run=async(got,input)=>{assert.equal(got,model);assert.deepEqual(Object.keys(input).sort(),['source_lang','target_lang','text']);assert.equal(input.source_lang,'zh');assert.equal(input.target_lang,'ko');calls.push(input.text);return{translated_text:translations.get(input.text)};};
  const prepare=extra=>post({action:'prepare-collected-m2m',expectedVersion:version(),failedJobId:failed.id,idempotencyKey:crypto.randomUUID(),...extra});
  const approve=job=>post({action:'approve',jobId:job.id,reviewFingerprint:job.review.fingerprint,confirmPaid:true}),execute=job=>post({action:'execute',jobId:job.id});
  const unchanged=()=>JSON.stringify({product:h.sqlite.prepare('SELECT * FROM products WHERE id=?').get(id),content:h.sqlite.prepare('SELECT * FROM product_content WHERE product_id=?').get(id),options:h.sqlite.prepare('SELECT * FROM product_options WHERE product_id=?').get(id),raw:h.sqlite.prepare('SELECT * FROM collection_results').all(),context:h.sqlite.prepare('SELECT * FROM collection_context').all(),google:h.sqlite.prepare('SELECT * FROM translation_jobs WHERE id=?').get(failed.id)});
  return{h,id,base,post,failed,calls,version,prepare,approve,execute,unchanged};
 }catch(error){h.close();throw error;}
}
for(const company of companies)test(company.code+': SEO brand guidance cannot block source-bound M2M recovery or become supplier evidence',async()=>{
 const f=await fixture(company,true),{h}=f;try{
  const googleBefore=h.sqlite.prepare('SELECT * FROM translation_jobs WHERE id=?').get(f.failed.id),before=f.unchanged();
  assert.match(f.failed.review.source.guidance.features,/사용자가 입력한 브랜드 참고/);
  const {job}=await json(await f.prepare(),201);assert.doesNotMatch(job.review.source.guidance?.features??'',/검토용 참고 메모|사용자가 입력한 브랜드 참고/);
  await json(await f.approve(job));const completed=(await json(await f.execute(job))).job;assert.equal(completed.status,'completed');assert.deepEqual(f.calls,[title,'米色','粉色','黑色']);
  assert.equal(f.unchanged(),before);assert.deepEqual(h.sqlite.prepare('SELECT * FROM translation_jobs WHERE id=?').get(f.failed.id),googleBefore);
  const body={jobId:job.id,expectedVersion:f.version()},preview=await json(await h.route(f.base+'/translation-apply',{method:'POST',body:{...body,action:'preview'}}));
  await json(await h.route(f.base+'/translation-apply',{method:'POST',body:{...body,action:'apply',fingerprint:preview.fingerprint}}));
  const options=JSON.parse(h.sqlite.prepare('SELECT payload FROM product_options WHERE product_id=?').get(f.id).payload);assert.deepEqual(options.rows.map(row=>row.translatedName),['베이지','분홍','검정']);
  assert.deepEqual(h.sqlite.prepare('SELECT * FROM translation_jobs WHERE id=?').get(f.failed.id),googleBefore);
 }finally{h.close();}
});
for(const company of companies)test(company.code+': explicit M2M review calls four unique source texts once; preserved Google/manual history and selective apply',async()=>{
 const f=await fixture(company),{h}=f;try{const before=f.unchanged(),view=await json(await h.route(f.base+'/translation'));assert.equal(view.workersRecovery.model,model);assert.equal(view.workersRecovery.strategy,strategy);assert.equal(view.workersRecovery.maxCalls,8);assert.equal(view.configuration.model,'google-translate-gtx');
  const {job}=await json(await f.prepare(),201);assert.equal(job.review.workersRecovery.strategy,strategy);assert.equal(job.review.workersRecovery.maxCalls,4);assert.equal(job.review.workersRecovery.version,undefined);assert.equal(job.review.model,model);assert.equal(job.review.maxOutputTokens,0);assert.match(job.review.paidNotice,/최대 4회/);assert.equal(h.sqlite.prepare('SELECT idempotency_key FROM translation_jobs WHERE id=?').get(job.id).idempotency_key,'workers-m2m-v1-'+f.failed.id);assert.equal(f.calls.length,0);assert.equal(f.unchanged(),before);
  assert.equal((await json(await f.execute(job),409)).code,'PAID_APPROVAL_REQUIRED');await json(await f.approve(job));const completed=(await json(await f.execute(job))).job;assert.equal(completed.status,'completed');assert.equal(completed.result.model,model);assert.equal(completed.result.translationRequests,4);assert.deepEqual(f.calls,[title,'米色','粉色','黑色']);assert.equal(h.sqlite.prepare('SELECT requests FROM quotation_ai_daily').get().requests,4);assert.equal(f.unchanged(),before);
  await json(await f.execute(job));assert.equal((await json(await f.prepare())).job.id,job.id);assert.equal(f.calls.length,4);
  const body={jobId:job.id,expectedVersion:f.version()},preview=await json(await h.route(f.base+'/translation-apply',{method:'POST',body:{...body,action:'preview'}}));await json(await h.route(f.base+'/translation-apply',{method:'POST',body:{...body,action:'apply',fingerprint:preview.fingerprint}}));
  const saved=JSON.parse(h.sqlite.prepare('SELECT payload FROM product_content WHERE product_id=?').get(f.id).payload),options=JSON.parse(h.sqlite.prepare('SELECT payload FROM product_options WHERE product_id=?').get(f.id).payload);assert.equal(saved.seo.title.value,'검토 브랜드 '+translations.get(title));assert.deepEqual(saved.seo.keywords.value,['직접 검색어']);assert.equal(saved.label.manufacturer.value,'직접 제조사');assert.deepEqual(options.rows.map(row=>row.translatedName),['베이지','분홍','검정']);assert.equal(h.sqlite.prepare('SELECT status FROM translation_jobs WHERE id=?').get(f.failed.id).status,'failed');assert.equal(h.bindings.SOURCEFLOW_TEXT_PROVIDER,'google-free');assert.ok(!h.network.includes('api.openai.com'));assert.ok(!h.network.includes('supplier.coupang.com'));
 }finally{h.close();}
});
for(const change of ['company','suspended','source','content','options','quota'])test('before each M2M call, changed '+change+' stops further sends without applying results',async()=>{
 const f=await fixture(),{h}=f;try{const {job}=await json(await f.prepare(),201);await json(await f.approve(job));const original=h.bindings.AI.run;
  h.bindings.AI.run=async(model,input)=>{const value=await original(model,input);if(f.calls.length===1){if(change==='company')h.setCompany(companies[1]);if(change==='suspended')h.setMembershipStatus('suspended');if(change==='source')h.sqlite.prepare("UPDATE collection_results SET payload=json_set(payload,'$.title','原文变更') WHERE job_id='job'").run();if(change==='content')h.sqlite.prepare('UPDATE product_content SET revision=revision+1 WHERE product_id=?').run(f.id);if(change==='options')h.sqlite.prepare('UPDATE product_options SET revision=revision+1 WHERE product_id=?').run(f.id);if(change==='quota')h.sqlite.prepare('UPDATE quotation_ai_daily SET requests=40').run();}return value;};
  const result=(await json(await f.execute(job))).job;assert.equal(result.status,'failed');assert.equal(result.result,null);assert.equal(f.calls.length,1);assert.equal(result.error.code,change==='quota'?'WORKERS_RECOVERY_LIMIT':'WORKERS_RECOVERY_SOURCE_CHANGED');await f.execute(job);assert.equal(f.calls.length,1);assert.equal(h.bindings.SOURCEFLOW_TEXT_PROVIDER,'google-free');
 }finally{h.close();}
});
test('a bad M2M title is a terminal single call, and a different nonce cannot launch another strategy attempt',async()=>{
 const f=await fixture(),{h}=f;try{const before=f.unchanged(),{job}=await json(await f.prepare(),201);await json(await f.approve(job));h.bindings.AI.run=async()=>{f.calls.push(title);return{translated_text:'실리콘 色'};};const failed=(await json(await f.execute(job))).job;assert.equal(failed.status,'failed');assert.equal(failed.error.code,'RECOVERY_UNTRANSLATED_TEXT');assert.match(failed.error.message,/title/);assert.equal(f.calls.length,1);assert.equal(f.unchanged(),before);await json(await f.execute(job));assert.equal((await json(await f.prepare())).job.id,job.id);assert.equal(f.calls.length,1);
 }finally{h.close();}
});
for(const mode of ['transport','deadline'])test('uncertain M2M '+mode+' stops the field sequence and cannot be replayed into another provider call',async()=>{
 const f=await fixture(),{h}=f,clock=Date.now;try{const {job}=await json(await f.prepare(),201);await json(await f.approve(job));const original=h.bindings.AI.run;
  h.bindings.AI.run=async(model,input)=>{if(mode==='transport'){f.calls.push(input.text);throw Error('PRIVATE_UPSTREAM_BODY');}const result=await original(model,input);Date.now=()=>clock()+60000;return result;};
  const result=(await json(await f.execute(job))).job;Date.now=clock;assert.equal(result.status,'uncertain');assert.equal(result.error.code,'PROVIDER_OUTCOME_UNCERTAIN');assert.equal(result.result,null);assert.equal(f.calls.length,1);assert.equal(JSON.stringify(result.error).includes('PRIVATE_'),false);await json(await f.execute(job));assert.equal((await json(await f.prepare())).job.id,job.id);assert.equal(f.calls.length,1);
 }finally{Date.now=clock;h.close();}
});
test('M2M exact call proof, expiry renewal and free revocation remain reviewed before any send',async()=>{
 const f=await fixture(),{h}=f;try{let {job}=await json(await f.prepare(),201);const expired=structuredClone(job.review);expired.expiresAt='2000-01-01T00:00:00.000Z';h.sqlite.prepare('UPDATE translation_jobs SET expires_at=?,review=? WHERE id=?').run(expired.expiresAt,JSON.stringify(expired),job.id);const renewed=await json(await f.prepare());assert.equal(renewed.job.id,job.id);assert.notEqual(renewed.job.review.fingerprint,job.review.fingerprint);job=renewed.job;
  const corrupt=structuredClone(job.review);corrupt.workersRecovery.maxCalls=3;h.sqlite.prepare('UPDATE translation_jobs SET review=? WHERE id=?').run(JSON.stringify(corrupt),job.id);await json(await f.approve(job),400);assert.equal(f.calls.length,0);h.sqlite.prepare('UPDATE translation_jobs SET review=? WHERE id=?').run(JSON.stringify(job.review),job.id);
  h.bindings.SOURCEFLOW_QUOTATION_AI_FREE_ONLY='false';await json(await f.approve(job),503);assert.equal(f.calls.length,0);
 }finally{h.close();}
});
test('a separately stored M2M review never resets or relabels any failed Qwen contract',async()=>{
 for(const version of [2,3,4,5]){const f=await fixture(),{h}=f;try{const {job:legacy}=await json(await f.post({action:'prepare-collected-workers',expectedVersion:f.version(),failedJobId:f.failed.id,idempotencyKey:crypto.randomUUID()}),201),review=structuredClone(legacy.review);review.workersRecovery.version=version;h.sqlite.prepare("UPDATE translation_jobs SET status='failed',review=?,error=?,started_at=?,finished_at=? WHERE id=?").run(JSON.stringify(review),JSON.stringify({code:'RECOVERY_UNTRANSLATED_TEXT',message:'synthetic archived title',mayHaveBeenCharged:true}),new Date().toISOString(),new Date().toISOString(),legacy.id);const before=h.sqlite.prepare('SELECT * FROM translation_jobs WHERE id=?').get(legacy.id);
  const {job}=await json(await f.prepare(),201);assert.notEqual(job.id,legacy.id);assert.equal(job.review.workersRecovery.strategy,strategy);assert.equal(job.review.workersRecovery.version,undefined);assert.deepEqual(h.sqlite.prepare('SELECT * FROM translation_jobs WHERE id=?').get(legacy.id),before);assert.equal(f.calls.length,0);
 }finally{h.close();}}
});
