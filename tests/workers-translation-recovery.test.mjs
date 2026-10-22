import test from 'node:test';
import assert from 'node:assert/strict';
import {mobileIntakeHarness} from './helpers/mobile-intake.mjs';

const json=async(response,status=200)=>{assert.equal(response.status,status,await response.clone().text());return response.json();};
const payload=(h,table)=>JSON.parse(h.sqlite.prepare('SELECT payload FROM '+table).get().payload);
const companies=[{code:'A01464742',name:'와이홉'},{code:'A01526306',name:'유앤채'}];
function nativeMember(h,company=companies[0]){
 h.sqlite.exec(h.load('db/member-schema.ts').memberSchema0);
 h.sqlite.prepare('INSERT INTO members(id,email,password_hash,role,status,company_code,company_name,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)')
  .run('owner',company.code==='A01464742'?'unari8484@gmail.com':'jwhj1116@kakao.com','synthetic-unused-hash',company.code==='A01464742'?'member':'admin','approved',company.code,company.name,new Date().toISOString(),new Date().toISOString());
 h.bindings.YOOFAM_AUTH_ENABLED='true';
}
async function fixture(company=companies[0]){
 const h=mobileIntakeHarness({companyCode:company.code,companyName:company.name,translationFetcher:async()=>new Response('synthetic rate limit',{status:429})});
 try{
  h.bindings.SOURCEFLOW_TEXT_PROVIDER='google-free';
  h.bindings.SOURCEFLOW_QUOTATION_AI_PROVIDER='workers-ai';h.bindings.SOURCEFLOW_QUOTATION_AI_FREE_ONLY='true';
  const originalAi=h.bindings.AI.run;
  h.bindings.AI.run=async(model,input)=>{
   assert.equal(model,'@cf/qwen/qwen3-30b-a3b-fp8');assert.equal(input.temperature,0);assert.equal(input.stream,false);
   assert.equal(input.response_format.type,'json_schema');assert.ok(input.messages[1].content.endsWith('\n/no_think'));
   const normalized={...input,messages:[input.messages[0],{...input.messages[1],content:input.messages[1].content.slice(0,-'\n/no_think'.length)}]};
   const result=await originalAi('@cf/meta/llama-3.3-70b-instruct-fp8-fast',normalized);
   return{object:'chat.completion',model,choices:[{index:0,finish_reason:'stop',message:{role:'assistant',content:JSON.stringify(result.response)}}]};
  };
  await json(await h.route('/api/collection-jobs/job/collect',{method:'POST'}));
  const {productId:id}=await json(await h.route('/api/collection-jobs/job/product',{method:'POST'})),base='/api/products/'+id;
  const post=body=>h.route(base+'/translation',{method:'POST',body});
  const {job}=await json(await post({action:'prepare-collected',intake:true}),201);
  await json(await post({action:'approve',jobId:job.id,reviewFingerprint:job.review.fingerprint,confirmPaid:true}));
  const failed=(await json(await post({action:'execute',jobId:job.id}))).job;
  assert.equal(failed.status,'failed');assert.match(failed.error.message,/HTTP 429/);
  const content=payload(h,'product_content');
  await json(await h.route(base+'/content',{method:'PATCH',body:{expectedRevision:content.revision,patch:{seo:{keywords:['직접 검색어'],description:''},label:{manufacturer:'직접 제조사'}}}}));
  const version=()=>h.sqlite.prepare('SELECT updated_at FROM products WHERE id=?').get(id).updated_at;
  const prepare=(extra={})=>post({action:'prepare-collected-workers',expectedVersion:version(),idempotencyKey:crypto.randomUUID(),failedJobId:failed.id,...extra});
  const approved=recovery=>post({action:'approve',jobId:recovery.id,reviewFingerprint:recovery.review.fingerprint,confirmPaid:true});
  const execute=recovery=>post({action:'execute',jobId:recovery.id});
  const original=()=>h.sqlite.prepare('SELECT * FROM translation_jobs WHERE id=?').get(failed.id);
  const unchanged=()=>JSON.stringify({product:h.sqlite.prepare('SELECT * FROM products WHERE id=?').get(id),content:payload(h,'product_content'),options:payload(h,'product_options'),
   context:payload(h,'collection_context'),receipt:payload(h,'collection_results'),original:original(),objects:[...h.objects]});
  return{h,id,base,post,failed,version,prepare,approved,execute,original,unchanged};
 }catch(error){h.close();throw error;}
}

