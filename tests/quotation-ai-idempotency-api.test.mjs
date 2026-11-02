import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { quotationAiApiFixture, companies, plain } from './helpers/quotation-ai-api.mjs';

const json=async(response,status=200)=>{assert.equal(response.status,status,await response.clone().text());return response.json();};
const view=f=>f.request(undefined,'GET').then(json);
const state=f=>({source:f.state(),jobs:plain(f.jobs()),daily:plain(f.h.sqlite.prepare('SELECT * FROM quotation_ai_daily').all())});
function unchanged(f,before){assert.deepEqual(state(f),before);assert.equal(f.provider.calls.length,0);assert.equal(f.h.aiSources.length,0);assert.deepEqual(f.h.network,[]);assert.equal(f.h.objects.size,0);}
async function seed(f,initial,key=randomUUID()){
 const saved=await f.h.load('app/exports/quotation-source.ts').readMappedQuotationSource('owner',f.id,f.profile.id),member=f.member();
 const scope={optionId:null,applyToAllOptions:true},plan=f.h.load('app/quotation-ai.ts').buildQuotationAiPlan(saved,scope);
 const review={fingerprint:initial.fingerprint,quotationRevision:saved.state.revision,profileId:f.profile.id,source:saved.source,company:JSON.parse(JSON.stringify(saved.company)),member:{id:member.id,email:member.email,role:member.role},scope,plan};
 const job=await f.h.load('db/quotation-ai-jobs.ts').createQuotationAiJob('owner',f.id,key,'b'.repeat(64),review);assert.ok(job);
 return{job,key,review};
}

for(const company of companies)test(`exact dispatch-key GET finds only its owned job beyond the history window without writes (${company.code})`,async()=>{
 const f=await quotationAiApiFixture(company);try{
  const initial=await view(f),first=await seed(f,initial);
  f.h.sqlite.prepare('UPDATE quotation_ai_jobs SET created_at=? WHERE id=?').run('2000-01-01T00:00:00.000Z',first.job.id);
  for(let index=0;index<11;index++)await seed(f,initial);
  const before=state(f),history=await view(f);assert.equal(history.jobs.length,10);assert.equal(history.jobs.some(job=>job.id===first.job.id),false);assert.equal(Object.hasOwn(history,'idempotencyKey'),false);
  const out=await json(await f.request(undefined,'GET',f.query+'&idempotencyKey='+first.key));
  assert.equal(out.idempotencyKey,first.key);assert.equal(out.jobs.length,1);assert.equal(out.jobs[0].id,first.job.id);assert.equal(out.jobs[0].profileId,f.profile.id);
  assert.equal(out.jobs[0].status,'prepared');assert.equal(out.jobs[0].fingerprint,initial.fingerprint);
  for(const secret of['review','requestFingerprint','idempotency_key','owner_id','claim_token','member','company'])assert.equal(Object.hasOwn(out.jobs[0],secret),false,secret);
  const byId=await json(await f.request(undefined,'GET',f.query+'&jobId='+first.job.id));assert.equal(byId.jobs[0].id,first.job.id);assert.equal(Object.hasOwn(byId,'idempotencyKey'),false);
  unchanged(f,before);
 }finally{f.close();}
});

test('an unknown dispatch key echoes only the query with an empty list and creates or replays nothing',async()=>{
 const f=await quotationAiApiFixture();try{
  await view(f);const key=randomUUID(),before=state(f),out=await json(await f.request(undefined,'GET',f.query+'&idempotencyKey='+key));
  assert.equal(out.idempotencyKey,key);assert.deepEqual(out.jobs,[]);assert.equal(Object.hasOwn(out,'absent'),false);assert.equal(Object.hasOwn(out,'completed'),false);unchanged(f,before);
 }finally{f.close();}
});