for(const company of companies)test(`explicit Workers recovery preserves Google history/default and manual edits, runs once and selectively applies (${company.code})`,async()=>{
 const f=await fixture(company),{h}=f;
 try{
  const before=f.unchanged(),view=await json(await h.route(f.base+'/translation'));
  assert.equal(view.configuration.model,'google-translate-gtx');assert.equal(view.workersRecovery.configured,true);
  assert.equal(view.workersRecovery.version,5);assert.equal(view.workersRecovery.model,'@cf/qwen/qwen3-30b-a3b-fp8');
  assert.equal(view.workersRecovery.maxOutputTokens,2048);assert.equal(h.aiSources.length,0);
  const prepared=await json(await f.prepare(),201),job=prepared.job;
  assert.equal(prepared.configuration.model,'google-translate-gtx');assert.equal(prepared.workersRecoveryReview,true);
  assert.equal(job.review.destination,'Cloudflare Workers AI');assert.equal(job.review.maxOutputTokens,2048);
  assert.equal(job.review.workersRecovery.version,5);assert.equal(job.review.workersRecovery.model,'@cf/qwen/qwen3-30b-a3b-fp8');
  assert.equal(job.review.workersRecovery.failedJobId,f.failed.id);assert.deepEqual(job.review.workersRecovery.company,company);
  assert.equal(job.review.source.title,f.failed.review.source.title);assert.ok(job.review.source.attributes.some(pair=>pair.name.startsWith('option:')));
  assert.equal(f.unchanged(),before);assert.equal(h.aiSources.length,0);
  assert.equal((await json(await f.prepare())).job.id,job.id,'a new nonce cannot create a second fallback for the same failed request');
  await json(await f.approved(job));const completed=(await json(await f.execute(job))).job;
  assert.equal(completed.status,'completed');assert.equal(h.aiSources.length,1);assert.equal(f.unchanged(),before);
  assert.equal(h.sqlite.prepare('SELECT requests FROM quotation_ai_daily').get().requests,1);
  assert.equal((await json(await f.execute(job))).job.id,job.id);assert.equal(h.aiSources.length,1);
  assert.equal((await json(await f.prepare())).job.id,job.id);assert.equal(h.aiSources.length,1);
  const initial=await json(await f.post({action:'prepare-collected',intake:true}));assert.equal(initial.job.id,f.failed.id);
  const content=payload(h,'product_content'),options=payload(h,'product_options'),body={jobId:job.id,expectedVersion:f.version()};
  const preview=await json(await h.route(f.base+'/translation-apply',{method:'POST',body:{...body,action:'preview'}}));
  assert.ok(preview.preview.some(row=>row.name==='상품명'));assert.ok(!preview.preview.some(row=>row.name==='검색어'||row.name==='상품 설명'));
  await json(await h.route(f.base+'/translation-apply',{method:'POST',body:{...body,action:'apply',fingerprint:preview.fingerprint}}));
  const saved=payload(h,'product_content'),savedOptions=payload(h,'product_options');
  assert.equal(saved.seo.title.value,'검토 브랜드 우드 패턴 다리 선글라스');assert.deepEqual(saved.seo.description,content.seo.description);
  assert.deepEqual(saved.seo.keywords,content.seo.keywords);assert.deepEqual(saved.label.manufacturer,content.label.manufacturer);
  for(const [index,row]of savedOptions.rows.entries())for(const key of ['id','supplierSku','unitCostCny','minimumOrderQuantity','stock','unitsPerPack','imageKey'])assert.deepEqual(row[key],options.rows[index][key]);
  assert.equal(f.original().status,'failed');assert.equal(h.bindings.SOURCEFLOW_TEXT_PROVIDER,'google-free');
  assert.ok(!h.network.includes('api.openai.com'));assert.ok(!h.network.includes('supplier.coupang.com'));
 }finally{h.close();}
});

for(const setting of ['free-unconfirmed','wrong-provider','missing-binding'])test(`recovery fails closed before creating jobs (${setting})`,async()=>{
 const f=await fixture(),{h}=f;
 try{
  if(setting==='free-unconfirmed')h.bindings.SOURCEFLOW_QUOTATION_AI_FREE_ONLY='false';
  if(setting==='wrong-provider')h.bindings.SOURCEFLOW_QUOTATION_AI_PROVIDER='openai';
  if(setting==='missing-binding')delete h.bindings.AI;
  const before=f.unchanged(),view=await json(await h.route(f.base+'/translation'));assert.equal(view.workersRecovery.configured,false);
  const response=await json(await f.prepare(),503);assert.equal(response.code,'WORKERS_RECOVERY_NOT_CONFIGURED');
  assert.equal(h.sqlite.prepare('SELECT COUNT(*) AS n FROM translation_jobs').get().n,1);assert.equal(f.unchanged(),before);assert.equal(h.aiSources.length,0);
 }finally{h.close();}
});

for(const scenario of ['uncertain','non429','foreign-owner','source-override','stale-version'])test(`only a certain exact saved Google429 can prepare a recovery (${scenario})`,async()=>{
 const f=await fixture(),{h}=f;
 try{
  if(scenario==='uncertain')h.sqlite.prepare("UPDATE translation_jobs SET status='uncertain' WHERE id=?").run(f.failed.id);
  if(scenario==='non429')h.sqlite.prepare('UPDATE translation_jobs SET error=? WHERE id=?').run(JSON.stringify({...f.failed.error,message:'Google HTTP 503'}),f.failed.id);
  if(scenario==='foreign-owner')h.sqlite.prepare("UPDATE translation_jobs SET owner_id='foreign' WHERE id=?").run(f.failed.id);
  const before=f.unchanged();await json(await f.prepare(scenario==='source-override'?{source:{title:'injected'}}:scenario==='stale-version'?{expectedVersion:'2020-01-01T00:00:00.000Z'}:{}),scenario==='source-override'?400:409);
  assert.equal(h.sqlite.prepare('SELECT COUNT(*) AS n FROM translation_jobs').get().n,1);assert.equal(f.unchanged(),before);assert.equal(h.aiSources.length,0);
 }finally{h.close();}
});

for(const phase of ['approve','execute','apply'])for(const change of ['company','source','option-revision'])test(`recovery ${phase} rejects changed ${change} without provider calls or edited-product writes`,async()=>{
 const f=await fixture(),{h}=f;
 try{
  const {job}=await json(await f.prepare(),201);
  if(phase!=='approve')await json(await f.approved(job));
  if(phase==='apply')assert.equal((await json(await f.execute(job))).job.status,'completed');
  if(change==='company')h.setCompany(companies[1]);
  if(change==='source'){const receipt=payload(h,'collection_results');receipt.title+=' 原文变更';h.sqlite.prepare('UPDATE collection_results SET payload=? WHERE job_id=?').run(JSON.stringify(receipt),'job');}
  if(change==='option-revision'){const options=payload(h,'product_options');options.revision++;h.sqlite.prepare('UPDATE product_options SET revision=?,payload=? WHERE product_id=?').run(options.revision,JSON.stringify(options),f.id);}
  const before=f.unchanged(),calls=h.aiSources.length;
  const response=phase==='approve'?await f.approved(job):phase==='execute'?await f.execute(job):await h.route(f.base+'/translation-apply',{method:'POST',body:{action:'preview',jobId:job.id,expectedVersion:f.version()}});
  await json(response,409);assert.equal(f.unchanged(),before);assert.equal(h.aiSources.length,calls);
 }finally{h.close();}
});