test('dispatch query rejects malformed, duplicate, unknown or mutually exclusive selectors before job lookup',async()=>{
 const f=await quotationAiApiFixture();try{
  await view(f);const key=randomUUID(),before=state(f);
  for(const suffix of['&idempotencyKey=','&idempotencyKey=not-uuid','&idempotencyKey='+key+'&idempotencyKey='+key,'&idempotencyKey='+key+'&jobId='+randomUUID(),'&idempotencyKey='+key+'&unknown=1','&idempotencyKey='+key+'&profileId='+f.profile.id]){
   const start=f.queries.length;await json(await f.request(undefined,'GET',f.query+suffix),400);assert.equal(f.queries.slice(start).some(sql=>/SELECT \* FROM quotation_ai_jobs/.test(sql)),false);
  }
  unchanged(f,before);
 }finally{f.close();}
});

test('exact dispatch lookup cannot expose a foreign owner or product job, company or profile',async()=>{
 for(const mismatch of['owner','product','company','profile']){
  const f=await quotationAiApiFixture();try{
   const initial=await view(f),selected=await seed(f,initial);
   if(mismatch==='owner')f.h.sqlite.prepare('UPDATE quotation_ai_jobs SET owner_id=? WHERE id=?').run('foreign-owner',selected.job.id);
   else if(mismatch==='product'){
    const current=await f.h.load('db/queries.ts').findProduct('owner',f.id);await f.h.load('db/queries.ts').insertProduct({...current,id:'foreign-product'});
    f.h.sqlite.prepare('UPDATE quotation_ai_jobs SET product_id=? WHERE id=?').run('foreign-product',selected.job.id);
   }else{
    if(mismatch==='company')selected.review.company=companies[1];else selected.review.profileId='other-profile';
    f.h.sqlite.prepare('UPDATE quotation_ai_jobs SET review=? WHERE id=?').run(JSON.stringify(selected.review),selected.job.id);
   }
   const before=state(f),out=await json(await f.request(undefined,'GET',f.query+'&idempotencyKey='+selected.key));assert.equal(out.idempotencyKey,selected.key);assert.deepEqual(out.jobs,[]);unchanged(f,before);
  }finally{f.close();}
 }
});

test('exact dispatch lookup retains approved member and workspace-owner authentication checks',async()=>{
 for(const mismatch of['status','owner']){
  const f=await quotationAiApiFixture();try{
   const initial=await view(f),selected=await seed(f,initial);if(mismatch==='status')f.mutateMember('status');else f.setOwner('foreign-owner');
   const before=state(f),out=await json(await f.request(undefined,'GET',f.query+'&idempotencyKey='+selected.key),403);assert.equal(Object.hasOwn(out,'idempotencyKey'),false);assert.equal(Object.hasOwn(out,'jobs'),false);unchanged(f,before);
  }finally{f.close();}
 }
});

test('member or product-source drift during exact-key read prevents a receipt response',async()=>{
 for(const mismatch of['email','role','company','source']){
  const f=await quotationAiApiFixture();try{
   const initial=await view(f),selected=await seed(f,initial);let changed=false,before;
   f.controls.beforeFirst=async sql=>{
    if(changed||!/SELECT \* FROM quotation_ai_jobs WHERE owner_id=\? AND product_id=\? AND idempotency_key=\?/.test(sql))return;changed=true;
    if(mismatch==='source')f.h.sqlite.prepare('UPDATE products SET updated_at=? WHERE id=?').run('2099-01-01T00:00:00.000Z',f.id);else f.mutateMember(mismatch);before=state(f);
   };
   const response=await f.request(undefined,'GET',f.query+'&idempotencyKey='+selected.key);
   assert.ok([403,409].includes(response.status),`${mismatch} must reject the receipt read`);
   const out=await json(response,response.status);assert.equal(changed,true);if(response.status===409)assert.equal(out.code,'QUOTATION_AI_SOURCE_CHANGED');
   assert.equal(Object.hasOwn(out,'idempotencyKey'),false);assert.equal(Object.hasOwn(out,'jobs'),false);unchanged(f,before);
  }finally{f.close();}
 }
});