test('the shared quotation daily cap blocks recovery and a terminal execute is never resubmitted',async()=>{
 const f=await fixture(),{h}=f;
 try{
  const {job}=await json(await f.prepare(),201);await json(await f.approved(job));
  const reserve=h.load('db/quotation-ai-jobs.ts').reserveQuotationAiRequest;
  for(let i=0;i<40;i++)assert.equal(await reserve(),true);assert.equal(await reserve(),false);
  const result=(await json(await f.execute(job))).job;assert.equal(result.status,'failed');assert.equal(result.error.code,'WORKERS_RECOVERY_LIMIT');
  assert.equal(h.aiSources.length,0);await json(await f.execute(job));assert.equal(h.aiSources.length,0);assert.equal(h.sqlite.prepare('SELECT requests FROM quotation_ai_daily').get().requests,40);
 }finally{h.close();}
});

test('Free setting revoked after review blocks approval without provider/config substitution',async()=>{
 const f=await fixture(),{h}=f;
 try{
  const {job}=await json(await f.prepare(),201),before=f.unchanged();h.bindings.SOURCEFLOW_QUOTATION_AI_FREE_ONLY='false';
  await json(await f.approved(job),503);assert.equal(f.unchanged(),before);assert.equal(h.aiSources.length,0);
 }finally{h.close();}
});

test('an expired never-started review renews only its fingerprint on the same recovery job',async()=>{
 const f=await fixture(),{h}=f;
 try{
  const {job}=await json(await f.prepare(),201),expired={...job.review,expiresAt:'2020-01-01T00:00:00.000Z'};
  h.sqlite.prepare('UPDATE translation_jobs SET review=?,expires_at=? WHERE id=?').run(JSON.stringify(expired),expired.expiresAt,job.id);
  const original=f.original(),renewed=(await json(await f.prepare())).job;
  assert.equal(renewed.id,job.id);assert.notEqual(renewed.review.fingerprint,job.review.fingerprint);assert.ok(Date.parse(renewed.review.expiresAt)>Date.now());
  assert.deepEqual(f.original(),original);assert.equal(h.aiSources.length,0);assert.equal(h.sqlite.prepare('SELECT COUNT(*) AS n FROM translation_jobs').get().n,2);
  await json(await f.post({action:'approve',jobId:job.id,reviewFingerprint:job.review.fingerprint,confirmPaid:true}),400);
  await json(await f.approved(renewed));assert.equal((await json(await f.execute(renewed))).job.status,'completed');assert.equal(h.aiSources.length,1);
 }finally{h.close();}
});

test('approval and execution use the recorded recovery provider even if the default provider is now unconfigured',async()=>{
 const f=await fixture(),{h}=f;
 try{
  const {job}=await json(await f.prepare(),201);h.bindings.SOURCEFLOW_TEXT_PROVIDER='openai';delete h.bindings.OPENAI_API_KEY;
  await json(await f.approved(job));assert.equal((await json(await f.execute(job))).job.status,'completed');assert.equal(h.aiSources.length,1);
  assert.equal(h.bindings.SOURCEFLOW_TEXT_PROVIDER,'openai');assert.ok(!h.network.includes('api.openai.com'));
 }finally{h.close();}
});

for(const change of ['company','suspended','source','product-version','options','content'])test(`the actual provider boundary rejects ${change} changed during quota reservation`,async()=>{
 const f=await fixture(),{h}=f;
 try{
  const {job}=await json(await f.prepare(),201);await json(await f.approved(job));let changed=false;
  const originalPrepare=h.db.prepare;
  h.db.prepare=function(sql){const query=originalPrepare(sql);if(sql.startsWith('INSERT INTO quotation_ai_daily')){const execute=query.execute;query.execute=function(){
   const rows=execute();if(!changed){changed=true;
    if(change==='company')h.setCompany(companies[1]);
    if(change==='suspended')h.setMembershipStatus('suspended');
    if(change==='source'){const receipt=payload(h,'collection_results');receipt.description+=' 后续原文';h.sqlite.prepare('UPDATE collection_results SET payload=? WHERE job_id=?').run(JSON.stringify(receipt),'job');}
    if(change==='product-version')h.sqlite.prepare("UPDATE products SET updated_at='2099-01-01T00:00:00.000Z' WHERE id=?").run(f.id);
    if(change==='options'){const options=payload(h,'product_options');options.revision++;h.sqlite.prepare('UPDATE product_options SET revision=?,payload=? WHERE product_id=?').run(options.revision,JSON.stringify(options),f.id);}
    if(change==='content'){const content=payload(h,'product_content');content.revision++;h.sqlite.prepare('UPDATE product_content SET revision=?,payload=? WHERE product_id=?').run(content.revision,JSON.stringify(content),f.id);}
   }return rows;};}return query;};
  const original=f.original(),result=(await json(await f.execute(job))).job;
  assert.equal(changed,true);assert.equal(result.status,'failed');assert.equal(result.error.code,'WORKERS_RECOVERY_SOURCE_CHANGED');assert.equal(result.error.mayHaveBeenCharged,false);
  assert.equal(h.aiSources.length,0);assert.deepEqual(f.original(),original);assert.equal(h.sqlite.prepare('SELECT requests FROM quotation_ai_daily').get().requests,1);
 }finally{h.close();}
});

test('a provider timeout closes the single recovery and never creates a second request for another nonce',async()=>{
 const f=await fixture(),{h}=f;
 try{
  let calls=0;h.bindings.AI.run=async()=>{calls++;throw Error('3007: synthetic timeout');};
  const {job}=await json(await f.prepare(),201);await json(await f.approved(job));const result=(await json(await f.execute(job))).job;
  assert.equal(result.status,'uncertain');assert.equal(calls,1);assert.equal((await json(await f.prepare())).job.id,job.id);
  await json(await f.execute(job));assert.equal(calls,1);assert.equal(h.sqlite.prepare('SELECT COUNT(*) AS n FROM translation_jobs').get().n,2);
 }finally{h.close();}
});

for(const change of ['none','suspended','company'])test(`native recovery adoption fences membership at its first write (${change})`,async()=>{
 const f=await fixture(),{h}=f;
 try{
  const {job}=await json(await f.prepare(),201);await json(await f.approved(job));assert.equal((await json(await f.execute(job))).job.status,'completed');
  nativeMember(h);
  const body={jobId:job.id,expectedVersion:f.version()},preview=await json(await h.route(f.base+'/translation-apply',{method:'POST',body:{...body,action:'preview'}})),before=f.unchanged();
  let changed=false;const prepare=h.db.prepare;
  if(change!=='none')h.db.prepare=function(sql){const query=prepare(sql);if(sql.startsWith('UPDATE products SET updated_at=?')){const execute=query.execute;query.execute=function(){
    if(!changed){changed=true;if(change==='suspended')h.sqlite.prepare("UPDATE members SET status='suspended' WHERE id='owner'").run();
      else h.sqlite.prepare("UPDATE members SET company_code='A01526306',company_name='유앤채' WHERE id='owner'").run();}return execute();};}return query;};
  await json(await h.route(f.base+'/translation-apply',{method:'POST',body:{...body,action:'apply',fingerprint:preview.fingerprint}}),change==='none'?200:409);
  if(change==='none')assert.notEqual(f.unchanged(),before);else{assert.equal(changed,true);assert.equal(f.unchanged(),before);}
  assert.equal(h.aiSources.length,1);
 }finally{h.close();}
});

for(const change of ['suspended','company'])test(`an in-batch ${change} trigger rolls back every recovery adoption row`,async()=>{
 const f=await fixture(),{h}=f;
 try{
  const {job}=await json(await f.prepare(),201);await json(await f.approved(job));assert.equal((await json(await f.execute(job))).job.status,'completed');nativeMember(h);
  const body={jobId:job.id,expectedVersion:f.version()},preview=await json(await h.route(f.base+'/translation-apply',{method:'POST',body:{...body,action:'preview'}})),before=f.unchanged(),member=h.sqlite.prepare('SELECT * FROM members').get();
  h.sqlite.exec(`CREATE TRIGGER recovery_member_change AFTER UPDATE OF updated_at ON products BEGIN UPDATE members SET ${change==='suspended'?"status='suspended'":"company_code='A01526306',company_name='유앤채'"} WHERE id='owner'; END`);
  await json(await h.route(f.base+'/translation-apply',{method:'POST',body:{...body,action:'apply',fingerprint:preview.fingerprint}}),503);
  assert.equal(f.unchanged(),before);assert.deepEqual(h.sqlite.prepare('SELECT * FROM members').get(),member);assert.equal(h.aiSources.length,1);
 }finally{h.close();}
});

for(const change of ['suspended','company'])test(`the final source read cannot retain an actor changed after quota (${change})`,async()=>{
 const f=await fixture(),{h}=f;
 try{
  const {job}=await json(await f.prepare(),201);await json(await f.approved(job));let changed=false;
  const prepare=h.db.prepare;
  h.db.prepare=function(sql){const query=prepare(sql),all=query.all;
   if(sql.startsWith('SELECT * FROM translation_jobs WHERE owner_id='))query.all=async function(){const result=await all();
    const reserved=h.sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='quotation_ai_daily'").get()
      ?h.sqlite.prepare('SELECT requests FROM quotation_ai_daily').get():null;
    if(!changed&&reserved?.requests===1&&h.aiSources.length===0){changed=true;if(change==='suspended')h.setMembershipStatus('suspended');else h.setCompany(companies[1]);}return result;};return query;};
  const original=f.original(),result=(await json(await f.execute(job))).job;
  assert.equal(changed,true);assert.equal(result.status,'failed');assert.equal(result.error.code,'WORKERS_RECOVERY_SOURCE_CHANGED');assert.equal(result.error.mayHaveBeenCharged,false);
  assert.equal(h.aiSources.length,0);assert.deepEqual(f.original(),original);
 }finally{h.close();}
});

for(const legacyVersion of [2,3,4])test(`a terminal v${legacyVersion} parser failure remains archived while v5 requires a separate explicit approval`,async()=>{
 const f=await fixture(),{h}=f;try{
  const {job:seed}=await json(await f.prepare(),201),review=structuredClone(seed.review);review.workersRecovery.version=legacyVersion;
  review.fingerprint=await h.load('app/automation/model.ts').fingerprint(review);
  h.sqlite.prepare("UPDATE translation_jobs SET idempotency_key=?,status='failed',review=?,review_fingerprint=?,error=?,started_at=?,finished_at=? WHERE id=?")
   .run('workers-recovery-v'+legacyVersion+'-'+f.failed.id,JSON.stringify(review),review.fingerprint,JSON.stringify({code:'INVALID_MODEL_OUTPUT',message:'Cloudflare 응답을 검증하지 못했습니다.',mayHaveBeenCharged:true}),new Date().toISOString(),new Date().toISOString(),seed.id);
  const before=h.sqlite.prepare('SELECT * FROM translation_jobs WHERE id=?').get(seed.id),prepared=await json(await f.prepare(),201);
  assert.notEqual(prepared.job.id,seed.id);assert.equal(prepared.job.status,'prepared');assert.equal(prepared.job.review.workersRecovery.version,5);assert.equal(h.aiSources.length,0);
  assert.deepEqual(h.sqlite.prepare('SELECT * FROM translation_jobs WHERE id=?').get(seed.id),before);
  await f.execute(prepared.job);assert.equal(h.aiSources.length,0,'new contract does not authorize generation');
  assert.equal((await json(await f.prepare())).job.id,prepared.job.id);assert.equal(h.aiSources.length,0);
 }finally{h.close();}
});

test('v5 prepares one separate Qwen review while bad completed legacy Llama remains unchanged and unapplied',async()=>{
 const f=await fixture(),{h}=f;
 try{
  // Seed an archived v1 contract in this isolated DB, without a model call.
  const {job:seed}=await json(await f.prepare(),201),legacyReview=structuredClone(seed.review);
  legacyReview.model='@cf/meta/llama-3.3-70b-instruct-fp8-fast';delete legacyReview.workersRecovery.version;delete legacyReview.workersRecovery.model;
  legacyReview.fingerprint=await h.load('app/automation/model.ts').fingerprint(legacyReview);
  const legacyResult={model:legacyReview.model,draft:{title:'4D 翼형 후跟贴 고跟구두용 방수 방습 후跟패드',keywords:['방수','방습'],description:'',attributes:[],warnings:[]},
    responseId:'synthetic-archived-llama',usage:null,generatedAt:new Date().toISOString(),provenance:'generated',appliedToContent:false};
  h.sqlite.prepare("UPDATE translation_jobs SET idempotency_key=?,status='completed',review=?,review_fingerprint=?,result=?,started_at=?,finished_at=? WHERE id=?")
   .run('workers-recovery-'+f.failed.id,JSON.stringify(legacyReview),legacyReview.fingerprint,JSON.stringify(legacyResult),new Date().toISOString(),new Date().toISOString(),seed.id);
  const archived=h.sqlite.prepare('SELECT * FROM translation_jobs WHERE id=?').get(seed.id),before=f.unchanged(),body={jobId:seed.id,expectedVersion:f.version()};
  for(const action of ['preview','apply']){
   const blocked=await json(await h.route(f.base+'/translation-apply',{method:'POST',body:{...body,action,...(action==='apply'?{fingerprint:'a'.repeat(64)}:{})}}),409);
   assert.match(blocked.error,/한자/);assert.equal(f.unchanged(),before);assert.equal(h.aiSources.length,0);
  }
  const {job}=await json(await f.prepare(),201);assert.notEqual(job.id,seed.id);assert.equal(job.review.workersRecovery.version,5);
  assert.equal(job.review.workersRecovery.model,'@cf/qwen/qwen3-30b-a3b-fp8');
  assert.equal(h.sqlite.prepare('SELECT idempotency_key FROM translation_jobs WHERE id=?').get(job.id).idempotency_key,'workers-recovery-v5-'+f.failed.id);
  assert.deepEqual(h.sqlite.prepare('SELECT * FROM translation_jobs WHERE id=?').get(seed.id),archived);
  await json(await f.approved(job));assert.equal((await json(await f.execute(job))).job.status,'completed');assert.equal(h.aiSources.length,1);
  assert.equal((await json(await f.prepare())).job.id,job.id);assert.equal(h.aiSources.length,1);
  assert.deepEqual(h.sqlite.prepare('SELECT * FROM translation_jobs WHERE id=?').get(seed.id),archived);assert.equal(f.original().status,'failed');
 }finally{h.close();}
});

for(const invalid of ['mixed-title','unsupported-claim','mixed-option','llama-envelope'])test(`invalid Qwen quality/contract persists a failed single request without applying it (${invalid})`,async()=>{
 const f=await fixture(),{h}=f;
 try{
  const provider=h.bindings.AI.run;
  h.bindings.AI.run=async(...args)=>{const response=await provider(...args),draft=JSON.parse(response.choices[0].message.content);
   if(invalid==='mixed-title')draft.title='한국어 翼형 상품';
   if(invalid==='unsupported-claim')draft.keywords=['방수 패드','방습 패드'];
   if(invalid==='mixed-option')draft.attributes.find(item=>item.name.startsWith('option:')).value='검정色';
   if(invalid==='llama-envelope')return{response:draft};
   response.choices[0].message.content=JSON.stringify(draft);return response;};
  const {job}=await json(await f.prepare(),201),before=f.unchanged();await json(await f.approved(job));const failed=(await json(await f.execute(job))).job;
  assert.equal(failed.status,'failed');assert.equal(failed.result,null);assert.equal(h.aiSources.length,1);assert.equal(f.unchanged(),before);
  assert.equal(failed.error.code,invalid==='llama-envelope'?'INVALID_MODEL_OUTPUT_QWEN_COMPLETION_TYPE':invalid==='unsupported-claim'?'RECOVERY_UNSUPPORTED_CLAIM':'RECOVERY_UNTRANSLATED_TEXT');
  await json(await f.execute(job));assert.equal((await json(await f.prepare())).job.id,job.id);assert.equal(h.aiSources.length,1);
 }finally{h.close();}
});
